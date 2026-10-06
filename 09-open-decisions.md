# 09. Open Decisions

Decision log. Status: **Open**, **Leaning** (recommendation made, not confirmed), **Decided**. When you decide, change the status and add the date and reason. Nothing here is decided yet.

| ID | Decision | Status | Resolved by | Blocks |
|----|----------|--------|-------------|--------|
| D-01 | Primary audience | Leaning | Interviews | Everything |
| D-02 | Platform order | Leaning | S-2, S-6 | Packaging, hardware testing |
| D-03 | Media engine: build vs integrate | **Built as A (2026-10-05, provisional)**: `Engine` interface + FakeEngine + OBS adapter | S-1, S-3, S-6 | Architecture, schedule |
| D-04 | App stack | **Decided: Bun server + browser UI in an Electron shell with the server as a compiled sidecar** (Tauri deferred; shell is swappable) | Skill/preference; light spike | Phase 1 |
| D-05 | Codecs and outputs for v1 | Leaning | S-2 | Min spec |
| D-06 | Business model | **Decided: free, no paid tier** (funding model open) | You, 2026-10-05 | Pilots, onboarding copy |
| D-07 | Source license | **Decided: open source**; license text Leaning GPL-3.0-or-later | Legal check before first public commit | Option C, contributors |
| D-08 | Support promise | Leaning | Capacity check | README, onboarding copy |
| D-09 | First scoreboard protocol | Open | S-5, pilots | P1 integration |
| D-10 | First sport(s) | Leaning | Interviews, calendar | Profiles, pilots |
| D-11 | Name and brand | Open | Later | Domain, trademark |

---

### D-01. Primary audience
- **Options:** (a) HS athletics/youth; (b) small colleges; (c) semi-pro/minor leagues; (d) event/club tournaments.
- **Recommendation:** (a), with (d) as a close second using the same product. Reason: underserved, reachable without sales staff, and your support limits are tolerable. Colleges and pro need what an indie can't offer yet. (See [01](01-vision-and-positioning.md).)
- **Revisit if:** interviews show schools are locked into Hudl contracts or rights deals (R-08).

### D-02. Platform order
- **Options:** Windows only; Windows then macOS; macOS first (Hudl's turf, fewer hardware variants); cross-platform from the start; browser-based.
- **Recommendation:** Windows first, macOS second via the same cross-platform shell. Windows hardware variety is a pain but it's where cheap school laptops and capture cards live, and vMix doesn't serve Mac. Browser-based production is not realistic for local capture/encode at this quality.
- **Note:** you develop on Linux; a Windows test box is needed regardless.

### D-03. Media engine: build vs integrate  (the most important decision)
- **Options:** A control layer over OBS; B own engine (GStreamer/FFmpeg); C link libobs (GPL); D sidecar for any switcher. Details in [05](05-architecture.md).
- **Recommendation:** A, behind an internal engine interface; D as fallback; B only post-v1 if justified.
- **Why:** engine work doesn't differentiate you, and it's where a solo developer would drown (R-01, R-10).
- **Revisit if:** S-1/S-3 fail, or pilot users reject a two-app experience.

### D-04. App stack
- **Decided 2026-10-05:** local web app (Bun + TypeScript server, browser UI in `web/`) wrapped in a desktop app: **Electron main process + the Bun server compiled to a standalone binary, run as a sidecar child process** (`desktop/`, `scripts/build-sidecar.ts`).
- **Why Electron, not the Tauri preference:** Tauri could not be built or tested on the dev machine (no webkit2gtk/GTK dev libraries), and an unverified shell is worse than a bigger one. Cost: ~145 MB installer and more RAM.
- **How to swap:** the shell holds no product logic. A replacement only has to spawn `fieldhouse-server` with `FIELDHOUSE_PACKAGED=1 PORT=0 HOST=127.0.0.1` (+ `FIELDHOUSE_WEB/ASSETS/OVERLAY`), read the `FIELDHOUSE_READY {"port":N}` stdout line, show `http://127.0.0.1:N`, send SIGTERM on quit, and ask `GET /api/state` whether `engine.stream.live` or `engine.record.active` before closing. See [desktop/README.md](desktop/README.md).
- **Rejected:** Qt/C++ and .NET (second language, no reuse of the web UI).

### D-05. Codecs/outputs
- **Options:** H.264/AAC only; add HEVC; add AV1.
- **Recommendation:** H.264/AAC over RTMP/RTMPS and SRT only, hardware encoders preferred. Platforms ingest it universally, and it sidesteps patent and licensing complexity (R-06).

### D-06. Business model
- **Decided 2026-10-05 (you):** Fieldhouse is completely free. No paid tier, trial, accounts, license keys, or feature gating.
- **Still open:** how the project is funded (optional donations, in-kind hardware, grants). Not a blocker; see [07](07-business-licensing-support.md).
- **Consequences:** removed pricing, trials, license checks and the sales/PO path from the plan and the UI; onboarding says "free and open source".

### D-07. Source license
- **Decided 2026-10-05 (you):** open source.
- **Recommendation for the license text:** GPL-3.0-or-later: compatible with OBS (GPL-2.0-or-later), keeps forks open, and makes linking libobs (D-03 option C) legally possible. Alternatives: MIT/Apache (permissive, allows closed forks), AGPL (unnecessary for a local app). Use DCO sign-off, not a CLA.
- **Before the first public commit:** confirm the choice (hard to change once contributors join), check NDI SDK compatibility, and decide a trademark policy for the name (D-11).

### D-08. Support promise
- **Options:** email, weekday hours; plus community; plus weekend game-night best-effort. (No paid support tier: the project is free.)
- **Recommendation:** weekday support plus community plus prevention features. Weekend help only for pilots in the first season. Never promise 24/7.

### D-09. First scoreboard protocol
- **Options:** pick by pilot demand after S-5; manual-only for v1; OCR from screen capture.
- **Recommendation:** manual + phone-driven second operator is v1's baseline. Add exactly one hardware protocol in Phase 3 chosen from what pilots own.

### D-10. First sport(s)
- **Options:** basketball; football; volleyball; soccer.
- **Recommendation:** basketball first (indoor, fixed lighting, clock-stop rhythm suits replay and sponsors, long home-game season in winter). Football second because demand is highest but its graphics/clock/camera needs are heavier. Choose differently if your pilot schools skew otherwise; the pilot's sport beats my guess.

### D-11. Name
- "Fieldhouse" as working title. Trademark and domain checks are needed before public use (and it's likely to be a crowded term; verify).

---

## Build choices as implemented (2026-10-05)

- **D-03, media engine: A (drive OBS) is now implemented and tested against real OBS Studio 32.2.2** (Flatpak, Linux, obs-websocket 5.7.4): provisioning, devices/network sources, cut/fade, real recording, streaming to a local RTMP sink, real instant replay, live meters, reconnect after OBS restarts. Spike S-1 passed on that setup. `FakeEngine` remains for demos, tests and development (`bun run demo`). **Not yet tested:** Windows and macOS OBS, native (non-Flatpak) Linux OBS, real cameras, real YouTube/Facebook streams. Measured: replay goes on air about 2 s after the click (spec target was under about 2 s), cut about 80-170 ms.
- **D-04, app shell: Electron + a compiled Bun sidecar** (Tauri could not be built here: no webkit2gtk/GTK dev libraries). Linux AppImage and .deb built and launched. The shell holds no product logic, so it can be swapped. Windows/macOS installers, signing and auto-update are configured in CI but have never run.
- **Lessons recorded for future maintainers:** OBS's embedded browser (Chrome 127) has no monospace font and does not load web fonts, so the on-air overlay draws its clock as SVG; a Flatpak OBS has a private /tmp and cannot write to system folders (Fieldhouse refuses such recording folders); a failed stream start makes OBS open its own modal error dialog.
- **Hands-off engine lessons (2026-10-06, OBS 32.2.2 Flatpak on KDE Wayland):** OBS >= 31 keeps UI preferences in `user.ini` and app keys in `global.ini` (writing only global.ini does nothing); the old `--disable-shutdown-check` flag no longer exists, a leftover `.sentinel/run_*` marker makes OBS open a modal "Crash Detected" dialog, so Fieldhouse deletes the markers before every launch; `--minimize-to-tray` plus `SysTrayWhenStarted` leaves no window on KDE; SIGTERM closes OBS cleanly in under a second (a hung dialog needs SIGKILL, `flatpak kill` is the Flatpak last resort); `SetVideoSettings` and profile switches are refused while the replay buffer runs, and a Stop sent while the buffer is still starting is ignored, so provisioning repeats it and the 1 s self-heal poll is paused meanwhile; OBS lists its encoders in its own log ("Available Encoders") and nowhere in obs-websocket; two OBS segfaults were seen (obs-outputs.so on stream start through a TCP proxy once, at exit after streaming once), the supervisor restarted OBS both times.
- **Why the profile hop existed, and why it is gone (2026-10-06):** a profile created with CreateProfile has no outputs, so StartReplayBuffer answers 604 until OBS reloads the profile; hopping to another profile and back forced that. In 15-iteration loops of 720p<->1080p changes against a live OBS, SetVideoSettings plus the hop gave 2 segfaults (obs-websocket request handler), one 12-minute freeze inside SetVideoSettings and several SetCurrentProfile timeouts. Pre-writing the profile ini with RecRB=true and starting OBS with `--profile Fieldhouse` needs no hop, and size/fps/encoder changes now restart the OBS Fieldhouse started (about 4 s, "Applying video settings..."). After that: 15 iterations with 0 crashes, 0 failed steps, recordings of the right height, 5 crash injections all ending with the saved settings applied, and 6 full hands-off runs (5 on the existing config, 1 on a pristine config) at 48/48.
- Both choices remain reversible: the engine sits behind an interface, and the UI only talks to `/api` and `/ws`.

## Assumptions register

Assumptions A1-A8 live in the [README](README.md). Status is the same as D-01/D-02/D-10. Add any new assumption there with an ID, and a decision here if it needs choosing.

## Change log

| Date | Change |
|------|--------|
| 2026-10-05 | Initial plan drafted; nothing decided. |
