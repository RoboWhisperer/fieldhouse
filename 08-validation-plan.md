# 08. Validation Plan (Phase 0)

Goal: replace assumptions with measurements and evidence **before** committing months. Each item has a pass/fail test and what it unlocks. Total ≈ 4-6 weeks.

## Technical spikes (throwaway code is fine; no production quality)

| ID | Question | Pass criteria | Decides |
|----|----------|---------------|---------|
| S-1 | Can OBS be driven reliably as an engine (scenes, sources, stream, record, browser source, crash detection and restart) via WebSocket from an external app? | 3-hour run, scripted scene changes every few seconds, engine killed and restarted twice, recording still playable, stream resumes | D-03 (A vs D vs B), R-05 |
| S-2 | What hardware does a realistic setup need? Measure 3 sources 1080p30 → program 1080p30, stream + record, plus HTML score bug, on 3 machines: a 5-year-old school laptop, a mid-range recent laptop, a mini PC | CPU/GPU < ~70% sustained, 0 dropped frames over 3 h, thermals stable; capture→preview and capture→encode delay measured | Min spec; R-01, R-02 |
| S-3 | Can event-aware replay work on the chosen engine? Mark an event, then play last N seconds (slow-mo) into program | Replay on screen < ~2 s after keypress; no glitch in live stream; works while recording | R-05, replay design in [05](05-architecture.md) |
| S-4 | Game-state-driven HTML graphics: clock tick accuracy and CPU cost; update path latency to a browser source | Clock never visibly stutters; update appears within ~100 ms; < ~10% CPU | Graphics approach; R-12 |
| S-5 | What scoreboard protocols are documented and obtainable? Find 2-3 models used by target schools; get docs; or a pilot school lets you sniff a serial/TCP stream | At least one protocol with a documented message format and a test sample | D-09 |
| S-6 | Packaging: signed Windows installer that bundles/launches a pinned OBS, with auto-update path | Clean install on a fresh Windows VM in under 5 min, no admin surprises; OBS GPL notices included | D-03, R-06 |
| S-7 | Crash recovery: kill the core mid-game; restore from the event log | Score/clock/sponsor counts restored; resumes < 60 s; recording playable | Event-sourcing approach |

Hardware to acquire for spikes (budget a few hundred dollars): a used Windows laptop, an HDMI capture card, 2 cheap USB/UVC cameras (or use phones as NDI/SRT sources), a USB audio interface or mic.

## User research (parallel with spikes)

Target: **10 conversations** with ADs, broadcast teachers, booster-club volunteers across at least 3 states; shadow **3 real game streams** if you can get access.

Learn:
1. How they stream today: tools, crew size, setup time, what breaks.
2. Who owns the decision and budget; purchase process and thresholds.
3. Sponsor reality: do they sell sponsor reads today, how, for how much, and do sponsors ask for proof?
4. Streaming rights: what are they allowed to do by state/district? (R-08)
5. What do they use for scoreboards and how is it wired?
6. Reaction to the pitch (sponsor schedule + proof, one-button replay, preflight). Ask for something real: a pilot commitment, an intro to a sponsor, or a booked pilot game. The product is free, so "would you pay" is the wrong question: ask what would make them switch from what they use now.
7. What would make them *not* switch from Hudl/OBS/vMix.

Output: 1-page synthesis per theme; update A1-A8 and the persona in [01](01-vision-and-positioning.md).

## Competitive checks

- Watch demos or trials of vMix and Hudl Production Truck (Hudl's trial availability unverified) and note setup time and score-bug workflow.
- Run a stopwatch test: how long does *you*, a competent user, take to set up each tool for a basketball game with score bug? That's the number to beat.

## Gate review (write it down)

At the end of Phase 0, record in [09](09-open-decisions.md):

| Question | Go if |
|----------|-------|
| Engine path viable? | S-1, S-3 pass (or fallback chosen with eyes open) |
| Hardware realistic? | A min spec exists that the median pilot school meets |
| Is there demand? | ≥ 5 schools commit to a pilot game; ≥ 3 care about sponsors or replay unprompted |
| Are rights a blocker? | Target states permit school-run streaming of home games |
| Can I sustain this? | Weekly hours available match Phase 1-2 estimates; support plan chosen |

If two or more are "no", pivot options: sidecar-only (D), a narrower tool (just sponsor scheduler + proof-of-play), a different segment (youth tournaments/clubs), or stop.

## Success metrics to instrument later (opt-in, local-first)

Setup time to first live; games per school per month; preflight failures by type; crash rate per game-hour; replay uses per game; sponsor airings per game; support contacts per game.
