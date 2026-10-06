# 01. Vision & Positioning

## One-sentence pitch

> Fieldhouse makes a one-person game broadcast look like a crewed one, because it understands the game, not just the video.

## The core thesis

General-purpose switchers (vMix, OBS, TriCaster) treat sports as video with overlays. The operator manually keeps the scoreboard graphic in sync, remembers to run the sponsor read, and hunts for the replay. Fieldhouse's bet: **make game state the center of the product**, and let video, graphics, replay, and ads react to it.

```
              ┌──────────── Game State ────────────┐
 scoreboard → │ clock · period · score · fouls ·   │ → graphics (auto)
 operator   → │ possession · roster · events       │ → replay tags (auto)
 stat feed  → └────────────────────────────────────┘ → ad/sponsor breaks (auto)
                                                     → highlight index (auto)
```

If this works, the operator's job shrinks from "run 6 tools" to "cut cameras and press Replay".

## Target users (assumption A1)

| Segment | Fit | Notes |
|---------|-----|-------|
| **HS athletic departments, student broadcast clubs** | Primary | Volunteers, turnover every year (so onboarding matters more than power), small budgets, want sponsor revenue. |
| Youth/club leagues, tournaments | Secondary | Same needs, more venues, more fields. |
| Small colleges (D3/NAIA/JUCO) | Later | Have a sports info director, want stats integration and sponsor inventory. Natural v2 upsell. |
| Semi-pro/minor leagues | Not now | Need SLAs, integration partnerships, and sales. |
| Churches/events | Out of scope | vMix's turf. Don't drift. |

Primary persona: **"Coach Dana"**: a teacher or AD volunteer who streams 30-60 home games a year, has 2-3 cameras and a laptop, moves between gyms and fields, and gets one student helper who graduates in spring.

## Where Fieldhouse can beat general-purpose software

Detailed workflows are in [03](03-workflows-and-requirements.md). The differentiation, ranked by how defensible it is:

1. **Game-state-driven graphics.** Scoreboard bug, lower thirds with player stats, foul/penalty indicators, and period transitions update from one source. vMix can do this with data sources and effort; Fieldhouse ships it done per sport.
2. **Event-aware instant replay.** Replay and clips tied to game events (score, foul, timeout) rather than a rolling buffer the operator scrubs. "Replay last score" is one button.
3. **Sponsor inventory with proof-of-play.** Sponsors get scheduled into natural stoppages (timeouts, halftime) and the school gets a report of what aired and when. Hudl advertises sponsor-asset tools; the proof-of-play report and stoppage-aware scheduling is the gap. This is also the feature that pays for the product *for the school*.
4. **Guided game night.** Pre-game checklist, device preflight, one-click sport template, roster import via CSV, safe recovery after a crash. Optimizes for the third-year volunteer, not the vMix power user.
5. **Post-game highlights from the event index.** Tagged events become an auto-assembled highlight reel. Rare in this price band.
6. **Phone-as-camera without an app** (browser/WebRTC or SRT). Hudl's Remote Truck does this via an iOS app. A browser link is lower friction. This is a P2 because it carries real latency/sync risk (R-03).

Things that are *not* differentiators, and shouldn't be sold as such: raw switching quality, codec support, 4K, number of inputs. vMix wins those and always will.

## Indie constraint: advantage vs. disadvantage

| Advantage | How to use it |
|-----------|---------------|
| Narrow focus. vMix must serve churches, corporate, esports; you serve one thing | Say no to everything outside sports. Depth beats breadth. |
| Direct line to users; you can sit at the gym | Ship to 5-10 friendly schools early; watch a real game night. |
| Fast iteration, no committee | Release weekly in-season; sport profiles are cheap to add. |
| Free and open source: no price to defend, no vendor lock-in | Compete on workflow and openness. Schools can inspect, fork, and keep using it even if development stops. Contributors can add sport profiles. |
| No legacy | Pick modern defaults (SRT, WebRTC, HTML graphics). |

| Disadvantage | Mitigation |
|--------------|-----------|
| No enterprise sales or procurement path (schools buy through district processes) | Free software needs no purchase order or procurement cycle. District vetting still wants a data-handling summary and source access, which open source makes easy. |
| No 24/7 support, but game night is evenings and weekends | Design for self-diagnosis; offline docs; in-app logs export; preflight; community channel. See [07](07-business-licensing-support.md). |
| No hardware or league partnerships (scoreboards, cameras, state associations) | Support open/documented protocols first; use CSV and manual entry as fallback; don't depend on a partner to be useful. |
| Bus factor of one | Plain architecture, strong docs (these files), data in open formats, and a public repo anyone can fork. See R-10. |
| Trust: schools won't risk a game on unknown software | Public source anyone can inspect, no cost to try, rock-solid recording-first design, visible reliability track record. |

## What success looks like (first 18 months, assumption)

- 10 schools use it for every home game for a full season, unprompted.
- Median first-time setup to live stream under 15 minutes.
- Zero lost recordings attributable to Fieldhouse.
- At least 3 of those schools have run a sponsor schedule through it.

These are targets to be revised in [08](08-validation-plan.md), not promises.
