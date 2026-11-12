# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Resizable panels** — every panel in the management views and the live console has a bottom-right drag handle. Panels resize with the mouse, touch or the keyboard (arrow keys, Shift for bigger steps), stay inside their parent column and above the panel below, remember their size per view, and reset on double-click or Home.
- **Production package import** — a zipped NoaCG Studio/SPX export with several template folders is recognised as one package. Every template becomes its own CasparCG graphic with its declared layer, field labels, types and default values. Long-text fields stay multiline in the editor and on remote controls.
- **Graphics remote role** — a new Graphics role controls only what is on air: the built-in scorebug, halftime card and player lower third, plus the fields of every enabled custom graphic. It cannot score, change cameras or audio, fire sponsors, or start and stop the broadcast.
- **Producer remote graphics editor** — a Producer device now lists every enabled custom graphic with all of its data fields (text, multiline text, number, color, image, yes/no), its current values, and Show, Update, Hide and Next controls. Built-in scorebug, halftime card and lower-third controls stay in the Graphics panel, and the scoring panel keeps the clock, team points, fouls and timeouts.

### Fixed
- The **Producer** role now appears in the remote permissions menu instead of being hidden under Admin, so the graphics operator can be assigned directly.
- Desktop Graphics view previews now render. The Electron CSP lets the app frame `/overlay` and run its inline bootstrap script, while `/gfx` pages keep the sidecar's sandboxed CSP.

## [1.1.1] - 2026-11-04

### Added
- **Delete games safely** — Home and the new All games screen can remove upcoming or final games. Deletion removes the event log, sponsor airings and health history, clears the active game if needed, and writes an audit entry. Recordings are kept by default; `DELETE /api/games/:id` with `{"deleteRecordings":true}` removes them too. Live games must be finished first.
- **Audit trail** — operator changes to games, broadcasts, recordings, destinations, sponsors, settings, exports, resets, remote pairing, devices and API keys are recorded in an append-only local log, capped at the 10,000 most recent entries. See Settings > Audit and data or `GET /api/audit`.
- **Service health** — `GET /api/health` reports app version, uptime, database schema, engine connection, live/recording state, disk space and the active game, without secrets.
- **Data export** — Settings > Audit and data downloads a portable JSON export of games, events, venues, sponsors, profiles, automation, recordings metadata and the audit log. Stream keys, passwords, remote codes, device token hashes, webhook secrets and HTTP header values are removed.
- **API security headers** — responses now send `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Cross-Origin-Resource-Policy`, a frame-ancestors CSP and `no-store` on JSON.

### Changed
- The all-games screen can open a scheduled game for editing by id, and links finished games to their proof-of-play report.
- Version bumped to 1.1.1 across the app, the desktop shell and the root package.

### Fixed
- Release builds install ffmpeg before running tests, and the auto-highlights test skips cleanly when ffmpeg is unavailable.
- The release test step times out instead of hanging on the Bun 1.4.2 Windows crash, so the installers can still be built.

## [1.1.0] - 2026-10-31

### Added
- **Clear all data and rerun the setup wizard** — Settings > About > Reset deletes every game, venue, sponsor, destination, setting and recording on this computer, clears the onboarding flag, and relaunches the setup wizard as if this were a fresh install. Refused while a broadcast is active.
- **Auto-highlights** — `POST /api/games/:id/auto-highlights` assembles every scored and marked moment into a single highlights file (pre-roll / post-roll, overlapping clips merged, exported via ffmpeg to `<storageDir>/highlights/`). See `docs/replay-and-highlights.md`.
- **Stat / play-by-play ingest** — `POST /api/games/:id/stats` accepts a coach/scorekeeper CSV (`type,team,points,player,note`) and appends each row to the game's event log so it appears in the score bug, replay and highlights. See `docs/stats-scoring.md`.
- **Minimum machine spec** — documented recommended CPU/RAM/GPU/storage/network for running a full game. See `docs/minimum-machine-spec.md`.

### Changed
- The event log now reloads whenever data changes, so imported stats and in-game events show up immediately in `GET /log`.
- Version bumped to 1.1.0 across the app, the desktop shell and the root package.
- Desktop dependencies updated: Electron 44.5.1 → 45.2.1, electron-builder 26.15.3 → 26.18.0, electron-updater 6.8.9 → 6.8.11.

### Not verified
- Simultaneous streaming to more than one destination (OBS obs-websocket supports one active stream; second destination requires Advanced Output mode).
- Windows and macOS installers are built but have not been verified on real hardware.

## [1.0.0-beta.1] - 2026-10-05

First public beta. The installers are not code-signed, so Windows SmartScreen and macOS Gatekeeper will warn when you open them (see Known limitations).

### Added
- Local app (Bun server plus browser UI) with the screens Home, Start game night, Setup, Check, Live, Wrap-up, Sponsors, Reports and Settings.
- Game state kept as an append-only event log in SQLite, so score and clock come back after a crash (checked by killing the app mid-game).
- Basketball sport profile (periods, period length, overtime, bonus fouls, timeouts), editable in Settings.
- Real OBS control over obs-websocket v5 (Settings > Engine, or Launch OBS mode, which writes the websocket settings and starts OBS). Fieldhouse sets OBS up repeatably: scenes `FH cam1` to `FH cam4` and `FH Replay`, a shared browser source `FH Overlay`, Studio Mode, a separate OBS profile named "Fieldhouse", and a 60 second replay buffer. It reconnects and sets up again by itself if OBS is closed and reopened.
- Network and file sources (srt, rtmp, rtsp, http, file) in source slots; cut and fade; live audio meters.
- Score bug, lower thirds, slate and sponsor corner overlay. The clock is drawn as SVG seven-segment digits because OBS's browser source has no web fonts.
- Real recording to `~/Videos/Fieldhouse` (hybrid MP4 by default), playable in the app with seeking; streaming to an RTMP server.
- Instant replay: goes on air about 2 seconds after the click, plays the last N seconds, then returns to the camera.
- Sponsor library with rules, break planner, and proof-of-play log with CSV export.
- Preflight check; highlight export (H.264/AAC MP4); diagnostics bundle and history chart.
- Retention policy, daily database backups, rotating logs.
- Phone remote: pairing code, rate limiting, hashed device tokens, role limits, QR code, and a separate network listener that exists only when enabled in Settings > Remote.
- Update check against the GitHub Releases page.
- Desktop app: Electron with a compiled Bun program.
- Demo engine (`ENGINE=fake`, `bun run demo`) that records a test pattern.
- Operator console refuses requests whose Host is not localhost, 127.0.0.1 or [::1].
- Documentation in `docs/`, community and legal files.
- Continuous integration on Linux, Windows and macOS (tests plus a compiled-server smoke test).
- Remote access from other computers as well as phones: the remote page now has a desktop layout (two columns, hover and focus states, keyboard shortcuts with a `?` help dialog) and a pairing screen that fits a laptop.
- New device role **Producer**: camera pictures, cut and fade, preview, replay, graphics, audio mutes and sponsor breaks from another computer, with the scorekeeper controls beside them. Enforced on the server. Still no settings, destinations, recordings, stream keys or file paths.
- Setting `remote.producerCanBroadcast` (off by default) lets a Producer start and stop the broadcast; stopping needs a 1.5 second hold.
- Settings > Remote is now "Remote access": three role choices per device, the broadcast switch and a trusted-network warning. The role can be changed while a device is connected and takes effect at once.

### Verified
On one Linux machine, OBS Studio 32.2.2 (Flatpak), obs-websocket 5.7.4: a scripted 28-step game night (`bun scripts/obs-e2e.ts`) and a click-through of the packaged desktop app. Streaming to a local RTMP server ran at about 4.4 to 4.7 Mbps with no dropped frames. The Linux AppImage, .deb and unpacked builds were run.

### Known limitations
- Windows and macOS: the tests and the compiled server pass in CI on those systems, but the installed apps, installers and OBS file locations have not been run or tried by hand. The installers are not code-signed or notarized.
- Not verified: native (non-Flatpak) Linux OBS, real USB cameras, real YouTube or Facebook streaming, physical phones, Safari and iOS.
- The phone remote was verified with real network connections and automated tests, not on a physical phone.
- The update check had only ever seen "no release" before this release existed; automatic updates are not verified against a real feed.
- No OAuth sign-in to YouTube or Facebook; stream keys are pasted by hand.
- Flatpak OBS cannot see system folders, so recording folders must be inside the home folder.
- Basketball is the only sport profile.
