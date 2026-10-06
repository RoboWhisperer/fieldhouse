# Remote access: phones and computers

Another person can help from their own device on the gym Wi-Fi. A scorekeeper can keep the score and clock from a phone, and a producer can run the video from a second computer. Nothing is installed on the other device: it opens a web page.

> **Built, not yet tried on a physical phone or a second computer.** Pairing, the code limits, the roles and the second network listener were checked with automated tests and real network connections between programs on one computer. Safari and iOS have not been verified. Try it with your own devices before game night.

## Connect a phone or computer

1. The other device and the laptop running Fieldhouse must be on the same Wi-Fi. The gym's guest Wi-Fi sometimes blocks devices from seeing each other; a school staff network or a small travel router you bring may be needed.
2. On the laptop, open **Settings, Remote access** and turn on **Allow phones and computers on this network**.
3. A QR code, a short pairing code and one or more addresses appear. On a phone, scan the QR code with the camera. On a computer, open the address shown (it ends in `/remote`) and type the pairing code.
4. Type your name so the person at the console knows who is connected, then press **Connect**.
5. A "phone connected" chip appears on the **Live** screen. In **Settings, Remote access** the device appears with its role.

The page works on a phone (portrait or landscape) and on a laptop or desktop browser.

## Roles: what each device can do

The person at the console chooses a role for every device. A new device starts as **Score**. A device can never promote itself, and the console can change a role or disconnect a device at any time; it takes effect at once, without reloading the page.

| | Score | Score + marks | Producer |
|---|:---:|:---:|:---:|
| Start, stop and set the clock; change period | yes | yes | yes |
| Score, fouls, timeouts, undo | yes | yes | yes |
| Mark a moment for the replay list | no | yes | yes |
| See camera pictures (preview, program, sources) | no | no | yes |
| Cut and fade, choose the preview camera | no | no | yes |
| Instant replay | no | no | yes |
| Score bug, lower thirds, slate | no | no | yes |
| Mute audio channels | no | no | yes |
| Fire, skip or delay a sponsor break | no | no | yes |
| Start or stop the broadcast | no | no | only if you allow it (see below) |
| Change settings, destinations, games, sponsors, rosters, recordings, storage | never | never | never |
| See stream keys, stream addresses, file paths, the pairing code | never | never | never |
| Watch recordings or load the OBS overlay | never | never | never |

The **Producer** role is for a second person at a second computer who runs the show: the page has the preview and program pictures, camera tiles, Cut and Fade, Replay, graphics, audio mutes, the next sponsor break, and the same score and clock controls as the scorekeeper page.

### Starting and stopping the broadcast

By default a Producer cannot start or stop the broadcast; that stays on the laptop. If you trust everyone on the network, turn on **Producer devices can start and stop the broadcast** in **Settings, Remote access**. Even then, stopping needs the button to be held for 1.5 seconds so a stray click cannot end the stream and recording.

### The lock

**Lock the remote now** pauses every change from every remote device (for example during a replay or a break). Devices see "The console has locked the remote". Pictures keep updating while it is locked.

## Keyboard shortcuts (computers)

Press **?** on the page to see them. They do nothing while you are typing in a box.

| Key | Does |
|-----|------|
| C | Start or stop the clock |
| Q, W, E | Home +1, +2, +3 |
| I, O, P | Away +1, +2, +3 |
| Ctrl+Z | Undo the last change |
| M | Mark a moment (Score + marks and Producer) |
| Enter, Shift+Enter | Cut, Fade (Producer) |
| 1 to 4 | Put camera 1 to 4 in preview (Producer) |
| R | Replay (Producer) |

If the console and a remote device both change the score, the last change wins and the remote device sees a "Console changed score" message.

## Safety: use a trusted network

- **The connection is plain HTTP.** On an open or shared Wi-Fi network, someone nearby could copy a device's access. Use a password-protected network (WPA2 or WPA3) and do not use it on public Wi-Fi.
- **A Producer device can drive your live broadcast** (cameras, graphics, sponsors, and the stream itself if you allow it). Give the Producer role only to people and devices you trust.
- The other devices connect through a separate listener that exists only when you turn it on in **Settings, Remote access**. Turn it off after the game if you like. Pairing codes are limited in how often they can be tried, and each paired device gets its own access token.
- By default Fieldhouse answers only on the laptop itself. **Only allow devices on this Wi-Fi network** refuses addresses outside a private network, and **Require the pairing code** (on by default) needs the code. Keep both on.
- Anyone on the same Wi-Fi who has the code can connect as a Score device. Do not share the code in public chat or on screen. Use **New code** between games.
- Do not forward ports on a router or put the laptop on the open internet.
- If a device disconnects, its buttons turn off and it reconnects by itself. Taps are never saved for later.

## If a computer or phone cannot connect

See [Troubleshooting](troubleshooting.md#my-phone-or-computer-cannot-connect).
