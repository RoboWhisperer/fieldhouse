// Media engines behind the Engine interface (src/types.ts). FakeEngine is the believable simulator used for
// dev, demos, tests and CI soak; ObsEngine (src/obs.ts) drives a real OBS Studio.
import { mkdirSync, statSync, statfsSync, writeFileSync, readFileSync } from "node:fs";
import type { AudioInput, AudioList, DeviceInfo, Engine, EngineStatus, MixerChannel, SourceInfo, SourceOptions, SourceOptionsPatch, VideoApplied, VideoSettings } from "./types";
import { DEFAULT_VIDEO, REC_FORMAT, dims, encoderOptions, liveBlocked, resolveEncoder } from "./video-settings";
import type { ManagedStatus } from "./obs-supervisor";
import { ObsEngine } from "./obs";
import { maskAddress, networkDetail, networkDeviceId, parseNetworkSource } from "./source-url";
// Embedded at compile time so the standalone sidecar binary needs no asset files on disk.
import feedCenter from "./assets/feeds/feed-center.svg" with { type: "text" };
import feedBaseline from "./assets/feeds/feed-baseline.svg" with { type: "text" };
import feedBench from "./assets/feeds/feed-bench.svg" with { type: "text" };
import feedScoreboard from "./assets/feeds/feed-scoreboard.svg" with { type: "text" };
const FEED_SVG: Record<string, string> = { center: feedCenter, baseline: feedBaseline, bench: feedBench, scoreboard: feedScoreboard };

export interface EngineOpts { obsUrl?: string; obsPassword?: string; overlayUrl?: string | (() => string); video?: () => VideoSettings; restartForVideo?: () => Promise<void> }
export function createEngine(kind: "fake" | "obs", opts: EngineOpts = {}): Engine {
  return kind === "obs" ? new ObsEngine(opts.obsUrl ?? "ws://127.0.0.1:4455", opts.obsPassword, { overlayUrl: opts.overlayUrl, video: opts.video, restartForVideo: opts.restartForVideo }) : new FakeEngine();
}
const unsupported = (what: string) => new Error(`This engine cannot ${what}.`);

/** Delegates to the current engine and can replace it at runtime (Settings > Engine), re-emitting change. */
export class SwitchableEngine implements Engine {
  private cur: Engine;
  private off?: () => void;
  private listeners = new Set<() => void>();
  constructor(kind: "fake" | "obs", private opts: EngineOpts = {}) { this.cur = createEngine(kind, opts); this.off = this.cur.onChange(() => this.emit()); }
  get current() { return this.cur; }
  /** server.ts plugs the video-engine supervisor in (src/obs-supervisor.ts); its state is merged into status().obs.managed. */
  managed?: () => ManagedStatus | undefined;
  private emit() { for (const cb of [...this.listeners]) cb(); }
  async swap(kind: "fake" | "obs", opts: EngineOpts = {}) {
    const old = this.cur;
    this.off?.();
    this.opts = { ...this.opts, ...opts };
    this.cur = createEngine(kind, this.opts);
    this.off = this.cur.onChange(() => this.emit());
    this.emit();
    await old.close();
  }
  status() {
    const st = this.cur.status(), m = this.managed?.();
    if (st.engine === "obs" && st.obs && m && m.state !== "off") {
      st.obs.managed = m;
      if (!st.connected && !["running", "adopted"].includes(m.state)) st.obs.error = m.message; // the plain-language reason beats "Reconnecting..."
    }
    return st;
  }
  onChange(cb: () => void) { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }
  detectDevices() { return this.cur.detectDevices(); }
  setSlot(slot: number, deviceId: string | null, label?: string) { return this.cur.setSlot(slot, deviceId, label); }
  setPreview(id: string) { return this.cur.setPreview(id); }
  cut() { return this.cur.cut(); }
  fade(ms: number) { return this.cur.fade(ms); }
  startStream(d: { name: string; url: string; key: string }) { return this.cur.startStream(d); }
  stopStream() { return this.cur.stopStream(); }
  startRecord(dir: string, basename: string) { return this.cur.startRecord(dir, basename); }
  stopRecord() { return this.cur.stopRecord(); }
  setMute(id: string, muted: boolean) { return this.cur.setMute(id, muted); }
  setGain(id: string, db: number) { return this.cur.setGain(id, db); }
  replay(o: { secondsBack: number; speed: number }) { return this.cur.replay(o); }
  stopReplay() { return this.cur.stopReplay(); }
  snapshot(id: string) { return this.cur.snapshot(id); }
  async addNetworkSource(url: string, label: string) { if (!this.cur.addNetworkSource) throw new Error("This engine cannot add network sources."); return this.cur.addNetworkSource(url, label); }
  async provision() { if (!this.cur.provision) throw new Error("Only the OBS engine has a setup to repair."); return this.cur.provision(); }
  videoInfo() { return this.cur.videoInfo ? this.cur.videoInfo() : Promise.reject(unsupported("change video settings")); }
  applyVideo(v: VideoSettings) { return this.cur.applyVideo ? this.cur.applyVideo(v) : Promise.reject(unsupported("change video settings")); }
  audioInputs() { return this.cur.audioInputs ? this.cur.audioInputs() : Promise.reject(unsupported("manage audio inputs")); }
  addAudio(o: { role: "mic" | "desktop"; deviceId?: string; label: string }) { return this.cur.addAudio ? this.cur.addAudio(o) : Promise.reject(unsupported("manage audio inputs")); }
  updateAudio(id: string, p: { label?: string; deviceId?: string; gainDb?: number; muted?: boolean }) { return this.cur.updateAudio ? this.cur.updateAudio(id, p) : Promise.reject(unsupported("manage audio inputs")); }
  removeAudio(id: string) { return this.cur.removeAudio ? this.cur.removeAudio(id) : Promise.reject(unsupported("manage audio inputs")); }
  sourceOptions(slot: number) { return this.cur.sourceOptions ? this.cur.sourceOptions(slot) : Promise.reject(unsupported("change source settings")); }
  setSourceOptions(slot: number, p: SourceOptionsPatch) { return this.cur.setSourceOptions ? this.cur.setSourceOptions(slot, p) : Promise.reject(unsupported("change source settings")); }
  get simulate() { return (this.cur as any).simulate?.bind(this.cur); } // dev route hook, FakeEngine only
  async close() { this.off?.(); this.listeners.clear(); await this.cur.close(); }
}

const TICK_MS = 250;
const GB = 1e9;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const walk = (v: number, step = 0.12) => clamp(v + (Math.random() - 0.5) * step * 2, 0, 1);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Stable fake hardware list. id -> [label, kind, detail]
const DEVICES: DeviceInfo[] = [
  { id: "usb-brio", label: "Logitech Brio (USB)", kind: "usb", detail: "1080p60", inUse: false },
  { id: "usb-camlink", label: "Elgato Cam Link 4K", kind: "usb", detail: "1080p60", inUse: false },
  { id: "ndi-coach", label: "NDI: Coach iPhone", kind: "ndi", detail: "1080p30", inUse: false },
  { id: "srt-press", label: "SRT: Press-box cam", kind: "srt", detail: "1080p30", inUse: false },
  { id: "audio-scarlett", label: "Scarlett 2i2 (audio)", kind: "audio", detail: "48 kHz", inUse: false },
  { id: "audio-desktop", label: "Desktop sound (monitor of built-in audio)", kind: "audio", detail: "Desktop audio", inUse: false },
  { id: "screen-scoreboard", label: "Screen capture: scoreboard PC", kind: "screen", detail: "1080p30", inUse: false },
];

const FEED_FILES: Record<string, string> = { cam1: "center", cam2: "baseline", cam3: "bench", cam4: "scoreboard" };

export class FakeEngine implements Engine {
  private s: EngineStatus;
  private deviceBySlot = new Map<number, string>();
  private listeners = new Set<() => void>();
  private feeds = new Map<string, string>();
  private tickTimer?: ReturnType<typeof setInterval>;
  private emitTimer?: ReturnType<typeof setTimeout>;
  private lastEmit = 0;
  private replayTimer?: ReturnType<typeof setTimeout>;
  private ffmpeg?: ReturnType<typeof Bun.spawn>;
  private recDir?: string;
  private diskLow = false;
  private extra: DeviceInfo[] = [];
  private videoCfg: VideoSettings = { ...DEFAULT_VIDEO };
  private audioExtra = new Map<string, { deviceId: string; role: "mic" | "desktop" }>();
  private camOpts = new Map<number, { resolution?: string; framerate?: string; reconnectSeconds: number; bufferingMb: number }>();

  constructor() {
    const src = (slot: number, label: string, kind: SourceInfo["kind"], detail: string, deviceId: string): SourceInfo => {
      this.deviceBySlot.set(slot, deviceId);
      return { id: `cam${slot}`, slot, deviceId, label, kind, detail, status: "ok", audio: 0.3 };
    };
    this.s = {
      engine: "fake", connected: true, program: "cam1", preview: "cam2", replay: { active: false },
      sources: [src(1, "Center court", "usb", "1080p60", "usb-brio"), src(2, "Baseline", "usb", "1080p60", "usb-camlink"), src(3, "Bench", "ndi", "1080p30", "ndi-coach"), src(4, "Scoreboard screen", "screen", "1080p30", "screen-scoreboard")],
      mixer: [{ id: "commentary", label: "Commentary", level: 0.4, gainDb: 0, muted: false }, { id: "crowd", label: "Crowd", level: 0.3, gainDb: -6, muted: false }, { id: "program", label: "Program", level: 0.5, gainDb: 0, muted: false }],
      stream: { live: false, kbps: 0, droppedFrames: 0, reconnecting: false },
      record: { active: false, bytes: 0 }, cpu: 35, diskFreeBytes: 0, graphicsInProgram: false,
    };
    for (const [id, f] of Object.entries(FEED_FILES)) this.feeds.set(id, FEED_SVG[f]);
    this.s.diskFreeBytes = this.diskFree();
  }

  status(): EngineStatus { return structuredClone(this.s); }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    if (!this.tickTimer) { this.tickTimer = setInterval(() => this.tick(), TICK_MS); this.tickTimer.unref(); }
    return () => {
      this.listeners.delete(cb);
      if (!this.listeners.size && this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = undefined; }
    };
  }

  // Leading-edge + one trailing call, so listeners fire at most 4x/second.
  private emit() {
    const wait = this.lastEmit + TICK_MS - Date.now();
    if (wait <= 0) {
      this.lastEmit = Date.now();
      for (const cb of [...this.listeners]) cb();
    } else if (!this.emitTimer) {
      this.emitTimer = setTimeout(() => { this.emitTimer = undefined; this.emit(); }, wait);
      this.emitTimer.unref();
    }
  }

  private diskFree(): number {
    if (this.diskLow) return 6 * GB;
    try { const f = statfsSync(this.recDir ?? process.cwd()); return f.bavail * f.bsize; } catch { return 100 * GB; }
  }

  private tick() {
    const s = this.s;
    for (const src of s.sources) src.audio = src.status === "ok" ? walk(src.audio) : 0;
    for (const m of s.mixer) m.level = m.muted ? 0 : walk(m.level);
    s.cpu = clamp(s.cpu + (Math.random() - 0.5) * 6, 25, 45);
    s.stream.kbps = s.stream.live && !s.stream.reconnecting ? Math.round(6000 + (Math.random() - 0.5) * 600) : 0;
    if (s.record.active && s.record.file) { try { s.record.bytes = statSync(s.record.file).size; } catch {} }
    s.diskFreeBytes = this.diskFree();
    this.emit();
  }

  private src(id: string) { return this.s.sources.find((x) => x.id === id); }
  private swap() { [this.s.program, this.s.preview] = [this.s.preview, this.s.program]; }

  async detectDevices(): Promise<DeviceInfo[]> {
    const used = new Set(this.deviceBySlot.values());
    return [...DEVICES, ...this.extra].map((d) => ({ ...d, inUse: used.has(d.id) }));
  }

  async addNetworkSource(url: string, label: string): Promise<DeviceInfo> {
    const n = parseNetworkSource(url, label);
    const d: DeviceInfo = { id: networkDeviceId(n.url), label: n.label, kind: n.local ? "test" : "srt", detail: networkDetail(n), inUse: false };
    this.extra = [...this.extra.filter((x) => x.id !== d.id), d];
    return d;
  }

  async setSlot(slot: number, deviceId: string | null, label?: string) {
    const id = `cam${slot}`;
    if (!Number.isInteger(slot) || slot < 1 || slot > 4) throw new Error(`slot must be 1-4, got ${slot}`);
    if (deviceId === null) {
      this.deviceBySlot.delete(slot);
      this.s.sources = this.s.sources.filter((x) => x.id !== id);
      if (this.s.program === id) this.s.program = null;
      if (this.s.preview === id) this.s.preview = null;
    } else {
      const dev = [...DEVICES, ...this.extra].find((d) => d.id === deviceId) ?? (deviceId.startsWith("ffmpeg_source:") ? await this.addNetworkSource(deviceId.slice(14), label ?? "") : undefined);
      if (!dev) throw new Error(`unknown device: ${deviceId}`);
      this.deviceBySlot.set(slot, deviceId);
      const next: SourceInfo = { id, slot, deviceId, label: label ?? dev.label, kind: dev.kind, detail: dev.detail, status: "ok", audio: 0.3 };
      const i = this.s.sources.findIndex((x) => x.id === id);
      if (i >= 0) this.s.sources[i] = next; else { this.s.sources.push(next); this.s.sources.sort((a, b) => a.slot - b.slot); }
    }
    this.emit();
  }

  async setPreview(sourceId: string) {
    const src = this.src(sourceId);
    if (!src) throw new Error(`no such source: ${sourceId}`);
    if (src.status !== "ok") throw new Error(`source ${sourceId} (${src.label}) is ${src.status}, not ready for preview`);
    this.s.preview = sourceId;
    this.emit();
  }

  async cut() { this.swap(); this.emit(); }
  async fade(ms: number) { await sleep(Math.max(0, ms)); this.swap(); this.emit(); }

  async startStream(dest: { name: string; url: string; key: string }) {
    if (!dest.key?.trim()) throw new Error(`destination "${dest.name}" has no stream key`);
    if (this.s.stream.live) throw new Error("already streaming");
    Object.assign(this.s.stream, { live: true, destination: dest.name, startedAt: Date.now(), kbps: 6000, droppedFrames: 0, reconnecting: false });
    this.emit();
  }

  async stopStream() {
    this.s.stream = { live: false, kbps: 0, droppedFrames: 0, reconnecting: false };
    this.emit();
  }

  async startRecord(dir: string, basename: string): Promise<string> {
    if (this.s.record.active) throw new Error("already recording");
    mkdirSync(dir, { recursive: true });
    const file = `${dir}/${basename}.mkv`;
    if (Bun.which("ffmpeg")) {
      // -re keeps the test pattern at real-time speed; matroska survives a killed writer.
      this.ffmpeg = Bun.spawn(["ffmpeg", "-v", "error", "-y", "-re", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-re", "-f", "lavfi", "-i", "sine=frequency=440",
        "-t", "10800", /* 3 h cap: an orphan after a hard kill must not write forever */ "-c:v", "libx264", "-preset", "ultrafast", "-g", "30", "-c:a", "aac", "-f", "matroska", file], { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
    } else writeFileSync(file, "");
    this.recDir = dir;
    this.s.record = { active: true, file, startedAt: Date.now(), bytes: 0 };
    this.emit();
    return file;
  }

  async stopRecord() {
    await this.killRecorder();
    const r = this.s.record;
    if (r.file) { try { r.bytes = statSync(r.file).size; } catch {} }
    this.s.record = { active: false, file: r.file, startedAt: r.startedAt, bytes: r.bytes };
    this.emit();
  }

  private async killRecorder() {
    const p = this.ffmpeg;
    if (!p) return;
    this.ffmpeg = undefined;
    try { p.stdin && (p.stdin as any).write("q"); await (p.stdin as any)?.end(); } catch {}
    const t = setTimeout(() => p.kill("SIGKILL"), 3000);
    await p.exited;
    clearTimeout(t);
  }

  async setMute(mixerId: string, muted: boolean) { this.mix(mixerId).muted = muted; this.emit(); }
  async setGain(mixerId: string, gainDb: number) { this.mix(mixerId).gainDb = gainDb; this.emit(); }
  private mix(id: string) {
    const m = this.s.mixer.find((x) => x.id === id);
    if (!m) throw new Error(`no such mixer channel: ${id}`);
    return m;
  }

  async replay(o: { secondsBack: number; speed: number }) {
    if (!(o.secondsBack > 0) || !(o.speed > 0)) throw new Error("replay needs secondsBack > 0 and speed > 0");
    clearTimeout(this.replayTimer);
    this.s.replay.active = true;
    this.replayTimer = setTimeout(() => { this.s.replay.active = false; this.emit(); }, Math.max(1, o.secondsBack / o.speed) * 1000);
    this.replayTimer.unref();
    this.emit();
  }

  async stopReplay() { clearTimeout(this.replayTimer); this.s.replay.active = false; this.emit(); }

  async snapshot(sourceId: string) {
    const svg = this.src(sourceId) && this.feeds.get(sourceId);
    return svg ? { type: "image/svg+xml", body: new TextEncoder().encode(svg) } : null;
  }

  // Demo/failure hooks for the dev route and tests (not part of Engine).
  simulate(what: "source-drop" | "source-restore" | "stream-drop" | "stream-restore" | "disk-low" | "disk-restore", arg?: string) {
    const setSrc = (status: SourceInfo["status"]) => {
      const x = this.src(arg ?? "");
      if (!x) throw new Error(`no such source: ${arg}`);
      x.status = status;
    };
    if (what === "source-drop") setSrc("reconnecting");
    else if (what === "source-restore") setSrc("ok");
    else if (what === "stream-drop") this.s.stream.reconnecting = true;
    else if (what === "stream-restore") this.s.stream.reconnecting = false;
    else if (what === "disk-low") this.diskLow = true;
    else if (what === "disk-restore") this.diskLow = false;
    else throw new Error(`unknown simulation: ${what}`);
    this.s.diskFreeBytes = this.diskFree();
    this.emit();
  }

  // ---- settings (same contract as ObsEngine; values are kept in memory so the demo and CI can exercise the whole screen)
  private appliedVideo(v: VideoSettings): VideoApplied {
    const d = dims(v);
    return { resolution: v.resolution, fps: v.fps, videoKbps: v.videoKbps, audioKbps: v.audioKbps, encoder: resolveEncoder(v.encoder, v, []).id, recordFormat: REC_FORMAT[v.recordFormat], replaySeconds: v.replaySeconds, outputWidth: d.outputWidth, outputHeight: d.outputHeight };
  }
  async videoInfo() { return { applied: this.appliedVideo(this.videoCfg), encoders: encoderOptions([]), encoderInUse: "x264" }; }
  async applyVideo(v: VideoSettings) {
    if (this.s.stream.live || this.s.record.active) { const b = liveBlocked(this.videoCfg, v); if (b) throw new Error(b); }
    this.videoCfg = { ...v }; this.emit();
    return this.appliedVideo(this.videoCfg);
  }

  private audioOf(m: MixerChannel): AudioInput {
    const extra = this.audioExtra.get(m.id), managed = m.id !== "program";
    const dev = DEVICES.find((d) => d.id === (extra?.deviceId ?? (m.id === "crowd" ? "audio-desktop" : "audio-scarlett")));
    return { id: m.id, label: m.label, role: extra?.role ?? (m.id === "crowd" ? "desktop" : m.id === "program" ? "other" : "mic"), deviceId: managed ? dev?.id ?? "" : "", deviceLabel: managed ? dev?.label ?? "" : "", managed, removable: !!extra, level: m.level, gainDb: m.gainDb, muted: m.muted };
  }
  async audioInputs(): Promise<AudioList> { return { inputs: this.s.mixer.map((m) => this.audioOf(m)), devices: DEVICES.filter((d) => d.kind === "audio"), canDesktop: true }; }
  async addAudio(o: { role: "mic" | "desktop"; deviceId?: string; label: string }) {
    if (o.role !== "mic" && o.role !== "desktop") throw new Error("Choose a microphone or desktop / room sound.");
    if (o.deviceId && !DEVICES.some((d) => d.id === o.deviceId && d.kind === "audio")) throw new Error("That device is not an audio device.");
    let n = 2; while (this.s.mixer.some((m) => m.id === `audio-${n}`)) n++;
    const id = `audio-${n}`;
    this.audioExtra.set(id, { deviceId: o.deviceId ?? (o.role === "mic" ? "audio-scarlett" : "audio-desktop"), role: o.role });
    const m: MixerChannel = { id, label: o.label.trim().slice(0, 40) || (o.role === "mic" ? "Microphone" : "Desktop sound"), level: 0.3, gainDb: 0, muted: false };
    this.s.mixer.splice(this.s.mixer.length - 1, 0, m); this.emit();
    return this.audioOf(m);
  }
  async updateAudio(id: string, p: { label?: string; deviceId?: string; gainDb?: number; muted?: boolean }) {
    const m = this.mix(id);
    if (p.label !== undefined) m.label = String(p.label).trim().slice(0, 40) || m.label;
    if (p.deviceId !== undefined) { if (!DEVICES.some((d) => d.id === p.deviceId && d.kind === "audio")) throw new Error("That device is not an audio device."); const e = this.audioExtra.get(id); if (e) e.deviceId = p.deviceId; }
    if (p.gainDb !== undefined) m.gainDb = p.gainDb;
    if (p.muted !== undefined) m.muted = !!p.muted;
    this.emit();
    return this.audioOf(m);
  }
  async removeAudio(id: string) {
    if (!this.audioExtra.has(id)) throw new Error("Only extra inputs added by Fieldhouse can be removed.");
    this.audioExtra.delete(id); this.s.mixer = this.s.mixer.filter((m) => m.id !== id); this.emit();
  }

  async sourceOptions(slot: number): Promise<SourceOptions> {
    const src = this.s.sources.find((x) => x.slot === slot);
    if (!src) throw new Error("That slot is empty.");
    const o = this.camOpts.get(slot) ?? { reconnectSeconds: 5, bufferingMb: 2 }, dev = this.deviceBySlot.get(slot) ?? "";
    if (dev.startsWith("ffmpeg_source:")) {
      const n = parseNetworkSource(dev.slice(14));
      return { slot, type: n.local ? "file" : "network", label: src.label, address: maskAddress(n.url), resolutions: [], framerates: [], reconnectSeconds: n.local ? undefined : o.reconnectSeconds, bufferingMb: n.local ? undefined : o.bufferingMb, canReconnect: true };
    }
    if (src.kind !== "usb") return { slot, type: "other", label: src.label, resolutions: [], framerates: [], canReconnect: false };
    return { slot, type: "camera", label: src.label, resolution: o.resolution ?? '"1920x1080"', framerate: o.framerate ?? "30", resolutions: ['"1920x1080"', '"1280x720"', '"640x480"'].map((v) => ({ value: v, label: JSON.parse(v) })), framerates: ["30", "60"].map((v) => ({ value: v, label: `${v} fps` })), canReconnect: false };
  }
  async setSourceOptions(slot: number, p: SourceOptionsPatch) {
    const cur = await this.sourceOptions(slot), o = this.camOpts.get(slot) ?? { reconnectSeconds: 5, bufferingMb: 2 };
    if (p.resolution !== undefined) { if (!cur.resolutions.some((r) => r.value === p.resolution)) throw new Error("That resolution is not one the camera offers."); o.resolution = p.resolution; }
    if (p.framerate !== undefined) { if (!cur.framerates.some((r) => r.value === p.framerate)) throw new Error("That frame rate is not one the camera offers."); o.framerate = p.framerate; }
    if (p.reconnectSeconds !== undefined) { if (!Number.isInteger(p.reconnectSeconds) || p.reconnectSeconds < 1 || p.reconnectSeconds > 60) throw new Error("Retry after must be a whole number of seconds from 1 to 60."); o.reconnectSeconds = p.reconnectSeconds; }
    if (p.bufferingMb !== undefined) { if (!Number.isInteger(p.bufferingMb) || p.bufferingMb < 1 || p.bufferingMb > 16) throw new Error("The buffer must be a whole number of megabytes from 1 to 16."); o.bufferingMb = p.bufferingMb; }
    this.camOpts.set(slot, o); this.emit();
    return this.sourceOptions(slot);
  }

  async close() {
    clearInterval(this.tickTimer); this.tickTimer = undefined;
    clearTimeout(this.emitTimer); clearTimeout(this.replayTimer);
    this.listeners.clear();
    await this.killRecorder();
  }
}
