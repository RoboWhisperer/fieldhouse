// HTTP routes for the video engine (OBS): status, start/restart, install. Registered once from createApp.
// The volunteer never opens OBS: Fieldhouse starts, watches, restarts and (if it started it) stops the engine (obs-supervisor.ts).
import { paths } from "./config";
import * as data from "./data";
import { SwitchableEngine } from "./engine";
import { detectObs, detectTools, obsRunning, type ObsInstall } from "./obs-manager";
import type { ObsInstaller } from "./obs-install";
import type { ObsSupervisor } from "./obs-supervisor";
import type { Store } from "./store";
import type { DeviceInfo, Engine } from "./types";

type On = (method: string, pattern: string, h: (a: { body: any }) => unknown) => void;
let cached: { at: number; install: ObsInstall } | undefined;
export const detectCached = (fresh = false) => (!fresh && cached && Date.now() - cached.at < 30_000 ? cached.install : (cached = { at: Date.now(), install: detectObs() }).install);
export interface EngineHooks { supervisor?: ObsSupervisor; installer?: ObsInstaller }

export function registerEngineRoutes(on: On, c: { engine: Engine; store: Store; bad: (msg: string, status?: number) => never; changed: () => void; hooks: EngineHooks }) {
  const { engine, store, bad, changed, hooks } = c;
  const raw = () => data.getSettings(store);
  const sw = () => ((engine as SwitchableEngine).swap ? (engine as SwitchableEngine) : bad("This build cannot switch engines at runtime.", 501));
  const info = () => {
    const st = engine.status(), ins = detectCached(), e = raw().engine;
    return {
      installed: ins.installed, kind: ins.kind ?? null, version: ins.version ?? null, running: obsRunning(),
      engine: st.engine, connected: st.engine === "obs" && st.connected, url: e.obsUrl, passwordSet: !!e.obsPassword,
      provisioned: !!st.obs?.provisioned, error: st.engine === "obs" ? st.obs?.error ?? null : null, created: st.obs?.created ?? [], notes: st.obs?.notes ?? [],
      replayBuffer: !!st.obs?.replayBuffer, profile: st.obs?.profile ?? null, demoAllowed: !paths().packaged || process.env.DEMO === "1",
      managed: st.obs?.managed ?? null, replaySeconds: raw().video.replaySeconds, install: hooks.installer?.state() ?? null,
    };
  };
  const settled = async (ms: number) => { const end = Date.now() + ms; while (Date.now() < end) { const s = engine.status(); if (s.connected && s.obs?.provisioned) break; if (s.obs?.error?.includes("password")) break; await Bun.sleep(150); } };

  on("GET", "/engine/obs", () => info());

  /** launch = Fieldhouse starts (or re-adopts) the video engine; connect = the user typed the address/password of an OBS they run themselves. */
  on("POST", "/engine/obs/connect", async ({ body }) => {
    const mode = body?.mode;
    const sup = hooks.supervisor ?? bad("The video engine manager is not running in this build.", 501);
    if (mode === "connect") {
      const cur = raw().engine;
      const url = typeof body.url === "string" && body.url.trim() ? body.url.trim() : cur.obsUrl;
      const pw = typeof body.password === "string" && body.password ? body.password : undefined; // blank keeps the saved one
      try { data.saveSettings(store, { engine: { kind: "obs", obsUrl: url, ...(pw !== undefined ? { obsPassword: pw } : {}) } }); } catch (e: any) { bad(e.message); }
      await sw().swap("obs", { obsUrl: raw().engine.obsUrl, obsPassword: raw().engine.obsPassword });
    } else if (mode === "launch") {
      if (engine.status().engine !== "obs") { data.saveSettings(store, { engine: { kind: "obs" } }); await sw().swap("obs", { obsUrl: raw().engine.obsUrl, obsPassword: raw().engine.obsPassword }); }
      if (!detectCached(true).installed) bad("The video engine is not installed yet. Press Install video engine.");
    } else bad('mode must be "launch" or "connect".');
    try { await sup.retry(); } catch (e: any) { bad(e.message); }
    changed();
    await settled(15_000);
    return info();
  });

  on("POST", "/engine/obs/provision", async () => {
    if (engine.status().engine !== "obs") bad("Switch to the video engine first.", 409);
    try { await engine.provision?.(); } catch (e: any) { bad(e.message); }
    changed();
    return info();
  });

  // ---- install: start, poll, cancel. dryRun runs the same flow with a harmless stand-in (nothing is installed).
  const installer = () => hooks.installer ?? bad("Installing is not available in this build.", 501);
  on("GET", "/engine/obs/install", () => ({ ...installer().state(), plan: detectTools() }));
  on("POST", "/engine/obs/install", ({ body }) => {
    if (detectCached(true).installed && body?.dryRun !== true) bad("The video engine is already installed.", 409);
    return installer().start({ dryRun: body?.dryRun === true });
  });
  on("POST", "/engine/obs/install/cancel", () => installer().cancel());

  on("POST", "/engine/use-fake", async () => {
    if (paths().packaged && process.env.DEMO !== "1") bad("The demo engine is only for development.", 403);
    hooks.supervisor?.disable();
    data.saveSettings(store, { engine: { kind: "fake" } });
    await sw().swap("fake", {});
    changed();
    return info();
  });

  on("POST", "/devices/network", async ({ body }): Promise<DeviceInfo> => {
    if (!engine.addNetworkSource) bad("This engine cannot add network sources.");
    try { const d = await engine.addNetworkSource!(String(body?.url ?? ""), String(body?.label ?? "")); changed(); return d; } catch (e: any) { return bad(e.message); }
  });
}
