// The automation host: custom data, rules/macros runner, webhooks, event stream, workspace sections. Built once in createApp()
// and given the few things it may touch (src/custom-types.ts: ActionContext). It never blocks or throws into request handling.
import type { ActionContext, GameView, GraphicsControl } from "../custom-types";
import type { Engine } from "../types";
import type { Store } from "../store";
import * as diag from "../diagnostics";
import { createBus } from "./bus";
import { createCustom } from "./custom";
import { createRunner } from "./runner";
import { registerOwnSections } from "./sections";
import { createWebhooks } from "./webhooks";
import { createWorkspace, useWorkspace } from "./workspace";

export interface AutomationDeps {
  store: Store; engine: Engine; now: () => number; fetch?: typeof fetch;
  graphics: () => GraphicsControl | undefined; // supplied late by the graphics runtime; absent = graphics actions fail politely
  event: ActionContext["event"]; fireSponsor: ActionContext["fireSponsor"];
  notify: (level: "info" | "warn", message: string) => void; changed: () => void;
  view: () => GameView | null; gameId: () => string | null;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>; // tests inject a fast clock
}

const NO_GRAPHICS = () => new Error("Graphics are not available yet.");
export function createAutomation(deps: AutomationDeps) {
  const { store, now } = deps;
  const bus = createBus(now);
  const workspace = createWorkspace();
  useWorkspace(workspace); // sections registered later in createApp() land here
  const log: ActionContext["log"] = (level, message) => diag.log(level, message);
  const g = (): GraphicsControl => deps.graphics() ?? ({ list: () => [], show: async () => { throw NO_GRAPHICS(); }, hide: async () => { throw NO_GRAPHICS(); }, toggle: async () => { throw NO_GRAPHICS(); }, update: async () => { throw NO_GRAPHICS(); }, next: async () => { throw NO_GRAPHICS(); }, clear: async () => { throw NO_GRAPHICS(); } });
  const graphics: GraphicsControl = { list: () => g().list(), show: (id, f) => g().show(id, f), hide: (id) => g().hide(id), toggle: (id) => g().toggle(id), update: (id, f) => g().update(id, f), next: (id) => g().next(id), clear: () => g().clear() };

  // `runner` is assigned below; the custom store only calls back after construction.
  let runner: ReturnType<typeof createRunner>;
  const custom = createCustom(store, (k, v, o) => { runner?.onCustom(k, v, o); deps.changed(); });
  const webhooks = createWebhooks({ store, bus, now, fetch: () => deps.fetch ?? globalThis.fetch, log });
  runner = createRunner({
    graphics, engine: deps.engine, custom, event: deps.event, fireSponsor: deps.fireSponsor, log,
    store, bus, now, notify: deps.notify, view: deps.view, gameId: deps.gameId, fetch: () => deps.fetch ?? globalThis.fetch, mirror: log, sleep: deps.sleep,
  });
  runner.onEngine(deps.engine.status()); // the starting point, so the first real change is noticed
  registerOwnSections(workspace, { store, custom, webhooks, now, changed: deps.changed, forget: (id) => runner.forget(id) });
  return {
    bus, custom, webhooks, runner, workspace, now,
    onEvent: runner.onEvent, onEngine: runner.onEngine, onSponsor: runner.onSponsor, onGameEnd: runner.onGameEnd, tick: runner.tick,
    stop() { runner.cancelAll(); webhooks.stop(); },
  };
}
export type Automation = ReturnType<typeof createAutomation>;
