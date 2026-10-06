import { afterAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app";
import { seedDemo } from "./data";
import { FakeEngine } from "./engine";
import { openStore } from "./store";

// One app, one game night, driven only through HTTP-shaped requests.
const dir = mkdtempSync(join("/tmp/claude-1000/-home-noah-Projects-Fieldhouse/", "app-"));
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
  expect(hl.recording.bytes).toBeGreaterThan(0);
  expect(hl.clips.length).toBeGreaterThan(0);
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
  const html = await Bun.file(new URL("./overlay.html", import.meta.url)).text();
  expect(html).not.toContain("@font-face");
  expect(html).not.toMatch(/font[^;{}]*monospace/i);
  expect(html).toMatch(/seven-segment/i); // the clock is drawn as SVG
});
