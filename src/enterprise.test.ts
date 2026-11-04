import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app";
import { addAudit } from "./audit";
import { seedDemo } from "./data";
import { FakeEngine } from "./engine";
import { openStore } from "./store";

const dir = mkdtempSync(join(tmpdir(), "fieldhouse-enterprise-"));
const store = openStore(":memory:");
const engine = new FakeEngine();
const app = createApp({ store, engine });
seedDemo(store);
afterAll(() => { app.stop(); engine.close(); });

const req = async (method: string, path: string, body?: unknown) => {
  const r = await app.handle(new Request("http://localhost:8080/api" + path, { method, body: body ? JSON.stringify(body) : undefined, headers: body ? { "content-type": "application/json" } : {} }));
  return { status: r.status, headers: r.headers, body: r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text() } as { status: number; headers: Headers; body: any };
};

test("deleting an upcoming game removes its events, airings, health and active pointer, and writes an audit entry", async () => {
  await req("PUT", "/settings", { storageDir: dir });
  const g = (await req("GET", "/games")).body.find((x: any) => x.status === "scheduled");
  expect((await req("POST", `/games/${g.id}/activate`)).status).toBe(200);
  store.put("airing", { id: "air-delete", gameId: g.id, sponsorId: "s", at: Date.now(), period: 1, gameClockMs: 0, trigger: "timeout", outcome: "aired", seconds: 15 });
  store.put("health", { id: g.id, gameId: g.id, every: 1, ticks: 1, samples: [] });

  const out = await req("DELETE", `/games/${g.id}`);
  expect(out.status).toBe(200);
  expect(out.body.deleted).toMatchObject({ events: 1, airings: 1, wasActive: true });
  expect((await req("GET", "/games")).body.some((x: any) => x.id === g.id)).toBe(false);
  expect((await req("GET", "/state")).body.gameId).toBeNull();
  expect(store.load(g.id)).toHaveLength(0);
  expect(store.list("airing").some((a: any) => a.id === "air-delete")).toBe(false);
  expect(store.get("health", g.id)).toBeUndefined();
  const audit = (await req("GET", `/audit?action=game.deleted&target=${g.id}`)).body.rows;
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({ actor: "console", target: g.id });
});

test("a live game cannot be deleted until its broadcast stops", async () => {
  const created = await req("POST", "/games", {
    title: "Deletable vs Test", startsAt: Date.now() + 3600_000,
    home: { name: "Deletable", abbr: "DEL" }, away: { name: "Test", abbr: "TST" },
  });
  const g = created.body;
  await req("POST", `/games/${g.id}/activate`);
  await req("POST", "/broadcast/start");
  const blocked = await req("DELETE", `/games/${g.id}`);
  expect(blocked.status).toBe(409);
  expect(blocked.body.error).toContain("Finish the live game");
  await req("POST", "/broadcast/stop");
  expect((await req("POST", `/games/${g.id}/finish`)).body.status).toBe("final");
  expect((await req("DELETE", `/games/${g.id}`)).status).toBe(200);
});

test("game deletion keeps recordings by default and can remove them on request", async () => {
  const keepFile = join(dir, "keep.mp4"); writeFileSync(keepFile, "keep");
  const removeFile = join(dir, "remove.mp4"); writeFileSync(removeFile, "remove");
  const games = (await req("GET", "/games")).body.filter((x: any) => x.status === "final");
  const a = games[0], b = games[1];
  store.put("recording", { id: "r-keep", gameId: a.id, file: keepFile, startedAt: 1, endedAt: 2, bytes: 4, exported: false });
  store.put("recording", { id: "r-remove", gameId: b.id, file: removeFile, startedAt: 1, endedAt: 2, bytes: 6, exported: false });

  expect((await req("DELETE", `/games/${a.id}`)).status).toBe(200);
  expect(store.get("recording", "r-keep")).toBeTruthy();
  const out = await req("DELETE", `/games/${b.id}`, { deleteRecordings: true });
  expect(out.status).toBe(200);
  expect(out.body.deleted.recordings).toBe(1);
  expect(store.get("recording", "r-remove")).toBeUndefined();
});

test("health and export are safe, useful and never carry write-only secrets", async () => {
  const health = await req("GET", "/health");
  expect(health.status).toBe(200);
  expect(health.body).toMatchObject({ status: "ok", database: { ok: true } });
  expect(health.headers.get("x-content-type-options")).toBe("nosniff");
  expect(health.headers.get("cache-control")).toBe("no-store");

  await req("POST", "/destinations", { kind: "rtmp", name: "Secret TV", url: "rtmp://secret.example/live?token=abc", key: "super-secret-key", enabled: true });
  await req("PUT", "/settings", { engine: { obsPassword: "obs-secret" }, remote: { code: "WILD-1234" } });
  store.put("device", { id: "dev-1", name: "Phone", role: "admin", createdAt: 1, lastSeen: 1, tokenHash: "hash-secret" });
  store.put("webhook", { id: "hook-1", name: "Hook", url: "https://hooks.example/path?token=hooksecret", events: ["score"], secret: "webhook-secret", enabled: true, createdAt: 1 });
  store.put("connector", { id: "conn-1", name: "Conn", kind: "http", enabled: true, config: {}, secret: "connector-secret", createdAt: 1, updatedAt: 1 });
  store.put("rule", { id: "rule-1", name: "Rule", enabled: true, priority: 1, trigger: { type: "event", event: "score" }, cooldownSec: 0, actions: [{ type: "http", method: "POST", url: "https://api.example/x?key=query-secret", headers: { authorization: "Bearer header-secret" } }], updatedAt: 1 });
  store.put("recording", { id: "r-export", gameId: "game_demo_final4", file: "/private/path/rec.mp4", startedAt: 1, endedAt: 2, bytes: 4, exported: false });

  const ex = await req("GET", "/export");
  expect(ex.status).toBe(200);
  const text = JSON.stringify(ex.body);
  for (const secret of ["super-secret-key", "obs-secret", "WILD-1234", "hash-secret", "hooksecret", "webhook-secret", "connector-secret", "query-secret", "header-secret", "/private/path/rec.mp4"]) expect(text).not.toContain(secret);
  expect(ex.body.destinations.find((d: any) => d.name === "Secret TV")).toMatchObject({ keySet: true });
  expect(ex.body.recordings.find((r: any) => r.id === "r-export").file).toBeUndefined();
  expect(ex.body.devices.find((d: any) => d.id === "dev-1").tokenHash).toBeUndefined();
  expect((await req("GET", "/audit?action=data.exported")).body.rows.length).toBeGreaterThan(0);
});

test("the audit trail redacts secret-looking text and detail keys", async () => {
  addAudit(store, { action: "test.redaction", detail: { key: "top-secret", headers: { authorization: "Bearer nope" }, note: "token=abc123" } });
  const row = (await req("GET", "/audit?action=test.redaction")).body.rows[0];
  expect(row.detail.key).toBeUndefined();
  expect(row.detail.headers).toBeUndefined();
  expect(row.detail.note).toContain("[hidden]");
  expect(JSON.stringify(row)).not.toContain("top-secret");
  expect(JSON.stringify(row)).not.toContain("nope");
  expect(JSON.stringify(row)).not.toContain("abc123");
});
