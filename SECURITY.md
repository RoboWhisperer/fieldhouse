# Security policy

## Supported versions

Fieldhouse has not had a public release yet. Once there is one, only the latest release receives security fixes.

| Version | Supported |
|---------|-----------|
| 1.0.0-beta.x (unreleased) | Yes, when released |

## Reporting a problem privately

Please do not open a public issue for a security problem.

Send a report to: **[maintainer contact: to be set before first public release]**
(When the repository is public, GitHub's private vulnerability reporting may be turned on instead; this file will say so.)

Include what you found, how to reproduce it, and the version. Do not include real stream keys or student data.

## What to expect

Fieldhouse is maintained by volunteers. We will try to acknowledge a report within about a week and to fix serious problems promptly, but these are best-effort goals, not promises. We will credit you if you want.

## What is in scope

- **Remote access (phones and computers), roles and the LAN listener:** the roles are Score, Score + marks and Producer; anything that lets a device do more than its role allows, promote itself, read settings, stream keys, stream addresses, file paths or the pairing code, reach recordings or the OBS overlay, start or stop a broadcast without the `producerCanBroadcast` setting, or keep working after being revoked or locked. The threat model: the phone-only listener is plain HTTP on the local network, so anyone who can read traffic on that network can copy a device's token (use WPA2/3), and a Producer device on the LAN can drive the live broadcast (cameras, graphics, sponsors, and the stream if allowed). The console itself only answers on this computer.
- **Phone remote and LAN pairing:** getting control of the game clock, score or graphics without the pairing code; guessing or bypassing the code; the server answering on the network when it is set to local only. By default the operator console listens on this computer only and refuses requests whose Host is not localhost, 127.0.0.1 or [::1] (a guard against DNS rebinding). The phone surface is a separate listener that exists only when enabled in Settings > Remote and requires the pairing code. It was checked with automated tests and real sockets, not on a physical phone (see [docs/scorekeeper-phone-remote.md](docs/scorekeeper-phone-remote.md)).
- **Local API** (`/api` and `/ws`): anything that lets a web page the operator visits, or another program, change game state, start or stop a broadcast, or read stream keys. The API is designed never to return stream keys.
- **Update check** (against the GitHub Releases page; the only network use besides streaming and destinations you set up): anything that lets an attacker make the app download or run something unintended, or that sends more information than the app says it does.
- **Diagnostics bundle:** secrets (stream keys, pairing codes) appearing in it.
- **Recording and file handling:** path tricks that read or delete files outside the Fieldhouse folders.

## Out of scope

- Problems in OBS Studio, FFmpeg, Bun, Electron or other third-party software: report those to their projects.
- Windows and macOS builds have not been verified, so findings there are welcome but not yet covered by any testing.
- Anyone with physical or administrator access to the computer.
- Operators who deliberately expose the server to the public internet.
- Findings with no realistic impact on a school gym network.
