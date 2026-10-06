// Phone remote: the network trust model, device pairing and the optional LAN listener.
//
// Trust model (see also web/remote/ and Settings > Remote):
//  - A peer on loopback (127.0.0.1 / ::1) is the operator console: no token, full app (desktop app, OBS source, curl).
//  - Every other peer is a phone. It gets a strict allowlist and needs a paired device token:
//      GET /remote (+ assets), POST /api/remote/pair (the only unauthenticated call), GET /api/remote/me,
//      GET /api/state (trimmed), POST /api/event (role-limited, rate-limited), GET /ws (trimmed feed).
//    Everything else answers 403. Device management (/api/remote/status, devices, pending, lock, code) is loopback only.
//  - Tokens are 32 random bytes; only their SHA-256 is stored. Revoking a device closes its sockets at once.
//  - The main server stays on 127.0.0.1. Turning "Allow phones on this network" on starts a second listener on 0.0.0.0
//    that serves nothing but this remote surface, through the same gate (`handle(req, peerIp, { lan: true })`).
// `handle` takes the peer address as an argument (no Bun dependency) so the whole gate is unit-testable.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import type { ServerWebSocket } from "bun";
import type { App } from "./app";
import { paths } from "./config";
import * as data from "./data";
import * as diag from "./diagnostics";
import { parseEv } from "./game";
import type { Store } from "./store";

export type Role = "score" | "score+marks" | "producer";
export interface DeviceDoc { id: string; name: string; role: Role; createdAt: number; lastSeen: number; tokenHash: string }
export type WsData = { dev: string };

const ROLES: Role[] = ["score", "score+marks", "producer"];
const SCORE_EVENTS = ["clock.start", "clock.stop", "clock.set", "period.set", "score", "foul", "timeout", "undo"];
export const allowedEvents = (role: Role) => (role === "score" ? SCORE_EVENTS : [...SCORE_EVENTS, "mark"]); // score+marks and producer
const UNDOABLE = ["score", "foul", "timeout"];
const MAX_BODY = 4096, MAX_DEVICES = 20, COOKIE = "fh_device", COOKIE_AGE = 90 * 86400;

// ---------------------------------------------------------------- address helpers
const v4 = (s: string) => { const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s); const a = m ? m.slice(1).map(Number) : null; return a && a.every((n) => n <= 255) ? a : null; };
export const normIp = (ip?: string) => { let s = (ip ?? "").trim().toLowerCase().split("%")[0]; if (s.startsWith("::ffff:")) s = s.slice(7); return s; };
export function isLoopback(ip?: string) { const s = normIp(ip), a = v4(s); return a ? a[0] === 127 : s === "::1"; }
/** Private / link-local / loopback: addresses that cannot be reached from the open internet. */
export function isPrivate(ip?: string) {
  const s = normIp(ip), a = v4(s);
  if (a) return a[0] === 10 || a[0] === 127 || (a[0] === 172 && a[1] >= 16 && a[1] <= 31) || (a[0] === 192 && a[1] === 168) || (a[0] === 169 && a[1] === 254);
  if (!s.includes(":")) return false;
  if (s === "::1") return true;
  const h = parseInt(s.split(":")[0] || "0", 16) || 0;
  return (h & 0xfe00) === 0xfc00 || (h & 0xffc0) === 0xfe80;
}
/** Private IPv4 addresses of this machine, i.e. what a phone on the same Wi-Fi could use. */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) for (const i of list ?? []) if (i.family === "IPv4" && !i.internal && isPrivate(i.address) && !i.address.startsWith("169.254.")) out.push(i.address);
  return out;
}

// ---------------------------------------------------------------- small utilities
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
const digest = (s: string) => createHash("sha256").update(s).digest();
const sameSecret = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));
const normCode = (c: string) => c.replace(/\s+/g, "").toUpperCase();
const cleanName = (n: unknown) => (typeof n === "string" ? n.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 40) : "");
const cookieOf = (req: Request, name: string) => { for (const p of (req.headers.get("cookie") ?? "").split(";")) { const i = p.indexOf("="); if (i > 0 && p.slice(0, i).trim() === name) return p.slice(i + 1).trim(); } return ""; };
const waitText = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ""}` : `${s} s`);

class Http extends Error { constructor(public status: number, msg: string, public extra: Record<string, unknown> = {}) { super(msg); } }
const fail = (status: number, msg: string, extra?: Record<string, unknown>): never => { throw new Http(status, msg, extra); };

class Limiter {
  private m = new Map<string, { n: number; first: number; until: number }>();
  constructor(private max: number, private win: number, private lock: number, private now: () => number) {}
  /** Seconds left on a lockout, 0 when free. */
  wait(k: string) { const e = this.m.get(k), t = this.now(); if (!e || !e.until) return 0; if (e.until <= t) { this.m.delete(k); return 0; } return Math.ceil((e.until - t) / 1000); }
  fail(k: string) {
    const t = this.now(); let e = this.m.get(k);
    if (!e || t - e.first > this.win) e = { n: 0, first: t, until: 0 };
    e.n++; if (e.n >= this.max) e.until = t + this.lock;
    this.m.set(k, e);
    if (this.m.size > 500) for (const [key, v] of this.m) if (t - v.first > this.win && v.until <= t) this.m.delete(key);
    return this.max - e.n;
  }
  ok(k: string) { this.m.delete(k); }
}

async function readJson(req: Request, max = MAX_BODY): Promise<Record<string, any>> {
  if (Number(req.headers.get("content-length") ?? 0) > max) fail(413, "That request is too large.");
  if (!(req.headers.get("content-type") ?? "").includes("json")) fail(415, "Send JSON with content-type: application/json.");
  const chunks: Uint8Array[] = []; let n = 0;
  if (req.body) for await (const c of req.body as any as AsyncIterable<Uint8Array>) { n += c.length; if (n > max) fail(413, "That request is too large."); chunks.push(c); }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  let b: any; try { b = JSON.parse(text); } catch { fail(400, "That request was not valid JSON."); }
  if (!b || typeof b !== "object" || Array.isArray(b)) fail(400, "That request was not valid JSON.");
  return b;
}

const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ws: wss:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const SECURITY_HEADERS: Record<string, string> = { "content-security-policy": CSP, "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cache-control": "no-store", "x-frame-options": "DENY" };
const secure = (r: Response) => { for (const [k, v] of Object.entries(SECURITY_HEADERS)) r.headers.set(k, v); return r; };
const jsonRes = (x: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(x, { status, headers });
const errRes = (e: unknown) => {
  if (e instanceof Http) return jsonRes({ error: e.message, ...e.extra }, e.status, e.status === 429 && typeof e.extra.retryAfterSec === "number" ? { "retry-after": String(e.extra.retryAfterSec) } : {});
  diag.log("ERROR", `remote: ${(e as Error)?.message ?? e}`);
  return jsonRes({ error: "Something went wrong on the console." }, 500);
};

// ---------------------------------------------------------------- the remote
export interface RemoteDeps { app: App; store: Store; now?: () => number; webDir?: string; avoidPorts?: number[] }
export type HandleOpts = { lan?: boolean; upgrade?: (req: Request, data: WsData) => boolean };

export function createRemote(deps: RemoteDeps) {
  const { app, store } = deps;
  const now = deps.now ?? Date.now;
  const webDir = deps.webDir ?? paths().web;
  const settings = () => data.getSettings(store);

  // devices: the store is the source of truth, the hash map is a cache (only this module writes devices)
  const byHash = new Map<string, DeviceDoc>();
  const byId = new Map<string, DeviceDoc>();
  const persistedAt = new Map<string, number>();
  for (const d of store.list<DeviceDoc>("device")) { byHash.set(d.tokenHash, d); byId.set(d.id, d); }
  const publicDev = (d: DeviceDoc) => ({ id: d.id, name: d.name, role: d.role, createdAt: d.createdAt, lastSeen: d.lastSeen, connected: (sockets.get(d.id)?.size ?? 0) > 0 });
  const save = (d: DeviceDoc) => { store.put("device", d); persistedAt.set(d.id, now()); };
  const touch = (d: DeviceDoc) => { d.lastSeen = now(); if (now() - (persistedAt.get(d.id) ?? 0) > 30_000) save(d); };

  const sockets = new Map<string, Set<ServerWebSocket<WsData>>>();
  const connectedCount = () => [...sockets.values()].filter((s) => s.size).length;
  let locked = false;

  const ipLimit = new Limiter(5, 300_000, 300_000, now); // 5 wrong codes / 5 min per address -> 5 min lockout
  const allLimit = new Limiter(25, 300_000, 300_000, now); // the same for the whole network, so changing address does not help
  const buckets = new Map<string, { tokens: number; at: number }>();
  const spend = (id: string, rate = 20) => { // `rate` requests / second per device and kind (events 20, snapshots 15)
    const t = now(), b = buckets.get(id) ?? { tokens: rate, at: t };
    b.tokens = Math.min(rate, b.tokens + ((t - b.at) / 1000) * rate); b.at = t; buckets.set(id, b);
    if (b.tokens < 1) return false; b.tokens--; return true;
  };

  // ---- approval mode (requireCode off): a phone asks, the console allows or denies
  type Pending = { id: string; name: string; ip: string; createdAt: number; keyHash: string; state: "waiting" | "allowed" | "denied" };
  const pending = new Map<string, Pending>();
  const livePending = () => { for (const [id, p] of pending) if (now() - p.createdAt > 120_000) pending.delete(id); return [...pending.values()]; };

  // ---------------------------------------------------------------- state for phones (no settings, destinations, recordings)
  /** What a device may see, by role. Never settings, destinations, pairing code, file paths or stream keys. */
  function stateFor(role: Role) {
    const st = app.state(), d = st.gameDoc;
    const tm = (t: { name: string; abbr: string; color: string; roster: unknown }) => ({ name: t.name, abbr: t.abbr, color: t.color, roster: t.roster });
    const base = { kind: "state", role, serverNow: st.serverNow, locked, gameId: st.gameId, gameDoc: d && { id: d.id, title: d.title, status: d.status, home: tm(d.home), away: tm(d.away) }, game: st.game, events: st.events, graphics: st.graphics, profile: st.settings.profile };
    if (role !== "producer") return base;
    const e = st.engine, n = st.next;
    return {
      ...base, canBroadcast: !!st.settings.remote.producerCanBroadcast,
      next: n && { sponsorId: n.sponsorId, name: n.name, abbr: n.abbr, color: n.color, seconds: n.seconds, trigger: n.trigger },
      engine: {
        engine: e.engine, connected: e.connected, program: e.program, preview: e.preview, replay: { active: !!e.replay?.active },
        sources: e.sources.map((x) => ({ id: x.id, slot: x.slot, label: x.label, kind: x.kind, status: x.status, audio: x.audio })),
        mixer: e.mixer.map((m) => ({ id: m.id, label: m.label, level: m.level, gainDb: m.gainDb, muted: m.muted })),
        stream: { live: e.stream.live, kbps: e.stream.kbps, droppedFrames: e.stream.droppedFrames, reconnecting: e.stream.reconnecting },
        record: { active: e.record.active, bytes: e.record.bytes }, cpu: e.cpu, diskFreeBytes: e.diskFreeBytes, graphicsInProgram: !!e.graphicsInProgram,
      },
    };
  }
  const trimmed = () => stateFor("score");
  const send = (ws: ServerWebSocket<WsData>, msg: string) => { try { ws.send(msg); } catch {} };
  function broadcast() {
    if (![...sockets.values()].some((s) => s.size)) return;
    const cache = new Map<Role, string>();
    for (const [id, set] of sockets) {
      const role = byId.get(id)?.role; if (!role) continue;
      for (const w of set) { if (!cache.has(role)) cache.set(role, JSON.stringify(stateFor(role))); send(w, cache.get(role)!); }
    }
  }
  const closeDevice = (id: string, code: number, why: string) => { for (const ws of [...(sockets.get(id) ?? [])]) { try { ws.close(code, why); } catch {} } };
  const tick = setInterval(() => { // keepalive: the phone treats silence as a dropped connection
    if (!connectedCount()) return;
    for (const [id, set] of sockets) if (set.size) { const d = byId.get(id); if (d) touch(d); }
    broadcast();
  }, 10_000);
  tick.unref?.();

  const ws = {
    open(w: ServerWebSocket<WsData>) {
      const d = byId.get(w.data.dev);
      if (!d) return w.close(4001, "revoked");
      (sockets.get(d.id) ?? sockets.set(d.id, new Set()).get(d.id)!).add(w);
      send(w, JSON.stringify({ kind: "me", device: publicDev(d) })); send(w, JSON.stringify(stateFor(d.role)));
      diag.log("INFO", `Phone connected: ${d.name}`); app.changed();
    },
    message() {}, // read-only channel; writes go through POST /api/event
    close(w: ServerWebSocket<WsData>) { sockets.get(w.data.dev)?.delete(w); app.changed(); },
  };

  // ---------------------------------------------------------------- pairing
  function mint(name: string, ip: string) {
    if (byId.size >= MAX_DEVICES) fail(409, "Too many phones are paired. Remove one in Settings > Remote on the console.");
    const token = randomBytes(32).toString("base64url");
    const d: DeviceDoc = { id: data.newId("dev"), name, role: "score", createdAt: now(), lastSeen: now(), tokenHash: hashToken(token) };
    save(d); byHash.set(d.tokenHash, d); byId.set(d.id, d);
    diag.log("INFO", `Phone paired: ${name} (${normIp(ip)})`); app.changed();
    return jsonRes({ ok: true, token, device: publicDev(d) }, 200, { "set-cookie": `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_AGE}` });
  }
  const locks = (ip: string) => Math.max(ipLimit.wait(ip), allLimit.wait("*"));
  const tooMany = (s: number): never => fail(429, `Too many wrong tries. Try again in ${waitText(s)}.`, { retryAfterSec: s });
  const miss = (ip: string, msg: string): never => {
    const left = ipLimit.fail(ip); allLimit.fail("*");
    const s = locks(ip);
    if (s) tooMany(s);
    return fail(401, `${msg} ${left} ${left === 1 ? "try" : "tries"} left.`, { triesLeft: left });
  };

  async function pair(req: Request, ip: string) {
    const b = await readJson(req);
    const s = locks(ip); if (s) tooMany(s);
    const cfg = settings().remote;
    if (typeof b.requestId === "string") { // a phone waiting for the console to say yes
      const p = pending.get(b.requestId);
      if (!p || now() - p.createdAt > 120_000) { pending.delete(b.requestId); return fail(410, "That request expired. Ask to connect again."); }
      if (typeof b.key !== "string" || !sameSecret(hashToken(b.key), p.keyHash)) return miss(ip, "That request is not yours.");
      if (p.state === "waiting") return jsonRes({ pending: true }, 202);
      pending.delete(p.id); app.changed();
      if (p.state === "denied") return fail(403, "The console said no.");
      return mint(p.name, ip);
    }
    const name = cleanName(b.name);
    if (!name) fail(400, "Enter your name so the console knows who you are.");
    if (cfg.requireCode) {
      if (typeof b.code !== "string" || !b.code.trim() || b.code.length > 40) fail(400, "Enter the pairing code shown on the console.");
      if (!sameSecret(normCode(b.code), normCode(cfg.code))) miss(ip, "That code is not right.");
      ipLimit.ok(ip);
      return mint(name, ip);
    }
    const mine = livePending().filter((p) => p.ip === ip && p.state === "waiting").length;
    if (mine >= 3 || pending.size >= 20) fail(429, "Too many requests are waiting on the console. Try again in a minute.", { retryAfterSec: 60 });
    const key = randomBytes(16).toString("base64url"), p: Pending = { id: data.newId("req"), name, ip: normIp(ip), createdAt: now(), keyHash: hashToken(key), state: "waiting" };
    pending.set(p.id, p); diag.log("INFO", `Phone asked to connect: ${name}`); app.changed();
    return jsonRes({ pending: true, requestId: p.id, key }, 202);
  }

  // ---------------------------------------------------------------- device-facing routes
  function authenticate(req: Request, url: URL, allowQuery = false): DeviceDoc {
    const t = cookieOf(req, COOKIE) || (allowQuery ? url.searchParams.get("t") ?? "" : "");
    const d = t && t.length <= 64 ? byHash.get(hashToken(t)) : undefined;
    if (!d) return fail(401, "This phone is not paired. Enter the pairing code to connect.");
    touch(d); return d;
  }
  const sameOrigin = (req: Request, url: URL) => {
    const o = req.headers.get("origin"); if (!o) return;
    let host = ""; try { host = new URL(o).host; } catch {}
    if (host !== url.host) fail(403, "Cross-origin requests are not allowed.");
  };

  async function event(req: Request, d: DeviceDoc, url: URL) {
    const b = await readJson(req);
    if (!allowedEvents(d.role).includes(String(b.type))) fail(403, b.type === "mark" ? "This phone is not allowed to mark moments." : "This phone is not allowed to send that.");
    if (locked) fail(423, "The console has locked the remote");
    if (!spend(d.id)) fail(429, "Slow down: too many taps at once.");
    let ev: Record<string, unknown>;
    if (b.type === "undo" && b.target === undefined) ev = { type: "undo" }; // the app picks the latest undoable event
    else {
      const p = parseEv(b); if (typeof p === "string") return fail(400, p);
      ev = p as any;
      if (p.type === "undo" && !app.state().events.some((e: any) => e.seq === p.target && UNDOABLE.includes(e.type))) fail(400, "That can no longer be undone.");
    }
    const res = await app.handle(new Request(url.origin + "/api/event", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ev) }));
    diag.log(res.ok ? "INFO" : "WARN", `remote ${d.name}: ${ev.type}${ev.team ? " " + ev.team : ""}${ev.points ? " +" + ev.points : ""} -> ${res.status}`);
    return res;
  }

  // ---- producer: full production from another computer, still no administration. Bodies are checked here, then the normal handlers run.
  const txt = (v: unknown, max: number, what: string): string => (typeof v === "string" && v.length <= max && !/[\u0000-\u001f]/.test(v) ? v : fail(400, `${what} is not valid.`));
  const num = (v: unknown, lo: number, hi: number, what: string, dflt?: number): number => (v === undefined && dflt !== undefined ? dflt : typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : fail(400, `${what} must be a number from ${lo} to ${hi}.`));
  const PRODUCER: Record<string, (b: any) => Record<string, unknown>> = {
    "POST /api/engine/preview": (b) => ({ sourceId: txt(b.sourceId, 80, "The source") }),
    "POST /api/engine/cut": () => ({}),
    "POST /api/engine/fade": (b) => ({ ms: num(b.ms, 0, 5000, "Fade length", 500) }),
    "POST /api/engine/mute": (b) => ({ id: txt(b.id, 80, "The channel"), muted: typeof b.muted === "boolean" ? b.muted : fail(400, "muted must be true or false.") }),
    "POST /api/engine/gain": (b) => ({ id: txt(b.id, 80, "The channel"), gainDb: num(b.gainDb, -60, 20, "Gain") }),
    "POST /api/replay": (b) => ({ secondsBack: num(b.secondsBack, 1, 60, "Replay length", 10), speed: num(b.speed, 0.1, 2, "Replay speed", 1) }),
    "POST /api/replay/stop": () => ({}),
    "POST /api/graphics": (b) => {
      const o: Record<string, unknown> = {};
      if ("scorebug" in b) o.scorebug = typeof b.scorebug === "boolean" ? b.scorebug : fail(400, "scorebug must be true or false.");
      if ("slate" in b) o.slate = b.slate === null ? null : txt(b.slate, 120, "The slate text");
      if ("lower" in b) o.lower = b.lower === null ? null : b.lower && typeof b.lower === "object" ? { title: txt(b.lower.title, 60, "The title"), sub: txt(b.lower.sub ?? "", 80, "The subtitle") } : fail(400, "The lower third is not valid.");
      return o;
    },
    "POST /api/sponsors/fire": (b) => ({ ...(b.sponsorId !== undefined ? { sponsorId: txt(b.sponsorId, 80, "The sponsor") } : {}), ...(b.outcome !== undefined ? { outcome: ["aired", "skipped", "delayed"].includes(b.outcome) ? b.outcome : fail(400, "Outcome must be aired, skipped or delayed.") } : {}) }),
    "POST /api/broadcast/start": () => ({}),
    "POST /api/broadcast/stop": () => ({}),
  };
  async function producer(req: Request, url: URL, key: string, d: DeviceDoc) {
    if (d.role !== "producer") fail(403, "This device is not allowed to do that. Ask the person at the console for the Producer role.");
    if (key.includes("/broadcast/") && !settings().remote.producerCanBroadcast) fail(403, "Starting and stopping the broadcast is turned off for remote devices. Do it on the console, or allow it in Settings > Remote access.");
    if (locked) fail(423, "The console has locked the remote");
    sameOrigin(req, url);
    if (!spend(d.id)) fail(429, "Slow down: too many taps at once.");
    const body = PRODUCER[key](await readJson(req));
    const res = await app.handle(new Request(url.origin + url.pathname, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    diag.log(res.ok ? "INFO" : "WARN", `remote ${d.name}: ${key.slice(5)} -> ${res.status}`);
    return res;
  }
  async function snapshot(d: DeviceDoc, id: string) {
    if (d.role !== "producer") fail(403, "This device cannot view video. Ask the person at the console for the Producer role.");
    if (!spend(d.id + ":snap", 15)) fail(429, "Slow down: too many picture requests.");
    const img = await app.snapshot(id);
    return img ? new Response(img.body as any, { headers: { "content-type": img.type } }) : jsonRes({ error: "No picture." }, 404);
  }

  const FILES: Record<string, string> = {
    "/remote": "remote/index.html", "/remote/": "remote/index.html", "/remote/remote.js": "remote/remote.js", "/remote/remote.css": "remote/remote.css",
    "/remote/producer.js": "remote/producer.js", "/remote/producer.css": "remote/producer.css", "/tokens.css": "tokens.css", "/ui.css": "ui.css", "/icons.js": "icons.js",
  };

  async function gated(req: Request, ip: string, url: URL, o: HandleOpts): Promise<Response | "upgraded"> {
    const p = url.pathname, m = req.method;
    const cfg = settings().remote;
    if (!cfg.enabled) return jsonRes({ error: "Phone remote is turned off on this computer." }, 403);
    if (cfg.lockedToLan && !isPrivate(ip)) return jsonRes({ error: "This remote only works on the same Wi-Fi network as the console." }, 403);
    try {
      if (m === "GET" && FILES[p]) { const f = Bun.file(join(webDir, FILES[p])); return (await f.exists()) ? new Response(f) : jsonRes({ error: "Not found." }, 404); }
      if (m === "GET" && p === "/favicon.ico") return new Response(null, { status: 204 });
      if (m === "POST" && p === "/api/remote/pair") { sameOrigin(req, url); return await pair(req, ip); }
      if (m === "GET" && p === "/api/remote/me") { const d = authenticate(req, url); return jsonRes({ device: publicDev(d), locked }); }
      if (m === "GET" && p === "/api/state") return jsonRes(stateFor(authenticate(req, url).role));
      if (m === "POST" && p === "/api/event") { sameOrigin(req, url); return await event(req, authenticate(req, url), url); }
      const sm = m === "GET" ? /^\/snap\/([\w-]{1,40})$/.exec(p) : null;
      if (sm) return await snapshot(authenticate(req, url), sm[1]);
      if (PRODUCER[m + " " + p]) { const d = authenticate(req, url); return await producer(req, url, m + " " + p, d); }
      if (m === "GET" && p === "/ws") {
        sameOrigin(req, url);
        const d = authenticate(req, url, true);
        if (!o.upgrade || !o.upgrade(req, { dev: d.id })) return jsonRes({ error: "Expected a websocket." }, 400);
        return "upgraded";
      }
      return jsonRes({ error: p.startsWith("/api/remote/") ? "Only the console can do that." : "This phone can only use the scoring remote." }, 403);
    } catch (e) { return errRes(e); }
  }

  // ---------------------------------------------------------------- console-facing routes (loopback only)
  async function status() {
    await sync();
    const cfg = settings().remote;
    const port = lan?.port ?? cfg.port;
    return {
      enabled: cfg.enabled, port, running: !!lan, error: lanError || undefined, note: lan && lan.port !== lan.want ? `Port ${lan.want} was busy, so ${lan.port} is used instead.` : undefined,
      urls: lan ? lanAddresses().map((a) => `http://${a}:${port}/remote`) : [], code: cfg.code, requireCode: cfg.requireCode, lockedToLan: cfg.lockedToLan,
      devices: [...byId.values()].sort((a, b) => a.createdAt - b.createdAt).map(publicDev), pending: livePending().filter((q) => q.state === "waiting").map(({ id, name, ip, createdAt }) => ({ id, name, ip, createdAt })), locked,
    };
  }
  const summary = () => ({ enabled: settings().remote.enabled, connected: connectedCount(), pending: livePending().filter((q) => q.state === "waiting").map(({ id, name }) => ({ id, name })), locked });

  function revoke(id: string) {
    const d = byId.get(id); if (!d) return fail(404, "That phone is not paired.");
    byId.delete(id); byHash.delete(d.tokenHash); persistedAt.delete(id); buckets.delete(id); store.del("device", id);
    closeDevice(id, 4001, "revoked"); sockets.delete(id);
    diag.log("INFO", `Phone removed: ${d.name}`); app.changed();
  }

  async function admin(req: Request, url: URL): Promise<Response> {
    const p = url.pathname, m = req.method;
    try {
      sameOrigin(req, url);
      if (m === "GET" && p === "/api/remote/status") return jsonRes(await status());
      if (m === "POST" && p === "/api/remote/pair") return await pair(req, "127.0.0.1");
      if (m === "GET" && p === "/api/remote/me") return jsonRes({ device: publicDev(authenticate(req, url)), locked });
      if (m === "POST" && p === "/api/remote/code/rotate") { data.saveSettings(store, { remote: { code: data.newCode() } }); app.changed(); return jsonRes(await status()); }
      if (m === "POST" && p === "/api/remote/lock") {
        const b = await readJson(req); if (typeof b.locked !== "boolean") fail(400, "locked must be true or false.");
        locked = b.locked; diag.log("INFO", locked ? "Remote locked by the console" : "Remote unlocked by the console"); app.changed(); broadcast(); return jsonRes({ locked });
      }
      let mt = /^\/api\/remote\/devices\/([\w-]+)$/.exec(p);
      if (mt && m === "PUT") {
        const b = await readJson(req), d = byId.get(mt[1]); if (!d) fail(404, "That phone is not paired.");
        if (!ROLES.includes(b.role)) fail(400, "Role must be score, score+marks or producer.");
        d!.role = b.role; save(d!);
        for (const w of sockets.get(d!.id) ?? []) { send(w, JSON.stringify({ kind: "me", device: publicDev(d!) })); send(w, JSON.stringify(stateFor(d!.role))); } // takes effect on live sockets at once
        app.changed(); return jsonRes(publicDev(d!));
      }
      if (mt && m === "DELETE") { revoke(mt[1]); return jsonRes({ ok: true }); }
      mt = /^\/api\/remote\/pending\/([\w-]+)$/.exec(p);
      if (mt && m === "POST") {
        const b = await readJson(req), q = pending.get(mt[1]); if (!q || now() - q.createdAt > 120_000) fail(404, "That request is gone. The phone can ask again.");
        if (typeof b.allow !== "boolean") fail(400, "allow must be true or false.");
        q!.state = b.allow ? "allowed" : "denied"; diag.log("INFO", `${b.allow ? "Allowed" : "Denied"} phone: ${q!.name}`); app.changed(); return jsonRes({ ok: true });
      }
      return jsonRes({ error: "Not found." }, 404);
    } catch (e) { return errRes(e); }
  }

  /**
   * The gate. Returns a Response, "upgraded" (websocket taken over), or null (trusted console request: carry on with the normal app).
   * `lan: true` marks the phone-only listener, where even a loopback peer gets the phone surface and nothing else.
   */
  async function handle(req: Request, peerIp: string | undefined, o: HandleOpts = {}): Promise<Response | "upgraded" | null> {
    const url = new URL(req.url), ip = peerIp ?? "";
    if (!o.lan && isLoopback(ip)) {
      // DNS rebinding: a web page can point its own hostname at 127.0.0.1 and then talk to the console API as "same origin".
      // The console is only ever addressed as localhost / 127.0.0.1 / [::1], so refuse any other Host name.
      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase())) return secure(jsonRes({ error: "Open Fieldhouse at http://localhost or http://127.0.0.1." }, 403));
      return url.pathname.startsWith("/api/remote/") ? admin(req, url) : null;
    }
    const r = await gated(req, ip, url, o);
    return r === "upgraded" ? r : secure(r);
  }

  // ---------------------------------------------------------------- the phone-only listener
  let lan: { server: ReturnType<typeof Bun.serve>; port: number; want: number } | null = null;
  let lanError = "", failedFor = 0, chain: Promise<void> = Promise.resolve();
  const stopLan = () => { for (const id of sockets.keys()) closeDevice(id, 4002, "remote off"); lan?.server.stop(true); lan = null; };
  async function doSync() {
    const cfg = settings().remote;
    if (!cfg.enabled) { if (lan) { stopLan(); diag.log("INFO", "Phone remote turned off"); } else for (const id of sockets.keys()) closeDevice(id, 4002, "remote off"); lanError = ""; failedFor = 0; return; }
    if (lan?.want === cfg.port) return;
    if (!lan && failedFor === cfg.port) return; // already reported; retried when the port setting changes or it is toggled
    if (lan) stopLan();
    let last: any;
    for (let port = cfg.port; port < cfg.port + 10 && port <= 65535; port++) {
      if (deps.avoidPorts?.includes(port)) continue;
      try {
        const server = Bun.serve<WsData>({
          port, hostname: "0.0.0.0", maxRequestBodySize: 16 * 1024,
          async fetch(req, srv) {
            const r = await handle(req, srv.requestIP(req)?.address, { lan: true, upgrade: (rq, data) => srv.upgrade(rq, { data }) });
            return r === "upgraded" ? undefined : r ?? new Response("not found", { status: 404 });
          },
          websocket: { ...ws, maxPayloadLength: 1024 },
        });
        lan = { server, port, want: cfg.port }; lanError = ""; failedFor = 0;
        diag.log("INFO", `Phone remote listening on port ${port}`); return;
      } catch (e: any) { last = e; if (e?.code !== "EADDRINUSE") break; }
    }
    failedFor = cfg.port;
    lanError = last?.code === "EADDRINUSE" ? `Ports ${cfg.port} to ${cfg.port + 9} are all in use. Pick another port.` : `Could not open port ${cfg.port} for phones: ${last?.message ?? "unknown error"}`;
    diag.log("ERROR", `Phone remote: ${lanError}`);
  }
  /** Make the listener match Settings > Remote. Safe to call often. */
  const sync = () => (chain = chain.then(doSync, doSync));

  function close() { clearInterval(tick); stopLan(); }
  return { handle, ws, sync, status, summary, broadcast, close, revoke, port: () => lan?.port ?? 0 };
}
export type Remote = ReturnType<typeof createRemote>;
