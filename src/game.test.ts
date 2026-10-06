import { expect, test } from "bun:test";
import { bonus, clockAt, fold, lastUndoable, parseEv, view, type Ev, type Logged } from "./game";
import { openStore } from "./store";

// Build a log with explicit wall times so clock math is deterministic.
const mk = (evs: [number, Ev][]): Logged[] => evs.map(([t, e], i) => ({ ...e, seq: i + 1, t }) as Logged);
const start: Ev = { type: "game.start", home: "WIL", away: "LIO" };

test("scoring, period clock and team labels", () => {
  const s = fold(mk([[0, start], [10, { type: "score", team: "home", points: 3 }], [20, { type: "score", team: "away", points: 2 }]]));
  expect([s.home.abbr, s.home.score, s.away.score]).toEqual(["WIL", 3, 2]);
  expect(s.clockMs).toBe(8 * 60_000);
});

test("clock runs between start and stop, and is derived at read time", () => {
  const log = mk([[0, start], [1_000, { type: "clock.start" }]]);
  const running = fold(log);
  expect(clockAt(running, 6_000)).toBe(8 * 60_000 - 5_000); // 5 s after start
  const stopped = fold(mk([[0, start], [1_000, { type: "clock.start" }], [6_000, { type: "clock.stop" }]]));
  expect(stopped.running).toBe(false);
  expect(clockAt(stopped, 999_999)).toBe(8 * 60_000 - 5_000); // frozen
  expect(clockAt(fold(mk([[0, start], [0, { type: "clock.set", ms: 500 }], [0, { type: "clock.start" }]])), 10_000)).toBe(0); // never negative
});

test("bonus is set by the other team's fouls and resets each period", () => {
  const fouls: [number, Ev][] = [0, 1, 2, 3, 4].map((i) => [i, { type: "foul", team: "away" }]);
  const s = fold(mk([[0, start], ...fouls]));
  expect(s.away.fouls).toBe(5);
  expect(bonus(s, "home")).toBe(true); // home shoots bonus free throws
  expect(bonus(s, "away")).toBe(false);
  const next = fold(mk([[0, start], ...fouls, [9, { type: "period.set", period: 2 }]]));
  expect([next.away.fouls, next.running, next.clockMs]).toEqual([0, false, 8 * 60_000]);
  expect(fold(mk([[0, start], [1, { type: "period.set", period: 5 }]])).clockMs).toBe(4 * 60_000); // overtime
});

test("undo removes an event from the fold but never from the log", () => {
  const log = mk([[0, start], [1, { type: "score", team: "home", points: 2 }], [2, { type: "score", team: "home", points: 3 }]]);
  expect(lastUndoable(log)?.seq).toBe(3);
  const undone = [...log, ...mk([[3, { type: "undo", target: 3 }]]).map((e) => ({ ...e, seq: 4 }))] as Logged[];
  expect(fold(undone).home.score).toBe(2);
  expect(lastUndoable(undone)?.seq).toBe(2); // next undo goes one further back
  expect(undone).toHaveLength(4);
});

test("timeouts never go below zero", () => {
  const t: [number, Ev][] = [1, 2, 3, 4].map((i) => [i, { type: "timeout", team: "home" }]);
  expect(fold(mk([[0, start], ...t])).home.timeouts).toBe(0);
});

test("parseEv rejects bad input at the LAN boundary", () => {
  expect(parseEv({ type: "score", team: "home", points: 4 })).toBeTypeOf("string");
  expect(parseEv({ type: "score", team: "nobody", points: 2 })).toBeTypeOf("string");
  expect(parseEv({ type: "clock.set", ms: -1 })).toBeTypeOf("string");
  expect(parseEv({ type: "drop table" })).toBeTypeOf("string");
  expect(parseEv(null)).toBeTypeOf("string");
  expect(parseEv({ type: "score", team: "home", points: 3, player: 12, evil: "x" })).toEqual({ type: "score", team: "home", points: 3, player: 12 });
});

test("crash recovery: state rebuilt from the stored log equals the live state", () => {
  const db = openStore(":memory:");
  const live: Logged[] = [];
  const evs: [number, Ev][] = [[0, start], [100, { type: "clock.start" }], [5_100, { type: "score", team: "away", points: 3 }], [9_100, { type: "foul", team: "home" }]];
  for (const [t, e] of evs) live.push(db.append("g1", e, t));
  const recovered = db.load("g1"); // what a restarted process reads
  expect(recovered).toEqual(live);
  const now = 20_000;
  expect(view(fold(recovered), now)).toEqual(view(fold(live), now));
  expect(view(fold(recovered), now).clockMs).toBe(8 * 60_000 - 19_900); // clock kept running across the "crash"
  expect(db.load("other")).toEqual([]); // logs are per game
  db.put("sponsor", { id: "s1", name: "Smith Dental" });
  expect(db.get("sponsor", "s1")).toEqual({ id: "s1", name: "Smith Dental" });
  db.put("sponsor", { id: "s1", name: "Smith Dental 2" }); // upsert
  expect(db.list("sponsor")).toHaveLength(1);
  db.del("sponsor", "s1");
  expect(db.get("sponsor", "s1")).toBeUndefined();
  db.close();
});
