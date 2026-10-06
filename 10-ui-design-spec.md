# 10. UI Design Spec

Design only: no code, no mockups. This is the contract a builder (or a later comp/wireframe round) works from. Product truth lives in [`PRODUCT.md`](PRODUCT.md) and files 01–09; this file decides how the product looks, is organized, and behaves on screen.

Status: **draft for your confirmation**. Choices marked ▲ are mine and easy to change; items under "Open UI decisions" need an answer before building.

## 1. Brief

- **Mode:** Operate. The user is completing a task under time pressure. Scanability, consistency, and trust outrank expression.
- **Primary user:** a solo volunteer in a school gym, on a 1440×900 laptop (minimum supported window 1280×720), second operator on a phone. See PRODUCT.md.
- **The one job of the UI:** get a non-expert from "I have a gym and a laptop" to a verified, on-air, sponsor-ready broadcast, then keep them calm and correct for two hours.
- **Direction (pinned by you):** dark pro-broadcast. Interpreted below as a committed palette and one signature move, not a grey screen with one accent.
- **Anti-goals:** no vMix-style control-surface density; no gaming/neon dashboard; no decorative gradients, glass, or glow; no costume of a broadcast switcher (no fake bezels or rack-unit chrome); no color-only status; no hidden destructive actions.

### Design principles (ranked; resolve conflicts top-down)

1. **Never lose the broadcast.** Recording and stream state are visible on every screen where they matter; dangerous actions are guarded; every error has a next step.
2. **Game state is the spine.** The clock, score, and period are always at hand during a game and drive everything else.
3. **One obvious next action per screen.** A volunteer should never wonder what to do next.
4. **Big where it matters, small where it doesn't.** Cut, Replay, Fire, and score buttons are large; configuration is quiet.
5. **Plain words.** "Ready to go live", not "Pipeline initialized". Jargon only when the number matters (bitrate).

## 2. Visual system

### The scene (forces dark)
A volunteer, 6:40 pm, folding table at the baseline or press row, gym lights on, laptop brightness mid, glancing between the screen and the court every few seconds. Screen must not glare, tally states must read at arm's length and in peripheral vision, and nothing may flicker.

### Colour strategy: Committed, with state colors doing real jobs
The shell is a tinted ink ground (not neutral grey) so the app feels like one object; state colors are saturated and reserved.

| Role | Value ▲ | Use |
|------|---------|-----|
| Ground (app) | `#0B1018` ink-navy | Window background |
| Panel | `#121A26` | Panels, cards |
| Raised | `#1A2433` | Menus, hover, inputs focus |
| Hairline | `#263246` / strong `#35445C` | Borders |
| Text | `#EAF0F7` / secondary `#9FB0C5` / muted `#6B7D95` | |
| Action (primary) | `#3D8BFD` | Buttons, focus ring, selection |
| **On-air (program) red** | `#E5484D` | LIVE, program tally, End broadcast, errors. Never decorative |
| **Ready (preview) green** | `#2FB67C` | Preview tally, passed checks, healthy |
| **Scoreboard amber** | `#FFB224` | **Game numerals only** (clock, score, period, fouls) |
| Caution | `#FF8A3D` | Warnings, always with a ⚠ icon and text |
| Team colors | user-set | Score bug and team labels only; never app chrome |

Rules: red = on-air or failure; amber appears only as text in the game display face, never as a fill; caution always carries an icon; no state is ever communicated by color alone. ▲ Known risk: amber vs caution orange are neighbors; the icon + text rule and the face difference are what keep them distinct. Verify contrast (≥4.5:1 text, ≥3:1 large/UI) when tokens are built.

### Typography
- **UI:** the platform's system UI stack (Segoe UI on Windows, SF on macOS). Workhorse, offline-safe, no font download. Sizes: 11 label (caps, tracked), 13 dense body, 14 body, 16 subhead, 20 title, 28 screen title.
- **Game display:** a 7-segment/LED-style tabular face for the clock, score, period, and fouls ▲ (candidate: DSEG, an open-licensed 7-segment family; verify license before shipping). Sizes 56–96 on the console. Fallback: the system mono with tabular numerals.
- **Data:** system mono with tabular numerals for timecodes, bitrates, and log rows.
- Never use a decorative face. Never display UI text in the LED face.

### Shape, spacing, density
4px grid (4, 8, 12, 16, 24, 32). Radius 6 for controls, 10 for panels. Panels are separated by hairline borders, not shadows; shadows only on floating layers. Primary operator targets ≥ 48px tall (Cut, Fade, Replay, Fire, score buttons); secondary ≥ 32px. Density is medium: legible at arm's length, not dense like an engineering tool.

### Signature move: the Game Ribbon ▲
A single horizontal strip, a miniature scoreboard in the LED face, is the product's constant:
`WILDCATS 48 │ Q3 04:21 │ 44 LIONS`, with timeouts/fouls pips beneath and the team colors as thin end-caps.

- It sits in the top bar of every screen that belongs to a game (setup, preflight, console, replay, post-game, reports), so the product always shows which game it is about.
- On the console it expands into the full Game State panel; the numerals are the same objects, just larger.
- In Replay and Post-Game, the event timeline beneath is built from the same Ribbon: events appear as ticks on the game clock, color-coded by type.
- Outside a game (Home, Sponsors library, Settings) it is replaced by the app wordmark, so its presence means "game context".

Why this and not decoration: it is the thesis of the product (game state drives everything) made visible, it is a real functional component, and a competitor's switcher doesn't have one.

### Motion
150 ms ease-out for panels, menus, and toasts. The LIVE pill breathes slowly (2 s) and is the only ambient animation. Score changes flash the changed numeral once (200 ms, amber → white → amber). No page transitions. Honor reduced motion by removing the breathing and flash.

### Accessibility floor
Keyboard-complete operation of the console; visible 2px focus ring with offset; contrast per above; status = icon + text + color; targets per above; no information in tooltips only; readable at 1280×720 without horizontal scroll.

## 3. App structure

### Two shells
1. **Manage shell** (Home, Games, Sponsors, Library, Reports, Settings): left rail (icons + labels, 200px, collapsible to 64px) + slim top bar (search and a "Free and open source" chip that links to About). Calm, spacious.
2. **Game Night shell** (New Game wizard → Preflight → Live Console → Post-Game): no rail. A stepper in the top bar shows **Setup → Check → Live → Wrap-up**, and the Game Ribbon sits in the center. The step the user is on is always obvious. The rail returns only on exit.

### Navigation model
Home's primary button is **Start game night**, which opens the Game Night shell at the right step for the next scheduled game (or New Game). Everything else is secondary. The rail never competes with the live flow.

### Information architecture
```
Home ─ Start game night ─▶ [New Game → Roster → Sources → Preflight → LIVE → Post-Game]
Games  (schedule, past games, recordings)
Sponsors (library · rules · proof-of-play reports)
Library (venues & saved setups · rosters · graphics themes)
Settings (destinations · themes · sport profile · shortcuts · remote · storage · diagnostics · about and open source)
```

## 4. Shared components

- **Game Ribbon** (see above). States: pre-game (clock 00:00, "Tip-off 7:00 PM"), running, stopped (clock steady, pip "Stopped"), final.
- **Status pill:** dot + word. LIVE (red, breathing), READY (green), CHECK (caution + ⚠), OFFLINE (muted), REC (red dot + disk time remaining).
- **Health cluster** (top bar, Game Night shell): stream bitrate + dropped frames, destination connection, recording + disk remaining, CPU/GPU. Collapsed to 3 icons when healthy; expands on hover or when something degrades.
- **Source tile:** 16:9 thumbnail, label ("Center court"), hotkey number, audio meter, health dot, tally border (red program / green preview).
- **Monitor:** PREVIEW and PROGRAM views with a label chip and a 4px tally border.
- **Big action button:** 56–64px, label + shortcut chip. Variants: Cut (primary), Fade (secondary), Replay (secondary with icon), Fire (sponsor, primary), End broadcast (danger, hold-to-confirm 1.5 s).
- **Checklist row** (Preflight): status icon, check name, plain-language result, "Fix" button. Groups: Video, Audio, Network, Storage, Destination, Game.
- **Event chip/tick:** glyph by type (score, foul, timeout, turnover, mark), game clock time, team color dot.
- **Sponsor card:** logo, name, asset thumbnail, rule summary ("Every timeout, max 1 per 8 min"), usage ("9 of 12 airings left").
- **Table:** 40px rows, sortable headers, sticky header, row hover, inline row actions.
- **Toast:** bottom-left, 4 s, undo button for score and game-state changes.
- **Empty state:** one sentence, one primary action, optional sample-data link. Never an illustration.
- **Banner** (inline, top of content): info / caution / error with an action.
- **Modal:** only for destructive or irreversible choices.

## 5. Screens

For each: purpose, layout, key content, states, primary action. Sample content is basketball: *Westfield Wildcats vs Lincoln Lions, Main Gym*. Sponsors in samples are placeholders (Smith Dental, Harbor Pizza, Eastside Credit Union), clearly labeled demo data.

### 5.1 Onboarding (first run)
- **Purpose:** get to a first win in under 5 minutes; be honest that it is free and what stays on the laptop.
- **Layout:** centered single column, 3 steps with a progress bar: (1) Welcome and what you'll need (cameras, laptop, internet), (2) Detect and test your first camera, (3) Run a 60-second practice broadcast to a private test destination.
- **Cost and openness:** one plain panel: "Free and open source, for every school", no account, no trial, no card, with a View source button. Nothing counts down or sells.
- **States:** no camera detected → help panel with the three most common fixes and a "skip, use test pattern" path.
- **Primary action:** Next / Start practice.

### 5.2 Home / Schedule (Manage shell)
- **Layout:** top: "Next game" hero card (teams, tip-off time, venue, setup readiness: Roster ✓ Sources ✓ Preflight ○) with the big **Start game night** button. Below: two columns: Upcoming games list (table) and Recent games (with recording and highlight status). Right slim column: season summary (games streamed, hours, sponsor airings), storage left.
- **States:** empty (first run) shows "Create your first game" with a sample game option; a game in progress shows a pinned "Resume live game" bar (recovery path); storage low banner.
- **Primary action:** Start game night.

### 5.3 New Game (Game Night shell, step 1)
- **Layout:** two-column form: left Teams (home/away, name, abbreviation, colors, logo upload), right Details (date/time, venue picker, sport profile "Basketball", period length, destinations with toggles: YouTube, Facebook, Custom RTMP/SRT, Record only). A live Game Ribbon preview updates as the user types.
- **Behavior:** clones the last game with the same venue; destination connection tested inline (green check or message).
- **Primary action:** Continue to Rosters.

### 5.4 Roster Import
- **Layout:** two tabs (Home, Away). Left: CSV drop zone (+ "Paste from spreadsheet" and "Add manually"). After drop, a column-mapping strip (Number, Name, Position) with auto-detected headers, and a preview table. Right: roster table, editable inline, with a "Starters" toggle per player.
- **States:** parse errors highlight rows with fix suggestions; duplicate numbers flagged; large roster scrolls; skipping allowed ("Use numbers only").
- **Primary action:** Continue to Sources.

### 5.5 Venue & Sources
- **Layout:** left: detected devices list (cameras, capture cards, NDI/SRT sources, microphones) with "Add network source" button. Center: source slots 1–4 as large tiles with live thumbnails; drag a device onto a slot, rename ("Center court"), set audio. Right: Venue setup panel: "Main Gym" saved setup, with Save / Save as.
- **States:** device unplugged shows grey tile with "Reconnect"; unsupported format shows plain explanation; only one source is fine (valid).
- **Primary action:** Run checks.

### 5.6 Preflight Check
- **Purpose:** the gate to going live; the screen that prevents Friday-night failures.
- **Layout:** left (60%): grouped checklist (Video: all sources live, frame rate steady; Audio: levels present, no clipping; Network: upload speed vs. bitrate; Storage: recording space for 3 h; Destination: stream key valid; Game: roster, clock set). Right (40%): a large summary card, "Ready to go live" (green) or "2 things to fix" (caution), a live program monitor, and **Test stream privately** (P1).
- **States:** running (rows resolve one by one), pass, warn (can proceed with acknowledgment), fail (blocks Go Live, with Fix), re-run.
- **Primary action:** **Go live** (disabled with explanation until blockers are cleared; opens the Live Console).

### 5.7 Live Production Console (anchor screen)
Layout at 1440×900 (grid of three zones):

| Zone | Width | Content |
|------|-------|---------|
| **Left, stage (≈ 66%)** | | Two equal 16:9 monitors **Preview** (green) and **Program** (red, score bug visible). Beneath: source strip (up to 4 tiles). Beneath: transition row: **Cut** (Enter), **Fade** (Shift+Enter), duration select, **Replay last 10s** (R), slow-mo toggle. Beneath: audio mixer (Commentary, Crowd, Program) with segmented meters, mute, gain. |
| **Right, game (≈ 34%)** | | **Game State** panel (clock in LED face with start/stop and ±1 s nudge, period selector Q1–Q4/OT, home and away scores huge, +1 +2 +3 buttons per team, fouls with bonus, timeouts, possession arrow, "Phone remote connected" chip). **Events** panel (latest first, each with Replay and a "Mark moment" button). **Next sponsor break** card (name, length, trigger, Fire / Skip / Delay; last 3 aired). |
| **Top bar** | full | Wordmark, stepper (Live highlighted), Game Ribbon, Health cluster, **LIVE pill + elapsed**, **End broadcast** (hold to confirm). |

Behavior:
- Selecting a source (1–4 or click) sets Preview; Cut sends Preview to Program and swaps. Tally borders follow.
- Clock events and score changes create timestamped events automatically, appear in the Events list, and update the score bug within ~100 ms.
- A timeout starting auto-surfaces the sponsor card with a 10 s countdown to Fire (operator can cancel); nothing airs without the operator pressing Fire unless they enable auto-fire in Settings.
- Undo for the last 5 game-state changes (Ctrl+Z) with a toast.
- At 1280×720: the audio mixer collapses to a vertical strip beside the source strip; Events panel becomes a tab beside Sponsor.

States: pre-roll (not yet live, "Start broadcast"), live, source dropped (tile turns caution with "Reconnecting…", Program shows a slate if it was program), stream reconnecting (health cluster expands, banner), low disk (banner with time remaining), recording only. Keyboard map ▲: Enter Cut, Shift+Enter Fade, 1–4 Preview, C clock, R replay, Shift+R replay last score, M mark, F fire sponsor, Q/W/E home +1/+2/+3, I/O/P away +1/+2/+3, Ctrl+Z undo. Shown in a "?" overlay.

### 5.8 Phone Remote (second operator, 390 px wide)
- **Purpose:** a scorekeeper drives the game state from a phone browser on the gym Wi-Fi.
- **Layout (portrait, thumb zone):** top: Game Ribbon (compact) and connection dot. Center: huge Start/Stop clock button, then two score blocks side by side with +1 +2 +3 (min 56 px). Bottom sheet tabs: Fouls & timeouts, Period, Undo log. No video.
- **Connect:** shows a QR code and short code on the console; phone enters by scanning. Pairing shown as a chip on the console.
- **States:** disconnected (full-width banner, buttons disabled, auto-retry), two operators editing (last write wins, with a "Console changed score" toast), wrong game, locked by console.
- **Primary action:** the clock button.

### 5.9 Replay & Events
- **Purpose:** find and replay moments; it's a drawer on the console and a full screen in Post-Game.
- **Layout:** a horizontal event timeline (the Ribbon grammar): game clock axis, ticks by event type, team-color dots, scrubber. Below: clip detail (angle picker if multi-angle later, in/out handles with ±1 s steps, speed 1×/0.5×/0.25×), **Play to program** (console only) and **Save to highlights**.
- **States:** no events yet (empty with "Marks appear here as the game is played"), buffer unavailable (error with cause), clip too short.
- **Primary action:** Play to program / Save clip.

### 5.10 Sponsor Library (Manage shell)
- **Layout:** left: sponsor list as cards with usage bars. Right: detail for the selected sponsor: name, logo, assets (image, 15 s video, audio read), display length, **Rules** editor in plain language ("Air at: [Timeouts ▾] [Halftime ▾]; no more than once every [8] minutes; max [12] airings this season"), season usage. A **Break planner** strip at the top simulates "Q1 → Q4 + halftime" with proposed slots.
- **States:** empty (add your first sponsor), rule conflict (two sponsors want the same slot) resolved with priority order, expired asset.
- **Primary action:** Add sponsor / Save rules.

### 5.11 Proof-of-Play Report
- **Layout:** filter bar (Sponsor, Season/Game, date range) → summary cards (airings, total seconds, games) → table (game, time, sponsor, asset, length, outcome: aired/skipped/delayed) → export (CSV, PDF). A print-style preview of the PDF sits in a side drawer.
- **Honesty rule:** no invented audience numbers. Viewer counts appear only if entered manually, labeled as such.
- **States:** empty, a filter with no results, export in progress.
- **Primary action:** Export report.

### 5.12 Post-Game & Highlights
- **Layout:** Game Ribbon in "Final" state; left: recording player with the Events timeline beneath; right: Highlights builder: auto-selected clips (every score + pre/post roll) as a reorderable list with checkboxes and durations, total length, title card options. Footer: file locations and **Export highlights**.
- **Sections:** Files (program recording + per-source if enabled, open folder), Events export (CSV/JSON), Proof-of-play summary (link to report).
- **States:** recording still finalizing (remux progress), no events marked, export failed (retry).
- **Primary action:** Export highlights.

### 5.13 Recovery States (designed on purpose)
Treated as a family of full-state designs, not one-off errors:
- **Restored after crash:** full-width banner on relaunch ("We restored your game: Q3 04:21, 48–44. Recording resumed."), a "Check clock" action that opens the clock editor.
- **Source dropped:** tile + program slate "Technical difficulties; we'll be right back" (team-color-themed, editable text), auto-switch back on reconnect with a 5 s confirmation toast.
- **Stream disconnected:** health cluster expands, banner "Reconnecting to YouTube… recording is safe", attempt count, "Switch to backup destination".
- **Disk nearly full:** banner with minutes remaining and "Free up space" (opens a list of old recordings with sizes).
- **Diagnostics offer:** "Something went wrong" modal always includes **Export diagnostics**.

### 5.14 Settings & Diagnostics
- **Layout:** two-pane: section list (Destinations, Graphics themes, Sport profile, Keyboard shortcuts, Remote, Storage, Diagnostics, About and open source) + content. Each section is its own frame on the board (14, 14b to 14h).
- **Destinations:** connect/test per platform; stream keys masked, Reveal on demand.
- **Graphics themes:** preview the score bug and lower thirds with team colors; pick from 3–4 built-in themes (no theme editor in v1).
- **Diagnostics:** system summary, last game's health graph, **Export diagnostics bundle**, version/update channel.
- **Primary action:** Save (explicit, with unsaved-changes guard).

## 6. Cross-cutting rules

- **Guards:** End broadcast = hold 1.5 s. Delete recording = type-the-game-name. Closing the app during a live game = confirm modal naming what will stop.
- **Undo:** all game-state edits reversible for the session; log visible in Events.
- **Loading:** skeleton rows for lists; spinners only inside buttons; never block the console.
- **Errors:** what happened + what to do + one button. Never raw error codes in the main message (codes in a "Details" disclosure).
- **Text:** sentence case; verbs on buttons ("Go live", "Fire sponsor"); time in the user's locale; clocks always mm:ss.
- **Resizing:** supported 1280×720 → 1920×1080. Console is the only screen with a responsive layout change at 1280; Manage screens scale by columns.
- **Dark only for v1.** A light theme is a post-v1 option if schools ask (the gym scene is the reason).
- **Localization:** English only in v1; strings centralized so Spanish is feasible later.

## 7. Anti-patterns to enforce in review

Side-stripe borders on cards; gradient text; glow shadows; identical card grids; decorative icons without a label; modal as first thought; amber used as a fill; red used decoratively; any control that looks like hardware but is not (knobs, bezels, faders drawn skeuomorphically).

## 8. Open UI decisions (need your call)

| ID | Question | My recommendation |
|----|----------|-------------------|
| U-1 | Is the **Game Ribbon with an LED-style face** the signature move you want, or should the identity be quieter (system mono numerals)? | Keep the LED face; it's the product's one memorable, functional flourish |
| U-2 | Confirm the **committed ink-navy palette** and amber game numerals instead of a neutral grey ground | Yes, as specified |
| U-3 | Should sponsor breaks ever **auto-fire** (default off) or stay operator-triggered only in v1? | Operator-triggered only for v1; auto-fire as a later setting |
| U-4 | **Light theme** later, or never? | Defer; revisit after pilots |
| U-5 | The keyboard map in 5.7: acceptable? | Test with a real volunteer before locking |
| U-6 | Console at 1280×720: collapse the mixer (as written) or hide Events? | Collapse the mixer |

## 9. Next steps (no code until you approve)

1. You confirm or correct this spec and U-1…U-6.
2. Optional: a wireframe/comps round for the three hardest screens (Live Console, Preflight, Sponsor Library) so the layout can be judged visually before any build.
3. Then write `DESIGN.md` (tokens) and start Phase 0 spikes from [08](08-validation-plan.md); UI build begins at Phase 1 per [04](04-scope-and-roadmap.md).
