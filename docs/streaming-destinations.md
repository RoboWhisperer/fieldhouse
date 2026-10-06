# Streaming destinations

A destination is the website that shows your game live. Fieldhouse sends your video there; it does not host video itself.

> **Sign-in is not built.** Fieldhouse has no "Sign in with YouTube" or "Sign in with Facebook" (OAuth). You copy a server address and a stream key from the site and paste them in. Streaming to a local test server has been verified with real OBS; real YouTube and Facebook streaming has not.

Choose destinations on **Setup** (step 1) and manage them in **Settings, Destinations**. "Record only" saves the game without streaming.

## Stream keys are secrets

Anyone with your stream key can broadcast on your channel. Fieldhouse hides keys (shown as dots, with Reveal on demand) and never puts them in the diagnostics bundle. Do not post a key in a chat, email or bug report. If one leaks, make a new key on the site.

## YouTube

1. Sign in to YouTube Studio with the school's account.
2. Choose Create, then Go live. (A new channel may need to be verified for live streaming, which can take about a day: do this well before game night.)
3. Choose the Stream tab. Copy the **Stream URL** (server address) and the **Stream key**.
4. In Fieldhouse, **Settings, Destinations**, add a custom destination: paste the address and key.
5. Set the YouTube stream to "Unlisted" or "Private" for a test.

## Facebook

1. Open the Facebook page or group that will show the game.
2. Choose Live video, then the streaming software option.
3. Copy the **Server URL** and **Stream key**. Facebook keys can expire quickly, so get a fresh one on game day.
4. Paste both into a custom destination in Fieldhouse.

## Custom address (RTMP or SRT)

Other sites and school video platforms give you a server address (starting `rtmp://`, `rtmps://` or `srt://`) and sometimes a key. Paste them into a custom destination.

## Test before game night

1. In Fieldhouse, use the destination's **Test** button in Settings, Destinations. It checks that the address works.
2. Do a short private stream to the real site, from the real gym, at the same time of day if possible.
3. Watch it on a second device. Check the picture, the sound, and the delay (often 10 to 30 seconds).
4. Check that the recording file also saved.

The Check screen also has "Test stream privately" where available.

## If the stream will not connect

If OBS cannot reach the server, OBS itself shows its own "Failed to connect to server" box on the desktop. That is OBS behavior and Fieldhouse cannot hide it. Fieldhouse also shows its own plain message. Close the OBS box, then check the address, the key and the internet connection, and try again.

## If the stream drops

Fieldhouse keeps recording, shows "Reconnecting...", and retries. The recording is safe. See [Troubleshooting](troubleshooting.md).

Before streaming a game publicly, read [Streaming rights](streaming-rights.md).
