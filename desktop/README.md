# Fieldhouse desktop app

Electron shell + the Bun server compiled to a standalone binary and run as a **sidecar** child process.
The shell is deliberately thin (`main.js` ~300 lines, no product logic) so it can be swapped for Tauri later:
anything that can spawn `fieldhouse-server`, read its `FIELDHOUSE_READY {"port":N}` stdout line and show
`http://127.0.0.1:N` in a webview is a valid shell.

## How it runs

1. `main.js` takes the single-instance lock, spawns the sidecar with `FIELDHOUSE_PACKAGED=1 PORT=0 HOST=127.0.0.1`
   and `FIELDHOUSE_WEB/ASSETS/OVERLAY` pointing at the staged files in `resources/server/`.
2. It reads the `FIELDHOUSE_READY` line for the port, waits for `GET /api/state`, then opens the window.
3. A crashed sidecar is restarted with backoff (max 5 in 60 s, then an error page with "Show logs").
4. Data: `~/.local/share/fieldhouse` (Linux), `~/Library/Application Support/Fieldhouse` (macOS), `%APPDATA%\Fieldhouse` (Windows).
   Logs are in `logs/` there (`sidecar.log`, `desktop.log`). Recordings go to `~/Videos/Fieldhouse`.
5. Closing the window quits, except while a stream or recording is live (then it hides to the tray; macOS always hides).
   Quitting mid-broadcast asks for confirmation. The display is kept awake while live.
6. Quit sends SIGTERM to the sidecar and waits 5 s before killing it. (Windows has no signals: it is terminated
   directly; SQLite's WAL keeps the database consistent, but recorders get no chance to finalise a file.)

Security: contextIsolation + sandbox, no node integration, navigation locked to the app origin, external links open
in the system browser, permission requests denied except clipboard write and fullscreen, CSP set for the app origin.
The preload exposes only `version, platform, openDataFolder, openLogs, updateState, checkForUpdates`. No telemetry.

## Develop

```sh
bun run desktop:install     # npm install in desktop/ (electron, electron-builder, electron-updater)
bun run desktop:dev         # uses desktop/build/server-<arch>/ if present, else `bun src/server.ts`
```

Dev data goes to the real OS data dir; set `FIELDHOUSE_HOME=/tmp/fh` to keep it separate.

## Build

```sh
bun run desktop:sidecar     # compile src/server.ts -> desktop/build/server-<arch>/ (+ web/, assets/, overlay.html)
bun scripts/smoke-sidecar.ts  # start the binary standalone, check API/UI/assets, SIGTERM => exit 0
bun run desktop:pack        # unpacked app in desktop/dist/ (fast check)
bun run desktop:build       # installers for the current OS
```

Cross-compiling the sidecar: `bun scripts/build-sidecar.ts bun-windows-x64|bun-darwin-arm64|bun-darwin-x64|bun-linux-x64`.
Installers still have to be built on their own OS (the release workflow does this). Targets: Linux AppImage + deb,
Windows NSIS (x64, per-user, shortcuts), macOS dmg + zip (arm64 + x64, hardened runtime).
The icon is `build/icon.svg`, rendered to `build/icon.png` with headless Chromium (see git history / task notes);
electron-builder derives `.ico` and `.icns`.

Linux AppImage needs unprivileged user namespaces for the Chromium sandbox (default on most distros); if your
system blocks them run it with `--no-sandbox`. Not needed on the machine this was built on.

## Release

1. Bump `version` in `desktop/package.json` (and root if you keep them in step), commit, tag `vX.Y.Z`, push the tag.
2. `.github/workflows/release.yml` builds per OS, signs when secrets exist, and creates a **draft** GitHub Release
   with installers, `latest*.yml` update metadata and `SHA256SUMS`. Try the installers, then publish the draft.

### Signing (secrets only, nothing in the repo)

| Secret | Use |
|---|---|
| `CSC_LINK`, `CSC_KEY_PASSWORD` | macOS Developer ID certificate (.p12, base64 or URL) |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | notarization (turned on automatically when `APPLE_ID` and `CSC_LINK` are set) |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Windows code-signing certificate (.pfx) |

Without them builds are unsigned: Windows SmartScreen and macOS Gatekeeper will warn. Review
`build/entitlements.mac.plist` (placeholder) before the first signed release.

## Auto-update

`electron-updater` with the GitHub provider; owner/repo come from `repository` in `desktop/package.json`
(currently `github.com/RoboWhisperer/fieldhouse`). Enabled only when packaged and
`FIELDHOUSE_NO_UPDATE` is unset. It checks 30 s after start and every 6 h, downloads only when no broadcast is live,
never installs by itself, and shows "Update ready, restart when the game is over" in Help (plus a notification).
Restart-to-update is refused while live. **Untested against a real release feed**; macOS auto-update additionally
requires a signed app, and the Linux deb does not self-update (AppImage does).
