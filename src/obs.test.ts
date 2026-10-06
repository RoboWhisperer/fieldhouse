import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ObsEngine, meterLevel, obsAuth, type ObsOptions } from "./obs";
import { DEFAULT_VIDEO } from "./video-settings";
import { createServer } from "node:net";

// Mock obs-websocket v5 server with just enough state to provision, route scenes, record, stream and meter.
function mock(password?: string) {
  const salt = "lZ4G2xqYb0ZGk1r+salt", challenge = "Kj9mPq3hXc+challenge";
  const log: string[] = [], sockets = new Set<any>();
  const st = { scenes: ["Scene"], inputs: new Map<string, { kind: string; caps: number; settings: any }>([["Desktop Audio", { kind: "pulse_output_capture", caps: 2, settings: {} }]]), items: new Map<string, string[]>(), program: "Scene", preview: "Scene", rec: false, mute: new Map<string, boolean>(), rb: true, params: new Map<string, string>(), profile: "Untitled", video: { baseWidth: 1920, baseHeight: 1080 } as any, props: new Map<string, any[]>() };
  const emit = (eventType: string, eventData: object) => { for (const ws of sockets) ws.send(JSON.stringify({ op: 5, d: { eventType, eventIntent: 1, eventData } })); };
  const handle = (t: string, d: any): any => {
    switch (t) {
      case "GetVersion": return { obsVersion: "32.0.0" };
      case "GetInputKindList": return { inputKinds: ["color_source", "ffmpeg_source", "browser_source", "pulse_input_capture", "v4l2_input"] };
      case "GetProfileList": return { currentProfileName: st.profile, profiles: st.profile === "Fieldhouse" ? ["Fieldhouse", "Untitled"] : ["Untitled"] };
      case "CreateProfile": st.profile = d.profileName; return {};
      case "SetCurrentProfile": st.profile = d.profileName; return {};
      case "GetProfileParameter": return { parameterValue: st.params.get(d.parameterCategory + "." + d.parameterName) ?? "" };
      case "SetProfileParameter": st.params.set(d.parameterCategory + "." + d.parameterName, d.parameterValue); return {};
      case "GetReplayBufferStatus": return { outputActive: st.rb };
      case "StopReplayBuffer": st.rb = false; return {};
      case "StartReplayBuffer": st.rb = true; return {};
      case "GetStudioModeEnabled": return { studioModeEnabled: true };
      case "GetSceneTransitionList": return { transitions: [{ transitionName: "Cut" }, { transitionName: "Fade" }] };
      case "GetVideoSettings": return st.video;
      case "SetVideoSettings": st.video = { ...d }; return {};
      case "GetInputPropertiesListPropertyItems": return { propertyItems: st.props.get(d.inputName + "/" + d.propertyName) ?? [] };
      case "GetSceneItemId": { const i = (st.items.get(d.sceneName) ?? []).indexOf(d.sourceName); return i < 0 ? {} : { sceneItemId: i + 1 }; }
      case "RemoveSceneItem": { const l = st.items.get(d.sceneName) ?? []; l.splice(d.sceneItemId - 1, 1); return {}; }
      case "RemoveInput": st.inputs.delete(d.inputName); return {};
      case "TriggerMediaInputAction": st.params.set("media." + d.inputName, d.mediaAction); return {};
      case "GetSceneList": return { currentProgramSceneName: st.program, currentPreviewSceneName: st.preview, scenes: st.scenes.map((sceneName) => ({ sceneName })) };
      case "CreateScene": st.scenes.push(d.sceneName); st.items.set(d.sceneName, []); return {};
      case "GetInputList": return { inputs: [...st.inputs].map(([inputName, v]) => ({ inputName, inputKind: v.kind, inputKindCaps: v.caps })) };
      case "CreateInput": { st.inputs.set(d.inputName, { kind: d.inputKind, caps: d.inputKind === "color_source" ? 1 : 3, settings: d.inputSettings }); if (d.sceneName) st.items.get(d.sceneName)?.push(d.inputName); return { sceneItemId: 1 }; }
      case "GetSceneItemList": return { sceneItems: (st.items.get(d.sceneName) ?? []).map((sourceName, i) => ({ sourceName, sceneItemId: i + 1, sceneItemIndex: i, sceneItemTransform: { boundsType: "OBS_BOUNDS_SCALE_INNER", boundsWidth: 1920 } })) };
      case "CreateSceneItem": st.items.get(d.sceneName)!.push(d.sourceName); return { sceneItemId: 9 };
      case "SetSceneItemIndex": { const l = st.items.get(d.sceneName)!; const [x] = l.splice(d.sceneItemId - 1, 1); l.splice(d.sceneItemIndex, 0, x); return {}; }
      case "GetInputSettings": return { inputSettings: st.inputs.get(d.inputName)?.settings ?? {} };
      case "SetInputSettings": { const i = st.inputs.get(d.inputName)!; i.settings = d.overlay ? { ...i.settings, ...d.inputSettings } : d.inputSettings; return {}; }
      case "GetPersistentData": return {};
      case "GetInputMute": return { inputMuted: st.mute.get(d.inputName) ?? false };
      case "GetInputVolume": return { inputVolumeMul: 1, inputVolumeDb: 0 };
      case "SetInputMute": st.mute.set(d.inputName, d.inputMuted); emit("InputMuteStateChanged", { inputName: d.inputName, inputMuted: d.inputMuted }); return {};
      case "SetCurrentPreviewScene": st.preview = d.sceneName; emit("CurrentPreviewSceneChanged", { sceneName: d.sceneName }); return {};
      case "SetCurrentProgramScene": st.program = d.sceneName; emit("CurrentProgramSceneChanged", { sceneName: d.sceneName }); return {};
      case "TriggerStudioModeTransition": [st.program, st.preview] = [st.preview, st.program]; emit("CurrentProgramSceneChanged", { sceneName: st.program }); emit("CurrentPreviewSceneChanged", { sceneName: st.preview }); return {};
      case "GetStats": return { cpuUsage: 12.5, availableDiskSpace: 1000 };
      case "GetStreamStatus": return { outputActive: false, outputBytes: 0, outputSkippedFrames: 3 };
      case "GetRecordStatus": return { outputActive: st.rec, outputBytes: 0 };
      case "StartStream": setTimeout(() => emit("StreamStateChanged", { outputActive: !String(st.params.get("server")).includes("dead"), outputState: String(st.params.get("server")).includes("dead") ? "OBS_WEBSOCKET_OUTPUT_STOPPED" : "OBS_WEBSOCKET_OUTPUT_STARTED" }), 20); return {};
      case "SetStreamServiceSettings": st.params.set("server", d.streamServiceSettings.server); return {};
      case "SetRecordDirectory": st.params.set("dir", d.recordDirectory); return {};
      case "StartRecord": st.rec = true; setTimeout(() => emit("RecordStateChanged", { outputActive: true, outputState: "OBS_WEBSOCKET_OUTPUT_STARTED", outputPath: `${st.params.get("dir")}/${st.params.get("Output.FilenameFormatting")}.mp4` }), 20); return {};
      case "StopRecord": st.rec = false; setTimeout(() => emit("RecordStateChanged", { outputActive: false, outputState: "OBS_WEBSOCKET_OUTPUT_STOPPED", outputPath: "/rec/x.mp4" }), 20); return { outputPath: "/rec/x.mp4" };
      case "GetSourceScreenshot": return { imageData: "data:image/jpg;base64," + Buffer.from("jpegbytes:" + d.sourceName).toString("base64") };
      default: return {};
    }
  };
  const server = Bun.serve({
    port: 0,
    fetch(req, srv) { return srv.upgrade(req, { headers: { "Sec-WebSocket-Protocol": "obswebsocket.json" } }) ? undefined : new Response("no", { status: 400 }); },
    websocket: {
      open(ws) { sockets.add(ws); ws.send(JSON.stringify({ op: 0, d: { obsWebSocketVersion: "5.5.0", rpcVersion: 1, ...(password ? { authentication: { challenge, salt } } : {}) } })); },
      close(ws) { sockets.delete(ws); },
      message(ws, raw) {
        const m = JSON.parse(String(raw));
        if (m.op === 1) {
          const good = !password || m.d.authentication === obsAuth(password, salt, challenge);
          log.push(good ? "identified" : "bad-auth");
          if (good) { log.push("subs:" + m.d.eventSubscriptions); ws.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } })); } else ws.close(4009, "auth failed");
        } else if (m.op === 6) {
          const { requestType, requestId, requestData } = m.d;
          log.push(requestType);
          if (requestType === "Hang") return;
          ws.send(JSON.stringify({ op: 7, d: { requestType, requestId, requestStatus: { result: true, code: 100 }, responseData: handle(requestType, requestData ?? {}) } }));
        }
      },
    },
  });
  return { server, log, sockets, st, emit, url: `ws://127.0.0.1:${server.port}` };
}

const until = async (f: () => boolean, ms = 4000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error("timeout waiting for condition"); await Bun.sleep(20); } };
let cleanup: (() => unknown)[] = [];
afterEach(async () => { for (const c of cleanup) await c(); cleanup = []; });
function up(password?: string, enginePw = password, extra: Partial<ObsOptions> = {}, video?: () => any) {
  const m = mock(password);
  const e = new ObsEngine(m.url, enginePw, { overlayUrl: "http://127.0.0.1:1/overlay", replayDir: mkdtempSync(join(tmpdir(), "fh-rb-")), flatpak: false, precheck: async () => ({ ok: true, message: "" }), logDir: join(tmpdir(), "fh-no-logs"), video, ...extra });
  cleanup.push(() => e.close(), () => m.server.stop(true));
  return { m, e };
}
const ready = (e: ObsEngine) => until(() => e.status().obs!.provisioned);

test("auth hash matches an independently computed vector", () => {
  const h = (s: string) => createHash("sha256").update(s).digest();
  expect(obsAuth("hunter2", "salty", "chal")).toBe(h(h("hunter2" + "salty").toString("base64") + "chal").toString("base64"));
});

test("identifies with auth, subscribes to meters, provisions FH scenes", async () => {
  const { m, e } = up("hunter2");
  await ready(e);
  expect(m.log).toContain("identified");
  expect(m.log).toContain("subs:" + (2047 | 65536));
  expect(m.st.scenes).toEqual(expect.arrayContaining(["FH cam1", "FH cam2", "FH cam3", "FH cam4", "FH Replay", "Scene"]));
  expect(m.st.inputs.get("FH Overlay")!.settings).toMatchObject({ url: "http://127.0.0.1:1/overlay", width: 1920, height: 1080 });
  expect(m.st.items.get("FH cam1")!.at(-1)).toBe("FH Overlay"); // overlay on top
  expect(m.st.params.get("SimpleOutput.RecRBTime")).toBe("60");
  expect(m.st.profile).toBe("Fieldhouse");
  const s = e.status();
  expect(s).toMatchObject({ connected: true, graphicsInProgram: true, diskFreeBytes: 1000 * 1024 * 1024 });
  expect(s.sources).toEqual([]); // placeholders are empty slots
  expect(s.mixer.map((x) => x.id)).toEqual(["FH Mic", "Desktop Audio"]);
  expect(s.stream.droppedFrames).toBe(3);
});

test("provisioning twice adds nothing and never touches the user's scene", async () => {
  const { m, e } = up();
  await ready(e);
  const snap = JSON.stringify([m.st.scenes, [...m.st.inputs.keys()], [...m.st.items]]);
  await e.provision();
  expect(JSON.stringify([m.st.scenes, [...m.st.inputs.keys()], [...m.st.items]])).toBe(snap);
  expect(e.status().obs!.notes).toEqual([]);
  expect(m.st.scenes).toContain("Scene");
});

test("wrong password never connects and says why", async () => {
  const { m, e } = up("hunter2", "nope");
  await until(() => m.log.includes("bad-auth"));
  expect(e.status().connected).toBe(false);
  await until(() => /password/.test(e.status().obs?.error ?? ""));
});

test("setSlot with a file source, routing, cut, snapshots, mute", async () => {
  const { m, e } = up();
  await ready(e);
  const file = join(mkdtempSync(join(tmpdir(), "fh-v-")), "a.mp4");
  writeFileSync(file, "x");
  await e.setSlot(1, "ffmpeg_source:" + file, "Center");
  await e.setSlot(2, "ffmpeg_source:rtmp://10.0.0.5/live/cam", "Baseline");
  expect(m.st.inputs.get("FH cam1 video")).toMatchObject({ kind: "ffmpeg_source", settings: { is_local_file: true, local_file: file } });
  expect(m.st.inputs.get("FH cam2 video")!.settings).toMatchObject({ is_local_file: false, input: "rtmp://10.0.0.5/live/cam", reconnect_delay_sec: 5 });
  await until(() => e.status().sources.length === 2);
  expect(e.status().sources[0]).toMatchObject({ id: "cam1", label: "Center", deviceId: "ffmpeg_source:" + file, status: "ok" });
  await expect(e.setSlot(3, "pulse_input_capture:default")).rejects.toThrow("microphone");
  await e.setPreview("cam2");
  expect(m.st.preview).toBe("FH cam2");
  await e.cut();
  expect(m.st.program).toBe("FH cam2");
  await until(() => e.status().program === "cam2");
  expect(new TextDecoder().decode((await e.snapshot("program"))!.body)).toBe("jpegbytes:FH cam2");
  expect(new TextDecoder().decode((await e.snapshot("cam1"))!.body)).toBe("jpegbytes:FH cam1 video");
  expect(await e.snapshot("cam4")).toBeNull();
  expect(e.snapshot("program")).toBe(e.snapshot("program")); // cached
  await e.setMute("FH cam1 video", true);
  await until(() => e.status().mixer.find((x) => x.id === "FH cam1 video")?.muted === true);
  await expect(e.setPreview("nope")).rejects.toThrow("no such source");
});

test("meters become 0..1 levels", async () => {
  expect(meterLevel(0)).toBe(0);
  expect(meterLevel(1)).toBe(1);
  expect(meterLevel(0.001)).toBeCloseTo(0, 5);
  expect(meterLevel(0.1)).toBeCloseTo(2 / 3, 5);
  const { m, e } = up();
  await ready(e);
  m.emit("InputVolumeMeters", { inputs: [{ inputName: "Desktop Audio", inputLevelsMul: [[0.5, 0.5, 0.5], [0.5, 0.1, 0.5]] }] });
  await until(() => (e.status().mixer.find((x) => x.id === "Desktop Audio")?.level ?? 0) > 0.8);
});

test("record returns the real path from OBS; stream failure is a plain error", async () => {
  const { m, e } = up();
  await ready(e);
  const dir = mkdtempSync(join(tmpdir(), "fh-rec-"));
  expect(await e.startRecord(dir, "game 1")).toBe(`${dir}/game_1.mp4`);
  expect(e.status().record.active).toBe(true);
  await e.stopRecord();
  expect(e.status().record).toMatchObject({ active: false, file: "/rec/x.mp4" });
  await expect(e.startStream({ name: "YT", url: "rtmp://x", key: "" })).rejects.toThrow("no stream key");
  await e.startStream({ name: "YT", url: "rtmp://x", key: "k" });
  expect(m.log.filter((x) => x === "StartStream").length).toBe(1);
  expect(e.status().stream).toMatchObject({ live: true, destination: "YT" });
});

test("a stream OBS cannot start gives a plain error and is never retried", async () => {
  const dead = up();
  await ready(dead.e);
  await expect(dead.e.startStream({ name: "Dead", url: "rtmp://dead.example/live", key: "k" })).rejects.toThrow("could not connect");
  expect(dead.m.log.filter((x) => x === "StartStream").length).toBe(1); // never retried
});

test("reconnects after the server drops the socket and re-provisions", async () => {
  const { m, e } = up();
  await ready(e);
  const before = m.log.filter((x) => x === "identified").length;
  for (const ws of m.sockets) ws.close();
  await until(() => !e.status().connected);
  await expect(e.cut()).rejects.toThrow("not connected");
  m.st.scenes = ["Scene"]; // OBS came back without our scenes
  await until(() => e.status().connected && e.status().obs!.provisioned && m.log.filter((x) => x === "identified").length > before);
  expect(m.st.scenes).toContain("FH cam1");
});

test("a request with no reply times out; requests while down fail fast with a plain message", async () => {
  const { e } = up();
  await ready(e);
  await expect(e.request("Hang", {}, 100)).rejects.toThrow("timed out");
  const down = new ObsEngine("ws://127.0.0.1:1");
  cleanup.push(() => down.close());
  await expect(down.cut()).rejects.toThrow("not connected");
  await expect(down.replay({ secondsBack: 5, speed: 1 })).rejects.toThrow("not connected");
});


// ---------------------------------------------------------------- hands-off settings, audio, per-camera options, protection from OBS dialogs
const closedPort = () => new Promise<number>((ok) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as any).port; s.close(() => ok(p)); }); });

test("provisioning applies the saved quality settings to OBS and reads them back", async () => {
  let v = { ...DEFAULT_VIDEO, resolution: "1080p" as const, fps: 60 as const, videoKbps: 6000, audioKbps: 192, recordFormat: "mkv" as const, replaySeconds: 120 as const };
  const { m, e } = up(undefined, undefined, {}, () => v);
  await ready(e);
  expect(m.st.video).toMatchObject({ baseWidth: 1920, baseHeight: 1080, outputWidth: 1920, outputHeight: 1080, fpsNumerator: 60, fpsDenominator: 1 });
  expect(Object.fromEntries(["VBitrate", "ABitrate", "RecFormat2", "RecRBTime", "StreamEncoder"].map((k) => [k, m.st.params.get("SimpleOutput." + k)]))).toEqual({ VBitrate: "6000", ABitrate: "192", RecFormat2: "mkv", RecRBTime: "120", StreamEncoder: "x264" });
  expect(["Reconnect", "RetryDelay", "MaxRetries"].map((k) => m.st.params.get("Output." + k))).toEqual(["true", "2", "2000"]);
  const info = await e.videoInfo();
  expect(info.applied).toMatchObject({ resolution: "1080p", fps: 60, videoKbps: 6000, replaySeconds: 120, outputWidth: 1920 });
  // change a setting: applied through provisioning, verified by reading back
  v = { ...v, resolution: "720p", fps: 30, videoKbps: 2500 };
  const after = await e.applyVideo(v);
  expect(after).toMatchObject({ resolution: "720p", fps: 30, videoKbps: 2500, outputHeight: 720 });
  expect(m.st.rb).toBe(true); // the replay buffer is back after the restart
});

test("while a broadcast runs nothing is written to OBS and resolution/fps/encoder changes are refused", async () => {
  let v = { ...DEFAULT_VIDEO };
  const { m, e } = up(undefined, undefined, {}, () => v);
  await ready(e);
  await e.startRecord(mkdtempSync(join(tmpdir(), "fh-rec-")), "g");
  const writes = () => m.log.filter((x) => x === "SetProfileParameter" || x === "SetVideoSettings").length;
  const n = writes();
  await expect(e.applyVideo({ ...v, resolution: "1080p" })).rejects.toThrow("cannot be changed during a broadcast");
  await expect(e.applyVideo({ ...v, encoder: "x264", fps: 60 })).rejects.toThrow("frame rate");
  const same = await e.applyVideo({ ...v, videoKbps: 6000, replaySeconds: 30 }); // allowed: saved by the caller, applied after the broadcast
  expect(same).toMatchObject({ resolution: "720p", videoKbps: 4500 });
  expect(writes()).toBe(n);
  await e.stopRecord();
});

test("audio inputs: add a mic and desktop sound, rename, mute, retarget, remove; the user's own inputs are untouched", async () => {
  const { m, e } = up();
  await ready(e);
  const add = await e.addAudio({ role: "mic", label: "Commentary mic" });
  // FH Mic exists already (the default mic), so the new one gets the next free name
  expect(add.id).toBe("FH Mic 2");
  expect(add).toMatchObject({ role: "mic", label: "Commentary mic", managed: true, removable: true });
  expect(m.st.inputs.get("FH Mic 2")!.kind).toBe("pulse_input_capture");
  for (const sc of ["FH cam1", "FH cam2", "FH cam3", "FH cam4", "FH Replay"]) expect(m.st.items.get(sc)).toContain("FH Mic 2");
  await expect(e.addAudio({ role: "desktop", label: "Crowd" })).rejects.toThrow("not available"); // the mock has no output-capture kind
  await e.updateAudio("FH Mic 2", { label: "Press box", muted: true, gainDb: -6 });
  const list = await e.audioInputs();
  expect(list.inputs.find((i) => i.id === "FH Mic 2")).toMatchObject({ label: "Press box", muted: true });
  expect(m.st.mute.get("FH Mic 2")).toBe(true);
  expect(e.status().mixer.find((x) => x.id === "FH Mic 2")).toMatchObject({ label: "Press box", role: "mic" });
  await expect(e.updateAudio("Desktop Audio", { label: "x" })).rejects.toThrow("Only inputs added by Fieldhouse");
  await expect(e.removeAudio("Desktop Audio")).rejects.toThrow("Only extra inputs");
  await expect(e.removeAudio("FH Mic")).rejects.toThrow("Only extra inputs"); // the main mic stays
  await e.removeAudio("FH Mic 2");
  expect(m.st.inputs.has("FH Mic 2")).toBe(false);
  expect(m.st.items.get("FH cam2")).not.toContain("FH Mic 2");
  expect(m.st.inputs.has("Desktop Audio")).toBe(true);
  await e.provision(); // re-provisioning must not bring the removed input back
  expect(m.st.inputs.has("FH Mic 2")).toBe(false);
});

test("added audio inputs are put back into every FH scene on re-provision", async () => {
  const { m, e } = up();
  await ready(e);
  await e.addAudio({ role: "mic", label: "Second" });
  m.st.items.set("FH cam3", m.st.items.get("FH cam3")!.filter((x) => x !== "FH Mic 2"));
  await e.provision();
  expect(m.st.items.get("FH cam3")).toContain("FH Mic 2");
});

test("per-camera options: network source shows a masked address, retry/buffer apply and read back, reconnect restarts", async () => {
  const { m, e } = up();
  await ready(e);
  await e.setSlot(1, "ffmpeg_source:rtmp://user:pass@10.0.0.5/live/SECRETKEY", "Bench");
  const o = await e.sourceOptions(1);
  expect(o).toMatchObject({ type: "network", canReconnect: true, reconnectSeconds: 5, bufferingMb: 2 });
  expect(o.address).toBe("rtmp://10.0.0.5/live/...");
  expect(JSON.stringify(o)).not.toMatch(/SECRETKEY|user:pass/);
  const o2 = await e.setSourceOptions(1, { reconnectSeconds: 10, bufferingMb: 8, restart: true });
  expect(o2).toMatchObject({ reconnectSeconds: 10, bufferingMb: 8 });
  expect(m.st.inputs.get("FH cam1 video")!.settings).toMatchObject({ reconnect_delay_sec: 10, buffering_mb: 8 });
  expect(m.st.params.get("media.FH cam1 video")).toBe("OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART");
  await expect(e.setSourceOptions(1, { reconnectSeconds: 0 })).rejects.toThrow("1 to 60");
  await expect(e.setSourceOptions(1, { bufferingMb: 99 })).rejects.toThrow("1 to 16");
  await expect(e.sourceOptions(4)).rejects.toThrow("empty");
  const file = join(mkdtempSync(join(tmpdir(), "fh-v-")), "clip.mp4"); writeFileSync(file, "x");
  await e.setSlot(2, "ffmpeg_source:" + file, "Clip");
  expect(await e.sourceOptions(2)).toMatchObject({ type: "file", address: "clip.mp4", canReconnect: true });
  await expect(e.setSourceOptions(2, { reconnectSeconds: 5 })).rejects.toThrow("no connection");
});

test("per-camera options: a USB camera's resolutions and frame rates come from what OBS reports; unknown choices are refused", async () => {
  const { m, e } = up();
  await ready(e);
  m.st.inputs.set("FH cam3 video", { kind: "v4l2_input", caps: 1, settings: { device_id: "/dev/video0", resolution: 1920 * 65536 + 1080, framerate: 1000 } });
  m.st.items.get("FH cam3")!.unshift("FH cam3 video");
  const key = "FH cam3 video/";
  m.st.props.set(key + "resolution", [{ itemName: "1920x1080", itemValue: 1920 * 65536 + 1080 }, { itemName: "1280x720", itemValue: 1280 * 65536 + 720 }]);
  m.st.props.set(key + "framerate", [{ itemName: "30 FPS", itemValue: 1000 }, { itemName: "60 FPS", itemValue: 500 }]);
  await e.provision(); await Bun.sleep(350);
  const o = await e.sourceOptions(3);
  expect(o).toMatchObject({ type: "camera", resolution: String(1920 * 65536 + 1080), framerate: "1000" });
  expect(o.resolutions.map((r) => r.label)).toEqual(["1920x1080", "1280x720"]);
  const o2 = await e.setSourceOptions(3, { resolution: String(1280 * 65536 + 720), framerate: "500" });
  expect(o2).toMatchObject({ resolution: String(1280 * 65536 + 720), framerate: "500" });
  await expect(e.setSourceOptions(3, { resolution: "123" })).rejects.toThrow("not one the camera offers");
  m.st.props.delete(key + "resolution"); m.st.props.delete(key + "framerate"); // a camera that reports nothing
  expect(await e.sourceOptions(3)).toMatchObject({ resolutions: [], framerates: [] });
});

test("OBS vanishing mid-broadcast: the status says it ended, never pretends it is still live", async () => {
  const { m, e } = up();
  await ready(e);
  await e.startRecord(mkdtempSync(join(tmpdir(), "fh-rec-")), "g");
  await e.startStream({ name: "YT", url: "rtmp://x", key: "k" });
  expect(e.status().record.active).toBe(true);
  m.server.stop(true);
  await until(() => !e.status().connected);
  const s = e.status();
  expect(s.obs!.lost).toMatchObject({ record: true });
  expect(s.record.active).toBe(false); expect(s.stream.live).toBe(false);
});

test("the destination is checked from Fieldhouse first: a closed port never reaches StartStream (no OBS dialog)", async () => {
  const m = mock();
  const e = new ObsEngine(m.url, undefined, { overlayUrl: "http://127.0.0.1:1/overlay", replayDir: mkdtempSync(join(tmpdir(), "fh-rb-")), flatpak: false, logDir: join(tmpdir(), "fh-no-logs") }); // default precheck = the real one
  cleanup.push(() => e.close(), () => m.server.stop(true));
  await ready(e);
  const port = await closedPort();
  await expect(e.startStream({ name: "Stream", url: `rtmp://127.0.0.1:${port}/live`, key: "k" })).rejects.toThrow(`did not answer on port ${port}`);
  await expect(e.startStream({ name: "Stream", url: "http://example.com/live", key: "k" })).rejects.toThrow("rtmp://");
  expect(m.log).not.toContain("StartStream");
  expect(m.log).not.toContain("SetStreamServiceSettings");
  expect(e.status().stream.live).toBe(false);
});

test("size, frame rate and encoder changes restart the engine instead of touching a live OBS; success is only reported after read-back", async () => {
  let v = { ...DEFAULT_VIDEO };
  const m = mock();
  let restarts = 0;
  const e = new ObsEngine(m.url, undefined, { overlayUrl: "http://127.0.0.1:1/overlay", replayDir: mkdtempSync(join(tmpdir(), "fh-rb-")), flatpak: false, precheck: async () => ({ ok: true, message: "" }), logDir: join(tmpdir(), "fh-no-logs"), video: () => v,
    restartForVideo: async () => { restarts++; m.st.video = { baseWidth: 1920, baseHeight: 1080, outputWidth: 1920, outputHeight: 1080, fpsNumerator: 30, fpsDenominator: 1 }; for (const ws of m.sockets) ws.close(); } });
  cleanup.push(() => e.close(), () => m.server.stop(true));
  await ready(e);
  const resets = () => m.log.filter((x) => x === "SetVideoSettings" || x === "SetCurrentProfile").length;
  const n = resets();
  v = { ...v, resolution: "1080p" };
  const after = await e.applyVideo(v);
  expect(restarts).toBe(1);
  expect(after).toMatchObject({ resolution: "1080p", outputHeight: 1080 });
  expect(resets()).toBe(n); // no SetVideoSettings, no profile hop in the running OBS
  v = { ...v, videoKbps: 6000 }; // bitrate only: no restart
  expect((await e.applyVideo(v)).videoKbps).toBe(6000);
  expect(restarts).toBe(1);
});
