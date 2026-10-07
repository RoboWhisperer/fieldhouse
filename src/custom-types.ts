// Shared contract for the customization work: graphics, automation, custom data and profiles.
// Several modules are written in parallel against THESE interfaces. Change here first, then everywhere.
import type { Engine } from "./types";

/** Values templates can read. Flat map with dotted keys, e.g. "home.score", "clock", "custom.sponsorLine". */
export type VarMap = Record<string, string | number | boolean>;

/** What the graphics runtime exposes to automation, routes and the console. Implemented in src/graphics/ (graphics agent). */
export interface GraphicsControl {
  list(): { id: string; name: string; kind: string; role: string; visible: boolean; enabled: boolean }[];
  show(id: string, fields?: Record<string, string>): Promise<void>; // optional fields override bindings for this showing
  hide(id: string): Promise<void>;
  toggle(id: string): Promise<void>;
  update(id: string, fields: Record<string, string>): Promise<void>; // change data while on air
  next(id: string): Promise<void>; // CasparCG-style next() step for multi-step templates
  clear(): Promise<void>; // take every graphic off air
}

/** Custom operator-defined data ("custom.<key>" in templates and rules). Implemented in src/automation/ (automation agent). */
export interface CustomData {
  all(): Record<string, string>;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** Everything an automation action may touch. Built once in src/app.ts and passed to the automation host. */
export interface ActionContext {
  graphics: GraphicsControl;
  engine: Engine;
  custom: CustomData;
  /** Append a game event exactly like POST /api/event (same validation). */
  event(body: unknown): Promise<unknown>;
  /** Fire a sponsor break like POST /api/sponsors/fire. */
  fireSponsor(body?: { sponsorId?: string; outcome?: "aired" | "skipped" | "delayed" }): Promise<unknown>;
  /** Plain-language log line for the Automation run log and diagnostics. */
  log(level: "INFO" | "WARN" | "ERROR", message: string): void;
}

/** Game state as the variable builder and rules see it: the shape produced by `view()` in src/game.ts, plus optional profile data. */
export interface GameView {
  period: number;
  clockMs: number;
  running: boolean;
  home: TeamView;
  away: TeamView;
  /** Generic counters from the sport profile (fouls, timeouts, penalties, downs...). Basketball keeps fouls/timeouts on the team too. */
  counters?: Record<string, { home: number; away: number }>;
  periodLabel?: string; // "Q3", "2nd half", "Set 2"
}
export interface TeamView { abbr: string; name: string; score: number; fouls: number; timeouts: number; bonus: boolean }
