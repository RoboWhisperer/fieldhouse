# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [1.0.0-beta.1] - Unreleased

First beta. Nothing has been released yet and no public installers exist.

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

### Verified
On one Linux machine, OBS Studio 32.2.2 (Flatpak), obs-websocket 5.7.4: a scripted 28-step game night (`bun scripts/obs-e2e.ts`) and a click-through of the packaged desktop app. Streaming to a local RTMP server ran at about 4.4 to 4.7 Mbps with no dropped frames. The Linux AppImage, .deb and unpacked builds were run.

### Known limitations
- Windows and macOS builds, installers and file paths are not verified (build workflows exist but have never run). No code signing or notarization.
- Not verified: native (non-Flatpak) Linux OBS, real USB cameras, real YouTube or Facebook streaming, physical phones, Safari and iOS.
- The phone remote was verified with real network connections and automated tests, not on a physical phone.
- The update check has only been seen returning "no release" (the placeholder repository gives 404); automatic updates are not verified against a real feed.
- No OAuth sign-in to YouTube or Facebook; stream keys are pasted by hand.
- Flatpak OBS cannot see system folders, so recording folders must be inside the home folder.
- Basketball is the only sport profile.
