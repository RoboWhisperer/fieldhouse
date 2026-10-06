// HTTP routes for choosing and managing the media engine (OBS). Registered once from createApp.
import { paths } from "./config";
import * as data from "./data";
import { SwitchableEngine } from "./engine";
import { DEFAULT_PORT, detectObs, ensureWebsocketConfig, launchObs, newPassword, obsRunning, wsAnswers, wsUrl, type ObsInstall } from "./obs-manager";
import type { Store } from "./store";
import type { DeviceInfo, Engine } from "./types";

type On = (method: string, pattern: string, h: (a: { body: any }) => unknown) => void;
let cached: { at: number; install: ObsInstall } | undefined;
const install = (fresh = false) => (!fresh && cached && Date.now() - cached.at < 30_000 ? cached.install : (cached = { at: Date.now(), install: detectObs() }).install);
const portOf = (url: string) => Number(/:(\d+)/.exec(url)?.[1]) || DEFAULT_PORT;

export function registerEngineRoutes(on: On, c: { engine: Engine; store: Store; bad: (msg: string, status?: number) => never; changed: () => void }) {
  const { engine, store, bad, changed } = c;
  const raw = () => data.getSettings(store);
  const sw = () => ((engine as SwitchableEngine).swap ? (engine as SwitchableEngine) : bad("This build cannot switch engines at runtime.", 501));
  const use = async (kind: "fake" | "obs", patch: { obsUrl?: string; obsPassword?: string } = {}) => {
    data.saveSettings(store, { engine: { kind, ...patch } });
    const e = raw().engine;
    await sw().swap(kind, { obsUrl: e.obsUrl, obsPassword: e.obsPassword });
    changed();
  };
  const info = () => {
    const st = engine.status(), ins = install(), e = raw().engine;
    return {
      installed: ins.installed, kind: ins.kind ?? null, version: ins.version ?? null, running: obsRunning(),
      engine: st.engine, connected: st.engine === "obs" && st.connected, url: e.obsUrl, passwordSet: !!e.obsPassword,
      provisioned: !!st.obs?.provisioned, error: st.engine === "obs" ? st.obs?.error ?? null : null, created: st.obs?.created ?? [], notes: st.obs?.notes ?? [],
      replayBuffer: !!st.obs?.replayBuffer, profile: st.obs?.profile ?? null, demoAllowed: !paths().packaged || process.env.DEMO === "1",
    };
  };
  const settled = async (ms: number) => { const end = Date.now() + ms; while (Date.now() < end) { const s = engine.status(); if (s.connected && s.obs?.provisioned) break; if (s.obs?.error?.includes("password")) break; await Bun.sleep(150); } };

  on("GET", "/engine/obs", () => info());

  on("POST", "/engine/obs/connect", async ({ body }) => {
    const mode = body?.mode;
    const cur = raw();
    if (mode === "connect") {
      const url = typeof body.url === "string" && body.url.trim() ? body.url.trim() : cur.engine.obsUrl;
      const pw = typeof body.password === "string" && body.password ? body.password : undefined; // blank keeps the saved one
      try { await use("obs", { obsUrl: url, ...(pw !== undefined ? { obsPassword: pw } : {}) }); } catch (e: any) { bad(e.message); }
    } else if (mode === "launch") {
      const ins = install(true);
      if (!ins.installed) bad("OBS Studio is not installed. Install it from obsproject.com, then press Launch again.");
      let port = portOf(cur.engine.obsUrl), pw = cur.engine.obsPassword || newPassword();
      if (obsRunning() || (await wsAnswers(wsUrl(port)))) {
        if (!cur.engine.obsPassword) bad("OBS is already open. Close OBS so Fieldhouse can set it up, or choose Connect and type OBS's websocket password.");
      } else {
        try { port = ensureWebsocketConfig({ password: pw, install: ins, port }).port; await launchObs({ port, install: ins, dirs: [cur.storageDir] }); } catch (e: any) { bad(e.message); }
      }
      await use("obs", { obsUrl: wsUrl(port), obsPassword: pw });
    } else bad('mode must be "launch" or "connect".');
    await settled(12_000);
    return info();
  });

  on("POST", "/engine/obs/provision", async () => {
    if (engine.status().engine !== "obs") bad("Switch to OBS first.", 409);
    try { await engine.provision?.(); } catch (e: any) { bad(e.message); }
    changed();
    return info();
  });

  on("POST", "/engine/use-fake", async () => {
    if (paths().packaged && process.env.DEMO !== "1") bad("The demo engine is only for development.", 403);
    await use("fake");
    return info();
  });

  on("POST", "/devices/network", async ({ body }): Promise<DeviceInfo> => {
    if (!engine.addNetworkSource) bad("This engine cannot add network sources.");
    try { const d = await engine.addNetworkSource!(String(body?.url ?? ""), String(body?.label ?? "")); changed(); return d; } catch (e: any) { return bad(e.message); }
  });
}
