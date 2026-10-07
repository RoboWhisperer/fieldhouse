# Automation, custom data and integrations: API reference

Everything here is under `/api` on the console address (`http://localhost:8080`). Bodies are JSON (`content-type: application/json`). Errors are `{"error": "plain sentence"}` with status 400 (bad input), 404, 409 or 429. Code lives in `src/automation/`. For a gentler introduction read the [automation guide](../automation-guide.md); for looks and layouts see [customization](customization.md).

## Concepts

- **Facts** are the flat values rules and templates read: `period`, `clock` (ms), `clockSec`, `clockText`, `running`, `diff` (home minus away), `lead`, `home.score`, `away.abbr`, `home.fouls`, `home.timeouts`, `home.bonus`, `counter.<name>.home`, `before.*` (the game just before the event), `event.*` (`event.type`, `team`, `points`, `player`, `note`, `seq`), `custom.<key>`, `engine.live|recording|reconnecting|replaying|program|preview|cpu|kbps|event`, `source.id|label`, `trigger.name`, `trigger.data.<field>`, `game.id`. `GET /api/automation/facts` shows the current values. Facts are captured when a rule fires; a later step after a wait still sees the old values.
- **Templates** are `{{name}}` or `{{name|filter}}` (filters: `upper`, `lower`, `json`, `url`). Unknown names become empty text (dry-run warns). In web addresses every value is URL-encoded automatically. In header values line breaks are removed.
- **Conditions** use a tiny expression language written from scratch (no `eval`): numbers, `'text'`, `true/false`, fact names, `== != < <= > >= contains`, `+ - * / %`, `and or not` (also `&& || !`), brackets. Limits: 300 characters, 120 nodes. An unknown fact counts as empty (comparisons are false, `!=` is true).
- **Safety**: errors stay inside the run that caused them; at most 4 levels of automation starting automation; at most 20 runs per second (then automation pauses 5 s with a notice); at most 5 runs of one rule or macro waiting; `Cancel all` stops everything; a run log of the last 500 runs.

## Custom fields

| Route | Does |
|---|---|
| `GET /api/custom` | `{fields:[{key,label,type,default,value,effective}], values:{key:effective}}` |
| `PUT /api/custom` | `{values:{key:"text"}, fields:{key:{label?,type?,default?,value?}}}`. All-or-nothing. Returns the same as GET. |
| `PUT /api/custom/:key` | `{value?,label?,type?,default?}` for one field |
| `DELETE /api/custom/:key` | remove |

Keys: letters, digits, underscore, start with a letter, up to 40. Values: up to 500 characters, no control characters or line breaks. At most 100 fields. Types: `text`, `number`, `color` (`#rgb`/`#rrggbb`), `image` (https address, file name or path; never `javascript:`), `bool` (`true`/`false`). An empty value falls back to `default`. `state().custom` is the `key -> effective value` map and arrives on the WebSocket. A change emits `custom.changed` and re-checks state rules.

## Rules

A rule: `{id, name, enabled, priority (1 runs first, default 50), trigger, when?, cooldownSec, once?: "game"|"period", actions[], note?}`.

Triggers (`GET /api/automation/catalog` describes them for editors):

```json
{"type":"event","event":"score","team":"home","points":[3]}          // game.start game.end clock.start clock.stop clock.set period.set score foul timeout counter mark undo; period filter for period.set
{"type":"state","when":"clock <= 60000 and period == 4"}               // fires when it turns true
{"type":"clock","atSec":120,"period":4}                                 // crossing; once per period; period optional
{"type":"timer","everySec":60}                                          // while a game is active
{"type":"after","ruleId":"rule_ab12","afterSec":10}                     // N s after another rule ran
{"type":"engine","event":"stream.live","sourceId":"cam1"}              // stream.live stream.reconnecting stream.stopped record.started record.stopped source.dropped source.back replay.finished
{"type":"sponsor","sponsorId":"sp_1"}                                   // a sponsor was fired (any outcome)
{"type":"manual","name":"Goal horn"}                                    // POST /api/automation/trigger, case-insensitive
```

Actions (each may also carry `label` and `continueOnError: true`; by default a failed step ends the run):

```json
{"type":"graphic","op":"show|hide|toggle|update|next|clear","id":"lower-third","fields":{"title":"{{home.abbr}}"}}
{"type":"custom.set","key":"sponsorLine","value":"Thanks {{custom.homeCoach}}"}   {"type":"custom.clear","key":"x"}
{"type":"engine","op":"preview","sourceId":"cam2"}  {"op":"cut"}  {"op":"fade","ms":500}  {"op":"replay","secondsBack":10,"speed":1}  {"op":"replay.stop"}  {"op":"mute","id":"mic","muted":true}
{"type":"sponsor.fire","sponsorId":"sp_1","outcome":"aired"}
{"type":"event","event":{"type":"mark","note":"Great play"}}                      // same validation as POST /api/event
{"type":"http","method":"POST","url":"https://host/path/{{home.abbr}}","headers":{"Authorization":"Bearer x"},"body":"{\"s\":{{home.score}}}"}
{"type":"wait","seconds":5}      {"type":"notice","level":"info|warn","message":"..."}      {"type":"log","level":"INFO|WARN|ERROR","message":"..."}      {"type":"macro","macroId":"macro_x"}
```

Web requests: http/https only, no user name/password in the address, 5 second timeout, redirects are **not** followed, any non-2xx answer is a failed step. The run log records `POST host/path answered 200`, never the query, headers or body. Header values are write-only: lists show `"[hidden]"`; sending `"[hidden]"` back keeps the stored value, sending a new value replaces it.

| Route | Does |
|---|---|
| `GET /api/automation/rules`, `GET /api/automation/rules/:id` | rules (with `summary` sentence, headers hidden) |
| `POST /api/automation/rules`, `PUT /api/automation/rules/:id` | create / update (PUT accepts partial bodies) |
| `DELETE /api/automation/rules/:id` | delete |
| `POST /api/automation/rules/:id/test` | **dry run**: `{facts?, event?}` sample -> `{name, trigger, triggerMatches, condition, wouldRun, steps:[{type,text,depth?}], warnings}`. Calls nothing, writes nothing, uses up no cooldown. |
| `POST /api/automation/rules/:id/run` | run the actions now, ignoring trigger, condition and cooldown. Returns the run entry (waits up to 2 s). |
| `POST /api/automation/test` | dry-run an unsaved `{rule}` or `{macro}` (+ `sample`) |
| `POST /api/automation/trigger` | `{name, data?}` wakes manual rules named `name`. Returns `{woke:n}`. Also emits `trigger.<name>`. |
| `POST /api/automation/cancel` | cancel running and waiting runs and timers: `{cancelled:n}` |
| `POST /api/automation/pause` | `{paused:true|false}`: ignore automatic triggers (macro buttons and manual runs still work). Saved. |
| `GET /api/automation/status` | `{paused, running, pausedUntil, rules, limits}` |
| `GET /api/automation/log?n=100` | newest first: `{id, at, kind:"rule"|"macro", ref, name, trigger, matched, status:"queued|running|ok|error|skipped|cancelled", reason?, ms?, steps:[{type,text,ok,error?,depth?}]}`. Entries with `matched:false` say why a trigger that fired did nothing (condition false, cooling down, once). Also mirrored (redacted) to diagnostics. |
| `GET /api/automation/catalog` | triggers, actions, parameters, limits, icons, panels, fact groups, webhook event names |
| `GET /api/automation/facts` | current facts |

Runs of one rule/macro execute one after another. Rules woken by the same trigger start in priority order.

## Macros

`{id, label, color "#rrggbb", icon, hotkey?, description?, actions[]}`. Icons: `play stop replay flag bolt bell star tv mic ball sponsor link clock eye check gear`. Hotkey syntax is the console's `keys()` syntax: optional `Ctrl+` then `Shift+` then one key (`F`, `Shift+F`, `Ctrl+1`, `F5`, `Enter`); letters are stored upper case; Alt is not supported. A key already used by a built-in shortcut or another macro is refused with 409.

`GET /api/macros`, `GET|PUT|DELETE /api/macros/:id`, `POST /api/macros`, `POST /api/macros/:id/run` (`{data?}` available as `trigger.data.*`; returns the run entry), `POST /api/macros/:id/test` (dry run). Which macros show as big buttons is `settings.ui.macroButtons` (see customization).

## Webhooks (outbound)

`{id,name,url,events:["game.*","engine.stream.live"],enabled,secretSet}`; `secret` is write-only (8-200 chars; `""` removes). At most 20.

`GET|POST /api/webhooks`, `PUT|DELETE /api/webhooks/:id`, `POST /api/webhooks/:id/test` (one `test.ping`, one try: `{ok,code,message}`), `GET /api/webhooks/deliveries?n=50` (`{id,webhookId,name,event,at,attempts,status:"ok|retrying|failed",code?,message}`).

Event names: `game.<type>` (`game.score`, `game.foul`, `game.timeout`, `game.period.set`, `game.clock.start`, `game.mark`, `game.undo`, `game.start`, `game.end`), `engine.<event>` (see engine triggers), `sponsor.fired`, `custom.changed`, `trigger.<name>` (lower-case, dashes). Filters: `*`, `game.*`, or an exact name.

Delivery: `POST` with JSON `{id, version:1, event, at, data}` (`data` for game events is `{event, game}` with the game view). Headers `X-Fieldhouse-Event`, `X-Fieldhouse-Delivery`; with a secret also `X-Fieldhouse-Timestamp` and `X-Fieldhouse-Signature: sha256=<hex>` where hex = HMAC-SHA256(secret, `"<timestamp>.<raw body>"`). 5 s timeout, no redirects. Retries after 1 s, 5 s and 30 s for network errors, 5xx, 408 and 429 (not for other 4xx). Order is kept per webhook; more than 100 waiting drops new events with a log line.

## Event stream (read-only)

`GET /api/stream?events=game.*,custom.*` is Server-Sent Events: `id`, `event: <name>`, `data: {"at":ms,"data":...}`; a comment heartbeat every 5 s. Allowed for the console (loopback) and for **API keys** only (not for paired phones). At most about 10 open streams.

## API keys for outside tools

Mint on the console only (loopback): `POST /api/remote/keys {name, role?: "controller"|"producer"}` -> `{key:"fhk_...", device, note}`. **The key is shown once**; only its SHA-256 is stored. `GET /api/remote/keys` lists them (no secrets). Revoke: `DELETE /api/remote/devices/:id` (effective at once). At most 20 keys; they do not use up the 20 phone slots.

Use `Authorization: Bearer fhk_...` (or send it as the `fh_device` cookie). Remote access must be on (Settings > Remote) and the caller on the same network when "locked to LAN" is set. A tool on the same computer needs no key (loopback is the console). Wrong keys are rate limited (20 per 5 minutes per address, then 429).

Role `controller` may call: `GET /api/state`, `POST /api/event`, `POST /api/engine/preview|cut|fade`, `POST /api/replay`, `POST /api/replay/stop`, `POST /api/graphics`, `POST /api/graphics/clear` and `POST /api/graphics/:id/show|hide|toggle|update|next`, `POST /api/sponsors/fire`, `GET /api/macros`, `POST /api/macros/:id/run`, `POST /api/automation/trigger`, `GET|PUT /api/custom` (PUT: `values` only), `GET /api/stream`. Role `producer` additionally mixer, snapshots and (if allowed in settings) broadcast start/stop. Everything else answers 403 (settings, destinations, files, recordings, rules, webhooks, workspace, keys). 20 requests/second per key. Other modules open more routes with `allowRemote({roles, method, re})` from `src/auth.ts` while `createApp` runs.

Companion example: a generic HTTP action `POST http://<console-ip>:8081/api/macros/<id>/run` with header `Authorization: Bearer fhk_...`; no body is needed.

## Workspace export / import

`GET /api/workspace/export[?sections=rules,macros]` -> a JSON download:

```json
{"format":"fieldhouse-workspace","version":1,"app":"Fieldhouse","exportedAt":"...","sections":{"rules":[...],"macros":[...],"customFields":[...],"webhooks":[...],"looks":{...},"layouts":{...},"graphics":{...},"profiles":[...]}}
```

`POST /api/workspace/import` `{workspace, mode:"merge"|"replace", dryRun?:true, sections?:["rules"]}` -> `{ok, dryRun, mode, applied, sections:[{name, status:"would import|imported|unknown section|not selected|error", plan?:{add,update,remove,note?}, message?}]}`. Every section is validated first; if any is invalid nothing is applied. `merge` adds and updates by id (webhooks by name); `replace` also removes what the file lacks. `GET /api/workspace/sections` lists section names.

Secrets are never exported (stream keys, tokens, passwords, API keys, webhook secrets, pairing codes, header values; web addresses lose their query string) and a file containing a key that looks like a secret is refused. After an import, re-enter header values and webhook secrets by hand.

Other modules add sections while `createApp` runs: `registerWorkspaceSection(name, {export(), import(data, mode), plan?(data, mode)})` from `src/automation/workspace.ts`. `createApp` registers two (code: `src/graphics/workspace.ts`):

- `graphics`: `{graphics:[{id, graphic, files:[{path, base64}]}], connectors:[{id, name, kind, enabled, config}]}`. User graphics and edited built-ins (ids `builtin-*`) with their files; connectors without their token, with secret-looking query parameters and `Authorization`/key header values blanked. Same id updates in place (so rules that point at a graphic keep working); an id that is invalid or repeated in the file gets a fresh one. An existing connector keeps its token on import, a new one needs it typed in. `replace` also removes graphics and connectors the file lacks and resets edited built-ins.
- `profiles`: `[ProfileDoc]`, your own sport profiles and edited built-ins, same-id update, fresh id when invalid or repeated. `replace` refuses to remove the default sport. Games keep their own frozen copy, so nothing that has started changes.

Both validate the whole section (graphic documents, file paths and types, base64, connector settings, profile rules) in the dry-run step, so an invalid file changes nothing.

## Display settings

`GET /api/ui` -> `{ui, theme, themes, common, attrs, customCss}` (see [customization](customization.md)); `PUT /api/ui` (partial `ui` patch); `POST /api/ui/check-css {css}` -> `{ok, message?}`; `POST /api/ui/layouts {name, from?}`, `PUT /api/ui/layouts/:id {name?, columns?, hidden?}`, `DELETE /api/ui/layouts/:id`, `POST /api/ui/layouts/:id/reset`, `POST /api/ui/layouts/:id/activate`. The same data is `settings.ui` in `GET/PUT /api/settings`.
