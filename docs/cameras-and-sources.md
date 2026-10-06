# Cameras and sources

Fieldhouse supports up to four video sources, called slots 1 to 4. One camera is a perfectly good start.

> **Not yet verified with real USB cameras or capture cards.** Network and file sources (srt, rtmp, rtsp, http, file) have been checked with real OBS on Linux. The guidance below is general, not a tested compatibility list. Phone camera apps are untested.

## Kinds of sources

| Source | What it is | Good for | Watch out for |
|--------|------------|----------|---------------|
| USB camera (webcam) | Plugs straight into the laptop | One fixed wide shot of the court | Short cables; USB ports shared on one hub can run out of bandwidth |
| Camcorder or camera with HDMI output + capture card | Capture card turns HDMI into a USB camera | Better picture, optical zoom | Camera must send a clean HDMI output with no menus on screen, and must not shut off after 30 minutes |
| Phone as a camera | A free or paid phone app sends the picture over Wi-Fi using SRT or RTMP | An extra angle with no cables | Gym Wi-Fi is often poor; phone battery and heat; set the phone not to sleep |
| Network source | Any device that sends an SRT or RTMP stream to the laptop | Cameras mounted far away | Needs a stable network |

Fieldhouse lists what it finds on the **Setup** screen. A device that is unplugged turns grey with a Reconnect button.

## Low-budget advice

- Start with one camera at mid-court height, as high as you can safely put it, looking at the whole court.
- Spend on a tripod and long cable before a better camera: a steady, high shot is worth more than extra resolution.
- Sound matters. Viewers forgive a rough picture sooner than muffled sound. A cheap microphone near the bench or press table, or crowd sound from the laptop, is enough to start.
- Borrow before you buy: the school's media class or a booster may already own a camcorder or capture card.
- Check any item works with a free trial of your own setup before game night. This page does not recommend or endorse any product.

## Sample settings

These are common starting points, not tested values.

| Situation | Resolution | Frame rate | Upload speed needed (about) |
|-----------|-----------|------------|-----------------------------|
| Weak internet | 1280x720 | 30 | 3 to 4 Mbps free upload |
| Normal | 1280x720 | 60 | 5 to 6 Mbps |
| Good internet | 1920x1080 | 30 | 6 to 8 Mbps |

Run a speed test at the gym, at game time if you can, and keep your stream's speed well below the result. The **Check** screen compares your upload speed with the stream's needs.

## Naming slots

Name each slot for what it sees ("Center court", "Bench", "Scoreboard"). The name appears on the Live screen so a new volunteer knows what each button is.

## Save the setup

On the **Setup** screen, save the arrangement as a venue ("Main Gym"). Next game, Fieldhouse reuses it.
