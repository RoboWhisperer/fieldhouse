# OBS setup

Fieldhouse uses [OBS Studio](https://obsproject.com) (free) to mix the cameras, add the score graphics, stream and record. Fieldhouse tells OBS what to do; OBS does the video work.

> **Checked with real OBS** (Studio 32.2.2, Flatpak, obs-websocket 5.7.4, on Linux): the setup below, switching, recording, streaming to a local test server, and instant replay. **Not verified:** native (non-Flatpak) Linux OBS, Windows and macOS.

## Connect

The easy way: in Fieldhouse, **Settings, Engine**, choose Launch OBS. Fieldhouse writes OBS's connection settings and starts OBS. Or turn it on yourself, as follows.

1. In OBS, choose Tools, then WebSocket Server Settings.
2. Tick "Enable WebSocket server".
3. Note the port (usually 4455). Set a password and note it.
4. In Fieldhouse, **Settings, Engine**, enter the address (`ws://127.0.0.1:4455`) and the password once.

If OBS is older than version 28, update it. WebSocket support is built in from version 28.

## What Fieldhouse creates inside OBS

| In OBS | What it is |
|--------|------------|
| Scenes `FH cam1` to `FH cam4` | One scene per source slot. The camera in slot 2 is shown by `FH cam2`. |
| `FH Overlay` | A browser source showing the score bug, lower thirds, slate and sponsor corner. It points at `http://127.0.0.1:8080/overlay` (1920x1080). |
| `FH Replay` | The scene used to play a replay |

Fieldhouse turns on OBS's Studio Mode so Preview and Program match the Live screen. It also creates a separate OBS profile named "Fieldhouse" and sets a 60 second replay buffer, so your own OBS profile is left alone. Setting up is repeatable: running it again does not create duplicates.

The score and clock overlay draws the clock as seven-segment digits on its own, because OBS's browser source has no web fonts.

## What not to touch

- Do not rename, delete or reorder scenes beginning with `FH`.
- Do not change the address of the `FH Overlay` browser source.
- Do not start or stop streaming or recording from OBS itself during a game; use Fieldhouse.
- Do not close OBS during a game. If you do, Fieldhouse reconnects, sets OBS up again and restores your cameras once OBS is back.

Your own scenes (without the `FH` prefix) are left alone.

## Repair

If something is missing or looks wrong, run the **Check** screen; it reports OBS problems with a Fix button. If that does not help, close the game night, delete only the `FH` scenes in OBS, and start the game night again so Fieldhouse recreates them.

## Flatpak or native OBS (Linux)

- **Native install:** works as described.
- **Flatpak:** OBS runs in a sandbox with its own private temporary folder and cannot see system folders. **Recording folders must be inside your home folder**; Fieldhouse refuses other folders and says so. When Fieldhouse starts a Flatpak OBS itself, it gives OBS access to the recording folder. If you start OBS yourself, you may need to grant that access (for example with Flatseal).

Windows and macOS users use the normal installer from obsproject.com. Neither has been verified with Fieldhouse yet.

## NDI

Fieldhouse does not include NDI. If you install an NDI plugin for OBS yourself, its sources can appear in OBS. Licensing for NDI is unresolved; see [THIRD_PARTY_LICENSES](../THIRD_PARTY_LICENSES.md).
