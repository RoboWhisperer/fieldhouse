import { afterEach, expect, test } from "bun:test";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { FakeEngine, createEngine } from "./engine";

const TMP = __join(__tmpdir(), "fieldhouse-tests", "engine-test");
mkdirSync(TMP, { recursive: true });
let e = new FakeEngine();
afterEach(async () => { await e.close(); e = new FakeEngine(); });

test("defaults and createEngine", () => {
  const s = e.status();
  expect(s).toMatchObject({ engine: "fake", connected: true, program: "cam1", preview: "cam2" });
  expect(s.sources.map((x) => x.label)).toEqual(["Center court", "Baseline", "Bench", "Scoreboard screen"]);
  expect(s.mixer.map((m) => m.id)).toEqual(["commentary", "crowd", "program"]);
  expect(createEngine("fake")).toBeInstanceOf(FakeEngine);
});

test("cut swaps, fade swaps after the delay", async () => {
  await e.cut();
  expect(e.status()).toMatchObject({ program: "cam2", preview: "cam1" });
  const p = e.fade(60);
  expect(e.status().program).toBe("cam2");
  await p;
  expect(e.status()).toMatchObject({ program: "cam1", preview: "cam2" });
});

test("setPreview rejects missing and reconnecting sources", async () => {
  await expect(e.setPreview("cam9")).rejects.toThrow("no such source");
  e.simulate("source-drop", "cam3");
  await expect(e.setPreview("cam3")).rejects.toThrow("reconnecting");
  e.simulate("source-restore", "cam3");
  await e.setPreview("cam3");
  expect(e.status().preview).toBe("cam3");
});

test("dropping the program source keeps it on program", () => {
  e.simulate("source-drop", "cam1");
  expect(e.status().program).toBe("cam1");
  expect(e.status().sources[0].status).toBe("reconnecting");
});

test("stream needs a key; stop clears; drop/restore", async () => {
  await expect(e.startStream({ name: "YT", url: "rtmp://x", key: " " })).rejects.toThrow("stream key");
  await e.startStream({ name: "YT", url: "rtmp://x", key: "k" });
  expect(e.status().stream).toMatchObject({ live: true, destination: "YT" });
  expect(e.status().stream.startedAt).toBeGreaterThan(0);
  e.simulate("stream-drop");
  expect(e.status().stream).toMatchObject({ live: true, reconnecting: true });
  e.simulate("stream-restore");
  expect(e.status().stream.reconnecting).toBe(false);
  await e.stopStream();
  expect(e.status().stream).toMatchObject({ live: false, kbps: 0 });
});

test("record writes a real, playable file", async () => {
  const file = await e.startRecord(`${TMP}/a/b`, "game1");
  expect(file).toBe(`${TMP}/a/b/game1.mkv`);
  expect(e.status().record).toMatchObject({ active: true, file });
  await Bun.sleep(1500);
  await e.stopRecord();
  expect(e.status().record.active).toBe(false);
  expect(existsSync(file)).toBe(true);
  if (Bun.which("ffmpeg")) {
    expect(statSync(file).size).toBeGreaterThan(0);
    expect(e.status().record.bytes).toBe(statSync(file).size);
    const p = Bun.spawnSync(["ffmpeg", "-v", "error", "-i", file, "-f", "null", "-"]);
    expect(p.stderr.toString()).toBe("");
    expect(p.exitCode).toBe(0);
  }
}, 15000);

test("replay auto-clears, stopReplay clears now, bad args reject", async () => {
  await expect(e.replay({ secondsBack: 0, speed: 1 })).rejects.toThrow();
  await expect(e.replay({ secondsBack: 5, speed: 0 })).rejects.toThrow();
  await e.replay({ secondsBack: 1, speed: 1 });
  expect(e.status().replay.active).toBe(true);
  await Bun.sleep(1100);
  expect(e.status().replay.active).toBe(false);
  await e.replay({ secondsBack: 30, speed: 1 });
  await e.stopReplay();
  expect(e.status().replay.active).toBe(false);
});

test("disk-low and restore", () => {
  e.simulate("disk-low");
  expect(e.status().diskFreeBytes).toBe(6e9);
  e.simulate("disk-restore");
  expect(e.status().diskFreeBytes).not.toBe(6e9);
});

test("slots and devices", async () => {
  const d = await e.detectDevices();
  expect(d.map((x) => x.label)).toEqual(["Logitech Brio (USB)", "Elgato Cam Link 4K", "NDI: Coach iPhone", "SRT: Press-box cam", "Scarlett 2i2 (audio)", "Desktop sound (monitor of built-in audio)", "Screen capture: scoreboard PC"]);
  expect(e.status().sources[0]).toMatchObject({ id: "cam1", deviceId: "usb-brio" }); // default slots carry their device
  expect(d.filter((x) => x.inUse).map((x) => x.id)).toEqual(["usb-brio", "usb-camlink", "ndi-coach", "screen-scoreboard"]);
  await e.setSlot(2, "srt-press", "Hallway");
  expect(e.status().sources[1]).toMatchObject({ id: "cam2", deviceId: "srt-press", label: "Hallway", kind: "srt" });
  expect((await e.detectDevices()).find((x) => x.id === "srt-press")!.inUse).toBe(true);
  await e.setSlot(2, null);
  expect(e.status().sources.some((x) => x.id === "cam2")).toBe(false);
  expect(e.status().preview).toBeNull();
});

test("snapshot returns the matching svg", async () => {
  const snap = await e.snapshot("cam1");
  expect(snap!.type).toBe("image/svg+xml");
  expect(new TextDecoder().decode(snap!.body)).toContain("<svg");
  expect(await e.snapshot("cam9")).toBeNull();
});

test("onChange fires on actions and ticks, throttled, and unsubscribe works", async () => {
  let n = 0;
  const off = e.onChange(() => n++);
  await e.cut();
  expect(n).toBe(1);
  await e.cut(); await e.cut(); // inside the throttle window: coalesced
  expect(n).toBe(1);
  await Bun.sleep(1100);
  expect(n).toBeGreaterThanOrEqual(3);
  expect(n).toBeLessThanOrEqual(6); // <= 4/s
  off();
  const after = n;
  await e.cut();
  await Bun.sleep(600);
  expect(n).toBe(after);
});

test("meters stay in range and move", async () => {
  e.onChange(() => {});
  const a = e.status();
  await Bun.sleep(800);
  const b = e.status();
  expect(b.cpu).toBeGreaterThanOrEqual(25);
  expect(b.cpu).toBeLessThanOrEqual(45);
  expect(b.sources[0].audio).not.toBe(a.sources[0].audio);
  for (const m of b.mixer) { expect(m.level).toBeGreaterThanOrEqual(0); expect(m.level).toBeLessThanOrEqual(1); }
});

test("FakeEngine supports the settings, audio and per-camera contracts so the demo and CI run the whole screen", async () => {
  const { DEFAULT_VIDEO } = await import("./video-settings");
  expect((await e.videoInfo()).applied).toMatchObject({ resolution: "720p", fps: 30, encoder: "x264" });
  expect(await e.applyVideo({ ...DEFAULT_VIDEO, resolution: "1080p", videoKbps: 8000 })).toMatchObject({ resolution: "1080p", videoKbps: 8000, outputHeight: 1080 });
  await e.startRecord(TMP, "vid-live");
  await expect(e.applyVideo({ ...DEFAULT_VIDEO, resolution: "720p" })).rejects.toThrow("cannot be changed during a broadcast");
  await e.stopRecord();
  const a = await e.addAudio({ role: "mic", label: "Commentary mic" });
  expect(a).toMatchObject({ id: "audio-2", label: "Commentary mic", managed: true, removable: true });
  expect((await e.updateAudio("audio-2", { label: "Press box", muted: true, gainDb: -3 }))).toMatchObject({ label: "Press box", muted: true, gainDb: -3 });
  await expect(e.removeAudio("commentary")).rejects.toThrow("Only extra inputs");
  await e.removeAudio("audio-2");
  expect((await e.audioInputs()).inputs.some((i) => i.id === "audio-2")).toBe(false);
  expect(await e.sourceOptions(1)).toMatchObject({ type: "camera" });
  expect(await e.setSourceOptions(1, { framerate: "60" })).toMatchObject({ framerate: "60" });
  await expect(e.setSourceOptions(1, { resolution: "nope" })).rejects.toThrow("not one the camera offers");
});
