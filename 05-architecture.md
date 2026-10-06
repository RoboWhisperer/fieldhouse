# 05. Architecture

Planning level: components, boundaries, and the decisions that are expensive to reverse. No code.

## The big decision: where does video processing come from? (D-03)

Everything else follows from this. Real-time video (capture, decode, GPU composite, encode, streaming protocols, replay buffering) is where most of the risk and effort in this product lives, and it is not where Fieldhouse is *different*. Options:

| Option | What it means | Pros | Cons |
|--------|---------------|------|------|
| **A. Control layer over OBS** | Fieldhouse is its own app that drives OBS Studio (separate process) through its WebSocket API; OBS does capture, mixing, browser-source graphics, encode, stream, record | Weeks not years for video; mature codec/HW encode/device support; users may already know OBS; GPL-clean as separate process | Two apps for the user (can be bundled/launched/hidden); OBS limits (replay is DIY; version drift; plugins); you depend on its API stability; "it's just an OBS wrapper" perception |
| **B. Own engine on GStreamer/FFmpeg + own compositor** | Embed media libraries, write your own mixer, compositor, replay | Full control, single seamless app, own UX | Largest risk in the plan. Realistically many months of non-differentiating work; A/V sync, GPU, device quirks, encoder edge cases all yours (R-01, R-02) |
| **C. Fork or link libobs** | Use OBS's core as a library in a custom shell | Mature core, custom UX | libobs is GPL-2.0-or-later: the app must be GPL-compatible, which is now fine because Fieldhouse is open source (D-07). Tracking upstream is a burden. OK only if you accept open-core/GPL licensing (D-07) |
| **D. Sidecar only** | Don't touch video; control any switcher (vMix/OBS) via their APIs, own only game state/graphics/sponsors/replay index | Smallest scope, immediate value | Not the "all-in-one suite"; dependence on two vendors; harder to sell as a product |

**Recommendation: A, with a hard engine boundary (an internal interface so B can replace it later).** Reasons: the thesis lives in the game-state layer; A reaches real users soonest; the indie constraint punishes owning the hardest part. D is the fallback if OBS integration proves too brittle (S-1). Choose C only if you want an open-source product. Revisit B after v1.0 only if users hit engine limits. Be honest in marketing: "built on OBS" is a feature (trusted), not something to hide.

> Legal note: because Fieldhouse is GPL-licensed open source, bundling or linking OBS is no longer a licensing blocker; the separate-process design (A) is kept for engineering reasons (stability, crash isolation, upgrade independence). Confirm the exact license terms of the OBS version you ship (R-06).

## Components (assuming option A)

```
┌───────────────────────── Fieldhouse App ─────────────────────────┐
│  Operator UI (desktop)        Remote control (browser on LAN)    │
│        │                              │                           │
│        └──────────────┬───────────────┘                           │
│                Core service (single process)                      │
│  ┌──────────────┬────────────┬────────────┬────────────────────┐  │
│  │ Game State   │ Sponsor    │ Replay/    │ Preflight &        │  │
│  │ Engine       │ Scheduler  │ Event Index│ Recovery           │  │
│  │ (sport       │ + proof    │            │                    │  │
│  │  profiles)   │ of play    │            │                    │  │
│  └──────┬───────┴─────┬──────┴─────┬──────┴─────────┬──────────┘  │
│         │  Local store (SQLite + files)              │             │
│  ┌──────▼────────────────────────────────────────────▼─────────┐  │
│  │ Engine interface (scenes, sources, stream, record, replay)  │  │
│  └──────────────┬───────────────────────────┬──────────────────┘  │
│                 │ OBS adapter (WebSocket)   │ future: native      │
│  ┌──────────────┴───────────┐ ┌─────────────┴──────────────┐     │
│  │ Graphics server           │ │ Input adapters:            │     │
│  │ (serves HTML overlays     │ │ scoreboard serial/TCP,     │     │
│  │  fed by game state)       │ │ CSV import, stat feeds     │     │
│  └───────────────────────────┘ └────────────────────────────┘     │
└────────────────────────────────────────────────────────────────────┘
          │                                   
   OBS Studio (child process): capture · mix · browser source · encode · RTMP/SRT · record
```

### Module responsibilities

- **Game State Engine.** Single source of truth. Event-sourced: every change (clock tick, score, foul) is an append-only event with a monotonic timestamp. State = fold of events. Gives undo, crash recovery (replay the log), the replay/highlight index, and proof-of-play data nearly for free. Sport behavior lives in **profiles** (data + small logic): periods, clock rules, scoring values, foul limits, which graphics exist. Build basketball first; keep football's needs (downs, field position, play clock) in mind when designing the interface so the second profile doesn't force a rewrite.
- **Graphics.** HTML/CSS/JS templates rendered by the engine's browser source, fed over WebSocket from game state. Pros: designers and schools can theme with web skills, animations are free, same approach as established broadcast graphics tools. Cons: browser source CPU cost; template versioning (see R-12).
- **Sponsor Scheduler.** Rules evaluate on game events (timeout started, period ended). Emits "break proposals" to the operator; logs every airing.
- **Replay/Event Index.** Engine records segmented files; Fieldhouse stores event timestamps mapped to recording time. Replay = seek + play a segment into a scene. (Whether OBS can do this cleanly at acceptable latency is spike S-3; it may need its replay buffer plus media sources, or a small helper process.)
- **Preflight & Recovery.** Health checks (sources, disk, network, destination), watchdogs, auto-restart of the engine, restoring state from the event log.

## Stack recommendation (D-04), pending S-spikes

| Layer | Recommendation | Why | Alternative |
|-------|---------------|-----|-------------|
| Core service + UI shell | **Tauri (Rust) + TypeScript/Svelte or React** | Small installers, native-feeling, Rust for long-running reliable core, web skills reused for graphics and remote UI | Electron (bigger, but simpler and more familiar); Qt/C++ (best if option B later) |
| Local data | **SQLite** | Zero-ops, transactional, exportable | Plain JSON files (weaker for event log queries) |
| Engine control | OBS WebSocket (v5 protocol) | Official, documented | None needed |
| Remote control UI | Same web UI served over LAN | One UI codebase | Native mobile app (don't) |
| Updates & distribution | Signed installer + update channel via GitHub Releases; no license check or accounts | Lowest ops burden | Store distribution |

If you are much stronger in one language than another, that outweighs the table. The stack is the *least* risky choice here; don't spend a month on it.

## Data model (sketch)

- **Org / Venue / Setup** (sources, scenes, destinations)
- **Team**, **Player** (number, name, position, optional photo)
- **Game** (teams, venue, sport profile, status)
- **GameEvent** (game_id, seq, type, payload, game_clock, wall_time, recording_offset), append-only
- **Sponsor**, **SponsorAsset**, **SponsorRule**, **Airing** (proof of play)
- **Recording** (path, start_wall_time, segments)

Keep all of this exportable as plain CSV/JSON on day one (R-10, user trust).

## Engineering practices (solo-survival)

- **Fake sources first.** Build a synthetic game feed (scripted events + test pattern sources) so you can develop and soak-test without a gym. A 3-hour automated soak test (stream + record + replay + events) is the main regression gate.
- **Everything the operator does is also in the log**, so game-night bugs are reproducible from a diagnostics bundle.
- **Crash-only mindset:** the core assumes it will be killed; startup is always a recovery.
- **Windows CI/test box** is needed early (A8). Capture-card and NVENC/QSV/AMF behavior can't be tested on Linux.
- **Telemetry:** opt-in, minimal (version, OS, crash signature). Schools and minors' footage make privacy a selling point (see [07](07-business-licensing-support.md)).
- **Architecture decision records:** log each D-nn resolution in [09](09-open-decisions.md) with date and reason.

## Supported inputs (v1)

USB/UVC and capture cards (via OS/engine), NDI (needs NDI runtime/SDK terms, see [07](07-business-licensing-support.md)), SRT and RTSP network sources, screen/window capture (for the scoreboard fallback or slides). Not v1: SDI/HDMI professional capture hardware beyond what the engine supports natively, ISO-cam record-from-camera.

## Codecs and outputs

H.264 + AAC to RTMP/RTMPS and SRT; local recording to MKV/fragmented MP4 (crash-safe), remux to MP4 on stop. Hardware encode (NVENC/QSV/AMF/VideoToolbox) preferred, x264 as fallback. HEVC/AV1 are not v1 (platform ingest support and patent/licensing complexity; see R-06).
