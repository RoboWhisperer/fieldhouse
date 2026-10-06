# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
Desktop application: an Electron shell (`desktop/`) running the Bun + TypeScript server compiled to a standalone sidecar binary, with an HTML/CSS/JS UI in `web/` (D-04, decided; Tauri was the earlier preference and the shell is swappable). Media engine is a separate decision (D-03; leaning: drive OBS Studio as a separate process behind an internal engine interface). Operator remote UI is served over the LAN to a phone/tablet browser. See `05-architecture.md` and `09-open-decisions.md`.

## Users
Primary: a single, non-expert volunteer operator (teacher, athletic director, booster-club parent, or student broadcast crew member) producing live high school basketball games from a laptop, with 1-4 cameras and about 10 minutes of setup time. Turnover is high (student helpers graduate), so first-time usability outranks power. Secondary, working from a phone browser: a scorekeeper driving the game clock and score. Later audiences (youth/club leagues, small colleges) are not confirmed targets. Assumptions A1, A2, A4 in `README.md` are confirmed.

## Product Purpose
Fieldhouse is a sports broadcast production suite: switching, game-state-driven graphics, event-aware instant replay, sponsor breaks with proof-of-play reporting, and simultaneous streaming and local recording. It exists so one person can produce a game broadcast that looks crewed. Success: a school uses it for every home game of a season, setup to live in under 15 minutes, and no recordings are lost.

## Positioning
Game-state-driven production: one game state (clock, score, period, fouls, events) drives graphics, replay tags, sponsor breaks, and highlights, combined with a guided game-night setup and a sponsor proof-of-play report. vMix is a general-purpose tool that leaves sports wiring to the user; Hudl Production Truck is tied to the Hudl ecosystem and, per its public listing, macOS-only with a four-camera cap.

## Operating Context
Evening and weekend games in school gyms and fields on a laptop, with poor Wi-Fi, mixed lighting, and little time before tip-off. The operator may work alone and cannot reach support during the game. Stream goes to RTMP/SRT destinations (such as YouTube or Facebook) while the program is recorded locally. Local-first: core features work with no cloud account.

## Capabilities and Constraints
- v1 scope: stream plus crash-safe recording, auto score bug and lower thirds from game state, one-button replay, sponsor scheduler with proof-of-play log, preflight check, crash recovery, diagnostics export (`03-workflows-and-requirements.md`, `04-scope-and-roadmap.md`).
- Not v1: hosting or VOD, 4K, virtual sets, remote phone cameras, AI features, non-sports production.
- Windows first, macOS second; H.264/AAC only for v1.
- Decided: completely free and open source; no paid tier, trial, accounts, or license keys. Working license choice GPL-3.0-or-later (confirm before the first public commit).
- Undecided: media engine, stack, funding model, first scoreboard protocol, product name (working title "Fieldhouse"). See `09-open-decisions.md`.
- Student footage and rosters are involved: no student data leaves the machine by default.

## Brand Commitments
Free and open source, forever, for every school; no accounts, no license keys, no upsell. Nothing else confirmed. "Fieldhouse" is a working title; trademark and domain checks are outstanding.

## Evidence on Hand
Planning documents only (`README.md`, `01`-`09`). No customers, pilots, testimonials, sponsors, or usage data exist yet; future work must not fabricate any. Competitor details come from public product listings and are partly unverified.

## Product Principles
1. The game state is the center; video, graphics, replay, and sponsors react to it.
2. Built for the third-year volunteer, not the power user: guided, hard to misuse, calm under pressure.
3. Never lose the recording; failure states are designed, not afterthoughts.
4. Reliability signals are always visible: stream health, recording, disk, and the next sponsor break.
5. Honest scope: depth in sports workflows over breadth in video features.

## Accessibility & Inclusion
Operator must be able to use it with keyboard alone and read it at arm's length in a dim or bright gym. Color is never the only status signal. No formal standard required yet; districts may later ask for a VPAT.
