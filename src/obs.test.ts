import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ObsEngine, meterLevel, obsAuth } from "./obs";

// Mock obs-websocket v5 server with just enough state to provision, route scenes, record, stream and meter.
function mock(password?: string) {
  const salt = "lZ4G2xqYb0ZGk1r+salt", challenge = "Kj9mPq3hXc+challenge";
  const log: string[] = [], sockets = new Set<any>();
  const st = { scenes: ["Scene"], inputs: new Map<string, { kind: string; caps: number; settings: any }>([["Desktop Audio", { kind: "pulse_output_capture", caps: 2, settings: {} }]]), items: new Map<string, string[]>(), program: "Scene", preview: "Scene", rec: false, mute: new Map<string, boolean>(), rb: true, params: new Map<string, string>(), profile: "Untitled" };
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
      case "GetVideoSettings": return { baseWidth: 1920, baseHeight: 1080 };
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
function up(password?: string, enginePw = password) {
  const m = mock(password);
  const e = new ObsEngine(m.url, enginePw, { overlayUrl: "http://127.0.0.1:1/overlay", replayDir: mkdtempSync(join(tmpdir(), "fh-rb-")), flatpak: false });
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
