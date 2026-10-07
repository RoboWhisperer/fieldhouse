import { afterAll, expect, test } from "bun:test";
import { createServer, type Server } from "node:net";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app";
import { createRemote } from "../auth";
import { seedDemo } from "../data";
import { FakeEngine } from "../engine";
import { openStore } from "../store";
import { casparData, analyzeTemplate } from "./caspar";
import { AmcpDriver, amcpString } from "./connectors/amcp";
import { SingularDriver } from "./connectors/singular";
import { HttpDriver } from "./connectors/http";
import { OnAir } from "./onair";
import { EXAMPLES } from "./examples";
import { buildVars, sampleVars, substitute } from "./vars";
import { ImportError, readZip, vet, writeZip, type Entry } from "./zip";
import { resolveFields } from "./index";
import { exportPack, readPack } from "./pack";
import { createGraphic } from "./docs";

const tmp = mkdtempSync(join(tmpdir(), "fh-gfx-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

async function rig() {
  const store = openStore(":memory:"), engine = new FakeEngine(), t = { now: 1_000_000 };
  const dir = mkdtempSync(join(tmp, "g-"));
  const app = createApp({ store, engine, now: () => t.now, graphicsDir: dir });
  seedDemo(store);
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await app.handle(new Request("http://localhost:8080/api" + path, { method, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body), headers: body === undefined || body instanceof FormData ? {} : { "content-type": "application/json" } }));
    const ct = r.headers.get("content-type") ?? "";
    return { status: r.status, body: ct.includes("json") ? await r.json() : ct.includes("zip") ? new Uint8Array(await r.arrayBuffer()) : await r.text(), res: r } as { status: number; body: any; res: Response };
  };
  const g = (await call("GET", "/games")).body.find((x: any) => x.status === "scheduled");
  await call("POST", `/games/${g.id}/activate`);
  return { store, engine, app, call, t, dir, close: () => { app.stop(); return engine.close(); } };
}

// ---------------------------------------------------------------- variables
test("variables: teams, clock, rosters, custom data and counters; {{path|fallback}} escapes by context", () => {
  const v = sampleVars();
  expect(v["home.name"]).toBe("Lions"); expect(v["home.score"]).toBe(42); expect(v.clock).toBe("04:31"); expect(v.periodLabel).toBe("Q3");
  expect(v["home.starters.1.name"]).toBe("Avery Cole"); expect(v["home.starters.count"]).toBe(5); expect(v["home.roster.count"]).toBe(6);
  expect(v["custom.ticker"]).toContain("Welcome"); expect(v["counters.fouls.away"]).toBe(6); expect(v["game.venue"]).toBe("Main gym");
  const empty = buildVars({ game: null });
  expect(empty["home.score"]).toBe(0); expect(empty.clock).toBe("00:00"); expect(Object.keys(empty).some((k) => k.startsWith("custom."))).toBe(false);
  expect(substitute("{{home.name}} {{nope|fallback}} {{nope}}.", v)).toBe("Lions fallback .");
  const evil = { x: `<img src=x onerror="a">'&` };
  expect(substitute("{{x}}", evil)).toBe("&lt;img src=x onerror=&quot;a&quot;&gt;&#39;&amp;");
  expect(substitute("{{x}}", evil, "css")).not.toMatch(/[<>"';:{}]/);
  expect(substitute("a b/{{x}}", { x: "c&d" }, "url")).toBe("a b/c%26d");
  expect(substitute('{"t":"{{x}}"}', { x: 'q"\n' }, "json")).toBe('{"t":"q\\"\\n"}');
});
test("fields: overrides beat bindings, bindings beat defaults", () => {
  const defs = [{ name: "a", label: "a", type: "text" as const, default: "d", binding: { kind: "var" as const, value: "home.score" } }, { name: "b", label: "b", type: "text" as const, default: "dflt", binding: { kind: "var" as const, value: "missing" } },
    { name: "c", label: "c", type: "text" as const, default: "", binding: { kind: "const" as const, value: "{{home.abbr}}!" } }, { name: "d", label: "d", type: "text" as const, default: "man", binding: { kind: "manual" as const, value: "" } }];
  expect(resolveFields(defs, sampleVars())).toEqual({ a: "42", b: "dflt", c: "LIO!", d: "man" });
  expect(resolveFields(defs, sampleVars(), { a: "9", extra: "x" })).toMatchObject({ a: "9", extra: "x" });
});

// ---------------------------------------------------------------- visibility state machine
test("on-air state machine: auto-hide, stopping hold, update, next", () => {
  let t = 0; const oa = new OnAir(() => t);
  oa.show("a", { seconds: 5, holdMs: 1000, fields: { x: "1" } });
  expect(oa.isOn("a")).toBe(true); expect(oa.seq("a")).toBe(1); expect(oa.nextDeadline()).toBe(5000);
  t = 4999; expect(oa.phase("a")).toBe("on");
  t = 5000; expect(oa.isOn("a")).toBe(false); expect(oa.phase("a")).toBe("stopping"); expect(oa.nextDeadline()).toBe(6000);
  t = 6000; expect(oa.phase("a")).toBe("off"); expect(oa.nextDeadline()).toBeNull();
  oa.show("a"); expect(oa.seq("a")).toBe(2); expect(oa.overrides("a")).toEqual({}); // a new showing starts clean
  oa.show("a"); expect(oa.seq("a")).toBe(2); // already on: no new showing
  oa.update("a", { y: "2" }); oa.next("a"); expect(oa.overrides("a")).toEqual({ y: "2" }); expect(oa.nextSeq("a")).toBe(1);
  oa.hide("a", 0); expect(oa.phase("a")).toBe("off");
});

// ---------------------------------------------------------------- zip and import safety
const zipOf = (files: Entry[]) => writeZip(files);
test("zip: round trip, and every unsafe archive is refused", () => {
  const ok = readZip(zipOf([{ path: "a/b.html", data: enc("<p>hi</p>") }]));
  expect(ok.map((e) => e.path)).toEqual(["a/b.html"]);
  for (const bad of ["../evil.html", "/abs.html", "a/../../x.html", "C:/x.html", "a\\b.html", ".hidden/x.html", "a//b.html"]) expect(() => vet([{ path: bad, data: enc("x") }])).toThrow(ImportError);
  const v = vet([{ path: "ok.html", data: enc("x") }, { path: "run.exe", data: enc("x") }, { path: "t.ft", data: enc("x") }, { path: "__MACOSX/._ok.html", data: enc("x") }]);
  expect(v.files.map((f) => f.path)).toEqual(["ok.html"]); expect(v.skipped.map((s) => s.path)).toEqual(["run.exe", "t.ft"]);
  expect(() => vet([{ path: "a.html", data: enc("x") }, { path: "A.html", data: enc("y") }])).toThrow(/twice/);
  expect(() => vet([{ path: "big.mp4", data: new Uint8Array(26 * 1024 * 1024) }])).toThrow(/larger/);
  expect(() => vet(Array.from({ length: 501 }, (_, i) => ({ path: `f${i}.css`, data: enc("x") })))).toThrow(/more than 500/);
  expect(() => vet(Array.from({ length: 3 }, (_, i) => ({ path: `f${i}.mp4`, data: new Uint8Array(20 * 1024 * 1024) })))).toThrow(/50 MB/);
  expect(() => readZip(enc("not a zip at all, nothing here, padding padding"))).toThrow(/not a zip/);
});
test("zip: symlinks, encryption and lying sizes (zip bombs) are refused", () => {
  const z = Buffer.from(zipOf([{ path: "l.html", data: enc("target") }]));
  const cd = z.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  const link = Buffer.from(z); link.writeUInt32LE((0o120777 << 16) >>> 0, cd + 38);
  expect(() => readZip(link)).toThrow(/symbolic link/);
  const enc1 = Buffer.from(z); enc1.writeUInt16LE(1, cd + 8);
  expect(() => readZip(enc1)).toThrow(/Password/);
  const body = enc("x".repeat(10000)), bomb = Buffer.from(zipOf([{ path: "b.css", data: body }]));
  const cd2 = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bomb.writeUInt32LE(10, cd2 + 24); // claims 10 bytes but inflates to 10000
  expect(() => readZip(bomb)).toThrow(/zip bomb|size/);
});

// ---------------------------------------------------------------- CasparCG data and analysis
test("caspar data: XML for Flash-style templates, typed JSON for 2.1+ templates", () => {
  expect(casparData({ f0: 'Tom & "Jerry"' }, "xml")).toBe('<templateData><componentData id="f0"><data id="text" value="Tom &amp; &quot;Jerry&quot;"/></componentData></templateData>');
  expect(JSON.parse(casparData({ s: "5", n: "5", ok: "true" }, "json", [{ name: "n", label: "", type: "number", default: "", binding: { kind: "manual", value: "" } }, { name: "ok", label: "", type: "bool", default: "", binding: { kind: "manual", value: "" } }]))).toEqual({ s: "5", n: 5, ok: true });
  expect(amcpString('a"b\\c\nd')).toBe('"a\\"b\\\\c\\nd"');
});
test("caspar analysis of the shipped examples", () => {
  const an = (id: string) => analyzeTemplate([{ path: "index.html", data: enc(EXAMPLES.find((e) => e.id === id)!.html) }]);
  const lt = an("caspar-lower-third");
  expect(lt.functions).toEqual({ play: true, stop: true, update: true, next: false }); expect(lt.dataFormat).toBe("xml");
  expect(lt.fields.map((f) => f.id)).toEqual(expect.arrayContaining(["f0", "f1"]));
  const sb = an("caspar-score-bug"); expect(sb.dataFormat).toBe("json"); expect(sb.fields.map((f) => f.id)).toEqual(expect.arrayContaining(["home", "homeScore", "clock"]));
  expect(sb.fields.find((f) => f.id === "homeScore")?.suggestion?.value).toBe("home.score");
  const card = an("caspar-fullscreen-card"); expect(card.functions.next).toBe(true);
  const odd = analyzeTemplate([{ path: "t.html", data: enc('<script>function update(d){}</script><link href="https://fonts.example.com/x.css"><style>div{transform:translate3d(0,0,1px)}</style>') }, { path: "old.ft", data: enc("x") }]);
  expect(odd.needsNetwork).toBe(true); expect(odd.warnings.join(" ")).toMatch(/internet/); expect(odd.warnings.join(" ")).toMatch(/3D/); expect(odd.warnings.join(" ")).toMatch(/Flash/); expect(odd.warnings.join(" ")).toMatch(/play\(\)/);
});

// ---------------------------------------------------------------- AMCP against a fake CasparCG
function fakeCaspar(reply: (cmd: string) => string) {
  const got: string[] = [], socks = new Set<any>();
  const srv: Server = createServer((s) => { socks.add(s); let buf = ""; s.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\r\n")) >= 0) { const c = buf.slice(0, i); buf = buf.slice(i + 2); got.push(c); s.write(reply(c)); } }); s.on("close", () => socks.delete(s)); s.on("error", () => {}); });
  return new Promise<{ port: number; got: string[]; close: () => void; drop: () => void }>((res) => srv.listen(0, "127.0.0.1", () => res({ port: (srv.address() as any).port, got, close: () => { for (const s of socks) s.destroy(); srv.close(); }, drop: () => { for (const s of socks) s.destroy(); } })));
}
const deps = (o: Partial<any> = {}) => ({ fetch, vars: () => ({}), log: () => {}, problem: () => {}, status: () => {}, ...o });
test("AMCP: show/update/next/hide send the right commands and parse 200/201/202/4xx replies", async () => {
  const fake = await fakeCaspar((c) => (c === "VERSION" ? "201 VERSION OK\r\n2.4.0 STABLE\r\n" : c.includes("nope") ? "404 CG ERROR\r\n" : c.startsWith("INFO") ? "200 INFO OK\r\nline1\r\nline2\r\n\r\n" : "202 CG OK\r\n"));
  const d = new AmcpDriver({ port: fake.port, template: "fh/lower", channel: 1, layer: 10, cgLayer: 1 }, deps());
  expect((await d.test()).message).toContain("2.4.0");
  await d.show({}, { f0: "Jane" }, "x");
  await d.update({}, { f0: "Jane" }); // unchanged: nothing sent
  await d.update({}, { f0: "Joan" });
  await d.next({}); await d.hide({});
  expect(fake.got).toEqual(["VERSION", 'CG 1-10 ADD 1 "fh/lower" 1 "<templateData><componentData id=\\"f0\\"><data id=\\"text\\" value=\\"Jane\\"/></componentData></templateData>"',
    'CG 1-10 UPDATE 1 "<templateData><componentData id=\\"f0\\"><data id=\\"text\\" value=\\"Joan\\"/></componentData></templateData>"', "CG 1-10 NEXT 1", "CG 1-10 STOP 1"]);
  await expect(new AmcpDriver({ port: fake.port, template: "nope" }, deps()).show({}, {}, "x")).rejects.toThrow(/template path/);
  d.close(); fake.close();
});
test("AMCP: a dropped connection is re-made and what was on air is put back", async () => {
  const fake = await fakeCaspar(() => "202 CG OK\r\n");
  const d = new AmcpDriver({ port: fake.port, template: "t", dataFormat: "json" }, deps());
  await d.show({}, { a: "1" }, "x");
  fake.drop();
  await new Promise((r) => setTimeout(r, 2500));
  expect(fake.got.filter((c) => c.startsWith("CG 1-10 ADD")).length).toBeGreaterThanOrEqual(2);
  await d.hide({}); d.close(); fake.close();
}, 10000);
test("AMCP: an unreachable server gives a plain error", async () => {
  const fake = await fakeCaspar(() => "202\r\n"); const port = fake.port; fake.close(); await new Promise((r) => setTimeout(r, 50));
  const d = new AmcpDriver({ port, template: "t", timeoutMs: 800 }, deps());
  expect((await d.test()).ok).toBe(false); await expect(d.show({}, {}, "x")).rejects.toThrow(/Could not connect|did not answer/);
});

// ---------------------------------------------------------------- Singular against a mocked fetch
test("Singular: exact PATCH shape, only changed fields, coalescing, and the token never leaks", async () => {
  const calls: { url: string; init: any }[] = [], logs: string[] = [], probs: string[] = [];
  const mock = async (url: any, init: any) => { calls.push({ url: String(url), init }); return Response.json({ success: true }); };
  const d = new SingularDriver("SECRETTOKEN123", { ratePerSecond: 50 }, deps({ fetch: mock as any, log: (_l: string, m: string) => logs.push(m), problem: (m: string) => probs.push(m) }));
  d.setTypes({ score: "number", on: "bool" });
  const t = { subCompositionName: "Bug" };
  await d.show(t, { name: "Jane", score: "12", on: "true" });
  await d.idle();
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe("https://app.singular.live/apiv2/controlapps/SECRETTOKEN123/control");
  expect(calls[0].init.method).toBe("PATCH"); expect(calls[0].init.headers["content-type"]).toBe("application/json");
  expect(JSON.parse(calls[0].init.body)).toEqual([{ subCompositionName: "Bug", payload: { name: "Jane", score: 12, on: true }, state: "In" }]);
  await d.update(t, { name: "Jane", score: "12", on: "true" }); await d.idle(); expect(calls).toHaveLength(1); // nothing changed: nothing sent
  await d.update(t, { name: "Jane", score: "13", on: "true" }); await d.update(t, { name: "Jane", score: "14", on: "true" }); await d.idle();
  expect(calls).toHaveLength(2); expect(JSON.parse(calls[1].init.body)).toEqual([{ subCompositionName: "Bug", payload: { score: 14 } }]); // two updates, one request
  await d.hide({ subCompositionId: "abc-1", outState: "Out2" }); await d.idle();
  expect(JSON.parse(calls[2].init.body)).toEqual([{ subCompositionId: "abc-1", state: "Out2" }]);
  expect(JSON.stringify([logs, probs])).not.toContain("SECRETTOKEN123");
  d.close();
});
test("Singular: retries with backoff, gives up politely, and never puts the token in a message", async () => {
  let n = 0; const probs: string[] = [], status: string[] = [];
  const mock = async () => { n++; return new Response("", { status: n < 3 ? 503 : 200 }); };
  const d = new SingularDriver("TOKEN-ABCDEF", { ratePerSecond: 100, backoffMs: 5 }, deps({ fetch: mock as any, problem: (m: string) => probs.push(m), status: (_ok: boolean, m: string) => status.push(m) }));
  await d.show({ subCompositionName: "A" }, { x: "1" }); await d.idle(); expect(n).toBe(3); expect(probs).toEqual([]);
  const bad = new SingularDriver("TOKEN-ABCDEF", { ratePerSecond: 100, backoffMs: 1, retries: 1 }, deps({ fetch: (async () => { throw new Error("connect https://app.singular.live/apiv2/controlapps/TOKEN-ABCDEF/control failed"); }) as any, problem: (m: string) => probs.push(m) }));
  await bad.show({ subCompositionName: "A" }, { x: "1" }); await bad.idle();
  expect(probs[0]).toContain("Could not reach Singular"); expect(JSON.stringify([probs, status])).not.toContain("TOKEN-ABCDEF");
  const auth = new SingularDriver("TOKEN-ABCDEF", {}, deps({ fetch: (async () => new Response("", { status: 401 })) as any }));
  expect(await auth.test()).toEqual({ ok: false, message: expect.stringContaining("did not accept the app token") });
  await expect(auth.model()).rejects.toThrow(/app token/);
});
test("Singular: test connection is a read-only GET; the model is flattened for the wizard", async () => {
  const seen: string[] = [];
  const mock = async (url: any, init: any) => { seen.push(init.method + " " + String(url).replace("TOK", "***")); return String(url).endsWith("/model") ? Response.json([{ id: "m", name: "default", model: [], subcompositions: [{ id: "s1", name: "compText", state: "Out", model: [{ id: "text-node", type: "text", title: "Headline", defaultValue: "x" }], subcompositions: [] }] }]) : Response.json([{ subCompositionId: "m" }, { subCompositionId: "s1" }]); };
  const d = new SingularDriver("TOK", {}, deps({ fetch: mock as any }));
  expect((await d.test()).message).toContain("2 sub-compositions");
  expect(await d.model()).toEqual({ compositions: [{ id: "s1", name: "compText", state: "Out", fields: [{ id: "text-node", type: "text", title: "Headline", defaultValue: "x" }] }] });
  expect(seen).toEqual(["GET https://app.singular.live/apiv2/controlapps/***/control", "GET https://app.singular.live/apiv2/controlapps/***/model"]);
});
test("HTTP connector: templates are escaped per place and the secret stays out of errors", async () => {
  const seen: any[] = [];
  const d = new HttpDriver({ show: { method: "POST", url: "https://h.example/x/{{field.name}}", headers: { Authorization: "Bearer {{secret}}" }, body: '{"n":"{{field.name}}","s":{{home.score}}}', bodyFormat: "json" } }, "S3CRET", deps({ vars: () => ({ "home.score": 7 }), fetch: (async (u: any, i: any) => { seen.push({ u, i }); return new Response("", { status: 500 }); }) as any }));
  await expect(d.show({}, { name: 'a b"c' }, "g")).rejects.toThrow(/failed/);
  expect(seen[0].u).toBe("https://h.example/x/a%20b%22c"); expect(seen[0].i.body).toBe('{"n":"a b\\"c","s":7}'); expect(seen[0].i.headers.Authorization).toBe("Bearer S3CRET");
  await d.show({}, { name: "z" }, "g").catch((e) => expect(e.message).not.toContain("S3CRET"));
});

// ---------------------------------------------------------------- through the app: legacy API, built-ins, CRUD, packs, files, connectors
test("legacy /api/graphics keeps its shape and maps onto the built-in graphics", async () => {
  const { call, app, t, close } = await rig();
  let g = (await call("GET", "/state")).body.graphics;
  expect(g).toMatchObject({ scorebug: true, lower: null, slate: null, sponsor: null }); expect(Array.isArray(g.items)).toBe(true);
  expect(g.items.map((i: any) => i.id)).toEqual(expect.arrayContaining(["builtin-scorebug", "builtin-lowerthird", "builtin-slate", "builtin-sponsor", "builtin-scoreboard", "builtin-ticker", "builtin-clock", "builtin-lineup", "builtin-final"]));
  const bug = () => app.state().graphics.items.find((i: any) => i.id === "builtin-scorebug");
  expect(bug().phase).toBe("on");
  expect((await call("POST", "/graphics", { scorebug: false })).body.scorebug).toBe(false); expect(bug().phase).toBe("off");
  await call("POST", "/graphics", { scorebug: true });
  const r = await call("POST", "/graphics", { lower: { title: "Avery Cole", sub: "Guard" }, slate: "BRB" });
  expect(r.body).toMatchObject({ lower: { title: "Avery Cole", sub: "Guard" }, slate: "BRB" });
  const lt = () => app.state().graphics.items.find((i: any) => i.id === "builtin-lowerthird");
  expect(lt().fields).toMatchObject({ title: "Avery Cole" }); expect(app.state().graphics.vars["lower.title"]).toBe("Avery Cole");
  t.now += 9000; await new Promise((r) => setTimeout(r, 0));
  expect(app.state().graphics.lower).toBeNull(); // auto-hide after 8 s (policy of the built-in)
  expect((await call("POST", "/graphics", { slate: null })).body.slate).toBeNull();
  await call("POST", "/graphics", { lower: null });
  expect((await call("POST", "/sponsors/fire", {})).status).toBeLessThan(500);
  await close();
});
test("built-ins: edit, modified flag, reset to default, duplicate; user graphics: create, update, delete", async () => {
  const { call, close } = await rig();
  const list = (await call("GET", "/graphics")).body; expect(list.filter((d: any) => d.builtinId).length).toBe(9);
  const e = await call("PUT", "/graphics/builtin-scorebug", { style: { colors: { accent: "#ff0000", bg: "#102030" }, radius: 20, parts: { clock: false } }, placement: { anchor: "top-right", x: 10, y: 20, scale: 1.5, z: 70, opacity: 0.9 }, animation: { in: { preset: "slide-down", durationMs: 800 } } });
  expect(e.status).toBe(200); expect(e.body.modified).toBe(true); expect(e.body.style.colors.bg).toBe("#102030"); expect(e.body.style.parts.clock).toBe(false); expect(e.body.animation.in).toMatchObject({ preset: "slide-down", durationMs: 800, easing: "ease" });
  expect((await call("PUT", "/graphics/builtin-scorebug", { style: { colors: { bg: "javascript:alert(1)" } } })).status).toBe(400);
  expect((await call("PUT", "/graphics/builtin-scorebug", { placement: { x: 99999 } })).status).toBe(400);
  expect((await call("PUT", "/graphics/builtin-scorebug", { style: { parts: { nonsense: true } } })).status).toBe(400);
  const dup = await call("POST", "/graphics/builtin-scorebug/duplicate", { name: "My bug" });
  expect(dup.body.id).not.toBe("builtin-scorebug"); expect(dup.body.style.radius).toBe(20); expect((await call("DELETE", "/graphics/" + dup.body.id)).status).toBe(200);
  expect((await call("DELETE", "/graphics/builtin-scorebug")).status).toBe(409);
  const reset = await call("POST", "/graphics/builtin-scorebug/reset");
  expect(reset.body.modified).toBe(false); expect(reset.body.style.radius).toBe(6); expect(reset.body.placement.anchor).toBe("bottom-left");
  expect((await call("POST", "/graphics/gfx_x/reset")).status).toBe(400);
  const u = await call("POST", "/graphics/create", { kind: "url", name: "Web overlay", source: { url: "https://example.com/o" } });
  expect(u.status).toBe(200); expect(u.body.source).toMatchObject({ url: "https://example.com/o", width: 1920 });
  expect((await call("POST", "/graphics/create", { kind: "url", name: "x", source: { url: "javascript:alert(1)" } })).status).toBe(400);
  expect((await call("POST", "/graphics/create", { kind: "url", name: "x", source: { url: "file:///etc/passwd" } })).status).toBe(400);
  expect((await call("POST", "/graphics/create", { kind: "builtin", name: "x" })).status).toBe(400);
  const h = await call("POST", "/graphics/create", { kind: "html", name: "Mine" });
  expect((await call("GET", `/graphics/${h.body.id}/files`)).body.map((f: any) => f.path)).toEqual(["index.html"]);
  await call("PUT", `/graphics/${h.body.id}/file`, { path: "style.css", content: "a{}" });
  expect((await call("PUT", `/graphics/${h.body.id}/file`, { path: "../x.html", content: "" })).status).toBe(400);
  expect((await call("PUT", `/graphics/${h.body.id}/file`, { path: "run.exe", content: "" })).status).toBe(400);
  expect((await call("DELETE", `/graphics/${h.body.id}`)).status).toBe(200); expect((await call("GET", `/graphics/${h.body.id}`)).status).toBe(404);
  await close();
});
test("show / hide / toggle / update / next / clear, and policies", async () => {
  const { call, app, close } = await rig();
  expect((await call("POST", "/graphics/builtin-ticker/show")).body.visible).toBe(true);
  expect(app.graphics.control.list().find((x) => x.id === "builtin-ticker")!.visible).toBe(true);
  expect((await call("POST", "/graphics/builtin-ticker/toggle")).body.visible).toBe(false);
  expect((await call("POST", "/graphics/builtin-ticker/update", { fields: { text: "x" } })).status).toBe(409); // not on air
  await call("POST", "/graphics/builtin-lowerthird/show", { fields: { title: "A", sub: "B" } });
  expect((await call("POST", "/graphics/builtin-lowerthird/update", { fields: { sub: "C" } })).status).toBe(200);
  expect(app.state().graphics.items.find((i: any) => i.id === "builtin-lowerthird").fields).toMatchObject({ title: "A", sub: "C" });
  expect((await call("POST", "/graphics/builtin-lowerthird/next")).status).toBe(400); // built-ins have no next step
  await call("PUT", "/graphics/builtin-clock", { show: { mode: "always" } });
  expect(app.state().graphics.items.find((i: any) => i.id === "builtin-clock").phase).toBe("on");
  expect((await call("POST", "/graphics/builtin-clock/hide")).status).toBe(409);
  await call("PUT", "/graphics/builtin-final", { enabled: false });
  expect((await call("POST", "/graphics/builtin-final/show")).status).toBe(409);
  expect((await call("POST", "/graphics/nope/show")).status).toBe(404);
  await call("POST", "/graphics/clear");
  const on = app.graphics.control.list().filter((x) => x.visible).map((x) => x.id); expect(on).toEqual(["builtin-clock"]); // only the always-on one remains
  await call("PUT", "/graphics/builtin-clock", { show: { mode: "while-live" } });
  expect(app.graphics.control.list().find((x) => x.id === "builtin-clock")!.visible).toBe(false);
  await call("POST", "/broadcast/start");
  expect(app.graphics.control.list().find((x) => x.id === "builtin-clock")!.visible).toBe(true);
  await call("POST", "/broadcast/stop");
  await close();
});
test("external layers reach the engine, hidden until shown", async () => {
  const { call, engine, close } = await rig();
  const u = (await call("POST", "/graphics/create", { kind: "url", name: "Web", source: { url: "https://example.com/o", width: 1280, height: 720, css: "body{zoom:1}" }, placement: { z: -5 } })).body;
  expect(engine.layers).toEqual([{ id: u.id, url: "https://example.com/o", width: 1280, height: 720, z: -5, visible: false, css: "body{zoom:1}" }]);
  await call("POST", `/graphics/${u.id}/show`); expect(engine.layers[0].visible).toBe(true);
  await call("POST", `/graphics/${u.id}/hide`); expect(engine.layers[0].visible).toBe(false);
  await call("DELETE", `/graphics/${u.id}`); expect(engine.layers).toEqual([]);
  await close();
});
test("packs: export then import round-trips with a new id, no secrets; bad packs are refused", async () => {
  const { call, close } = await rig();
  const ex = (await call("POST", "/graphics/examples/caspar-lower-third/install")).body;
  expect(ex.kind).toBe("caspar");
  const out = await call("GET", `/graphics/${ex.id}/export`);
  const entries = readZip(out.body); expect(entries.map((e) => e.path)).toEqual(["manifest.json", "files/index.html"]);
  const man = JSON.parse(dec(entries[0].data)); expect(man.schema).toBe(1); expect(man.graphic.id).toBeUndefined(); expect(man.graphic.createdAt).toBeUndefined();
  const fd = new FormData(); fd.append("file", new File([out.body as BlobPart], "lt.fhgfx"));
  const staged = await call("POST", "/graphics/import", fd); expect(staged.status).toBe(200); expect(staged.body.kind).toBe("pack");
  const done = await call("POST", "/graphics/import/commit", { token: staged.body.token });
  expect(done.status).toBe(200); expect(done.body.id).not.toBe(ex.id); expect(done.body.name).toBe(ex.name); expect(done.body.fields).toEqual(ex.fields);
  expect((await call("GET", `/graphics/${done.body.id}/file?path=index.html`)).body.content).toContain("function update");
  expect((await call("POST", "/graphics/import/commit", { token: staged.body.token })).status).toBe(410); // used up
  // remote graphic: connector link and secret-like target keys are scrubbed
  const r = createGraphic({ kind: "remote", name: "R", source: { connectorId: "conn_1", target: { subCompositionName: "Bug", apiKey: "SECRET", token: "T" }, outputUrl: "https://example.com/out" } });
  const back = readPack(readZip(exportPack(r, [])));
  expect((back.doc.source as any).connectorId).toBe(""); expect(JSON.stringify(back.doc)).not.toContain("SECRET"); expect(back.doc.id).not.toBe(r.id);
  const evil = writeZip([{ path: "manifest.json", data: enc(JSON.stringify({ schema: 1, graphic: { kind: "caspar", name: "x", source: { entry: "index.html" } } })) }]);
  expect(() => readPack(readZip(evil))).toThrow(/missing its entry/);
  expect(() => readPack(readZip(writeZip([{ path: "manifest.json", data: enc(JSON.stringify({ schema: 2, graphic: {} })) }])))).toThrow(/newer version/);
  await close();
});
test("import: a template zip is analysed, mapped and committed; hostile uploads get plain errors", async () => {
  const { call, close } = await rig();
  const zip = writeZip([{ path: "tpl/index.html", data: enc(EXAMPLES[1].html) }, { path: "tpl/logo.png", data: new Uint8Array([1, 2]) }, { path: "tpl/readme.txt", data: enc("hi") }]);
  const fd = new FormData(); fd.append("file", new File([zip as BlobPart], "Score Bug.zip"));
  const a = await call("POST", "/graphics/import", fd);
  expect(a.status).toBe(200); expect(a.body.analysis.entry).toBe("index.html"); expect(a.body.analysis.dataFormat).toBe("json"); expect(a.body.skipped.map((s: any) => s.path)).toEqual(["readme.txt"]); expect(a.body.name).toBe("Score Bug");
  const c = await call("POST", "/graphics/import/commit", { token: a.body.token, role: "scorebug", dataFormat: "json", fields: [{ name: "homeScore", label: "Home", type: "number", default: "0", binding: { kind: "var", value: "home.score" } }] });
  expect(c.status).toBe(200); expect(c.body.source).toMatchObject({ entry: "index.html", dataFormat: "json" }); expect(c.body.fields[0].name).toBe("homeScore");
  await call("POST", `/graphics/${c.body.id}/show`);
  const item = (await call("GET", "/state")).body.graphics.items.find((i: any) => i.id === c.body.id);
  expect(item.phase).toBe("on"); expect(JSON.parse(item.data)).toEqual({ homeScore: 0 }); expect(item.source.src).toMatch(new RegExp(`^/gfx/${c.body.id}/index\\.html\\?v=\\d+\\.\\d+$`));
  for (const [name, bytes] of [["slip.zip", writeZip([{ path: "../evil.html", data: enc("x") }])], ["empty.zip", writeZip([{ path: "a.css", data: enc("x") }])]] as const) {
    const f = new FormData(); f.append("file", new File([bytes as BlobPart], name));
    const r = await call("POST", "/graphics/import", f); expect(r.status).toBe(400); expect(r.body.error.length).toBeGreaterThan(10);
  }
  const noFile = await call("POST", "/graphics/import", new FormData()); expect(noFile.status).toBe(400);
  await close();
});
test("connectors: secrets are write-only and never reach API output, state or logs; remote graphics drive the connector", async () => {
  const { call, app, close } = await rig();
  const c = await call("POST", "/graphics/connectors", { kind: "singular", name: "Singular", secret: "TOP-SECRET-TOKEN", config: { ratePerSecond: 50 } });
  expect(c.status).toBe(200); expect(c.body.secretSet).toBe(true); expect(JSON.stringify(c.body)).not.toContain("TOP-SECRET");
  const calls: any[] = [];
  (app.graphics.conns as any).deps.fetch = async (u: any, i: any) => { calls.push({ u: String(u), i }); return Response.json({ success: true }); };
  expect(JSON.stringify((await call("GET", "/graphics/connectors")).body)).not.toContain("TOP-SECRET");
  expect((await call("PUT", `/graphics/connectors/${c.body.id}`, { name: "Renamed" })).body.secretSet).toBe(true); // secret kept when not sent
  expect((await call("POST", "/graphics/connectors", { kind: "caspar", name: "x", config: { host: "bad host!" } })).status).toBe(400);
  const g = (await call("POST", "/graphics/create", { kind: "remote", name: "UNO bug", fields: [{ name: "score", label: "Score", type: "number", default: "0", binding: { kind: "var", value: "home.score" } }],
    source: { connectorId: c.body.id, target: { subCompositionName: "Bug" }, outputUrl: "https://example.com/uno-output" } })).body;
  await call("POST", `/graphics/${g.id}/show`); await app.graphics.conns.driver(c.body.id).idle();
  expect(JSON.parse(calls[0].i.body)).toEqual([{ subCompositionName: "Bug", payload: { score: 0 }, state: "In" }]);
  await call("POST", "/event", { type: "score", team: "home", points: 2 }); app.graphics.sync(); await app.graphics.conns.driver(c.body.id).idle();
  expect(JSON.parse(calls[1].i.body)).toEqual([{ subCompositionName: "Bug", payload: { score: 2 } }]);
  await call("POST", `/graphics/${g.id}/hide`); await app.graphics.conns.driver(c.body.id).idle();
  expect(JSON.parse(calls.at(-1).i.body)).toEqual([{ subCompositionName: "Bug", state: "Out" }]);
  const everything = JSON.stringify([(await call("GET", "/state")).body, (await call("GET", "/graphics")).body, (await call("GET", `/graphics/${g.id}/export`)).body.length]);
  expect(everything).not.toContain("TOP-SECRET");
  const bad = await call("POST", "/graphics/create", { kind: "remote", name: "orphan", source: { connectorId: "conn_none", target: {} } });
  expect((await call("POST", `/graphics/${bad.body.id}/show`)).status).toBe(404);
  expect((await call("DELETE", `/graphics/connectors/${c.body.id}`)).status).toBe(200);
  await close();
});
test("fonts: the overlay's report is stored and listed with the web-font note", async () => {
  const { call, close } = await rig();
  expect((await call("GET", "/graphics/fonts")).body).toMatchObject({ families: [], source: "none" });
  await call("POST", "/graphics/fonts/report", { families: ["DejaVu Sans", "Bad<Name>", "Noto Sans"], obs: true, userAgent: "x" });
  const f = (await call("GET", "/graphics/fonts")).body; expect(f.families).toEqual(["DejaVu Sans", "Noto Sans"]); expect(f.source).toBe("obs"); expect(f.note).toMatch(/font file/i); expect(f.note).toMatch(/serif/);
  await close();
});
test("sample vars and examples endpoints", async () => {
  const { call, close } = await rig();
  expect((await call("GET", "/graphics/sample-vars")).body["home.name"]).toBe("Lions");
  expect((await call("GET", "/graphics/examples")).body.map((e: any) => e.id)).toEqual(["caspar-lower-third", "caspar-score-bug", "caspar-fullscreen-card"]);
  await close();
});

// ---------------------------------------------------------------- /gfx serving and the remote gate
test("/gfx: static files, content types, no-store, CSP, runtime injection; path traversal is refused", async () => {
  const { app, call, dir, close } = await rig();
  const g = (await call("POST", "/graphics/create", { kind: "html", name: "T", source: { allowNetwork: false } })).body;
  await call("PUT", `/graphics/${g.id}/file`, { path: "a/pic.svg", content: "<svg/>" });
  const secret = join(dir, "..", "outside.txt"); writeFileSync(secret, "TOPSECRET");
  const get = (p: string) => app.graphics.serve(new Request("http://127.0.0.1:8080" + p));
  const page = await get(`/gfx/${g.id}/index.html`);
  expect(page.status).toBe(200); expect(page.headers.get("content-type")).toContain("text/html"); expect(page.headers.get("cache-control")).toBe("no-store");
  expect(page.headers.get("content-security-policy")).toContain("sandbox allow-scripts"); expect(page.headers.get("content-security-policy")).toContain("connect-src http://127.0.0.1:8080/gfx/");
  const ptxt = await page.text(); expect(ptxt).toContain("<script src=\"/gfx/_runtime.js\"></script>"); expect(ptxt).toContain("data-fh-base"); expect(ptxt).toContain("\"Arial\"");
  expect((await get(`/gfx/${g.id}/a/pic.svg`)).headers.get("content-type")).toBe("image/svg+xml");
  const rt = await get("/gfx/_runtime.js"); expect(rt.status).toBe(200); expect(await rt.text()).toContain("Fieldhouse");
  for (const p of [`/gfx/${g.id}/../outside.txt`, `/gfx/${g.id}/%2e%2e/outside.txt`, `/gfx/${g.id}/..%2foutside.txt`, `/gfx/..%2f${g.id}/index.html`, `/gfx/${g.id}/%2Fetc/passwd`, `/gfx/${g.id}//etc/passwd`, `/gfx/${g.id}/a\\..\\..\\outside.txt`, `/gfx/${g.id}/index.html%00.png`, `/gfx/${g.id}/`, `/gfx/`, "/gfx/nope/x.html"]) {
    const r = await get(p); expect([p, r.status === 200 && (await r.text()).includes("TOPSECRET")]).toEqual([p, false]); expect(r.status).not.toBe(200);
  }
  // a link inside the graphic's folder that points outside must not be followed
  mkdirSync(join(dir, g.id), { recursive: true }); try { symlinkSync(secret, join(dir, g.id, "link.json")); expect((await get(`/gfx/${g.id}/link.json`)).status).toBe(404); } catch {}
  expect((await app.graphics.serve(new Request("http://127.0.0.1:8080/gfx/x/y", { method: "POST" }))).status).toBe(405);
  await close();
});
test("the remote gate: /gfx, /overlay and the graphics API are never reachable from other devices", async () => {
  const { app, store, close } = await rig();
  const { saveSettings } = await import("../data");
  const remote = createRemote({ app, store, webDir: join(import.meta.dir, "..", "..", "web") });
  for (const enabled of [false, true]) {
    saveSettings(store, { remote: { enabled, code: "WILD-4821" } });
    for (const [m, p] of [["GET", "/gfx/_runtime.js"], ["GET", "/gfx/builtin-scorebug/index.html"], ["GET", "/overlay"], ["GET", "/api/graphics"], ["POST", "/api/graphics/import"], ["PUT", "/api/graphics/builtin-scorebug"], ["GET", "/api/graphics/connectors"], ["POST", "/api/graphics/fonts/report"], ["GET", "/api/graphics/state"]] as const) {
      const r = (await remote.handle(new Request("http://192.168.1.10:8081" + p, { method: m }), "192.168.1.50")) as Response;
      expect([m + " " + p, r.status]).toEqual([m + " " + p, 403]);
    }
  }
  remote.close(); await close();
});
