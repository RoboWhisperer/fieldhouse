# Web app: how screens plug in

No build step. `index.html` loads `app.js` (core) which imports `/screens/<name>.js` on navigation. Design CSS (`tokens.css`, `ui.css`, `icons.js`, `ui.js`) is shared with the design frames in `../design/`. The frames in `../design/screens/*.html` are the visual spec for each screen: match them (layout, classes, copy), but fill them with live data and working controls.

Run: `DEMO=1 bun src/server.ts` then open http://127.0.0.1:8080 (DEMO=1 seeds a venue, destinations, sponsors, games). Reset by deleting `data/` (or set `DB=/tmp/x.db`).

## Screen module contract (`web/screens/<name>.js`)

```js
import { html, raw, esc, icon, api, S, toast, fail, go, keys, mmss, fmtBytes, fmtDate, fmtTime, fmtElapsed, period, clockMs, subscribe } from "../app.js";
export default {
  shell: "manage" | "night",   // manage = rail + topbar (Home, Sponsors, Reports, Settings); night = stepper + Game Ribbon topbar, no rail
  nav: "home",                 // manage shell: which rail item is current (home|sponsors|reports|settings)
  step: 1,                     // night shell: 1 Setup, 2 Check, 3 Live, 4 Wrap-up
  css: `...`,                  // optional page CSS string, injected once
  async load(ctx) { return await api.get("/games"); },        // optional; result is passed on as `data`
  render(ctx, data) { return html`<div>...</div>`; },         // REQUIRED: returns html`` (values are auto-escaped; raw() opts out)
  bind(root, ctx, data) { /* attach events; return a cleanup fn */ },
  onState(root, state, ctx, data) { /* every live push; patch DOM; do NOT re-render inputs */ },
};
```

`ctx` = `{ params, query, go(path), api, S, toast, fail, keys, rerender(), redraw() }`. `rerender()` reloads data and redraws; `redraw()` redraws with the current `data` (mutate `data` first). Redrawing replaces the DOM, so avoid it while the user types: patch instead.

Templating: `html\`...\`` escapes every interpolation; arrays are joined; `false/null` render as nothing; use `raw(str)` or the `icon("name")` helper for trusted markup. NEVER put unescaped user text (team names, sponsor names, CSV cells) into markup.

Live bindings (no code needed): put `data-clock` on an element for the game clock (mm:ss, interpolated every 100 ms) and `data-bind="game.home.score"` (any path into `S.state`; `game.period` renders as Q3/OT) to keep numbers live. The Game Ribbon in the night shell is already wired.

Keyboard: `keys({ "Enter": fn, "Shift+Enter": fn, "R": fn, "Ctrl+Z": fn })` returns a cleanup function (call it in your `bind` cleanup). Keys are ignored while typing in inputs. Read bindings from `S.state.settings.shortcuts` (action -> key) rather than hard-coding.

Navigation: hash routes. `go("/preflight")`. Route table is in `app.js` (`ROUTES`): `/`, `/welcome`, `/game/new`, `/game/roster`, `/sources`, `/preflight`, `/live`, `/replay`, `/wrapup`, `/sponsors`, `/reports`, `/settings/<section>` (section = destinations|themes|sport|shortcuts|remote|storage|diagnostics|about, default destinations).

## Live state (`S.state`, pushed over `/ws`, also `GET /api/state`)

```
{ version, serverNow, gameId, gameDoc: GameDoc|null,          // teams, colors, rosters of the ACTIVE game
  game: { period, clockMs, running, home:{abbr,name,score,fouls,timeouts,bonus}, away:{...} } | null,
  events: Logged[],          // last 60 score/foul/timeout/mark/undo/period events: {seq,t,type,...}
  engine: EngineStatus,      // sources, program/preview, mixer, stream, record, cpu, diskFreeBytes (see src/types.ts)
  graphics: { scorebug, lower, slate, sponsor,        // the original four, unchanged
              items, vars, engineLayers },             // every enabled graphic with its render info, and the variables (docs/dev/graphics-api.md)
  next: { sponsorId,name,abbr,color,seconds,trigger,assets } | null,   // next sponsor break due
  settings: SettingsDoc, recording: RecordingDoc|null,
  recovered: { at } | null } // set when the app restarted into a live game
```

Images: `GET /snap/<sourceId>` returns the current still for a source (poll `<img src="/snap/cam1?t=...">` at ~2 fps for monitors, ~1 fps for tiles).

## API (all JSON, under `/api`; errors are `{error}` with a plain-language message; show it with `fail(e)`)

- Game: `POST /event` `{type, ...}` (see `src/game.ts` `Ev`: `clock.start|stop|set{ms}`, `period.set{period}`, `score{team,points,player?}`, `foul{team}`, `timeout{team}`, `mark{note?}`, `undo{target?}`); `GET /log`; `GET/POST /games`; `GET/PUT /games/:id`; `POST /games/:id/activate`; `POST /games/:id/finish`; `POST /roster/parse {text,mapping?}`.
- Setup: `GET /venues`; `PUT /venues`; `POST /venues/:id/apply`; `GET /devices`; `POST /slots {slot,deviceId,label}`; `GET/POST /destinations`; `DELETE /destinations/:id`; `POST /destinations/:id/test`; `POST /preflight` -> `Check[]`.
- Broadcast: `POST /broadcast/start`; `POST /broadcast/stop`; `POST /engine/preview {sourceId}`; `/engine/cut`; `/engine/fade {ms}`; `/engine/mute {id,muted}`; `/engine/gain {id,gainDb}`; `POST /replay {secondsBack,speed}`; `/replay/stop`; `POST /graphics {scorebug?, slate?, lower?:{title,sub}|null}`.
- Sponsors: `GET/POST /sponsors`; `DELETE /sponsors/:id`; `GET /sponsors/plan` -> `{plan, conflicts}`; `POST /sponsors/fire {sponsorId?, outcome?: aired|skipped|delayed}`; `GET /reports/airings?sponsorId&gameId&from&to` -> `{rows, summary}`; `GET /reports/airings.csv` (link, same filters).
- After the game: `GET /recordings`; `DELETE /recordings/:id`; `GET /storage`; `GET /highlights/:gameId` -> `{recording, clips}`; `POST /highlights/:gameId/export {indexes?}`.
- Settings: `GET/PUT /settings`; `GET /diagnostics?n=&level=` -> `{logs, bundle, series}` (series = last game's 5 s health samples or null); `POST /diagnostics/bundle`; `GET /update[?force=1]` -> `{status: current|available|unavailable, ...}` (the only outbound call, user-initiated); `GET /retention/plan` (dry run of automatic cleanup).
- Playback (not under /api): `GET /rec/<recordingId>[?download=1]` and `GET /rec/highlights-<gameId>`, with Range support, for `<video>`.
- State also carries `notices: {id, at, level, message}[]` (disk space, cleanup); `app.js` toasts new ones.
- Demo/dev: `POST /demo` seeds demo data (only when DEMO=1 or the database has no games); `POST /dev/simulate {what, arg?}` (`source-drop|source-restore` with a source id, `stream-drop|stream-restore`, `disk-low|disk-restore`) to show the recovery states with the fake engine.

## Rules for every screen

- Match the design frame in `../design/screens/`; use the shared classes in `ui.css`; add page CSS via `css` only when a class does not exist. No new colors or fonts outside `tokens.css`. The LED face has digits only (never letters).
- Real data only: no hard-coded sample content except clearly empty states. Handle loading (skeleton or blank), empty, and error (`fail(e)` toast or inline `.banner.err`) states.
- Every control must work. Destructive actions are guarded as in the spec (End broadcast = hold 1.5 s; delete recording = type the game name).
- Never show stream keys (the API never returns them). Free and open source: no pricing, trial or account UI.
- Text >= 12px, keyboard reachable, visible focus, status = icon + text + color.

## Customization module (`web/customize.js`)

Owned by the automation/appearance UI; `console.js` and `app.js` call it. `app.js` loads it lazily and runs `applyUi` on every state push.

- `applyUi(state)`: applies `settings.ui` (theme dark/light/high-contrast/auto, accent, density, text size, motion, custom CSS) as CSS variables, `data-theme`/`data-density`/`data-motion` on `<html>` and one `<style id="user-css">`. Custom CSS is applied only in the local console (never `/remote` or `/overlay`). Cheap when the look did not change. `applyTokens(apiUiResult)` applies a `/api/ui` answer at once.
- `consolePanels(state, column)`: ordered panel ids (`game events graphics macros replay audio sponsor custom`) shown in `"left" | "center" | "right"` by the active layout preset.
- `macroBar(state)`: html string `<div class="macrobar" data-macrobar>` with one big button per `settings.ui.macroButtons` entry (macro color, icon, hotkey hint). Put it inside the `macros` panel. `bindMacroBar(root, state)`: wires button clicks and every macro hotkey to `POST /api/macros/:id/run` with a toast result; returns a cleanup. Macros are cached from `GET /api/macros` and bars repaint themselves when the cache or `macroButtons` change. Also exported: `PANEL_NAMES`, `runMacro(id,label)`, `refreshMacros()`, `activePreset(state)`.

Screens: `#/automation/<rules|macros|fields|webhooks|integrations|log>` (`screens/automation*.js`) and `#/settings/appearance` (`screens/settings-appearance.js`).

## Sport profiles in the UI

The console, phone remote, New game and Settings > Sport profiles all draw from the active sport (`state.sport`, a `ProfileSummary`; `docs/dev/profiles.md`), never from constants.

- `web/sport.js` is a plain script (`import "../sport.js"`, then `globalThis.FHSport`): score buttons, counter controls (`ctl` + `patchCtl`), period labels, hotkeys (`scoreKeys`: the +1/+2/+3 shortcuts follow the points; an option's `hotkey` scores for home, Shift+letter for away), `summaryOf(profileDoc)`, `describe`. The phone remote keeps a small copy in `remote.js` because the phone listener only serves allowlisted files (`src/auth.ts` `FILES`).
- Console: counters tap `foul`/`timeout` events for the `fouls`/`timeouts` counters (so automation rules keep firing) and `counter` events for the rest; scores send `kind`. No-clock sports hide the clock and answer clock keys with a plain message. `period()` in `app.js` uses `game.periodLabel`. Layout presets and the macro panel come from `customize.js` (default preset keeps the built-in arrangement).
- Settings > Sport profiles is `screens/profile-editor.js` (list, default, duplicate, delete, reset, import/export, editor with live preview). New game has a Sport picker (`profileId`); a started game's sport is locked.
