// HTTP + WebSocket + static files around createApp(). Run: bun src/server.ts
// Env: PORT (8080), HOST (127.0.0.1; phones use the separate remote listener from Settings > Remote, see src/auth.ts), DB, ENGINE=fake|obs, OBS_URL, OBS_PASSWORD, DEMO=1
import { dirname, normalize, join, sep } from "node:path";
import { createApp } from "./app";
import { paths } from "./config";
import { getSettings, seedDemo } from "./data";
import { createRemote } from "./auth";
import { SwitchableEngine } from "./engine";
import { installCrashHandlers, lastCrash, log, setLogDir } from "./diagnostics";
import { dailyBackup, openStore } from "./store";

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
  { obsUrl: process.env.OBS_URL ?? saved.obsUrl, obsPassword: process.env.OBS_PASSWORD ?? saved.obsPassword, overlayUrl: () => `http://127.0.0.1:${server.port}/overlay` });
if (process.env.DEMO === "1") seedDemo(store);
const app = createApp({ store, engine });

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
    if (pathname === "/ws") return srv.upgrade(req) ? undefined : new Response("expected websocket", { status: 400 });
    if (pathname.startsWith("/api/")) return app.handle(req);
    if (pathname === "/overlay") return new Response(Bun.file(P.overlay));
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
    try { remote.close(); app.stop(); await engine.close(); store.close(); } finally { process.exit(0); }
  });
}
