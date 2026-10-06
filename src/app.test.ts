import { afterAll, expect, test } from "bun:test";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app";
import { seedDemo } from "./data";
import { FakeEngine } from "./engine";
import { openStore } from "./store";

// One app, one game night, driven only through HTTP-shaped requests.
const dir = (mkdirSync(__join(__tmpdir(), "fieldhouse-tests"), { recursive: true }), mkdtempSync(__join(__tmpdir(), "fieldhouse-tests", "app-")));
const store = openStore(":memory:");
const engine = new FakeEngine();
const app = createApp({ store, engine });
seedDemo(store);
const req = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const r = await app.handle(new Request("http://localhost:8080/api" + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers } }));
  return { status: r.status, body: r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text() } as { status: number; body: any };
};
afterAll(() => engine.close());

test("a full game night", async () => {
  await req("PUT", "/settings", { storageDir: dir });
  const games = (await req("GET", "/games")).body;
  const tonight = games.find((g: any) => g.status === "scheduled");
  expect(tonight).toBeTruthy();

  expect((await req("POST", "/event", { type: "score", team: "home", points: 2 })).status).toBe(409); // no active game yet
  expect((await req("POST", `/games/${tonight.id}/activate`)).status).toBe(200);

  const pf = (await req("POST", "/preflight")).body;
  expect(Array.isArray(pf) && pf.length > 3).toBe(true);
  expect(pf.every((c: any) => ["ok", "warn", "err"].includes(c.status))).toBe(true);

  expect((await req("POST", "/broadcast/start")).status).toBe(200);
  const live = (await req("GET", "/state")).body;
  expect(live.engine.record.active).toBe(true);
  expect(live.recording.file).toContain(dir);

  await req("POST", "/event", { type: "clock.start" });
  await req("POST", "/event", { type: "score", team: "home", points: 3, player: 12 });
  await req("POST", "/event", { type: "score", team: "away", points: 2 });
  await req("POST", "/event", { type: "foul", team: "away" });
  expect((await req("POST", "/event", { type: "undo" })).body.target).toBeGreaterThan(0); // undoes the foul
  expect((await req("POST", "/event", { type: "score", team: "home", points: 9 })).status).toBe(400);
  let st = (await req("GET", "/state")).body;
  expect([st.game.home.score, st.game.away.score, st.game.away.fouls]).toEqual([3, 2, 0]);

  // sponsor break: next is due at a timeout, firing records proof of play and shows the graphic
  await req("POST", "/event", { type: "timeout", team: "away" });
  st = (await req("GET", "/state")).body;
  expect(st.next?.name).toBeTruthy();
  const aired = await req("POST", "/sponsors/fire", {});
  expect(aired.body.outcome).toBe("aired");
  expect((await req("GET", "/state")).body.graphics.sponsor.name).toBe(st.next.name);
  const rows = (await req("GET", `/reports/airings?gameId=${tonight.id}`)).body;
  expect(rows.rows).toHaveLength(1);
  expect((await req("GET", `/reports/airings.csv?gameId=${tonight.id}`)).body).toContain(st.next.name);

  // lower third auto-clears; engine controls work
  expect((await req("POST", "/graphics", { lower: { title: "#12 Reyes", sub: "Guard" } })).body.lower.title).toBe("#12 Reyes");
  const before = (await req("GET", "/state")).body.engine;
  await req("POST", "/engine/cut");
  const after = (await req("GET", "/state")).body.engine;
  expect([after.program, after.preview]).toEqual([before.preview, before.program]);

  // wait for ~2 s of real recording, then wrap up and cut highlights from the score event
  await new Promise((r) => setTimeout(r, 2500));
  const fin = await req("POST", `/games/${tonight.id}/finish`);
  expect(fin.body.status).toBe("final");
  expect(fin.body.finalScore).toEqual({ home: 3, away: 2 });
  const hl = (await req("GET", `/highlights/${tonight.id}`)).body;
  expect(hl.clips.length).toBeGreaterThan(0);
  if (!Bun.which("ffmpeg")) return; // the fake engine writes a real recording, and highlights are cut, only when ffmpeg exists
  expect(hl.recording.bytes).toBeGreaterThan(0);
  const ex = await req("POST", `/highlights/${tonight.id}/export`, { indexes: [0] }); // fresh storage dir: must create highlights/ itself
  expect(ex.status).toBe(200);
  expect(ex.body.bytes).toBeGreaterThan(0);
});

test("security and validation guards", async () => {
  const cross = await app.handle(new Request("http://localhost:8080/api/event", { method: "POST", body: "{}", headers: { origin: "http://evil.example", "content-type": "application/json" } }));
  expect(cross.status).toBe(403);
  const plain = await app.handle(new Request("http://localhost:8080/api/event", { method: "POST", body: '{"type":"mark"}' })); // text/plain "simple request" CSRF shape
  expect(plain.status).toBe(415);
  expect((await req("GET", "/nope")).status).toBe(404);
  const dests = (await req("GET", "/destinations")).body;
  expect(JSON.stringify(dests)).not.toContain("demo-key"); // stream keys never leave the server
  expect((await req("PUT", "/settings", { telemetry: "yes" })).status).toBe(400);
});

test("the OBS overlay depends on no fonts (OBS's embedded browser has no monospace and does not load web fonts)", async () => {
  const html = await Bun.file(__join(import.meta.dir, "overlay.html")).text();
  expect(html).not.toContain("@font-face");
  expect(html).not.toMatch(/font[^;{}]*monospace/i);
  expect(html).toMatch(/seven-segment/i); // the clock is drawn as SVG
});

test("video settings routes: validate, save, apply, read back; locked while live; never leak secrets", async () => {
  const e2 = new FakeEngine(), a2 = createApp({ store: openStore(":memory:"), engine: e2 });
  const r = async (m: string, p: string, b?: unknown) => { const x = await a2.handle(new Request("http://localhost:8080/api" + p, { method: m, body: b ? JSON.stringify(b) : undefined, headers: b ? { "content-type": "application/json" } : {} })); return { status: x.status, body: await x.json() as any }; };
  expect((await r("GET", "/engine/video")).body).toMatchObject({ settings: { resolution: "720p" }, live: false, differences: [] });
  const ok = await r("PUT", "/engine/video", { resolution: "1080p", fps: 60, videoKbps: 6000 });
  expect(ok.status).toBe(200);
  expect(ok.body).toMatchObject({ settings: { resolution: "1080p", fps: 60, videoKbps: 6000 }, applied: { outputHeight: 1080, fps: 60 }, differences: [] });
  expect((await r("PUT", "/engine/video", { videoKbps: 10 })).body.error).toContain("between 1000 and 20000");
  expect((await r("PUT", "/engine/video", { encoder: "nvenc" })).status).toBe(400); // not offered by this engine
  await e2.startRecord(dir, "locked");
  const blocked = await r("PUT", "/engine/video", { resolution: "720p" });
  expect(blocked.status).toBe(409); expect(blocked.body.error).toContain("cannot be changed during a broadcast");
  expect((await r("PUT", "/engine/video", { videoKbps: 2500 })).status).toBe(200); // allowed while live, applied later
  await e2.stopRecord();
  const audio = await r("POST", "/engine/audio", { role: "mic", label: "Crowd", deviceId: "audio-scarlett" });
  expect(audio.body).toMatchObject({ id: "audio-2", label: "Crowd" });
  expect((await r("PUT", "/engine/audio/audio-2", { gainDb: 99 })).status).toBe(400);
  expect((await r("PUT", "/engine/audio/audio-2", { label: "Room", muted: true })).body).toMatchObject({ label: "Room", muted: true });
  expect((await r("GET", "/engine/audio")).body.inputs.map((i: any) => i.id)).toContain("audio-2");
  expect((await r("DELETE", "/engine/audio/audio-2")).status).toBe(200);
  expect((await r("GET", "/slots/1/settings")).body).toMatchObject({ type: "camera" });
  expect((await r("POST", "/slots/1/settings", { reconnectSeconds: "x" })).status).toBe(400);
  expect(JSON.stringify((await r("GET", "/state")).body)).not.toMatch(/obsPassword"/);
  e2.close();
});

test("a lost video engine mid-broadcast becomes a clear notice and closes the recording record", async () => {
  const st = openStore(":memory:"), e3 = new FakeEngine(); seedDemo(st);
  const a3 = createApp({ store: st, engine: e3 });
  const base = e3.status.bind(e3); let lost: any;
  (e3 as any).status = () => { const s = base(); if (lost) s.obs = { provisioned: false, replayBuffer: false, created: [], notes: [], lost }; return s; };
  st.put("recording", { id: "r1", gameId: "g", file: "/nope", startedAt: 1, bytes: 0, exported: false });
  lost = { at: 123, stream: true, record: true };
  (e3 as any).simulate("disk-restore"); // any engine change event
  await Bun.sleep(30);
  const state = a3.state();
  expect(state.notices.at(-1)!.message).toContain("video engine stopped during the broadcast");
  expect(state.notices.at(-1)!.message).toContain("press Start broadcast again");
  expect(st.list<any>("recording").find((r) => r.id === "r1").endedAt).toBeTruthy();
  e3.close(); a3.stop();
});

test("go-live with the real engine refuses an unreachable destination BEFORE recording starts; the Test button uses the same check", async () => {
  const st = openStore(":memory:"), e4 = new FakeEngine(); seedDemo(st);
  const base = e4.status.bind(e4); (e4 as any).status = () => ({ ...base(), engine: "obs" });
  const a4 = createApp({ store: st, engine: e4, checkDestination: async (u) => ({ ok: !u.includes("down"), message: u.includes("down") ? "Nothing answered." : "ok" }) });
  const r = async (m: string, p: string, b?: unknown) => { const x = await a4.handle(new Request("http://localhost:8080/api" + p, { method: m, body: b ? JSON.stringify(b) : undefined, headers: b ? { "content-type": "application/json" } : {} })); return { status: x.status, body: await x.json() as any }; };
  const g = (await r("GET", "/games")).body.find((x: any) => x.status === "scheduled");
  const d = (await r("POST", "/destinations", { kind: "rtmp", name: "Down", url: "rtmp://down.example/live", key: "k", enabled: true })).body;
  await r("PUT", "/games/" + g.id, { ...g, destinationIds: [d.id] });
  await r("POST", `/games/${g.id}/activate`);
  const res = await r("POST", "/broadcast/start");
  expect(res.status).toBe(400); expect(res.body.error).toContain("Down: Nothing answered.");
  expect(e4.status().record.active).toBe(false);
  expect((await r("POST", `/destinations/${d.id}/test`)).body).toMatchObject({ ok: false, message: "Nothing answered." });
  e4.close(); a4.stop();
});
