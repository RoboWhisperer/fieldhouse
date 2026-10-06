# 02. Competitive Analysis

Sources: Hudl's Production Truck product page and vMix listings, retrieved 2026-10-05 via web search. Pricing for Hudl was **not found** and is unverified. Verify everything below against current vendor pages before using it in marketing or pricing decisions.

## vMix

Windows-only software production suite (current at time of writing: v29, per public listings). Editions: Basic (free), Basic HD (~$60), HD (~$350), 4K, Pro (~$1200), one-time licenses.

What it does well:
- Many inputs (cameras, NDI, SRT, files, capture cards, web, desktop), mixing, virtual sets, multiview.
- Instant Replay (multi-channel in higher editions), with events/markers and a hardware-controller story.
- Titles/GT graphics, data sources (spreadsheets, XML, scoreboard feeds via scripts).
- Streaming to many destinations, recording, NDI/SRT in/out, vMix Call and Social.
- Scripting and a TCP/HTTP API; large third-party ecosystem (control surfaces, Companion, scoreboard integrations).

Weak spots Fieldhouse can target:
- **Horizontal tool.** Sports workflows (score bug wiring, replay tagging, sponsor reads) are built by the user from primitives.
- **Learning curve and setup time.** Strong for a trained operator, rough for a first-year volunteer.
- **Windows-only** and GPU/CPU hungry.
- No sponsor-inventory or proof-of-play concept.

## Hudl Production Truck (Hudl TV)

macOS-only app aimed at schools. Public listing says: one producer, 1080p/60 capture, 4-camera switching with transitions, clips, picture-in-picture, RTMP to any streaming service, sponsor asset monetization tools, customizable graphic overlays, scoreboard integration, network sources (Hudl Focus, NDI), output to in-venue screens, instant replay with configurable duration/speed, social sharing, and a Remote Truck iOS app (remote camera, direct stream to Hudl TV, official video review).

Strengths: school distribution via Hudl's existing relationships, hardware tie-in (Focus cameras), a hosting/monetization platform behind it, and brand trust with athletic directors.

Weak spots Fieldhouse can target:
- **Tied to the Hudl ecosystem** (hosting, cameras, contracts). Schools wanting YouTube/own channel or non-Hudl cameras have friction. Treat the extent of lock-in as unverified.
- **Mac only**; many schools are Windows/Chromebook shops.
- **Four-camera cap** (per listing).
- Little visible depth in sport-specific game logic or sponsor reporting (unverified; confirm by watching a demo).

## Others worth knowing (not deeply analyzed)

| Product | Relevance |
|---------|-----------|
| OBS Studio | Free, huge community. The baseline every school already knows. Also the most realistic build-vs-integrate option (see [05](05-architecture.md)). |
| NFHS Network / PlayOn | Distribution/rights platform for HS sports; often the *reason* a school can't stream elsewhere (see R-08). Unverified: confirm per-state rules. |
| Pixellot / Veo / Spiideo | Automated AI cameras. Different approach (no operator). They are the long-term threat to the "operator with cameras" model, and a possible *input source* for Fieldhouse. |
| Singular.live, CasparCG | Graphics engines; reference for templating approach. |
| StreamYard / Restream | Browser-based, easy, but not sports-aware. Sets the bar for "easy". |

## Feature matrix (v1 intent)

Legend: ● strong, ◐ partial/needs setup, ○ none or unverified.

| Capability | vMix | Hudl Truck | Fieldhouse v1 |
|-----------|------|-----------|---------------|
| Multi-camera switching | ● | ● (4) | ◐ (up to 4, via engine) |
| Raw input/format breadth, 4K | ● | ◐ | ○ (not a goal) |
| Instant replay | ● | ● | ◐ (event-aware, 1 channel) |
| Score bug / lower thirds | ◐ (DIY) | ● | ● (per sport, from game state) |
| Scoreboard hardware integration | ◐ (scripts) | ● | ◐ (manual first, 1 protocol later) |
| Sponsor scheduling + proof-of-play | ○ | ◐ (assets) | ● (core differentiator) |
| Guided setup / preflight | ○ | ◐ | ● |
| Auto highlights from events | ○ | ○? | ◐ (P1) |
| Remote phone cameras | ◐ (vMix Call, NDI Cam) | ● (iOS app) | ○ (P2) |
| Hosting/VOD platform | ○ | ● | ○ (non-goal) |
| Windows | ● | ○ | ● |
| macOS | ○ | ● | ◐ (second) |
| Price | $0-1200 once | Unverified | See [07](07-business-licensing-support.md) |

## Takeaway

Don't try to out-feature vMix. Win on the **time from "I have a gym and a laptop" to "sponsored, scoreboard-accurate stream"**, and on the sponsor revenue loop. Hudl wins on distribution; your counter is openness (any camera, any destination, Windows) and sport depth.
