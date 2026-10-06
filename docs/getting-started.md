# Getting started

This page takes you from nothing to a first broadcast in about 15 minutes. Do the practice run in a quiet room, not on game night.

> **Beta notice.** Public installers do not exist yet. A Linux desktop build has been run; Windows and macOS builds have not been verified. Real USB cameras and real YouTube or Facebook streaming have not been verified either.

## What you need

- A laptop (the one you will use on game night).
- At least one camera, or none: Fieldhouse has a practice mode with a test picture.
- [OBS Studio](https://obsproject.com), free, installed on the same laptop. Fieldhouse uses it to mix the video and send it out. You can skip OBS for practice.
- An internet connection if you want to stream. Recording works without one.

## 1. Install

**When installers are released:** download the installer for your computer from the project's releases page, run it, and open Fieldhouse from the Start menu or Applications folder.

**For now (developers and testers):** install [Bun](https://bun.sh), download the project, then in a terminal in the project folder run `bun run demo`. Open `http://127.0.0.1:8080` in your browser. The demo fills the app with a sample venue, sponsors and games, all clearly sample data. Use `bun start` instead for an empty app.

## 2. First run

On first run Fieldhouse walks you through three short steps:

1. **Welcome:** what you will need. It says Fieldhouse is free and open source.
2. **Detect and test your first camera.** If no camera is found, you get the three most common fixes, or you can choose "skip, use test pattern".
3. **A 60-second practice broadcast** to a private test destination.

## 3. Connect OBS

Choose one of two ways, in **Settings, Engine**:

- **Launch OBS:** Fieldhouse sets up OBS's connection and starts OBS for you. This is the easiest.
- **Connect to OBS you opened yourself:** in OBS, choose Tools, then WebSocket Server Settings, tick "Enable WebSocket server", then type the password once in Fieldhouse.

Fieldhouse then sets up what it needs in OBS by itself (see [OBS setup](obs-setup.md)). The installed desktop app uses OBS by default. Running from source with `bun run demo` uses a practice engine with a test picture and no OBS.

> **Checked with OBS 32.2.2 (Flatpak) on Linux.** Native OBS on Linux, Windows and macOS have not been verified. If it does not connect, see [Troubleshooting](troubleshooting.md).

## 4. Connect a camera

Plug in a USB camera or capture card before you open the **Setup** screen. Fieldhouse lists what it finds under detected devices. Drag a device onto a source slot (1 to 4) and give it a name such as "Center court". One camera is fine. More detail: [Cameras and sources](cameras-and-sources.md).

## 5. Your first broadcast

1. On **Home**, press **Start game night**. (The first time, choose "Create your first game"; the sample game also works.)
2. **Setup, step 1:** enter the teams, colors, date and venue, and choose where to send the video (YouTube, Facebook, a custom address, or "Record only"). Choose "Record only" for practice. Continue to rosters; you can paste from a spreadsheet or use "Use numbers only".
3. **Setup, step 2:** put cameras in slots and press **Run checks**.
4. **Check:** every row should be green. Yellow rows can be accepted; red rows block **Go live** and have a Fix button. Fix them, then press **Go live**.
5. **Live:** press **Start broadcast**. Click a camera to put it in Preview, then **Cut** to send it to Program. Use the score buttons and clock on the right. Press **Mark moment** at an exciting play.
6. To finish, press and hold **End broadcast** for about a second and a half.
7. **Wrap-up:** find your recording, your marked moments and highlights.

Total: about 15 minutes the first time, less after that.

## Where things are saved

- The game, score and clock are saved as you go. If the app closes mid-game, reopen it and it brings the game back with a "We restored your game" banner.
- Recordings are saved in `Videos/Fieldhouse` in your home folder (installed app) or in the project's `data/recordings` folder (running from source). If you use Flatpak OBS, the recording folder must be inside your home folder.

## Next steps

- Print the [Game night checklist](game-night-checklist.md).
- Read [Streaming rights](streaming-rights.md) before streaming publicly.
