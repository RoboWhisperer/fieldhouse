// One-click "Install video engine" using whatever the platform already has. Fieldhouse only runs the package manager the user
// has (winget, Homebrew, Flatpak); without one it sends the user to the official download page. Never run as admin by us: winget
// asks Windows itself, Flatpak installs per-user (no password), Homebrew casks need none.
//
// What has been run for real: command building, output parsing, the streaming/cancel/re-detect flow (against a stub process and a
// "practice run"), and flatpak's real failure output on this Linux box. NOT run: a real winget, brew or flatpak download+install
// (OBS is already installed on the dev machine and installing it twice would prove nothing).
import { spawn } from "node:child_process";

export const DOWNLOAD_URL = "https://obsproject.com/download";
export const WINGET_ID = "OBSProject.OBSStudio";
export const FLATHUB_REPO = "https://dl.flathub.org/repo/flathub.flatpakrepo";
export interface Tools { winget?: boolean; brew?: boolean; flatpak?: boolean; flathubUser?: boolean }
export interface Step { cmd: string[]; label: string }
export interface Plan { method: "winget" | "brew" | "flatpak" | "download"; steps: Step[]; downloadUrl?: string; why: string }

/** Pure: which commands install OBS here. */
export function installPlan(platform: string, t: Tools): Plan {
  if (platform === "win32" && t.winget) return { method: "winget", why: "Windows Package Manager", steps: [{ label: "Installing the video engine", cmd: ["winget", "install", "-e", "--id", WINGET_ID, "--silent", "--accept-package-agreements", "--accept-source-agreements"] }] };
  if (platform === "darwin" && t.brew) return { method: "brew", why: "Homebrew", steps: [{ label: "Installing the video engine", cmd: ["brew", "install", "--cask", "obs"] }] };
  if (platform === "linux" && t.flatpak) {
    const steps: Step[] = [];
    if (!t.flathubUser) steps.push({ label: "Adding the Flathub app source", cmd: ["flatpak", "remote-add", "--user", "--if-not-exists", "flathub", FLATHUB_REPO] });
    steps.push({ label: "Installing the video engine", cmd: ["flatpak", "install", "--user", "-y", "--noninteractive", "flathub", "com.obsproject.Studio"] });
    return { method: "flatpak", why: "Flatpak", steps };
  }
  return { method: "download", steps: [], downloadUrl: DOWNLOAD_URL, why: "No installer tool was found on this computer. The official download page has an installer for it." };
}

/** Percent (0-100) found in a progress line of winget / brew / flatpak, or null. */
export function parsePercent(line: string): number | null {
  const m = /(\d{1,3}(?:\.\d)?)\s?%/.exec(line);
  return m && Number(m[1]) <= 100 ? Math.round(Number(m[1])) : null;
}

/** Plain sentence for a failed installer, from its exit code and last output. Never shows raw tool output. */
export function explainFailure(method: Plan["method"], code: number | null, tail: string): string {
  if (/no space left|not enough (disk )?space|insufficient/i.test(tail)) return "There is not enough free disk space to install the video engine.";
  if (/could not resolve|network|timed? ?out|unable to connect|temporary failure|no internet|0x80072ee7|0x80072efd|failed to download|connection/i.test(tail)) return "The download did not work. Check the internet connection and try again.";
  if (/remote .*not found|no remote refs|nothing matches|no such (remote|ref)/i.test(tail)) return "This computer's app store (Flathub) is not set up, so the video engine could not be found. Press Install again, or use the download page.";
  if (/permission denied|access is denied|administrator|elevat|0x8a15|policy/i.test(tail)) return "This computer did not allow the installation. Ask whoever manages it, or use the download page.";
  if (/no package found|no applicable|no formula|no available|cask .*(not found|unavailable)/i.test(tail)) return "The package manager does not have the video engine. Use the download page instead.";
  return code === null ? "The installation was stopped." : "The installation did not finish. You can try again or use the download page.";
}

export interface Proc { onLine(cb: (line: string) => void): void; kill(): void; exited: Promise<number | null> }
export type RunFn = (cmd: string[]) => Proc;

/** Real process: stdout+stderr merged, split on \r and \n (flatpak redraws its progress bar with \r). */
export const runProcess: RunFn = (cmd) => {
  const child = spawn(cmd[0], cmd.slice(1), { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: { ...process.env, LC_ALL: "C" } });
  const subs: ((l: string) => void)[] = [];
  let buf = "";
  const feed = (d: Buffer) => { buf += d.toString("utf8"); const parts = buf.split(/[\r\n]+/); buf = parts.pop() ?? ""; for (const p of parts) if (p.trim()) subs.forEach((f) => f(p)); };
  child.stdout.on("data", feed); child.stderr.on("data", feed);
  const exited = new Promise<number | null>((done) => { child.on("error", () => done(127)); child.on("close", (c) => { if (buf.trim()) subs.forEach((f) => f(buf)); done(c); }); });
  return { onLine: (cb) => subs.push(cb), kill: () => { try { child.kill("SIGTERM"); } catch {} }, exited };
};

export interface InstallState {
  status: "idle" | "running" | "done" | "failed" | "cancelled";
  method?: Plan["method"]; downloadUrl?: string; dryRun: boolean;
  step: number; steps: number; label: string; percent: number | null; message: string; lines: string[]; // lines: last few raw lines, for the Troubleshooting log only
}
const idle = (): InstallState => ({ status: "idle", dryRun: false, step: 0, steps: 0, label: "", percent: null, message: "", lines: [] });

export class ObsInstaller {
  private st = idle();
  private procs: Proc | null = null;
  private cancelled = false;
  constructor(private o: { tools: () => Tools; platform?: string; run?: RunFn; isInstalled: () => boolean; onFinished?: (ok: boolean) => void | Promise<void>; log?: (m: string) => void }) {}

  state(): InstallState { return { ...this.st, lines: [...this.st.lines] }; }

  /** Starts the install and returns at once; poll state(). dryRun runs the same flow with a harmless stand-in process. */
  start(opts: { dryRun?: boolean } = {}): InstallState {
    if (this.st.status === "running") return this.state();
    const plan = installPlan(this.o.platform ?? process.platform, this.o.tools());
    this.cancelled = false;
    if (plan.method === "download") { this.st = { ...idle(), status: "failed", method: "download", downloadUrl: plan.downloadUrl, message: plan.why }; return this.state(); }
    this.st = { ...idle(), status: "running", method: plan.method, dryRun: !!opts.dryRun, steps: plan.steps.length, label: plan.steps[0].label, message: `Installing with ${plan.why}...` };
    void this.go(plan, !!opts.dryRun);
    return this.state();
  }

  cancel() { if (this.st.status === "running") { this.cancelled = true; this.procs?.kill(); } return this.state(); }

  private async go(plan: Plan, dry: boolean) {
    const run = dry ? practiceRun : this.o.run ?? runProcess;
    let code: number | null = 0;
    for (const [i, step] of plan.steps.entries()) {
      if (this.cancelled) break;
      this.st = { ...this.st, step: i + 1, label: step.label, percent: null };
      this.o.log?.(`install step ${i + 1}/${plan.steps.length}: ${dry ? "(practice run) " : ""}${step.cmd.slice(0, 3).join(" ")}`);
      const p = (this.procs = run(step.cmd));
      p.onLine((l) => { this.st.lines = [...this.st.lines.slice(-30), l.slice(0, 300)]; const pc = parsePercent(l); if (pc !== null) this.st.percent = pc; });
      code = await p.exited;
      if (code !== 0) break;
    }
    this.procs = null;
    if (this.cancelled) this.st = { ...this.st, status: "cancelled", message: "Installation cancelled." };
    else if (code !== 0) this.st = { ...this.st, status: "failed", message: explainFailure(plan.method, code, this.st.lines.join("\n")) };
    else if (!dry && !this.o.isInstalled()) this.st = { ...this.st, status: "failed", message: "The installer finished but the video engine was not found afterwards. Try again, or use the download page.", downloadUrl: DOWNLOAD_URL };
    else this.st = { ...this.st, status: "done", percent: 100, message: dry ? "Practice run finished. Nothing was installed." : "The video engine is installed." };
    await this.o.onFinished?.(this.st.status === "done" && !dry);
  }
}

/** The stand-in used for a practice run: prints believable progress and installs nothing. */
const practiceRun: RunFn = () => {
  const subs: ((l: string) => void)[] = [];
  let stop = false;
  const exited = (async () => { for (const p of [10, 40, 70, 100]) { if (stop) return null; await new Promise((r) => setTimeout(r, 250)); subs.forEach((f) => f(`practice run ${p}%`)); } return 0; })();
  return { onLine: (cb) => subs.push(cb), kill: () => { stop = true; }, exited };
};
