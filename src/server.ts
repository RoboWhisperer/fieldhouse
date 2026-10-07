// HTTP + WebSocket + static files around createApp(). Run: bun src/server.ts
// Env: PORT (8080), HOST (127.0.0.1; phones use the separate remote listener from Settings > Remote, see src/auth.ts), DB, ENGINE=fake|obs, OBS_URL, OBS_PASSWORD, DEMO=1
import { homedir } from "node:os";
import { dirname, normalize, join, sep } from "node:path";
import { createApp } from "./app";
import { paths } from "./config";
import { getSettings, saveSettings, seedDemo } from "./data";
import { createRemote } from "./auth";
import { SwitchableEngine } from "./engine";
import { installCrashHandlers, lastCrash, log, setLogDir } from "./diagnostics";
import { dailyBackup, openStore } from "./store";
import { ObsSupervisor, systemDeps } from "./obs-supervisor";
import { ObsInstaller } from "./obs-install";
import { ObsLogWatcher } from "./obs-log";
import { detectTools, obsLogDir } from "./obs-manager";
import { detectCached } from "./engine-routes";
import { writeProfile } from "./obs-profile";
import { PROFILE } from "./obs-provision";
import { latestLog, parseEncoders, readSlice } from "./obs-log";
import { encoderOptions } from "./video-settings";

const P = paths();
setLogDir(P.logs);
installCrashHandlers(); // a bug in one request must not end a broadcast: log it and keep serving
const crash = lastCrash();
if (crash) log("WARN", `Previous run ended with ${crash.kind}: ${crash.message}`);
const dbPath = process.env.DB ?? P.db;
const store = openStore(dbPath);
const backup = () => { try { const f = dailyBackup(store, join(dirname(dbPath), "backups")); if (f) log("INFO", `Database backup written: ${f}`); } catch (e: any) { log("WARN", `Database backup failed: ${e?.message}`); } };
backup(); setInterval(backup, 6 * 3_600_000).unref();
// Engine: env ENGINE / DEMO win, otherwise what Settings > Engine saved (packaged installs default to OBS). OBS draws the overlay by loading our own /overlay.
const saved = getSettings(store).engine;
const engine = new SwitchableEngine(process.env.ENGINE ? (process.env.ENGINE === "obs" ? "obs" : "fake") : process.env.DEMO === "1" ? "fake" : saved.kind,
  { obsUrl: process.env.OBS_URL ?? saved.obsUrl, obsPassword: process.env.OBS_PASSWORD ?? saved.obsPassword, overlayUrl: () => `http://127.0.0.1:${server.port}/overlay${process.env.FIELDHOUSE_DEBUG === "1" ? "?debug" : ""}`, video: () => getSettings(store).video, restartForVideo: () => supervisor.restartForSettings() });
if (process.env.DEMO === "1") seedDemo(store);
const app = createApp({ store, engine });

// ---- the video engine runs by itself: started, watched, restarted and (only if we started it) stopped by Fieldhouse (src/obs-supervisor.ts)
// Hardware encoders OBS listed at its previous start (read from its log; none known yet on a first run, then software is used).
const hardwareFromLog = (install: { kind?: any }) => { try { const f = latestLog(obsLogDir(install.kind ?? "native", { home: homedir(), env: process.env })); return encoderOptions(f ? parseEncoders(readSlice(f, 0, 200_000)) : []).map((o) => o.id).filter((id) => id !== "auto" && id !== "x264"); } catch { return []; } };
const usingObs = () => engine.status().engine === "obs";
const supervisor = new ObsSupervisor(systemDeps(join(P.dataDir, "obs-owned.json"), detectCached), {
  url: () => getSettings(store).engine.obsUrl,
  password: () => process.env.OBS_PASSWORD ?? getSettings(store).engine.obsPassword,
  dirs: () => [getSettings(store).storageDir, join(P.dataDir, "replays")],
  async credentials(url, pw) { // the supervisor made (or reuses) the engine's password: keep it in settings (never returned by the API) and point the engine at it
    const e = getSettings(store).engine;
    if (e.obsUrl === url && e.obsPassword === pw && usingObs()) return;
    saveSettings(store, { engine: { kind: "obs", obsUrl: url, obsPassword: pw } });
    await engine.swap("obs", { obsUrl: url, obsPassword: pw });
  },
  writeProfile: (install) => (writeProfile({ install, video: getSettings(store).video, hw: hardwareFromLog(install) }) ? PROFILE : null),
  connected: () => { const s = engine.status(); return s.engine === "obs" && s.connected; },
  authFailed: () => /password/i.test(engine.status().obs?.error ?? ""),
  notice: (level, message) => app.notify(level, message),
  changed: () => app.changed(),
});
engine.managed = () => supervisor.status();
app.hooks.supervisor = supervisor;
app.hooks.installer = new ObsInstaller({
  tools: detectTools, isInstalled: () => detectCached(true).installed, log: (m) => log("INFO", m),
  onFinished: async (ok) => { app.changed(); if (ok) { saveSettings(store, { engine: { kind: "obs" } }); await engine.swap("obs", {}); await supervisor.retry().catch(() => {}); app.changed(); } },
});
// OBS's own log -> plain notices (never raw lines). A hardware encoder that fails falls back to software by itself.
const logs = new ObsLogWatcher({
  dir: () => obsLogDir(detectCached().kind ?? "native", { home: homedir(), env: process.env }),
  notice: (level, message, kind) => {
    app.notify(level, message);
    const v = getSettings(store).video;
    if (kind === "encoder" && v.encoder !== "auto" && v.encoder !== "x264") { // do not touch a live broadcast; the saved choice is fixed now and applied after it
      saveSettings(store, { video: { encoder: "x264" } });
      app.notify("warn", "The hardware video encoder failed, so Fieldhouse switched to the software encoder (x264).");
      if (!app.state().engine.stream.live && !app.state().engine.record.active) void engine.applyVideo({ ...v, encoder: "x264" }).catch(() => {});
    }
  },
});
app.hooks.logs = logs;
logs.start();
if (usingObs() && process.env.FIELDHOUSE_NO_ENGINE_START !== "1") supervisor.start().catch((e) => log("WARN", `Video engine did not start: ${e.message}`));

const WEB = P.web;
const PORT = Number(process.env.PORT ?? 8080);
const remote = createRemote({ app, store, avoidPorts: [PORT] }); // phone remote: trust gate + optional LAN listener (src/auth.ts)
app.hooks.remote = remote.summary;

const server = Bun.serve({
  port: PORT,
  hostname: process.env.HOST ?? "127.0.0.1",
  async fetch(req, srv) {
    const { pathname } = new URL(req.url);
    // Only loopback is the operator console; any other peer (e.g. HOST=0.0.0.0) is a phone and gets the remote allowlist.
    const gate = await remote.handle(req, srv.requestIP(req)?.address, { upgrade: (r, data) => srv.upgrade(r, { data }) });
    if (gate === "upgraded") return;
    if (gate) return gate;
    if (pathname === "/ws") { const o = req.headers.get("origin"); if (o) { let h = ""; try { h = new URL(o).host; } catch {} if (h !== new URL(req.url).host) return new Response("forbidden", { status: 403 }); } }
    if (pathname === "/ws") return srv.upgrade(req) ? undefined : new Response("expected websocket", { status: 400 });
    if (pathname.startsWith("/api/")) return app.handle(req);
    if (pathname === "/overlay") return new Response(Bun.file(P.overlay));
    if (pathname.startsWith("/gfx/")) return app.graphics.serve(req); // custom graphics' files and the runtime script (loopback only: the remote gate never lets /gfx through)
    if (pathname.startsWith("/rec/")) return app.rec(req);
    const snap = /^\/snap\/([\w-]+)$/.exec(pathname);
    if (snap) {
      const img = await app.snapshot(snap[1]);
      return img ? new Response(img.body, { headers: { "content-type": img.type, "cache-control": "no-store" } }) : new Response("no image", { status: 404 });
    }
    const file = normalize(join(WEB, pathname === "/" ? "index.html" : pathname));
    if (file.startsWith(WEB + sep) && (await Bun.file(file).exists())) return new Response(Bun.file(file), { headers: { "cache-control": "no-store" } });
    return new Response("not found", { status: 404 });
  },
  websocket: {
    open: (ws: any) => { if (ws.data?.dev) return remote.ws.open(ws); ws.subscribe("game"); ws.send(JSON.stringify(app.state())); },
    close: (ws: any) => { if (ws.data?.dev) remote.ws.close(ws); },
    message() {}, // read-only channel; writes go through /api
  },
});

let pending = false;
app.onChange(() => { // coalesce bursts (engine ticks, event storms) into one push per 100 ms
  if (pending) return;
  pending = true;
  setTimeout(() => { pending = false; server.publish("game", JSON.stringify(app.state())); remote.broadcast(); remote.sync(); }, 100);
});

remote.sync();
log("INFO", `Fieldhouse started (engine: ${engine.status().engine})`);
console.log(`Fieldhouse on http://${server.hostname}:${server.port}   app: /   OBS overlay: /overlay`);
console.log(`FIELDHOUSE_READY ${JSON.stringify({ port: server.port })}`); // machine-readable, read by the desktop shell

// Graceful shutdown (the desktop shell sends SIGTERM): stop recorders, flush the database, then exit.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    try {
      remote.close(); app.stop(); logs.stop();
      if (usingObs() && engine.status().connected) await app.endBroadcast().catch(() => {}); // finish the recording BEFORE the engine goes away
      const r = await supervisor.shutdown(); // closes OBS only if Fieldhouse started it
      log("INFO", r.closed ? "Stopped the video engine Fieldhouse had started" : "Left the video engine running (not started by Fieldhouse)");
      await engine.close(); store.close();
    } finally { process.exit(0); }
  });
}
