# Replay and highlights

## Instant replay

On the **Live** screen, press **Replay last 10s** (keyboard: R) to show the last ten seconds on Program. A slow-motion switch changes the speed. Shift+R replays the last score. Press stop to return to live.

Open the Events panel to find an earlier moment: each event has a Replay button.

> **Checked with real OBS on Linux:** replay goes on air about 2 seconds after you click, plays the last N seconds, then returns to the camera. It uses a 60 second replay buffer that Fieldhouse sets up in OBS. Not verified on Windows or macOS.

## Mark moments

Press **Mark moment** (M) when something happens that isn't a score: a block, a great pass, a big crowd. Every score is marked automatically.

## Highlights

After the game, **Wrap-up** lists clips: every score and mark, with a little time before and after. Untick any you don't want, reorder them, and press **Export highlights**. This uses `ffmpeg` on the laptop to make a video file in your recordings folder.

> **Note:** highlights need the program recording. If recording failed, there is nothing to cut from.

You can also export the events as CSV.

## Auto-highlights

After the game, Fieldhouse can assemble every scored and marked moment into a single highlights file automatically:

```
POST /api/games/:id/auto-highlights
```

It builds one clip per score or mark (with a short pre-roll and post-roll), merges overlapping clips, and exports them to `<storageDir>/highlights/<game-id>-auto-highlights.mp4` using `ffmpeg`. The source recording is marked as exported. If there are no scored or marked moments, or no program recording exists, the request is refused with a plain error.

> **Note:** auto-highlights need the program recording and `ffmpeg` installed on the laptop. Clips that overlap (because events are close together) are merged into one continuous clip.

## Recording safety

Fieldhouse records the program to the laptop while streaming, so a failed stream does not lose the game. Check disk space on the **Check** screen: a game recording can take several gigabytes per hour. Highlights are exported as H.264/AAC MP4 files.
