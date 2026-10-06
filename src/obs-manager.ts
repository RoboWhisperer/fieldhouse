// Finds, configures, launches and (only when Fieldhouse started it) stops OBS Studio, so a volunteer never meets OBS.
// Ownership rule: an OBS that was already running when Fieldhouse arrived is ADOPTED and never closed (see obs-supervisor.ts).
// The websocket config and the ini files can only be edited while OBS is closed (OBS rewrites them on exit).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix } from "node:path";
import { mergeIni, quietFlags, quietPlan } from "./obs-quiet";

export type ObsKind = "flatpak" | "native" | "windows" | "macos";
export interface ObsInstall { installed: boolean; kind?: ObsKind; version?: string; launch: string[]; cwd?: string }
export const FLATPAK_ID = "com.obsproject.Studio";
export const DEFAULT_PORT = 4455;

// ---------------------------------------------------------------- pure helpers (unit-tested; Windows/macOS cannot be run on the dev box)
type Env = Record<string, string | undefined>;
export const windowsExeCandidates = (env: Env) =>
  [env.ProgramFiles ?? "C:\\Program Files", env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)"].map((d) => `${d}\\obs-studio\\bin\\64bit\\obs64.exe`);

/** OBS's config folder (holds global.ini, user.ini, logs/, plugin_config/) for each OS / install type. */
export function obsConfigDir(kind: ObsKind, o: { home: string; env: Env }): string {
  if (kind === "flatpak") return posix.join(o.home, ".var", "app", FLATPAK_ID, "config", "obs-studio");
  if (kind === "windows") return `${o.env.APPDATA ?? `${o.home}\\AppData\\Roaming`}\\obs-studio`;
  if (kind === "macos") return posix.join(o.home, "Library", "Application Support", "obs-studio");
  return posix.join(o.env.XDG_CONFIG_HOME || posix.join(o.home, ".config"), "obs-studio");
}
const sub = (kind: ObsKind, dir: string, ...parts: string[]) => (kind === "windows" ? [dir, ...parts].join("\\") : posix.join(dir, ...parts));
/** Directory of obs-websocket's config.json for each OS / install type. */
export const websocketConfigPath = (kind: ObsKind, o: { home: string; env: Env }) => sub(kind, obsConfigDir(kind, o), "plugin_config", "obs-websocket", "config.json");
export const obsLogDir = (kind: ObsKind, o: { home: string; env: Env }) => sub(kind, obsConfigDir(kind, o), "logs");

/** Enable the server on `port` with a password, keeping every other key the user or OBS wrote. */
export function mergeWebsocketConfig(existing: unknown, o: { password: string; port?: number }) {
  const cur = existing && typeof existing === "object" && !Array.isArray(existing) ? (existing as Record<string, unknown>) : {};
  const port = Number.isInteger(o.port) ? o.port! : cur.server_enabled === true && Number.isInteger(cur.server_port) ? (cur.server_port as number) : DEFAULT_PORT;
  const next = { ...cur, server_enabled: true, server_port: port, auth_required: true, server_password: o.password, alerts_enabled: false, first_load: false };
  return { config: next, port, changed: JSON.stringify(next) !== JSON.stringify(cur) };
}

/** argv for starting OBS, quiet (tray, no dialogs). dirs = extra folders a Flatpak OBS must be allowed to write (recordings). */
export function launchCommand(i: ObsInstall, dirs: string[] = [], platform: string = process.platform, profile?: string): string[] {
  const tail = [...quietFlags(i.kind === "windows" ? "win32" : i.kind === "macos" ? "darwin" : platform), ...(profile ? ["--profile", profile] : [])];
  if (i.kind === "flatpak") return ["flatpak", "run", ...dirs.filter((d) => /^\/[^\s:,]+$/.test(d)).map((d) => `--filesystem=${d}`), FLATPAK_ID, ...tail];
  if (i.kind === "macos") return ["open", "-g", "-j", "-a", "OBS", "--args", ...tail]; // -g: do not come to the front, -j: hidden
  return [...i.launch, ...tail];
}

/**
 * OBS >= 31 drops a `run_<uuid>` marker in <config>/.sentinel while it runs and deletes it on a clean exit. If one is left over
 * (OBS crashed or was killed) the next start opens the modal "OBS Studio Crash Detected" / Safe Mode dialog and waits for a click,
 * and the old --disable-shutdown-check flag no longer exists in OBS 32 (found the hard way: Fieldhouse's own relaunch after a kill
 * hung on that dialog). So the markers are removed before every launch. Only call while OBS is not running.
 */
export function clearCrashMarkers(o: { install: ObsInstall; home?: string; env?: Env }): number {
  if (!o.install.kind) return 0;
  const dir = sub(o.install.kind, obsConfigDir(o.install.kind, { home: o.home ?? homedir(), env: o.env ?? process.env }), ".sentinel");
  let n = 0;
  try { for (const f of readdirSync(dir)) if (f.startsWith("run_")) { rmSync(sub(o.install.kind, dir, f), { force: true }); n++; } } catch {}
  return n;
}

/** Seed OBS's ini files so it never shows the wizard, update prompt or confirmations. Merge only, user keys survive. Only while OBS is closed. */
export function seedQuietConfig(o: { install: ObsInstall; home?: string; env?: Env }): string[] {
  if (!o.install.kind) return [];
  const dir = obsConfigDir(o.install.kind, { home: o.home ?? homedir(), env: o.env ?? process.env }), wrote: string[] = [];
  for (const { file, set, absent } of quietPlan(o.install.version)) {
    const path = sub(o.install.kind, dir, file);
    let cur = ""; try { cur = readFileSync(path, "utf8"); } catch {}
    const r = mergeIni(cur, set, absent);
    if (r.changed) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, r.text); wrote.push(file); }
  }
  return wrote;
}

/**
 * A Flatpak OBS has a private /tmp and cannot see system folders. Pointing its recording or replay folder there makes OBS
 * stop with "bad output path" and, in the worst case, exit mid-broadcast. Returns a plain-language reason, or null if fine.
 */
export function flatpakUnreachable(dir: string): string | null {
  const bad = ["/tmp", "/var", "/usr", "/app", "/etc", "/proc", "/dev", "/sys", "/run", "/root"];
  const d = dir.replace(/\/+$/, "");
  const hit = bad.find((b) => d === b || d.startsWith(b + "/"));
  return hit ? `OBS (Flatpak) cannot write to ${dir}. Choose a folder inside your home directory, for example Videos/Fieldhouse.` : null;
}

export const wsUrl = (port: number) => `ws://127.0.0.1:${port}`;
export function parseFlatpakVersion(out: string) { return /^\s*Version:\s*(\S+)/m.exec(out)?.[1]; }

// ---------------------------------------------------------------- system probing
const run = (cmd: string[], ms = 4000) => { try { const r = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8", timeout: ms }); return r.status === 0 ? String(r.stdout) : null; } catch { return null; } };

export function detectObs(): ObsInstall {
  if (process.platform === "win32") {
    const exe = windowsExeCandidates(process.env).find(existsSync);
    return exe ? { installed: true, kind: "windows", launch: [exe], cwd: dirname(exe) } : { installed: false, launch: [] };
  }
  if (process.platform === "darwin") return existsSync("/Applications/OBS.app") ? { installed: true, kind: "macos", launch: ["open", "-a", "OBS"] } : { installed: false, launch: [] };
  const fp = run(["flatpak", "info", FLATPAK_ID]);
  if (fp) return { installed: true, kind: "flatpak", version: parseFlatpakVersion(fp), launch: ["flatpak", "run", FLATPAK_ID] };
  const bin = run(["which", "obs"])?.trim();
  if (bin) return { installed: true, kind: "native", version: /(\d+\.\d+(\.\d+)?)/.exec(run([bin, "--version"], 3000) ?? "")?.[1], launch: [bin] };
  return { installed: false, launch: [] };
}

/** Pids of running OBS processes. Matched by exact process name (never by command line: pgrep -f would match our own shell). */
export const parseTasklist = (out: string) => [...out.matchAll(/^"obs64\.exe","(\d+)"/gim)].map((m) => Number(m[1]));
export function obsPids(): number[] {
  if (process.platform === "win32") return parseTasklist(run(["tasklist", "/FI", "IMAGENAME eq obs64.exe", "/FO", "CSV", "/NH"]) ?? "");
  return (run(["pgrep", "-x", process.platform === "darwin" ? "OBS" : "obs"]) ?? "").split(/\s+/).filter(Boolean).map(Number);
}
export const obsRunning = () => obsPids().length > 0;

/**
 * argv that asks OBS to quit. Linux/macOS: SIGTERM (OBS shuts down cleanly on it, verified on 32.2.2: log ends with a normal
 * shutdown and no "unclean shutdown" on the next start). Windows: taskkill without /F posts WM_CLOSE, i.e. a normal close.
 * `force` is the last resort after a grace period; for a Flatpak it is `flatpak kill`, which ends the whole sandbox.
 */
export function terminateCommand(kind: ObsKind, pid: number, force = false): string[] {
  if (kind === "windows") return ["taskkill", "/PID", String(pid), ...(force ? ["/F"] : [])];
  if (force && kind === "flatpak") return ["flatpak", "kill", FLATPAK_ID];
  return ["kill", force ? "-KILL" : "-TERM", String(pid)];
}

/** Stop one OBS process: polite first, forced after `graceMs`. Resolves true when it is gone. */
export async function stopObsProcess(kind: ObsKind, pid: number, graceMs = 20_000): Promise<boolean> {
  const alive = () => obsPids().includes(pid);
  const send = (force: boolean) => { const [c, ...a] = terminateCommand(kind, pid, force); try { spawnSync(c, a, { timeout: 5000 }); } catch {} };
  send(false);
  for (const [limit, force] of [[graceMs, true], [5000, false]] as const) {
    const end = Date.now() + limit;
    while (alive() && Date.now() < end) await new Promise((r) => setTimeout(r, 200));
    if (!alive()) return true;
    if (force) send(true);
  }
  return !alive();
}

/** True when something answers the obs-websocket handshake at `url`. */
export function wsAnswers(url: string, ms = 1500): Promise<boolean> {
  return new Promise((done) => {
    let ws: WebSocket;
    const t = setTimeout(() => { try { ws?.close(); } catch {} done(false); }, ms);
    try { ws = new WebSocket(url, "obswebsocket.json"); } catch { clearTimeout(t); return done(false); }
    ws.onmessage = (e) => { clearTimeout(t); try { ws.close(); } catch {} done(JSON.parse(String(e.data)).op === 0); };
    ws.onerror = () => { clearTimeout(t); done(false); };
  });
}

export const newPassword = () => Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString("base64url");

/** Turn the websocket server on with `password`. Refuses while OBS runs: OBS would overwrite the file when it exits. */
export function ensureWebsocketConfig(o: { password: string; install?: ObsInstall; port?: number; home?: string; env?: Env }) {
  const install = o.install ?? detectObs();
  if (!install.installed || !install.kind) throw new Error("OBS Studio is not installed.");
  if (obsRunning()) throw new Error("OBS is already open on this computer. Fieldhouse cannot set it up while it is open.");
  const path = websocketConfigPath(install.kind, { home: o.home ?? homedir(), env: o.env ?? process.env });
  let existing: unknown = {};
  try { existing = JSON.parse(readFileSync(path, "utf8")); } catch (e: any) { if (e.code !== "ENOENT") { try { copyFileSync(path, path + ".bak"); } catch {} } }
  const { config, port, changed } = mergeWebsocketConfig(existing, { password: o.password, port: o.port });
  if (changed) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(config, null, 2), { mode: 0o600 }); }
  return { path, port, changed };
}

/** Start OBS quietly (unless its websocket already answers) and wait until the websocket is up. Returns OBS's own pid when it started it. */
export async function launchObs(o: { port?: number; install?: ObsInstall; dirs?: string[]; timeoutMs?: number; profile?: string } = {}): Promise<{ launched: boolean; pid?: number }> {
  const url = wsUrl(o.port ?? DEFAULT_PORT);
  if (await wsAnswers(url)) return { launched: false };
  const install = o.install ?? detectObs();
  if (!install.installed) throw new Error("The video engine (OBS Studio) is not installed.");
  const [cmd, ...args] = launchCommand(install, o.dirs, process.platform, o.profile);
  let exited: number | null = null;
  const child = spawn(cmd, args, { detached: true, stdio: "ignore", cwd: install.cwd, env: process.env, windowsHide: true });
  child.on("error", () => { exited = -1; });
  child.on("exit", (c) => { if (install.kind !== "macos") exited = c ?? -1; });
  child.unref();
  const end = Date.now() + (o.timeoutMs ?? 60_000);
  while (Date.now() < end) {
    if (await wsAnswers(url)) return { launched: true, pid: obsPids().at(-1) ?? child.pid };
    if (exited !== null && install.kind !== "macos" && exited !== 0) throw new Error("The video engine closed right after starting.");
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("The video engine started but did not become ready in time.");
}

/** Which installers this computer has (for src/obs-install.ts). */
export function detectTools(): { winget?: boolean; brew?: boolean; flatpak?: boolean; flathubUser?: boolean } {
  const ok = (cmd: string[]) => run(cmd, 6000) !== null;
  if (process.platform === "win32") return { winget: ok(["winget", "--version"]) };
  if (process.platform === "darwin") return { brew: ok(["brew", "--version"]) };
  const flatpak = ok(["flatpak", "--version"]);
  return { flatpak, flathubUser: flatpak && /^flathub$/m.test(run(["flatpak", "remotes", "--user", "--columns=name"]) ?? "") };
}
