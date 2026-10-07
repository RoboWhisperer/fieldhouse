import { afterAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app";
import { FakeEngine } from "../engine";
import { openStore } from "../store";

const engines: FakeEngine[] = [];
afterAll(async () => { await Promise.all(engines.map((e) => e.close())); });
function mk() {
  const store = openStore(":memory:"), engine = new FakeEngine(); engines.push(engine);
  const app = createApp({ store, engine, graphicsDir: mkdtempSync(join(tmpdir(), "fh-gws-")) });
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await app.handle(new Request("http://x/api" + path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: body === undefined ? {} : { "content-type": "application/json" } }));
    return { status: r.status, body: (r.headers.get("content-type") ?? "").includes("json") ? await r.json() : await r.text() };
  };
  return { app, store, call };
}
const html = "<html><body><p>hello</p></body></html>";

async function seeded() {
  const a = mk();
  const g = (await a.call("POST", "/graphics/create", { kind: "html", name: "Custom bug", fields: [{ name: "title", type: "text" }] })).body;
  await a.call("PUT", `/graphics/${g.id}/file`, { path: "index.html", content: html });
  await a.call("PUT", `/graphics/${g.id}/file`, { path: "logo.png", contentBase64: Buffer.from([1, 2, 3, 4]).toString("base64") });
  await a.call("POST", "/graphics/create", { kind: "url", name: "Web layer", source: { url: "https://example.com/o" } });
  await a.call("PUT", "/graphics/builtin-scorebug", { name: "My score bug" });
  const c = (await a.call("POST", "/graphics/connectors", { kind: "singular", name: "Singular", secret: "SUPER-SECRET-TOKEN-123", config: {} })).body;
  await a.call("POST", "/graphics/connectors", { kind: "http", name: "Hook", secret: "ANOTHER-SECRET-999", config: { show: { url: "https://h.example/show?token=abc123&x=1", headers: { Authorization: "Bearer abc123", "X-Team": "{{home.name}}" } } } });
  const p = (await a.call("POST", "/profiles", { duplicateOf: "soccer", name: "Futsal" })).body;
  await a.call("PUT", "/profiles/hockey", { ...(await a.call("GET", "/profiles/hockey")).body, name: "Hockey (mine)" });
  return { ...a, g, c, p };
}

test("graphics and profiles round trip; secrets are never exported", async () => {
  const a = await seeded();
  const out = await a.call("GET", "/workspace/export?sections=graphics,profiles");
  const text = JSON.stringify(out.body);
  expect(text).not.toContain("SUPER-SECRET"); expect(text).not.toContain("ANOTHER-SECRET"); expect(text).not.toContain("abc123");
  expect(text).toContain("X-Team");
  const doc = out.body;
  expect(Object.keys(doc.sections).sort()).toEqual(["graphics", "profiles"]);
  expect(doc.sections.graphics.graphics.map((g: any) => g.graphic.name).sort()).toEqual(["Custom bug", "My score bug", "Web layer"]);

  const b = mk();
  const dry = (await b.call("POST", "/workspace/import", { workspace: doc, dryRun: true })).body;
  expect(dry.ok).toBe(true); expect(dry.applied).toBe(false);
  expect(dry.sections.find((s: any) => s.name === "graphics").plan.add).toBeGreaterThan(0);
  expect((await b.call("GET", "/graphics")).body.some((x: any) => x.name === "Custom bug")).toBe(false); // dry run changed nothing

  const real = (await b.call("POST", "/workspace/import", { workspace: doc, mode: "merge" })).body;
  expect(real.ok).toBe(true); expect(real.applied).toBe(true);
  const gs = (await b.call("GET", "/graphics")).body;
  expect(gs.find((x: any) => x.id === a.g.id).name).toBe("Custom bug");
  expect(gs.find((x: any) => x.id === "builtin-scorebug").name).toBe("My score bug");
  const f = (await b.call("GET", `/graphics/${a.g.id}/file?path=index.html`)).body;
  expect(f.content).toBe(html);
  expect((await b.call("GET", `/graphics/${a.g.id}/file?path=logo.png`)).body.contentBase64).toBe(Buffer.from([1, 2, 3, 4]).toString("base64"));
  const conns = (await b.call("GET", "/graphics/connectors")).body;
  expect(conns.map((c: any) => c.name).sort()).toEqual(["Hook", "Singular"]);
  expect(conns.every((c: any) => c.secretSet === false)).toBe(true);
  expect((await b.call("GET", "/profiles")).body.map((p: any) => p.name)).toContain("Futsal");
  expect((await b.call("GET", "/profiles/hockey")).body.name).toBe("Hockey (mine)");

  // importing again into the same app updates in place (no duplicates) and keeps a connector's token
  await b.call("PUT", `/graphics/connectors/${a.c.id}`, { secret: "typed-by-hand" });
  await b.call("POST", "/workspace/import", { workspace: doc, mode: "merge" });
  expect((await b.call("GET", "/graphics")).body.filter((x: any) => x.name === "Custom bug").length).toBe(1);
  expect((await b.call("GET", "/graphics/connectors")).body.find((c: any) => c.id === a.c.id).secretSet).toBe(true);

  // replace removes what the file does not have
  await b.call("POST", "/graphics/create", { kind: "url", name: "Extra", source: { url: "https://example.com/x" } });
  await b.call("POST", "/workspace/import", { workspace: doc, mode: "replace" });
  expect((await b.call("GET", "/graphics")).body.some((x: any) => x.name === "Extra")).toBe(false);
});

test("a repeated or invalid graphic id gets a fresh one", async () => {
  const a = await seeded(), doc = (await a.call("GET", "/workspace/export?sections=graphics")).body;
  const gs = doc.sections.graphics.graphics, one = gs.find((g: any) => g.graphic.name === "Web layer");
  gs.push({ ...one, graphic: { ...one.graphic, name: "Twin" } }, { ...one, id: "bad id!", graphic: { ...one.graphic, name: "Odd" } });
  const b = mk();
  expect((await b.call("POST", "/workspace/import", { workspace: doc })).body.ok).toBe(true);
  const list = (await b.call("GET", "/graphics")).body.filter((x: any) => ["Web layer", "Twin", "Odd"].includes(x.name));
  expect(list.length).toBe(3); expect(new Set(list.map((x: any) => x.id)).size).toBe(3);
});

test("invalid data changes nothing", async () => {
  const a = await seeded(), doc = (await a.call("GET", "/workspace/export?sections=graphics,profiles")).body;
  const b = mk();
  const before = JSON.stringify([(await b.call("GET", "/graphics")).body, (await b.call("GET", "/profiles")).body]);
  const cases: [string, (d: any) => void][] = [
    ["bad graphic", (d) => { d.sections.graphics.graphics[0].graphic.placement = { scale: 99 }; }],
    ["missing entry", (d) => { d.sections.graphics.graphics.find((g: any) => g.graphic.kind === "html").files = []; }],
    ["bad base64", (d) => { d.sections.graphics.graphics.find((g: any) => g.graphic.kind === "html").files[0].base64 = "***"; }],
    ["bad profile", (d) => { d.sections.profiles[0].periods = { count: 0 }; }],
    ["secret", (d) => { d.sections.graphics.connectors[0].secret = "x"; }],
    ["traversal", (d) => { d.sections.graphics.graphics.find((g: any) => g.graphic.kind === "html").files[0].path = "../evil.html"; }],
  ];
  for (const [name, mutate] of cases) {
    const d = structuredClone(doc); mutate(d);
    const r = (await b.call("POST", "/workspace/import", { workspace: d, mode: "replace" })).body;
    expect(r.applied === true).toBe(false); expect(name + (r.ok === false || r.error ? "" : " accepted")).toBe(name);
    expect(JSON.stringify([(await b.call("GET", "/graphics")).body, (await b.call("GET", "/profiles")).body])).toBe(before);
  }
});
