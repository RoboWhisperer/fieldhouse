// Event-sourced game state. State is a pure fold of the event log, so crash recovery,
// undo, replay marks and proof-of-play all come from the same log (see 05-architecture.md).
// The rules of the sport (periods, clock, scoring buttons, counters, set rules) are DATA: a ProfileDoc (src/profiles/types.ts).
// Events keep their meaning forever: an old basketball log must replay to the same state (src/game-golden.test.ts proves it).
import { BASKETBALL } from "./profiles/builtins";
import { clockStart, maxPeriod, periodLabel } from "./profiles/lib";
import type { CounterDef, ProfileDoc } from "./profiles/types";

export type Team = "home" | "away";
export type Profile = ProfileDoc;

export type Ev =
  | { type: "game.start"; home: string; away: string; homeName?: string; awayName?: string }
  | { type: "clock.start" }
  | { type: "clock.stop" }
  | { type: "clock.set"; ms: number }
  | { type: "period.set"; period: number }
  | { type: "score"; team: Team; points: number; player?: number; kind?: string } // kind = the profile's scoring option id ("td"); points alone still works
  | { type: "foul"; team: Team; player?: number } // = counter "fouls" +1
  | { type: "timeout"; team: Team } // = counter "timeouts" -1
  | { type: "counter"; team: Team; id: string; delta: 1 | -1 }
  | { type: "mark"; note?: string }
  | { type: "undo"; target: number }; // target = seq of an earlier event

export type Logged = Ev & { seq: number; t: number }; // t = wall-clock ms when appended


export interface TeamState {
  abbr: string; name: string; score: number;
  fouls: number; timeouts: number; // mirrors of counters "fouls"/"timeouts" (0 when the sport has none), kept for old readers
  counters: Record<string, number>;
  setsWon: number;
}
export interface State {
  home: TeamState;
  away: TeamState;
  period: number;
  clockMs: number; // at the moment of `since`: remaining for a down clock, elapsed for an up clock
  running: boolean;
  since: number; // wall ms when the clock last started
  profile: Profile;
  sets: { home: number; away: number }[]; // finished sets (set sports)
  winner: Team | null; // match winner (set sports)
}

const UNDOABLE = new Set(["score", "foul", "timeout", "counter"]);
const startOf = (d: CounterDef) => d.startValue ?? 0;
const withCounters = (t: TeamState, counters: Record<string, number>): TeamState => ({ ...t, counters, fouls: counters.fouls ?? 0, timeouts: counters.timeouts ?? 0 });
const team = (abbr: string, name = abbr, p: Profile = BASKETBALL): TeamState =>
  withCounters({ abbr, name, score: 0, fouls: 0, timeouts: 0, counters: {}, setsWon: 0 }, Object.fromEntries(p.counters.map((d) => [d.id, startOf(d)])));

export function initial(profile: Profile = BASKETBALL): State {
  return { home: team("HOME", "Home", profile), away: team("AWAY", "Away", profile), period: 1, clockMs: clockStart(profile, 1), running: false, since: 0, profile, sets: [], winner: null };
}

/** Clock time at wall time `now` (the state itself only changes on events). Down: remaining, never below 0. Up: elapsed. */
export function clockAt(s: State, now: number): number {
  const { mode, maxMin } = s.profile.clock;
  if (mode === "none" || !s.running) return s.clockMs;
  return mode === "up" ? Math.min(maxMin ? maxMin * 60_000 : Infinity, s.clockMs + Math.max(0, now - s.since)) : Math.max(0, s.clockMs - (now - s.since));
}

const other = (t: Team): Team => (t === "home" ? "away" : "home");

/** The threshold label ("Bonus") that applies to team `t` for counter `id`, or null. */
export function thresholdFor(s: State, t: Team, id: string): string | null {
  const d = s.profile.counters.find((c) => c.id === id);
  if (!d?.thresholds) return null;
  const n = s[d.thresholdsApplyTo === "opponent" ? other(t) : t].counters[id] ?? 0;
  return [...d.thresholds].reverse().find((th) => n >= th.at)?.label ?? null;
}
/** Basketball's bonus: the other team's fouls put you in it. */
export const bonus = (s: State, t: Team): boolean => thresholdFor(s, t, "fouls") !== null;

function bump(s: State, t: Team, id: string, delta: number): State {
  const d = s.profile.counters.find((c) => c.id === id);
  if (!d) return s; // an old log naming a counter the (edited) profile no longer has: ignored, never a crash
  const v = Math.min(d.limit ?? Infinity, Math.max(0, (s[t].counters[id] ?? startOf(d)) + delta));
  return { ...s, [t]: withCounters(s[t], { ...s[t].counters, [id]: v }) };
}

/** Move to a period: stop and reset the clock, reset the counters that reset then, and (set sports) start the set at 0-0. */
function toPeriod(s: State, period: number): State {
  const p = s.profile;
  const fresh = (t: TeamState): TeamState => {
    const c = { ...t.counters };
    for (const d of p.counters) if (d.resetAtPeriods ? d.resetAtPeriods.includes(period) : d.resetEachPeriod) c[d.id] = startOf(d);
    return { ...withCounters(t, c), ...(p.win ? { score: 0 } : {}) };
  };
  return { ...s, period, running: false, clockMs: clockStart(p, period), home: fresh(s.home), away: fresh(s.away) };
}

/** Set sports: after every point, see whether the set (and maybe the match) just ended. Pure, so undo replays it correctly. */
function afterPoint(s: State): State {
  const w = s.profile.win!;
  if (s.winner) return s;
  const decider = s.home.setsWon === w.setsToWin - 1 && s.away.setsWon === w.setsToWin - 1;
  const target = decider && w.decidingPoints ? w.decidingPoints : w.points;
  const t = (["home", "away"] as Team[]).find((x) => (s[x].score >= target && s[x].score - s[other(x)].score >= w.winBy) || (w.cap !== undefined && s[x].score >= w.cap));
  if (!t) return s;
  const done: State = { ...s, sets: [...s.sets, { home: s.home.score, away: s.away.score }], [t]: { ...s[t], setsWon: s[t].setsWon + 1 } };
  return done[t].setsWon >= w.setsToWin ? { ...done, winner: t } : toPeriod(done, s.period + 1);
}

function apply(s: State, e: Logged): State {
  const p = s.profile, hasClock = p.clock.mode !== "none";
  switch (e.type) {
    case "game.start":
      return { ...initial(p), home: team(e.home, e.homeName, p), away: team(e.away, e.awayName, p) };
    case "clock.start":
      return !hasClock || s.running ? s : { ...s, running: true, since: e.t };
    case "clock.stop":
      return hasClock && s.running ? { ...s, running: false, clockMs: clockAt(s, e.t) } : s;
    case "clock.set":
      return hasClock ? { ...s, clockMs: Math.max(0, e.ms), since: e.t } : s;
    case "period.set":
      return toPeriod(s, e.period);
    case "score": {
      const n = { ...s, [e.team]: { ...s[e.team], score: s[e.team].score + e.points } };
      return p.win ? afterPoint(n) : n;
    }
    case "foul": return bump(s, e.team, "fouls", 1);
    case "timeout": return bump(s, e.team, "timeouts", -1);
    case "counter": return bump(s, e.team, e.id, e.delta);
    default:
      return s; // mark, undo: no state change (marks live in the log for replay/highlights)
  }
}

/** Fold the log into state. Undone events are skipped; the log itself is never edited. */
export function fold(log: Logged[], profile: Profile = BASKETBALL): State {
  const undone = new Set<number>();
  for (const e of log) if (e.type === "undo") undone.add(e.target);
  let s = initial(profile);
  for (const e of log) if (!undone.has(e.seq)) s = apply(s, e);
  return s;
}

/** Latest event the operator may undo (score, foul, timeout, counter) that is not already undone. */
export function lastUndoable(log: Logged[]): Logged | undefined {
  const undone = new Set(log.filter((e) => e.type === "undo").map((e) => (e as { target: number }).target));
  return [...log].reverse().find((e) => UNDOABLE.has(e.type) && !undone.has(e.seq));
}

/** The wire shape for overlays and remotes: state plus the clock evaluated at `now`. A superset of the old basketball shape. */
export function view(s: State, now: number) {
  const p = s.profile;
  const tv = (t: Team) => {
    const { abbr, name, score, fouls, timeouts, setsWon } = s[t];
    return { abbr, name, score, fouls, timeouts, bonus: bonus(s, t), ...(p.win ? { setsWon } : {}) };
  };
  const counters: Record<string, { home: number; away: number }> = {};
  for (const d of p.counters) counters[d.id] = { home: s.home.counters[d.id] ?? startOf(d), away: s.away.counters[d.id] ?? startOf(d) };
  if (p.win) counters.sets = { home: s.home.setsWon, away: s.away.setsWon };
  const thresholds: Record<string, { home: string | null; away: string | null }> = {};
  for (const d of p.counters) if (d.thresholds) thresholds[d.id] = { home: thresholdFor(s, "home", d.id), away: thresholdFor(s, "away", d.id) };
  return {
    now,
    period: s.period,
    clockMs: clockAt(s, now),
    running: s.running,
    home: tv("home"),
    away: tv("away"),
    counters,
    thresholds,
    periodLabel: periodLabel(p, s.period),
    clockMode: p.clock.mode,
    ...(p.win ? { sets: { home: s.home.setsWon, away: s.away.setsWon, history: s.sets, toWin: p.win.setsToWin, winner: s.winner } } : {}),
  };
}

/** Trust boundary: events arrive over the LAN. Returns a clean Ev or an error string. `profile` is the game's own sport. */
export function parseEv(x: any, profile: Profile = BASKETBALL): Ev | string {
  const isTeam = (v: any) => v === "home" || v === "away";
  const optNum = (v: any) => v === undefined || (Number.isInteger(v) && v >= 0 && v <= 99);
  const has = (id: string) => profile.counters.some((c) => c.id === id);
  const noCounter = (what: string) => `${profile.sport} has no ${what}. Use the counters this sport defines.`;
  const noClock = `${profile.sport} has no clock.`;
  switch (x?.type) {
    case "game.start":
      return typeof x.home === "string" && typeof x.away === "string" && x.home.length <= 8 && x.away.length <= 8
        ? { type: "game.start", home: x.home, away: x.away, homeName: String(x.homeName ?? x.home).slice(0, 40), awayName: String(x.awayName ?? x.away).slice(0, 40) }
        : "game.start needs home and away abbreviations (max 8 chars)";
    case "clock.start": case "clock.stop": return profile.clock.mode === "none" ? noClock : { type: x.type };
    case "clock.set": return profile.clock.mode === "none" ? noClock : Number.isFinite(x.ms) && x.ms >= 0 && x.ms <= 3_600_000 ? { type: "clock.set", ms: x.ms } : "clock.set needs ms between 0 and 3600000";
    case "period.set": { const max = maxPeriod(profile); return Number.isInteger(x.period) && x.period >= 1 && x.period <= max ? { type: "period.set", period: x.period } : `period.set needs 1-${max}`; }
    case "score": {
      const opts = profile.scoring, allowed = [...new Set(opts.map((o) => o.points))];
      if (!isTeam(x.team) || !allowed.includes(x.points) || !optNum(x.player)) return `score needs team and points: ${allowed.join(", ")}`;
      if (x.kind !== undefined && !opts.some((o) => o.id === x.kind && o.points === x.points)) return `"${String(x.kind).slice(0, 24)}" is not a way to score ${x.points} in ${profile.sport}.`;
      return { type: "score", team: x.team, points: x.points, player: x.player, ...(x.kind !== undefined && { kind: x.kind }) };
    }
    case "foul": return !has("fouls") ? noCounter("fouls") : isTeam(x.team) && optNum(x.player) ? { type: "foul", team: x.team, player: x.player } : "foul needs team";
    case "timeout": return !has("timeouts") ? noCounter("timeouts") : isTeam(x.team) ? { type: "timeout", team: x.team } : "timeout needs team";
    case "counter": return isTeam(x.team) && has(x.id) && (x.delta === 1 || x.delta === -1) ? { type: "counter", team: x.team, id: x.id, delta: x.delta } : `counter needs team, delta +1 or -1 and one of: ${profile.counters.map((c) => c.id).join(", ") || "(none)"}`;
    case "mark": return { type: "mark", note: typeof x.note === "string" ? x.note.slice(0, 80) : undefined };
    case "undo": return Number.isInteger(x.target) ? { type: "undo", target: x.target } : "undo needs a target seq";
    default: return "unknown event type";
  }
}
