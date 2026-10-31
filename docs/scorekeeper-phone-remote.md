# Remote access: phones and computers

Another person can help from their own device on the same local network. The Fieldhouse computer runs the app and OBS; phones and computers connect over Wi-Fi/WLAN or Ethernet in a browser. Nothing is installed on the client.

> **Built, not yet tried on a physical phone or a second computer.** Pairing, the code limits, the roles and the second network listener were checked with automated tests and real network connections between programs on one computer. Safari and iOS have not been verified. Try it with your own devices before game night.

## Connect a phone or computer

1. The other device and the computer running Fieldhouse/OBS must be on the same Wi-Fi/WLAN or Ethernet LAN. Wi-Fi works without an Ethernet cable. Guest Wi-Fi can isolate clients and prevent device-to-device connections; use a staff network or a travel router if that happens. Keep the computer awake and allow Fieldhouse through its local network firewall.
2. On the laptop, open **Settings, Remote access** and turn on **Allow phones and computers on this network**.
3. A QR code, a short pairing code and one or more addresses appear. Wi-Fi addresses are listed first when the operating system identifies the adapter. On a phone, scan the QR code. On a computer, open an address on the same local network (it ends in `/remote`) and type the pairing code.
4. Type your name so the person at the console knows who is connected, then press **Connect**.
5. A "phone connected" chip appears on the **Live** screen. In **Settings, Remote access** the device appears with its role.

The page works on a phone (portrait or landscape) and on a laptop or desktop browser.

## Roles: what each device can do

The person at the console chooses a role for every device. A new device starts as **Score**. A device can never promote itself, and the console can change a role or disconnect a device at any time; it takes effect at once, without reloading the page.

| | Commentator | Camera | Replay | Scoreboard | Admin |
|---|:---:|:---:|:---:|:---:|:---:|
| Roster and player scoring stats | yes | no | no | no | yes |
| Camera source feeds | no | yes | yes | yes | yes |
| Score, clock, fouls, timeouts, period | no | no | no | yes | yes |
| Instant replay and key plays | no | no | yes | no | yes |
| Cut/fade, graphics, audio, sponsor controls | no | no | no | no | yes |
| Start or stop the broadcast | no | no | no | no | only if allowed below |
| Change local settings, destinations, games, rosters, recordings, storage | never | never | never | never | never |
| See stream keys, file paths, or the pairing code | never | never | never | never | never |
| Watch recordings or load the OBS overlay | never | never | never | never | never |

Each paired computer gets its own role view. **Camera** is a live source monitor, **Replay** adds replay controls and key plays, and **Scoreboard** combines live feeds with game controls. **Admin** provides the existing full remote production console. **Commentator** shows roster and player scoring totals without controls.

### Starting and stopping the broadcast

By default an Admin cannot start or stop the broadcast; that stays on the main computer. If you trust everyone on the network, turn on **Admin devices can start and stop the broadcast** in **Settings, Remote access**. Even then, stopping needs the button to be held for 1.5 seconds so a stray click cannot end the stream and recording.

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
| M | Mark a moment (legacy Score + marks and Admin) |
| Enter, Shift+Enter | Cut, Fade (Admin) |
| 1 to 4 | Put camera 1 to 4 in preview (Admin) |
| R | Replay (Admin) |

If the console and a remote device both change the score, the last change wins and the remote device sees a "Console changed score" message.

## Safety: use a trusted network

- **The connection is plain HTTP.** On an open or shared Wi-Fi network, someone nearby could copy a device's access. Use a password-protected network (WPA2 or WPA3) and do not use it on public Wi-Fi.
- **An Admin device can drive your live broadcast** (cameras, graphics, sponsors, and the stream itself if you allow it). Give the Admin role only to people and devices you trust.
- The other devices connect through a separate listener that exists only when you turn it on in **Settings, Remote access**. Turn it off after the game if you like. Pairing codes are limited in how often they can be tried, and each paired device gets its own access token.
- By default Fieldhouse answers only on the main computer itself. When remote access is on, its separate listener binds to all local interfaces, including Wi-Fi/WLAN and Ethernet. **Only allow devices on this local network** refuses addresses outside a private network, and **Require the pairing code** (on by default) needs the code. Keep both on.
- Anyone on the same local network who has the code can connect as a Score device. Do not share the code in public chat or on screen. Use **New code** between games.
- Do not forward ports on a router or put the laptop on the open internet.
- If a device disconnects, its buttons turn off and it reconnects by itself. Taps are never saved for later.

## If a computer or phone cannot connect

See [Troubleshooting](troubleshooting.md#my-phone-or-computer-cannot-connect).
