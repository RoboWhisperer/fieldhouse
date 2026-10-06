import { expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ObsLogWatcher, classifyLine, latestLog, parseEncoders } from "./obs-log";

// Lines copied from real OBS 32.2.2 logs on the dev machine are marked REAL; the others follow OBS's documented messages.
const REAL_START = `08:37:40.344: FFmpeg VAAPI H264 encoding supported
08:37:40.349: FFmpeg VAAPI AV1 encoding not supported
08:37:40.366: os_dlopen(libnvidia-encode.so.1->libnvidia-encode.so.1): libnvidia-encode.so.1: cannot open shared object file: No such file or directory
08:37:40.366: NVENC not supported
08:37:40.366: Failed to initialize module 'obs-nvenc.so'
08:37:40.300: v4l2loopback not installed, virtual camera not registered
08:37:39.842: No AJA devices found, skipping loading AJA UI plugin
08:37:40.455: Available Encoders:
08:37:40.455:   Video Encoders:
08:37:40.455: 	- ffmpeg_svt_av1 (SVT-AV1)
08:37:40.455: 	- ffmpeg_vaapi_tex (FFmpeg VAAPI H.264)
08:37:40.455: 	- obs_qsv11_v2 (QuickSync H.264)
08:37:40.455: 	- obs_x264 (x264)
08:37:40.455:   Audio Encoders:
08:37:40.455: 	- ffmpeg_aac (FFmpeg AAC)`;

test("healthy start-up noise on a machine without NVIDIA is NOT a problem (REAL lines)", () => {
  for (const l of REAL_START.split("\n")) expect(classifyLine(l)).toBeNull();
});

test("encoder list comes from OBS's own 'Available Encoders' block (REAL)", () => {
  expect(parseEncoders(REAL_START)).toEqual(["ffmpeg_svt_av1", "ffmpeg_vaapi_tex", "obs_qsv11_v2", "obs_x264"]);
  expect(parseEncoders("nothing here")).toEqual([]);
});

test("a missing media file maps to a plain sentence (REAL line)", () => {
  const c = classifyLine("11:54:55.274: MP: Failed to open media: '/home/u/Replay 1.mp4'");
  expect(c?.kind).toBe("media"); expect(c?.message).not.toContain("/home/u");
});

test("problems that matter map to plain-language notices, never raw lines", () => {
  const cases: [string, string][] = [
    ["12:00:00.000: [ffmpeg muxer: 'simple_file_output'] Couldn't write to path: No space left on device", "disk"],
    ["12:00:00.000: Output 'simple_file_output': bad output path", "folder"],
    ["12:00:00.000: [rtmp stream: 'simple_stream'] Connection to rtmp://a.example/live failed: Connection refused", "network"],
    ["12:00:00.000: Encoding overloaded! Consider turning down video settings or using a faster encoding preset.", "overload"],
    ["12:00:00.000: [qsv encoder: 'streaming_h264'] Failed to initialize encoder", "encoder"],
    ["12:00:00.000: v4l2-input: Unable to open device /dev/video0", "camera"],
  ];
  for (const [line, kind] of cases) {
    const c = classifyLine(line);
    expect(c?.kind).toBe(kind);
    expect(c!.message).not.toMatch(/\/dev\/|rtmp:\/\/|simple_|0x/); // nothing technical leaks
    expect(c!.message.length).toBeGreaterThan(30);
  }
});

test("ordinary info lines are ignored", () => {
  for (const l of ["12:00:00.000: Output 'simple_file_output': Starting", "12:00:00.000: [obs-websocket] [obs_module_load] Module loaded.", "12:00:00.000: ┣tick_sources: min=0.001 ms", "12:00:00.000: audio settings reset:", ""]) expect(classifyLine(l)).toBeNull();
});

test("watcher tails the newest log, reads only new lines, rate-limits each kind and keeps redacted highlights", () => {
  const dir = mkdtempSync(join(tmpdir(), "fh-obslog-"));
  const f = join(dir, "2026-10-06 12-00-00.txt");
  writeFileSync(f, "12:00:00.000: old line: No space left on device\n");
  let t = 1_000_000;
  const got: { level: string; message: string; kind: string }[] = [];
  const w = new ObsLogWatcher({ dir: () => dir, notice: (level, message, kind) => got.push({ level, message, kind }), now: () => t, quietS: 60 });
  w.poll(true); // start: skip what is already there
  expect(got).toEqual([]);
  appendFileSync(f, "12:00:01.000: Output 'x': bad output path rtmp://live.example/app/SECRETKEY123\n12:00:02.000: normal\n12:00:03.000: bad output path again\n12:00:04.000: [partial");
  w.poll();
  expect(got.map((g) => g.kind)).toEqual(["folder"]); // second 'folder' line is inside the quiet period
  appendFileSync(f, " line\n");
  w.poll();
  expect(got.length).toBe(1);
  t += 61_000;
  appendFileSync(f, "12:01:00.000: bad output path once more\n");
  w.poll();
  expect(got.length).toBe(2);
  const hl = w.highlights().join("\n");
  expect(hl).toContain("bad output path"); expect(hl).not.toContain("SECRETKEY123"); // stream keys are scrubbed
  const g2 = join(dir, "2026-10-06 13-00-00.txt"); // a new OBS session = a new file: read from its start
  writeFileSync(g2, "13:00:00.000: Encoding overloaded!\n");
  const later = new Date(Date.now() + 5000); require("node:fs").utimesSync(g2, later, later);
  w.poll();
  expect(got.at(-1)!.kind).toBe("overload");
  expect(latestLog(dir)).toBe(g2);
  expect(latestLog(join(dir, "nope"))).toBeNull();
});

test("encoders() reads the list from the newest log", () => {
  const dir = mkdtempSync(join(tmpdir(), "fh-obslog2-"));
  writeFileSync(join(dir, "a.txt"), REAL_START);
  expect(new ObsLogWatcher({ dir: () => dir, notice: () => {} }).encoders()).toContain("obs_qsv11_v2");
});
