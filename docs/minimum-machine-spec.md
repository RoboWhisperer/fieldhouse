# Minimum machine spec

Fieldhouse is a local, single-operator production app: it runs a Bun server, a browser-based UI (in an Electron shell or a browser tab), and drives OBS Studio for capture, mixing, encoding, streaming and recording. Everything except the video engine runs on the laptop.

These specs assume basketball-scale production (one to four cameras, 720p or 1080p, one stream destination plus local recording). More cameras, 1080p60, hardware encoding, or multiple destinations need more headroom.

## Recommended (runs a full game comfortably)

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 4 cores, 2.5 GHz | 6+ cores, 3.0 GHz+ (Intel with Quick Sync, or AMD/NVIDIA for hardware encode) |
| RAM | 8 GB | 16 GB |
| GPU / encode | Integrated graphics (software x264) | Dedicated GPU with NVENC / QSV / AMF, or Apple silicon |
| Storage | 256 GB SSD | 512 GB+ SSD; recordings can use several GB per hour |
| OS | Windows 10, macOS 12, or Linux | Windows 10/11 (best capture-card and NDI support) |
| Network | Wi-Fi (gym) | Gigabit Ethernet to the streaming router; 5 GHz Wi-Fi for phone remotes |

## What the spec affects

- **Encode:** software x264 at 1080p60 can saturate a CPU; hardware encode (NVENC/QSV/AMF/VideoToolbox) frees the CPU for game control. Fieldhouse prefers hardware encode and falls back to x264.
- **Recording:** the program is recorded locally while streaming. A dropped stream does not lose the game, but a full disk does — keep free space above the low-space warning (default 40 GB).
- **Replay:** the 60-second replay buffer and instant replay write to disk; faster storage means quicker replay response.
- **Phone remotes:** scorekeeper/producer pages run in a browser on the gym Wi-Fi; a weak network makes them laggy.

## Not counted in the spec

Fieldhouse does not host video, transcode for VOD, or run AI. Streaming goes to an RTMP/SRT destination you provide (YouTube, Facebook, a local sink, etc.). Video hosting and CDN are non-goals.

## Verified platforms

Tested on Linux with OBS Studio 32.2.2 (Flatpak). Windows and macOS installers are built but have not been verified on real hardware. Capture cards, NDI, and hardware encoders vary by machine — pilot on your actual game-day laptop before the season.
