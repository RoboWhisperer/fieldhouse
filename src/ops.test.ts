// Production-readiness pieces: playback, health history, logging, migrations/backups, retention, disk watchdog, update check.
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createApp } from "./app";
import { FakeEngine } from "./engine";
import { openStore, dailyBackup, migrate, MIGRATIONS } from "./store";
import { logTail, previewBundle, recordCrash, lastCrash, setLogDir, log, scrub } from "./diagnostics";
import { addSample, sampleEngine, lastSeries, CAP, type HealthDoc } from "./health";
import { createDiskWatch, retentionPlan, runRetention } from "./retention";
import { compareVersions, createUpdateChecker } from "./update";
import { parseRange } from "./media";
import { defaultSettings } from "./data";
import type { GameDoc, RecordingDoc } from "./types";

const root = __join(__tmpdir(), "fieldhouse-tests", "ops-test");
rmSync(root, { recursive: true, force: true });
mkdirSync(`${root}/rec/highlights`, { recursive: true });
const mp4 = `${root}/rec/g1.mp4`;
const HAS_FFMPEG = !!Bun.which("ffmpeg") && !!Bun.which("ffprobe");
const ff = !HAS_FFMPEG ? { exitCode: 0 } : Bun.spawnSync(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=160x90:rate=10", "-t", "2", "-pix_fmt", "yuv420p", mp4]);
if (!HAS_FFMPEG) writeFileSync(mp4, Buffer.alloc(8192, 7)); // no ffmpeg here: the range tests only need bytes, not decodable video
const engine = new FakeEngine();
afterAll(() => engine.close());

test.skipIf(!HAS_FFMPEG)("ffmpeg test file exists", () => { expect(ff.exitCode).toBe(0); });

// ---------------------------------------------------------------- playback
const store = openStore(":memory:");
const app = createApp({ store, engine });
const size = readFileSync(mp4).length;
store.put("recording", { id: "r1", gameId: "g1", file: mp4, startedAt: 1, endedAt: 2, bytes: size, exported: false } satisfies RecordingDoc);
store.put("recording", { id: "bad", gameId: "g1", file: `${root}/rec/missing.mp4`, startedAt: 1, bytes: 0, exported: false } satisfies RecordingDoc);
app.store.put("settings", { id: "main", ...defaultSettings(), storageDir: `${root}/rec` });
const get = (path: string, headers: Record<string, string> = {}, method = "GET") => app.rec(new Request("http://localhost:8080" + path, { method, headers }));

test("GET /rec/:id serves the whole file with type and range support advertised", async () => {
  const r = await get("/rec/r1");
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type")).toBe("video/mp4");
  expect(r.headers.get("accept-ranges")).toBe("bytes");
  expect((await r.arrayBuffer()).byteLength).toBe(size);
});
test("range requests: 206 slices, open ended, suffix, 416", async () => {
  const full = new Uint8Array(readFileSync(mp4));
  const a = await get("/rec/r1", { range: "bytes=10-19" });
  expect(a.status).toBe(206);
  expect(a.headers.get("content-range")).toBe(`bytes 10-19/${size}`);
  expect(new Uint8Array(await a.arrayBuffer())).toEqual(full.slice(10, 20));
  const b = await get("/rec/r1", { range: "bytes=100-" });
  expect(b.headers.get("content-range")).toBe(`bytes 100-${size - 1}/${size}`);
  expect((await b.arrayBuffer()).byteLength).toBe(size - 100);
  const c = await get("/rec/r1", { range: "bytes=-50" });
  expect(c.status).toBe(206);
  expect(new Uint8Array(await c.arrayBuffer())).toEqual(full.slice(size - 50));
  const d = await get("/rec/r1", { range: `bytes=${size}-` });
  expect(d.status).toBe(416);
  expect(d.headers.get("content-range")).toBe(`bytes */${size}`);
  expect((await get("/rec/r1", { range: "bytes=20-10" })).status).toBe(416);
  expect((await get("/rec/r1", { range: "garbage" })).status).toBe(416);
  expect((await get("/rec/r1", {}, "HEAD")).headers.get("content-length")).toBe(String(size));
  expect(parseRange("bytes=0-99999999", 10)).toEqual([0, 9]);
});
test("download flag sets attachment; unknown ids, missing files, traversal and directories are 404", async () => {
  expect((await get("/rec/r1?download=1")).headers.get("content-disposition")).toContain("attachment");
  for (const p of ["/rec/nope", "/rec/bad", "/rec/", "/rec/..%2F..%2Fetc%2Fpasswd", "/rec/%2Fetc%2Fpasswd", "/rec/highlights-..%2F..%2Fg1", "/rec/highlights-g1", "/rec/highlights-"]) expect((await get(p)).status).toBe(404);
  expect((await get("/rec/r1", {}, "POST")).status).toBe(405);
});
test("highlights export is served from storageDir/highlights only; symlinks that escape are refused", async () => {
  writeFileSync(`${root}/rec/highlights/g1-highlights.mp4`, "HL");
  const r = await get("/rec/highlights-g1");
  expect(r.status).toBe(200);
  expect(await r.text()).toBe("HL");
  writeFileSync(`${root}/secret.txt`, "no");
  symlinkSync(`${root}/secret.txt`, `${root}/rec/highlights/g2-highlights.mp4`);
  expect((await get("/rec/highlights-g2")).status).toBe(404);
});

// ---------------------------------------------------------------- health history
const eng = (live: boolean, kbps = 6000, dropped = 0, disk = 5e10) => ({ stream: { live, kbps, droppedFrames: dropped }, record: { active: false }, cpu: 33.4, diskFreeBytes: disk }) as any;
test("samples only while live or recording, and keeps real values", () => {
  const s = openStore(":memory:");
  expect(sampleEngine(s, "g1", eng(false), 1)).toBe(false);
  expect(sampleEngine(s, "g1", eng(true, 5800, 3), 1000)).toBe(true);
  expect(sampleEngine(s, "g1", { ...eng(false), record: { active: true } }, 6000)).toBe(true);
  const series = lastSeries(s, () => "Hawks")!;
  expect(series).toMatchObject({ gameId: "g1", title: "Hawks", intervalSec: 5, droppedFrames: 0 });
  expect(series.samples[0]).toEqual({ t: 1000, kbps: 5800, dropped: 3, cpu: 33, diskFree: 5e10 });
  expect(lastSeries(openStore(":memory:"), () => undefined)).toBeNull();
});
test("series is capped by thinning, keeps first and last coverage and bitrate dips", () => {
  const doc: HealthDoc = { id: "g", gameId: "g", every: 1, ticks: 0, samples: [] };
  for (let i = 0; i < 5000; i++) addSample(doc, { t: i * 5000, kbps: i === 2501 ? 100 : 6000, dropped: i, cpu: 30, diskFree: 1 });
  expect(doc.samples.length).toBeLessThanOrEqual(CAP);
  expect(doc.every).toBeGreaterThan(1);
  expect(doc.samples[0].t).toBe(0);
  expect(doc.samples.at(-1)!.t).toBeGreaterThan(4000 * 5000 - doc.every * 5000 * 2);
  expect(Math.min(...doc.samples.map((x) => x.kbps))).toBe(100);
});
test("diagnostics API exposes series; empty when no data", async () => {
  const a = createApp({ store: openStore(":memory:"), engine });
  const call = async () => (await (await a.handle(new Request("http://localhost/api/diagnostics"))).json()) as any;
  expect((await call()).series).toBeNull();
  a.store.put("health", { id: "g", gameId: "g", every: 1, ticks: 1, samples: [{ t: 1, kbps: 1, dropped: 0, cpu: 1, diskFree: 1 }] });
  expect((await call()).series.samples.length).toBe(1);
});

// ---------------------------------------------------------------- logging + crash safety
test("log files rotate at the size cap, keep 5 files, carry ISO time and level, and hide secrets", () => {
  const dir = `${root}/logs`;
  setLogDir(dir, 400);
  for (let i = 0; i < 200; i++) log(i % 50 === 0 ? "ERROR" : "INFO", `line ${i} key=SUPERSECRET rtmp://a.example.com/live2/STREAMKEY`);
  const files = readdirSync(dir).filter((f) => f.startsWith("fieldhouse.log"));
  expect(files.length).toBeLessThanOrEqual(5);
  expect(files).toContain("fieldhouse.log.1");
  const tail = logTail(5);
  expect(tail.length).toBe(5);
  expect(tail.at(-1)).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z INFO line 199/);
  const all = files.map((f) => readFileSync(`${dir}/${f}`, "utf8")).join("");
  expect(all).not.toContain("SUPERSECRET");
  expect(all).not.toContain("STREAMKEY");
  expect(scrub("password: hunter2 and token=abc")).toBe("password: [hidden] and token=[hidden]");
  setLogDir(null);
});
test("crashes are remembered and land in the bundle (redacted)", () => {
  const dir = `${root}/logs2`;
  setLogDir(dir);
  expect(lastCrash()).toBeNull();
  const c = recordCrash("uncaughtException", new Error("boom key=KEY123"));
  expect(lastCrash()).toMatchObject({ kind: "uncaughtException", message: "boom key=[hidden]" });
  expect(c.stack).not.toContain("KEY123");
  const b = JSON.stringify(previewBundle({ settings: defaultSettings(), engine: { engine: "fake" } as any, destinations: [] }));
  expect(b).toContain("boom");
  expect(b).toContain("logTail");
  expect(b).not.toContain("KEY123");
  setLogDir(null);
});

// ---------------------------------------------------------------- migrations + backup
test("a v0 database (pre-versioning) is upgraded in place, data intact; newer databases are refused", () => {
  const path = `${root}/v0.db`;
  const old = new Database(path);
  old.run("CREATE TABLE docs (kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (kind, id))");
  old.run("CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, game TEXT NOT NULL, t INTEGER NOT NULL, body TEXT NOT NULL)");
  old.run(`INSERT INTO docs VALUES ('venue','v','{"id":"v","name":"Old gym"}')`);
  expect((old.query("PRAGMA user_version").get() as any).user_version).toBe(0);
  old.close();
  const s = openStore(path);
  expect(s.version()).toBe(MIGRATIONS.length);
  expect(s.get<any>("venue", "v").name).toBe("Old gym");
  s.close();
  expect(openStore(path).version()).toBe(MIGRATIONS.length); // reopening is a no-op
  const fresh = openStore(":memory:");
  expect(fresh.version()).toBe(1);
  const db = new Database(":memory:");
  db.run("PRAGMA user_version = 99");
  expect(() => migrate(db)).toThrow("newer version");
});
test("migrations run in order exactly once", () => {
  const db = new Database(":memory:"), ran: number[] = [];
  const ms = [() => ran.push(1), () => ran.push(2), () => ran.push(3)] as any;
  migrate(db, ms.slice(0, 2)); migrate(db, ms); migrate(db, ms);
  expect(ran).toEqual([1, 2, 3]);
  expect((db.query("PRAGMA user_version").get() as any).user_version).toBe(3);
});
test("daily backup is a consistent copy under WAL, once per day, newest 7 kept", () => {
  const path = `${root}/live.db`, dir = `${root}/backups`;
  const s = openStore(path);
  s.put("venue", { id: "a", name: "Gym" } as any); // sits in the WAL, not yet in the main file
  const day = Date.parse("2026-10-01T12:00:00Z");
  const f = dailyBackup(s, dir, day)!;
  expect(f).toContain("fieldhouse-2026-10-01.db");
  expect(dailyBackup(s, dir, day + 3600_000)).toBeNull();
  const copy = openStore(f);
  expect(copy.get<any>("venue", "a").name).toBe("Gym");
  copy.close();
  for (let i = 2; i <= 10; i++) dailyBackup(s, dir, day + (i - 1) * 86_400_000);
  const left = readdirSync(dir).filter((x) => x.endsWith(".db")).sort();
  expect(left.length).toBe(7);
  expect(left[0]).toBe("fieldhouse-2026-10-04.db");
  expect(left.at(-1)).toBe("fieldhouse-2026-10-10.db");
});

// ---------------------------------------------------------------- retention
const DAY = 86_400_000, NOW = Date.parse("2026-10-05T00:00:00Z");
function seed(s: ReturnType<typeof openStore>, id: string, o: { ageDays: number; exported?: boolean; status?: GameDoc["status"]; ended?: boolean; dir?: string }) {
  const dir = o.dir ?? `${root}/ret`; mkdirSync(dir, { recursive: true });
  const file = `${dir}/${id}.mp4`; writeFileSync(file, "x".repeat(10));
  s.put("game", { id: `game-${id}`, status: o.status ?? "final" } as any);
  s.put("recording", { id, gameId: `game-${id}`, file, startedAt: NOW - o.ageDays * DAY - 3600_000, endedAt: o.ended === false ? undefined : NOW - o.ageDays * DAY, bytes: 10, exported: !!o.exported } satisfies RecordingDoc);
  return file;
}
test("retention: only final, old, exported (or twice as old) recordings, inside the storage dir, never the active game", () => {
  const s = openStore(":memory:");
  const st = { retention: "90d" as const, storageDir: `${root}/ret`, activeGameId: "game-active" };
  seed(s, "fresh", { ageDays: 10, exported: true });
  seed(s, "oldExported", { ageDays: 100, exported: true });
  seed(s, "oldNotExported", { ageDays: 100 });
  seed(s, "veryOld", { ageDays: 181 });
  seed(s, "active", { ageDays: 400, exported: true });
  seed(s, "live", { ageDays: 400, exported: true, status: "live" });
  seed(s, "sched", { ageDays: 400, exported: true, status: "scheduled" });
  seed(s, "recording", { ageDays: 400, exported: true, ended: false });
  const outside = seed(s, "outside", { ageDays: 400, exported: true, dir: `${root}/elsewhere` });
  writeFileSync(`${root}/ret/ghost.mp4`, "x");
  s.put("recording", { id: "nogame", gameId: "ghost", file: `${root}/ret/ghost.mp4`, startedAt: 1, endedAt: 2, bytes: 1, exported: true }); // its game does not exist: kept
  const plan = retentionPlan(s, st, NOW).map((c) => c.id).sort();
  expect(plan).toEqual(["oldExported", "veryOld"]);
  expect(existsSync(`${root}/ret/oldExported.mp4`)).toBe(true); // dry run deleted nothing
  expect(retentionPlan(s, { ...st, retention: "never" }, NOW)).toEqual([]);
  const done = runRetention(s, st, NOW).map((c) => c.id).sort();
  expect(done).toEqual(plan);
  expect(existsSync(`${root}/ret/oldExported.mp4`)).toBe(false);
  expect(existsSync(`${root}/ret/veryOld.mp4`)).toBe(false);
  for (const keep of ["fresh", "oldNotExported", "active", "live", "sched", "recording"]) expect(existsSync(`${root}/ret/${keep}.mp4`)).toBe(true);
  expect(existsSync(outside)).toBe(true);
  expect(s.get("recording", "oldExported")).toBeUndefined();
  expect(retentionPlan(s, { ...st, retention: "season" }, NOW).map((c) => c.id)).toEqual([]); // 400-day files are kept: those games are active/live/outside
});
test("retention at startup reports through a notice and the log", () => {
  const s = openStore(":memory:");
  seed(s, "old1", { ageDays: 120, exported: true, dir: `${root}/ret2` });
  s.put("settings", { id: "main", ...defaultSettings(), storageDir: `${root}/ret2`, retention: "90d" });
  const a = createApp({ store: s, engine, now: () => NOW });
  expect(a.state().notices.at(-1)!.message).toContain("Removed 1 old recording");
  expect(existsSync(`${root}/ret2/old1.mp4`)).toBe(false);
  a.stop();
});

// ---------------------------------------------------------------- disk watchdog
test("disk watch fires once per crossing, only while broadcasting", () => {
  const w = createDiskWatch();
  expect(w(1e9, 40, false)).toBeNull();
  expect(w(1e9, 40, true)).toBe("low");
  expect(w(1e9, 40, true)).toBeNull();
  expect(w(0, 40, true)).toBeNull(); // unknown reading
  expect(w(50e9, 40, true)).toBe("recovered");
  expect(w(1e9, 40, true)).toBe("low");
});
test("low disk during a broadcast reaches state.notices once", () => {
  const e = new FakeEngine();
  let free = 100e9, live = true;
  const real = e.status.bind(e);
  e.status = () => ({ ...real(), diskFreeBytes: free, record: { active: live, bytes: 0 } });
  const st = openStore(":memory:");
  st.put("settings", { id: "main", ...defaultSettings(), lowSpaceGb: 40 });
  const a = createApp({ store: st, engine: e });
  a.tick(); free = 5e9; a.tick(); a.tick();
  const low = () => a.state().notices.filter((n) => n.level === "warn" && n.message.includes("space is low"));
  expect(low().length).toBe(1);
  expect(a.state().engine.diskFreeBytes).toBeLessThan(a.state().settings.lowSpaceGb * 1e9); // what the console recovery banner reads
  free = 100e9; a.tick();
  expect(a.state().notices.at(-1)!.message).toContain("back above");
  free = 5e9; live = false; a.tick(); // not broadcasting: no new warning
  expect(low().length).toBe(1);
  e.close(); a.stop();
});

// ---------------------------------------------------------------- update check
const rel = (tag: string) => ({ tag_name: tag, html_url: `https://github.com/o/r/releases/tag/${tag}`, body: "notes" });
const mock = (impl: (url: string, init?: RequestInit) => Response | Promise<Response>) => { const calls: [string, RequestInit | undefined][] = []; const f = (async (u: any, i: any) => { calls.push([String(u), i]); return impl(String(u), i); }) as unknown as typeof fetch; return { f, calls }; };
test("semver compare handles prereleases and short versions", () => {
  expect(compareVersions("1.0 beta", "v1.0.0")).toBe(-1);
  expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  expect(compareVersions("1.2.0", "1.10.0")).toBe(-1);
  expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
  expect(compareVersions("1.0.0-beta.1", "1.0.0-beta.2")).toBe(-1);
  expect(compareVersions("1.0.0", "1.0.0-rc1")).toBe(1);
});
test("update check: available, current, cached 6h, forced, anonymous request", async () => {
  let t = 1_000_000;
  const m = mock(() => Response.json(rel("v1.1.0")));
  const check = createUpdateChecker({ current: "1.0 beta", fetch: m.f, now: () => t, repo: "o/r" });
  const r = await check();
  expect(r).toMatchObject({ status: "available", latest: "1.1.0", url: "https://github.com/o/r/releases/tag/v1.1.0" });
  expect(m.calls[0][0]).toBe("https://api.github.com/repos/o/r/releases/latest");
  const h = m.calls[0][1]!.headers as Record<string, string>;
  expect(Object.keys(h).sort()).toEqual(["accept", "user-agent"]); // no cookies, tokens, ids
  expect(m.calls[0][1]!.signal).toBeTruthy();
  t += 5 * 3600_000; await check(); expect(m.calls.length).toBe(1);
  t += 2 * 3600_000; await check(); expect(m.calls.length).toBe(2); // past 6 h
  t += 20_000; await check(true); expect(m.calls.length).toBe(3);
  t += 1000; await check(true); expect(m.calls.length).toBe(3); // forced checks are still rate limited
  const same = createUpdateChecker({ current: "1.1.0", fetch: mock(() => Response.json(rel("v1.1.0"))).f, repo: "o/r" });
  expect((await same()).status).toBe("current");
});
test("update check fails quietly: offline, timeout, 404, 500, junk, bad repo", async () => {
  const run = async (impl: () => Response | Promise<Response>, repo = "o/r") => createUpdateChecker({ current: "1.0", fetch: mock(impl).f, repo })();
  expect(await run(() => { throw new TypeError("fetch failed"); })).toMatchObject({ status: "unavailable", reason: "offline" });
  expect(await run(() => { throw new DOMException("timed out", "TimeoutError"); })).toMatchObject({ reason: "offline" });
  expect(await run(() => new Response("", { status: 404 }))).toMatchObject({ reason: "no-release" });
  expect(await run(() => new Response("", { status: 500 }))).toMatchObject({ reason: "error" });
  expect(await run(() => new Response("<html>", { status: 200 }))).toMatchObject({ status: "unavailable" });
  expect(await run(() => Response.json({}))).toMatchObject({ reason: "error" });
  expect(await run(() => Response.json(rel("v9")), "../../evil")).toMatchObject({ reason: "error" });
  const evil = await run(() => Response.json({ tag_name: "v9.0.0", html_url: "https://evil.example/x" }));
  expect((evil as any).url).toBe("https://github.com/o/r/releases");
});
test("GET /api/update uses the injected fetch and the app version", async () => {
  const a = createApp({ store: openStore(":memory:"), engine, fetch: mock(() => Response.json(rel("v2.0.0"))).f });
  const r: any = await (await a.handle(new Request("http://localhost/api/update"))).json();
  expect(r.status).toBe("available");
  a.stop();
});

// ---------------------------------------------------------------- demo gate
test("POST /demo: allowed on an empty database, refused once games exist unless DEMO=1", async () => {
  const post = (a: ReturnType<typeof createApp>) => a.handle(new Request("http://localhost/api/demo", { method: "POST" }));
  const a = createApp({ store: openStore(":memory:"), engine, demo: false });
  expect((await post(a)).status).toBe(200);
  expect((await post(a)).status).toBe(403);
  const b = createApp({ store: a.store, engine, demo: true });
  expect((await post(b)).status).toBe(200);
  const clean = createApp({ store: openStore(":memory:"), engine, demo: false });
  expect((await (await clean.handle(new Request("http://localhost/api/games"))).json())).toEqual([]);
  a.stop(); b.stop(); clean.stop();
});

// ---------------------------------------------------------------- process-level crash handlers (real subprocess)
test("uncaught exceptions and rejections are logged and the process keeps running", async () => {
  const dir = `${root}/crashproc`;
  const script = `import { setLogDir, installCrashHandlers } from "${import.meta.dir}/diagnostics";
    setLogDir("${dir}"); installCrashHandlers();
    setTimeout(() => { throw new Error("late boom password=hunter2"); }, 10);
    setTimeout(() => { Promise.reject(new Error("lost promise")); }, 30);
    setTimeout(() => { console.log("STILL ALIVE"); }, 150);`;
  const p = Bun.spawn(["bun", "-e", script], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(p.stdout).text();
  await p.exited;
  expect(out).toContain("STILL ALIVE");
  expect(p.exitCode).toBe(0);
  const log = readFileSync(`${dir}/fieldhouse.log`, "utf8");
  expect(log).toContain("uncaughtException: late boom password=[hidden]");
  expect(log).toContain("unhandledRejection: lost promise");
  expect(log).not.toContain("hunter2");
  expect(JSON.parse(readFileSync(`${dir}/last-crash.json`, "utf8")).kind).toBe("unhandledRejection");
});

test("pre-release precedence is numeric per part and the current version is a valid semver", async () => {
  const { compareVersions } = await import("./update");
  const { VERSION } = await import("./app");
  expect(VERSION).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
  expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.10")).toBe(-1);
  expect(compareVersions("1.0.0-beta.10", "1.0.0-beta.2")).toBe(1);
  expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBe(-1);
  expect(compareVersions("1.0.0-beta.1", "1.0.0-beta.1")).toBe(0);
  expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
  expect(compareVersions("1.0.0-beta.1", "1.0.1")).toBe(-1);
});
