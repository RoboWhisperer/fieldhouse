import { afterAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createApp } from "./app";
import { getSettings, saveGame, saveSettings, snapshotProfile } from "./data";
import { FakeEngine } from "./engine";
import { fold, lastUndoable, parseEv, view, type Ev, type Logged } from "./game";
import { clipsFromLog } from "./highlights";
import { BASKETBALL, BUILTINS, FOOTBALL, HOCKEY, SOCCER, VOLLEYBALL, builtin } from "./profiles/builtins";
import { clockStart, breakTrigger, periodLabel, summary } from "./profiles/lib";
import { exportProfile, getProfile, importProfile, listProfiles, saveProfile } from "./profiles/store";
import type { ProfileDoc } from "./profiles/types";
import { validateProfile } from "./profiles/validate";
import { openStore } from "./store";
import { planGame } from "./sponsors";

const mk = (evs: [number, Ev][]): Logged[] => evs.map(([t, e], i) => ({ ...e, seq: i + 1, t }) as Logged);
const start: Ev = { type: "game.start", home: "WIL", away: "LIO" };
/** A log built from plain events at 1 ms spacing. */
const log = (...evs: Ev[]) => mk([[0, start], ...evs.map((e, i) => [i + 1, e] as [number, Ev])]);
/** n points each, alternating, so neither side runs away with the set */
const rally = (n: number): Ev[] => Array.from({ length: n * 2 }, (_, i) => ({ type: "score", team: i % 2 ? "away" : "home", points: 1 }) as Ev);
const points = (team: "home" | "away", n: number): Ev[] => Array.from({ length: n }, () => ({ type: "score", team, points: 1 }));
const clone = (p: ProfileDoc) => structuredClone(p);

test("every built-in profile is valid, non-deletable data that survives a validate round trip", () => {
  expect(BUILTINS.map((p) => p.id)).toEqual(["basketball", "soccer", "football", "volleyball", "hockey"]);
  for (const p of BUILTINS) { expect(p.builtin).toBe(true); expect(validateProfile(p, p.id, true)).toEqual(p); }
});

test("soccer: the clock counts up through stoppage time and the second half starts at 45:00", () => {
  const s = fold(log({ type: "clock.start" }), SOCCER);
  const v: any = view(s, 1 + 50 * 60_000); // 50 minutes after kick-off, still in the 1st half: no cap
  expect([v.clockMode, v.periodLabel, v.clockMs]).toEqual(["up", "1st half", 50 * 60_000]);
  const h2 = fold(log({ type: "clock.start" }, { type: "period.set", period: 2 }), SOCCER);
  expect([h2.clockMs, h2.running, periodLabel(SOCCER, 2)]).toEqual([45 * 60_000, false, "2nd half"]);
  expect(fold(log({ type: "period.set", period: 3 }), SOCCER).clockMs).toBe(90 * 60_000); // extra time continues from 90:00
  expect(periodLabel(SOCCER, 3)).toBe("ET"); expect(periodLabel(SOCCER, 4)).toBe("ET2");
  const g = fold(log({ type: "score", team: "home", points: 1 }, { type: "counter", team: "away", id: "yellow", delta: 1 }, { type: "counter", team: "away", id: "yellow", delta: 1 }, { type: "counter", team: "away", id: "red", delta: 1 }), SOCCER);
  const gv: any = view(g, 0);
  expect([gv.home.score, gv.counters.yellow, gv.counters.red]).toEqual([1, { home: 0, away: 2 }, { home: 0, away: 1 }]);
  const stopped = fold(log({ type: "clock.start" }, { type: "clock.stop" }), SOCCER); // stop freezes an up clock
  expect(view(stopped, 9_999_999).clockMs).toBe(stopped.clockMs);
  const capped = clone(SOCCER); capped.clock.maxMin = 60;
  expect(view(fold(log({ type: "clock.start" }), capped), 99 * 60_000).clockMs).toBe(60 * 60_000);
  const reset = clone(SOCCER); reset.clock.carryOver = false;
  expect(clockStart(reset, 2)).toBe(0);
});

test("football: scoring values, kinds, and timeouts that come back at halftime", () => {
  const s = fold(log({ type: "score", team: "home", points: 6, kind: "td" }, { type: "score", team: "home", points: 1, kind: "xp" }, { type: "score", team: "away", points: 2, kind: "safety" },
    { type: "timeout", team: "home" }, { type: "timeout", team: "home" }, { type: "period.set", period: 2 }), FOOTBALL);
  expect([s.home.score, s.away.score, s.home.timeouts]).toEqual([7, 2, 1]); // Q2: no reset
  const h2 = fold(log({ type: "timeout", team: "home" }, { type: "period.set", period: 3 }), FOOTBALL);
  expect(h2.home.timeouts).toBe(3); // second half: back to 3
  expect(fold(log({ type: "period.set", period: 5 }), FOOTBALL).clockMs).toBe(12 * 60_000);
  expect(parseEv({ type: "score", team: "home", points: 6, kind: "td" }, FOOTBALL)).toMatchObject({ points: 6, kind: "td" });
  expect(parseEv({ type: "score", team: "home", points: 6, kind: "fg" }, FOOTBALL)).toContain("not a way to score 6");
  expect(parseEv({ type: "score", team: "home", points: 4 }, FOOTBALL)).toBeTypeOf("string");
  expect(parseEv({ type: "foul", team: "home" }, FOOTBALL)).toContain("no fouls");
  // clip labels use the profile's words
  const clips = clipsFromLog(mk([[0, start], [10_000, { type: "score", team: "home", points: 6, kind: "td", player: 7 }]]), { startedAt: 0 }, { profile: FOOTBALL });
  expect(clips[0].label).toBe("WIL touchdown #7");
});

test("hockey: three 20-minute periods, goals, penalty counters, 5-minute overtime", () => {
  const s = fold(log({ type: "counter", team: "home", id: "penalties", delta: 1 }, { type: "score", team: "away", points: 1 }, { type: "period.set", period: 2 }), HOCKEY);
  expect([s.home.counters.penalties, s.away.score, s.clockMs, s.period]).toEqual([1, 1, 20 * 60_000, 2]); // penalties do not reset
  expect(fold(log({ type: "period.set", period: 4 }), HOCKEY).clockMs).toBe(5 * 60_000);
  expect(periodLabel(HOCKEY, 4)).toBe("OT");
  expect(parseEv({ type: "period.set", period: 3 }, HOCKEY)).toEqual({ type: "period.set", period: 3 });
});

test("volleyball: no clock; a set is won at 25 with a 2-point lead; deuce goes on; the 5th set is played to 15", () => {
  const v = (...e: Ev[]) => fold(log(...e), VOLLEYBALL);
  expect(v({ type: "clock.start" }).running).toBe(false); // ignored: no clock
  expect(view(v(), 5_000).clockMs).toBe(0); expect(view(v(), 0).clockMode).toBe("none");
  expect(parseEv({ type: "clock.start" }, VOLLEYBALL)).toContain("no clock");
  // 24-24, home leads 25-24: not over. 26-24: set won, next set starts 0-0
  const near = rally(24);
  let s = v(...near, ...points("home", 1));
  expect([s.home.score, s.away.score, s.period, s.sets.length]).toEqual([25, 24, 1, 0]);
  s = v(...near, ...points("home", 2));
  expect([s.home.score, s.away.score, s.period, s.home.setsWon]).toEqual([0, 0, 2, 1]);
  expect(s.sets).toEqual([{ home: 26, away: 24 }]);
  // long deuce: 30-30, then 32-30
  s = v(...rally(29), ...points("home", 1), ...points("away", 1), ...points("home", 2));
  expect([s.home.setsWon, s.sets[0]]).toEqual([1, { home: 32, away: 30 }]);
  // timeouts are per set and the view exposes sets as a counter for graphics
  s = v({ type: "timeout", team: "home" }, ...points("home", 25));
  expect([s.home.timeouts, s.period]).toEqual([2, 2]);
  const sv: any = view(v({ type: "timeout", team: "home" }, ...points("home", 25)), 0);
  expect([sv.periodLabel, sv.counters.sets, sv.sets, sv.home.timeouts, sv.home.setsWon]).toEqual(["Set 2", { home: 1, away: 0 }, { home: 1, away: 0, history: [{ home: 25, away: 0 }], toWin: 3, winner: null }, 2, 1]);
  // best of 5: 2-2 in sets, the decider is to 15
  const won = (t: "home" | "away") => points(t, 25);
  s = v(...won("home"), ...won("away"), ...won("home"), ...won("away"), ...points("home", 14));
  expect([s.period, s.home.setsWon, s.away.setsWon, s.home.score, s.winner]).toEqual([5, 2, 2, 14, null]);
  s = v(...won("home"), ...won("away"), ...won("home"), ...won("away"), ...points("home", 14), ...points("away", 14), ...points("home", 1)); // 15-14 is not enough
  expect(s.winner).toBeNull();
  s = v(...won("home"), ...won("away"), ...won("home"), ...won("away"), ...points("home", 15));
  expect([s.winner, s.home.setsWon, s.sets.length, s.sets[4]]).toEqual(["home", 3, 5, { home: 15, away: 0 }]);
  expect((view(s, 0) as any).sets.winner).toBe("home");
  // a match won in straight sets stops at 3-0, and points after the end do not start another set
  s = v(...won("home"), ...won("home"), ...won("home"), ...points("home", 3));
  expect([s.winner, s.period, s.home.setsWon]).toEqual(["home", 3, 3]);
  // undo of the winning point brings the set back
  const base = log(...points("home", 24), ...points("away", 3), ...points("home", 1));
  expect(fold(base, VOLLEYBALL).home.setsWon).toBe(1);
  const undone = [...base, { type: "undo", target: base.length, seq: base.length + 1, t: 99 } as Logged];
  const u = fold(undone, VOLLEYBALL);
  expect([u.home.setsWon, u.home.score, u.period, u.winner]).toEqual([0, 24, 1, null]);
  // a manual period change starts the next set at 0-0 without recording a result
  s = v(...points("home", 3), { type: "period.set", period: 2 });
  expect([s.home.score, s.sets.length, s.period]).toEqual([0, 0, 2]);
  // cap (badminton): first to 30 wins even without a 2-point lead
  const bad = clone(VOLLEYBALL); bad.win = { points: 21, winBy: 2, cap: 30, setsToWin: 2 }; bad.periods.count = 3;
  const tied = [...rally(29), ...points("home", 1)];
  expect(fold(log(...tied), bad).home.setsWon).toBe(1);
});

test("counters: limits, thresholds on self or opponent, resets and the foul/timeout aliases", () => {
  const p = clone(BASKETBALL);
  p.counters[0].thresholds = [{ at: 5, label: "Bonus" }, { at: 10, label: "Double bonus" }];
  p.counters.push({ id: "challenges", label: "Challenges", perTeam: true, startValue: 2, limit: 2, resetEachPeriod: false, showAs: "pips", thresholds: [{ at: 2, label: "Full" }] });
  const fouls = Array.from({ length: 10 }, () => ({ type: "foul", team: "away" }) as Ev);
  const s = view(fold(log(...fouls.slice(0, 5)), p), 0) as any;
  expect([s.home.bonus, s.away.bonus, s.thresholds.fouls]).toEqual([true, false, { home: "Bonus", away: null }]);
  expect((view(fold(log(...fouls), p), 0) as any).thresholds.fouls.home).toBe("Double bonus");
  const c = view(fold(log({ type: "counter", team: "home", id: "challenges", delta: 1 }, { type: "counter", team: "away", id: "challenges", delta: -1 }, { type: "counter", team: "away", id: "challenges", delta: -1 }, { type: "counter", team: "away", id: "challenges", delta: -1 }), p), 0) as any;
  expect(c.counters.challenges).toEqual({ home: 2, away: 0 }); // limit 2 above, never below 0
  expect(c.thresholds.challenges).toEqual({ home: "Full", away: null }); // "self" thresholds belong to the team's own count
  // foul and timeout events are the same as counter events on "fouls" and "timeouts"
  const a = fold(log({ type: "foul", team: "home" }, { type: "timeout", team: "away" }));
  const b = fold(log({ type: "counter", team: "home", id: "fouls", delta: 1 }, { type: "counter", team: "away", id: "timeouts", delta: -1 }));
  expect([a.home.fouls, a.away.timeouts]).toEqual([b.home.fouls, b.away.timeouts]);
  // an event for a counter the (edited) profile no longer has is ignored, not a crash
  expect(fold(log({ type: "counter", team: "home", id: "gone", delta: 1 })).home.score).toBe(0);
  // counter events can be undone like fouls
  const l = log({ type: "counter", team: "home", id: "fouls", delta: 1 });
  expect(lastUndoable(l)?.type).toBe("counter");
});

test("parseEv validation matrix against the profile", () => {
  const bad = (x: any, p = BASKETBALL, part = "") => { const r = parseEv(x, p); expect(r).toBeTypeOf("string"); expect(r as string).toContain(part); };
  bad({ type: "counter", team: "home", id: "nope", delta: 1 }, BASKETBALL, "fouls, timeouts");
  bad({ type: "counter", team: "home", id: "fouls", delta: 2 });
  bad({ type: "counter", team: "x", id: "fouls", delta: 1 });
  expect(parseEv({ type: "counter", team: "home", id: "fouls", delta: -1 })).toEqual({ type: "counter", team: "home", id: "fouls", delta: -1 });
  bad({ type: "score", team: "home", points: 6 }, BASKETBALL, "1, 2, 3");
  expect(parseEv({ type: "score", team: "home", points: 6 }, FOOTBALL)).toMatchObject({ points: 6 });
  bad({ type: "score", team: "home", points: 2 }, VOLLEYBALL, "1");
  bad({ type: "period.set", period: 6 }, VOLLEYBALL, "1-5"); // no overtime in volleyball
  bad({ type: "period.set", period: 9 }, HOCKEY, "1-8");
  expect(parseEv({ type: "period.set", period: 9 })).toEqual({ type: "period.set", period: 9 }); // basketball keeps 1-9
  bad({ type: "period.set", period: 10 });
  bad({ type: "timeout", team: "home" }, SOCCER, "no timeouts");
  bad({ type: "clock.set", ms: 5 }, VOLLEYBALL, "no clock");
  expect(parseEv({ type: "mark" }, VOLLEYBALL)).toEqual({ type: "mark", note: undefined });
  expect(parseEv({ type: "score", team: "home", points: 1 }, FOOTBALL)).toMatchObject({ points: 1 }); // points alone still works without kind
});

test("profile validation: limits and plain-language errors", () => {
  const ok = () => clone(HOCKEY);
  const err = (mut: (p: any) => void, part: string) => { const p: any = ok(); mut(p); expect(() => validateProfile(p, "x", false)).toThrow(part); };
  err((p) => (p.periods.count = 13), "1 to 12");
  err((p) => (p.periods.count = 0), "1 to 12");
  err((p) => (p.periods.names = ["a", "b", "c", "d"]), "at most 3");
  err((p) => (p.periods.names = ["x".repeat(25)]), "1 to 24 characters");
  err((p) => (p.name = ""), "profile name");
  err((p) => (p.scoring = []), "1 to 8");
  err((p) => (p.scoring = Array.from({ length: 9 }, (_, i) => ({ id: "s" + i, label: "S", points: 1 }))), "1 to 8");
  err((p) => (p.scoring[0].points = 0), "1 to 99");
  err((p) => (p.scoring[0].points = 100), "1 to 99");
  err((p) => (p.scoring[0].points = 1.5), "whole number");
  err((p) => p.scoring.push({ ...p.scoring[0] }), "share the id");
  err((p) => (p.scoring[0].id = "Bad Id"), "lowercase");
  err((p) => (p.counters = Array.from({ length: 13 }, (_, i) => ({ id: "c" + i, label: "C", perTeam: true, resetEachPeriod: false, showAs: "number" }))), "at most 12");
  err((p) => (p.counters[0].showAs = "dots"), "pips");
  err((p) => (p.counters[0].limit = 1, p.counters[0].startValue = 5), "lower than its starting value");
  err((p) => (p.counters.push({ id: "z", label: "Z", perTeam: true, resetEachPeriod: false, showAs: "pips" })), "how many pips");
  err((p) => (p.clock.mode = "sideways"), "clock mode");
  err((p) => delete p.periods.lengthMin, "minutes per period");
  err((p) => (p.periodLabelFormat = "Period"), "{n}");
  err((p) => (p.win = { points: 25, winBy: 2, setsToWin: 3 }), "at least that many periods");
  err((p) => (p.sponsorBreakCounter = "ghost"), "not one of this sport's counters");
  err((p) => (p.display = { clock: "yes" }), "true or false");
  expect(() => validateProfile("nope", "x", false)).toThrow("must be an object");
  // a profile written from scratch with only the essentials gets sane defaults, and unknown fields are dropped
  const mini = validateProfile({ name: "Tag", periods: { count: 2, lengthMin: 10 }, clock: { mode: "down" }, scoring: [{ id: "tag", label: "Tag", points: 1 }], future: "ignored" }, "p1", false);
  expect(mini).toMatchObject({ sport: "Tag", counters: [], display: { clock: true, period: true, counters: false }, periodLabelFormat: "Period {n}" });
  expect((mini as any).future).toBeUndefined();
});

test("a made-up sport works end to end (the example in docs/dev/profiles.md)", () => {
  const quidditch = validateProfile({
    name: "Quidditch", sport: "Quidditch", periods: { count: 1, lengthMin: 30, overtime: { enabled: true, lengthMin: 5, namePrefix: "OT" } }, clock: { mode: "up" },
    scoring: [{ id: "goal", label: "Goal", points: 10 }, { id: "snitch", label: "Snitch caught", points: 30 }], // points are whole numbers 1..99
    counters: [{ id: "bludgers", label: "Bludger hits", resetEachPeriod: false, showAs: "number" }], periodLabelFormat: "Period {n}",
  }, "profile_q", false);
  const s = fold(log({ type: "score", team: "home", points: 10, kind: "goal" }, { type: "score", team: "away", points: 30, kind: "snitch" }, { type: "counter", team: "home", id: "bludgers", delta: 1 }), quidditch);
  expect([s.home.score, s.away.score, s.home.counters.bludgers]).toEqual([10, 30, 1]);
});

test("summary and period labels: what the UI draws from", () => {
  const s = summary(VOLLEYBALL);
  expect(s).toMatchObject({ id: "volleyball", clockMode: "none", periodLabels: ["Set 1", "Set 2", "Set 3", "Set 4", "Set 5"], sponsorBreakCounter: "timeouts", overtime: false });
  expect(summary(BASKETBALL).periodLabels).toEqual(["Q1", "Q2", "Q3", "Q4", "OT"]);
  expect(summary(BASKETBALL).scoring.map((o) => o.points)).toEqual([1, 2, 3]);
  expect(summary(HOCKEY).sponsorBreakCounter).toBeNull();
});

test("sponsor break slot follows the sport", () => {
  const down = (clockMs: number, period: number) => breakTrigger(BASKETBALL, { clockMs, period });
  expect([down(5, 1), down(0, 2), down(0, 4), down(0, 1)]).toEqual(["timeout", "halftime", "postgame", "period_end"]); // exactly the old rule
  expect([breakTrigger(SOCCER, { clockMs: 46 * 60_000, period: 1 }), breakTrigger(SOCCER, { clockMs: 10, period: 1 }), breakTrigger(SOCCER, { clockMs: 90 * 60_000, period: 2 })]).toEqual(["halftime", "timeout", "postgame"]);
  expect(breakTrigger(VOLLEYBALL, { clockMs: 0, period: 2 })).toBe("timeout");
  expect(planGame([]).map((x) => x.slot)).toEqual(["Pregame", "Q1 timeout", "Q2 timeout", "Halftime", "Q3 timeout", "Q4 timeout", "Postgame"]);
  expect(planGame([], HOCKEY).map((x) => x.slot)).toEqual(["Pregame", "1st timeout", "2nd timeout", "3rd timeout", "Postgame"]);
  expect(planGame([], SOCCER).map((x) => x.slot)).toEqual(["Pregame", "1st half timeout", "Halftime", "2nd half timeout", "Postgame"]);
});

// ---------------------------------------------------------------- store, migration, snapshot, settings, routes
const game = (extra: Record<string, unknown> = {}) => ({ startsAt: 1, home: { name: "Home", abbr: "HOM" }, away: { name: "Away", abbr: "AWY" }, ...extra });

test("profile docs: built-ins come from code, edits are overrides, reset restores, import always gets a new id", () => {
  const store = openStore(":memory:");
  expect(listProfiles(store).map((p) => p.id)).toEqual(BUILTINS.map((p) => p.id));
  const edited = clone(BASKETBALL); edited.periods.lengthMin = 10;
  saveProfile(store, edited, "basketball");
  expect(getProfile(store, "basketball")!.periods.lengthMin).toBe(10);
  expect(getProfile(store, "basketball")!.builtin).toBe(true);
  expect(builtin("basketball")!.periods.lengthMin).toBe(8); // code untouched
  const mine = saveProfile(store, { ...clone(HOCKEY), name: "Mine" });
  expect(mine.id).toMatch(/^profile_/); expect(mine.builtin).toBe(false);
  const file = exportProfile(store, mine.id);
  expect(file).toMatchObject({ fieldhouseProfile: 1 }); expect((file.profile as any).id).toBeUndefined();
  const a = importProfile(store, file), b = importProfile(store, file.profile);
  expect(new Set([mine.id, a.id, b.id]).size).toBe(3);
  expect(() => importProfile(store, { profile: { name: "x" } })).toThrow();
});

test("games freeze their sport at game.start: editing the profile afterwards changes nothing", () => {
  const store = openStore(":memory:");
  const g = saveGame(store, game({ id: "g1" }));
  expect(g.profileSnapshot).toBeUndefined();
  const started = snapshotProfile(store, "g1");
  expect(started.profileSnapshot).toEqual(BASKETBALL); expect([started.profileId, started.sport]).toEqual(["basketball", "Basketball"]);
  const edited = clone(BASKETBALL); edited.periods.lengthMin = 12; edited.scoring.push({ id: "ft4", label: "Four", points: 4 });
  saveProfile(store, edited, "basketball");
  expect(snapshotProfile(store, "g1").profileSnapshot!.periods.lengthMin).toBe(8); // second call keeps the first snapshot
  // saving the game doc again (the edit-game screen) cannot drop or swap the snapshot
  const again = saveGame(store, game({ id: "g1", title: "Renamed" }));
  expect(again.profileSnapshot!.periods.lengthMin).toBe(8);
  expect(() => saveGame(store, game({ id: "g1", profileId: "soccer" }))).toThrow("already started");
  // a new game picks up the edit; a game with its own choice gets that sport
  expect(snapshotProfile(store, saveGame(store, game({ id: "g2" })).id).profileSnapshot!.periods.lengthMin).toBe(12);
  expect(snapshotProfile(store, saveGame(store, game({ id: "g3", profileId: "volleyball" })).id).profileSnapshot!.id).toBe("volleyball");
  expect(() => saveGame(store, game({ profileId: "nope" }))).toThrow("does not exist");
  // the log replays the same with the snapshot even though the live profile changed
  const l = log({ type: "period.set", period: 2 });
  expect(fold(l, started.profileSnapshot).clockMs).toBe(8 * 60_000);
  saveSettings(store, { defaultProfileId: "soccer" });
  expect(snapshotProfile(store, saveGame(store, game({ id: "g4" })).id).profileSnapshot!.id).toBe("soccer"); // default comes from settings
  expect(() => saveSettings(store, { defaultProfileId: "nope" })).toThrow("default");
});

test("migration v2: games that already have events are frozen as basketball, unstarted games are left alone", () => {
  const path = `${process.env.TMPDIR ?? "/tmp"}/fieldhouse-mig-${Date.now()}.db`;
  const db = new Database(path);
  db.run("CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, game TEXT NOT NULL, t INTEGER NOT NULL, body TEXT NOT NULL)");
  db.run("CREATE INDEX events_game ON events (game, seq)");
  db.run("CREATE TABLE docs (kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (kind, id))");
  db.run("PRAGMA user_version = 1");
  const oldGame = (id: string) => JSON.stringify({ id, title: id, startsAt: 1, venueId: "", sport: "basketball", home: {}, away: {}, destinationIds: [], status: "live" });
  db.run("INSERT INTO docs VALUES ('game','played',?)", [oldGame("played")]);
  db.run("INSERT INTO docs VALUES ('game','future',?)", [oldGame("future")]);
  db.run(`INSERT INTO events (game, t, body) VALUES ('played', 1, '{"type":"game.start","home":"A","away":"B"}')`);
  db.close();
  const s = openStore(path);
  expect(s.get<any>("game", "played").profileSnapshot).toEqual(BASKETBALL);
  expect(s.get<any>("game", "played").profileId).toBe("basketball");
  expect(s.get<any>("game", "future").profileSnapshot).toBeUndefined();
  s.close();
  expect(openStore(path).get<any>("game", "played").profileSnapshot).toEqual(BASKETBALL); // reopening changes nothing
});

test("settings stay backward compatible: the old profile fields are a view of the basketball profile", () => {
  const store = openStore(":memory:");
  expect(getSettings(store).profile).toEqual({ periods: 4, periodMin: 8, overtimeMin: 4, bonusAt: 5, timeouts: 3 });
  expect(getSettings(store).defaultProfileId).toBe("basketball");
  saveSettings(store, { profile: { periodMin: 10, bonusAt: 7, timeouts: 4, periods: 2 } });
  expect(getSettings(store).profile).toEqual({ periods: 2, periodMin: 10, overtimeMin: 4, bonusAt: 7, timeouts: 4 });
  const p = getProfile(store, "basketball")!;
  expect([p.periods.count, p.periods.lengthMin, p.periods.names, p.counters[0].thresholds, p.counters[1].startValue]).toEqual([2, 10, ["Q1", "Q2"], [{ at: 7, label: "Bonus" }], 4]);
  // editing the profile through the new API shows up in the old settings shape
  const q = clone(p); q.periods.overtime.lengthMin = 6; saveProfile(store, q, "basketball");
  expect(getSettings(store).profile.overtimeMin).toBe(6);
  expect(() => saveSettings(store, { profile: { periods: 99 } })).toThrow("periods"); // old messages unchanged
  expect(() => saveSettings(store, { profile: { sport: 1 } })).toThrow("Unknown sport profile field");
  expect(getSettings(store).profile.periods).toBe(2); // a rejected patch changed nothing
});

const engines: FakeEngine[] = [];
afterAll(() => Promise.all(engines.map((e) => e.close())));
const rig = () => {
  const store = openStore(":memory:"), engine = new FakeEngine(); engines.push(engine);
  const app = createApp({ store, engine });
  const req = async (method: string, path: string, body?: unknown) => {
    const r = await app.handle(new Request("http://localhost:8080/api" + path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: body === undefined ? {} : { "content-type": "application/json" } }));
    return { status: r.status, body: r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text(), res: r } as { status: number; body: any; res: Response };
  };
  return { app, store, req };
};

test("API: create, duplicate, edit, delete, reset, export and import profiles; plain errors", async () => {
  const { req, app } = rig();
  const list = (await req("GET", "/profiles")).body;
  expect(list.map((p: any) => p.id)).toEqual(["basketball", "soccer", "football", "volleyball", "hockey"]);
  expect(list.every((p: any) => p.builtin && p.modified === false)).toBe(true);
  const dup = await req("POST", "/profiles", { duplicateOf: "football", name: "Flag football" });
  expect(dup.status).toBe(200); expect(dup.body).toMatchObject({ name: "Flag football", builtin: false });
  const id = dup.body.id;
  const edit = { ...dup.body, periods: { ...dup.body.periods, lengthMin: 20 } };
  expect((await req("PUT", `/profiles/${id}`, edit)).body.periods.lengthMin).toBe(20);
  const tooMany = { ...edit, counters: Array.from({ length: 13 }, (_, i) => ({ id: "c" + i, label: "C", resetEachPeriod: false, showAs: "number" })) };
  const e1 = await req("PUT", `/profiles/${id}`, tooMany);
  expect([e1.status, e1.body.error]).toEqual([400, "A sport can have at most 12 counters."]);
  expect((await req("POST", "/profiles", { name: "x" })).body.error).toContain("how many periods");
  expect((await req("GET", "/profiles/nope")).status).toBe(404);
  expect((await req("PUT", "/profiles/nope", edit)).status).toBe(404);
  // built-ins: cannot delete, edit then reset
  const del = await req("DELETE", "/profiles/soccer");
  expect([del.status, del.body.error]).toEqual([400, "Built-in sports can't be deleted. Use Reset to put the original rules back."]);
  const soc = (await req("GET", "/profiles/soccer")).body;
  await req("PUT", "/profiles/soccer", { ...soc, periods: { ...soc.periods, lengthMin: 40 } });
  expect((await req("GET", "/profiles/soccer")).body).toMatchObject({ modified: true, builtin: true });
  expect((await req("POST", "/profiles/soccer/reset")).body.periods.lengthMin).toBe(45);
  expect((await req("POST", `/profiles/${id}/reset`)).body.error).toBe("Only built-in sports can be reset.");
  // export then import gives a new profile
  const ex = await req("GET", `/profiles/${id}/export`);
  expect(ex.res.headers.get("content-disposition")).toContain("fieldhouse-flag-football.json");
  const imp = await req("POST", "/profiles/import", ex.body);
  expect(imp.status).toBe(200); expect(imp.body.id).not.toBe(id);
  expect((await req("POST", "/profiles/import", { profile: { name: "bad" } })).status).toBe(400);
  // the default sport cannot be deleted; others can
  await req("PUT", "/settings", { defaultProfileId: id });
  expect((await req("DELETE", `/profiles/${id}`)).body.error).toContain("default");
  await req("PUT", "/settings", { defaultProfileId: "basketball" });
  expect((await req("DELETE", `/profiles/${id}`)).status).toBe(200);
  expect((await req("GET", "/settings")).body.defaultProfileId).toBe("basketball");
  app.stop();
});

test("API: a volleyball game end to end - state carries the sport summary, events validate against it, edits do not touch it", async () => {
  const { req, app } = rig();
  const g = (await req("POST", "/games", game({ id: "vb", profileId: "volleyball" }))).body;
  expect([g.sport, g.profileId]).toEqual(["Volleyball", "volleyball"]);
  expect((await req("POST", "/games/vb/activate")).body.profileSnapshot.id).toBe("volleyball");
  const st = (await req("GET", "/state")).body;
  expect(st.sport).toMatchObject({ id: "volleyball", clockMode: "none" });
  expect(st.game).toMatchObject({ clockMode: "none", periodLabel: "Set 1", counters: { timeouts: { home: 2, away: 2 }, sets: { home: 0, away: 0 } } });
  expect((await req("POST", "/event", { type: "score", team: "home", points: 2 })).status).toBe(400);
  expect((await req("POST", "/event", { type: "foul", team: "home" })).body.error).toContain("no fouls");
  expect((await req("POST", "/event", { type: "counter", team: "home", id: "timeouts", delta: -1 })).status).toBe(200);
  for (let i = 0; i < 25; i++) await req("POST", "/event", { type: "score", team: "home", points: 1 });
  const after = (await req("GET", "/state")).body.game;
  expect([after.periodLabel, after.sets.home, after.home.timeouts, after.home.score]).toEqual(["Set 2", 1, 2, 0]);
  expect((await req("POST", "/event", { type: "undo" })).status).toBe(200); // undo the winning point: back to 24-0 in set 1
  expect((await req("GET", "/state")).body.game).toMatchObject({ periodLabel: "Set 1", home: { score: 24 } });
  // edit volleyball to need 10 points: the running game still plays to 25
  const vb = (await req("GET", "/profiles/volleyball")).body;
  await req("PUT", "/profiles/volleyball", { ...vb, win: { ...vb.win, points: 10 } });
  await req("POST", "/event", { type: "score", team: "home", points: 1 });
  expect((await req("GET", "/state")).body.game.periodLabel).toBe("Set 2"); // 25 reached
  const pf = (await req("POST", "/preflight")).body;
  expect(pf.find((c: any) => c.id === "game.roster.home").status).toBe("warn"); // no roster, and no starters check was invented for it
  expect((await req("GET", "/sponsors/plan")).body.plan.map((p: any) => p.slot)[1]).toBe("Set 1 timeout");
  app.stop();
});

test("the basketball game is unchanged through the API (old screens keep working)", async () => {
  const { req, app } = rig();
  await req("POST", "/games", game({ id: "bb" }));
  await req("POST", "/games/bb/activate");
  const st = (await req("GET", "/state")).body;
  expect(st.sport).toMatchObject({ id: "basketball", periodLabels: ["Q1", "Q2", "Q3", "Q4", "OT"] });
  expect(st.settings.profile).toEqual({ periods: 4, periodMin: 8, overtimeMin: 4, bonusAt: 5, timeouts: 3 });
  expect(Object.keys(st.game.home).sort()).toEqual(["abbr", "bonus", "fouls", "name", "score", "timeouts"]);
  for (const e of [{ type: "score", team: "home", points: 3 }, { type: "foul", team: "away" }, { type: "timeout", team: "home" }, { type: "period.set", period: 2 }, { type: "clock.start" }]) expect((await req("POST", "/event", e)).status).toBe(200);
  expect((await req("POST", "/event", { type: "score", team: "home", points: 6 })).status).toBe(400);
  app.stop();
});

test("the JSON examples in docs/dev/profiles.md are valid profiles and play", async () => {
  const md = await Bun.file(`${import.meta.dir}/../docs/dev/profiles.md`).text();
  const blocks = [...md.matchAll(/```json profile\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));
  expect(blocks.map((b) => b.name)).toEqual(["Rugby sevens", "Badminton", "Skyball"]);
  const [rugby, badminton, sky] = blocks.map((b, i) => validateProfile(b, "ex" + i, false));
  expect(fold(log({ type: "score", team: "home", points: 5, kind: "try" }, { type: "score", team: "home", points: 2, kind: "conversion" }), rugby).home.score).toBe(7);
  const capped = fold(log(...rally(29), ...points("home", 1)), badminton);
  expect([capped.home.setsWon, capped.sets[0]]).toEqual([1, { home: 30, away: 29 }]);
  const s = view(fold(log(...[1, 1, 1, 1].map((): Ev => ({ type: "counter", team: "home", id: "power", delta: 1 }))), sky), 0) as any;
  expect([s.counters.power.home, s.thresholds.power.home]).toEqual([3, "Full power"]);
});
