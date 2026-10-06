// Keeps the video engine (OBS) running without the volunteer ever seeing it.
//
// Ownership, the one rule that matters: Fieldhouse closes ONLY an OBS that Fieldhouse itself started.
//  - OBS not running  -> we seed its quiet settings, enable its websocket with OUR random password, launch it, and own it.
//  - OBS already open -> we ADOPT it: connect with the saved/typed password, never hide it, never close it.
//  - We remember the pid of the OBS we started in a small file, so a Fieldhouse that crashed and came back still knows it owns it.
//    (A pid can in theory be reused; pids() only reports processes whose exact name is OBS, which makes that harmless in practice.)
// If our OBS dies (crash, someone quit it from the tray) the watchdog relaunches it with backoff, up to MAX_RESTARTS in a row,
// and shows "Restarting the video engine..." in the engine status. It never restarts a broadcast by itself.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_PORT, clearCrashMarkers, detectObs, ensureWebsocketConfig, launchObs, newPassword, obsPids, seedQuietConfig, stopObsProcess, type ObsInstall, wsAnswers, wsUrl } from "./obs-manager";

export type ManagedState = "off" | "starting" | "applying" | "running" | "adopted" | "restarting" | "needs-password" | "needs-close" | "not-installed" | "failed";
export interface ManagedStatus { state: ManagedState; message: string; owned: boolean; restarts: number; since: number }

export const MAX_RESTARTS = 5;
/** Seconds to wait before relaunch attempt 1, 2, 3... (0 = right away). */
export const BACKOFF_S = [0, 2, 5, 10, 20];
export const STABLE_S = 60; // up this long = the restart counter resets
export const STUCK_S = 45; // an engine WE started that has not answered for this long is frozen (e.g. stuck on a dialog): close it and start a new one

export const MESSAGES: Record<ManagedState, string> = {
  off: "",
  starting: "Starting the video engine...",
  running: "The video engine is running.",
  adopted: "Using the OBS Studio that was already open.",
  restarting: "Restarting the video engine...",
  applying: "Applying video settings...",
  "needs-password": "OBS Studio is already open and Fieldhouse does not have its password. Enter it in Settings > Video engine, or close OBS and Fieldhouse will start its own.",
  "needs-close": "OBS Studio is already open with its remote control turned off. Close it and Fieldhouse will start its own video engine.",
  "not-installed": "The video engine is not installed on this computer yet.",
  failed: "The video engine would not start after several tries. Restart Fieldhouse, or press Try again in Settings > Video engine.",
};

export interface SupervisorDeps {
  detect(): ObsInstall;
  pids(): number[];
  wsAnswers(url: string): Promise<boolean>;
  /** Seed OBS's quiet settings and enable its websocket with `password` (OBS must be closed). Returns the port. */
  prepare(o: { install: ObsInstall; password: string; port: number }): { port: number };
  launch(o: { install: ObsInstall; port: number; dirs: string[]; profile?: string }): Promise<{ pid?: number }>;
  stop(kind: NonNullable<ObsInstall["kind"]>, pid: number): Promise<boolean>;
  newPassword(): string;
  ownedPid: { read(): number | null; write(pid: number | null): void };
  now(): number;
}
export interface SupervisorOpts {
  url(): string; password(): string | undefined; dirs(): string[];
  /** Persist new credentials and (re)point the engine at them. */
  credentials(url: string, password: string): Promise<void> | void;
  /** Write the Fieldhouse profile with the saved video settings (OBS is closed). Returns the profile name to start OBS with, if written. */
  writeProfile?(install: ObsInstall): string | null;
  connected(): boolean; authFailed(): boolean;
  notice(level: "info" | "warn", message: string): void;
  changed(): void;
}

const portOf = (url: string) => Number(/:(\d+)/.exec(url)?.[1]) || DEFAULT_PORT;

export class ObsSupervisor {
  private st: ManagedStatus;
  private owned = false;
  private pid: number | null = null;
  private enabled = false;
  private busy = false;
  private lastLaunch = 0;
  private upSince = 0;
  private failures = 0;
  private timer?: ReturnType<typeof setInterval>;
  private gaveUp = false;
  private stuckSince = 0;
  private seenPidAt = 0; // when an OBS that is not ours first stopped answering

  constructor(private d: SupervisorDeps, private o: SupervisorOpts) { this.st = { state: "off", message: "", owned: false, restarts: 0, since: d.now() }; }

  status(): ManagedStatus { return { ...this.st, owned: this.owned }; }
  private set(state: ManagedState, message = MESSAGES[state]) {
    if (state !== this.st.state || message !== this.st.message) { this.st = { ...this.st, state, message, since: this.d.now() }; this.o.changed(); }
  }

  /** Make sure an OBS is up and ours to talk to. Resolves when it answers (or throws a plain-language reason). */
  async start(): Promise<void> {
    this.enabled = true;
    this.failures = 0; this.st.restarts = 0; this.gaveUp = false;
    this.watch();
    await this.ensure(false);
  }

  private watch() { this.timer ??= setInterval(() => void this.tick(), 2000); (this.timer as any).unref?.(); }

  /** Stop watching; closes OBS only if we own it (see header). Call after the broadcast has been stopped. */
  async shutdown(): Promise<{ closed: boolean }> {
    this.enabled = false; clearInterval(this.timer); this.timer = undefined;
    const kind = this.d.detect().kind, pid = this.pid ?? this.d.ownedPid.read();
    if (!this.owned || !pid || !kind || !this.d.pids().includes(pid)) { this.set("off"); return { closed: false }; }
    const closed = await this.d.stop(kind, pid);
    if (closed) { this.d.ownedPid.write(null); this.owned = false; this.pid = null; }
    this.set("off");
    return { closed };
  }

  /** Stop watching without touching OBS (the demo engine was chosen). */
  disable() { this.enabled = false; clearInterval(this.timer); this.timer = undefined; this.set("off"); }

  private async ensure(restart: boolean, applying = false) {
    if (this.busy) return;
    this.busy = true;
    try {
      const install = this.d.detect();
      if (!install.installed || !install.kind) { this.set("not-installed"); throw new Error(MESSAGES["not-installed"]); }
      const url = this.o.url(), port = portOf(url), pw = this.o.password();
      const pids = this.d.pids();
      if (pids.length && !restart) this.owned = this.d.ownedPid.read() != null && pids.includes(this.d.ownedPid.read()!);
      if (await this.d.wsAnswers(wsUrl(port))) { // somebody's OBS is up: adopt (or keep owning) it
        this.pid = this.owned ? this.d.ownedPid.read() : null;
        this.set(this.owned ? "running" : "adopted");
        return;
      }
      if (pids.length) { // running, but its websocket is off and not ours: we cannot change its settings while it is open
        if (!this.owned) { this.set("needs-close"); throw new Error(MESSAGES["needs-close"]); }
        this.set("starting"); return; // ours and still loading
      }
      this.set(applying ? "applying" : restart ? "restarting" : "starting");
      this.lastLaunch = this.d.now(); // set before anything can throw, so the backoff always counts from the attempt
      const password = pw || this.d.newPassword();
      const { port: p } = this.d.prepare({ install, password, port });
      await this.o.credentials(wsUrl(p), password);
      const profile = this.o.writeProfile?.(install) ?? undefined; // saved settings go into the profile BEFORE OBS starts: no live changes needed
      const r = await this.d.launch({ install, port: p, dirs: this.o.dirs(), profile });
      this.owned = true; this.pid = r.pid ?? null; this.d.ownedPid.write(this.pid);
      this.set("running");
    } catch (e: any) {
      const now = this.d.pids(); // launch failed but an OBS process exists: it is ours (nobody else was running), so we still own it
      if (now.length && !now.includes(this.pid ?? -1)) { this.owned = true; this.pid = now.at(-1)!; this.d.ownedPid.write(this.pid); }
      if (this.st.state === "starting" || this.st.state === "restarting") this.o.notice("warn", `The video engine did not start: ${e.message}`);
      throw e;
    } finally { this.busy = false; }
  }

  /** Called every 2 s (tests call it directly). */
  async tick(): Promise<void> {
    if (!this.enabled || this.busy) return;
    const now = this.d.now();
    if (this.o.connected()) {
      this.seenPidAt = 0; this.stuckSince = 0;
      if (this.st.state !== "running" && this.st.state !== "adopted") this.set(this.owned ? "running" : "adopted");
      if (!this.upSince) this.upSince = now;
      if (now - this.upSince > STABLE_S * 1000 && this.failures) { this.failures = 0; this.st.restarts = 0; }
      return;
    }
    this.upSince = 0;
    if (this.o.authFailed()) { this.set("needs-password"); return; }
    if (this.gaveUp) return;
    if (this.d.pids().length) { // there, just not answering: loading, or frozen. Never kill it; say what is going on.
      if (!this.owned) { this.seenPidAt ||= now; if (now - this.seenPidAt > 15_000 && !(await this.d.wsAnswers(wsUrl(portOf(this.o.url()))))) this.set("needs-close"); }
      else {
        this.stuckSince ||= now;
        if (now - this.stuckSince > STUCK_S * 1000) { // ours and frozen: only an engine Fieldhouse started is ever closed
          this.stuckSince = 0;
          this.o.notice("warn", "The video engine stopped responding. Fieldhouse is restarting it.");
          const kind = this.d.detect().kind;
          if (kind) for (const pid of this.d.pids()) await this.d.stop(kind, pid);
        } else if (this.st.state !== "starting" && this.st.state !== "restarting") this.set("starting");
      }
      return;
    }
    // The process is gone. Whoever started it, the engine must come back: relaunch with backoff.
    if (!this.d.detect().installed) { this.set("not-installed"); return; }
    const wait = (BACKOFF_S[Math.min(this.failures, BACKOFF_S.length - 1)] ?? 0) * 1000;
    if (this.lastLaunch && now - this.lastLaunch < wait) { this.set("restarting"); return; }
    if (this.failures >= MAX_RESTARTS) { this.gaveUp = true; this.set("failed"); this.o.notice("warn", MESSAGES.failed); return; }
    this.failures++; this.st.restarts = this.failures;
    this.o.notice("warn", this.failures === 1 ? "The video engine stopped. Fieldhouse is starting it again." : `The video engine stopped again. Starting it again (try ${this.failures} of ${MAX_RESTARTS}).`);
    try { await this.ensure(true); } catch { /* ensure() already set the state; the next tick tries again after the backoff */ }
  }

  /**
   * Changing resolution, frame rate or encoder in a LIVE OBS is what crashed it (see obs-profile.ts). Instead: close the OBS we
   * started (cleanly), write the new values into its profile, start it again. The caller guarantees no broadcast is running.
   * Resolves when OBS answers again; the engine then re-provisions by itself.
   */
  async restartForSettings(): Promise<void> {
    if (!this.owned) throw new Error("This change needs the video engine to restart, but it was not started by Fieldhouse. Close that OBS and let Fieldhouse start its own, then try again.");
    const kind = this.d.detect().kind, pid = this.pid ?? this.d.ownedPid.read();
    if (this.busy) throw new Error("The video engine is busy right now. Try again in a moment.");
    this.busy = true;
    try {
      this.set("applying");
      if (kind && pid && this.d.pids().includes(pid)) { const ok = await this.d.stop(kind, pid); if (!ok) throw new Error("The video engine would not close. Nothing was changed."); }
      this.d.ownedPid.write(null); this.owned = false; this.pid = null;
    } finally { this.busy = false; }
    await this.ensure(true, true);
    this.set("running");
  }

  /** "Try again" button after the engine gave up. */
  async retry() { this.failures = 0; this.st.restarts = 0; this.gaveUp = false; this.enabled = true; this.watch(); this.set("starting"); await this.ensure(true); }
}

// ---------------------------------------------------------------- the real thing (the class above only sees SupervisorDeps)

export function systemDeps(ownedFile: string, detect: () => ObsInstall = detectObs): SupervisorDeps {
  return {
    detect, pids: obsPids, wsAnswers, newPassword, now: Date.now,
    prepare: ({ install, password, port }) => { clearCrashMarkers({ install }); seedQuietConfig({ install }); return { port: ensureWebsocketConfig({ password, install, port }).port }; },
    launch: ({ install, port, dirs, profile }) => { for (const d of dirs) try { mkdirSync(d, { recursive: true }); } catch {} return launchObs({ install, port, dirs, timeoutMs: 90_000, profile }); },
    stop: (kind, pid) => stopObsProcess(kind, pid, 8000),
    ownedPid: {
      read: () => { try { const n = Number(JSON.parse(readFileSync(ownedFile, "utf8")).pid); return Number.isInteger(n) ? n : null; } catch { return null; } },
      write: (pid) => { try { if (pid == null) { if (existsSync(ownedFile)) rmSync(ownedFile); } else { mkdirSync(dirname(ownedFile), { recursive: true }); writeFileSync(ownedFile, JSON.stringify({ pid })); } } catch {} },
    },
  };
}
