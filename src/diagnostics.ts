// Support bundle: what we send is exactly what previewBundle shows. Secrets are stripped by field name.
import { paths } from "./config";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cpus, platform, release, totalmem, freemem } from "node:os";
import type { DestinationDoc, EngineStatus, SettingsDoc } from "./types";

type Level = "INFO" | "WARN" | "ERROR";
const ring: { t: number; level: Level; msg: string }[] = [];

// ---- rotating plain-text log file: "2026-10-05T12:00:00.000Z INFO message". Off until setLogDir() (server.ts turns it on).
const FILES = 5, MAX_BYTES = 2_000_000;
let logDir: string | null = null, logMax = MAX_BYTES;
export function setLogDir(dir: string | null, maxBytes = MAX_BYTES) { logDir = dir; logMax = maxBytes; if (dir) mkdirSync(dir, { recursive: true }); }
/** Strip anything that looks like a secret from free text before it reaches a file. */
export const scrub = (s: string) => s
  .replace(/\b(key|password|token|code|secret)(["']?\s*[:=]\s*["']?)[^\s"',&]+/gi, "$1$2[hidden]")
  .replace(/\b((?:rtmps?|srt):\/\/[^\/\s]+\/)\S+/gi, "$1[hidden]");
function rotate(file: string) {
  try { if (statSync(file).size < logMax) return; } catch { return; }
  rmSync(`${file}.${FILES - 1}`, { force: true });
  for (let i = FILES - 2; i >= 1; i--) if (existsSync(`${file}.${i}`)) renameSync(`${file}.${i}`, `${file}.${i + 1}`);
  renameSync(file, `${file}.1`);
}
export function log(level: Level, msg: string) {
  const t = Date.now();
  msg = scrub(msg);
  ring.push({ t, level, msg });
  if (ring.length > 500) ring.shift();
  if (!logDir) return;
  try { const f = `${logDir}/fieldhouse.log`; rotate(f); appendFileSync(f, `${new Date(t).toISOString()} ${level} ${msg.replace(/\r?\n/g, " | ")}\n`); } catch {} // logging must never throw
}
/** Last n lines across the rotated files, oldest first. */
export function logTail(n = 200): string[] {
  if (!logDir) return [];
  const out: string[] = [];
  for (let i = 0; i < FILES && out.length < n; i++) {
    try { out.unshift(...readFileSync(i ? `${logDir}/fieldhouse.log.${i}` : `${logDir}/fieldhouse.log`, "utf8").split("\n").filter(Boolean)); } catch {}
  }
  return out.slice(-n);
}

// ---- crashes: remembered on disk so the next start (and the support bundle) can say what happened
export type Crash = { at: number; kind: string; message: string; stack?: string };
const crashFile = () => (logDir ? `${logDir}/last-crash.json` : null);
export function recordCrash(kind: string, err: unknown): Crash {
  const e = err as any;
  const c: Crash = { at: Date.now(), kind, message: scrub(String(e?.message ?? e)), stack: e?.stack ? scrub(String(e.stack)).split("\n").slice(0, 12).join("\n") : undefined };
  log("ERROR", `${kind}: ${c.message}`);
  try { const f = crashFile(); if (f) writeFileSync(f, JSON.stringify(c, null, 2)); } catch {}
  return c;
}
export function lastCrash(): Crash | null { try { const f = crashFile(); return f ? JSON.parse(readFileSync(f, "utf8")) : null; } catch { return null; } }
/** Install once. Keeps the server alive (a failed request must not end a broadcast) unless it is crash-looping. */
export function installCrashHandlers(exit: (code: number) => void = process.exit) {
  const recent: number[] = [];
  const onErr = (kind: string) => (err: unknown) => {
    recordCrash(kind, err);
    const now = Date.now(); recent.push(now);
    while (recent.length && now - recent[0] > 60_000) recent.shift();
    if (recent.length > 10) { log("ERROR", "Too many unhandled errors in a minute; exiting so the app can restart cleanly."); exit(1); }
  };
  process.on("uncaughtException", onErr("uncaughtException"));
  process.on("unhandledRejection", onErr("unhandledRejection"));
}
export const recentLogs = (n = 100, level?: Level) => (level ? ring.filter((e) => e.level === level) : ring).slice(-n);

const SECRET = /^(key|password|token|code)$/i;
export function redact<T>(v: T): T {
  if (Array.isArray(v)) return v.map(redact) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k]) => !SECRET.test(k)).map(([k, x]) => [k, redact(x)])) as T;
  return v;
}

type Ctx = { settings: SettingsDoc; engine: EngineStatus; destinations: DestinationDoc[]; gameId?: string };
const EXCLUDES = ["stream keys", "destination addresses", "remote code", "rosters", "recordings"];

export function previewBundle(ctx: Ctx) {
  // Destination addresses can embed keys, so only the host is kept.
  const destinations = ctx.destinations.map((d) => {
    let host: string | undefined;
    try { host = d.url ? new URL(d.url).hostname : undefined; } catch {}
    return { id: d.id, kind: d.kind, name: d.name, enabled: d.enabled, host, keySet: !!d.key };
  });
  return redact({
    createdAt: new Date().toISOString(),
    gameId: ctx.gameId,
    logs: recentLogs(500),
    logTail: logTail(200),
    lastCrash: lastCrash(),
    settings: ctx.settings,
    engine: ctx.engine,
    destinations,
    system: { os: `${platform()} ${release()}`, cpus: cpus().length, memoryBytes: totalmem(), freeMemoryBytes: freemem(), bun: Bun.version },
  });
}

export function buildBundle(ctx: Ctx, dir = paths().dataDir): { path: string; contains: string[]; excludes: string[]; bytes: number } {
  const body = JSON.stringify(previewBundle(ctx), null, 2);
  mkdirSync(dir, { recursive: true });
  const path = `${dir}/diagnostics-${Date.now()}.json`;
  writeFileSync(path, body);
  return { path, contains: ["recent logs", "log file tail", "last crash report", "settings", "engine status", "system info", "destination names and hosts"], excludes: EXCLUDES, bytes: Buffer.byteLength(body) };
}
