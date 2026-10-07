# Graphics API (developer guide)

Everything about graphics goes through `/api/graphics/...` (JSON unless noted) on the operator console (loopback) port. The types are in [`src/graphics/types.ts`](../../src/graphics/types.ts); the code is in `src/graphics/` and `src/graphics-routes.ts`. For people writing templates, see [Graphics: templates, imports and connectors](../graphics-authoring.md).

Rules that hold everywhere:

- **Loopback only.** `/gfx/*`, `/overlay` and every `/api/graphics*` route are unreachable from other devices (the remote gate answers 403). The only exception is the Producer role of a paired phone: it may call `show`, `hide`, `toggle`, `update`, `next` and `clear` (and sees a short list of graphics in its state).
- **Errors** are `{ "error": "plain sentence" }` with status 400 (bad input), 404 (unknown id), 409 (not allowed right now, for example hiding a graphic that is "always on"), 410 (an import expired), 415 (wrong content type) or 502 (a remote system refused).
- **Secrets are write-only.** A connector's app token or API key is accepted on create/update and never returned, logged or put in an error message; the API shows `secretSet: true`.
- **Live state** is pushed over `/ws` like everything else: `state.graphics` keeps the original fields (`scorebug`, `lower`, `slate`, `sponsor`) and adds `items`, `vars` and `engineLayers` (see [Live state](#live-state)).

## The graphic document

```json
{
  "id": "builtin-scorebug",          // builtin-<name> for the nine built-ins, gfx_<random> for everything else
  "name": "Score bug",
  "description": "Teams, score and game clock in the corner.",
  "enabled": true,                   // a disabled graphic cannot be shown and is not drawn
  "role": "scorebug",                // scorebug | lowerthird | fullscreen | ticker | corner | other
  "kind": "builtin",                 // builtin | html | caspar | url | remote
  "builtinId": "scorebug",           // built-ins and copies of built-ins
  "modified": false,                 // built-in seeds only: differs from the shipped default
  "placement": { "anchor": "bottom-left", "x": 64, "y": 64, "scale": 1, "z": 20, "opacity": 1 },
  "animation": {
    "in":  { "preset": "fade", "durationMs": 300, "delayMs": 0, "easing": "ease" },
    "out": { "preset": "fade", "durationMs": 300, "delayMs": 0, "easing": "ease" }
  },
  "show": { "mode": "manual", "startVisible": true },
  "requiresGame": true,              // hidden while no game is active
  "fields": [ { "name": "title", "label": "Title", "type": "text", "default": "", "binding": { "kind": "manual", "value": "" } } ],
  "style": { "colors": { "bg": "#0B1018", "...": "..." }, "radius": 6, "shadow": true, "fontFamily": "", "fontWeight": 800, "fontSize": 24, "scoreSize": 30, "parts": { "clock": true }, "speed": 120 },
  "source": {},                      // depends on kind, see below
  "createdAt": 1700000000000, "updatedAt": 1700000000000
}
```

**Canvas.** Every graphic is placed on a 1920x1080 canvas. `anchor` is one of `top-left top top-right left center right bottom-left bottom bottom-right`. `x` and `y` are distances in pixels from the anchored edge toward the inside (for `center` they are offsets right and down). `scale` is 0.1 to 5, `z` is the stacking order (higher is in front), `opacity` 0 to 1.

**Animation.** Presets: `none fade slide-left slide-right slide-up slide-down wipe scale`. `slide-left` enters from the left and leaves toward the left. `durationMs` and `delayMs` are 0 to 5000. Easing: `linear ease ease-in ease-out ease-in-out`. The host page applies them with CSS transitions to built-in and HTML graphics. CasparCG templates animate themselves in `play()` / `stop()`; URL and remote graphics are plain OBS layers (visible or not).

**Show policy** (`show.mode`): `manual` (only commands), `always` (on whenever enabled), `while-live` (on while a stream or recording runs), `auto-hide` (manual, then off after `show.seconds`, 1 to 3600). `show.startVisible` puts a manual graphic on air when a game starts (the score bug uses it). Commands on `always` and `while-live` graphics answer 409. `clear` leaves them alone.

**Fields.** A field is a named value a graphic uses: the data a template expects. `type` is `text number color image bool`. `binding.kind`:

- `var`: the value of a variable path such as `home.score` (falls back to `default` when empty).
- `const`: fixed text; `{{path}}` and `{{path|fallback}}` inside it are replaced from the variables.
- `manual`: only what `show`/`update` send, else `default`.

Values sent with `show` or `update` override the binding for that showing. The resolved values are in `items[].fields`.

**Style** (built-ins only; others ignore it). `colors` has `bg panel text muted accent score scoreText clock clockOff`; colours are `#hex`, `rgb()/rgba()/hsl()`, a colour name, and for `accent` also `home` or `away` (the team colour). `parts` shows or hides pieces; the parts of each built-in are listed in `BUILTIN_PARTS` (`scorebug: colorBars clock period fouls timeouts bonus`, `lowerthird: accentBar`, `sponsor: swatch caption`, `scoreboard: clock period fouls timeouts bonus names`, `clock: period`, `lineup: numbers positions`, `final: period label`, `slate` and `ticker`: none). `fontFamily` must be one of the families in `GET /api/graphics/fonts` (empty = default). `speed` is the ticker's pixels per second.

**`source` by kind**

| kind | source |
|---|---|
| `builtin` | `{}` |
| `html` | `{ entry: "index.html", width: 1920, height: 1080, allowNetwork: false }` |
| `caspar` | the same plus `dataFormat: "xml" \| "json"`, `stopHoldMs` (how long the page stays after `stop()`, default 1500), `nextIsPlay` |
| `url` | `{ url: "https://...", width, height, css }`. Always drawn as its own OBS layer. |
| `remote` | `{ connectorId, target: {...}, outputUrl: "https://...", width, height, css }`. `target` is the connector's address of the graphic. `outputUrl` (optional) is the page that shows it; it is added to OBS as a layer. |

The nine built-ins: `builtin-scorebug`, `builtin-lowerthird`, `builtin-slate`, `builtin-sponsor` (the original four, legacy API), `builtin-scoreboard` (full scoreboard), `builtin-ticker` (scrolling text from custom field `ticker`), `builtin-clock`, `builtin-lineup` (starters from the rosters) and `builtin-final` (final/halftime card). Built-ins cannot be deleted (turn them off), but can be edited and reset.

## Routes

### Documents

| Route | Body | Answer |
|---|---|---|
| `GET /api/graphics` | | array of graphic documents, each with `visible` |
| `GET /api/graphics/:id` | | one document (+ `visible`) |
| `POST /api/graphics/create` | `{ kind, name, ...any document fields }` (`kind` is `html`, `caspar`, `url` or `remote`) | the new document. HTML/Caspar graphics get a starter `index.html`. |
| `PUT /api/graphics/:id` | any subset of the document (`name enabled role requiresGame description placement animation show fields style source`); nested objects merge | the saved document. Built-ins get `modified` set. |
| `DELETE /api/graphics/:id` | | `{ ok }`. 409 for the nine built-ins. Removes the graphic's files and its OBS layer. |
| `POST /api/graphics/:id/duplicate` | `{ name? }` | the copy (files are copied too) |
| `POST /api/graphics/:id/reset` | | the built-in `:id` back at its shipped default (only `builtin-*` ids) |

Example: move the score bug to the top right, bigger, in red:

```
PUT /api/graphics/builtin-scorebug
{ "style": { "colors": { "bg": "#7a0019" }, "radius": 24 },
  "placement": { "anchor": "top-right", "x": 80, "y": 60, "scale": 1.4, "z": 20, "opacity": 1 },
  "animation": { "in": { "preset": "slide-left", "durationMs": 600 } } }
```

### Control

All answer `{ ok: true }` (show/hide/toggle also `visible`).

| Route | Body | Does |
|---|---|---|
| `POST /api/graphics/:id/show` | `{ fields?: { name: value } }` | put on air; `fields` override the bindings for this showing |
| `POST /api/graphics/:id/hide` | | take off air (CasparCG templates get `stop()` and stay drawn for `stopHoldMs`) |
| `POST /api/graphics/:id/toggle` | | |
| `POST /api/graphics/:id/update` | `{ fields }` | change data while on air (409 when not on air) |
| `POST /api/graphics/:id/next` | | CasparCG-style `next()` step (HTML, Caspar and remote graphics; 400 for built-ins) |
| `POST /api/graphics/clear` | | everything off air (except `always` / `while-live`) |

The same six actions are the `GraphicsControl` object (`app.graphics.control`) used by automation: `list() show(id, fields?) hide(id) toggle(id) update(id, fields) next(id) clear()`.

### The original API (unchanged)

`POST /api/graphics { scorebug?: boolean, slate?: string|null, lower?: { title, sub }|null }` still works and answers `{ scorebug, lower, slate, sponsor }`. It drives `builtin-scorebug`, `builtin-slate` and `builtin-lowerthird` (which hides itself after its auto-hide seconds, 8 by default). Sponsor breaks (`POST /api/sponsors/fire`) show `builtin-sponsor`. Starting a game puts everything off air and the score bug on. Editing those built-ins changes how the old buttons look; it does not change how they work.

### Variables and previews

- `GET /api/graphics/sample-vars` gives a fixed, believable set of variables (teams Lions and Tigers, 42 to 38, 4:31 left in Q3, starters, a ticker text) so an editor can preview with no game running. `?live=1` gives the current real values instead.
- `GET /api/graphics/state` is the same object as `state.graphics`.

Variables (all flat keys): `home.` and `away.` + `name abbr color score fouls timeouts bonus`; `period`, `periodLabel`, `clock` (mm:ss), `clockMs`, `running`; `game.title game.date game.venue game.status game.sport`; `home.starters.count`, `home.starters.N.name|number|position` and `home.starters.list` (also `roster` instead of `starters` for everyone); `lower.title lower.sub`, `sponsor.name sponsor.color sponsor.seconds`; `custom.<key>` for every custom field; `counters.<id>.home|away` from the sport profile. Missing values are left out (no game: names are "Home" / "Away", scores 0).

### Fonts

`GET /api/graphics/fonts`:

```json
{ "families": ["DejaVu Sans", "Liberation Sans", "Noto Sans", "Roboto"], "source": "obs", "probedAt": 1700000000000,
  "generics": { "sans-serif": false, "serif": false, "monospace": false, "system-ui": true, "cursive": false, "fantasy": false },
  "webFonts": null, "note": "..." }
```

`source` is `obs` when the list was measured inside OBS's own browser source (the overlay page measures about 80 candidate families the first time it loads and posts the result to `POST /api/graphics/fonts/report`), `browser` when it was measured in a normal browser, `none` before any check. `generics` says whether generic family names draw anything at all. On the development machine's OBS only `system-ui` did.

### Examples and import

- `GET /api/graphics/examples` lists three small CasparCG-compatible templates: `caspar-lower-third` (XML data), `caspar-score-bug` (JSON data), `caspar-fullscreen-card` (two steps with `next`). `POST /api/graphics/examples/:id/install` creates a graphic from one.
- **Import is two steps.** `POST /api/graphics/import` takes `multipart/form-data` with one or more `file` parts: a `.html`, a `.zip` of a template folder, several loose files (the file name may be a relative path such as `img/logo.png`), or a `.fhgfx` pack. Nothing is stored yet. The answer:

```json
{ "token": "uuid", "kind": "template", "name": "Score Bug",
  "files": [{ "path": "index.html", "bytes": 1234, "type": "html" }],
  "skipped": [{ "path": "readme.txt", "why": "The file type .txt is not allowed." }],
  "analysis": { "entry": "index.html", "entries": ["index.html"],
    "functions": { "play": true, "stop": true, "update": true, "next": false },
    "fields": [{ "id": "homeScore", "found": ["element id", "json key"], "suggestion": { "kind": "var", "value": "home.score" } }],
    "dataFormat": "json", "needsNetwork": false, "warnings": ["..."], "width": 1920, "height": 1080 },
  "graphic": null }
```

  For a `.fhgfx` pack `kind` is `pack`, `analysis` is null and `graphic` is the validated document. Then `POST /api/graphics/import/commit { token, name?, kind?: "caspar"|"html", entry?, role?, fields?, dataFormat?, allowNetwork?, width?, height?, stopHoldMs?, placement?, animation?, show?, requiresGame? }` stores it and answers the new document. Defaults come from the analysis (fields: one per detected id, with the suggested variable binding). A token lives for an hour; using it twice answers 410.
- **Safety limits** (checked before anything is written): at most 50 MB in total, 25 MB per file, 500 files; allowed types `html css js json svg png jpg jpeg gif webp woff woff2 ttf otf mp4 webm` (others are skipped and listed); paths must be relative, without `..`, backslashes, hidden names or odd characters; symbolic links, encrypted zips, zip64 and archives whose files are bigger than they say are refused; two files that differ only in letter case are refused.
- `GET /api/graphics/:id/export` answers a `.fhgfx` file (`application/zip`): `manifest.json` (`{ schema: 1, app, graphic, files }` with the document without id, timestamps or secrets; a remote graphic loses its connector link and any `token/key/secret/password` in `target`) plus `files/...`. Importing a pack makes a new graphic with a new id.

### Files of HTML and CasparCG graphics

| Route | |
|---|---|
| `GET /api/graphics/:id/files` | `[{ path, bytes }]` |
| `GET /api/graphics/:id/file?path=index.html` | `{ path, content }` (text) or `{ path, contentBase64 }` (images, fonts, video) |
| `PUT /api/graphics/:id/file` | `{ path, content }` or `{ path, contentBase64 }`; answers the file list. The overlay reloads that graphic's frame. |
| `DELETE /api/graphics/:id/file?path=...` | answers the file list |

Files are served to the overlay at `/gfx/<id>/<path>` (loopback only, `Cache-Control: no-store`, correct content types, `Access-Control-Allow-Origin: *` so fonts load, path traversal refused). HTML pages get a Content-Security-Policy (`default-src 'none'`, scripts/styles/images/fonts/media from the same server, `connect-src` only `/gfx/` unless `allowNetwork`, `sandbox allow-scripts`), a default font stack with Arial/Helvetica aliases, and `<script src="/gfx/_runtime.js">` added before `</body>`.

### Connectors

A connector is a link to another system. `ConnectorView`: `{ id, name, kind, enabled, config, secretSet, status: { ok: boolean|null, message, at }, createdAt, updatedAt }`.

| Route | |
|---|---|
| `GET /api/graphics/connectors` | list |
| `POST /api/graphics/connectors` | `{ kind: "singular"\|"caspar"\|"http", name, config?, secret?, enabled? }` |
| `PUT /api/graphics/connectors/:id` | same fields, all optional. A missing or empty `secret` keeps the stored one; `clearSecret: true` removes it. |
| `DELETE /api/graphics/connectors/:id` | |
| `POST /api/graphics/connectors/:id/test` | `{ ok, message }`: a harmless call (see each kind) |
| `GET /api/graphics/connectors/:id/model` | Singular only: the sub-compositions and their control nodes `{ compositions: [{ id, name, state, fields: [{ id, type, title, defaultValue }] }] }` for the import wizard |

**`singular`** (Singular.live and UNO; docs: <https://developer.singular.live/rest-api>). `secret` = the control app token. `config`: `{ ratePerSecond: 0.2-50 (default 5), retries: 0-10 (default 5) }`. A graphic's `source.target` is `{ subCompositionName | subCompositionId, outState: "Out" | "Out1" | "Out2" }`; the graphic's **field names are the control node ids** and the resolved values are the payload. show = `PATCH https://app.singular.live/apiv2/controlapps/<token>/control` with `[{ subCompositionName, payload, state: "In" }]`; update = only the changed fields; hide = `[{ subCompositionName, state: "Out" }]`. Values are typed by field type (numbers, checkboxes); text starting with `{` or `[` that parses as JSON is sent as JSON (time control `{"command":"play"}`). Sends are queued, merged per sub-composition, spaced by `ratePerSecond`, and retried with backoff on network errors, 429 and 5xx; after the retries a plain notice is raised. Singular's free plan allows only about 25 calls a minute: lower `ratePerSecond` or avoid binding fast-changing values. Test = `GET .../control` (read only). Model = `GET .../model`.

**`caspar`** (a CasparCG server over AMCP, TCP 5250). No secret. `config`: `{ host, port, channel, layer, cgLayer, template, dataFormat: "xml"|"json", playOnLoad, hideMode: "stop"|"remove"|"clear" }`; a graphic's `target` may override `template channel layer cgLayer dataFormat`. show = `CG ch-layer ADD cg "template" 1 "data"`; update = `CG ... UPDATE cg "data"` (changed fields only); next = `CG ... NEXT cg`; hide = `STOP`, `REMOVE` or `CLEAR`. Replies are parsed by code (`202` done, `201` one data line, `200` many lines ended by an empty line, `4xx/5xx` errors with a plain message). If the connection drops, Fieldhouse reconnects with backoff and puts the graphics that were on air back. Test = `VERSION`. Remember: a CasparCG server draws on its own outputs. To see the graphic in OBS set `outputUrl`, or use a CasparCG template as a `caspar` graphic that runs inside Fieldhouse.

**`http`** (anything else). `config`: `{ show?, update?, hide?, next?, testUrl? }`, each action `{ method, url, headers?, body?, bodyFormat: "json"|"text" }`. Templates may use every variable, `{{field.<name>}}`, `{{target.<key>}}` and `{{secret}}` (URL parts are URL-encoded, JSON bodies JSON-escaped, header values lose line breaks). An action with no request is skipped. Test = a GET of `testUrl` only.

A `remote` graphic is driven when it goes on air, when its resolved field values change (checked on every state change and once a second while on air), and when it goes off air (auto-hide included).

### OBS layers

URL graphics and remote graphics with an `outputUrl` are not drawn in the overlay page. Fieldhouse hands them to the engine with the optional `Engine.setExternalLayers(layers)` (`{ id, url, width, height, z, visible, css? }[]`, the complete list each time). `ObsEngine` keeps a browser input `FH Ext <id>` in every FH scene (cameras and replay), turns the scene item on and off for show and hide (no reload), puts layers with `z < 0` under `FH Overlay` and `z >= 0` above it, re-creates them on every provisioning, removes the ones that are no longer wanted and never touches inputs without the `FH Ext ` prefix. `state.graphics.engineLayers` is true when the engine does this; otherwise (demo mode) the overlay page shows such pages in a frame instead. Page layout inside a layer (position, size) is the page's own business; use `css` for tweaks.

## Live state

`state.graphics` on `/ws` and `GET /api/state`:

```json
{ "scorebug": true, "lower": null, "slate": null, "sponsor": null,
  "engineLayers": true,
  "vars": { "home.score": 3, "clock": "07:56", "...": "..." },
  "items": [ { "id": "builtin-scorebug", "name": "Score bug", "kind": "builtin", "role": "scorebug", "builtin": "scorebug", "z": 20,
      "visible": true, "phase": "on", "seq": 1, "nextSeq": 0,
      "placement": {}, "animation": {}, "style": {}, "fields": {},
      "source": { "entry": "index.html", "src": "/gfx/gfx_1/index.html?v=...", "width": 1920, "height": 1080, "dataFormat": "xml" },
      "data": "<templateData>...</templateData>",
      "external": { "url": "https://...", "width": 1920, "height": 1080, "css": "" } } ] }
```

`phase` is `on`, `stopping` (just hidden but still drawn so a template can play its exit) or `off`. `seq` changes every time the graphic is put on air again, `nextSeq` every time `next` is called. `items` holds the enabled graphics sorted by `z` (remote graphics without an `outputUrl` are not drawn by anyone, so they are not in it). Phones only get the four original fields (producers also a short `items` list of id, name, role and visible).

## Where things are

| File | |
|---|---|
| `src/graphics/types.ts` | the contract |
| `src/graphics/index.ts` | `createGraphics()`: control, state, legacy mapping, remote sync |
| `src/graphics/docs.ts`, `builtins.ts` | validation, defaults, built-ins |
| `src/graphics/vars.ts` | variables and `{{...}}` |
| `src/graphics/onair.ts` | the on-air state machine (no timers of its own) |
| `src/graphics/files.ts`, `zip.ts`, `importer.ts`, `pack.ts`, `caspar.ts`, `examples.ts` | files, safe import, packs, Caspar analysis and data |
| `src/graphics/connectors/` | Singular, AMCP, HTTP |
| `src/graphics/runtime.js` | the script custom graphics get |
| `src/overlay.html` | the page OBS loads |
| `src/obs-layers.ts` | the OBS side of external layers |
| `scripts/obs-graphics-e2e.ts` | the real-OBS check |
