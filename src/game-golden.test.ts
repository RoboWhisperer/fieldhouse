// Golden proof that generalising the engine did not change basketball: the ORIGINAL hard-coded engine (copied verbatim from
// commit ec96502 into `old` below) and the profile-driven engine replay thousands of random logs and must agree on everything.
import { expect, test } from "bun:test";
import { fold, parseEv, view, bonus, clockAt, type Ev, type Logged } from "./game";
import { BASKETBALL } from "./profiles/builtins";
import { openStore } from "./store";

// ---------------------------------------------------------------- the old engine (oracle), untouched apart from namespacing
namespace old {
  export const basketball = { periods: 4, periodMs: 8 * 60_000, overtimeMs: 4 * 60_000, bonusAt: 5, timeouts: 3 };
  type Profile = typeof basketball;
  type Team = "home" | "away";
  interface TeamState { abbr: string; name: string; score: number; fouls: number; timeouts: number }
  export interface State { home: TeamState; away: TeamState; period: number; clockMs: number; running: boolean; since: number; profile: Profile }
  const team = (abbr: string, name = abbr, p = basketball): TeamState => ({ abbr, name, score: 0, fouls: 0, timeouts: p.timeouts });
  export function initial(profile: Profile = basketball): State {
    return { home: team("HOME", "Home", profile), away: team("AWAY", "Away", profile), period: 1, clockMs: profile.periodMs, running: false, since: 0, profile };
  }
  export function clockAt(s: State, now: number): number { return s.running ? Math.max(0, s.clockMs - (now - s.since)) : s.clockMs; }
  export function bonus(s: State, t: Team): boolean { return s[t === "home" ? "away" : "home"].fouls >= s.profile.bonusAt; }
  function apply(s: State, e: any): State {
    switch (e.type) {
      case "game.start": return { ...initial(s.profile), home: team(e.home, e.homeName, s.profile), away: team(e.away, e.awayName, s.profile) };
      case "clock.start": return s.running ? s : { ...s, running: true, since: e.t };
      case "clock.stop": return s.running ? { ...s, running: false, clockMs: clockAt(s, e.t) } : s;
      case "clock.set": return { ...s, clockMs: Math.max(0, e.ms), since: e.t };
      case "period.set": {
        const ot = e.period > s.profile.periods;
        return { ...s, period: e.period, running: false, clockMs: ot ? s.profile.overtimeMs : s.profile.periodMs, home: { ...s.home, fouls: 0 }, away: { ...s.away, fouls: 0 } };
      }
      case "score": return { ...s, [e.team]: { ...s[e.team as Team], score: s[e.team as Team].score + e.points } };
      case "foul": return { ...s, [e.team]: { ...s[e.team as Team], fouls: s[e.team as Team].fouls + 1 } };
      case "timeout": return { ...s, [e.team]: { ...s[e.team as Team], timeouts: Math.max(0, s[e.team as Team].timeouts - 1) } };
      default: return s;
    }
  }
  export function fold(log: any[], profile: Profile = basketball): State {
    const undone = new Set<number>();
    for (const e of log) if (e.type === "undo") undone.add(e.target);
    let s = initial(profile);
    for (const e of log) if (!undone.has(e.seq)) s = apply(s, e);
    return s;
  }
  export function view(s: State, now: number) {
    return { now, period: s.period, clockMs: clockAt(s, now), running: s.running, home: { ...s.home, bonus: bonus(s, "home") }, away: { ...s.away, bonus: bonus(s, "away") } };
  }
}

// ---------------------------------------------------------------- random logs
function rng(seed: number) { let a = seed; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function randomLog(seed: number, n = 60): Logged[] {
  const r = rng(seed), pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const log: Logged[] = [];
  let t = 1_000_000;
  const add = (e: Ev) => log.push({ ...e, seq: log.length + 1, t } as Logged);
  add({ type: "game.start", home: "WIL", away: "LIO", homeName: "Wildcats", awayName: "Lions" });
  for (let i = 0; i < n; i++) {
    t += Math.floor(r() * 40_000);
    const team = pick(["home", "away"] as const);
    const x = r();
    if (x < 0.3) add({ type: "score", team, points: pick([1, 2, 3]) });
    else if (x < 0.45) add({ type: "foul", team });
    else if (x < 0.52) add({ type: "timeout", team });
    else if (x < 0.64) add({ type: "clock.start" });
    else if (x < 0.74) add({ type: "clock.stop" });
    else if (x < 0.78) add({ type: "clock.set", ms: Math.floor(r() * 500_000) });
    else if (x < 0.86) add({ type: "period.set", period: 1 + Math.floor(r() * 9) });
    else if (x < 0.9) add({ type: "mark", note: "m" });
    else if (x < 0.93) add({ type: "game.start", home: "A", away: "B" }); // a restarted game mid-log
    else add({ type: "undo", target: 1 + Math.floor(r() * log.length) }); // any earlier seq, including already-undone, non-undoable and the undo of an undo
  }
  return log;
}

// Everything a reader of the OLD state could see
const legacyState = (s: any) => ({ home: pickTeam(s.home), away: pickTeam(s.away), period: s.period, clockMs: s.clockMs, running: s.running, since: s.since });
const pickTeam = (t: any) => ({ abbr: t.abbr, name: t.name, score: t.score, fouls: t.fouls, timeouts: t.timeouts });

test("basketball profile still carries exactly the old hard-coded numbers", () => {
  expect([BASKETBALL.periods.count, BASKETBALL.periods.lengthMin, BASKETBALL.periods.overtime.lengthMin, BASKETBALL.counters.find((c) => c.id === "fouls")!.thresholds![0].at, BASKETBALL.counters.find((c) => c.id === "timeouts")!.startValue])
    .toEqual([old.basketball.periods, old.basketball.periodMs / 60_000, old.basketball.overtimeMs / 60_000, old.basketball.bonusAt, old.basketball.timeouts]);
});

test("golden: 3000 random basketball logs (undo, period changes, restarts) fold and view exactly like the old engine", () => {
  const seen = { bonus: 0, overtime: 0, zeroTimeouts: 0, undone: 0 };
  for (let seed = 1; seed <= 3000; seed++) {
    const log = randomLog(seed, 20 + (seed % 80));
    const a = old.fold(log), b = fold(log);
    seen.bonus += +(old.bonus(a, "home") || old.bonus(a, "away")); seen.overtime += +(a.period > 4); seen.zeroTimeouts += +(a.home.timeouts === 0); seen.undone += +log.some((e) => e.type === "undo");
    expect(legacyState(b)).toEqual(legacyState(a));
    const last = log[log.length - 1].t;
    for (const now of [last, last + 1, last + 30_000, last + 9_999_999]) {
      const va = old.view(a, now), vb: any = view(b, now);
      expect({ ...vb, counters: undefined, thresholds: undefined, periodLabel: undefined, clockMode: undefined }).toEqual({ ...va, counters: undefined, thresholds: undefined, periodLabel: undefined, clockMode: undefined });
      expect(clockAt(b, now)).toBe(old.clockAt(a, now));
    }
    for (const t of ["home", "away"] as const) expect(bonus(b, t)).toBe(old.bonus(a, t));
  }
  for (const n of Object.values(seen)) expect(n).toBeGreaterThan(20); // the random logs really reach those cases
});

test("golden: a view of old state has exactly the old keys plus only additive ones", () => {
  const v: any = view(fold(randomLog(7)), 0);
  expect(Object.keys(v.home).sort()).toEqual(["abbr", "bonus", "fouls", "name", "score", "timeouts"]); // no extra team keys for basketball
  expect(Object.keys(v).filter((k) => !["now", "period", "clockMs", "running", "home", "away"].includes(k)).sort()).toEqual(["clockMode", "counters", "periodLabel", "thresholds"]);
});

test("golden: crash recovery. The stored log, reloaded by a new process, gives the same state and view as the old engine", () => {
  for (const seed of [11, 12, 13, 14, 15]) {
    const db = openStore(":memory:");
    const live = randomLog(seed, 50).map((e) => { const { seq, t, ...ev } = e; return db.append("g", ev as Ev, t); });
    const recovered = db.load("g");
    expect(recovered).toEqual(live);
    const now = live[live.length - 1].t + 12_345;
    expect(legacyState(fold(recovered))).toEqual(legacyState(old.fold(live)));
    const v: any = view(fold(recovered), now), o = old.view(old.fold(live), now);
    expect([v.clockMs, v.running, v.period, v.home, v.away]).toEqual([o.clockMs, o.running, o.period, o.home, o.away]);
    db.close();
  }
});

test("golden: every event the old parseEv accepted is accepted identically, and what it refused is still refused", () => {
  const r = rng(99);
  const vals = [undefined, null, 0, 1, 2, 3, 4, -1, 9, 10, 99, 100, 1.5, "x", "home", "away", "nobody", true, 3_600_000, 3_600_001];
  const pick = () => vals[Math.floor(r() * vals.length)];
  const oldParse = (x: any): Ev | string => { // the old accept rules, restated
    const isTeam = (v: any) => v === "home" || v === "away", optNum = (v: any) => v === undefined || (Number.isInteger(v) && v >= 0 && v <= 99);
    switch (x?.type) {
      case "clock.start": case "clock.stop": return { type: x.type };
      case "clock.set": return Number.isFinite(x.ms) && x.ms >= 0 && x.ms <= 3_600_000 ? { type: "clock.set", ms: x.ms } : "no";
      case "period.set": return Number.isInteger(x.period) && x.period >= 1 && x.period <= 9 ? { type: "period.set", period: x.period } : "no";
      case "score": return isTeam(x.team) && [1, 2, 3].includes(x.points) && optNum(x.player) ? { type: "score", team: x.team, points: x.points, player: x.player } : "no";
      case "foul": return isTeam(x.team) && optNum(x.player) ? { type: "foul", team: x.team, player: x.player } : "no";
      case "timeout": return isTeam(x.team) ? { type: "timeout", team: x.team } : "no";
      case "undo": return Number.isInteger(x.target) ? { type: "undo", target: x.target } : "no";
      default: return "no";
    }
  };
  for (let i = 0; i < 4000; i++) {
    const x = { type: ["clock.start", "clock.stop", "clock.set", "period.set", "score", "foul", "timeout", "undo"][Math.floor(r() * 8)], team: pick(), points: pick(), player: pick(), ms: pick(), period: pick(), target: pick() };
    const a = oldParse(x), b = parseEv(x);
    expect(typeof b).toBe(typeof a);
    if (typeof a !== "string") expect(b).toEqual(a);
  }
});
