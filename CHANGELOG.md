# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Customizable graphics (Graphics Studio screens, engine and API).** Every graphic is an editable document: the original four plus a full scoreboard, ticker, clock, lineup card and final card, each with colours, fonts, place, animation, show policy and parts you can change and reset. You can add your own HTML graphics, import CasparCG HTML templates (XML or JSON data, with field detection), share graphics as `.fhgfx` packs, show any web overlay as its own OBS layer, and drive Singular/UNO overlays, a CasparCG server (AMCP) or any HTTP system from Fieldhouse. The old graphics buttons and API work exactly as before. A font check measures what OBS can really draw. See `docs/graphics-authoring.md` and `docs/dev/graphics-api.md`.
- **Custom sport profiles.** The game engine is driven by data: periods, clock (down, up or none), scoring buttons, per-team counters with thresholds and resets, and set rules (win by 2, deciding set). Basketball, soccer, American football, volleyball and ice hockey are built in; profiles can be duplicated, edited, created, exported and imported through `/api/profiles`. Each game freezes its profile when it starts. Basketball behaves exactly as before (proved by a golden replay test against the old engine). Choose and edit profiles in Settings. See `docs/sport-profiles.md`.
- **Hands-off video engine.** Fieldhouse starts OBS itself (quiet settings written first, tray start, random websocket password kept in its own settings and never returned by the API), restarts it with backoff if it dies ("Restarting the video engine..."), says clearly when a broadcast was lost instead of restarting it, and closes the OBS it started when it quits. An OBS you started yourself is adopted and never closed. Stale crash markers are cleared before launch (a leftover marker made OBS 32 open a "Crash Detected" dialog).
- **Settings, Video and audio:** resolution, frame rate, video and audio bitrate, encoder (hardware encoders only when OBS lists them; automatic software fallback), recording format (MP4 or MKV), instant-replay length, and an audio input manager (add microphones and desktop sound, rename, device, gain, mute, meters). Saved in Fieldhouse settings and re-applied on every engine start; read back from OBS; locked where OBS cannot change them live.
- Per-source options on the Sources screen: picture size and frame rate (when the camera reports them), address (masked), retry and buffer for network sources, reconnect button.
- **No OBS dialogs:** stream destinations are checked (format, DNS, a real connection) before OBS is asked to stream; OBS reconnects quietly for a long time; OBS's own log is turned into plain notices and a redacted section of the diagnostics bundle.
- One-click **Install video engine** (winget, Homebrew, Flatpak, or the official download page) with progress and cancel.
- `scripts/obs-e2e-hands-off.ts`: end-to-end check of all of the above against a real OBS, with no manual OBS interaction (46 checks passed on the dev machine: cold start to provisioned in about 2.7 s, recovery after a kill in about 4.4 s, quit closes OBS in under a second, 1280x720 and 1920x1080 recordings confirmed with ffprobe, stream measured at about 4700 kbps for a 4500 kbps setting, reconnect 2 s after a local sink came back). `scripts/ui-video-e2e.ts` drives the new Settings pages in headless Chromium.

- **Automation.** Rules (when something happens, if a condition holds, do actions), macros (named action lists, buttons on the console), custom data fields, outgoing webhooks, API keys with roles for Companion and Stream Deck, and an event stream. See `docs/automation-guide.md` and `docs/dev/automation-api.md`.
- **Appearance and layout** settings: theme, accent, spacing, text size, reduced motion, console panel layouts, macro buttons and custom CSS.
- **Workspace export and import.** One versioned file with rules, macros, custom fields, webhooks, looks, layouts, graphics (with their files; connectors without tokens) and sport profiles. Import checks everything first, has a dry run, and can merge or replace. Secrets are never exported and a file that contains one is refused.

### Changed
- Resolution, frame rate and encoder changes no longer touch a running OBS (that crashed it in repeated tests): Fieldhouse writes the values into its OBS profile and restarts the OBS it started, showing "Applying video settings...". The profile is also written before every launch, so a restart always comes back with the saved settings.
- Copy no longer asks anyone to open, configure or understand OBS; Settings, Engine is now "Video engine".
- The Flatpak/Linux `--disable-shutdown-check` flag no longer exists in OBS 32; crash markers are removed instead.

### Not verified
- Singular/UNO only against mocks, a CasparCG server only against a fake AMCP server. A custom HTML graphic, the CasparCG example template and URL layers were verified on real OBS 32.2.2 (Flatpak).
- Windows and macOS (the file locations, launch flags and quit commands are unit-tested only), real USB cameras, a real one-click install, hardware encoders, desktops without a system tray.

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
