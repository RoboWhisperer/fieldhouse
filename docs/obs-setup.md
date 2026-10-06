# The video engine (OBS Studio)

Fieldhouse uses [OBS Studio](https://obsproject.com) (free, open source) as its video engine: it mixes the cameras, adds the score graphics, streams and records. **You never need to open OBS.** Fieldhouse starts it quietly in the background, keeps it running, restarts it if it stops, and closes it again when you quit Fieldhouse. Everything you might want to change (quality, recording format, replay length, audio, camera settings) is in Fieldhouse.

> **Checked with real OBS** (Studio 32.2.2, Flatpak, obs-websocket 5.7.4, on one Linux machine running KDE Plasma): starting OBS from nothing, restarting it after a crash, closing it on quit, leaving an OBS you started yourself alone, changing quality and reading it back, recording at 720p30 and 1080p30, audio inputs, streaming to a local test server, and instant replay. **Not verified:** Windows, macOS, native (non-Flatpak) Linux OBS, real USB cameras, and a desktop without a system tray (see "Does OBS ever show up?"). The one-click installer has been checked only as a practice run and with stand-in processes, not with a real download (see "Installing the video engine").

## What happens by itself

1. **Start.** When Fieldhouse starts and OBS is not running, it prepares OBS's settings (no first-run wizard, no update prompts, no "are you sure" boxes, window parked in the system tray), turns on OBS's remote-control connection with a random password that only Fieldhouse knows, and launches OBS.
2. **Setup.** Fieldhouse creates what it needs inside OBS (see below) and applies your quality settings.
3. **Restart.** If OBS stops (a crash, or someone closes it from the tray), Fieldhouse starts it again within a few seconds and shows "Restarting the video engine..." Cameras and settings come back. If a broadcast was running, Fieldhouse tells you clearly that it ended and **does not restart the broadcast by itself**; press Start broadcast when you are ready. After five failed attempts in a row it stops trying and shows a Try again button in **Settings, Video engine**.
4. **Quit.** When you quit Fieldhouse it finishes the recording, then closes the OBS it started.

### If OBS was already open

If you were already running OBS when Fieldhouse started, Fieldhouse **adopts** it: it connects with the WebSocket password you give it (Settings, Video engine, "Use an OBS you run yourself") and never hides or closes your OBS. Fieldhouse only ever closes an OBS that Fieldhouse itself started. If your OBS has its WebSocket server turned off, Fieldhouse says so and waits for you to close it; it will not touch it.

### How settings are applied (and why)

Changing the picture size, frame rate or encoder inside a *running* OBS turned out to be unsafe: on OBS 32.2.2 it intermittently crashed OBS, froze it for minutes, or timed out. So Fieldhouse never does that. For those three settings it shows "Applying video settings...", closes the OBS it started (cleanly, after any recording has finished), writes the new values into its own OBS profile, and starts OBS again, which takes a few seconds. Bitrate, recording format and replay length are applied without a restart. The same saved values are written into the profile every time Fieldhouse starts OBS, so a crash or restart always comes back with your settings. If OBS was started by you rather than by Fieldhouse, Fieldhouse will not restart it and says so; close it and let Fieldhouse start its own.

## Installing the video engine

If OBS is not installed, Fieldhouse offers **Install video engine** (during first-time setup and in Settings, Video engine). It uses what your computer already has:

| Computer | Command Fieldhouse runs |
|----------|-------------------------|
| Windows | `winget install -e --id OBSProject.OBSStudio --silent --accept-package-agreements --accept-source-agreements` |
| macOS with Homebrew | `brew install --cask obs` |
| Linux with Flatpak | `flatpak install --user -y --noninteractive flathub com.obsproject.Studio` (after adding the Flathub source for your user if it is missing) |
| Anything else | Opens the official download page |

Progress is shown while it runs, you can cancel, and when it finishes Fieldhouse starts the engine and carries on. Failures are explained in plain words.

> **What was and was not tested:** command building, progress parsing, failure messages, cancel, and the "installed it?" check are unit-tested with stand-in processes, and the flow was exercised end to end with a built-in practice run that installs nothing. **A real winget, Homebrew or Flatpak installation has not been run**, because OBS was already installed on the test machine. Treat the first real use as untested.

## What Fieldhouse creates inside OBS

| In OBS | What it is |
|--------|------------|
| Profile `Fieldhouse` | Fieldhouse's own settings (size, bitrate, replay buffer, reconnect rules). Your own profiles are left alone. |
| Scenes `FH cam1` to `FH cam4` | One scene per source slot. The camera in slot 2 is shown by `FH cam2`. |
| `FH Overlay` | A browser source showing the score bug, lower thirds, slate and sponsor corner. It points at Fieldhouse's own page (1920x1080). |
| `FH Replay` | The scene used to play a replay |
| `FH Mic`, `FH Mic 2`, `FH Desktop`... | Audio inputs. The names you see in Fieldhouse ("Commentary mic") are kept by Fieldhouse. |

Fieldhouse turns on OBS's Studio Mode so Preview and Program match the Live screen. Setting up is repeatable: running it again (Settings, Video engine, Repair) does not create duplicates.

## If you ever do want to open OBS

It is safe. Fieldhouse uses its own profile (`Fieldhouse`) and scenes whose names start with `FH`, so your own profiles, scenes and sources are never modified. Opening OBS's window (from the tray icon, or after quitting Fieldhouse) does not break anything. Please do not, during a game: rename, delete or reorder the `FH` scenes; change the address of `FH Overlay`; or start/stop streaming or recording from OBS (use Fieldhouse). Changes you make in OBS to the settings Fieldhouse manages (size, frame rate, bitrate, encoder, recording format, replay length) are put back to what Fieldhouse has saved the next time the engine starts or you press Repair.

## Does OBS ever show up?

Fieldhouse makes OBS start hidden in the system tray and turns off its first-run wizard, update checks, confirmation boxes, statistics window, crash prompt and missing-files prompt. On the test machine (KDE Plasma on Wayland), the desktop reported **no OBS window** after a cold start, after an automatic restart, and while a stream was reconnecting. Things that could still show a window:

- **A desktop with no system tray** (for example stock GNOME): OBS may show its window or a taskbar entry. Install a tray extension, or just minimize it.
- **A crash while OBS has a dialog open**, or a very different OBS version from the one tested.
- **Windows and macOS:** the equivalent settings and launch flags (`--minimize-to-tray`, `open -g -j`, per-OS file locations) are written and unit-tested but have never been run on those systems.
- Plug-ins you installed yourself can show their own windows.

Fieldhouse also checks a stream address (it must answer a real connection) **before** asking OBS to stream, so OBS's "Failed to connect to server" box does not appear. Problems OBS only mentions in its own log (a disk that is full, an encoder that failed, a camera that vanished, a file that cannot be opened) show up in Fieldhouse as plain notices, never as raw OBS text.

## Video and audio settings

In **Settings, Video and audio**: resolution (720p or 1080p; the canvas stays 1080p), frame rate (30 or 60), video bitrate (2500, 4500, 6000, 8000 or custom 1000 to 20000 kbps), audio bitrate, encoder, recording format (MP4 or MKV; both survive a crash), and how much instant replay keeps (30 s, 60 s, 2 min). Fieldhouse saves them, applies them to OBS and shows what OBS reports. They are applied again every time the engine (re)starts. During a broadcast, resolution, frame rate and encoder are locked (OBS cannot change them live); the other choices are saved and used after the broadcast.

**Encoder:** "Automatic" is software (x264) unless you stream 1080p at 60 fps and a hardware encoder exists. Hardware encoders (NVIDIA, Intel QuickSync, AMD, Apple) are listed only if OBS itself lists them in its start-up log. If a chosen hardware encoder fails, Fieldhouse switches to software by itself and tells you. VAAPI (Linux) is not offered because OBS's simple output mode cannot select it. Hardware encoding was not exercised (only the detection was).

**Audio:** add microphones and "desktop / room sound", name them, choose the device, set gain, mute, and watch live meters. Only inputs Fieldhouse created can be renamed or removed.

**Cameras:** on the Sources screen, the gear on a slot shows picture size and frame rate for a USB or capture-card camera when the engine reports choices, and the address (without keys), retry time and buffer size for a network stream, plus a reconnect button. Network and file sources were checked with real OBS; **real USB cameras were not**.

## Flatpak or native OBS (Linux)

- **Native install:** works as described (not verified).
- **Flatpak:** OBS runs in a sandbox with its own private temporary folder and cannot see system folders. **Recording folders must be inside your home folder**; Fieldhouse refuses other folders and says so. When Fieldhouse starts a Flatpak OBS itself, it gives OBS access to the recording folder. If you start OBS yourself, you may need to grant that access (for example with Flatseal).

## NDI

Fieldhouse does not include NDI. If you install an NDI plugin for OBS yourself, its sources can appear. Licensing for NDI is unresolved; see [THIRD_PARTY_LICENSES](../THIRD_PARTY_LICENSES.md).
