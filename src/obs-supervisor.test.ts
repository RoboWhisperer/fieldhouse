import { expect, test } from "bun:test";
import { BACKOFF_S, MAX_RESTARTS, MESSAGES, ObsSupervisor, STUCK_S, type SupervisorDeps } from "./obs-supervisor";

// A tiny fake world: a clock, a process table, a websocket flag and a record of what was called.
function world(o: { installed?: boolean; running?: number[]; wsUp?: boolean; password?: string; owned?: number | null } = {}) {
  const w = {
    t: 1_000_000, pids: o.running ?? [], ws: o.wsUp ?? false, installed: o.installed ?? true, owned: o.owned ?? null as number | null,
    prepared: [] as string[], launched: 0, stopped: [] as number[], saved: [] as [string, string][], notices: [] as string[], connected: false, auth: false, password: o.password as string | undefined,
    launchFails: false, nextPid: 500, changed: 0,
  };
  const deps: SupervisorDeps = {
    detect: () => ({ installed: w.installed, kind: "flatpak", launch: [] }),
    pids: () => [...w.pids],
    wsAnswers: async () => w.ws,
    prepare: ({ password }) => { w.prepared.push(password); return { port: 4455 }; },
    launch: async () => { w.launched++; if (w.launchFails) { w.pids = [++w.nextPid]; throw new Error("timeout"); } w.pids = [++w.nextPid]; w.ws = true; w.connected = true; return { pid: w.nextPid }; },
    stop: async (_k, pid) => { w.stopped.push(pid); w.pids = w.pids.filter((p) => p !== pid); w.ws = false; w.connected = false; return true; },
    newPassword: () => "generated-pw",
    ownedPid: { read: () => w.owned, write: (p) => { w.owned = p; } },
    now: () => w.t,
  };
  const sup = new ObsSupervisor(deps, {
    url: () => "ws://127.0.0.1:4455", password: () => w.password, dirs: () => ["/rec"],
    credentials: (u, p) => { w.saved.push([u, p]); w.password = p; },
    connected: () => w.connected, authFailed: () => w.auth,
    notice: (_l, m) => w.notices.push(m), changed: () => { w.changed++; },
  });
  return { w, sup };
}
const die = (w: ReturnType<typeof world>["w"]) => { w.pids = []; w.ws = false; w.connected = false; };

test("cold start: not running -> prepares with a generated password, launches, owns it", async () => {
  const { w, sup } = world();
  await sup.start();
  expect(w.prepared).toEqual(["generated-pw"]);
  expect(w.saved).toEqual([["ws://127.0.0.1:4455", "generated-pw"]]); // password goes to settings through the callback, nothing else
  expect(w.launched).toBe(1);
  expect(sup.status()).toMatchObject({ state: "running", owned: true });
  expect(w.owned).toBe(501);
  await sup.shutdown();
});

test("a saved password is reused, never regenerated", async () => {
  const { w, sup } = world({ password: "saved-pw" });
  await sup.start();
  expect(w.prepared).toEqual(["saved-pw"]);
  await sup.shutdown();
});

test("adopts an OBS that is already open: never launches, never closes it", async () => {
  const { w, sup } = world({ running: [77], wsUp: true });
  w.connected = true; w.password = "users-pw";
  await sup.start();
  expect(sup.status()).toMatchObject({ state: "adopted", owned: false });
  expect(w.launched).toBe(0); expect(w.prepared).toEqual([]);
  expect((await sup.shutdown()).closed).toBe(false);
  expect(w.stopped).toEqual([]);
  expect(w.pids).toEqual([77]); // still running
});

test("owned by pid file (Fieldhouse restarted, OBS survived): still ours, closed on quit", async () => {
  const { w, sup } = world({ running: [77], wsUp: true, owned: 77 });
  w.connected = true;
  await sup.start();
  expect(sup.status()).toMatchObject({ state: "running", owned: true });
  expect((await sup.shutdown()).closed).toBe(true);
  expect(w.stopped).toEqual([77]); expect(w.owned).toBeNull();
});

test("a pid file for a process that is gone does not make us close somebody else's OBS", async () => {
  const { w, sup } = world({ running: [88], wsUp: true, owned: 77 }); // 77 died; 88 is the user's own OBS
  w.connected = true;
  await sup.start();
  expect(sup.status().owned).toBe(false);
  expect((await sup.shutdown()).closed).toBe(false); expect(w.stopped).toEqual([]);
});

test("OBS open but its websocket is off and it is not ours: asks the user to close it, never touches it", async () => {
  const { w, sup } = world({ running: [90], wsUp: false });
  await expect(sup.start()).rejects.toThrow("remote control turned off");
  expect(sup.status().state).toBe("needs-close");
  expect(w.launched).toBe(0); expect(w.stopped).toEqual([]);
});

test("not installed: plain state, nothing launched", async () => {
  const { w, sup } = world({ installed: false });
  await expect(sup.start()).rejects.toThrow("not installed");
  expect(sup.status()).toMatchObject({ state: "not-installed", message: MESSAGES["not-installed"] });
  expect(w.launched).toBe(0);
});

test("watchdog: OBS dies -> 'Restarting' -> relaunched, no manual step", async () => {
  const { w, sup } = world();
  await sup.start();
  die(w);
  await sup.tick();
  expect(w.launched).toBe(2);
  expect(w.notices[0]).toContain("starting it again");
  expect(sup.status()).toMatchObject({ state: "running", restarts: 1 });
  expect(w.owned).toBe(502);
});

test("watchdog shows 'Restarting the video engine...' while it waits out the backoff, and gives up after MAX_RESTARTS", async () => {
  const { w, sup } = world();
  await sup.start();
  w.launchFails = true;
  die(w);
  const seen = new Set<string>();
  for (let i = 0; i < 60 && sup.status().state !== "failed"; i++) { await sup.tick(); seen.add(sup.status().message); die(w); w.t += 5_000; }
  expect(seen.has("Restarting the video engine...")).toBe(true);
  expect(sup.status().state).toBe("failed");
  expect(sup.status().message).toBe(MESSAGES.failed);
  expect(w.launched).toBe(1 + MAX_RESTARTS);
  expect(BACKOFF_S.length).toBeGreaterThanOrEqual(MAX_RESTARTS);
  const n = w.launched; w.t += 120_000; await sup.tick(); expect(w.launched).toBe(n); // stays given up until the operator presses Try again
  w.launchFails = false;
  await sup.retry();
  expect(sup.status().state).toBe("running");
});

test("a relaunch waits for the backoff between attempts", async () => {
  const { w, sup } = world();
  await sup.start();
  w.launchFails = true;
  die(w); await sup.tick();            // attempt 1 fails immediately (backoff 0)
  die(w); await sup.tick();            // attempt 2 must wait BACKOFF_S[1] = 2 s
  expect(w.launched).toBe(2);
  w.t += 1_000; die(w); await sup.tick(); expect(w.launched).toBe(2);
  w.t += 2_000; die(w); await sup.tick(); expect(w.launched).toBe(3);
});

test("a launch that failed but left a process behind: that process is ours and gets closed on quit", async () => {
  const { w, sup } = world();
  w.launchFails = true;
  await expect(sup.start()).rejects.toThrow("timeout");
  expect(w.owned).toBe(501);
  w.launchFails = false;
  expect((await sup.shutdown()).closed).toBe(true);
  expect(w.stopped).toEqual([501]);
});

test("restart counter resets after the engine has been up for a minute", async () => {
  const { w, sup } = world();
  await sup.start();
  die(w); await sup.tick();
  expect(sup.status().restarts).toBe(1);
  await sup.tick(); w.t += 61_000; await sup.tick();
  expect(sup.status().restarts).toBe(0);
});

test("a frozen engine that WE started is closed and restarted; a frozen engine that is not ours is left alone", async () => {
  const a = world();
  await a.sup.start();
  a.w.connected = false; a.w.ws = false; // still a process, but silent
  await a.sup.tick(); expect(a.w.stopped).toEqual([]);
  a.w.t += (STUCK_S + 1) * 1000; await a.sup.tick();
  expect(a.w.stopped).toEqual([501]);
  expect(a.w.notices.some((n) => n.includes("stopped responding"))).toBe(true);
  const b = world({ running: [90], wsUp: true }); b.w.connected = true; b.w.password = "pw";
  await b.sup.start();
  b.w.connected = false; b.w.ws = false;
  for (let i = 0; i < 10; i++) { b.w.t += 10_000; await b.sup.tick(); }
  expect(b.w.stopped).toEqual([]); expect(b.sup.status().state).toBe("needs-close");
});

test("wrong password on an adopted OBS says so instead of retrying forever", async () => {
  const { w, sup } = world({ running: [77], wsUp: true });
  await sup.start();
  w.auth = true; w.connected = false;
  await sup.tick();
  expect(sup.status().state).toBe("needs-password");
  expect(w.launched).toBe(0);
});

test("disable() stops watching without touching OBS", async () => {
  const { w, sup } = world();
  await sup.start();
  sup.disable();
  die(w); await sup.tick();
  expect(w.launched).toBe(1); expect(sup.status().state).toBe("off");
});

test("applying video settings: closes OUR obs cleanly, writes the profile, relaunches, shows 'Applying video settings...'", async () => {
  const { w, sup } = world();
  const seen: string[] = [];
  const orig = (sup as any).set.bind(sup); (sup as any).set = (st: any, m?: string) => { orig(st, m); seen.push(sup.status().message); };
  await sup.start();
  const first = w.owned;
  await sup.restartForSettings();
  expect(w.stopped).toEqual([first]);
  expect(w.launched).toBe(2);
  expect(seen).toContain("Applying video settings...");
  expect(seen).not.toContain("Restarting the video engine..."); // the watchdog did not mistake it for a crash
  expect(sup.status()).toMatchObject({ state: "running", owned: true });
  await sup.shutdown();
});

test("applying video settings never closes an OBS Fieldhouse did not start", async () => {
  const { w, sup } = world({ running: [77], wsUp: true }); w.connected = true;
  await sup.start();
  await expect(sup.restartForSettings()).rejects.toThrow("not started by Fieldhouse");
  expect(w.stopped).toEqual([]); expect(w.pids).toEqual([77]);
});
