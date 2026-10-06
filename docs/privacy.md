# Privacy

Fieldhouse works on your own computer. It has no accounts and no cloud service.

## What is stored, and where

| What | Where |
|------|-------|
| Games, teams, rosters, scores, event log, sponsors, settings, airings | `fieldhouse.db` in the data folder: Linux `~/.local/share/fieldhouse`, macOS `~/Library/Application Support/Fieldhouse`, Windows `%APPDATA%\Fieldhouse`. Running from source uses the project's `data/` folder |
| Logs | `logs` inside the data folder (they rotate) |
| Daily database backups | `backups` inside the data folder |
| Recordings and exported highlights | `~/Videos/Fieldhouse` (installed app); `data/recordings` from source |
| Stream keys | On this computer, shown masked; not included in diagnostics bundles |

> **Unverified:** how stream keys are stored on disk (encrypted or not) has not been audited. Treat the data folder as sensitive.

## What leaves the computer

Nothing, unless you:

- **Stream:** video and sound go to the site you chose.
- **Export** a file and share it.
- **Attach** a diagnostics bundle to a public bug report. Read it first.

## Telemetry

There is none. No code in Fieldhouse sends usage or crash data anywhere.

## Update check

The only network use besides streaming and the destinations you set up is an optional update check. It asks the GitHub Releases page for the latest version number and sends no game data. So far it has only been seen answering "no release found". Automatic updates are not verified.

## Windows and macOS locations

The Windows and macOS folders above come from the design and have not been checked on those systems.

## Student information

Rosters may contain students' names and numbers. They stay on this computer unless you stream or export them. Use first names or numbers only if your school prefers. Check your school's policy on student images and names before you stream; Fieldhouse does not give legal guidance. You can delete a game's recordings from the app, and the whole data folder can be removed by deleting it.
