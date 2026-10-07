// Shared by the automation tests: an in-memory automation host with recording stubs for graphics, video, events and web requests.
import type { GameView, GraphicsControl } from "../custom-types";
import { FakeEngine } from "../engine";
import { openStore } from "../store";
import { createAutomation } from "./index";
import { parseMacro, parseRule } from "./model";

export const mkView = (o: Partial<GameView> & { h?: number; a?: number } = {}): GameView => ({
  period: o.period ?? 1, clockMs: o.clockMs ?? 480_000, running: o.running ?? false,
  home: { abbr: "HOM", name: "Home", score: o.h ?? 0, fouls: 0, timeouts: 3, bonus: false, ...(o.home ?? {}) },
  away: { abbr: "AWY", name: "Away", score: o.a ?? 0, fouls: 0, timeouts: 3, bonus: false, ...(o.away ?? {}) },
});

export function rig(o: { fetch?: typeof fetch; hasGraphics?: boolean; sleep?: (ms: number, signal?: AbortSignal) => Promise<void>; onEvent?: (b: any, auto: () => ReturnType<typeof createAutomation>) => void } = {}) {
  const store = openStore(":memory:");
  const t = { now: 1_000_000 };
  const calls: string[] = [];
  const notices: { level: string; message: string }[] = [];
  const g: GraphicsControl = {
    list: () => [{ id: "lt", name: "Lower third", kind: "lower", role: "lower", visible: false, enabled: true }, { id: "tick", name: "Ticker", kind: "ticker", role: "ticker", visible: false, enabled: true }],
    show: async (id, f) => { calls.push(`show ${id} ${JSON.stringify(f ?? {})}`); },
    hide: async (id) => { calls.push(`hide ${id}`); }, toggle: async (id) => { calls.push(`toggle ${id}`); },
    update: async (id, f) => { calls.push(`update ${id} ${JSON.stringify(f)}`); }, next: async (id) => { calls.push(`next ${id}`); }, clear: async () => { calls.push("clear"); },
  };
  const engine = new FakeEngine();
  const e: any = engine;
  e.setPreview = async (id: string) => { calls.push(`preview ${id}`); }; e.cut = async () => { calls.push("cut"); }; e.fade = async (ms: number) => { calls.push(`fade ${ms}`); };
  e.replay = async (r: any) => { calls.push(`replay ${r.secondsBack} ${r.speed}`); }; e.stopReplay = async () => { calls.push("replay.stop"); }; e.setMute = async (id: string, m: boolean) => { calls.push(`mute ${id} ${m}`); };
  const sent: { url: string; init: any }[] = [];
  const fetchMock: typeof fetch = o.fetch ?? (async (url: any, init: any) => { sent.push({ url: String(url), init }); return new Response("ok", { status: 200 }); }) as any;
  const state = { game: mkView() as GameView | null, gameId: "g1" as string | null };
  const auto: ReturnType<typeof createAutomation> = createAutomation({
    store, engine, now: () => t.now, fetch: fetchMock,
    graphics: () => (o.hasGraphics === false ? undefined : g),
    event: async (b) => { calls.push(`event ${JSON.stringify(b)}`); o.onEvent?.(b, () => auto); return b; },
    fireSponsor: async (b) => { calls.push(`sponsor ${JSON.stringify(b ?? {})}`); return {}; },
    notify: (level, message) => notices.push({ level, message }), changed: () => {},
    view: () => state.game, gameId: () => state.gameId, sleep: o.sleep ?? (async () => {}),
  });
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); };
  return { store, auto, t, calls, notices, sent, state, settle, engine, g };
}
export const addRule = (r: { store: any; t: { now: number } }, body: any) => { const x = parseRule({ name: "r", actions: [{ type: "log", message: "hi" }], ...body }, undefined, r.t.now); r.store.put("rule", x); return x; };
export const addMacro = (r: { store: any; t: { now: number } }, body: any) => { const x = parseMacro({ label: "m", actions: [{ type: "log", message: "hi" }], ...body }, undefined, r.t.now); r.store.put("macro", x); return x; };
export type Rig = ReturnType<typeof rig>;
