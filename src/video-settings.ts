// What the volunteer can tune (quality, encoder, recording format, replay length) and how each choice maps onto OBS.
// All pure: validation, encoder resolution and the OBS parameter list are unit-tested without an OBS.
import type { EncoderChoice, EncoderOption, VideoApplied, VideoSettings } from "./types";

export const DEFAULT_VIDEO: VideoSettings = { resolution: "720p", fps: 30, videoKbps: 4500, audioKbps: 160, encoder: "auto", recordFormat: "mp4", replaySeconds: 60 };
export const VIDEO_KBPS_PRESETS = [2500, 4500, 6000, 8000];
export const AUDIO_KBPS = [64, 96, 128, 160, 192, 256, 320]; // OBS's own list of AAC bitrates
export const KBPS_RANGE: [number, number] = [1000, 20000];
export const REPLAY_SECONDS = [30, 60, 120];
const ENCODERS: EncoderChoice[] = ["auto", "x264", "qsv", "nvenc", "amd", "apple_h264"];

export const LABEL: Record<EncoderChoice, string> = {
  auto: "Automatic (recommended)", x264: "Software (x264)", qsv: "Intel QuickSync", nvenc: "NVIDIA NVENC", amd: "AMD hardware encoder", apple_h264: "Apple VideoToolbox",
};

/** Validate a (partial) video patch against the current settings. Plain-language errors, never silently clamps. */
export function validateVideo(patch: unknown, cur: VideoSettings): VideoSettings {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Video settings must be an object");
  const next: VideoSettings = { ...cur };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    switch (k) {
      case "resolution": if (v !== "720p" && v !== "1080p") throw new Error("Resolution must be 720p or 1080p."); next.resolution = v; break;
      case "fps": if (v !== 30 && v !== 60) throw new Error("Frame rate must be 30 or 60."); next.fps = v; break;
      case "videoKbps": if (!Number.isInteger(v) || (v as number) < KBPS_RANGE[0] || (v as number) > KBPS_RANGE[1]) throw new Error(`Video bitrate must be a whole number between ${KBPS_RANGE[0]} and ${KBPS_RANGE[1]} kbps.`); next.videoKbps = v as number; break;
      case "audioKbps": if (!AUDIO_KBPS.includes(v as number)) throw new Error(`Audio bitrate must be one of ${AUDIO_KBPS.join(", ")} kbps.`); next.audioKbps = v as number; break;
      case "encoder": if (!ENCODERS.includes(v as EncoderChoice)) throw new Error("Unknown encoder choice."); next.encoder = v as EncoderChoice; break;
      case "recordFormat": if (v !== "mp4" && v !== "mkv") throw new Error("Recording format must be MP4 or MKV."); next.recordFormat = v; break;
      case "replaySeconds": if (!REPLAY_SECONDS.includes(v as number)) throw new Error("Instant replay can keep 30, 60 or 120 seconds."); next.replaySeconds = v as 30 | 60 | 120; break;
      default: throw new Error(`Unknown video setting: ${k}`);
    }
  }
  return next;
}

/** The settings that OBS cannot change while it is streaming or recording. */
export const LIVE_LOCKED: (keyof VideoSettings)[] = ["resolution", "fps", "encoder"];
export function liveBlocked(cur: VideoSettings, next: VideoSettings): string | null {
  const hit = LIVE_LOCKED.filter((k) => cur[k] !== next[k]);
  const names: Record<string, string> = { resolution: "resolution", fps: "frame rate", encoder: "encoder" };
  return hit.length ? `The ${hit.map((k) => names[k]).join(" and ")} cannot be changed during a broadcast. End the broadcast first; the other settings can still be saved.` : null;
}

export const dims = (v: VideoSettings) => ({ baseWidth: 1920, baseHeight: 1080, outputWidth: v.resolution === "1080p" ? 1920 : 1280, outputHeight: v.resolution === "1080p" ? 1080 : 720, fpsNumerator: v.fps, fpsDenominator: 1 });

/**
 * Hardware encoders OBS has registered, from its own "Available Encoders" list (obs-log.ts parseEncoders). We only offer what OBS lists.
 * Not offered on purpose: VAAPI (Linux), which OBS's simple output mode cannot select, and AV1/HEVC (streaming sites want H.264).
 * Caveat: OBS lists an encoder when its module loaded; it cannot prove the GPU will accept the job. That is why a failed hardware
 * encoder is detected from the log and Fieldhouse falls back to software (see server.ts).
 */
export function encoderOptions(ids: string[]): EncoderOption[] {
  const has = (re: RegExp) => ids.some((i) => re.test(i));
  const out: EncoderOption[] = [{ id: "auto", label: LABEL.auto }, { id: "x264", label: LABEL.x264 }];
  if (has(/qsv11/)) out.push({ id: "qsv", label: LABEL.qsv });
  if (has(/nvenc/)) out.push({ id: "nvenc", label: LABEL.nvenc });
  if (has(/amf/)) out.push({ id: "amd", label: LABEL.amd });
  if (has(/videotoolbox.*avc|apple.*h264/i)) out.push({ id: "apple_h264", label: LABEL.apple_h264 });
  return out;
}

/**
 * Automatic means: software x264 (works everywhere, no driver surprises), except 1080p at 60 fps where x264 would swamp a
 * volunteer's laptop, so a hardware encoder is taken if OBS has one. x264 gets a lighter preset the harder the job.
 */
export function resolveEncoder(choice: EncoderChoice, v: Pick<VideoSettings, "resolution" | "fps">, available: EncoderChoice[]): { id: EncoderChoice; preset: string } {
  const heavy = v.resolution === "1080p" && v.fps === 60;
  let id: EncoderChoice = choice;
  if (choice === "auto") id = heavy ? (["nvenc", "apple_h264", "qsv", "amd"] as EncoderChoice[]).find((e) => available.includes(e)) ?? "x264" : "x264";
  else if (choice !== "x264" && !available.includes(choice)) id = "x264"; // a saved hardware choice that this machine cannot do
  return { id, preset: id === "x264" ? (heavy ? "superfast" : "veryfast") : "veryfast" };
}

export const REC_FORMAT: Record<VideoSettings["recordFormat"], string> = { mp4: "hybrid_mp4", mkv: "mkv" }; // both survive a crash; plain mp4/mov do not

/** Reconnect quietly and for a long time: OBS shows a modal only when its retries run out. */
export const RECONNECT: [string, string, string][] = [["Output", "Reconnect", "true"], ["Output", "RetryDelay", "2"], ["Output", "MaxRetries", "2000"]];

/** Profile parameters for these settings. replayDir/filename are added by the caller (provisioning). */
export function outputParams(v: VideoSettings, enc: { id: EncoderChoice; preset: string }): [string, string, string][] {
  return [
    ["SimpleOutput", "StreamEncoder", enc.id], ["SimpleOutput", "Preset", enc.preset], ["SimpleOutput", "RecQuality", "Stream"],
    ["SimpleOutput", "VBitrate", String(v.videoKbps)], ["SimpleOutput", "ABitrate", String(v.audioKbps)],
    ["SimpleOutput", "RecFormat2", REC_FORMAT[v.recordFormat]], ["SimpleOutput", "RecRBTime", String(v.replaySeconds)],
    ...RECONNECT,
  ];
}

/** Human list of what differs between the saved settings and what the engine reports (empty = in sync). */
export function differences(v: VideoSettings, a: VideoApplied, enc: EncoderChoice): string[] {
  const out: string[] = [];
  const want = dims(v);
  if (a.outputHeight !== want.outputHeight) out.push("resolution");
  if (a.fps !== v.fps) out.push("frame rate");
  if (a.videoKbps !== v.videoKbps) out.push("video bitrate");
  if (a.audioKbps !== v.audioKbps) out.push("audio bitrate");
  if (a.encoder !== enc) out.push("encoder");
  if (a.recordFormat !== REC_FORMAT[v.recordFormat]) out.push("recording format");
  if (a.replaySeconds !== v.replaySeconds) out.push("replay length");
  return out;
}
