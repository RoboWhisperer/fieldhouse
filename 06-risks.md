# 06. Risks

Ranked by (likelihood × damage). Revisit monthly. "Kill signal" = what would tell you the risk has materialized.

## Top five (could sink the project)

| ID | Risk | Likelihood | Impact |
|----|------|-----------|--------|
| R-01 | Real-time video reliability on commodity hardware | High | Critical |
| R-10 | Single-developer bottleneck / burnout / bus factor | High | Critical |
| R-04 | Game-night failure destroys trust (no live support) | Medium | Critical |
| R-08 | Distribution rights and market access (state associations, school media contracts) | Medium | High |
| R-09 | Nobody adopts or contributes: the sponsor/replay loop doesn't resonate | Medium | Critical |

## Technical

**R-01. Real-time video reliability.** Capture devices vary wildly; USB cameras drop frames; laptops thermally throttle; GPU encoders behave differently per driver; A/V sync drifts over 3 hours. A broadcast that dies at the final buzzer is the product's one unforgivable failure.
- *Mitigation:* use a mature engine (D-03/A); define and publish a min spec from measurement (S-2); 3-hour soak test as CI gate; recording-first design (stream failure never kills the file); test on a deliberately bad machine.
- *Kill signal:* pilot schools report dropouts you can't reproduce.

**R-02. Latency and operator perception.** Viewer latency (RTMP→HLS, often many seconds) is mostly platform-determined and outside your control. What you control is *monitor* latency (what the operator sees vs. what's live) and replay response. Operators cutting on a laggy preview will cut wrong. Also game-clock vs. video sync: graphics driven by the scoreboard can lead or lag the video the viewer sees.
- *Mitigation:* measure capture→preview and capture→encode delay (S-2); optional configurable graphics delay to match video; set expectations in docs. Don't promise "low latency".

**R-03. Remote phone cameras (P2).** Browser/WebRTC cameras have variable frame timing, resolution renegotiation, battery/thermal limits, and no genlock. Sync with other cameras is hard. High support cost.
- *Mitigation:* keep it out of v1; if built, SRT-from-app may be more predictable than browser WebRTC; ship as "beta".

**R-05. Dependence on OBS (if D-03 = A).** API changes, plugin incompatibilities, replay shortcomings, user running their own OBS version, upstream bugs you can't fix.
- *Mitigation:* pin and bundle a tested OBS version; engine interface abstraction; contribute fixes upstream if needed; spike S-1 decides go/no-go; fallback is option D or B.

**R-11. Scoreboard integration.** Hardware protocols (e.g. common school scoreboards) are partly documented, partly reverse-engineered; they vary by model and by installer's wiring; you can't test without hardware. Unverified: confirm which protocols are publicly documented before promising any.
- *Mitigation:* manual entry + a second-person phone control is P0; hardware is P1 and starts with one model a pilot school actually owns; screen-capture OCR is a (hacky) fallback, not a plan.

**R-12. Graphics template and browser-source load.** HTML overlays eat CPU on weak laptops, and templates will need schema versions as the data model evolves.
- *Mitigation:* budget graphics cost in the min spec; version template contracts; ship few, tuned templates.

## Product / market

**R-04. No 24/7 support vs. game nights.** Failures happen Friday 7 pm. A support email answered Monday is a lost relationship.
- *Mitigation:* prevention (preflight, recovery, safe mode) over reaction; offline "game-night troubleshooting" card in-app; diagnostics bundle; community channel; be honest about maintainer response times before anyone adopts it. Consider a "game-night hotline" for paying schools only if volume is small, and expect it to cost you your evenings.

**R-08. Rights and access.** Many state athletic associations and school districts have exclusive or restrictive streaming/media-rights arrangements (e.g. with NFHS Network or similar). A school may be *unable* to stream a given event on its own channel, or may owe revenue share. Unverified and varies by state; this could shrink the addressable market.
- *Mitigation:* research three target states' rules in Phase 0; support production for permitted uses plus recording-only, in-venue screens, and *outputs to any destination including approved platforms*; ask schools before assuming.

**R-09. Value hypothesis wrong.** Maybe schools don't have sponsors to sell, or don't need replay, or just use Hudl because it came with a camera.
- *Mitigation:* the validation plan ([08](08-validation-plan.md)) tests this before M1. Ask for a real commitment that costs the school something other than money: a named pilot game, a booked date, an intro to a sponsor, or a volunteer who will give feedback after each game.

**R-13. Seasonality and buyer cycle.** US school sports are Aug-Mar; one bad pilot week can cost a whole season of feedback.
- *Mitigation:* plan releases around seasons; use off-season to build; target winter (basketball) pilots; keep an eye on summer/club leagues.

**R-14. Platform risk from ecosystems.** Hudl could bundle more free; YouTube/Facebook change ingest rules; AI auto-cameras (Pixellot, Veo, Spiideo) reduce the need for operators.
- *Mitigation:* stay open (accept any source, any destination); consider AI cameras as inputs rather than enemies.

## Legal and licensing (details in [07](07-business-licensing-support.md))

**R-06. Codec/SDK/engine licensing.** H.264/AAC patent pools, FFmpeg build configurations (LGPL vs GPL), OBS GPL, NDI SDK terms, third-party font and music rights. Mistakes here are quiet until someone sends a letter.
- *Mitigation:* prefer hardware encoders and engine-supplied codecs; maintain a third-party-licenses file from day one; get one hour of a lawyer's time before the first public release.

**R-07. Privacy and minors.** Streams and recordings feature students; rosters contain names; FERPA/COPPA-style concerns and district policies may apply; also sponsor/music copyrights in recordings.
- *Mitigation:* local-first data; no accounts for core features; no student data sent to your servers; opt-in telemetry only; no music bundled; document what is stored where. Get actual legal advice before collecting any data centrally.

## The solo-developer risks

**R-10. Bottleneck.** You are product, engineering, QA, support, outreach, and docs. Specific failure modes: perfectionism before first user contact; Windows hardware you don't own; support during season colliding with building; burnout; no one else can fix it.
- *Mitigation:*
  - Pre-commit to a pilot cohort *before* building.
  - Keep scope on the 4-feature core (stream/record, game-state graphics, replay, sponsors).
  - Buy or borrow a Windows test machine, a cheap capture card, 2-3 cameras early.
  - Document decisions (these files) and keep data in open formats.
  - Schedule "support weeks" in season and "build weeks" in off-season.
  - Consider one trusted part-time contractor or co-maintainer by v1.0 for Windows QA/support.
  - Set a personal review point at end of Phase 0 and Phase 2: continue / pivot / stop, decided in writing.

**R-15. Open-source sustainability.** Donations typically cover little; the maintainer's time and a Windows test lab are the real costs; a popular project attracts support demand with no revenue. Forks or drive-by requests can drain energy.
- *Mitigation:* say plainly that it is volunteer-maintained with best-effort support; keep scope on the four-feature core; set contribution guidelines and a code of conduct; seek in-kind hardware; recruit one co-maintainer for Windows QA; automate releases and the soak test so one person can ship safely. Decide in writing what would make you stop or hand over the project.

## Risk-to-spike map

| Risk | Resolved by |
|------|-------------|
| R-01, R-02 | S-1, S-2, S-3 |
| R-05 | S-1 |
| R-11 | S-5 |
| R-08, R-09, R-13 | Research tasks in [08](08-validation-plan.md) |
| R-06 | Legal review before the first public release |
