// Variables templates can read, and {{path}} / {{path|fallback}} substitution.
import type { GameDoc, Player } from "../types";
import type { GameView, VarMap } from "../custom-types";

export const mmss = (ms: number) => { const s = Math.ceil(Math.max(0, ms) / 1000); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
export const periodText = (n: number) => (n > 4 ? "OT" + (n - 4 > 1 ? n - 4 : "") : "Q" + n);
export interface VarsCtx {
  game: GameView | null; doc?: GameDoc | null; venue?: string; custom?: Record<string, string>;
  lower?: { title: string; sub: string } | null; sponsor?: { name: string; color: string; seconds: number } | null; now?: number;
}

function roster(out: VarMap, side: string, list: Player[] | undefined) {
  const all = list ?? [], starters = all.filter((p) => p.starter);
  const put = (kind: string, ps: Player[]) => {
    out[`${side}.${kind}.count`] = ps.length;
    out[`${side}.${kind}.list`] = ps.map((p) => `${p.number} ${p.name}`.trim()).join(", ");
    ps.forEach((p, i) => { const k = `${side}.${kind}.${i + 1}`; out[k + ".name"] = p.name; out[k + ".number"] = p.number; out[k + ".position"] = p.position ?? ""; });
  };
  put("roster", all); put("starters", starters);
}

/** Every variable, flat with dotted keys. Missing pieces (no game, no custom data) simply leave their keys out. */
export function buildVars(c: VarsCtx): VarMap {
  const v: VarMap = {};
  const g = c.game, d = c.doc;
  for (const side of ["home", "away"] as const) {
    const t = g?.[side], td = d?.[side];
    v[`${side}.name`] = t?.name ?? td?.name ?? (side === "home" ? "Home" : "Away");
    v[`${side}.abbr`] = t?.abbr ?? td?.abbr ?? (side === "home" ? "HOME" : "AWAY");
    v[`${side}.color`] = td?.color ?? (side === "home" ? "#F5A524" : "#1F7A8C");
    v[`${side}.score`] = t?.score ?? 0; v[`${side}.fouls`] = t?.fouls ?? 0; v[`${side}.timeouts`] = t?.timeouts ?? 0; v[`${side}.bonus`] = !!t?.bonus;
    roster(v, side, td?.roster);
  }
  v.period = g?.period ?? 1;
  v.periodLabel = g?.periodLabel ?? periodText(g?.period ?? 1);
  v.clockMs = g?.clockMs ?? 0; v.clock = mmss(g?.clockMs ?? 0); v.running = !!g?.running;
  v["game.title"] = d?.title ?? ""; v["game.venue"] = c.venue ?? "";
  v["game.date"] = d?.startsAt ? new Date(d.startsAt).toISOString().slice(0, 10) : "";
  v["game.status"] = d?.status ?? ""; v["game.sport"] = d?.sport ?? "";
  v["lower.title"] = c.lower?.title ?? ""; v["lower.sub"] = c.lower?.sub ?? "";
  v["sponsor.name"] = c.sponsor?.name ?? ""; v["sponsor.color"] = c.sponsor?.color ?? "#1F7A8C"; v["sponsor.seconds"] = c.sponsor?.seconds ?? 0;
  for (const [k, val] of Object.entries(g?.counters ?? {})) { v[`counters.${k}.home`] = val.home; v[`counters.${k}.away`] = val.away; }
  for (const [k, val] of Object.entries(c.custom ?? {})) v[`custom.${k}`] = val;
  return v;
}

export type EscapeMode = "text" | "attr" | "css" | "url" | "json" | "raw";
/** text/attr: HTML-escape (use for element text and quoted attribute values). css: only characters that cannot end a rule are kept.
 *  url: encodeURIComponent. json: safe inside a JSON string. raw: untouched (only for values you trust). */
export function escapeFor(s: string, mode: EscapeMode): string {
  switch (mode) {
    case "text": case "attr": return s.replace(/[&<>"'`]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" })[c]!);
    case "css": return s.replace(/[^\w #.,%()/\-]/g, "");
    case "url": return encodeURIComponent(s);
    case "json": return JSON.stringify(s).slice(1, -1);
    default: return s;
  }
}
/** Replace {{path}} and {{path|fallback}}. An unknown or empty path uses the fallback, or "" without one. */
export function substitute(tpl: string, vars: VarMap, mode: EscapeMode = "text"): string {
  return tpl.replace(/\{\{\s*([\w.\-]+)\s*(?:\|([^}]*))?\}\}/g, (_m, path: string, fb?: string) => {
    const val = vars[path];
    const s = val === undefined || val === "" ? (fb ?? "") : String(val);
    return escapeFor(s, mode);
  });
}

/** Believable fixed values so a graphic can be previewed with no game running. */
export function sampleVars(): VarMap {
  const p = (n: string, num: string, pos: string, starter: boolean): Player => ({ name: n, number: num, position: pos, starter });
  const doc = { id: "sample", title: "Lions vs Tigers", startsAt: Date.UTC(2026, 0, 17, 19), venueId: "v", sport: "basketball", destinationIds: [], status: "live",
    home: { name: "Lions", abbr: "LIO", color: "#F5A524", roster: [p("Avery Cole", "4", "G", true), p("Jordan Reed", "11", "G", true), p("Sam Ortiz", "23", "F", true), p("Riley Chen", "32", "F", true), p("Max Dunn", "40", "C", true), p("Taylor Fox", "7", "G", false)] },
    away: { name: "Tigers", abbr: "TIG", color: "#1F7A8C", roster: [p("Chris Bell", "2", "G", true), p("Dana Lee", "10", "G", true), p("Eli Grant", "21", "F", true), p("Kai Moss", "33", "F", true), p("Noah Park", "44", "C", true), p("Ray Ito", "5", "G", false)] } } as unknown as GameDoc;
  const game: GameView = { period: 3, clockMs: 4 * 60_000 + 31_000, running: false, home: { abbr: "LIO", name: "Lions", score: 42, fouls: 3, timeouts: 2, bonus: false }, away: { abbr: "TIG", name: "Tigers", score: 38, fouls: 6, timeouts: 1, bonus: true }, counters: { fouls: { home: 3, away: 6 } } };
  return buildVars({ game, doc, venue: "Main gym", custom: { ticker: "Welcome to the game. Thanks for being here.", sponsorLine: "Presented by Main Street Bank" }, lower: { title: "Avery Cole", sub: "Guard, 14 points" }, sponsor: { name: "Main Street Bank", color: "#1F7A8C", seconds: 8 } });
}
