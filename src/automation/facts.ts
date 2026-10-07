// Facts: the flat name -> value map that conditions read and {{templates}} fill from. ONE function builds it (buildFacts).
// When the graphics agent's shared variable builder lands, swap the body of `gameFacts` for it; nothing else changes.
import type { EngineStatus } from "../types";
import type { GameView, VarMap } from "../custom-types";

export const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

/** Game facts: period, clock (ms), clockText, running, home.*, away.*, diff (home minus away), lead (absolute), plus sport-profile counters. */
export function gameFacts(g: GameView | null | undefined, prefix = ""): VarMap {
  if (!g) return {};
  const f: VarMap = { period: g.period, clock: Math.round(g.clockMs), clockSec: Math.ceil(g.clockMs / 1000), clockText: mmss(g.clockMs), running: g.running, diff: g.home.score - g.away.score, lead: Math.abs(g.home.score - g.away.score) };
  if (g.periodLabel) f.periodLabel = g.periodLabel;
  for (const t of ["home", "away"] as const) for (const [k, v] of Object.entries(g[t])) f[`${t}.${k}`] = v as string | number | boolean;
  for (const [k, c] of Object.entries(g.counters ?? {})) { f[`counter.${k}.home`] = c.home; f[`counter.${k}.away`] = c.away; }
  if (!prefix) return f;
  return Object.fromEntries(Object.entries(f).map(([k, v]) => [prefix + k, v]));
}

export function engineFacts(e: EngineStatus | undefined): VarMap {
  if (!e) return {};
  return {
    "engine.connected": e.connected, "engine.live": e.stream.live, "engine.reconnecting": e.stream.reconnecting, "engine.recording": e.record.active,
    "engine.replaying": !!e.replay?.active, "engine.program": e.program ?? "", "engine.preview": e.preview ?? "", "engine.cpu": Math.round(e.cpu),
    "engine.kbps": Math.round(e.stream.kbps), "engine.droppedFrames": e.stream.droppedFrames,
  };
}

/** Flatten an arbitrary small object into facts under a prefix ("event.team", "trigger.data.name"). Only scalars, depth <= 2. */
export function flatten(prefix: string, o: unknown, depth = 0): VarMap {
  const out: VarMap = {};
  if (!o || typeof o !== "object" || depth > 2) return out;
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(k)) continue;
    if (typeof v === "string") out[`${prefix}.${k}`] = v.slice(0, 500);
    else if (typeof v === "number" || typeof v === "boolean") out[`${prefix}.${k}`] = v;
    else Object.assign(out, flatten(`${prefix}.${k}`, v, depth + 1));
  }
  return out;
}

export interface FactSources { game?: GameView | null; before?: GameView | null; custom?: Record<string, string>; engine?: EngineStatus; extra?: VarMap; now?: number; gameId?: string | null }
export function buildFacts(s: FactSources): VarMap {
  const f: VarMap = { ...gameFacts(s.game), ...engineFacts(s.engine), "game.id": s.gameId ?? "", time: s.now ?? 0 };
  if (s.before) Object.assign(f, gameFacts(s.before, "before."));
  for (const [k, v] of Object.entries(s.custom ?? {})) f[`custom.${k}`] = v;
  return Object.assign(f, s.extra);
}

// ---------------------------------------------------------------- templates: "{{home.abbr}} scored {{event.points|upper}}"
const FILTERS: Record<string, (s: string) => string> = {
  upper: (s) => s.toUpperCase(), lower: (s) => s.toLowerCase(),
  json: (s) => JSON.stringify(s).slice(1, -1), url: (s) => encodeURIComponent(s),
};
export const FILTER_NAMES = Object.keys(FILTERS);
/** Fill {{name}} or {{name|filter}} from facts. Unknown names become empty text and are reported in `missing`. `all` applies a filter to every value (used for URLs). */
export function render(tpl: string, facts: VarMap, all?: string): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = String(tpl).replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*(?:\|\s*(\w+)\s*)?\}\}/g, (_m, name: string, filter?: string) => {
    let v = Object.hasOwn(facts, name) ? String(facts[name]) : (missing.push(name), "");
    for (const fl of [filter, all]) if (fl && FILTERS[fl]) v = FILTERS[fl](v);
    return v;
  });
  return { text, missing };
}
