import { expect, test } from "bun:test";
import { DEFAULT_VIDEO, KBPS_RANGE, dims, differences, encoderOptions, liveBlocked, outputParams, resolveEncoder, validateVideo } from "./video-settings";
import { defaultSettings, getSettings, saveSettings, settingsView } from "./data";
import { openStore } from "./store";

test("validation: plain messages, no silent clamping", () => {
  const v = (p: unknown) => validateVideo(p, DEFAULT_VIDEO);
  expect(v({ resolution: "1080p", fps: 60, videoKbps: 8000, audioKbps: 192, encoder: "x264", recordFormat: "mkv", replaySeconds: 120 })).toMatchObject({ resolution: "1080p", fps: 60, videoKbps: 8000, audioKbps: 192, encoder: "x264", recordFormat: "mkv", replaySeconds: 120 });
  expect(v({ videoKbps: 6543 }).videoKbps).toBe(6543); // custom values are fine
  for (const bad of [{ resolution: "4k" }, { resolution: 720 }, { fps: 24 }, { fps: "30" }, { videoKbps: 999 }, { videoKbps: 20001 }, { videoKbps: 4500.5 }, { videoKbps: "4500" }, { audioKbps: 100 }, { encoder: "nvidia" }, { recordFormat: "mov" }, { replaySeconds: 45 }, { nope: 1 }, null, [], "x"])
    expect(() => v(bad)).toThrow();
  expect(() => v({ videoKbps: 10 })).toThrow(`between ${KBPS_RANGE[0]} and ${KBPS_RANGE[1]}`);
  expect(DEFAULT_VIDEO).toMatchObject({ resolution: "720p", fps: 30, videoKbps: 4500, encoder: "auto", recordFormat: "mp4", replaySeconds: 60 });
});

test("settings: video group persists, merges with defaults, is validated by saveSettings, and the API view never carries the password", () => {
  const store = openStore(":memory:");
  expect(getSettings(store).video).toEqual(DEFAULT_VIDEO);
  const s = saveSettings(store, { video: { resolution: "1080p" }, engine: { obsPassword: "secret-pw" } });
  expect(s.video).toMatchObject({ resolution: "1080p", fps: 30 });
  expect(() => saveSettings(store, { video: { fps: 24 } })).toThrow("Frame rate");
  expect(getSettings(store).video.resolution).toBe("1080p");
  const view = JSON.stringify(settingsView(getSettings(store)));
  expect(view).not.toContain("secret-pw"); expect(view).toContain('"video"');
  expect(defaultSettings().video).toEqual(DEFAULT_VIDEO);
});

test("changes OBS cannot make during a broadcast are blocked with a plain message; the rest are allowed", () => {
  const cur = DEFAULT_VIDEO;
  expect(liveBlocked(cur, { ...cur, resolution: "1080p" })).toContain("resolution cannot be changed during a broadcast");
  expect(liveBlocked(cur, { ...cur, fps: 60, encoder: "x264" })).toContain("frame rate and encoder");
  expect(liveBlocked(cur, { ...cur, videoKbps: 6000, audioKbps: 192, recordFormat: "mkv", replaySeconds: 30 })).toBeNull();
});

test("encoder choices are only what OBS lists", () => {
  expect(encoderOptions([]).map((e) => e.id)).toEqual(["auto", "x264"]);
  expect(encoderOptions(["obs_x264", "ffmpeg_vaapi_tex", "obs_qsv11_v2"]).map((e) => e.id)).toEqual(["auto", "x264", "qsv"]); // VAAPI is not selectable in OBS's simple mode
  expect(encoderOptions(["obs_nvenc_h264_tex", "jim_nvenc", "h264_texture_amf", "com.apple.videotoolbox.videoencoder.ave.avc"]).map((e) => e.id)).toEqual(["auto", "x264", "nvenc", "amd", "apple_h264"]);
  expect(encoderOptions(["ffmpeg_nvenc"]).map((e) => e.label)).toContain("NVIDIA NVENC");
});

test("Automatic = software, except 1080p60 with a hardware encoder available; unusable saved choices fall back to software", () => {
  expect(resolveEncoder("auto", { resolution: "720p", fps: 30 }, ["nvenc"])).toEqual({ id: "x264", preset: "veryfast" });
  expect(resolveEncoder("auto", { resolution: "1080p", fps: 60 }, ["qsv", "nvenc"])).toMatchObject({ id: "nvenc" });
  expect(resolveEncoder("auto", { resolution: "1080p", fps: 60 }, [])).toEqual({ id: "x264", preset: "superfast" });
  expect(resolveEncoder("qsv", { resolution: "720p", fps: 30 }, ["qsv"]).id).toBe("qsv");
  expect(resolveEncoder("nvenc", { resolution: "720p", fps: 30 }, []).id).toBe("x264");
  expect(resolveEncoder("x264", { resolution: "1080p", fps: 60 }, ["nvenc"]).id).toBe("x264");
});

test("OBS parameters: bitrate, encoder, crash-safe format, replay length and long quiet reconnect", () => {
  const p = Object.fromEntries(outputParams({ ...DEFAULT_VIDEO, videoKbps: 6000, audioKbps: 192, recordFormat: "mkv", replaySeconds: 120 }, { id: "x264", preset: "veryfast" }).map(([c, n, v]) => [`${c}.${n}`, v]));
  expect(p).toMatchObject({ "SimpleOutput.VBitrate": "6000", "SimpleOutput.ABitrate": "192", "SimpleOutput.StreamEncoder": "x264", "SimpleOutput.RecFormat2": "mkv", "SimpleOutput.RecRBTime": "120", "Output.Reconnect": "true", "Output.RetryDelay": "2", "Output.MaxRetries": "2000" });
  expect(Object.fromEntries(outputParams(DEFAULT_VIDEO, { id: "x264", preset: "veryfast" }).map(([c, n, v]) => [`${c}.${n}`, v]))["SimpleOutput.RecFormat2"]).toBe("hybrid_mp4");
  expect(dims({ ...DEFAULT_VIDEO, resolution: "1080p", fps: 60 })).toEqual({ baseWidth: 1920, baseHeight: 1080, outputWidth: 1920, outputHeight: 1080, fpsNumerator: 60, fpsDenominator: 1 });
  expect(dims(DEFAULT_VIDEO)).toMatchObject({ outputWidth: 1280, outputHeight: 720, baseHeight: 1080 }); // the canvas stays 1080p
});

test("read-back comparison names what differs", () => {
  const ok = { resolution: "720p", fps: 30, videoKbps: 4500, audioKbps: 160, encoder: "x264", recordFormat: "hybrid_mp4", replaySeconds: 60, outputWidth: 1280, outputHeight: 720 };
  expect(differences(DEFAULT_VIDEO, ok, "x264")).toEqual([]);
  expect(differences({ ...DEFAULT_VIDEO, resolution: "1080p", videoKbps: 6000, replaySeconds: 30 }, ok, "x264")).toEqual(["resolution", "video bitrate", "replay length"]);
});
