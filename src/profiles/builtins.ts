// The sports Fieldhouse ships with. Plain data, so a user's own sport looks exactly like these.
// Basketball must stay byte-for-byte what the engine hard-coded before profiles existed (see src/game-golden.test.ts).
import type { ProfileDoc } from "./types";

const names = (...n: string[]) => n;

export const BASKETBALL: ProfileDoc = {
  id: "basketball", name: "Basketball", builtin: true, sport: "Basketball", starters: 5,
  periods: { count: 4, names: names("Q1", "Q2", "Q3", "Q4"), lengthMin: 8, overtime: { enabled: true, lengthMin: 4, namePrefix: "OT" } },
  clock: { mode: "down", stopsOn: ["whistle", "timeout", "out of bounds"], displayFormat: "tenths" },
  scoring: [
    { id: "ft", label: "Free throw", points: 1 },
    { id: "fg2", label: "Basket", points: 2 },
    { id: "fg3", label: "3-pointer", points: 3 },
  ],
  counters: [
    // Team fouls reset every period; the OTHER team shoots the bonus once you reach 5 (high-school rule, editable).
    { id: "fouls", label: "Team fouls", perTeam: true, startValue: 0, resetEachPeriod: true, thresholds: [{ at: 5, label: "Bonus" }], thresholdsApplyTo: "opponent", showAs: "pips" },
    { id: "timeouts", label: "Timeouts", perTeam: true, startValue: 3, resetEachPeriod: false, showAs: "pips" },
  ],
  periodLabelFormat: "Q{n}", sponsorBreakCounter: "timeouts",
  display: { clock: true, period: true, counters: true },
};

export const SOCCER: ProfileDoc = {
  id: "soccer", name: "Soccer", builtin: true, sport: "Soccer", starters: 11,
  periods: { count: 2, names: names("1st half", "2nd half"), lengthMin: 45, overtime: { enabled: true, lengthMin: 15, namePrefix: "ET" } },
  clock: { mode: "up", carryOver: true, stopsOn: [], displayFormat: "m:ss" }, // runs through stoppage time; 2nd half starts at 45:00
  scoring: [{ id: "goal", label: "Goal", points: 1 }],
  counters: [
    { id: "yellow", label: "Yellow cards", perTeam: true, startValue: 0, resetEachPeriod: false, showAs: "number" },
    { id: "red", label: "Red cards", perTeam: true, startValue: 0, resetEachPeriod: false, showAs: "number" },
  ],
  periodLabelFormat: "Half {n}", display: { clock: true, period: true, counters: true },
};

export const FOOTBALL: ProfileDoc = {
  id: "football", name: "American football", builtin: true, sport: "Football", starters: 11,
  periods: { count: 4, names: names("Q1", "Q2", "Q3", "Q4"), lengthMin: 12, overtime: { enabled: true, lengthMin: 12, namePrefix: "OT" } },
  clock: { mode: "down", stopsOn: ["incomplete pass", "out of bounds", "timeout", "change of possession"], displayFormat: "m:ss" },
  scoring: [
    { id: "td", label: "Touchdown", points: 6 },
    { id: "xp", label: "Extra point", points: 1 },
    { id: "two", label: "Two-point try", points: 2 },
    { id: "fg", label: "Field goal", points: 3 },
    { id: "safety", label: "Safety", points: 2 },
  ],
  // Three timeouts per half: they come back when the 3rd quarter starts.
  counters: [{ id: "timeouts", label: "Timeouts", perTeam: true, startValue: 3, resetEachPeriod: false, resetAtPeriods: [3], showAs: "pips" }],
  periodLabelFormat: "Q{n}", sponsorBreakCounter: "timeouts", display: { clock: true, period: true, counters: true },
};

export const VOLLEYBALL: ProfileDoc = {
  id: "volleyball", name: "Volleyball", builtin: true, sport: "Volleyball", starters: 6,
  periods: { count: 5, names: names("Set 1", "Set 2", "Set 3", "Set 4", "Set 5"), overtime: { enabled: false, lengthMin: 1, namePrefix: "OT" } },
  clock: { mode: "none", displayFormat: "mm:ss" },
  scoring: [{ id: "point", label: "Point", points: 1 }],
  counters: [{ id: "timeouts", label: "Timeouts", perTeam: true, startValue: 2, resetEachPeriod: true, showAs: "pips" }],
  periodLabelFormat: "Set {n}",
  win: { points: 25, winBy: 2, decidingPoints: 15, setsToWin: 3 }, // rally scoring, best of 5
  sponsorBreakCounter: "timeouts", display: { clock: false, period: true, counters: true },
};

export const HOCKEY: ProfileDoc = {
  id: "hockey", name: "Ice hockey", builtin: true, sport: "Hockey", starters: 6,
  periods: { count: 3, names: names("1st", "2nd", "3rd"), lengthMin: 20, overtime: { enabled: true, lengthMin: 5, namePrefix: "OT" } },
  clock: { mode: "down", stopsOn: ["whistle", "goal", "penalty", "timeout"], displayFormat: "tenths" },
  scoring: [{ id: "goal", label: "Goal", points: 1 }],
  counters: [
    { id: "penalties", label: "Penalties", perTeam: true, startValue: 0, resetEachPeriod: false, showAs: "number" },
    { id: "shots", label: "Shots on goal", perTeam: true, startValue: 0, resetEachPeriod: false, showAs: "number" },
  ],
  periodLabelFormat: "P{n}", display: { clock: true, period: true, counters: true },
};

export const BUILTINS: ProfileDoc[] = [BASKETBALL, SOCCER, FOOTBALL, VOLLEYBALL, HOCKEY];
export const builtin = (id: string) => BUILTINS.find((p) => p.id === id);
