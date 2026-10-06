import { expect, test } from "bun:test";
import { ObsInstaller, explainFailure, installPlan, parsePercent, type Proc, type RunFn } from "./obs-install";

test("install plan per platform: exactly the documented commands", () => {
  expect(installPlan("win32", { winget: true })).toMatchObject({ method: "winget", steps: [{ cmd: ["winget", "install", "-e", "--id", "OBSProject.OBSStudio", "--silent", "--accept-package-agreements", "--accept-source-agreements"] }] });
  expect(installPlan("darwin", { brew: true })).toMatchObject({ method: "brew", steps: [{ cmd: ["brew", "install", "--cask", "obs"] }] });
  const fp = installPlan("linux", { flatpak: true, flathubUser: true });
  expect(fp.steps.map((s) => s.cmd)).toEqual([["flatpak", "install", "--user", "-y", "--noninteractive", "flathub", "com.obsproject.Studio"]]);
  const fp2 = installPlan("linux", { flatpak: true, flathubUser: false }); // flathub remote is added first
  expect(fp2.steps.map((s) => s.cmd.slice(0, 3).join(" "))).toEqual(["flatpak remote-add --user", "flatpak install --user"]);
  expect(fp2.steps[0].cmd).toContain("--if-not-exists");
  for (const [os, t] of [["win32", {}], ["darwin", {}], ["linux", {}], ["win32", { brew: true }], ["freebsd", { flatpak: true }]] as const) {
    const p = installPlan(os, t);
    expect(p).toMatchObject({ method: "download", steps: [], downloadUrl: "https://obsproject.com/download" }); // no installer tool: official page
  }
});

test("progress parsing handles winget, brew and flatpak style lines", () => {
  expect(parsePercent("  ██████░░░░░░  45%")).toBe(45);
  expect(parsePercent("######## 100.0%")).toBe(100);
  expect(parsePercent("Installing… ███▒ 7%")).toBe(7);
  expect(parsePercent("==> Installing Cask obs")).toBeNull();
  expect(parsePercent("abc 250%")).toBeNull();
});

test("failures become plain sentences, never raw tool output", () => {
  expect(explainFailure("flatpak", 1, "error: Failed to download: Could not resolve host")).toContain("internet connection");
  expect(explainFailure("flatpak", 1, "error: Remote “flathub” not found")).toContain("Flathub");
  expect(explainFailure("winget", 1, "0x80072ee7 : unable to connect")).toContain("internet");
  expect(explainFailure("winget", 1, "Access is denied")).toContain("did not allow");
  expect(explainFailure("brew", 1, "Error: Cask 'obs' is unavailable")).toContain("package manager");
  expect(explainFailure("brew", 1, "write error: No space left on device")).toContain("disk space");
  expect(explainFailure("brew", 1, "")).toContain("did not finish");
  expect(explainFailure("brew", null, "")).toContain("stopped");
});

// STUB PROCESSES: nothing below runs winget, brew or flatpak. They stand in for them to exercise our own streaming, cancel and finish logic.
const stub = (lines: string[], code: number | null, ms = 5): RunFn => () => {
  const subs: ((l: string) => void)[] = []; let killed = false;
  const exited = new Promise<number | null>((done) => { setTimeout(async () => { for (const l of lines) { if (killed) break; subs.forEach((f) => f(l)); await Bun.sleep(ms); } done(killed ? null : code); }, 1); });
  return { onLine: (cb) => subs.push(cb), kill: () => { killed = true; }, exited } as Proc;
};
const until = async (f: () => boolean) => { for (let i = 0; i < 400 && !f(); i++) await Bun.sleep(5); };

test("installer streams progress, then re-detects and reports done (stub process)", async () => {
  let installed = false, finished: boolean | undefined;
  const run: RunFn = (cmd) => { const p = stub(["Installing 10%", "Installing 60%"], 0)(cmd); p.exited.then(() => { installed = true; }); return p; };
  const inst = new ObsInstaller({ tools: () => ({ flatpak: true, flathubUser: true }), platform: "linux", run, isInstalled: () => installed, onFinished: (ok) => { finished = ok; } });
  const s0 = inst.start();
  expect(s0).toMatchObject({ status: "running", method: "flatpak", steps: 1 });
  await until(() => inst.state().status !== "running");
  expect(inst.state()).toMatchObject({ status: "done", percent: 100, message: "The video engine is installed." });
  expect(inst.state().lines).toContain("Installing 60%");
  expect(finished).toBe(true);
});

test("two steps run in order and a failing first step stops the second", async () => {
  const ran: string[] = [];
  const run: RunFn = (cmd) => { ran.push(cmd[1]); return stub(["error: Failed to download: Could not resolve host"], ran.length === 1 ? 1 : 0)(cmd); };
  const inst = new ObsInstaller({ tools: () => ({ flatpak: true, flathubUser: false }), platform: "linux", run, isInstalled: () => true });
  inst.start();
  await until(() => inst.state().status !== "running");
  expect(ran).toEqual(["remote-add"]);
  expect(inst.state()).toMatchObject({ status: "failed" });
  expect(inst.state().message).toContain("internet connection");
});

test("cancel stops the running process and says so", async () => {
  const inst = new ObsInstaller({ tools: () => ({ brew: true }), platform: "darwin", run: stub(Array.from({ length: 200 }, (_, i) => `${i}%`), 0, 10), isInstalled: () => true });
  inst.start();
  await Bun.sleep(40);
  expect(inst.cancel().status).toBe("running");
  await until(() => inst.state().status !== "running");
  expect(inst.state()).toMatchObject({ status: "cancelled", message: "Installation cancelled." });
});

test("an installer that exits 0 but leaves no OBS behind is a failure, not a success", async () => {
  const inst = new ObsInstaller({ tools: () => ({ winget: true }), platform: "win32", run: stub(["done"], 0), isInstalled: () => false });
  inst.start(); await until(() => inst.state().status !== "running");
  expect(inst.state().status).toBe("failed"); expect(inst.state().downloadUrl).toContain("obsproject.com");
});

test("no installer tool: the official download page is offered, nothing is run", async () => {
  let ran = 0;
  const inst = new ObsInstaller({ tools: () => ({}), platform: "linux", run: () => { ran++; return stub([], 0)([]); }, isInstalled: () => false });
  const s = inst.start();
  expect(s).toMatchObject({ status: "failed", method: "download", downloadUrl: "https://obsproject.com/download" });
  expect(ran).toBe(0);
});

test("practice run (dryRun) exercises the flow and installs nothing", async () => {
  let ran = 0, finished: boolean | undefined;
  const inst = new ObsInstaller({ tools: () => ({ flatpak: true, flathubUser: true }), platform: "linux", run: () => { ran++; return stub([], 0)([]); }, isInstalled: () => false, onFinished: (ok) => { finished = ok; } });
  expect(inst.start({ dryRun: true }).dryRun).toBe(true);
  await until(() => inst.state().status !== "running");
  expect(inst.state()).toMatchObject({ status: "done", dryRun: true });
  expect(inst.state().message).toContain("Nothing was installed");
  expect(ran).toBe(0); expect(finished).toBe(false); // the real runner was never used and callers are told it was not a real install
});
