// Shared pieces of the real-OBS scripts (obs-e2e-hands-off.ts, obs-apply-loop.ts): a Fieldhouse server started the product way,
// a read-only raw obs-websocket client, and a cleanup that ALWAYS runs: stops everything the script started, removes its files and
// leaves OBS stopped with its websocket server DISABLED and a fresh random password. Never streams anywhere that does not answer.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const PORT = 8301, API = `http://127.0.0.1:${PORT}/api`;
export const wsConfig = join(homedir(), ".var/app/com.obsproject.Studio/config/obs-studio/plugin_config/obs-websocket/config.json");
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const until = async (f: () => unknown | Promise<unknown>, ms = 10000, step = 150) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await f(); if (v) return v; } catch {} await sleep(step); } return null; };
export const obsPids = () => (spawnSync("pgrep", ["-x", "obs"], { encoding: "utf8" }).stdout || "").split(/\s+/).filter(Boolean).map(Number);
export const api = async (m: string, p: string, b?: unknown) => {
  try { const r = await fetch(API + p, { method: m, body: b === undefined ? undefined : JSON.stringify(b), headers: b === undefined ? {} : { "content-type": "application/json" }, signal: AbortSignal.timeout(60000) }); const t = await r.text(); let j: any; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, body: j }; }
  catch (e: any) { return { status: 0, body: { error: String(e?.message ?? e) } }; }
};
export const state = async () => (await api("GET", "/state")).body;

export class Harness {
  work: string; procs: ChildProcess[] = []; server?: ChildProcess; keepLog?: string;
  constructor(name: string) { this.work = join(homedir(), ".cache", name); rmSync(this.work, { recursive: true, force: true }); mkdirSync(join(this.work, "home"), { recursive: true }); }
  spawn(cmd: string, args: string[], opts: object = { stdio: "ignore" }) { const p = spawn(cmd, args, opts as any); this.procs.push(p); return p; }
  startServer(extraEnv: Record<string, string> = {}) {
    this.server = spawn("bun", [join(import.meta.dir, "..", "src", "server.ts")], { env: { ...process.env, FIELDHOUSE_HOME: join(this.work, "home"), PORT: String(PORT), ENGINE: "obs", DEMO: "1", ...extraEnv }, stdio: "ignore" });
    return this.server;
  }
  serverLog() { try { return readFileSync(join(this.work, "home", "logs", "fieldhouse.log"), "utf8"); } catch { return ""; } }
  /** Always safe to call, any number of times. */
  async cleanup() {
    for (const p of this.procs) try { p.kill("SIGKILL"); } catch {}
    if (this.server && this.server.exitCode === null) {
      this.server.kill("SIGTERM"); // the server closes the OBS it started
      await until(() => this.server!.exitCode !== null, 25000, 200);
      if (this.server.exitCode === null) try { this.server.kill("SIGKILL"); } catch {}
    }
    for (const sig of ["SIGTERM", "SIGKILL"] as const) { // anything still left: ours by construction (the scripts refuse to start with an OBS running)
      for (const pid of obsPids()) spawnSync("kill", [sig === "SIGTERM" ? "-TERM" : "-KILL", String(pid)]);
      await until(() => obsPids().length === 0, sig === "SIGTERM" ? 10000 : 3000, 200);
    }
    spawnSync("sh", ["-c", `rm -f "${homedir()}"/.var/app/com.obsproject.Studio/config/obs-studio/.sentinel/run_*`]);
    disableObsWebsocket();
    rmSync(this.work, { recursive: true, force: true });
  }
}

/** OBS must be stopped. Server off, fresh random password (OBS rewrites this file on exit, so it is only edited while stopped). */
export function disableObsWebsocket() {
  if (obsPids().length || !existsSync(wsConfig)) return;
  try { const c = JSON.parse(readFileSync(wsConfig, "utf8")); c.server_enabled = false; c.server_password = randomBytes(24).toString("base64url"); writeFileSync(wsConfig, JSON.stringify(c, null, 2), { mode: 0o600 }); } catch {}
}

// ---- read-only raw obs-websocket client. Requests never throw: they answer { __error } (also when OBS is gone or silent).
const sha = (s: string) => createHash("sha256").update(s).digest("base64");
export async function rawObs() {
  const pw = JSON.parse(readFileSync(wsConfig, "utf8")).server_password as string;
  const ws = new WebSocket("ws://127.0.0.1:4455", "obswebsocket.json");
  const pending = new Map<string, (d: any) => void>(); let n = 0, dead = false;
  const fail = () => { dead = true; for (const f of pending.values()) f({ requestStatus: { result: false, comment: "connection lost" } }); pending.clear(); };
  await new Promise<void>((res, rej) => { ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); if (m.op === 0) ws.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, ...(m.d.authentication ? { authentication: sha(sha(pw + m.d.authentication.salt) + m.d.authentication.challenge) } : {}) } })); else if (m.op === 2) res(); else if (m.op === 7) pending.get(m.d.requestId)?.(m.d); }; ws.onerror = () => rej(new Error("obs ws")); ws.onclose = fail; });
  const req = (t: string, d?: object) => new Promise<any>((res) => { if (dead) return res({ __error: "connection lost" }); const id = "e" + ++n; const to = setTimeout(() => { pending.delete(id); res({ __error: "timeout" }); }, 8000); pending.set(id, (x) => { clearTimeout(to); res(x.requestStatus.result ? x.responseData ?? {} : { __error: x.requestStatus.comment }); }); ws.send(JSON.stringify({ op: 6, d: { requestType: t, requestId: id, requestData: d } })); });
  return { req, close: () => { try { ws.close(); } catch {} }, get dead() { return dead; } };
}
