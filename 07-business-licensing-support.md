# 07. Sustainability, Licensing & Support

Fieldhouse is **completely free and open source** (decided; see D-06 and D-07 in [09](09-open-decisions.md)). No price, no paid tier, no trial, no accounts, no license keys, no feature gating ("open core"). This file replaces the earlier pricing analysis.

Not legal or financial advice. Items marked **verify** need confirmation from primary sources or a professional.

## What "free and open source" commits you to

- **Free for everyone, forever,** including schools, leagues, and commercial users. Every feature in the app is in the public repository.
- **No accounts and no license check.** The app never phones home to verify anything. Telemetry is opt-in and anonymous (version, OS, crash signature).
- **Public by default:** issues, roadmap, and these planning docs can live in the repo. A planning-doc line that mentions a customer, pilot, or school by name should be removed before publishing.
- **Product consequence:** nothing in the UI sells, upsells, or counts down. Onboarding says it is free and links to the source (see [10](10-ui-design-spec.md) 5.1 and 5.14).

## License choice (D-07)

| Option | Pros | Cons |
|--------|------|------|
| **GPL-3.0-or-later (recommended, working choice)** | Compatible with OBS (GPL-2.0-or-later), so linking libobs becomes possible if ever wanted (architecture option C in [05](05-architecture.md)); forks must stay open, which protects volunteers' work from closed commercial forks | Some organizations avoid GPL; cannot be combined with GPL-incompatible components (see NDI below) |
| AGPL-3.0 | Closes the network-service loophole | Unnecessary here: the app is local-first, not a hosted service; scares away contributors |
| MIT / Apache-2.0 | Maximum adoption, easy corporate use | Allows a closed, paid fork to outcompete you on your own work; cannot ship a combined work with GPL parts under these terms |

The license applies to code you write. The name and logo are not covered: decide whether to keep a trademark policy ("Fieldhouse" is a working title, D-11). Use **DCO sign-off** (`Signed-off-by`) instead of a CLA for contributions: lighter on volunteers. The license is hard to change after contributors join; confirm it before the first public commit.

## Funding and sustainability (D-06)

Real costs, even for free software: your time, a Windows test machine, capture cards and cameras, code-signing, and domain/CI. Options, none required and none gating features:

| Source | Notes |
|--------|-------|
| **Optional donations** (GitHub Sponsors, Open Collective) | Lowest effort. Expect small amounts; a transparent public ledger builds trust. Open Collective can act as a fiscal host (fees apply; verify) |
| **In-kind hardware** from camera/capture/audio vendors | Offsets test-lab cost in exchange for a "works with" listing; no influence over roadmap |
| **Grants** from open-source or education/sports foundations | Plausible, slow, and paperwork-heavy; verify which programs currently exist |
| **School/booster contributions** earmarked for a feature or sport profile | Works as sponsored development if you want it; keep the output open |
| Paid support or hosting by *third parties* | The license allows it; you are not obliged to run it |

Cost line items to plan for:
- **Windows code signing:** unsigned installers trigger SmartScreen warnings that scare volunteers. Free signing for open-source projects exists through some programs (e.g. SignPath Foundation; **verify** eligibility and terms), otherwise a paid certificate.
- **macOS:** distributing outside the App Store needs an Apple Developer account and notarization (annual fee; **verify** current amount).
- Update hosting and download bandwidth: GitHub Releases is free for typical open-source use.

Say plainly in the README that the project is maintained by volunteers and funded by optional donations.

## Third-party licensing inventory

Keep a `THIRD_PARTY_LICENSES` file from day one. Open source simplifies some items and does not remove others.

| Component | License / issue | Effect |
|-----------|-----------------|--------|
| OBS Studio | GPL-2.0-or-later | Compatible with a GPL-3.0-or-later app. Control it as a separate process (A) or link libobs (C); both are now legally straightforward. Verify the "or later" wording in the version you ship |
| FFmpeg | LGPL or GPL depending on build | Either is acceptable; prefer an LGPL build to keep options open |
| x264 | GPL | Fine in a GPL project |
| **H.264 / AAC patents** | **Patent pools apply to distributors regardless of source license** | Open source does not grant patent rights. Prefer hardware/OS encoders (the vendor covers it) and Cisco's OpenH264 binary; get legal advice before shipping your own software encoder. HEVC stays out of v1 |
| **NDI SDK** | Proprietary; licensing and branding terms | **May be incompatible with GPL distribution.** Treat NDI as an optional plugin the *user* installs, or exclude it. Verify the current NDI SDK terms before shipping any NDI code |
| SRT | MPL-2.0 | Compatible |
| CEF/Chromium | BSD-style plus many third-party notices | Ship notices (OBS already does) |
| DSEG font (LED numerals) | SIL OFL-1.1 | Free to bundle and embed; keep the license file and reserved font name notice |
| Fonts, sounds, stock graphics | Per-asset | Use OFL/CC0 only; log sources |
| Scoreboard protocols | Vendor-specific; some documented | Do not imply vendor endorsement |
| Music in streams | Copyright; platform ContentID | Ship no music; warn that arena music may trigger claims |

## Compliance and rights

- **Streaming rights:** see R-08 in [06](06-risks.md). Research state association and district rules; tell users plainly; responsibility stays with the school.
- **Student data and minors:** local-first; no central collection; opt-in anonymous telemetry only. Being open source helps: districts can inspect exactly what is stored. Publish a one-page data-handling summary in the repo.
- **Security:** add a `SECURITY.md` with a private disclosure address. Stream keys and pairing codes are secrets (masked in logs and diagnostics bundles).
- **Accessibility:** schools sometimes ask for a VPAT; an open project can publish an accessibility statement instead.

## Support model (honest version)

No 24/7 support, no SLA, no support contract. Say so up front: "Built for volunteers, maintained by volunteers."

1. **Prevent:** preflight, recovery, slates, recording-first design.
2. **Self-serve:** in-app troubleshooting card, searchable docs, a 5-minute setup video, a printable game-night checklist (published as a PDF in the docs; the app itself cannot print).
3. **Diagnose:** one-click diagnostics bundle users can review and attach to a public issue.
4. **Community:** GitHub Issues and Discussions, plus a chat room. Students and other operators answer each other; label questions so answers become docs.
5. **Maintainer response:** best-effort, weekdays. No promise on game nights. Consider a pinned "what to do if it breaks mid-game" guide: use the phone as a backup recorder.

## Growth and community (replaces go-to-market)

- Launch with a strong README: a demo video, a "stream your first game in 15 minutes" guide, supported hardware, and honest limits.
- **Contributions that scale you:** sport profiles (football, volleyball, soccer, baseball), graphics themes, translations, scoreboard protocols, docs, test reports from real gyms. Label `good first issue` and `help wanted`; write a `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md`.
- Governance: you are the maintainer (benevolent-dictator model) until others earn commit rights; write that down.
- Reach users through broadcast teachers, athletic-director communities, and school tech forums (verify which are active); publish write-ups of real game nights.
- Do not compete with Hudl on cameras; interoperate (NDI where permitted, SRT, standard cameras).
