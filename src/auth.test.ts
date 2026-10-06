import { afterAll, expect, test } from "bun:test";
import { createApp } from "./app";
import { createRemote, hashToken, isLoopback, isPrivate, lanAddresses, type Remote } from "./auth";
import { saveSettings, seedDemo } from "./data";
import { recentLogs } from "./diagnostics";
import { FakeEngine } from "./engine";
import { openStore } from "./store";

const LAN = "192.168.1.50";
const rigs: Remote[] = [];
const engines: FakeEngine[] = [];
afterAll(() => { rigs.forEach((r) => r.close()); engines.forEach((e) => e.close()); });

/** A fresh app + remote with a controllable clock, an active demo game and the remote switched on (without opening a port). */
async function rig(remoteSettings: Record<string, unknown> = {}) {
  const store = openStore(":memory:"), engine = new FakeEngine(); engines.push(engine);
  const t = { now: 1_000_000 };
  const app = createApp({ store, engine, now: () => t.now });
  seedDemo(store);
  const remote = createRemote({ app, store, now: () => t.now, webDir: new URL("../web", import.meta.url).pathname }); rigs.push(remote);
  const game = (await (await app.handle(new Request("http://x/api/games"))).json()).find((g: any) => g.status === "scheduled");
  await app.handle(new Request(`http://x/api/games/${game.id}/activate`, { method: "POST" }));
  saveSettings(store, { remote: { enabled: true, code: "WILD-4821", ...remoteSettings } });
  const call = async (ip: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const raw = typeof body === "string" ? body : body === undefined ? undefined : JSON.stringify(body);
    const r = await remote.handle(new Request((ip === "127.0.0.1" || ip === "::1" ? "http://localhost:8080" : "http://192.168.1.10:8081") + path, { method, body: raw, headers: { ...(raw !== undefined ? { "content-type": "application/json" } : {}), ...headers } }), ip);
    if (!r || r === "upgraded") return { status: r ? 101 : 0, body: null as any, res: null as any };
    const ct = r.headers.get("content-type") ?? "";
    return { status: r.status, body: ct.includes("json") ? await r.json() : await r.text(), res: r } as { status: number; body: any; res: Response };
  };
  const pair = async (name = "Coach Dana", ip = LAN) => {
    const r = await call(ip, "POST", "/api/remote/pair", { code: "WILD-4821", name });
    return { ...r, token: r.body.token as string, cookie: { cookie: `fh_device=${r.body.token}` }, id: r.body.device?.id as string };
  };
  const admin = (method: string, path: string, body?: unknown) => call("127.0.0.1", method, "/api/remote" + path, body);
  return { store, app, remote, t, call, pair, admin };
}

test("address classification: loopback and private ranges", () => {
  for (const ip of ["127.0.0.1", "127.8.8.8", "::1", "::ffff:127.0.0.1"]) expect(isLoopback(ip)).toBe(true);
  for (const ip of ["192.168.1.5", "10.1.2.3", "172.16.0.1", "172.31.255.1", "169.254.3.4", "fd12:3456::1", "fe80::1", "::ffff:192.168.0.9", "::1"]) expect(isPrivate(ip)).toBe(true);
  for (const ip of ["8.8.8.8", "172.32.0.1", "172.15.0.1", "192.169.0.1", "2001:4860::1", "", "999.1.1.1", "not-an-ip"]) expect(isPrivate(ip)).toBe(false);
  for (const ip of ["192.168.1.5", "8.8.8.8", "", undefined]) expect(isLoopback(ip)).toBe(false);
});

test("pairing: success sets an HttpOnly SameSite=Strict cookie and stores only the token hash", async () => {
  const { store, pair, call } = await rig();
  const p = await pair();
  expect(p.status).toBe(200);
  expect(p.token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 random bytes
  const cookie = p.res.headers.get("set-cookie")!;
  expect(cookie).toContain("fh_device=" + p.token);
  expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("SameSite=Strict");
  const devs = store.list<any>("device");
  expect(devs).toHaveLength(1);
  expect(devs[0].tokenHash).toBe(hashToken(p.token));
  expect(devs[0].role).toBe("score");
  expect(JSON.stringify(store.list<any>("device"))).not.toContain(p.token); // never at rest
  expect(JSON.stringify(recentLogs(500))).not.toContain(p.token); // never in logs
  expect((await call(LAN, "GET", "/api/remote/me", undefined, p.cookie)).body.device.name).toBe("Coach Dana");
  // the code is forgiving about case and spaces
  expect((await call(LAN, "POST", "/api/remote/pair", { code: " wild-4821 ", name: "  Sam   <b>Lee</b> " })).body.device.name).toBe("Sam bLee/b");
});

test("pairing: failures are plain, and 5 wrong codes lock the address out for 5 minutes", async () => {
  const { call, t, store } = await rig();
  const bad = (code: string, name = "Sam") => call(LAN, "POST", "/api/remote/pair", { code, name });
  expect((await call(LAN, "POST", "/api/remote/pair", { code: "WILD-4821", name: "" })).status).toBe(400);
  expect((await call(LAN, "POST", "/api/remote/pair", { name: "Sam" })).body.error).toContain("pairing code");
  const first = await bad("NOPE-0000");
  expect(first.status).toBe(401); expect(first.body.error).toContain("4 tries left");
  for (let i = 0; i < 3; i++) await bad("NOPE-0000");
  const fifth = await bad("NOPE-0000");
  expect(fifth.status).toBe(429); expect(fifth.body.retryAfterSec).toBe(300); expect(fifth.res.headers.get("retry-after")).toBe("300");
  expect(fifth.body.error).toContain("5 min");
  t.now += 60_000;
  const during = await bad("WILD-4821"); // even the right code waits out the lockout
  expect(during.status).toBe(429); expect(during.body.retryAfterSec).toBe(240);
  expect(store.list("device")).toHaveLength(0);
  expect((await call("192.168.1.77", "POST", "/api/remote/pair", { code: "WILD-4821", name: "Other phone" })).status).toBe(200); // other addresses are unaffected
  t.now += 241_000;
  expect((await bad("WILD-4821")).status).toBe(200); // lockout over
});

test("pairing: a whole-network cap stops guessing from many addresses", async () => {
  const { call } = await rig();
  let last = 0;
  for (let i = 0; i < 26; i++) last = (await call(`192.168.2.${i + 1}`, "POST", "/api/remote/pair", { code: "NOPE-0000", name: "x" })).status;
  expect(last).toBe(429);
  expect((await call("192.168.2.200", "POST", "/api/remote/pair", { code: "WILD-4821", name: "x" })).status).toBe(429);
});

test("allowlist: a paired phone reaches only the remote surface, everything else is 403", async () => {
  const { call, pair, admin } = await rig();
  const p = await pair();
  for (const [m, path, body] of [["GET", "/api/settings"], ["PUT", "/api/settings", { telemetry: true }], ["GET", "/api/log"], ["GET", "/api/destinations"], ["POST", "/api/broadcast/start", {}], ["POST", "/api/games", {}], ["GET", "/api/remote/status"], ["DELETE", "/api/remote/devices/" + p.id], ["POST", "/api/remote/lock", { locked: true }], ["POST", "/api/remote/code/rotate", {}], ["GET", "/overlay"], ["GET", "/"], ["GET", "/app.js"], ["GET", "/snap/cam1"], ["GET", "/rec/x.mp4"]] as const) {
    const r = await call(LAN, m, path, body, p.cookie);
    expect([m + " " + path, r.status]).toEqual([m + " " + path, 403]);
    expect(r.res.headers.get("cache-control")).toBe("no-store");
  }
  // without a token even the state is closed (401), pairing page assets are open
  expect((await call(LAN, "GET", "/api/state")).status).toBe(401);
  expect((await call(LAN, "POST", "/api/event", { type: "clock.start" })).status).toBe(401);
  expect((await call(LAN, "GET", "/api/state", undefined, { cookie: "fh_device=" + "A".repeat(43) })).status).toBe(401);
  const page = await call(LAN, "GET", "/remote");
  expect(page.status).toBe(200); expect(page.body).toContain("Fieldhouse Remote");
  expect(page.res.headers.get("content-security-policy")).toContain("script-src 'self'");
  expect(page.res.headers.get("x-content-type-options")).toBe("nosniff");
  expect(page.res.headers.get("referrer-policy")).toBe("no-referrer");
  for (const f of ["/remote/remote.js", "/remote/remote.css", "/tokens.css", "/ui.css", "/icons.js"]) expect((await call(LAN, "GET", f)).status).toBe(200);
  // the console (loopback) is not gated: null = carry on with the normal app; remote admin is answered here
  expect((await call("127.0.0.1", "GET", "/api/settings")).status).toBe(0);
  expect((await call("::1", "PUT", "/api/settings", {})).status).toBe(0);
  expect((await admin("GET", "/status")).status).toBe(200);
  // DNS rebinding: a loopback peer addressed by any other host name is refused, localhost spellings are fine
  const { remote: rr } = await rig();
  for (const host of ["evil.example", "192.168.1.5", "rebind.attacker.net:8080"]) expect(((await rr.handle(new Request(`http://${host}/api/settings`), "127.0.0.1")) as Response).status).toBe(403);
  for (const host of ["localhost:8080", "127.0.0.1:8080", "[::1]:8080"]) expect(await rr.handle(new Request(`http://${host}/api/settings`), "127.0.0.1")).toBeNull();
  // a fake loopback peer on the phone-only listener still gets the phone surface only
  const lanOnly = await (async () => { const { remote } = await rig(); return remote.handle(new Request("http://127.0.0.1:8081/api/settings"), "127.0.0.1", { lan: true }); })();
  expect((lanOnly as Response).status).toBe(403);
});

test("the phone gets a trimmed state: no settings, destinations, recordings or pairing code", async () => {
  const { call, pair } = await rig();
  const p = await pair();
  const st = (await call(LAN, "GET", "/api/state", undefined, p.cookie)).body;
  expect(Object.keys(st).sort()).toEqual(["events", "game", "gameDoc", "gameId", "graphics", "kind", "locked", "profile", "serverNow"]);
  expect(st.gameDoc.home.roster.length).toBeGreaterThan(0);
  const text = JSON.stringify(st);
  for (const secret of ["WILD-4821", "demo-key", "storageDir", "destination", "recording", "tokenHash", "remote"]) expect(text).not.toContain(secret);
});

test("events: role limits, parseEv validation and the undo target guard", async () => {
  const { call, pair, admin, app } = await rig();
  const p = await pair();
  const ev = (b: unknown) => call(LAN, "POST", "/api/event", b, p.cookie);
  expect((await ev({ type: "clock.start" })).status).toBe(200);
  const s = await ev({ type: "score", team: "home", points: 3 });
  expect(s.status).toBe(200); expect(s.body.seq).toBeGreaterThan(0);
  expect((await ev({ type: "score", team: "home", points: 9 })).status).toBe(400); // parseEv
  expect((await ev({ type: "score", team: "nope", points: 1 })).status).toBe(400);
  expect((await ev({ type: "game.start", home: "A", away: "B" })).status).toBe(403); // not a scorekeeper event
  expect((await ev({ type: "bogus" })).status).toBe(403);
  const mark = await ev({ type: "mark" });
  expect(mark.status).toBe(403); expect(mark.body.error).toContain("mark");
  const firstSeq = (await app.handle(new Request("http://x/api/log")).then((r) => r.json()))[0].seq; // game.start
  expect((await ev({ type: "undo", target: firstSeq })).status).toBe(400); // cannot undo the game's start
  expect((await ev({ type: "undo", target: s.body.seq })).status).toBe(200);
  expect((await ev({ type: "undo" })).status).toBe(409); // nothing left to undo
  // the console promotes the phone
  expect((await admin("PUT", "/devices/" + p.id, { role: "owner" })).status).toBe(400);
  expect((await admin("PUT", "/devices/" + p.id, { role: "score+marks" })).status).toBe(200);
  expect((await ev({ type: "mark", note: "dunk" })).status).toBe(200);
  const state = await (await app.handle(new Request("http://x/api/state"))).json();
  expect(state.events.some((e: any) => e.type === "mark")).toBe(true);
  // diagnostics carry the device name, never the token
  const lines = recentLogs(500).map((l) => l.msg).filter((m) => m.startsWith("remote Coach Dana"));
  expect(lines.length).toBeGreaterThan(3);
  expect(lines.join("\n")).not.toContain(p.token);
});

test("console lock answers 423 and unlocks again; the phone state says locked", async () => {
  const { call, pair, admin } = await rig();
  const p = await pair();
  expect((await admin("POST", "/lock", { locked: "yes" })).status).toBe(400);
  expect((await admin("POST", "/lock", { locked: true })).status).toBe(200);
  const r = await call(LAN, "POST", "/api/event", { type: "clock.start" }, p.cookie);
  expect(r.status).toBe(423); expect(r.body.error).toBe("The console has locked the remote");
  expect((await call(LAN, "GET", "/api/state", undefined, p.cookie)).body.locked).toBe(true);
  expect((await admin("GET", "/status")).body.locked).toBe(true);
  await admin("POST", "/lock", { locked: false });
  expect((await call(LAN, "POST", "/api/event", { type: "clock.start" }, p.cookie)).status).toBe(200);
});

test("hardening: body size cap, per-device rate limit, cross-origin writes, JSON only", async () => {
  const { call, pair, t } = await rig();
  const p = await pair();
  const big = JSON.stringify({ type: "mark", note: "x".repeat(5000) });
  expect((await call(LAN, "POST", "/api/event", big, p.cookie)).status).toBe(413);
  expect((await call(LAN, "POST", "/api/event", "x", { ...p.cookie, "content-length": "99999" })).status).toBe(413);
  expect((await call(LAN, "POST", "/api/remote/pair", JSON.stringify({ name: "x".repeat(5000), code: "a" }))).status).toBe(413);
  expect((await call(LAN, "POST", "/api/event", "{not json", p.cookie)).status).toBe(400);
  expect((await call(LAN, "POST", "/api/event", { type: "clock.stop" }, { ...p.cookie, "content-type": "text/plain" })).status).toBe(415);
  expect((await call(LAN, "POST", "/api/event", { type: "clock.stop" }, { ...p.cookie, origin: "http://evil.example" })).status).toBe(403);
  expect((await call(LAN, "POST", "/api/event", { type: "clock.stop" }, { ...p.cookie, origin: "null" })).status).toBe(403);
  expect((await call(LAN, "POST", "/api/event", { type: "clock.stop" }, { ...p.cookie, origin: "http://192.168.1.10:8081" })).status).toBe(200); // same origin is fine
  expect((await call(LAN, "POST", "/api/remote/pair", { code: "WILD-4821", name: "x" }, { origin: "http://evil.example" })).status).toBe(403);
  const codes: number[] = [];
  for (let i = 0; i < 30; i++) codes.push((await call(LAN, "POST", "/api/event", { type: "clock.stop" }, p.cookie)).status);
  expect(codes.filter((c) => c === 429).length).toBeGreaterThan(5);
  expect(codes.slice(0, 15).every((c) => c === 200)).toBe(true);
  t.now += 2000;
  expect((await call(LAN, "POST", "/api/event", { type: "clock.stop" }, p.cookie)).status).toBe(200); // bucket refilled
});

test("lockedToLan refuses public addresses; switching it off lets them reach the pairing gate", async () => {
  const { call, pair, store } = await rig();
  const p = await pair();
  for (const ip of ["8.8.8.8", "2001:4860::1", ""]) {
    expect((await call(ip, "GET", "/remote")).status).toBe(403);
    expect((await call(ip, "GET", "/api/state", undefined, p.cookie)).status).toBe(403);
    expect((await call(ip, "POST", "/api/remote/pair", { code: "WILD-4821", name: "x" })).status).toBe(403);
  }
  for (const ip of ["fe80::1", "fd00::5", "10.0.0.8", "172.20.1.1", "169.254.1.1"]) expect((await call(ip, "GET", "/api/state", undefined, p.cookie)).status).toBe(200);
  saveSettings(store, { remote: { lockedToLan: false } });
  expect((await call("8.8.8.8", "GET", "/api/state", undefined, p.cookie)).status).toBe(200);
});

test("the remote is off by default: nothing is served to phones until it is enabled", async () => {
  const { call, store } = await rig({ enabled: false });
  expect((await call(LAN, "GET", "/remote")).status).toBe(403);
  expect((await call(LAN, "POST", "/api/remote/pair", { code: "WILD-4821", name: "x" })).body.error).toContain("turned off");
  saveSettings(store, { remote: { enabled: true } });
  expect((await call(LAN, "GET", "/remote")).status).toBe(200);
});

test("revoking a device ends its access at once; the code can be rotated; devices are listed for the console", async () => {
  const { call, pair, admin } = await rig();
  const a = await pair("Coach Dana"), b = await pair("Scorekeeper", "192.168.1.51");
  const list = (await admin("GET", "/status")).body;
  expect(list.devices.map((d: any) => d.name)).toEqual(["Coach Dana", "Scorekeeper"]);
  expect(JSON.stringify(list)).not.toContain("tokenHash");
  expect((await admin("DELETE", "/devices/" + a.id)).status).toBe(200);
  expect((await call(LAN, "GET", "/api/state", undefined, a.cookie)).status).toBe(401);
  expect((await call(LAN, "POST", "/api/event", { type: "clock.start" }, a.cookie)).status).toBe(401);
  expect((await call("192.168.1.51", "GET", "/api/state", undefined, b.cookie)).status).toBe(200);
  expect((await admin("DELETE", "/devices/" + a.id)).status).toBe(404);
  const old = (await admin("GET", "/status")).body.code;
  const rotated = (await admin("POST", "/code/rotate")).body.code;
  expect(rotated).not.toBe(old); expect(rotated).toMatch(/^[A-Z]+-\d{4}$/);
  expect((await call("192.168.1.60", "POST", "/api/remote/pair", { code: old, name: "late" })).status).toBe(401);
  expect((await call("192.168.1.60", "POST", "/api/remote/pair", { code: rotated, name: "ok" })).status).toBe(200);
});

test("approval mode (code not required): the phone waits, the console allows or denies", async () => {
  const { call, admin } = await rig({ requireCode: false });
  const ask = await call(LAN, "POST", "/api/remote/pair", { name: "Coach's iPhone" });
  expect(ask.status).toBe(202); expect(ask.body.requestId).toBeTruthy(); expect(ask.res.headers.get("set-cookie")).toBeNull();
  const poll = (r: any, key = r.key) => call(LAN, "POST", "/api/remote/pair", { requestId: r.requestId, key });
  expect((await poll(ask.body)).status).toBe(202);
  expect((await poll(ask.body, "wrong")).status).toBe(401); // another phone cannot collect this approval
  const st = (await admin("GET", "/status")).body;
  expect(st.pending).toHaveLength(1); expect(st.pending[0].name).toBe("Coach's iPhone");
  expect((await admin("POST", "/pending/" + st.pending[0].id, { allow: true })).status).toBe(200);
  const done = await poll(ask.body);
  expect(done.status).toBe(200); expect(done.res.headers.get("set-cookie")).toContain("fh_device=");
  expect((await admin("GET", "/status")).body.devices).toHaveLength(1);
  const no = await call(LAN, "POST", "/api/remote/pair", { name: "Stranger" });
  await admin("POST", "/pending/" + (await admin("GET", "/status")).body.pending[0].id, { allow: false });
  expect((await poll(no.body)).status).toBe(403);
  expect((await admin("GET", "/status")).body.devices).toHaveLength(1);
  for (let i = 0; i < 3; i++) await call(LAN, "POST", "/api/remote/pair", { name: "Spam" });
  expect((await call(LAN, "POST", "/api/remote/pair", { name: "Spam" })).status).toBe(429); // the console is not flooded
});

test("settings validation accepts the new remote fields and rejects bad ones", async () => {
  const { store } = await rig();
  expect(saveSettings(store, { remote: { enabled: true, port: 8099 } }).remote.port).toBe(8099);
  expect(() => saveSettings(store, { remote: { port: 80 } })).toThrow();
  expect(() => saveSettings(store, { remote: { enabled: "yes" } })).toThrow();
});

// ---------------------------------------------------------------- real sockets
test("phone-only listener: WebSocket needs a token, feeds trimmed state, and revoke closes it", async () => {
  const { remote, call, pair, admin, store } = await rig();
  saveSettings(store, { remote: { port: 18211 } });
  await remote.sync();
  const port = remote.port(); expect(port).toBe(18211);
  const base = `127.0.0.1:${port}`;
  const p = await pair();
  const open = (url: string, headers?: Record<string, string>) => new Promise<{ ws: WebSocket; msgs: any[]; closed: Promise<number>; ok: boolean }>((resolve) => {
    const ws = new WebSocket(url, headers ? ({ headers } as any) : undefined), msgs: any[] = [];
    let onClose: (c: number) => void; const closed = new Promise<number>((r) => (onClose = r));
    ws.onmessage = (m) => msgs.push(JSON.parse(String(m.data)));
    ws.onopen = () => resolve({ ws, msgs, closed, ok: true });
    ws.onerror = () => resolve({ ws, msgs, closed, ok: false });
    ws.onclose = (e) => { onClose(e.code); resolve({ ws, msgs, closed, ok: false }); };
  });
  // unauthenticated, bad token, cross-origin: refused
  expect((await open(`ws://${base}/ws`)).ok).toBe(false);
  expect((await open(`ws://${base}/ws?t=${"A".repeat(43)}`)).ok).toBe(false);
  expect((await open(`ws://${base}/ws`, { cookie: p.cookie.cookie, origin: "http://evil.example" })).ok).toBe(false);
  // the console's own feed is not reachable through the phone listener
  const raw = await fetch(`http://${base}/api/settings`, { headers: p.cookie }); expect(raw.status).toBe(403);
  // cookie and ?t= both authenticate
  const viaToken = await open(`ws://${base}/ws?t=${p.token}`); expect(viaToken.ok).toBe(true); viaToken.ws.close();
  const c = await open(`ws://${base}/ws`, p.cookie);
  expect(c.ok).toBe(true);
  await Bun.sleep(100);
  expect(c.msgs.map((m) => m.kind)).toEqual(["me", "state"]);
  expect(JSON.stringify(c.msgs)).not.toContain("WILD-4821");
  expect((await admin("GET", "/status")).body.devices[0].connected).toBe(true);
  expect(remote.summary().connected).toBe(1);
  // a score event is pushed to the phone
  const before = c.msgs.length;
  await fetch(`http://${base}/api/event`, { method: "POST", headers: { ...p.cookie, "content-type": "application/json" }, body: JSON.stringify({ type: "score", team: "away", points: 2 }) });
  remote.broadcast(); await Bun.sleep(100);
  expect(c.msgs.length).toBeGreaterThan(before);
  expect(c.msgs.at(-1).game.away.score).toBe(2);
  // revoke closes the socket immediately
  expect((await admin("DELETE", "/devices/" + p.id)).status).toBe(200);
  expect(await Promise.race([c.closed, Bun.sleep(2000).then(() => -1)])).toBe(4001);
  expect(remote.summary().connected).toBe(0);
  expect((await open(`ws://${base}/ws`, p.cookie)).ok).toBe(false);
  // turning the remote off stops the listener
  saveSettings(store, { remote: { enabled: false } });
  await remote.sync();
  expect(remote.port()).toBe(0);
  await expect(fetch(`http://${base}/remote`)).rejects.toThrow();
  void call;
});

test("port conflicts: the next free port is used and said so; all busy gives a clear error", async () => {
  const { remote, store, admin } = await rig();
  const squat = Bun.serve({ port: 18221, hostname: "0.0.0.0", fetch: () => new Response("busy") });
  try {
    saveSettings(store, { remote: { port: 18221 } });
    const s = (await admin("GET", "/status")).body;
    expect(s.running).toBe(true); expect(s.port).toBe(18222); expect(s.note).toContain("18221");
    expect(s.error).toBeUndefined();
    remote.close();
    const r2 = (await rig()); saveSettings(r2.store, { remote: { port: 18240 } });
    const squats = Array.from({ length: 10 }, (_, i) => Bun.serve({ port: 18240 + i, hostname: "0.0.0.0", fetch: () => new Response("busy") }));
    try {
      const st = (await r2.admin("GET", "/status")).body;
      expect(st.running).toBe(false); expect(st.error).toContain("18240"); expect(st.urls).toEqual([]);
    } finally { squats.forEach((x) => x.stop(true)); }
  } finally { squat.stop(true); }
});

test("REAL network: pair and score from the machine's actual LAN address", async () => {
  const ip = lanAddresses()[0];
  if (!ip) { console.log("no private LAN IPv4 on this machine: skipping the real-network test"); return; }
  const { remote, store, app, admin } = await rig();
  saveSettings(store, { remote: { port: 18231 } });
  const st = (await admin("GET", "/status")).body;
  expect(st.urls).toContain(`http://${ip}:18231/remote`);
  const base = `http://${ip}:18231`;
  // the phone page and its assets
  const page = await fetch(base + "/remote"); expect(page.status).toBe(200); expect(await page.text()).toContain("Fieldhouse Remote");
  // the operator app and API are not served here
  for (const path of ["/", "/overlay", "/api/settings", "/api/state"]) expect((await fetch(base + path)).status).toBe(path === "/api/state" ? 401 : 403);
  // wrong code, then right code
  const bad = await fetch(base + "/api/remote/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "NOPE-1", name: "Dana" }) });
  expect(bad.status).toBe(401);
  const ok = await fetch(base + "/api/remote/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "WILD-4821", name: "Dana" }) });
  expect(ok.status).toBe(200);
  const cookie = ok.headers.get("set-cookie")!.split(";")[0];
  const goal = await fetch(base + "/api/event", { method: "POST", headers: { cookie, "content-type": "application/json", origin: base }, body: JSON.stringify({ type: "score", team: "home", points: 3 }) });
  expect(goal.status).toBe(200);
  const state = await (await fetch(base + "/api/state", { headers: { cookie } })).json();
  expect(state.game.home.score).toBe(3);
  expect((await app.handle(new Request("http://x/api/state")).then((r) => r.json())).game.home.score).toBe(3); // the console sees it
  expect((await fetch(base + "/api/settings", { headers: { cookie } })).status).toBe(403);
  void remote;
});
