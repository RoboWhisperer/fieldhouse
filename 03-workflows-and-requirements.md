# 03. Workflows & Requirements

Requirements are organized by game-night workflow, not by feature list. Priority: **P0** = v1 cannot ship without it, **P1** = v1 if time allows, **P2** = later. Sport for v1: basketball (A4). Keep the engine sport-agnostic via "sport profiles" (see [05](05-architecture.md)).

## W1. Setup (day before / 15 minutes before tip-off)

Goal: from install to a verified, ready-to-go state without reading docs.

| Pri | Requirement |
|-----|-------------|
| P0 | Create a Game: teams, date, sport profile (basketball), destination(s). |
| P0 | Import rosters from CSV (number, name, position); manual edit. Team colors/logos. |
| P0 | Source setup: detect capture devices / NDI / SRT / RTSP sources; label them ("Center court", "Baseline"). |
| P0 | **Preflight check:** every source live, audio levels non-silent, disk space for recording, upload bandwidth test, destination key valid, clock source set. Red/green list. |
| P0 | Save and reuse a venue setup ("Main gym"); a new game clones last game's setup. |
| P1 | Test stream/private broadcast to verify destination before the public goes live. |
| P2 | Import schedule/rosters from third-party services (needs per-service work; unverified availability). |

## W2. Live production (the product)

| Pri | Requirement |
|-----|-------------|
| P0 | Switch between sources (cut, fade); program/preview; keyboard shortcuts; one-click "all sources preview" multiview. |
| P0 | Audio: per-source level, mute, master; separate commentary mic; limiter so nothing clips. |
| P0 | **Game state panel:** clock start/stop/adjust, period, home/away score, team fouls, timeouts. One operator can drive it with a keyboard; a second person can drive it from a phone/tablet browser on the LAN. |
| P0 | **Auto score bug** from game state (always on, can be hidden), period/halftime/final cards. |
| P0 | Lower thirds from roster (click a player → name/number/stats). |
| P0 | Stream to ≥1 RTMP or SRT destination **while recording the program locally**. Recording must survive stream failure. |
| P0 | Stream health indicator: bitrate, dropped frames, reconnect state. Auto-reconnect without stopping the recording. |
| P1 | Scoreboard input from hardware (one protocol; see D-09) replacing manual score/clock entry. |
| P1 | Picture-in-picture, simple transitions set (cut/fade/wipe). |
| P1 | Second destination (e.g. YouTube + school site). |
| P2 | Remote phone cameras. In-venue screen output. Virtual sets. |

## W3. Replay

| Pri | Requirement |
|-----|-------------|
| P0 | Continuously buffer the program and/or selected camera(s) to disk. |
| P0 | "Replay last N seconds" at normal and slow-mo speed on one button, played into program with a transition. |
| P0 | Events (score, foul, timeout, manual mark) are timestamped automatically from game state or one keypress. |
| P1 | "Replay last score" using the event index to choose in/out points; pick angle. |
| P1 | Replay with graphic ("REPLAY" bug). |
| P2 | Multi-angle replay, telestration, official video review mode. |

## W4. Sponsors and ad breaks

The workflow that funds the school. This is the signature feature, so even a P0 version must be real.

| Pri | Requirement |
|-----|-------------|
| P0 | Sponsor library: name, logo, optional video/audio read, display length. |
| P0 | Schedule by trigger: timeout, end of period, halftime, pre-game, post-game; with frequency caps ("max every 8 min"). |
| P0 | Operator sees "next break: Smith Dental, 15s" and can fire, skip, or delay it. |
| P0 | **Proof-of-play log** (what, when, how long, game, estimated viewers if provided) exportable as CSV/PDF. |
| P1 | Sponsor-specific lower-third, "brought to you by" persistent corner slot. |
| P1 | Per-sponsor contract limits (e.g. 12 airings per season) with remaining counts. |
| P2 | Pulling viewer counts from YouTube/Facebook APIs for reports (API terms/quotas apply). |

## W5. Post-game

| Pri | Requirement |
|-----|-------------|
| P0 | Recorded program file(s) saved with game metadata (teams, date) in a predictable folder. |
| P0 | Event index exported alongside (JSON/CSV) with timestamps relative to the recording. |
| P1 | Auto-assembled highlights from marked events (score + 3s pre-roll + 5s post-roll), exported as one file. |
| P1 | Per-source ISO recordings. |
| P2 | Direct upload of highlights to YouTube. Clip sharing for players/families. |

## W6. Recovery (the unglamorous workflow)

| Pri | Requirement |
|-----|-------------|
| P0 | App crash or restart mid-game: relaunch restores game state, clock, score, sponsor counts, and resumes within one minute. Recording file is playable (segmented format, e.g. fragmented MP4/MKV). |
| P0 | Source drop: show a slate ("technical difficulties") instead of black; auto-reacquire on reconnect. |
| P0 | One-click "export diagnostics" (logs, config, system info) so remote support is possible. |
| P1 | Optional hot-standby restream (e.g. second local encoder) — probably too much; keep as idea. |

## Cross-cutting requirements

- **Performance budget (P0):** 3 sources at 1080p30 in, 1080p30 program out, record and stream, on a defined minimum machine (see S-2 in [08](08-validation-plan.md)). Define the min spec *after* measurement; write it on the product page.
- **Latency:** program to viewer is dominated by the platform (RTMP→HLS typically many seconds). Fieldhouse's own contribution (capture → encode) is targeted <500 ms. Operator-facing monitor latency matters more than viewer latency: see R-02.
- **Accessibility:** keyboard-operable, readable at gym distance on a laptop screen, colorblind-safe tally colors.
- **Offline:** everything above works without internet except the stream itself. There is no license check, account, or sign-in.
- **Data:** local SQLite plus plain files; game data exportable. No account required for core features.

## Explicitly not in v1

Hosting/VOD, cloud production, AI auto-camera, stat-keeping (play-by-play) as a product, multi-venue management, team/player social features, mobile editing, 4K, virtual sets, hardware controllers. See [04](04-scope-and-roadmap.md).
