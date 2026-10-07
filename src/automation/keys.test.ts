import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";
import { createApp } from "../app";
import { createRemote, hashToken, type Remote } from "../auth";
import { saveSettings, seedDemo } from "../data";
import { FakeEngine } from "../engine";
import { openStore } from "../store";

const LAN = "192.168.1.50";
const rigs: Remote[] = [], engines: FakeEngine[] = [];
afterAll(async () => { rigs.forEach((r) => r.close()); await Promise.all(engines.map((e) => e.close())); });

async function rig() {
  const store = openStore(":memory:"), engine = new FakeEngine(); engines.push(engine);
  const t = { now: 1_000_000 };
  const app = createApp({ store, engine, now: () => t.now });
  seedDemo(store);
  const remote = createRemote({ app, store, now: () => t.now, webDir: join(import.meta.dir, "..", "..", "web") }); rigs.push(remote);
  const g = (await (await app.handle(new Request("http://x/api/games"))).json()).find((x: any) => x.status === "scheduled");
  await app.handle(new Request(`http://x/api/games/${g.id}/activate`, { method: "POST" }));
  saveSettings(store, { remote: { enabled: true, code: "WILD-4821" } });
  // Like server.ts: the gate first, then the normal app for what the gate lets through.
  const call = async (ip: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const raw = body === undefined ? undefined : JSON.stringify(body);
    const req = new Request((ip === "127.0.0.1" ? "http://localhost:8080" : "http://192.168.1.10:8081") + path, { method, body: raw, headers: { ...(raw ? { "content-type": "application/json" } : {}), ...headers } });
    const gate = await remote.handle(req, ip);
    const r = gate && gate !== "upgraded" ? gate : await app.handle(req);
    const ct = r.headers.get("content-type") ?? "";
    return { status: r.status, body: ct.includes("json") ? await r.json() : null, res: r };
  };
  const mint = async (name = "Companion", role?: string) => { const r = await call("127.0.0.1", "POST", "/api/remote/keys", { name, role }); return { ...r, key: r.body.key as string, id: r.body.device?.id as string, auth: { authorization: `Bearer ${r.body.key}` } }; };
  return { app, store, remote, t, call, mint };
}

test("a key is created on the console, shown once, stored only as a hash and never listed", async () => {
  const { store, call, mint } = await rig();
  const k = await mint("Companion");
  expect(k.status).toBe(200);
  expect(k.key).toMatch(/^fhk_[A-Za-z0-9_-]{43}$/);
  const doc = store.list<any>("device")[0];
  expect(doc).toMatchObject({ name: "Companion", role: "controller", key: true, tokenHash: hashToken(k.key) });
  expect(JSON.stringify(store.list("device"))).not.toContain(k.key);
  const list = await call("127.0.0.1", "GET", "/api/remote/keys");
  expect(list.body).toHaveLength(1);
  expect(JSON.stringify(list.body)).not.toContain(k.key);
  expect(JSON.stringify((await call("127.0.0.1", "GET", "/api/remote/status")).body)).not.toContain(k.key);
  expect((await call("127.0.0.1", "POST", "/api/remote/keys", { name: "" })).status).toBe(400);
  expect((await call("127.0.0.1", "POST", "/api/remote/keys", { name: "x", role: "score" })).body.error).toContain("controller or producer");
});

test("keys cannot be created or listed from the network", async () => {
  const { call, mint } = await rig();
  const k = await mint();
  expect((await call(LAN, "POST", "/api/remote/keys", { name: "x" }, k.auth)).status).toBe(403);
  expect((await call(LAN, "GET", "/api/remote/keys", undefined, k.auth)).status).toBe(403);
});

test("controller key allowlist: production actions, macros and triggers yes; mixer, broadcast, settings, files, destinations no", async () => {
  const { call, mint, app } = await rig();
  const k = await mint();
  const m = (await app.handle(new Request("http://x/api/macros", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: "Horn", actions: [{ type: "custom.set", key: "horn", value: "1" }] }) }))).json();
  const macro = await m;
  const ok = async (method: string, path: string, body?: unknown) => { const r = await call(LAN, method, path, body, k.auth); expect(r.status, `${method} ${path} ${JSON.stringify(r.body)}`).toBe(200); return r; };
  await ok("GET", "/api/state");
  await ok("POST", "/api/engine/cut"); // empty body, no content-type: fine
  await ok("POST", "/api/engine/fade", { ms: 300 });
  await ok("POST", "/api/replay", { secondsBack: 8 });
  await ok("POST", "/api/event", { type: "score", team: "home", points: 2 });
  await ok("POST", "/api/event", { type: "mark", note: "x" });
  await ok("GET", "/api/macros");
  expect((await ok("POST", `/api/macros/${macro.id}/run`, {})).body.status).toBe("ok");
  expect(app.automation.custom.all().horn).toBe("1");
  expect((await ok("POST", "/api/automation/trigger", { name: "anything", data: { a: 1 } })).body).toEqual({ woke: 0 });
  await ok("PUT", "/api/custom", { values: { ticker: "Hello", ignored: undefined } });
  expect(app.automation.custom.all().ticker).toBe("Hello");
  await ok("POST", "/api/graphics/clear", {});
  const no = async (method: string, path: string, body?: unknown) => { const r = await call(LAN, method, path, body, k.auth); expect([403, 404], `${method} ${path}`).toContain(r.status); expect(r.status).toBe(403); };
  await no("POST", "/api/engine/mute", { id: "mic", muted: true });
  await no("POST", "/api/engine/gain", { id: "mic", gainDb: 0 });
  await no("POST", "/api/broadcast/start", {});
  await no("PUT", "/api/settings", { telemetry: true });
  await no("GET", "/api/settings");
  await no("GET", "/api/destinations");
  await no("POST", "/api/destinations", { name: "x" });
  await no("GET", "/api/recordings");
  await no("GET", "/api/workspace/export");
  await no("POST", "/api/workspace/import", {});
  await no("POST", "/api/webhooks", { name: "x", url: "https://a.example" });
  await no("PUT", "/api/macros/x", {});
  await no("POST", "/api/automation/rules", {});
  await no("DELETE", "/api/custom/ticker");
  await no("POST", "/api/remote/lock", { locked: true });
  await no("GET", "/overlay-debug");
});

test("the key also works through the cookie flow, and a controller keeps no snapshot access", async () => {
  const { call, mint, app } = await rig();
  const k = await mint();
  expect((await call(LAN, "GET", "/api/state", undefined, { cookie: `fh_device=${k.key}` })).status).toBe(200);
  expect((await call(LAN, "GET", "/snap/program", undefined, k.auth)).status).toBe(403);
  const pro = await mint("Deck", "producer");
  expect((await call(LAN, "POST", "/api/engine/mute", { id: app.engine.status().mixer[0].id, muted: true }, pro.auth)).status).toBe(200); // a producer key does everything a producer phone does
});

test("event stream: allowed for keys, refused for paired phones", async () => {
  const { call, mint, app } = await rig();
  const k = await mint();
  const r = await call(LAN, "GET", "/api/stream", undefined, k.auth);
  expect(r.status).toBe(200);
  expect(r.res.headers.get("content-type")).toBe("text/event-stream");
  await r.res.body!.cancel();
  // a paired phone with the producer role is not a key
  const pair = await call(LAN, "POST", "/api/remote/pair", { code: "WILD-4821", name: "Dana" });
  await call("127.0.0.1", "PUT", `/api/remote/devices/${pair.body.device.id}`, { role: "producer" });
  expect((await call(LAN, "GET", "/api/stream", undefined, { cookie: `fh_device=${pair.body.token}` })).status).toBe(403);
  // the console itself (loopback) reads it freely
  const local = await call("127.0.0.1", "GET", "/api/stream");
  expect(local.status).toBe(200); await local.res.body!.cancel();
  void app;
});

test("revoking a key stops it at once; a wrong key is refused and guessing is rate limited", async () => {
  const { call, mint } = await rig();
  const k = await mint();
  expect((await call(LAN, "GET", "/api/state", undefined, k.auth)).status).toBe(200);
  expect((await call("127.0.0.1", "DELETE", `/api/remote/devices/${k.id}`)).status).toBe(200);
  const r = await call(LAN, "GET", "/api/state", undefined, k.auth);
  expect(r.status).toBe(401);
  expect(r.body.error).toContain("not valid or was revoked");
  let last = 0;
  for (let i = 0; i < 25; i++) last = (await call(LAN, "GET", "/api/state", undefined, { authorization: `Bearer fhk_wrong${i}` })).status;
  expect(last).toBe(429);
  // other addresses are not affected
  expect((await call("192.168.1.77", "GET", "/api/state", undefined, { authorization: "Bearer fhk_nope" })).status).toBe(401);
});

test("the gate stays closed when the remote is off, locked, or the peer is not on the LAN; keys are capped", async () => {
  const { call, mint, store, remote } = await rig();
  const k = await mint();
  expect((await call("8.8.8.8", "GET", "/api/state", undefined, k.auth)).status).toBe(403);
  saveSettings(store, { remote: { enabled: false } });
  expect((await call(LAN, "GET", "/api/state", undefined, k.auth)).status).toBe(403);
  saveSettings(store, { remote: { enabled: true } });
  await call("127.0.0.1", "POST", "/api/remote/lock", { locked: true });
  expect((await call(LAN, "POST", "/api/engine/cut", {}, k.auth)).status).toBe(423);
  await call("127.0.0.1", "POST", "/api/remote/lock", { locked: false });
  for (let i = 0; i < 19; i++) expect((await mint(`k${i}`)).status).toBe(200);
  expect((await call("127.0.0.1", "POST", "/api/remote/keys", { name: "one too many" })).status).toBe(409);
  void remote;
});

test("keys do not use up the phone slots", async () => {
  const { call, mint } = await rig();
  for (let i = 0; i < 20; i++) await mint(`k${i}`);
  expect((await call(LAN, "POST", "/api/remote/pair", { code: "WILD-4821", name: "Dana" })).status).toBe(200);
});
