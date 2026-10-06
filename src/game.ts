// Event-sourced game state. State is a pure fold of the event log, so crash recovery,
// undo, replay marks and proof-of-play all come from the same log (see 05-architecture.md).

export type Team = "home" | "away";

export type Ev =
  | { type: "game.start"; home: string; away: string; homeName?: string; awayName?: string }
  | { type: "clock.start" }
  | { type: "clock.stop" }
  | { type: "clock.set"; ms: number }
  | { type: "period.set"; period: number }
  | { type: "score"; team: Team; points: 1 | 2 | 3; player?: number }
  | { type: "foul"; team: Team; player?: number }
  | { type: "timeout"; team: Team }
  | { type: "mark"; note?: string }
  | { type: "undo"; target: number }; // target = seq of an earlier event

export type Logged = Ev & { seq: number; t: number }; // t = wall-clock ms when appended

// Basketball profile as data. ponytail: one hard-coded profile; make this a loadable
// file when the second sport lands (football = downs/field position, needs real design).
export const basketball = {
  periods: 4,
  periodMs: 8 * 60_000,
  overtimeMs: 4 * 60_000,
  bonusAt: 5, // team fouls per period (HS rules vary; configurable in Settings > Sport profile)
  timeouts: 3,
};
export type Profile = typeof basketball;

export interface TeamState { abbr: string; name: string; score: number; fouls: number; timeouts: number }
export interface State {
  home: TeamState;
  away: TeamState;
  period: number;
  clockMs: number; // remaining at the moment of `since`
  running: boolean;
  since: number; // wall ms when the clock last started
  profile: Profile;
}

const UNDOABLE = new Set(["score", "foul", "timeout"]);
const team = (abbr: string, name = abbr, p = basketball): TeamState => ({ abbr, name, score: 0, fouls: 0, timeouts: p.timeouts });

export function initial(profile: Profile = basketball): State {
  return { home: team("HOME", "Home", profile), away: team("AWAY", "Away", profile), period: 1, clockMs: profile.periodMs, running: false, since: 0, profile };
}

/** Remaining clock time at wall time `now` (the state itself only changes on events). */
export function clockAt(s: State, now: number): number {
  return s.running ? Math.max(0, s.clockMs - (now - s.since)) : s.clockMs;
}

export function bonus(s: State, t: Team): boolean {
  return s[t === "home" ? "away" : "home"].fouls >= s.profile.bonusAt; // fouls by the *other* team put you in the bonus
}

function apply(s: State, e: Logged): State {
  const other = (t: Team) => (t === "home" ? "away" : "home");
  switch (e.type) {
    case "game.start":
      return { ...initial(s.profile), home: team(e.home, e.homeName, s.profile), away: team(e.away, e.awayName, s.profile) };
    case "clock.start":
      return s.running ? s : { ...s, running: true, since: e.t };
    case "clock.stop":
      return s.running ? { ...s, running: false, clockMs: clockAt(s, e.t) } : s;
    case "clock.set":
      return { ...s, clockMs: Math.max(0, e.ms), since: e.t };
    case "period.set": {
      const ot = e.period > s.profile.periods;
      return {
        ...s,
        period: e.period,
        running: false,
        clockMs: ot ? s.profile.overtimeMs : s.profile.periodMs,
        home: { ...s.home, fouls: 0 },
        away: { ...s.away, fouls: 0 },
      };
    }
    case "score":
      return { ...s, [e.team]: { ...s[e.team], score: s[e.team].score + e.points } };
    case "foul":
      return { ...s, [e.team]: { ...s[e.team], fouls: s[e.team].fouls + 1 } };
    case "timeout":
      return { ...s, [e.team]: { ...s[e.team], timeouts: Math.max(0, s[e.team].timeouts - 1) } };
    default:
      return s; // mark, undo: no state change (marks live in the log for replay/highlights)
  }
}

/** Fold the log into state. Undone events are skipped; the log itself is never edited. */
export function fold(log: Logged[], profile: Profile = basketball): State {
  const undone = new Set<number>();
  for (const e of log) if (e.type === "undo") undone.add(e.target);
  let s = initial(profile);
  for (const e of log) if (!undone.has(e.seq)) s = apply(s, e);
  return s;
}

/** Latest event the operator may undo (score, foul, timeout) that is not already undone. */
export function lastUndoable(log: Logged[]): Logged | undefined {
  const undone = new Set(log.filter((e) => e.type === "undo").map((e) => (e as { target: number }).target));
  return [...log].reverse().find((e) => UNDOABLE.has(e.type) && !undone.has(e.seq));
}

/** The wire shape for overlays and remotes: state plus the clock evaluated at `now`. */
export function view(s: State, now: number) {
  return {
    now,
    period: s.period,
    clockMs: clockAt(s, now),
    running: s.running,
    home: { ...s.home, bonus: bonus(s, "home") },
    away: { ...s.away, bonus: bonus(s, "away") },
  };
}

/** Trust boundary: events arrive over the LAN. Returns a clean Ev or an error string. */
export function parseEv(x: any): Ev | string {
  const isTeam = (v: any) => v === "home" || v === "away";
  const optNum = (v: any) => v === undefined || (Number.isInteger(v) && v >= 0 && v <= 99);
  switch (x?.type) {
    case "game.start":
      return typeof x.home === "string" && typeof x.away === "string" && x.home.length <= 8 && x.away.length <= 8
        ? { type: "game.start", home: x.home, away: x.away, homeName: String(x.homeName ?? x.home).slice(0, 40), awayName: String(x.awayName ?? x.away).slice(0, 40) }
        : "game.start needs home and away abbreviations (max 8 chars)";
    case "clock.start": case "clock.stop": return { type: x.type };
    case "clock.set": return Number.isFinite(x.ms) && x.ms >= 0 && x.ms <= 3_600_000 ? { type: "clock.set", ms: x.ms } : "clock.set needs ms between 0 and 3600000";
    case "period.set": return Number.isInteger(x.period) && x.period >= 1 && x.period <= 9 ? { type: "period.set", period: x.period } : "period.set needs 1-9";
    case "score": return isTeam(x.team) && [1, 2, 3].includes(x.points) && optNum(x.player) ? { type: "score", team: x.team, points: x.points, player: x.player } : "score needs team, points 1-3";
    case "foul": return isTeam(x.team) && optNum(x.player) ? { type: "foul", team: x.team, player: x.player } : "foul needs team";
    case "timeout": return isTeam(x.team) ? { type: "timeout", team: x.team } : "timeout needs team";
    case "mark": return { type: "mark", note: typeof x.note === "string" ? x.note.slice(0, 80) : undefined };
    case "undo": return Number.isInteger(x.target) ? { type: "undo", target: x.target } : "undo needs a target seq";
    default: return "unknown event type";
  }
}
