// The sport profile contract. A profile is plain data: the game engine (src/game.ts) reads it, the UI renders buttons from it,
// and a copy is frozen into every game when the game starts (GameDoc.profileSnapshot), so editing a profile later never
// changes a game that already has events. Docs kind "profile" in the store; see docs/dev/profiles.md.

/** One way to score: a button on the console and phone. `points` may repeat (touchdown 6, safety 2, two-point try 2). */
export interface ScoreOption {
  id: string; // stable key, a-z 0-9 _ ("td"). Sent as `kind` on score events so clips can say "Touchdown".
  label: string; // "Touchdown" (<= 24 chars)
  points: number; // whole number 1..99
  hotkey?: string; // optional keyboard key hint for the console
}

/** A per-team number the operator taps: fouls, timeouts, cards, penalties, challenges. */
export interface CounterDef {
  id: string; // "fouls" and "timeouts" are special: the old `foul` and `timeout` events change these two
  label: string;
  perTeam: true; // counters always exist once per team (kept as a field so a future shared counter is not a breaking change)
  startValue?: number; // value at game start (default 0). Timeouts: 3 means "3 left", and each timeout uses one
  limit?: number; // highest value allowed (default none). Pip total for `showAs: "pips"` = limit, else startValue, else the highest threshold
  resetEachPeriod: boolean; // back to startValue whenever the period changes (team fouls)
  resetAtPeriods?: number[]; // overrides resetEachPeriod: reset only when one of these periods starts (football timeouts: [3])
  thresholds?: { at: number; label: string }[]; // when the count reaches `at`, `label` is shown ("Bonus"). Highest reached wins
  thresholdsApplyTo?: "self" | "opponent"; // whose count triggers it: basketball's bonus belongs to the team that did NOT foul
  showAs: "pips" | "number";
}

/** "First to N, win by M" rules, for sports played in sets (volleyball, badminton, table tennis). Periods are the sets. */
export interface WinRules {
  points: number; // a set is won at this many points...
  winBy: number; // ...with at least this lead (2 = deuce handling)
  cap?: number; // hard stop: first to this many wins whatever the lead (badminton 30)
  decidingPoints?: number; // the last possible set is played to this instead (volleyball 15)
  setsToWin: number; // sets needed to win the match (best of 5 = 3)
}

export interface ProfileDoc {
  id: string; // "basketball" etc. for built-ins, "profile_ab12cd34" for yours
  name: string; // "High school basketball" (<= 40)
  builtin: boolean;
  sport: string; // short sport label shown in the app ("Basketball")
  starters: number; // players per side in the starting lineup (0 = do not check). Used by the pre-flight check
  periods: {
    count: number; // 1..12
    names?: string[]; // "Q1".."Q4", "1st half", "Set 1" (<= count entries, <= 24 chars each)
    lengthMin?: number; // minutes per period (needed unless the clock mode is "none")
    overtime: { enabled: boolean; lengthMin: number; namePrefix: string }; // period count+1 is "OT", count+2 is "OT2"
  };
  clock: {
    mode: "down" | "up" | "none"; // down stops at 0; up has no cap (stoppage time); none = no clock at all (clockMs stays 0)
    carryOver?: boolean; // up clocks only: the second half starts at 45:00, not 0:00 (default true)
    maxMin?: number; // up clocks only: optional cap
    stopsOn?: string[]; // information for UI hints: what normally stops the clock ("whistle", "timeout", "out of bounds")
    displayFormat: "mm:ss" | "m:ss" | "tenths"; // "tenths" shows 0:09.4 in the last minute
  };
  scoring: ScoreOption[]; // 1..8 entries
  counters: CounterDef[]; // 0..12 entries
  periodLabelFormat: string; // used when `names` has no entry for a period; must contain {n}, e.g. "Q{n}"
  win?: WinRules;
  sponsorBreakCounter?: string; // counter id that marks a sponsor break when used (default "timeouts" when present)
  display: { clock: boolean; period: boolean; counters: boolean }; // hints for graphics: which parts of the scorebug to show
}

/** What phones and the UI get with every state update: enough to draw the buttons, nothing they must compute themselves. */
export interface ProfileSummary {
  id: string; name: string; sport: string;
  scoring: ScoreOption[];
  counters: CounterDef[];
  periodLabels: string[]; // labels for periods 1..count, then the first overtime
  periodCount: number; overtime: boolean;
  clockMode: "down" | "up" | "none"; displayFormat: ProfileDoc["clock"]["displayFormat"];
  win: WinRules | null;
  display: ProfileDoc["display"];
  sponsorBreakCounter: string | null;
}
