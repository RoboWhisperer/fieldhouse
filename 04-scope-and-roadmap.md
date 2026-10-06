# 04. Scope & Roadmap

Estimates are **focused person-weeks** (A7), assuming ~15-25 productive hours/week. They carry roughly ±50% uncertainty, and the media-engine decision (D-03) swings them most. Treat as ordering and relative size, not dates.

## Principle

Ship the smallest thing that a school uses for a full real game and would miss if it vanished. That is: **reliable stream + recording, auto score bug from game state, one-button replay, sponsor breaks with proof-of-play**. Everything else is optional.

## Phase 0: Validate (before committing to code) — ~4-6 weeks

Run the spikes and research in [08](08-validation-plan.md). Output: decisions D-01..D-05 closed, a measured minimum machine spec, and 5+ schools who said "I'd try it".

**Gate:** if S-1 (engine) fails and no fallback works, or no school cares about the sponsor/replay loop, stop and rethink before M1.

## Phase 1: v0.1 "Control layer" — ~8-10 weeks

Prove the game-state thesis without owning video yet (assuming D-03 = engine-backed).

- Game, roster, venue data model (SQLite).
- Game-state engine + keyboard/phone control surface (browser on LAN).
- HTML/CSS graphics: score bug, lower thirds, period cards.
- Drives the underlying engine (scenes, stream, record) via its API.
- Basketball profile.

**Exit:** you broadcast one real game from your own setup (or a friend's gym) end to end.

## Phase 2: v0.5 "Game night" — ~10-12 weeks

- Preflight check, setup wizard, venue reuse.
- Event-aware replay (one channel).
- Sponsor library, scheduler, proof-of-play export.
- Crash recovery, source-drop slates, diagnostics export.
- Packaging/installer for Windows (code-signed), auto-update from GitHub Releases. No license check or accounts.

**Exit:** 3-5 pilot schools run full games on it. Collect every failure.

## Phase 3: v1.0 "A season" — ~8-12 weeks

- Fix what pilots broke (budget at least half of this phase for it).
- Scoreboard hardware protocol (one, picked by pilot demand, D-09).
- Second destination, per-source ISO recording, auto-highlights.
- Docs, onboarding video, public repository (LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, issue templates), community channel, first public release.
- macOS build if D-02 says so.

**Exit:** a public 1.0 release used by several schools for a full season, with zero lost recordings attributable to Fieldhouse.

**Total to v1.0: ~30-40 person-weeks** (≈ 8-12 calendar months at A7 pacing), *if* the engine-backed route holds. A fully custom engine would add something like 6-12 months and is the main reason I recommend against it (D-03).

## Later ambitions (ordered by my confidence)

| Order | Item | Why later |
|-------|------|-----------|
| 1 | Football, volleyball, soccer, baseball profiles | Profile system makes these cheap *if* basketball proves the model; each has its own graphics/clock quirks |
| 2 | Phone-as-camera (WebRTC/SRT) | High support burden, sync and latency pain (R-03) |
| 3 | Multi-angle replay and review | Needs more disk/CPU and UI |
| 4 | Stat/play-by-play ingest (e.g. from scorekeeper apps) | Depends on third-party APIs |
| 5 | College tier: sponsor inventory management, multi-sport, multi-user | Needs sales and support capacity |
| 6 | In-venue video board output | Hardware variety |
| 7 | Own media engine replacing the third-party one | Only if engine limits block users |
| 8 | AI features: auto-tagging, auto-camera hints, auto highlights from video | Needs data and GPU budget |

## Non-goals (say no, publicly)

- Video hosting, CDN, VOD site
- Non-sports production (churches, corporate, esports)
- Replacing vMix for power users: no 4K/8-channel/virtual-set arms race
- Enterprise features: SSO, SLAs, multi-tenant admin
- Paid tiers, accounts, license keys, or feature gating (the project is free and open source)
- Mobile-only production

## Scope-control rules

1. Any feature not tied to a workflow in [03](03-workflows-and-requirements.md) needs a user who asked for it twice.
2. New sport profiles only after the previous one has run a real season.
3. Reliability bugs outrank features, always, during the season (Aug-Mar US school calendar).
4. Freeze releases to pilots on game days. No updates within 24 hours before a scheduled game.
