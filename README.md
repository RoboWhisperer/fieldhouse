# Fieldhouse

Fieldhouse is a free, open-source broadcast app for school sports. It turns a laptop, one to four cameras and OBS Studio into a live stream and recording with a score bug, replay and sponsor messages, run by one volunteer.

**Who it is for:** teachers, athletic directors, booster-club parents and student crews who stream home games without a TV crew, starting with high school basketball.

**Status: beta (1.0.0-beta.1, unreleased).** Verified so far, on one Linux machine with OBS Studio 32.2.2 (Flatpak): a scripted game night and a click-through of the packaged Linux desktop app, covering connecting to and setting up real OBS, switching, recording, streaming to a local test server, instant replay, sponsors, highlights and crash recovery. **Not verified:** Windows and macOS, code signing, automatic updates, native (non-Flatpak) Linux OBS, real USB cameras, real YouTube or Facebook streaming, physical phones, Safari and iOS. No public installers exist yet.

## Features

Built:
- Guided flow: Home, Start game night, Setup, Check, Live, Wrap-up
- Game clock, score, fouls, timeouts and period, with undo
- Score bug, lower thirds and slate as an overlay (browser source)
- Preflight check before going live
- Crash recovery: score and clock return after a restart
- Sponsor library with rules, break planning and a proof-of-play CSV report
- Marked moments and highlight export (needs `ffmpeg`)
- Diagnostics bundle export
- Basketball profile (periods, length, bonus, timeouts)
- Real OBS control (scenes, overlay, switching, recording, streaming, replay), plus a built-in demo engine for practice that records a test pattern

Built, but verified less:
- Phone remote for a scorekeeper (pairing code, QR code), checked with automated tests and real network connections, not on a physical phone
- Update check against the GitHub Releases page (only the "no release found" case was seen)
- Data retention setting, daily database backups, rotating logs
- Desktop app (Electron with a bundled Bun program): Linux AppImage and .deb built and run; Windows and macOS builds exist only as untested build recipes

Planned:
- Signed Windows and macOS installers and automatic updates
- Other sports (football, volleyball)
- Sign-in with YouTube or Facebook is not planned for v1: you paste a stream key

## Requirements

[OBS Studio](https://obsproject.com) (version 28 or later; tested with 32.2.2) does the video mixing and streaming. It is free and must be installed separately. Practice mode (`bun run demo`) works without it.

## Install and run

Installers are not released yet. The desktop app uses OBS by default. To try it from source you need [Bun](https://bun.sh) (and `ffmpeg` for test recordings):

```bash
bun run demo     # http://127.0.0.1:8080 with sample data
```

## Documentation

- [User guide](docs/README.md): [Getting started](docs/getting-started.md), [Game night checklist](docs/game-night-checklist.md), [Troubleshooting](docs/troubleshooting.md), [Privacy](docs/privacy.md), [FAQ](docs/faq.md)
- Project planning: see below.

## Known limitations

- Only verified on Linux with Flatpak OBS 32.2.2. Windows and macOS builds, installers and file locations have never been run; code signing and notarization are not done.
- Not verified: native (non-Flatpak) Linux OBS, real USB cameras and capture cards, real YouTube or Facebook streaming (tested against a local RTMP server only), physical phones, Safari and iOS.
- Automatic updates are not verified against a real feed; the update check has only seen the "no release" answer.
- No OAuth sign-in: you paste a stream address and key.
- Flatpak OBS cannot see system folders, so recording folders must be inside your home folder.
- Basketball only.

## Free and open source

Fieldhouse has no price, trial, account or license key, and never will. It is licensed under the [GNU General Public License, version 3 or later](LICENSE). Third-party components are listed in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md). It is maintained by volunteers; support is best-effort and not available on game nights. Repository address used in these files, `github.com/fieldhouse-app/fieldhouse`, is a placeholder.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) | [Code of Conduct](CODE_OF_CONDUCT.md) | [Security policy](SECURITY.md) | [Changelog](CHANGELOG.md). Contributions are signed off with the DCO (`git commit -s`).

## Project planning

## How the files fit together

| # | File | Answers | Read when |
|---|------|---------|-----------|
| 01 | [Vision & Positioning](01-vision-and-positioning.md) | Who is it for, why would they pick it, where does indie help or hurt | First |
| 02 | [Competitive Analysis](02-competitive-analysis.md) | What vMix and Hudl Production Truck actually do; gaps | Before scoping |
| 03 | [Workflows & Requirements](03-workflows-and-requirements.md) | What the product does, as game-night workflows with P0/P1/P2 priorities | Before building anything |
| 04 | [Scope & Roadmap](04-scope-and-roadmap.md) | v1 vs later; milestones; explicit non-goals | Planning work |
| 05 | [Architecture](05-architecture.md) | Build-vs-integrate, components, data model, stack | Before the first commit |
| 06 | [Risks](06-risks.md) | Hardest technical, product, legal, and solo-dev risks with mitigations | Always; revisit monthly |
| 07 | [Sustainability, Licensing & Support](07-business-licensing-support.md) | Free and open-source commitments, license choice, funding, third-party licensing, support model | Before the first public release |
| 08 | [Validation Plan](08-validation-plan.md) | Spikes and user research that must happen before committing | **Do this before M1** |
| 09 | [Open Decisions](09-open-decisions.md) | Decision log: options, recommendation, status | Whenever you disagree with something |
| 10 | [UI Design Spec](10-ui-design-spec.md) | Visual system, app structure, all 14 screens, UI open decisions (U-1…U-6) | Before any UI work |

Suggested path: 01 → 02 → 09 (skim recommendations) → 06 → 08. Then 03/04/05 become the build reference.

## Assumptions I made (correct me)

These shape every file. Each is also tracked in [09](09-open-decisions.md).

| ID | Assumption | Why |
|----|-----------|-----|
| A1 | Primary audience: **US high school athletic departments and youth/club orgs**, producing with volunteers or student crews, 1-4 cameras | Colleges have staff and budgets for TriCaster/vMix/Evertz and want enterprise support you can't give. Semi-pro needs sales and SLAs. Schools are underserved, price-sensitive, and reachable one at a time. |
| A2 | The operator is **one non-expert person** with ~10 minutes of setup time | This is the real gap between "powerful" (vMix) and "usable on game night". |
| A3 | **Windows first**, macOS second, Linux dev-only | vMix is Windows-only; Hudl's truck is macOS-only; schools have both. Windows has the widest capture-hardware and NDI support. |
| A4 | **Basketball first**, then football and volleyball | Indoor, controlled lighting, fixed venue, clock stops drive replay and ad breaks. Football has more demand but harder camera/graphics/scoreboard demands. |
| A5 | Output goes to **RTMP/SRT targets** (YouTube, Facebook, others) and local recording. Fieldhouse does not host video | Hosting is a different, expensive business. |
| A6 | **Local-first**: core features work with no cloud account | Gym Wi-Fi is bad; also removes a server bill and a privacy surface. |
| A7 | One developer, part-time, flexible timeline. Estimates are in **focused person-weeks**, not calendar dates | You haven't stated hours/week. |
| A8 | Your dev machine is Linux (observed from the environment) | Affects testing: Windows capture and hardware encoders need a real Windows test box. |
| A9 | The product is **completely free and open source** (your decision, 2026-10-05). Working license choice: GPL-3.0-or-later | Removes pricing, trials, accounts and license checks; adds community and sustainability work (see 07) |

## Reading the plan: conventions

- **P0/P1/P2** = must ship in v1 / should / later.
- **D-nn** = decision ID in file 09. **R-nn** = risk ID in file 06. **S-n** = spike in file 08.
- "Unverified" marks claims I could not confirm from public sources. Check these before relying on them.

## Development

### Run the code

Zero npm dependencies; needs [Bun](https://bun.sh). `ffmpeg` is used for the demo engine's test recordings and for highlight export.

```bash
bun test              # engine, domain modules, OBS adapter (against a mock; real OBS is covered by `bun scripts/obs-e2e.ts`), full game-night integration test
bun run demo          # http://127.0.0.1:8080 with demo data (venue, sponsors, games)
bun start             # same, with an empty database (data/fieldhouse.db)
```

- **The app** is a browser UI served by the local server (`web/`). Walk the flow: Home, Start game night, Setup (game, rosters, sources), Check (preflight), Go live, Live console, End broadcast (hold 1.5 s), Wrap-up (highlights). Everything else is in the rail: Sponsors, Reports, Settings (eight sections).
- **OBS overlay:** add `http://127.0.0.1:8080/overlay` as a Browser source (1920x1080): score bug, lower thirds, slate, sponsor corner.
- **Engine:** the installed desktop app uses OBS by default. From source, `ENGINE=fake` (what `bun run demo` uses) is a demo engine that simulates cameras and records a test-pattern file. `ENGINE=obs OBS_URL=ws://127.0.0.1:4455 OBS_PASSWORD=...` drives OBS Studio; it was verified against real OBS 32.2.2 (Flatpak) on Linux (`bun scripts/obs-e2e.ts`).
- **Phone on the gym Wi-Fi:** the operator console listens on this computer only and refuses other Host names. The phone remote is a separate listener, started only when enabled in Settings > Remote, and needs a pairing code. It has not been tried on a physical phone.
- State is an append-only event log in `data/fieldhouse.db`. Kill the process mid-game and restart: score and clock come back, with a "We restored your game" banner.
- Show recovery states on demand with the demo engine: `POST /api/dev/simulate {"what":"source-drop","arg":"cam1"}` (also `stream-drop`, `disk-low`, and the matching `-restore`).

Code map: `src/game.ts` (event-sourced state), `src/store.ts` (SQLite), `src/app.ts` (all routes and flows), `src/engine.ts` + `src/obs.ts` (media engine), `src/data.ts`, `sponsors.ts`, `reports.ts`, `preflight.ts`, `storage.ts`, `highlights.ts`, `diagnostics.ts`, `src/server.ts` (HTTP/WebSocket), `web/` (UI; contract in `web/README.md`), `design/` (the design frames and board).
