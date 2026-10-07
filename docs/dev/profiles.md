# Sport profiles (developer guide)

A sport profile is plain data that tells the game engine how a sport works: how many periods, how the clock runs, which scoring buttons exist, which per-team counters exist (fouls, timeouts, cards) and, for set sports, when a set is won. Basketball, soccer, American football, volleyball and ice hockey ship built in. Users can duplicate, edit, create, import and export profiles. For the plain-language version see [Sport profiles](../sport-profiles.md).

Code map:

| File | What it holds |
|------|---------------|
| `src/profiles/types.ts` | The contract: `ProfileDoc`, `ScoreOption`, `CounterDef`, `WinRules`, `ProfileSummary` |
| `src/profiles/builtins.ts` | The five built-in profiles, as data |
| `src/profiles/validate.ts` | `validateProfile()`: limits and plain-language errors |
| `src/profiles/lib.ts` | Period labels, `summary()`, the old five-field view, sponsor break trigger |
| `src/profiles/store.ts` | List, save, duplicate, delete, reset, export, import (docs kind `profile`) |
| `src/profiles-routes.ts` | The `/api/profiles` routes |
| `src/game.ts` | The engine: `fold`, `view`, `parseEv`, all driven by the profile |

## Data model

```ts
ProfileDoc {
  id, name, builtin, sport, starters,
  periods:  { count, names?, lengthMin?, overtime: { enabled, lengthMin, namePrefix } },
  clock:    { mode: "down" | "up" | "none", carryOver?, maxMin?, stopsOn?, displayFormat },
  scoring:  [{ id, label, points, hotkey? }],
  counters: [{ id, label, perTeam: true, startValue?, limit?, resetEachPeriod, resetAtPeriods?,
               thresholds?, thresholdsApplyTo?, showAs }],
  periodLabelFormat,            // fallback when `names` has no entry, must contain {n}
  win?: { points, winBy, cap?, decidingPoints?, setsToWin },
  sponsorBreakCounter?, display: { clock, period, counters }
}
```

Behavior in one place:

- **Periods.** Period `count + 1` is overtime (`namePrefix`, then `OT2`, ...). An event may set a period up to `count` (plus 5 when overtime is on; basketball keeps its old limit of 9). A period change stops the clock, resets it, resets counters (below) and, in set sports, starts the next set at 0-0.
- **Clock.** `down`: starts at `lengthMin`, stops at 0. `up`: starts at 0 and has no cap unless `maxMin`; with `carryOver` (default) the 2nd half starts at 45:00, not 0:00. `none`: no clock, `clockMs` stays 0, `clock.*` events are refused. `stopsOn` is only a hint for the UI.
- **Scoring.** `score {team, points, kind?}`. `points` must be one of the profile's values. `kind` is optional (a scoring option id) and lets clips say the right word when two options share points (football: safety 2 and two-point try 2).
- **Counters.** Every counter exists once per team and starts at `startValue` (default 0). `counter {team, id, delta: 1|-1}` changes it, never below 0 or above `limit`. Reset: `resetEachPeriod` resets at every period change; `resetAtPeriods: [3]` instead resets only when period 3 starts (football timeouts per half). `thresholds` show a label once the count reaches `at` (the highest reached wins); `thresholdsApplyTo: "opponent"` means the other team's count triggers it (basketball bonus).
- **Win rules.** Periods are sets. After every point the engine checks whether the leader has `points` (or `decidingPoints` when both teams are one set from winning) with a lead of `winBy`, or reached `cap`. The set is then recorded, the winner's sets won goes up, and the next set starts. At `setsToWin` the match is won and play stops advancing. This is pure fold logic, so undoing the winning point restores the set.
- **Sponsor breaks.** `sponsorBreakCounter` (default `timeouts` if present) names the counter that signals a break; the sponsor slot (timeout, halftime, period end, postgame) comes from the clock and period (`breakTrigger` in `lib.ts`).

## Events and compatibility

Existing events keep their meaning forever. `foul` is `counter {id: "fouls", delta: +1}` and `timeout` is `counter {id: "timeouts", delta: -1}`. If the profile has no such counter, the event is refused when sent and ignored when replayed. New: `counter`, and an optional `kind` on `score`. Old logs replay to exactly the same state: `src/game-golden.test.ts` keeps a verbatim copy of the original engine and compares it with the new one on thousands of random logs (undo, period changes, restarts, crash reload).

`parseEv(x, profile)` validates against the game's profile. `parseEv(x)` still works and means basketball. `view()` is a superset of the old shape: `home`/`away` keep `abbr, name, score, fouls, timeouts, bonus`; new top-level fields are `counters` (`{ id: { home, away } }`), `thresholds` (`{ id: { home, away } }` labels), `periodLabel`, `clockMode`, and, in set sports, `sets` (`{ home, away, history, toWin, winner }`; also `counters.sets`, and `setsWon` on each team).

## Snapshots and migration

A profile is copied into the game when the game starts (`snapshotProfile` in `src/data.ts`, called on first activation): `GameDoc.profileId` and `GameDoc.profileSnapshot`. The engine always reads the snapshot, so editing or deleting a profile never changes a game that has events. Before the game starts it may still change sport (`profileId`); afterwards `PUT /api/games/:id` keeps the snapshot and refuses a different `profileId`.

Store migration v2 freezes the original basketball rules into every game that already has events. Games without events take the default sport when they start. Built-ins live in code; editing one saves an override doc with the same id, and **Reset** deletes the override, so a new Fieldhouse can improve a built-in for anyone who never edited it.

## API

| Route | Does |
|-------|------|
| `GET /api/profiles` | All profiles (`modified: true` on an edited built-in) |
| `POST /api/profiles` | Create from a full profile, or `{ "duplicateOf": "<id>", "name": "..." }` |
| `GET /api/profiles/:id`, `PUT /api/profiles/:id` | Read, replace (validated). A built-in stays built-in |
| `DELETE /api/profiles/:id` | Custom profiles only, and not the default sport |
| `POST /api/profiles/:id/reset` | Built-ins: remove your edits |
| `GET /api/profiles/:id/export` | A JSON file: `{ "fieldhouseProfile": 1, "profile": { ... } }` |
| `POST /api/profiles/import` | Accepts that file or a bare profile; always gets a new id |
| `PUT /api/settings { defaultProfileId }` | The sport new games use |
| `POST /api/games { profileId }` | Pick the sport for one game |

`GET /api/state` has `sport` (a `ProfileSummary` for the active game: scoring, counters, period labels, clock mode, win rules) next to `game`. Phones get the same `sport` in their trimmed state. `settings.profile` (periods, periodMin, overtimeMin, bonusAt, timeouts) still exists: it is a view of the built-in basketball profile, and `PUT /api/settings { profile }` writes to it.

## Validation (what a user sees)

Period count 1 to 12. Names up to 24 characters, no more names than periods. 1 to 8 scoring options, points 1 to 99, unique ids (`a-z`, digits, `_`). Up to 12 counters, up to 4 thresholds each, start value and limit 0 to 99. A sport with a clock needs `periods.lengthMin`. Pips need something to count (start value, limit or threshold). Win rules need enough periods for the sets. Every error says what to change, for example "A sport can have at most 12 counters." Unknown fields are dropped, so files from a newer Fieldhouse still import.

## Defining a sport: three examples

The JSON blocks below are validated by `src/profiles.test.ts`, so they stay correct. Save one as a file and import it, or `POST` it to `/api/profiles`.

### 1. Rugby sevens: two halves, an up clock, tries and kicks

```json profile
{
  "name": "Rugby sevens", "sport": "Rugby", "starters": 7,
  "periods": { "count": 2, "names": ["1st half", "2nd half"], "lengthMin": 7, "overtime": { "enabled": true, "lengthMin": 5, "namePrefix": "ET" } },
  "clock": { "mode": "up", "displayFormat": "m:ss" },
  "scoring": [
    { "id": "try", "label": "Try", "points": 5 },
    { "id": "conversion", "label": "Conversion", "points": 2 },
    { "id": "penalty", "label": "Penalty goal", "points": 3 }
  ],
  "counters": [
    { "id": "yellow", "label": "Yellow cards", "resetEachPeriod": false, "showAs": "number" }
  ],
  "periodLabelFormat": "Half {n}"
}
```

### 2. Badminton: sets to 21, win by 2, capped at 30, best of 3, no clock

```json profile
{
  "name": "Badminton", "sport": "Badminton", "starters": 1,
  "periods": { "count": 3, "lengthMin": null, "overtime": { "enabled": false, "lengthMin": 1, "namePrefix": "OT" } },
  "clock": { "mode": "none" },
  "scoring": [{ "id": "rally", "label": "Point", "points": 1 }],
  "counters": [],
  "periodLabelFormat": "Game {n}",
  "win": { "points": 21, "winBy": 2, "cap": 30, "setsToWin": 2 }
}
```

(`lengthMin: null` is accepted for "none"; leaving it out is the same.)

### 3. A made-up sport: Skyball, two 10-minute halves, three kinds of goal, a power-up counter that fills to 3

```json profile
{
  "name": "Skyball", "sport": "Skyball", "starters": 5,
  "periods": { "count": 2, "names": ["First flight", "Second flight"], "lengthMin": 10, "overtime": { "enabled": true, "lengthMin": 3, "namePrefix": "Sudden" } },
  "clock": { "mode": "down", "stopsOn": ["hoop scored", "grounded"], "displayFormat": "mm:ss" },
  "scoring": [
    { "id": "low", "label": "Low hoop", "points": 1, "hotkey": "1" },
    { "id": "high", "label": "High hoop", "points": 3, "hotkey": "3" },
    { "id": "cloud", "label": "Cloud shot", "points": 7, "hotkey": "7" }
  ],
  "counters": [
    { "id": "power", "label": "Power-ups", "startValue": 0, "limit": 3, "resetEachPeriod": true, "showAs": "pips", "thresholds": [{ "at": 3, "label": "Full power" }] },
    { "id": "timeouts", "label": "Timeouts", "startValue": 2, "resetEachPeriod": false, "showAs": "pips" }
  ],
  "periodLabelFormat": "Flight {n}",
  "sponsorBreakCounter": "timeouts"
}
```

Skyball's console would show three score buttons (+1, +3, +7), a power-up pip row that lights "Full power" at 3 and refills every flight, and a timeout pip row that triggers sponsor breaks.

## For UI authors

Draw buttons from `state.sport` (`scoring`, `counters`, `periodLabels`, `clockMode`), not from constants. Send `score {team, points, kind}` and `counter {team, id, delta}`. Hide the clock for `clockMode: "none"`. Pip total for a `pips` counter is `limit`, else `startValue`, else the highest threshold. Keep sending `foul`/`timeout` only for basketball-style screens; `counter` works for every sport including basketball.
