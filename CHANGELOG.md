# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
