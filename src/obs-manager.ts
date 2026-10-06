// Finds, configures and launches the user's OBS Studio so a volunteer never opens OBS settings.
// Never kills OBS. The websocket config can only be edited while OBS is closed (OBS rewrites it on exit).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type ObsKind = "flatpak" | "native" | "windows" | "macos";
export interface ObsInstall { installed: boolean; kind?: ObsKind; version?: string; launch: string[]; cwd?: string }
export const FLATPAK_ID = "com.obsproject.Studio";
export const DEFAULT_PORT = 4455;

// ---------------------------------------------------------------- pure helpers (unit-tested; Windows/macOS cannot be run on the dev box)
type Env = Record<string, string | undefined>;
export const windowsExeCandidates = (env: Env) =>
  [env.ProgramFiles ?? "C:\\Program Files", env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)"].map((d) => `${d}\\obs-studio\\bin\\64bit\\obs64.exe`);

/** Directory of obs-websocket's config.json for each OS / install type. */
export function websocketConfigPath(kind: ObsKind, o: { home: string; env: Env }): string {
  const tail = ["obs-studio", "plugin_config", "obs-websocket", "config.json"];
  if (kind === "flatpak") return join(o.home, ".var", "app", FLATPAK_ID, "config", ...tail);
  if (kind === "windows") return o.env.APPDATA ? `${o.env.APPDATA}\\obs-studio\\plugin_config\\obs-websocket\\config.json` : `${o.home}\\AppData\\Roaming\\obs-studio\\plugin_config\\obs-websocket\\config.json`;
  if (kind === "macos") return join(o.home, "Library", "Application Support", ...tail);
  return join(o.env.XDG_CONFIG_HOME || join(o.home, ".config"), ...tail);
}

/** Enable the server on `port` with a password, keeping every other key the user or OBS wrote. */
export function mergeWebsocketConfig(existing: unknown, o: { password: string; port?: number }) {
  const cur = existing && typeof existing === "object" && !Array.isArray(existing) ? (existing as Record<string, unknown>) : {};
  const port = Number.isInteger(o.port) ? o.port! : cur.server_enabled === true && Number.isInteger(cur.server_port) ? (cur.server_port as number) : DEFAULT_PORT;
  const next = { ...cur, server_enabled: true, server_port: port, auth_required: true, server_password: o.password, alerts_enabled: false, first_load: false };
  return { config: next, port, changed: JSON.stringify(next) !== JSON.stringify(cur) };
}

/** argv for starting OBS. dirs = extra folders a Flatpak OBS must be allowed to write (recordings). */
export function launchCommand(i: ObsInstall, dirs: string[] = []): string[] {
  const tail = ["--disable-shutdown-check"];
  if (i.kind === "flatpak") return ["flatpak", "run", ...dirs.filter((d) => /^\/[^\s:,]+$/.test(d)).map((d) => `--filesystem=${d}`), FLATPAK_ID, ...tail];
  if (i.kind === "macos") return ["open", "-a", "OBS", "--args", ...tail];
  return [...i.launch, ...tail];
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

export function obsRunning(): boolean {
  if (process.platform === "win32") return /obs64\.exe/i.test(run(["tasklist", "/FI", "IMAGENAME eq obs64.exe", "/NH"]) ?? "");
  return run(["pgrep", "-x", process.platform === "darwin" ? "OBS" : "obs"]) !== null;
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
  if (obsRunning()) throw new Error("OBS is open. Close OBS first so Fieldhouse can finish setting it up, or use Connect with OBS's password.");
  const path = websocketConfigPath(install.kind, { home: o.home ?? homedir(), env: o.env ?? process.env });
  let existing: unknown = {};
  try { existing = JSON.parse(readFileSync(path, "utf8")); } catch (e: any) { if (e.code !== "ENOENT") { try { copyFileSync(path, path + ".bak"); } catch {} } }
  const { config, port, changed } = mergeWebsocketConfig(existing, { password: o.password, port: o.port });
  if (changed) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(config, null, 2), { mode: 0o600 }); }
  return { path, port, changed };
}

/** Start OBS (unless its websocket already answers) and wait until the websocket is up. */
export async function launchObs(o: { port?: number; install?: ObsInstall; dirs?: string[]; timeoutMs?: number } = {}): Promise<{ launched: boolean }> {
  const url = wsUrl(o.port ?? DEFAULT_PORT);
  if (await wsAnswers(url)) return { launched: false };
  const install = o.install ?? detectObs();
  if (!install.installed) throw new Error("OBS Studio is not installed.");
  const [cmd, ...args] = launchCommand(install, o.dirs);
  let exited: number | null = null;
  const child = spawn(cmd, args, { detached: true, stdio: "ignore", cwd: install.cwd, env: process.env });
  child.on("error", () => { exited = -1; });
  child.on("exit", (c) => { if (install.kind !== "macos") exited = c ?? -1; });
  child.unref();
  const end = Date.now() + (o.timeoutMs ?? 60_000);
  while (Date.now() < end) {
    if (await wsAnswers(url)) return { launched: true };
    if (exited !== null && install.kind !== "macos" && exited !== 0) throw new Error("OBS closed right after starting. Open OBS once by hand and look for an error message.");
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("OBS opened but its connection did not come up in time. Check that OBS finished loading, then press Connect.");
}
