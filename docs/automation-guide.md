# Automation guide: rules, macros and custom fields

This guide is for the person running the broadcast. You do not need to be a programmer. Automation is optional: Fieldhouse works fully by hand.

## The three ideas

- **A custom field** is a piece of text you can change, such as "Sponsor line" or "Home coach". Graphics and rules can use it, so you type it once.
- **A macro** is a button that does several things in order: show a graphic, wait, hide it, fire a sponsor. You can give it a color, an icon and a keyboard key.
- **A rule** is "when this happens, do that". The "when" can be a score, a timeout, the clock reaching a time, the stream going live, a camera dropping, or a button press. A rule can also check a condition and wait between uses.

## Safe to try

Every rule and macro has a **Test** button (a dry run). It tells you in words what would happen right now and changes nothing: nothing is shown, sent or saved. After a rule runs for real, **Automation > Run log** lists what it did, step by step, and why it did nothing when a condition was not met.

Safety nets: automation pauses for a few seconds if rules start triggering each other in a loop, **Cancel all** stops everything that is running or waiting, and **Pause automation** ignores all automatic triggers (macro buttons still work). Fieldhouse never follows web redirects and gives up on a web request after 5 seconds.

Text in curly brackets, like `{{home.score}}`, is filled in when the rule runs. The most useful values: `{{home.abbr}}`, `{{home.score}}`, `{{away.score}}`, `{{lead}}`, `{{period}}`, `{{clockText}}`, `{{event.points}}`, `{{event.team}}` and your own fields as `{{custom.sponsorLine}}`.

> **Unverified:** the rules engine is tested with simulated games and stand-in video and graphics. It has not yet been run through a full live game with real OBS, real graphics or a real Companion/Stream Deck.

## Eight worked examples

### 1. Show a lower third when a player scores 3

Trigger: **A game event happens**, event `score`, points `3`. Action: **Graphics**, show `lower-third` with title `{{home.abbr}} hits a three!`. Add a second step **Wait 6 seconds** and a third **Graphics hide**. Add the condition `event.team == 'home'` to limit it to the home team.

### 2. Ticker text from a custom field

Make a custom field `tickerText`. In your ticker graphic use `{{custom.tickerText}}`. Change the text any time in the Custom fields panel. To change it automatically: rule on a timeout with action **Set a custom field** `tickerText` = `Timeout {{event.team}}. Score {{home.score}} to {{away.score}}`.

### 3. Webhook to Companion on timeout

Settings > Remote > API keys: make a key named "Companion" (copy it now; it is shown once). In Companion use a generic HTTP action on a timeout button. In the other direction, Automation > Webhooks: add `https://your-companion/...` for event `game.timeout`. For a signed webhook add a secret; Companion or your script can verify the `X-Fieldhouse-Signature` header.

### 4. Replay when the home team scores in the last minute

Trigger: event `score`, team `home`. Condition: `clock <= 60000 and period == 4`. Actions: **Wait 2 seconds**, **Video > Replay** (last 10 seconds). Set "wait at least 20 seconds" between runs so a quick double score does not replay twice.

### 5. Fire a sponsor at every timeout

Trigger: event `timeout`. Action: **Fire a sponsor** (leave the sponsor empty to use the one that is due). Fieldhouse still follows your sponsor rules, so a sponsor that is not due is not forced.

### 6. One-minute warning, once per period

Trigger: **The game clock reaches a time**, 60 seconds. Action: **Show a notice** "One minute left in {{periodLabel}}" and show the `one-minute` graphic. It fires once per period.

### 7. A camera dropped

Trigger: **Something happens to the video**, `source.dropped`. Actions: **Show a notice** `{{source.label}} dropped`, **Video > preview** `cam1` so you can switch to a good camera. Add a second rule on `source.back` to say it returned.

### 8. A big "Goal horn" button with a key

Create a macro "Goal horn": **Set a custom field** `horn` = `on`, wait 3 seconds, **set** `horn` = `off`. Choose color red, icon `bell`, key `Shift+H`. Add it to the macro buttons so it appears as a large button. From Companion or a Stream Deck call `POST /api/macros/<id>/run` with your API key.

## Where to click

- **Automation** in the left menu has six tabs: Rules, Macros, Custom fields, Webhooks, Integrations, Run log. **Pause automation** and **Cancel all running** are at the top of every tab.
- **Rules > New rule** or **Start from an example** (the examples above are in the list). Fill in "When this happens", optionally "Only if", then "Do this". **Test this rule** (dry run) is near the bottom; **Save rule** is in the bar at the bottom.
- **Macros**: make the button, then switch on **Show on the console** (or use Settings > Appearance and layout > Macro buttons).
- **Custom fields**: change a value any time, even live; **Settings** on a row edits its label, kind and default.
- **Integrations**: **Make a key**, copy it at once (shown once), then follow the Companion and Stream Deck steps on the same page.
- **Settings > Appearance and layout**: theme, accent, spacing, text size, motion, console layouts (move cards with the arrow buttons), macro buttons, custom CSS, and Workspace export and import (Check what would change first, then Apply import).

## Moving your setup

Settings > Appearance and layout > Workspace > Download workspace file saves your rules, macros, custom fields, webhooks, looks and layouts (and graphics and sport profiles) as one file. Import shows what would change first (a dry run) and can merge with or replace what is there. Graphics (with their files) and your sport profiles travel too, and Singular/CasparCG connectors come without their tokens. Secrets are never exported: stream keys, passwords, API keys, webhook secrets and header values stay on the computer, so enter them again after importing.

## When something does not run

1. Open **Run log** and find the rule. "The condition ... was not true" means it woke up but your condition held it back. "Cooling down" or "Already ran once" are your own settings.
2. Press **Test** with a sample event to see the condition result and any warnings such as an unknown `{{variable}}` or a graphic that does not exist.
3. A red step shows a plain reason, for example "POST example.com/hook answered 503".

For developers: [API reference](dev/automation-api.md) and [customization](dev/customization.md).
