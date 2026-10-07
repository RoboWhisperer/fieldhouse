// Application layer: every route and flow, as a plain fetch handler (no port) so tests drive it directly.
// server.ts only adds the HTTP/WebSocket plumbing and static files.
import { statSync } from "node:fs";
import { join } from "node:path";
import { fold, lastUndoable, parseEv, view, type Logged } from "./game";
import type { Store } from "./store";
import type { AiringDoc, Engine, GameDoc, Graphics, RecordingDoc, Trigger } from "./types";
import * as data from "./data";
import * as sponsors from "./sponsors";
import * as reports from "./reports";
import { runChecks } from "./preflight";
import * as storage from "./storage";
import { clipsFromLog, exportHighlights } from "./highlights";
import * as diag from "./diagnostics";
import { resolveMedia, serveFile } from "./media";
import { isActive, lastSeries, sampleEngine } from "./health";
import { createDiskWatch, retentionPlan, runRetention } from "./retention";
import { createUpdateChecker } from "./update";
import { registerEngineRoutes, type EngineHooks } from "./engine-routes";
import { registerEngineSettings } from "./engine-settings";
import { registerWorkspaceSection } from "./automation/workspace";
import { createGraphics } from "./graphics";
import { graphicsSection, profilesSection } from "./graphics/workspace";
import { registerGraphicsRoutes } from "./graphics-routes";
import { paths } from "./config";
import { createAutomation } from "./automation";
import { registerAutomationRoutes } from "./automation/routes";
import type { GraphicsControl } from "./custom-types";
import { registerProfileRoutes } from "./profiles-routes";
import { BASKETBALL } from "./profiles/builtins";
import { breakTrigger, summary } from "./profiles/lib";
import { checkDestination } from "./destination-check";
import type { ObsLogWatcher } from "./obs-log";

export const VERSION = "1.0.0-beta.1";
const json = (x: unknown, status = 200) => Response.json(x, { status });
class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
const bad = (msg: string, status = 400): never => { throw new HttpError(status, msg); };

export function createApp(deps: { store: Store; engine: Engine; now?: () => number; fetch?: typeof fetch; demo?: boolean; checkDestination?: typeof checkDestination; graphicsDir?: string }) {
  const { store, engine } = deps;
  const now = deps.now ?? Date.now;
  const listeners = new Set<() => void>();
  // server.ts plugs in the phone-remote summary (src/auth.ts), the video-engine supervisor/installer and the OBS log watcher
  const hooks: { remote: () => unknown; logs?: ObsLogWatcher; graphics?: GraphicsControl } & EngineHooks = { remote: () => null };
  const changed = () => { for (const f of listeners) f(); };
  let log: Logged[] = [];
  let logGame = "";
  let recovered: { at: number } | null = null;
  let sponsorTimer: ReturnType<typeof setTimeout> | undefined;
  let lowerTimer: ReturnType<typeof setTimeout> | undefined;

  const settings = () => data.settingsView(data.getSettings(store)); // never carries the OBS password
  const activeId = () => settings().activeGameId;
  const activeGame = (): GameDoc | undefined => { const id = activeId(); return id ? data.getGame(store, id) : undefined; };
  const need = () => activeId() ?? bad("No game is active. Start a game first.", 409);
  const profileOf = (g?: GameDoc) => g?.profileSnapshot ?? BASKETBALL; // the sport rules the game was started with
  const gameLog = (): Logged[] => { const id = activeId() ?? ""; if (id !== logGame) { log = id ? store.load(id) : []; logGame = id; } return log; };

  // Crash recovery: a live game with a dangling recording means we died mid-broadcast.
  for (const r of store.list<RecordingDoc>("recording")) {
    if (!r.endedAt) { let bytes = r.bytes; try { bytes = statSync(r.file).size; } catch {} store.put("recording", { ...r, endedAt: now(), bytes }); }
  }
  { const g = activeGame(); if (g?.status === "live") recovered = { at: now() }; }
  let lastLost = 0;
  engine.onChange(() => {
    const lost = engine.status().obs?.lost;
    if (lost && lost.at !== lastLost) { // the video engine vanished mid-broadcast: say so, close the recording record, and do NOT restart anything by ourselves
      lastLost = lost.at;
      for (const r of store.list<RecordingDoc>("recording")) if (!r.endedAt) { let bytes = r.bytes; try { bytes = statSync(r.file).size; } catch {} store.put("recording", { ...r, endedAt: now(), bytes }); }
      notify("warn", `The video engine stopped during the broadcast, so ${lost.stream ? "the live stream" : ""}${lost.stream && lost.record ? " and " : ""}${lost.record ? "the recording" : ""} ended. Fieldhouse is restarting the engine; press Start broadcast again when the Check screen is green. The recording up to this point was saved.`);
    }
    changed();
  });
  data.ensureLocalRecording(store);

  // ------------------------------------------------------------ background upkeep: notices, health history, disk watchdog, retention
  const notices: { id: number; at: number; level: "info" | "warn"; message: string }[] = [];
  const notify = (level: "info" | "warn", message: string) => { notices.push({ id: (notices.at(-1)?.id ?? 0) + 1, at: now(), level, message }); if (notices.length > 20) notices.shift(); diag.log(level === "warn" ? "WARN" : "INFO", message); changed(); };
  const diskWatch = createDiskWatch();
  const checkUpdate = createUpdateChecker({ current: VERSION, fetch: deps.fetch });
  const gameTitle = (id: string) => data.getGame(store, id)?.title;
  function tick() { // every 5 s
    const e = engine.status();
    if (activeId()) sampleEngine(store, activeId()!, e, now());
    const d = diskWatch(e.diskFreeBytes, settings().lowSpaceGb, isActive(e));
    if (d === "low") notify("warn", `Recording space is low: ${(e.diskFreeBytes / 1e9).toFixed(1)} GB left. Free up space before the game ends.`);
    else if (d === "recovered") notify("info", "Recording space is back above the warning level.");
  }
  function retention(): ReturnType<typeof runRetention> {
    const gone = runRetention(store, settings(), now());
    if (gone.length) notify("info", `Removed ${gone.length} old recording${gone.length === 1 ? "" : "s"} (${(gone.reduce((n, c) => n + c.bytes, 0) / 1e9).toFixed(1)} GB) under your "${settings().retention}" retention setting.`);
    return gone;
  }
  const timers = [setInterval(tick, 5000), setInterval(retention, 3_600_000)];
  for (const t of timers) t.unref?.();
  retention();

  // ------------------------------------------------------------ derived state pushed to every client
  function nextBreak(g: GameDoc | undefined, v: ReturnType<typeof view> | null) {
    if (!g || !v) return null;
    const trigger: Trigger = breakTrigger(profileOf(g), v);
    const sp = sponsors.nextBreak(sponsors.listSponsors(store), store.list<AiringDoc>("airing"), { gameId: g.id, now: now(), trigger });
    return sp ? { sponsorId: sp.id, name: sp.name, abbr: sp.abbr, color: sp.color, seconds: sp.displaySeconds, trigger, assets: sp.assets } : null;
  }
  function gameView() { const g = activeGame(), l = gameLog(); return g && l.length ? view(fold(l, profileOf(g)), now()) : null; }
  function state() {
    const g = activeGame();
    const l = gameLog();
    const v = g && l.length ? view(fold(l, profileOf(g)), now()) : null;
    const rec = store.list<RecordingDoc>("recording").filter((r) => r.gameId === g?.id).at(-1) ?? null;
    return { version: VERSION, serverNow: now(), gameId: g?.id ?? null, gameDoc: g ?? null, game: v, sport: g ? summary(profileOf(g)) : null, custom: automation.custom.all(), events: l.filter((e) => e.type !== "clock.start" && e.type !== "clock.stop" && e.type !== "clock.set").slice(-60), engine: engine.status(), graphics: gfx.state(), next: nextBreak(g, v), settings: settings(), recording: rec, recovered, remote: hooks.remote(), notices };
  }

  // ------------------------------------------------------------ flows
  function appendEvent(body: any) {
    const id = need();
    if (body?.type === "undo" && body.target === undefined) {
      const last = lastUndoable(gameLog());
      if (!last) bad("Nothing to undo.", 409);
      body.target = last!.seq;
    }
    const before = gameView();
    const ev = parseEv(body, profileOf(activeGame()));
    if (typeof ev === "string") bad(ev);
    const logged = store.append(id, ev as any, now());
    gameLog().push(logged);
    automation.onEvent(logged, before, gameView()); // rules, webhooks, event stream (never throws)
    return logged;
  }
  function activate(id: string) {
    const g = data.getGame(store, id) ?? bad("Game not found.", 404);
    data.saveSettings(store, { activeGameId: id });
    log = store.load(id); logGame = id;
    if (!log.length) { data.snapshotProfile(store, id); const e = store.append(id, { type: "game.start", home: g!.home.abbr, away: g!.away.abbr, homeName: g!.home.name, awayName: g!.away.name }, now()); log.push(e); automation.onEvent(e, null, gameView()); }
    recovered = null; gfx.newGame();
    return data.getGame(store, id)!; // re-read: starting the game froze its sport profile into it
  }
  async function broadcastStart() {
    const g = activeGame() ?? bad("No game is active.", 409);
    const s = settings();
    const dests = (g!.destinationIds.length ? g!.destinationIds : data.listDestinations(store).filter((d) => d.enabled).map((d) => d.id)).map((id) => data.getDestinationWithKey(store, id)).filter((d) => d?.enabled);
    const live0 = dests.find((d) => d && d.kind !== "record");
    if (live0) { // refuse before anything starts (no recording, no OBS dialog) when the destination cannot be reached
      if (!live0.url || !live0.key) bad(`${live0.name} needs a server address and stream key.`);
      if (engine.status().engine === "obs") { const chk = await (deps.checkDestination ?? checkDestination)(live0.url!); if (!chk.ok) bad(`${live0.name}: ${chk.message}`); }
    }
    const file = await engine.startRecord(s.storageDir, g!.id);
    store.put("recording", { id: `${g!.id}-${now()}`, gameId: g!.id, file, startedAt: now(), bytes: 0, exported: false } satisfies RecordingDoc);
    const live = dests.find((d) => d && d.kind !== "record");
    if (live) {
      if (!live.url || !live.key) bad(`${live.name} needs a server address and stream key.`);
      await engine.startStream({ name: live.name, url: live.url!, key: live.key! });
    }
    store.put("game", { ...g!, status: "live" });
    recovered = null;
  }
  async function broadcastStop() {
    await engine.stopStream().catch(() => {});
    const rec = store.list<RecordingDoc>("recording").filter((r) => !r.endedAt).at(-1);
    await engine.stopRecord().catch(() => {});
    if (rec) { let bytes = 0; try { bytes = statSync(rec.file).size; } catch {} store.put("recording", { ...rec, endedAt: now(), bytes }); }
    void engine.applyVideo?.(settings().video).catch(() => {}); // quality choices saved during the broadcast take effect now
  }
  function fire(body: { sponsorId?: string; outcome?: AiringDoc["outcome"] }) {
    const st = state();
    if (!st.gameId || !st.game) bad("No game is active.", 409);
    const sp = body.sponsorId ? sponsors.listSponsors(store).find((s) => s.id === body.sponsorId) : st.next ? sponsors.listSponsors(store).find((s) => s.id === st.next!.sponsorId) : undefined;
    if (!sp) bad("No sponsor is due right now.", 409);
    const outcome = body.outcome ?? "aired";
    const a = sponsors.recordAiring(store, { gameId: st.gameId!, sponsorId: sp!.id, at: now(), period: st.game!.period, gameClockMs: st.game!.clockMs, trigger: (st.next?.trigger ?? "timeout") as Trigger, outcome, seconds: outcome === "aired" ? sp!.displaySeconds : 0 });
    if (outcome === "aired") {
      gfx.sponsor({ name: sp!.name, color: sp!.color, seconds: sp!.displaySeconds }); // the sponsor corner graphic shows itself, then hides itself
    }
    automation.onSponsor({ sponsorId: sp!.id, name: sp!.name, outcome });
    return a;
  }

  // ------------------------------------------------------------ automation: custom data, rules, macros, webhooks (src/automation/)
  const automation = createAutomation({
    store, engine, now, fetch: deps.fetch, graphics: () => hooks.graphics,
    event: async (b) => { const e = appendEvent(b); changed(); return e; },
    fireSponsor: async (b) => { const a = fire(b ?? {}); changed(); return a; },
    notify: (level, message) => notify(level, message), changed: () => changed(),
    view: gameView, gameId: () => activeId() ?? null,
  });
  engine.onChange(() => automation.onEngine(engine.status()));
  const autoTick = setInterval(() => automation.tick(), 1000); autoTick.unref?.();

  // ------------------------------------------------------------ graphics: designs, custom/imported graphics, remote connectors (src/graphics/)
  const gfx = createGraphics({
    store, engine, now, changed: () => changed(), fetch: deps.fetch, dir: deps.graphicsDir ?? join(paths().dataDir, "graphics"),
    context: () => { const g = activeGame(); return { game: gameView(), doc: g, venue: g ? data.listVenues(store).find((x: any) => x.id === g.venueId)?.name : undefined, custom: automation.custom.all() }; },
    notify: (level, message) => notify(level, message),
  });
  hooks.graphics = gfx.control;
  registerWorkspaceSection("graphics", graphicsSection({ store, files: gfx.filesRoot, conns: gfx.conns, now, reloaded: gfx.reloaded }));
  registerWorkspaceSection("profiles", profilesSection({ store, defaultId: () => data.getSettings(store).defaultProfileId ?? "basketball", changed: () => changed() }));

  // ------------------------------------------------------------ router
  type H = (a: { body: any; params: string[]; q: URLSearchParams; req: Request }) => unknown | Promise<unknown>;
  const routes: [string, RegExp, H][] = [];
  const on = (method: string, pattern: string, h: H) => routes.push([method, new RegExp("^" + pattern.replace(/:[a-z]+/g, "([^/]+)") + "$"), h]);

  // Dev aid: the overlay page (?debug) reports what OBS's embedded browser really did. Off unless FIELDHOUSE_DEBUG=1.
  on("POST", "/overlay-debug", ({ body }) => { if (process.env.FIELDHOUSE_DEBUG !== "1") bad("Not found.", 404); diag.log("INFO", "overlay: " + String(body?.text ?? "").slice(0, 1500)); return { ok: true }; });
  on("GET", "/state", () => state());
  on("POST", "/event", ({ body }) => { const e = appendEvent(body); changed(); return e; });
  on("GET", "/log", () => gameLog());
  on("POST", "/recovered/dismiss", () => { recovered = null; changed(); return { ok: true }; });

  on("GET", "/games", () => data.listGames(store).sort((a: GameDoc, b: GameDoc) => a.startsAt - b.startsAt));
  on("POST", "/games", ({ body }) => { const g = data.saveGame(store, body); changed(); return g; });
  on("GET", "/games/:id", ({ params }) => data.getGame(store, params[0]) ?? bad("Game not found.", 404));
  on("PUT", "/games/:id", ({ body, params }) => { const g = data.saveGame(store, { ...body, id: params[0] }); changed(); return g; });
  on("POST", "/games/:id/activate", ({ params }) => { const g = activate(params[0]); changed(); return g; });
  on("POST", "/games/:id/finish", async ({ params }) => {
    const g = data.getGame(store, params[0]) ?? bad("Game not found.", 404);
    if (activeId() === g!.id) { const s = fold(gameLog(), profileOf(g)); await broadcastStop(); store.put("game", { ...g!, status: "final", finalScore: { home: s.home.score, away: s.away.score } }); automation.onGameEnd(); }
    changed(); return data.getGame(store, g!.id);
  });
  on("POST", "/roster/parse", ({ body }) => data.parseRosterCsv(String(body?.text ?? ""), body?.mapping));

  on("GET", "/venues", () => data.listVenues(store));
  on("PUT", "/venues", ({ body }) => data.saveVenue(store, body));
  on("GET", "/devices", async () => engine.detectDevices());
  registerEngineRoutes(on, { engine, store, bad, changed, hooks });
  registerEngineSettings(on, { engine, store, bad, changed });
  registerProfileRoutes(on, { store, bad, changed });
  registerAutomationRoutes(on, automation, { store, bad, changed });
  registerGraphicsRoutes(on, { gfx, bad });
  on("POST", "/slots", async ({ body }) => { await engine.setSlot(Number(body.slot), body.deviceId ?? null, body.label); changed(); return engine.status().sources; });
  on("POST", "/venues/:id/apply", async ({ params }) => {
    const v = data.listVenues(store).find((x: any) => x.id === params[0]) ?? bad("Venue not found.", 404);
    for (const s of v!.slots) await engine.setSlot(s.slot, s.deviceId, s.label);
    changed(); return engine.status().sources;
  });

  on("GET", "/destinations", () => data.listDestinations(store));
  on("POST", "/destinations", ({ body }) => { const d = data.saveDestination(store, body); changed(); return d; });
  on("DELETE", "/destinations/:id", ({ params }) => { store.del("destination", params[0]); changed(); return { ok: true }; });
  on("POST", "/destinations/:id/test", async ({ params }) => {
    const d = data.getDestinationWithKey(store, params[0]) ?? bad("Destination not found.", 404);
    if (d!.kind === "record") return { ok: true, message: "Recording to this computer needs no connection." };
    if (!d!.url) return { ok: false, message: "Add a server address first." };
    if (!d!.key) return { ok: false, message: "Add a stream key first." };
    const chk = await (deps.checkDestination ?? checkDestination)(d!.url); // the same check that guards going live
    return { ok: chk.ok, message: chk.message };
  });

  on("POST", "/preflight", async () => runChecks({ engine: engine.status(), game: activeGame(), destinations: store.list<any>("destination"), settings: settings(), profile: profileOf(activeGame()) }));
  on("POST", "/broadcast/start", async () => { await broadcastStart(); changed(); return { ok: true }; });
  on("POST", "/broadcast/stop", async () => { await broadcastStop(); changed(); return { ok: true }; });

  on("POST", "/engine/preview", async ({ body }) => { await engine.setPreview(String(body.sourceId)); return { ok: true }; });
  on("POST", "/engine/cut", async () => { await engine.cut(); return { ok: true }; });
  on("POST", "/engine/fade", async ({ body }) => { await engine.fade(Number(body?.ms ?? 500)); return { ok: true }; });
  on("POST", "/engine/mute", async ({ body }) => { await engine.setMute(String(body.id), !!body.muted); return { ok: true }; });
  on("POST", "/engine/gain", async ({ body }) => { await engine.setGain(String(body.id), Number(body.gainDb)); return { ok: true }; });
  on("POST", "/replay", async ({ body }) => { await engine.replay({ secondsBack: Number(body?.secondsBack ?? 10), speed: Number(body?.speed ?? 1) }); return { ok: true }; });
  on("POST", "/replay/stop", async () => { await engine.stopReplay(); return { ok: true }; });

  on("POST", "/graphics", ({ body }) => gfx.legacy(body ?? {})); // the original API: the four built-in graphics (see src/graphics/)

  on("GET", "/sponsors", () => { const air = store.list<AiringDoc>("airing"); return sponsors.listSponsors(store).map((s) => ({ ...s, usage: sponsors.seasonUsage(s, air) })); });
  on("POST", "/sponsors", ({ body }) => { const s = sponsors.saveSponsor(store, body); changed(); return s; });
  on("DELETE", "/sponsors/:id", ({ params }) => { sponsors.deleteSponsor(store, params[0]); changed(); return { ok: true }; });
  on("GET", "/sponsors/plan", () => { const list = sponsors.listSponsors(store); return { plan: sponsors.planGame(list, profileOf(activeGame())), conflicts: sponsors.conflicts(list) }; });
  on("POST", "/sponsors/fire", ({ body }) => { const a = fire(body ?? {}); changed(); return a; });

  on("GET", "/reports/airings", ({ q }) => { const rows = reports.airingRows(store, filterOf(q)); return { rows, summary: reports.summary(rows) }; });
  on("GET", "/reports/airings.csv", ({ q }) => new Response(reports.toCsv(reports.airingRows(store, filterOf(q))), { headers: { "content-type": "text/csv", "content-disposition": 'attachment; filename="proof-of-play.csv"' } }));

  on("GET", "/recordings", () => storage.listRecordings(store));
  on("DELETE", "/recordings/:id", ({ params }) => { storage.deleteRecording(store, params[0]); changed(); return { ok: true }; });
  on("GET", "/storage", () => storage.storageUsage(settings().storageDir, store));
  on("GET", "/highlights/:id", ({ params }) => {
    const rec = store.list<RecordingDoc>("recording").filter((r) => r.gameId === params[0]).at(-1);
    if (!rec) return { recording: null, clips: [] };
    return { recording: rec, clips: clipsFromLog(store.load(params[0]), rec, { profile: profileOf(data.getGame(store, params[0])) }) };
  });
  on("POST", "/highlights/:id/export", async ({ params, body }) => {
    const rec = store.list<RecordingDoc>("recording").filter((r) => r.gameId === params[0]).at(-1) ?? bad("There is no recording for this game.", 404);
    let clips = clipsFromLog(store.load(params[0]), rec!, { profile: profileOf(data.getGame(store, params[0])) });
    if (Array.isArray(body?.indexes)) clips = body.indexes.map((i: number) => clips[i]).filter(Boolean); // keeps the order the operator chose
    if (!clips.length) bad("Pick at least one clip.");
    const out = await exportHighlights(rec!.file, clips, join(settings().storageDir, "highlights", `${params[0]}-highlights.mp4`));
    store.put("recording", { ...rec!, exported: true });
    return out;
  });

  on("GET", "/settings", () => settings());
  on("PUT", "/settings", ({ body }) => { const s = data.saveSettings(store, body); changed(); return data.settingsView(s); });

  const dctx = () => ({ settings: settings(), engine: engine.status(), destinations: store.list<any>("destination"), gameId: activeId(), obsLog: hooks.logs?.highlights() });
  on("GET", "/diagnostics", ({ q }) => ({ logs: diag.recentLogs(Number(q.get("n") ?? 50), (q.get("level") as any) || undefined), bundle: diag.previewBundle(dctx()), series: lastSeries(store, gameTitle) }));
  on("POST", "/diagnostics/bundle", () => diag.buildBundle(dctx()));

  on("GET", "/retention/plan", () => retentionPlan(store, settings(), now())); // dry run
  on("GET", "/update", ({ q }) => checkUpdate(q.get("force") === "1"));

  // Dev/demo only: reachable when DEMO=1 (server.ts decides). Lets the recovery states be shown on demand.
  on("POST", "/demo", () => { if (!(deps.demo ?? process.env.DEMO === "1") && data.listGames(store).length) bad("Demo data is only available on an empty install.", 403); data.seedDemo(store); changed(); return { ok: true }; });
  on("POST", "/dev/simulate", ({ body }) => { const f = (engine as any).simulate; if (!f) bad("This engine cannot simulate failures."); f.call(engine, body.what, body.arg); changed(); return { ok: true }; });

  function filterOf(q: URLSearchParams) {
    const n = (k: string) => (q.get(k) ? Number(q.get(k)) : undefined);
    return { sponsorId: q.get("sponsorId") || undefined, gameId: q.get("gameId") || undefined, from: n("from"), to: n("to") };
  }

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api/, "");
    try {
      // Local app on a trusted LAN: still refuse cross-site writes (a web page in another tab must not drive a live game).
      const origin = req.headers.get("origin");
      if (origin && new URL(origin).host !== url.host) bad("Cross-origin requests are not allowed.", 403);
      const multipart = (req.headers.get("content-type") ?? "").startsWith("multipart/form-data") && path === "/graphics/import"; // file uploads (graphic import)
      if (!multipart && (req.method === "POST" || req.method === "PUT") && !(req.headers.get("content-type") ?? "").includes("json") && (await req.clone().text())) bad("Send JSON with content-type: application/json.", 415);
      for (const [m, re, h] of routes) {
        const mt = re.exec(path);
        if (m !== req.method || !mt) continue;
        let body: any;
        if (!multipart && (req.method === "POST" || req.method === "PUT")) { const t = await req.text(); if (t) { try { body = JSON.parse(t); } catch { bad("That request was not valid JSON."); } } }
        const out = await h({ body, params: mt.slice(1).map(decodeURIComponent), q: url.searchParams, req });
        return out instanceof Response ? out : json(out);
      }
      return json({ error: "Not found." }, 404);
    } catch (e: any) {
      if (!(e instanceof HttpError)) diag.log(e instanceof TypeError || e instanceof ReferenceError || e instanceof RangeError ? "ERROR" : "WARN", `${req.method} ${path}: ${e?.message ?? e}`);
      return json({ error: e?.message ?? "Something went wrong." }, e instanceof HttpError ? e.status : 400);
    }
  }

  /** GET /rec/:id[?download=1] -> the recording (or "highlights-<gameId>") with Range support. */
  function rec(req: Request): Response {
    const u = new URL(req.url);
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("method not allowed", { status: 405 });
    let id: string; try { id = decodeURIComponent(u.pathname.replace(/^\/rec\//, "")); } catch { return new Response("bad path", { status: 400 }); }
    const file = resolveMedia(id, store.list<RecordingDoc>("recording"), settings().storageDir);
    return file ? serveFile(req, file, u.searchParams.get("download") === "1") : new Response("not found", { status: 404 });
  }

  return { handle, rec, graphics: gfx, profile: () => profileOf(activeGame()), tick, retention, notify, endBroadcast: broadcastStop, stop: () => { timers.forEach(clearInterval); clearInterval(autoTick); automation.stop(); gfx.close(); }, automation, hooks, state, onChange: (f: () => void) => (listeners.add(f), () => listeners.delete(f)), changed, engine, store, snapshot: (id: string) => engine.snapshot(id) };
}
export type App = ReturnType<typeof createApp>;
