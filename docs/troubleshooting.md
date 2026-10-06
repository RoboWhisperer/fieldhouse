# Troubleshooting

Find your symptom, check the likely cause, try the fix. If nothing works, export a diagnostics bundle (**Settings, Diagnostics**), read it, and report a bug.

> Recordings keep going when other things fail. Don't panic.

## My phone or computer cannot connect

| Cause | Fix |
|-------|-----|
| Remote access is off | On the laptop, open **Settings, Remote access** and turn on **Allow phones and computers on this network**. It is off by default |
| Different Wi-Fi networks | The device and the laptop must be on the same network. Phone data (4G/5G) will not work. Use the address shown in Settings |
| The Wi-Fi isolates devices | Guest Wi-Fi often blocks devices from seeing each other. Use a staff network, or bring a small router and connect both to it |
| Wrong address | Use the address listed in **Settings, Remote access** (it ends in `/remote`), not `localhost`. If the laptop shows several addresses, try the one on the same Wi-Fi |
| A firewall blocks the port | Allow Fieldhouse through the laptop's firewall (Windows asks the first time; on macOS and Linux check the firewall settings). The port is shown in Settings |
| The port was busy | Settings shows which port is used instead. Open that address |
| "Too many wrong tries" | Wait the time shown (5 minutes). Check the code on the laptop; **New code** gives a fresh one |
| "This remote only works on the same Wi-Fi network" | Your router uses unusual addresses. Turn off **Only allow devices on this Wi-Fi network** only if you understand the risk |
| The page shows "Not allowed" | The device does not have the role for that. The console can change the role in **Settings, Remote access** |
| "The console has locked the remote" | The console turned the lock on. Ask the person at the laptop to turn it off |
| "This device was removed" | The console disconnected it. Enter the code to connect again |

## Stream drops or stutters

| Cause | Fix |
|-------|-----|
| Weak or crowded Wi-Fi | Plug the laptop into the network with a cable; turn off other devices' video |
| Upload too slow for the picture | Lower resolution to 1280x720, 30 fps |
| Wrong or expired stream key | Get a fresh key from the site and update the destination (Facebook keys expire quickly) |
| Laptop overloaded | Close other programs; use fewer cameras |
| The site had a problem | Fieldhouse retries by itself; watch the "Reconnecting..." message; the recording is safe |

## Camera missing

| Cause | Fix |
|-------|-----|
| Cable loose or unplugged | Reseat it; press Reconnect on the grey tile |
| Another program is using the camera | Close video-call and camera apps |
| Too many devices on one USB port | Move the camera to a different port, directly into the laptop |
| Camera went to sleep | Turn off auto power-off in the camera |
| Using OBS in Flatpak form | Give OBS permission to use the camera ([OBS setup](obs-setup.md)) |

While a source is down, a "Technical difficulties" slate shows and the picture returns when the camera does.

## No audio

| Cause | Fix |
|-------|-----|
| Source muted | Check the mute buttons in the audio mixer |
| Wrong microphone chosen | Pick the right input in the source's audio setting |
| Level too low or too high | Watch the meters; adjust gain until peaks stay in the upper-middle of the meter |
| System volume at zero | Raise the laptop's volume |

## Clock wrong

| Cause | Fix |
|-------|-----|
| Clock was started late or stopped late | Use ±1 second nudges, or set the clock directly |
| Wrong period | Change the period selector |
| Score wrong | Use Undo (Ctrl+Z) for the last change or correct it with the score buttons |
| Phone and console disagree | The last change wins; agree on who has control |

## App crashed mid-game

| Step | What to do |
|------|-----------|
| 1 | Reopen Fieldhouse. |
| 2 | A banner says "We restored your game" with period, clock and score. |
| 3 | Check the clock against the real scoreboard. |
| 4 | Check that recording and streaming are running; restart them if not. |
| 5 | A new recording file starts if the old one was cut; both are kept. |

> **Checked:** killing the app mid-game and restarting restored score and clock with a banner, and closing then reopening OBS was handled by Fieldhouse. Power loss and Windows or macOS have not been tested.

## Disk full

| Cause | Fix |
|-------|-----|
| Old recordings | Settings, Storage: delete old games (you type the game name to confirm) |
| Recording folder refused (Flatpak OBS) | Choose a folder inside your home folder |
| Not enough room for the game | Copy older recordings to another drive first |
| Warning on the Live screen | It tells you how many minutes remain. Free space now |

## Stream will not connect

| Cause | Fix |
|-------|-----|
| OBS shows a "Failed to connect to server" box | This is OBS's own message and cannot be hidden. Fieldhouse also shows its own message. Close the OBS box, then check below |
| Wrong server address or key | Copy them again from the site |
| No internet | Check the connection; recording still works |
| Key expired (Facebook) | Get a new key |

## OBS will not connect

| Cause | Fix |
|-------|-----|
| OBS not open | Open it |
| WebSocket server off | Tools, WebSocket Server Settings: enable |
| Wrong password or port | Re-enter them in Fieldhouse Settings |
| Old OBS | Update to version 28 or later |
| OBS closed and reopened | Fieldhouse reconnects and sets OBS up again by itself; wait a few seconds |
