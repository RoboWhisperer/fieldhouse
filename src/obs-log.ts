// Reads OBS's own log file so problems show up in Fieldhouse as plain sentences instead of OBS dialogs or raw log noise.
// The volunteer never sees a raw OBS line. Only the diagnostics bundle may carry them, and only after scrub() (no stream keys).
import { existsSync, openSync, closeSync, readSync, readdirSync, statSync, fstatSync } from "node:fs";
import { join } from "node:path";
import { scrub } from "./diagnostics";

export type ObsProblem = "encoder" | "disk" | "folder" | "overload" | "camera" | "media" | "network";
export interface Classified { kind: ObsProblem; message: string }

// Order matters: the first match wins. `msg` is what the operator reads.
const RULES: { kind: ObsProblem; re: RegExp; message: string }[] = [
  { kind: "disk", re: /no space left|disk (is )?full|insufficient disk|ENOSPC|not enough space/i, message: "The recording disk is full. Free up space or choose another folder in Settings > Storage." },
  { kind: "folder", re: /bad output path|invalid path|can'?t open (the )?(output )?file|failed to open .*(output|record)|couldn'?t write to path|permission denied.*(rec|output|replay)/i, message: "Fieldhouse could not write the recording. Check that the recording folder exists and can be written to (Settings > Storage)." },
  { kind: "encoder", re: /(failed|unable|error).{0,40}(encoder|nvenc|qsv|amf|vaapi|videotoolbox|x264)|(encoder|nvenc|qsv|amf|vaapi|videotoolbox).{0,40}(failed|not supported|error)|encode error|OBS_OUTPUT_ENCODE_ERROR/i, message: "The video encoder reported a problem. If it keeps happening, choose Software (x264) in Settings > Video and audio." },
  { kind: "overload", re: /encoding overloaded|skipped frames due to encoding|dropped frames due to|rendering lag/i, message: "This computer is struggling to keep up with the video. Lower the quality in Settings > Video and audio, or close other programs." },
  { kind: "camera", re: /(v4l2|dshow|av_?capture|avcapture|decklink|uvc|pipewire).{0,80}(unable|failed|error|disconnect|lost|not found|no such device|cannot)|device (disconnected|lost|removed)/i, message: "A camera or audio device stopped responding. Check its cable, then press Scan again on the Sources screen." },
  { kind: "media", re: /media source .{0,80}(failed|error)|\[ffmpeg_source|failed to open media|couldn'?t open.*(media|file)/i, message: "A video file or network stream could not be opened. Check the address or file on the Sources screen." },
  { kind: "network", re: /(rtmp|srt|stream).{0,60}(connection .*failed|disconnected|connect failed|failed to connect|reconnect)|connection to .{0,200} failed/i, message: "The connection to the streaming service dropped. Fieldhouse keeps trying to reconnect." },
];

/** One OBS log line -> a plain-language problem, or null for the (vast majority of) lines that do not matter. */
export function classifyLine(line: string): Classified | null {
  const body = line.replace(/^\d{1,2}:\d{2}:\d{2}\.\d+:\s*/, "");
  if (!body.trim() || /^(info|debug):/i.test(body) || /obs-websocket|^\s*[┣┃┗]|nvenc not supported|v4l2-input: (Unable to open device\s*$|Initialization failed, errno: No such file)|nvenc.*cannot open shared object|^FFmpeg VAAPI|Failed to initialize module|v4l2loopback not installed|No AJA/i.test(body)) return null; // normal start-up noise on healthy machines
  const hit = RULES.find((r) => r.re.test(body));
  return hit ? { kind: hit.kind, message: hit.message } : null;
}

/** Encoder ids OBS registered, from the "Available Encoders" block it prints at start-up (reliable: it is OBS's own list). */
export function parseEncoders(logText: string): string[] {
  const at = logText.indexOf("Available Encoders:");
  if (at < 0) return [];
  const block = logText.slice(at).split("\n").slice(1, 40);
  const out: string[] = [];
  for (const l of block) {
    const m = /^\d{1,2}:\d{2}:\d{2}\.\d+:\s*(?:\t|\s)+-\s+([\w.-]+)\s+\(/.exec(l);
    if (m) out.push(m[1]);
    else if (/Audio Encoders:/.test(l)) break;
  }
  return out;
}

/** Newest log file in OBS's log folder (the current session), or null. */
export function latestLog(dir: string): string | null {
  try {
    const f = readdirSync(dir).filter((n) => n.endsWith(".txt")).map((n) => ({ n, t: statSync(join(dir, n)).mtimeMs })).sort((a, b) => b.t - a.t)[0];
    return f ? join(dir, f.n) : null;
  } catch { return null; }
}

/** Last `bytes` of a file as text (the start of OBS's log is where the encoder list is, so callers read from the head too). */
export function readSlice(file: string, from: number, to?: number): string {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const size = fstatSync(fd).size, end = Math.min(to ?? size, size), len = Math.max(0, end - from);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, from);
    return buf.toString("utf8");
  } catch { return ""; } finally { if (fd !== undefined) try { closeSync(fd); } catch {} }
}

export interface LogWatcherOpts {
  dir: () => string | null;
  notice: (level: "info" | "warn", message: string, kind: ObsProblem) => void;
  now?: () => number;
  /** Seconds before the same kind of problem may be reported again. */
  quietS?: number;
}
const KEEP = 60;

/** Polls OBS's newest log file and turns problem lines into rate-limited notices. */
export class ObsLogWatcher {
  private file: string | null = null;
  private offset = 0;
  private lastAt = new Map<ObsProblem, number>();
  private lines: string[] = [];
  private timer?: ReturnType<typeof setInterval>;
  constructor(private o: LogWatcherOpts) {}

  start(ms = 2000) { this.stop(); this.poll(true); this.timer = setInterval(() => this.poll(), ms); (this.timer as any).unref?.(); }
  stop() { clearInterval(this.timer); this.timer = undefined; }

  /** The log of the OBS that is running now (not an old one): files are told apart by name, so a new file = a new OBS. */
  encoders(): string[] {
    const f = this.file ?? latestLog(this.o.dir() ?? "");
    return f ? parseEncoders(readSlice(f, 0, 200_000)) : [];
  }

  /** Redacted problem lines for the support bundle. */
  highlights(): string[] { return this.lines.map(scrub); }

  poll(skipExisting = false) {
    const dir = this.o.dir();
    const f = dir && existsSync(dir) ? latestLog(dir) : null;
    if (!f) return;
    if (f !== this.file) { this.file = f; this.offset = skipExisting ? statSync(f).size : 0; } // a new OBS session: read it from its start
    const size = statSync(f).size;
    if (size < this.offset) this.offset = 0; // rotated or truncated
    if (size === this.offset) return;
    const text = readSlice(f, this.offset, size);
    const cut = text.lastIndexOf("\n");
    if (cut < 0) return; // a half-written line: wait for the rest
    this.offset += Buffer.byteLength(text.slice(0, cut + 1));
    for (const line of text.slice(0, cut).split("\n")) this.line(line);
  }

  line(line: string) {
    const c = classifyLine(line);
    if (!c) return;
    this.lines.push(line.slice(0, 300)); if (this.lines.length > KEEP) this.lines.shift();
    const now = (this.o.now ?? Date.now)();
    if (now - (this.lastAt.get(c.kind) ?? 0) < (this.o.quietS ?? 120) * 1000) return;
    this.lastAt.set(c.kind, now);
    this.o.notice(c.kind === "network" ? "info" : "warn", c.message, c.kind);
  }
}
