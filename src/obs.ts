// OBS Studio engine: obs-websocket v5 (ws://host:4455) over Bun's built-in WebSocket, against a real OBS.
// Slot N = OBS scene "FH camN" (camera input "FH camN video" + the shared "FH Overlay" browser input on top). Studio mode gives
// preview/program. Provisioning (src/obs-provision.ts) runs on every (re)connect, so OBS can be restarted at any time.
// Status follows OBS events (scene, stream, record, mute, volume, meters) with a 1 s poll as backup.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { paths } from "./config";
import { detectObs, flatpakUnreachable, obsLogDir } from "./obs-manager";
import { checkDestination, type DestCheck } from "./destination-check";
import { latestLog, parseEncoders, readSlice } from "./obs-log";
import { log } from "./diagnostics";
import { cameraInput, dropInput, isAudioDevice, networkDevice, parseDeviceId, probeDevices, type Req } from "./obs-devices";
import { MIC, OVERLAY, PROBE_SCENE, REPLAY_MEDIA, REPLAY_SCENE, SLOTS, camInput, canvasSize, fitItem, idOfScene, isManagedAudio, provision, readApplied, sceneOf, type ProvisionReport } from "./obs-provision";
import { maskAddress, parseNetworkSource } from "./source-url";
import { ObsLayers } from "./obs-layers";
import { DEFAULT_VIDEO, dims, differences, encoderOptions, liveBlocked, resolveEncoder } from "./video-settings";
import type { AudioInput, AudioList, DeviceInfo, Engine, EngineStatus, EncoderChoice, EncoderOption, MixerChannel, SourceInfo, SourceOptions, SourceOptionsPatch, VideoApplied, VideoSettings } from "./types";

const sha256b64 = (s: string) => createHash("sha256").update(s).digest("base64");
// obs-websocket v5 auth: base64(sha256(base64(sha256(password + salt)) + challenge))
export const obsAuth = (password: string, salt: string, challenge: string) => sha256b64(sha256b64(password + salt) + challenge);

const EVENTS = 2047 | (1 << 16); // all general events + InputVolumeMeters (high volume, opt-in)
const REQUEST_MS = 5000;
const DATA = { realm: "OBS_WEBSOCKET_DATA_REALM_GLOBAL", slotName: "fieldhouse" };
const AUDIO_CAP = 2; // OBS_SOURCE_AUDIO bit of inputKindCaps
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Linear peak (0..1) -> meter position: -60 dBFS is empty, 0 dBFS is full. */
export const meterLevel = (mul: number) => (mul > 0 ? clamp((20 * Math.log10(mul) + 60) / 60, 0, 1) : 0);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Sidecar { slots: Record<string, { label: string; deviceId: string; kind: DeviceInfo["kind"]; detail: string }>; network: { url: string; label: string }[]; audio: Record<string, { label: string; role: "mic" | "desktop" }> }
export interface ObsOptions {
  overlayUrl?: string | (() => string);
  replayDir?: string; // scratch folder for instant-replay clips
  flatpak?: boolean; // override detection (tests)
  video?: () => VideoSettings; // the volunteer's quality choices (Fieldhouse settings); re-applied on every (re)connect
  precheck?: (url: string) => Promise<DestCheck>; // destination check before StartStream; tests replace it
  restartForVideo?: () => Promise<void>; // closes the OBS Fieldhouse started and starts it again with the saved profile (obs-supervisor.ts)
  logDir?: string; // where OBS writes its logs (the encoder list is read from there); tests replace it
}
const MIC_KINDS = ["pulse_input_capture", "wasapi_input_capture", "coreaudio_input_capture"], DESKTOP_KINDS = ["pulse_output_capture", "wasapi_output_capture"];
// Property names that carry a camera's resolution / frame rate, per OBS input kind (verified by reading OBS's source; only the
// property discovery is exercised against OBS here, because the dev machine has no UVC camera).
const CAM_PROPS: Record<string, { res: string; fps?: string; custom?: Record<string, unknown> }> = {
  v4l2_input: { res: "resolution", fps: "framerate" },
  dshow_input: { res: "resolution", fps: "frame_interval", custom: { res_type: 1 } }, // 1 = "custom resolution", needed for the value to count
  av_capture_input: { res: "preset" },
};
type Waiter = { type: string; pred: (d: any) => boolean; done: (d: any) => void };

const NOT_CONNECTED = "The video engine is not connected yet. Fieldhouse is starting it; check Settings > Video engine if this stays.";

export class ObsEngine implements Engine {
  private ws?: WebSocket;
  private pending = new Map<string, { ok: (d: any) => void; fail: (e: Error) => void }>();
  private listeners = new Set<() => void>();
  private waiters = new Set<Waiter>();
  private n = 0;
  private closed = false;
  private backoff = 250;
  private everConnected = false;
  private poller?: ReturnType<typeof setInterval>;
  private retry?: ReturnType<typeof setTimeout>;
  private meterTimer?: ReturnType<typeof setTimeout>;
  private tick = 0;
  private connGen = 0; // counts successful (re)connections, so "it came back" can be told from "it never went away"
  private polling = false;
  private provisioning = false; // while true the 1 s poll must not restart the replay buffer that provisioning just stopped on purpose
  private ready: Promise<unknown> = Promise.resolve();
  private lastBytes?: { bytes: number; at: number };
  private inputs = new Map<string, { kind: string; caps: number }>();
  private kinds = new Set<string>();
  private versioned = new Map<string, string>(); // color_source -> color_source_v3: CreateInput only accepts the versioned name
  private mix = new Map<string, { muted: boolean; gainDb: number }>();
  private meters = new Map<string, number>();
  private media = new Map<string, string>();
  private side: Sidecar = { slots: {}, network: [], audio: {} };
  private hw: EncoderChoice[] = []; private encoderIds: string[] = [];
  private labels = new Map<string, string>(); // device id -> label from the last scan
  private programScene: string | null = null;
  private previewScene: string | null = null;
  private fadeMs = 500;
  private snaps = new Map<string, { at: number; p: Promise<{ type: string; body: Uint8Array } | null> }>();
  private replayTask?: { abort: () => Promise<void> };
  private savedReplays: string[] = [];
  private s: EngineStatus = {
    engine: "obs", connected: false, program: null, preview: null, replay: { active: false }, sources: [], mixer: [],
    stream: { live: false, kbps: 0, droppedFrames: 0, reconnecting: false }, record: { active: false, bytes: 0 }, cpu: 0, diskFreeBytes: 0,
    graphicsInProgram: true, obs: { provisioned: false, replayBuffer: false, created: [], notes: [] },
  };

  constructor(private url: string, private password?: string, private opts: ObsOptions = {}) { this.s.obs!.error = "Connecting to the video engine..."; this.connect(); }

  status(): EngineStatus { return structuredClone(this.s); }
  onChange(cb: () => void) { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }
  private emit() { for (const cb of [...this.listeners]) cb(); }
  private emitMeters() { if (!this.meterTimer) { this.meterTimer = setTimeout(() => { this.meterTimer = undefined; this.emit(); }, 100); this.meterTimer.unref?.(); } }

  // ---------------------------------------------------------------- connection
  private connect() {
    if (this.closed) return;
    const ws = (this.ws = new WebSocket(this.url, "obswebsocket.json"));
    ws.onmessage = (e) => { try { this.onMessage(ws, JSON.parse(String(e.data))); } catch (err: any) { log("WARN", `OBS message: ${err?.message}`); } };
    ws.onclose = (e) => this.onDown(ws, (e as CloseEvent).code);
    ws.onerror = () => {}; // onclose always follows
  }

  private onDown(ws: WebSocket, code?: number) {
    if (ws !== this.ws) return;
    clearInterval(this.poller);
    for (const p of this.pending.values()) p.fail(new Error("OBS connection lost"));
    this.pending.clear();
    for (const w of [...this.waiters]) w.done(null);
    this.lastBytes = undefined;
    this.meters.clear();
    const o = this.s.obs!;
    o.provisioned = false;
    o.error = code === 4009 ? "The video engine's password is wrong. Check it in Settings > Video engine." : this.everConnected ? "The video engine stopped or the connection dropped. Reconnecting..." : "Waiting for the video engine to start...";
    if (this.s.connected) {
      this.s.connected = false;
      if (this.s.stream.live || this.s.record.active) { // never pretend a broadcast is still running: say it ended, never restart it by ourselves
        o.lost = { at: Date.now(), stream: this.s.stream.live, record: this.s.record.active };
        this.s.stream = { live: false, kbps: 0, droppedFrames: this.s.stream.droppedFrames, reconnecting: false };
        this.s.record = { ...this.s.record, active: false };
        log("ERROR", "The video engine stopped during a broadcast");
      }
      for (const x of this.s.sources) x.status = "missing";
      if (this.replayTask) this.s.replay.active = false;
      log("WARN", `OBS disconnected (${code ?? "?"})`);
    }
    this.emit();
    if (this.closed) return;
    this.retry = setTimeout(() => this.connect(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, 5000);
  }

  private onMessage(ws: WebSocket, m: { op: number; d: any }) {
    if (ws !== this.ws) return;
    if (m.op === 0) { // Hello -> Identify
      const d: any = { rpcVersion: 1, eventSubscriptions: EVENTS };
      if (m.d.authentication) d.authentication = obsAuth(this.password ?? "", m.d.authentication.salt, m.d.authentication.challenge);
      ws.send(JSON.stringify({ op: 1, d }));
    } else if (m.op === 2) {
      this.backoff = 250;
      this.everConnected = true; this.connGen++;
      this.s.connected = true;
      this.s.obs!.error = undefined;
      log("INFO", "Connected to OBS");
      this.ready = this.setup(ws).catch((e) => {
        this.s.obs!.error = `Video engine setup failed: ${e.message}`; log("ERROR", `OBS setup: ${e.message}`); this.emit();
        const t = setTimeout(() => { if (!this.closed && ws === this.ws && this.s.connected && !this.s.obs!.provisioned) this.ready = this.setup(ws).catch(() => {}); }, 3000); // never stay half set up
        t.unref?.();
      });
    } else if (m.op === 5) this.onEvent(m.d.eventType, m.d.eventData ?? {});
    else if (m.op === 7) {
      const p = this.pending.get(m.d.requestId);
      if (!p) return;
      this.pending.delete(m.d.requestId);
      if (m.d.requestStatus.result) p.ok(m.d.responseData ?? {});
      else p.fail(Object.assign(new Error(`OBS: ${m.d.requestStatus.comment ?? "request " + m.d.requestType + " failed (code " + m.d.requestStatus.code + ")"}`), { code: m.d.requestStatus.code }));
    }
  }

  request(type: string, data?: object, timeoutMs = REQUEST_MS): Promise<any> {
    if (!this.s.connected || this.ws?.readyState !== WebSocket.OPEN) return Promise.reject(new Error(NOT_CONNECTED));
    const requestId = `fh-${++this.n}`;
    return new Promise((ok, fail) => {
      const t = setTimeout(() => { this.pending.delete(requestId); fail(new Error(`OBS request ${type} timed out after ${timeoutMs / 1000} s. OBS may be frozen or busy.`)); }, timeoutMs);
      this.pending.set(requestId, { ok: (d) => { clearTimeout(t); ok(d); }, fail: (e) => { clearTimeout(t); fail(e); } });
      const requestData = type === "CreateInput" ? { ...data, inputKind: this.versioned.get((data as any).inputKind) ?? (data as any).inputKind } : data;
      this.ws!.send(JSON.stringify({ op: 6, d: { requestType: type, requestId, requestData } }));
    });
  }
  private req = (type: string, data?: object, ms?: number) => this.request(type, data, ms);
  /** Public actions wait for provisioning to settle, then run. */
  private async need() {
    if (!this.s.connected) throw new Error(NOT_CONNECTED);
    await this.ready;
    if (!this.s.connected) throw new Error(NOT_CONNECTED);
  }

  /** Resolves with the event data, or null on timeout/disconnect. Create it BEFORE sending the request that causes the event. */
  private wait(type: string, pred: (d: any) => boolean, ms: number) {
    let done!: (d: any) => void;
    const p = new Promise<any>((r) => { done = r; });
    const w: Waiter = { type, pred, done: (d) => { clearTimeout(t); this.waiters.delete(w); done(d); } };
    const t = setTimeout(() => w.done(null), ms);
    this.waiters.add(w);
    return { p, cancel: () => w.done(null) };
  }

  // ---------------------------------------------------------------- setup + sync
  private flatpak?: boolean;
  /** Throws a plain message when a Flatpak OBS could not write to `dir` (OBS would stop with "bad output path"). */
  private reachable(dir: string) {
    this.flatpak ??= this.opts.flatpak ?? detectObs().kind === "flatpak";
    const why = this.flatpak ? flatpakUnreachable(dir) : null;
    if (why) throw new Error(why);
  }
  private replayDir() {
    let d = this.opts.replayDir ?? join(paths().dataDir, "replays");
    try { this.reachable(d); } catch { d = join(homedir(), ".cache", "fieldhouse", "replays"); } // replay clips are scratch files; keep them where OBS can write
    try { mkdirSync(d, { recursive: true }); } catch {}
    return d;
  }
  private overlayUrl() { const u = this.opts.overlayUrl; return (typeof u === "function" ? u() : u) ?? "http://127.0.0.1:8080/overlay"; }

  /** obs-websocket answers the handshake while OBS is still loading its scenes; requests then fail with 207 "not ready". Wait it out. */
  private async untilReady() {
    for (let i = 0; i < 240; i++) {
      try { await this.request("GetSceneList"); return; }
      catch (e: any) { if (e.code !== 207 || !this.s.connected) throw e; await sleep(250); }
    }
  }

  private async setup(ws: WebSocket) {
    clearInterval(this.poller);
    await this.untilReady();
    const v = await this.request("GetVersion").catch(() => ({}));
    this.s.obs!.version = v.obsVersion;
    this.kinds = new Set(((await this.request("GetInputKindList", { unversioned: true })).inputKinds ?? []) as string[]);
    this.versioned = new Map((((await this.request("GetInputKindList", { unversioned: false })).inputKinds ?? []) as string[]).map((k) => [k.replace(/_v\d+$/, ""), k]));
    await this.loadSidecar();
    this.detectHardware();
    await this.provision();
    if (ws !== this.ws) return;
    this.poller = setInterval(() => this.poll(), 1000);
    this.poller.unref?.();
  }

  /** Web pages drawn as their own OBS layers ("FH Ext <id>", src/obs-layers.ts). Remembered, so every provisioning/reconnect puts them back. */
  private ext = new ObsLayers((t, d) => this.request(t, d, 15000), () => [...SLOTS.map((n) => sceneOf(`cam${n}`)), REPLAY_SCENE]);
  async setExternalLayers(layers: Parameters<NonNullable<Engine["setExternalLayers"]>>[0]) {
    this.ext.set(layers);
    if (this.s.connected && this.s.obs?.provisioned && !this.provisioning) await this.ext.apply();
  }
  /** (Re)create the Fieldhouse scenes/inputs in OBS and resync. Safe to call any time; idempotent. */
  private provQ: Promise<unknown> = Promise.resolve();
  async provision(): Promise<void> { // one at a time: a reconnect's setup and an operator's "apply" must never interleave their OBS requests
    const run = this.provQ.catch(() => {}).then(() => this.provisionNow());
    this.provQ = run;
    return run;
  }
  private async provisionNow(): Promise<void> {
    if (!this.s.connected) throw new Error(NOT_CONNECTED);
    const o = this.s.obs!;
    this.provisioning = true;
    try {
      const rep: ProvisionReport = await provision((t, d, ms) => this.request(t, d, ms ?? 15000), { overlayUrl: this.overlayUrl(), inputKinds: this.kinds, replayDir: this.replayDir(), video: { settings: this.video(), encoders: this.hw } });
      Object.assign(o, { profile: rep.profile, replayBuffer: rep.replayBuffer, created: rep.scenes, notes: rep.notes, error: undefined });
      if (rep.notes.length) log("INFO", `OBS provisioning: ${rep.notes.join(" ")}`);
    } catch (e: any) { o.provisioned = false; o.error = `Video engine setup failed: ${e.message}`; log("ERROR", o.error); this.emit(); throw e; }
    finally { this.provisioning = false; }
    await this.refresh();
    await this.autoRoute();
    await this.ext.apply(true).catch((e) => log("WARN", `OBS web layers: ${e.message}`));
    o.provisioned = true;
    this.emit();
  }

  private async loadSidecar() {
    const r = await this.request("GetPersistentData", DATA).catch(() => null);
    const v = r?.slotValue;
    this.side = { slots: v?.slots ?? {}, network: Array.isArray(v?.network) ? v.network : [], audio: v?.audio && typeof v.audio === "object" ? v.audio : {} };
  }
  private saveSidecar() { return this.request("SetPersistentData", { ...DATA, slotValue: this.side }).catch(() => {}); }

  /** Full resync of scenes, inputs, mute/volume, outputs. */
  private async refresh() {
    const [sc, list, st] = await Promise.all([this.request("GetSceneList"), this.request("GetInputList"), this.request("GetStudioModeEnabled").catch(() => ({}))]);
    this.programScene = sc.currentProgramSceneName ?? null;
    this.previewScene = st.studioModeEnabled === false ? null : sc.currentPreviewSceneName ?? null;
    this.inputs = new Map((list.inputs as any[]).map((i) => [i.inputName, { kind: i.unversionedInputKind ?? i.inputKind, caps: i.inputKindCaps ?? 0 }]));
    const audio = [...this.inputs].filter(([, v]) => v.caps & AUDIO_CAP).map(([k]) => k);
    await Promise.all(audio.map(async (inputName) => {
      const [m, vol] = await Promise.all([this.request("GetInputMute", { inputName }), this.request("GetInputVolume", { inputName })]);
      this.mix.set(inputName, { muted: m.inputMuted, gainDb: vol.inputVolumeDb });
    }));
    for (const k of [...this.mix.keys()]) if (!this.inputs.has(k)) this.mix.delete(k);
    await this.pollOutputs();
    this.compose();
    this.emit();
  }

  private compose() {
    const s = this.s;
    s.program = idOfScene(this.programScene);
    s.preview = idOfScene(this.previewScene);
    s.sources = SLOTS.flatMap((slot) => {
      const id = `cam${slot}`, inp = this.inputs.get(camInput(id));
      if (!inp || inp.kind === "color_source") return []; // placeholder = empty slot
      const sc = this.side.slots[id], ms = this.media.get(camInput(id));
      const status: SourceInfo["status"] = !s.connected ? "missing" : ms === "OBS_MEDIA_STATE_OPENING" || ms === "OBS_MEDIA_STATE_BUFFERING" || ms === "OBS_MEDIA_STATE_ERROR" ? "reconnecting" : ms === "OBS_MEDIA_STATE_STOPPED" || ms === "OBS_MEDIA_STATE_NONE" ? "missing" : "ok";
      return [{ id, slot, deviceId: sc?.deviceId, label: sc?.label ?? `Camera ${slot}`, kind: sc?.kind ?? "usb", detail: sc?.detail ?? "", status, audio: this.meters.get(camInput(id)) ?? 0 }];
    });
    const labelOf = (name: string) => (this.side.audio[name]?.label ? this.side.audio[name].label : name === MIC ? "Microphone" : /^FH cam\d video$/.test(name) ? this.side.slots[name.slice(3, 7)]?.label ?? name : name);
    const roleOf = (name: string): MixerChannel["role"] => (name === MIC || /^FH Mic \d+$/.test(name) ? "mic" : /^FH Desktop/.test(name) ? "desktop" : /^FH cam\d video$/.test(name) ? "camera" : "other");
    const rank = (n: string) => (n === MIC ? 0 : n.startsWith("FH ") ? 1 : 2);
    s.mixer = [...this.mix].filter(([n]) => n !== OVERLAY && n !== REPLAY_MEDIA && !n.startsWith("FH probe") && !n.startsWith("FH Ext ") && // probes exist for a moment while devices are scanned
       !(n.startsWith("FH cam") && !s.sources.some((x) => camInput(x.id) === n)))
      .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
      .map(([id, m]): MixerChannel => ({ id, label: labelOf(id), level: m.muted ? 0 : this.meters.get(id) ?? 0, gainDb: m.gainDb, muted: m.muted, role: roleOf(id) }));
  }

  // ---------------------------------------------------------------- events + polling
  private onEvent(t: string, e: any) {
    for (const w of [...this.waiters]) if (w.type === t && w.pred(e)) w.done(e);
    const s = this.s;
    switch (t) {
      case "CurrentProgramSceneChanged": this.programScene = e.sceneName; s.program = idOfScene(e.sceneName); break;
      case "CurrentPreviewSceneChanged": this.previewScene = e.sceneName; s.preview = idOfScene(e.sceneName); break;
      case "StudioModeStateChanged": if (!e.studioModeEnabled) this.request("SetStudioModeEnabled", { studioModeEnabled: true }).catch(() => {}); return;
      case "StreamStateChanged":
        s.stream.live = e.outputActive || e.outputState === "OBS_WEBSOCKET_OUTPUT_RECONNECTING";
        s.stream.reconnecting = e.outputState === "OBS_WEBSOCKET_OUTPUT_RECONNECTING";
        if (e.outputState === "OBS_WEBSOCKET_OUTPUT_STARTED") s.stream.startedAt ??= Date.now();
        if (!s.stream.live) Object.assign(s.stream, { destination: undefined, startedAt: undefined, kbps: 0, reconnecting: false });
        break;
      case "RecordStateChanged":
        if (e.outputState === "OBS_WEBSOCKET_OUTPUT_STARTED") s.record = { active: true, file: e.outputPath || s.record.file, startedAt: s.record.startedAt ?? Date.now(), bytes: 0 };
        else if (e.outputState === "OBS_WEBSOCKET_OUTPUT_STOPPED") s.record = { active: false, file: e.outputPath || s.record.file, startedAt: s.record.startedAt, bytes: s.record.bytes };
        else return;
        break;
      case "ReplayBufferStateChanged": s.obs!.replayBuffer = !!e.outputActive; break;
      case "InputMuteStateChanged": { const m = this.mix.get(e.inputName); if (!m) return; m.muted = e.inputMuted; this.compose(); break; }
      case "InputVolumeChanged": { const m = this.mix.get(e.inputName); if (!m) return; m.gainDb = e.inputVolumeDb; this.compose(); break; }
      case "InputCreated": case "InputRemoved": case "InputNameChanged": case "SceneListChanged": this.later(); return;
      case "InputVolumeMeters": {
        for (const i of e.inputs as { inputName: string; inputLevelsMul: number[][] }[]) {
          const raw = meterLevel(Math.max(0, ...i.inputLevelsMul.map((c) => c[1] ?? 0))), old = this.meters.get(i.inputName) ?? 0;
          this.meters.set(i.inputName, raw > old ? raw : old * 0.75 + raw * 0.25); // quick attack, smooth release
        }
        const seen = new Set((e.inputs as { inputName: string }[]).map((i) => i.inputName));
        for (const k of this.meters.keys()) if (!seen.has(k)) this.meters.set(k, (this.meters.get(k) ?? 0) * 0.5);
        for (const x of s.sources) x.audio = this.meters.get(camInput(x.id)) ?? 0;
        for (const c of s.mixer) c.level = c.muted ? 0 : this.meters.get(c.id) ?? 0;
        this.emitMeters();
        return;
      }
      case "ExitStarted": return; // the socket closes right after; onDown reports it
      default: return;
    }
    this.emit();
  }

  private laterT?: ReturnType<typeof setTimeout>;
  private later() { clearTimeout(this.laterT); this.laterT = setTimeout(() => { if (this.s.connected) this.refresh().catch(() => {}); }, 300); this.laterT.unref?.(); }

  private async pollOutputs() {
    const s = this.s;
    const [stats, stream, rec, rb] = await Promise.all([this.request("GetStats"), this.request("GetStreamStatus"), this.request("GetRecordStatus"), this.request("GetReplayBufferStatus").catch(() => null)]);
    const now = Date.now();
    s.cpu = clamp(stats.cpuUsage ?? 0, 0, 100);
    s.diskFreeBytes = (stats.availableDiskSpace ?? 0) * 1024 * 1024; // OBS reports MB
    // OBS may have restarted mid-broadcast: believe GetStreamStatus/GetRecordStatus over our memory.
    s.stream.live = !!stream.outputActive;
    s.stream.reconnecting = !!stream.outputReconnecting;
    s.stream.droppedFrames = stream.outputSkippedFrames ?? 0;
    s.stream.kbps = this.lastBytes && stream.outputActive ? Math.max(0, Math.round(((stream.outputBytes - this.lastBytes.bytes) * 8) / Math.max(1, now - this.lastBytes.at))) : 0;
    this.lastBytes = stream.outputActive ? { bytes: stream.outputBytes ?? 0, at: now } : undefined;
    if (!stream.outputActive) { s.stream.destination = undefined; s.stream.startedAt = undefined; }
    else s.stream.startedAt ??= now - (stream.outputDuration ?? 0);
    if (rec.outputActive) {
      let bytes = rec.outputBytes ?? 0;
      if (!bytes && s.record.file) try { bytes = statSync(s.record.file).size; } catch {}
      s.record = { ...s.record, active: true, bytes, startedAt: s.record.startedAt ?? now - (rec.outputDuration ?? 0) };
    } else if (s.record.active) s.record.active = false;
    s.obs!.replayBuffer = !!rb?.outputActive;
    if (rb && !rb.outputActive && s.obs!.provisioned && !this.provisioning && !stream.outputActive && !rec.outputActive) this.request("StartReplayBuffer").catch(() => {}); // self-heal: someone stopped it, or a restart raced
  }

  private async poll() {
    if (this.polling || !this.s.connected) return;
    this.polling = true;
    try {
      if (++this.tick % 5 === 0) await this.refresh(); // scenes/inputs backup in case an event was missed
      else {
        await this.pollOutputs();
        for (const x of this.s.sources.filter((x) => this.inputs.get(camInput(x.id))?.kind === "ffmpeg_source"))
          this.media.set(camInput(x.id), (await this.request("GetMediaInputStatus", { inputName: camInput(x.id) }).catch(() => ({}))).mediaState ?? "");
        this.compose();
        this.emit();
      }
    } catch { /* connection dropped or OBS busy; next poll retries */ }
    finally { this.polling = false; }
  }

  /** Set the program scene and wait until OBS is done, including the studio-mode swap that moves the old program into preview
   *  a moment AFTER the program event (a preview set before that swap gets overwritten by it). */
  private async programTo(sceneName: string, ms: number) {
    const swapped = this.wait("CurrentPreviewSceneChanged", () => true, 700);
    const done = this.wait("CurrentProgramSceneChanged", (d) => d.sceneName === sceneName, ms);
    try { await this.request("SetCurrentProgramScene", { sceneName }); } catch (e) { done.cancel(); swapped.cancel(); throw e; }
    await done.p; await swapped.p;
  }

  /** Nothing of ours on air yet (fresh setup): put the first real camera in program and the next one in preview. */
  private async autoRoute() {
    if (this.s.stream.live || this.s.record.active || this.replayTask || !this.s.sources.length) return;
    const ids = this.s.sources.map((x) => x.id), isCam = (id: string | null) => !!id && ids.includes(id);
    let prog = this.s.program;
    if (!isCam(prog)) {
      prog = ids[0];
      await this.request("SetCurrentSceneTransition", { transitionName: "Cut" }).catch(() => {}); // nothing of ours is on air, so no fade; a cut also swaps preview at once
      await this.programTo(sceneOf(prog), 1500);
      this.programScene = sceneOf(prog); this.s.program = prog;
    }
    const want = ids.find((i) => i !== prog) ?? prog;
    if (!isCam(this.s.preview) || (this.s.preview === prog && want !== prog)) { await this.request("SetCurrentPreviewScene", { sceneName: sceneOf(want) }).catch(() => {}); this.previewScene = sceneOf(want); this.s.preview = want; }
  }

  // ---------------------------------------------------------------- devices and slots
  async detectDevices(): Promise<DeviceInfo[]> {
    await this.need();
    const found = await probeDevices((t, d, ms) => this.request(t, d, ms ?? 15000), this.kinds, PROBE_SCENE);
    const net = this.side.network.map((n) => networkDevice({ ...parseNetworkSource(n.url), label: n.label }));
    const all = [...found, ...net];
    for (const d of all) this.labels.set(d.id, d.label);
    const used = new Set(Object.values(this.side.slots).map((x) => x.deviceId));
    return all.map((d) => ({ ...d, inUse: used.has(d.id) }));
  }

  async addNetworkSource(url: string, label: string): Promise<DeviceInfo> {
    const n = parseNetworkSource(url, label);
    if (n.local && !existsSync(n.url)) throw new Error("That video file was not found. Check the path.");
    this.side.network = [...this.side.network.filter((x) => x.url !== n.url), { url: n.url, label: n.label }];
    if (this.s.connected) await this.saveSidecar();
    const d = networkDevice(n);
    this.labels.set(d.id, d.label);
    return d;
  }

  async setSlot(slot: number, deviceId: string | null, label?: string) {
    if (!Number.isInteger(slot) || slot < 1 || slot > 4) throw new Error(`slot must be 1-4, got ${slot}`);
    await this.need();
    const id = `cam${slot}`, scene = sceneOf(id), name = camInput(id);
    let kind = "color_source", settings: Record<string, unknown> = { color: 0xff1f2933, width: 1920, height: 1080 };
    let dev: Pick<DeviceInfo, "kind" | "detail"> | undefined;
    if (deviceId !== null) {
      if (isAudioDevice(deviceId)) throw new Error("That is a microphone. Microphones are added to the mixer automatically; pick a camera for this slot.");
      const ci = cameraInput(deviceId);
      if (ci.kind === "ffmpeg_source") { const n = parseNetworkSource(deviceId.slice("ffmpeg_source:".length)); if (n.local && !existsSync(n.url)) throw new Error("That video file was not found. Check the path."); }
      if (!this.kinds.has(ci.kind)) throw new Error("This computer's OBS cannot use that kind of source.");
      ({ kind, settings, device: dev } = ci);
    } else { const c = await canvasSize(this.req); settings = { ...settings, width: c.w, height: c.h }; }

    const cur = this.inputs.get(name);
    if (cur?.kind === kind) await this.request("SetInputSettings", { inputName: name, inputSettings: settings, overlay: false });
    else await this.replaceInput(scene, name, kind, settings, !!cur);
    if (deviceId === null) delete this.side.slots[id];
    else this.side.slots[id] = { label: (label ?? "").trim() || this.labels.get(deviceId) || this.side.network.find((x) => `ffmpeg_source:${x.url}` === deviceId)?.label || deviceId.slice(deviceId.indexOf(":") + 1), deviceId, kind: dev!.kind, detail: dev!.detail };
    await this.saveSidecar();
    this.media.delete(name);
    await this.refresh();
    await this.autoRoute();
    await this.refresh();
  }

  /** Swap an input for one of another kind, keeping its name. OBS 32 keeps a removed input alive as a zombie (name taken,
   *  cannot be re-added) when it was removed from a scene that is on air or in studio preview, so such a scene is parked first. */
  private async replaceInput(scene: string, name: string, kind: string, settings: Record<string, unknown>, exists: boolean) {
    const sc = await this.request("GetSceneList");
    const prog = sc.currentProgramSceneName as string, prev = sc.currentPreviewSceneName as string | null;
    const park = (not: string[]) => [...SLOTS.map((n) => sceneOf(`cam${n}`)), REPLAY_SCENE, PROBE_SCENE].find((x) => !not.includes(x))!;
    const cutTo = async (to: string) => { await this.request("SetCurrentSceneTransition", { transitionName: "Cut" }); await this.programTo(to, 1500); };
    if (exists && prog === scene) {
      if (this.s.stream.live || this.s.record.active) throw new Error("That camera is on air right now. Take another camera to air first, then change it.");
      await cutTo(park([scene, ...(prev ? [prev] : [])]));
    }
    if (exists && (await this.request("GetSceneList")).currentPreviewSceneName === scene) { await this.request("SetCurrentPreviewScene", { sceneName: PROBE_SCENE }); await sleep(150); }
    if (exists) await dropInput(this.req, scene, name);
    let r: any;
    for (let i = 0; ; i++) { // OBS frees the old input's name a moment after removal (error 601 until then)
      try { r = await this.request("CreateInput", { sceneName: scene, inputName: name, inputKind: kind, inputSettings: settings, sceneItemEnabled: true }); break; }
      catch (e: any) { if (e.code !== 601 || i >= 30) throw e; await sleep(100); }
    }
    await fitItem(this.req, scene, r.sceneItemId, await canvasSize(this.req));
    await this.request("SetSceneItemIndex", { sceneName: scene, sceneItemId: r.sceneItemId, sceneItemIndex: 0 });
    if (exists && prog === scene) { await cutTo(scene); await this.request("SetCurrentPreviewScene", { sceneName: prev && prev !== scene ? prev : park([scene]) }).catch(() => {}); }
    else if (exists && prev === scene) await this.request("SetCurrentPreviewScene", { sceneName: scene }).catch(() => {});
  }

  // ---------------------------------------------------------------- transport
  async setPreview(sourceId: string) {
    await this.need();
    const src = this.s.sources.find((x) => x.id === sourceId);
    if (!src) throw new Error(`no such source: ${sourceId}`);
    if (src.status !== "ok") throw new Error(`source ${sourceId} (${src.label}) is ${src.status}, not ready for preview`);
    await this.request("SetCurrentPreviewScene", { sceneName: sceneOf(sourceId) });
    this.previewScene = sceneOf(sourceId); this.s.preview = sourceId;
    this.emit();
  }

  private async transition(name: "Cut" | "Fade", ms: number) {
    if (!this.s.preview) throw new Error("Choose what goes next (preview) before taking it to air.");
    await this.request("SetCurrentSceneTransition", { transitionName: name });
    if (name === "Fade") await this.request("SetCurrentSceneTransitionDuration", { transitionDuration: ms });
    const done = this.wait("CurrentProgramSceneChanged", () => true, ms + 2000);
    try { await this.request("TriggerStudioModeTransition"); } catch (e) { done.cancel(); throw e; }
    await done.p;
  }
  async cut() { await this.need(); await this.transition("Cut", 0); }
  async fade(ms: number) { await this.need(); this.fadeMs = clamp(Math.round(Number(ms) || 0), 50, 20000); await this.transition("Fade", this.fadeMs); }

  // ---------------------------------------------------------------- stream + record
  async startStream(dest: { name: string; url: string; key: string }) {
    if (!dest.key?.trim()) throw new Error(`destination "${dest.name}" has no stream key`);
    await this.need();
    if (this.s.stream.live) throw new Error("already streaming");
    // OBS answers a failed connect with its own modal dialog on the desktop, so StartStream is only called for an address that
    // already accepted a TCP connection from here (destination-check.ts).
    const chk = await (this.opts.precheck ?? checkDestination)(dest.url);
    if (!chk.ok) throw new Error(`${dest.name}: ${chk.message}`);
    delete this.s.obs!.lost;
    await this.request("SetStreamServiceSettings", { streamServiceType: "rtmp_custom", streamServiceSettings: { server: dest.url, key: dest.key } });
    const started = this.wait("StreamStateChanged", (d) => d.outputState === "OBS_WEBSOCKET_OUTPUT_STARTED" || d.outputState === "OBS_WEBSOCKET_OUTPUT_STOPPED", 20000);
    try { await this.request("StartStream", {}, 10000); } catch (e) { started.cancel(); throw e; }
    const ev = await started.p;
    if (!ev || ev.outputState === "OBS_WEBSOCKET_OUTPUT_STOPPED") {
      if (!ev) await this.request("StopStream").catch(() => {});
      throw new Error(`The video engine could not connect to ${dest.name}. Check the server address, the stream key and the internet connection.`);
    }
    Object.assign(this.s.stream, { live: true, destination: dest.name, startedAt: Date.now() });
    this.emit();
  }
  async stopStream() {
    await this.need();
    if (!this.s.stream.live) return;
    const stopped = this.wait("StreamStateChanged", (d) => d.outputState === "OBS_WEBSOCKET_OUTPUT_STOPPED", 15000);
    try { await this.request("StopStream"); } catch (e) { stopped.cancel(); throw e; }
    await stopped.p;
    this.s.stream = { live: false, kbps: 0, droppedFrames: this.s.stream.droppedFrames, reconnecting: false };
    this.emit();
  }

  async startRecord(dir: string, name: string) {
    await this.need();
    if (this.s.record.active) throw new Error("already recording");
    this.reachable(dir);
    delete this.s.obs!.lost;
    try { mkdirSync(dir, { recursive: true }); } catch (e: any) { throw new Error(`Cannot create the recording folder ${dir}: ${e.message}`); }
    const fmt = String((await this.request("GetProfileParameter", { parameterCategory: "SimpleOutput", parameterName: "RecFormat2" }).catch(() => ({}))).parameterValue ?? "");
    if (fmt === "mp4" || fmt === "mov") await this.request("SetProfileParameter", { parameterCategory: "SimpleOutput", parameterName: "RecFormat2", parameterValue: "hybrid_mp4" }); // plain mp4 is lost if the engine or the PC dies
    await this.request("SetRecordDirectory", { recordDirectory: dir });
    await this.request("SetProfileParameter", { parameterCategory: "Output", parameterName: "FilenameFormatting", parameterValue: name.replace(/[^\w.-]/g, "_") });
    const started = this.wait("RecordStateChanged", (d) => d.outputState === "OBS_WEBSOCKET_OUTPUT_STARTED" || d.outputState === "OBS_WEBSOCKET_OUTPUT_STOPPED", 10000);
    try { await this.request("StartRecord", {}, 10000); } catch (e) { started.cancel(); throw e; }
    const ev = await started.p;
    if (!ev || ev.outputState !== "OBS_WEBSOCKET_OUTPUT_STARTED") throw new Error(`The video engine did not start recording within 10 seconds. Check that ${dir} exists and has free space.`);
    const file: string | undefined = ev.outputPath || (await this.request("GetRecordStatus").catch(() => ({}))).outputPath;
    if (!file) throw new Error("Recording started but the video engine did not say where the file is. Check the recording folder in Settings > Storage.");
    this.s.record = { active: true, file, startedAt: Date.now(), bytes: 0 };
    this.emit();
    return file;
  }

  async stopRecord() {
    await this.need();
    if (!this.s.record.active) return;
    const stopped = this.wait("RecordStateChanged", (d) => d.outputState === "OBS_WEBSOCKET_OUTPUT_STOPPED", 30000);
    let r: any;
    try { r = await this.request("StopRecord", {}, 15000); } catch (e) { stopped.cancel(); throw e; }
    const ev = await stopped.p; // STOPPED comes after OBS finalized the file
    if (!ev) throw new Error("The video engine is taking a long time to finish the recording. Wait before closing Fieldhouse or unplugging the drive.");
    const file = ev.outputPath || r.outputPath || this.s.record.file;
    let bytes = this.s.record.bytes;
    if (file) try { bytes = statSync(file).size; } catch {}
    this.s.record = { active: false, file, startedAt: this.s.record.startedAt, bytes };
    this.emit();
  }

  // ---------------------------------------------------------------- audio
  async setMute(mixerId: string, muted: boolean) { await this.need(); await this.request("SetInputMute", { inputName: mixerId, inputMuted: muted }); }
  async setGain(mixerId: string, gainDb: number) { await this.need(); await this.request("SetInputVolume", { inputName: mixerId, inputVolumeDb: clamp(Number(gainDb), -100, 26) }); }

  // ---------------------------------------------------------------- instant replay
  /** Save the OBS replay buffer, play its last `secondsBack` seconds through "FH Replay" on air, then return to the previous scene. */
  async replay(o: { secondsBack: number; speed: number }) {
    if (!(o.secondsBack > 0) || !(o.speed > 0)) throw new Error("replay needs secondsBack > 0 and speed > 0");
    await this.need();
    if (this.replayTask) await this.replayTask.abort();
    if (!this.s.obs!.replayBuffer) throw new Error("Instant replay is off because the replay buffer is not running. Open Settings > Video engine and press Repair.");
    const back = clamp(o.secondsBack, 1, Math.max(10, this.video().replaySeconds - 2)), speed = clamp(o.speed, 0.1, 4);
    const back_to = idOfScene(this.programScene) === "replay" ? this.s.preview ? sceneOf(this.s.preview) : null : this.programScene;
    const prevPreview = this.previewScene; // studio mode swaps preview and program on every program change
    let aborted = false, endWait: { cancel: () => void } | undefined;
    let started!: () => void, failed!: (e: Error) => void;
    const startedP = new Promise<void>((ok, no) => { started = ok; failed = no; });
    const restore = async () => {
      this.s.replay.active = false;
      if (back_to && this.s.connected) {
        await this.request("SetCurrentSceneTransition", { transitionName: aborted ? "Cut" : "Fade" }).catch(() => {});
        if (!aborted) await this.request("SetCurrentSceneTransitionDuration", { transitionDuration: this.fadeMs }).catch(() => {});
        await this.programTo(back_to, (aborted ? 0 : this.fadeMs) + 1500);
        if (prevPreview && prevPreview !== REPLAY_SCENE) await this.request("SetCurrentPreviewScene", { sceneName: prevPreview }).catch(() => {});
      }
      this.emit();
    };
    const task = (async () => {
      let onAir = false;
      try {
        const saved = this.wait("ReplayBufferSaved", () => true, 10000);
        try { await this.request("SaveReplayBuffer", {}, 10000); } catch (e) { saved.cancel(); throw e; }
        const ev = await saved.p;
        if (!ev?.savedReplayPath) throw new Error("The replay was not saved in time. Is the game video running?");
        this.rememberReplay(ev.savedReplayPath);
        await this.request("SetInputSettings", { inputName: REPLAY_MEDIA, inputSettings: { local_file: "" }, overlay: true }); // identical settings would not make OBS reopen a rewritten file
        await this.request("SetInputSettings", { inputName: REPLAY_MEDIA, inputSettings: { is_local_file: true, local_file: ev.savedReplayPath, speed_percent: Math.round(speed * 100), looping: false, close_when_inactive: false, restart_on_activate: false, clear_on_media_end: false }, overlay: true });
        let dur = 0;
        for (let i = 0; i < 40 && !(dur > 0); i++) { dur = (await this.request("GetMediaInputStatus", { inputName: REPLAY_MEDIA })).mediaDuration ?? 0; if (!(dur > 0)) await sleep(100); } // OBS answers a huge negative number while the file is still opening
        if (!(dur > 0)) throw new Error("The saved replay could not be opened.");
        const from = Math.max(0, dur - back * 1000);
        await this.request("TriggerMediaInputAction", { inputName: REPLAY_MEDIA, mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE" });
        await this.request("SetMediaInputCursor", { inputName: REPLAY_MEDIA, mediaCursor: Math.round(from) });
        if (aborted) throw new Error("replay stopped");
        this.s.replay.active = true; this.emit();
        await this.request("SetCurrentSceneTransition", { transitionName: "Fade" });
        await this.request("SetCurrentSceneTransitionDuration", { transitionDuration: Math.min(this.fadeMs, 500) });
        const end = this.wait("MediaInputPlaybackEnded", (d) => d.inputName === REPLAY_MEDIA, (dur - from) / speed + 4000);
        endWait = end;
        onAir = true;
        await this.programTo(REPLAY_SCENE, this.fadeMs + 1500);
        await this.request("TriggerMediaInputAction", { inputName: REPLAY_MEDIA, mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY" });
        started();
        // The ended event is not reliable for every file, so also watch the cursor.
        const watch = setInterval(async () => { const m = await this.request("GetMediaInputStatus", { inputName: REPLAY_MEDIA }).catch(() => null); if (m && (m.mediaState === "OBS_MEDIA_STATE_ENDED" || (m.mediaCursor ?? 0) >= dur - 150)) end.cancel(); }, 150);
        try { await end.p; } finally { clearInterval(watch); } // ended, aborted or timed out: all return to the previous scene
      } catch (e: any) { if (!aborted) failed(e); else started(); }
      finally { await restore(); this.replayTask = undefined; if (!onAir) started(); }
    })();
    this.replayTask = { abort: async () => { aborted = true; endWait?.cancel(); await task; } };
    await startedP;
  }
  async stopReplay() { await this.replayTask?.abort(); this.s.replay.active = false; this.emit(); }

  private rememberReplay(path: string) {
    this.savedReplays.push(path);
    while (this.savedReplays.length > 3) { const old = this.savedReplays.shift()!; if (basename(old).startsWith("Replay")) try { unlinkSync(old); } catch {} } // clips are scratch files; keep only the latest few
  }

  // ---------------------------------------------------------------- settings: video, audio inputs, per-camera options
  private video(): VideoSettings { return this.opts.video?.() ?? DEFAULT_VIDEO; }
  private logDir() { return this.opts.logDir ?? obsLogDir(detectObs().kind ?? "native", { home: homedir(), env: process.env }); }
  /** The encoders OBS itself lists in its start-up log. If the log cannot be read we offer nothing hardware (see video-settings.ts). */
  private detectHardware() {
    try { const f = latestLog(this.logDir()); this.encoderIds = f ? parseEncoders(readSlice(f, 0, 200_000)) : []; } catch { this.encoderIds = []; }
    this.hw = encoderOptions(this.encoderIds).map((o) => o.id).filter((id) => id !== "auto" && id !== "x264");
  }
  private encoderList(): EncoderOption[] { return encoderOptions(this.encoderIds); }

  async videoInfo() {
    await this.need();
    const v = this.video();
    return { applied: await readApplied(this.req), encoders: this.encoderList(), encoderInUse: resolveEncoder(v.encoder, v, this.hw).id };
  }

  /** Apply the saved quality settings. While a broadcast runs nothing is written to OBS (it would drop the stream or be ignored). */
  async applyVideo(v: VideoSettings): Promise<VideoApplied> {
    await this.need();
    const before = await readApplied(this.req);
    if (this.s.stream.live || this.s.record.active) {
      const blocked = liveBlocked({ ...v, resolution: before.outputHeight >= 1080 ? "1080p" : "720p", fps: before.fps === 60 ? 60 : 30, encoder: this.video().encoder }, v);
      if (blocked) throw new Error(blocked);
      return before; // the rest is saved by the caller and applied when the broadcast ends
    }
    const want = dims(v), enc = resolveEncoder(v.encoder, v, this.hw);
    const heavy = before.outputWidth !== want.outputWidth || before.outputHeight !== want.outputHeight || before.fps !== v.fps || before.encoder !== enc.id;
    if (heavy && this.opts.restartForVideo) { // size, frame rate and encoder are never changed in a live OBS: that is what crashed it
      for (let i = 0; i < 50; i++) { // a recording that was just stopped is still being finalized: closing OBS now could lose it
        const [st, rc] = await Promise.all([this.request("GetStreamStatus"), this.request("GetRecordStatus")]);
        if (!st.outputActive && !rc.outputActive) break;
        if (i === 49) throw new Error("A recording is still being finished. Try again in a few seconds.");
        await sleep(200);
      }
      const gen = this.connGen;
      await this.opts.restartForVideo();
      const t = Date.now(), back = () => this.connGen > gen && this.s.connected && this.s.obs!.provisioned;
      while (!back() && Date.now() - t < 90_000) await sleep(200);
      if (!back()) throw new Error("The video engine did not come back after applying the settings. Fieldhouse keeps trying; the settings are saved.");
      await this.ready;
    } else await this.provision(); // only bitrate, format, replay length: written to the profile, replay buffer restarted
    const after = await readApplied(this.req);
    const off = differences(v, after, resolveEncoder(v.encoder, v, this.hw).id);
    if (off.length) throw new Error(`The video engine did not accept the ${off.join(", ")}. The other settings were applied; the engine still reports its previous value.`);
    return after;
  }

  private mixerOf(name: string): AudioInput | undefined {
    const c = this.s.mixer.find((m) => m.id === name);
    if (!c) return undefined;
    const managed = isManagedAudio(name);
    return { id: c.id, label: c.label, role: c.role ?? "other", deviceId: "", deviceLabel: "", managed, removable: managed && name !== MIC, level: c.level, gainDb: c.gainDb, muted: c.muted };
  }

  async audioInputs(): Promise<AudioList> {
    await this.need();
    const devices = (await this.detectDevices()).filter((d) => d.kind === "audio");
    const inputs: AudioInput[] = [];
    for (const c of this.s.mixer) {
      const a = this.mixerOf(c.id)!;
      if (a.managed || a.role === "other") {
        const dev = String((await this.request("GetInputSettings", { inputName: c.id }).catch(() => ({}))).inputSettings?.device_id ?? "");
        const kind = this.inputs.get(c.id)?.kind ?? "";
        a.deviceId = dev ? `${kind}:${dev}` : "";
        a.deviceLabel = devices.find((d) => d.id === a.deviceId)?.label ?? (dev === "default" ? "Default device" : dev);
      }
      inputs.push(a);
    }
    return { inputs, devices, canDesktop: DESKTOP_KINDS.some((k) => this.kinds.has(k)) };
  }

  async addAudio(o: { role: "mic" | "desktop"; deviceId?: string; label: string }): Promise<AudioInput> {
    await this.need();
    if (o.role !== "mic" && o.role !== "desktop") throw new Error("Choose a microphone or desktop / room sound.");
    const kinds = o.role === "mic" ? MIC_KINDS : DESKTOP_KINDS;
    let kind = kinds.find((k) => this.kinds.has(k)), value = "default";
    if (o.deviceId) {
      const d = parseDeviceId(o.deviceId);
      if (!isAudioDevice(o.deviceId) && !DESKTOP_KINDS.includes(d.kind)) throw new Error("That device is not an audio device.");
      if (!kinds.includes(d.kind)) throw new Error(o.role === "mic" ? "That device is not a microphone." : "That device cannot capture desktop sound.");
      kind = d.kind; value = d.value;
    }
    if (!kind || !this.kinds.has(kind)) throw new Error(o.role === "mic" ? "This computer's video engine cannot capture a microphone." : "Desktop / room sound capture is not available on this computer.");
    const label = o.label.trim().slice(0, 40) || (o.role === "mic" ? "Microphone" : "Desktop sound");
    const base = o.role === "mic" ? "FH Mic" : "FH Desktop";
    let name = base, n = 2;
    while (this.inputs.has(name)) name = `${base} ${n++}`;
    if (n > 12) throw new Error("That is enough audio inputs. Remove one before adding another.");
    const scenes = [...SLOTS.map((x) => sceneOf(`cam${x}`)), REPLAY_SCENE];
    await this.request("CreateInput", { sceneName: scenes[0], inputName: name, inputKind: kind, inputSettings: { device_id: value }, sceneItemEnabled: true });
    for (const sc of scenes.slice(1)) await this.request("CreateSceneItem", { sceneName: sc, sourceName: name }).catch(() => {});
    this.side.audio[name] = { label, role: o.role };
    await this.saveSidecar();
    await this.refresh();
    return this.mixerOf(name)!;
  }

  async updateAudio(id: string, p: { label?: string; deviceId?: string; gainDb?: number; muted?: boolean }): Promise<AudioInput> {
    await this.need();
    if (!this.mix.has(id)) throw new Error("That audio input does not exist.");
    const managed = isManagedAudio(id);
    if (p.label !== undefined) {
      if (!managed) throw new Error("Only inputs added by Fieldhouse can be renamed.");
      this.side.audio[id] = { role: this.side.audio[id]?.role ?? (id.startsWith("FH Desktop") ? "desktop" : "mic"), label: String(p.label).trim().slice(0, 40) || id };
      await this.saveSidecar();
    }
    if (p.deviceId !== undefined) {
      if (!managed) throw new Error("Only inputs added by Fieldhouse can be pointed at another device.");
      const d = parseDeviceId(p.deviceId), cur = this.inputs.get(id)?.kind;
      if (d.kind !== cur) throw new Error("That device is a different kind of input. Remove this input and add a new one.");
      await this.request("SetInputSettings", { inputName: id, inputSettings: { device_id: d.value }, overlay: true });
    }
    if (p.gainDb !== undefined) await this.setGain(id, p.gainDb);
    if (p.muted !== undefined) await this.setMute(id, !!p.muted);
    await this.refresh();
    return this.mixerOf(id)!;
  }

  async removeAudio(id: string): Promise<void> {
    await this.need();
    if (!isManagedAudio(id) || id === MIC) throw new Error("Only extra inputs added by Fieldhouse can be removed.");
    if (!this.mix.has(id)) throw new Error("That audio input does not exist.");
    for (const sc of [...SLOTS.map((x) => sceneOf(`cam${x}`)), REPLAY_SCENE]) {
      const sid = await this.request("GetSceneItemId", { sceneName: sc, sourceName: id }).then((r) => r.sceneItemId, () => null);
      if (sid != null) await this.request("RemoveSceneItem", { sceneName: sc, sceneItemId: sid }).catch(() => {}); // OBS 32 keeps the input alive until its scene items are gone
    }
    await this.request("RemoveInput", { inputName: id }).catch(() => {});
    for (let i = 0; i < 30; i++) { // wait until OBS really forgot it, so the next setup does not meet a half-removed input
      const list = ((await this.request("GetInputList").catch(() => ({ inputs: [] }))).inputs ?? []) as { inputName: string }[];
      if (!list.some((x) => x.inputName === id)) break;
      await sleep(100);
    }
    delete this.side.audio[id]; this.mix.delete(id); this.meters.delete(id);
    await this.saveSidecar();
    await this.refresh();
  }

  private slotInput(slot: number) {
    if (!Number.isInteger(slot) || slot < 1 || slot > 4) throw new Error(`slot must be 1-4, got ${slot}`);
    const name = camInput(`cam${slot}`), cur = this.inputs.get(name);
    if (!cur || cur.kind === "color_source") throw new Error("That slot is empty.");
    return { name, kind: cur.kind };
  }
  private async listOf(inputName: string, propertyName: string) {
    const r = await this.request("GetInputPropertiesListPropertyItems", { inputName, propertyName }).catch(() => null);
    return ((r?.propertyItems ?? []) as { itemName: string; itemValue: unknown; itemEnabled?: boolean }[]).filter((i) => i.itemEnabled !== false && i.itemValue !== "" && i.itemValue != null).map((i) => ({ value: JSON.stringify(i.itemValue), label: String(i.itemName).replace(/_/g, " ") }));
  }

  async sourceOptions(slot: number): Promise<SourceOptions> {
    await this.need();
    const { name, kind } = this.slotInput(slot);
    const cfg = (await this.request("GetInputSettings", { inputName: name })).inputSettings ?? {};
    const label = this.side.slots[`cam${slot}`]?.label ?? `Camera ${slot}`;
    if (kind === "ffmpeg_source") {
      const file = cfg.is_local_file === true;
      return { slot, type: file ? "file" : "network", label, address: maskAddress(String(file ? cfg.local_file : cfg.input) ?? ""), resolutions: [], framerates: [], reconnectSeconds: file ? undefined : Number(cfg.reconnect_delay_sec), bufferingMb: file ? undefined : Number(cfg.buffering_mb), canReconnect: true };
    }
    const props = CAM_PROPS[kind];
    if (!props) return { slot, type: "other", label, resolutions: [], framerates: [], canReconnect: false };
    const resolutions = await this.listOf(name, props.res), framerates = props.fps ? await this.listOf(name, props.fps) : [];
    const cur = (k?: string) => (k && cfg[k] !== undefined ? JSON.stringify(cfg[k]) : undefined);
    return { slot, type: "camera", label, resolution: cur(props.res), framerate: cur(props.fps), resolutions, framerates, canReconnect: false };
  }

  async setSourceOptions(slot: number, p: SourceOptionsPatch): Promise<SourceOptions> {
    await this.need();
    const { name, kind } = this.slotInput(slot);
    const cur = (await this.request("GetInputSettings", { inputName: name })).inputSettings ?? {};
    const set: Record<string, unknown> = {};
    if (kind === "ffmpeg_source") {
      if (p.reconnectSeconds !== undefined) { if (cur.is_local_file) throw new Error("A video file has no connection to retry."); if (!Number.isInteger(p.reconnectSeconds) || p.reconnectSeconds < 1 || p.reconnectSeconds > 60) throw new Error("Retry after must be a whole number of seconds from 1 to 60."); set.reconnect_delay_sec = p.reconnectSeconds; }
      if (p.bufferingMb !== undefined) { if (cur.is_local_file) throw new Error("A video file needs no buffer."); if (!Number.isInteger(p.bufferingMb) || p.bufferingMb < 1 || p.bufferingMb > 16) throw new Error("The buffer must be a whole number of megabytes from 1 to 16."); set.buffering_mb = p.bufferingMb; }
    } else {
      const props = CAM_PROPS[kind];
      if (!props) throw new Error("This kind of source has no settings to change.");
      for (const [val, key, list] of [[p.resolution, props.res, "resolution"], [p.framerate, props.fps, "framerate"]] as const) {
        if (val === undefined) continue;
        if (!key) throw new Error(`This camera does not offer a ${list} choice.`);
        const ok = (await this.listOf(name, key)).find((i) => i.value === val);
        if (!ok) throw new Error(`That ${list} is not one the camera offers.`);
        set[key] = JSON.parse(val);
      }
      if (Object.keys(set).length && props.custom) Object.assign(set, props.custom);
    }
    if (Object.keys(set).length) {
      await this.request("SetInputSettings", { inputName: name, inputSettings: set, overlay: true });
      const back = (await this.request("GetInputSettings", { inputName: name })).inputSettings ?? {};
      const bad = Object.keys(set).filter((k) => JSON.stringify(back[k]) !== JSON.stringify(set[k]));
      if (bad.length) throw new Error("The source did not accept that setting.");
    }
    if (p.restart && kind === "ffmpeg_source") await this.request("TriggerMediaInputAction", { inputName: name, mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART" });
    return this.sourceOptions(slot);
  }

  // ---------------------------------------------------------------- stills
  /** program/preview = the scene on air / next (graphics included); camN = that camera input alone; replay = the replay scene. */
  snapshot(id: string) {
    const hit = this.snaps.get(id), now = Date.now();
    if (hit && now - hit.at < 150) return hit.p;
    const name = id === "program" ? this.programScene : id === "preview" ? this.previewScene : id === "replay" ? REPLAY_SCENE : /^cam[1-4]$/.test(id) && this.s.sources.some((x) => x.id === id) ? camInput(id) : null;
    const p = !name || !this.s.connected ? Promise.resolve(null)
      : this.request("GetSourceScreenshot", { sourceName: name, imageFormat: "jpg", imageWidth: 640, imageHeight: 360, imageCompressionQuality: 70 })
        .then((r) => ({ type: "image/jpeg", body: Buffer.from(String(r.imageData).split(",")[1] ?? "", "base64") as Uint8Array }), () => null);
    this.snaps.set(id, { at: now, p });
    return p;
  }

  async close() {
    this.closed = true;
    clearTimeout(this.retry); clearTimeout(this.meterTimer); clearTimeout(this.laterT); clearInterval(this.poller);
    for (const w of [...this.waiters]) w.done(null);
    this.listeners.clear();
    this.ws?.close();
  }
}
