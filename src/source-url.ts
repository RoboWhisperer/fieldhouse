// Validates what a volunteer types into "Add network source": a stream URL or a local video file.
// Strict on purpose: the value ends up in an OBS ffmpeg_source, so no shell-ish or exotic ffmpeg protocols (file:, concat:, pipe:, data:).
export type NetworkSource = { url: string; local: boolean; scheme: string; label: string };

const SCHEMES = ["srt", "rtmp", "rtmps", "rtsp", "rtsps", "http", "https"];
const VIDEO_EXT = /\.(mp4|m4v|mov|mkv|webm|avi|ts|mts|m2ts|mpg|mpeg|flv|wmv)$/i;

export function parseNetworkSource(input: unknown, label?: unknown): NetworkSource {
  if (typeof input !== "string") throw new Error("Enter a stream address or a video file path.");
  const url = input.trim();
  if (!url) throw new Error("Enter a stream address or a video file path.");
  if (url.length > 2000 || /[\x00-\x1f\x7f\s]/.test(url)) throw new Error("That address has spaces or unusual characters. Check it and try again.");
  const lab = typeof label === "string" && label.trim() ? label.trim().slice(0, 40) : "";

  if (/^(\/|[a-zA-Z]:[\\/]|\\\\)/.test(url)) { // absolute local path (posix, drive letter, UNC)
    if (!VIDEO_EXT.test(url)) throw new Error("Local files must be video files (.mp4, .mov, .mkv, .webm, .avi, .ts).");
    return { url, local: true, scheme: "file", label: lab || url.split(/[\\/]/).pop()!.replace(VIDEO_EXT, "") };
  }
  let u: URL;
  try { u = new URL(url); } catch { throw new Error("That is not a valid address. Use srt://, rtmp://, rtsp://, http:// or https://, or a full file path."); }
  const scheme = u.protocol.slice(0, -1).toLowerCase();
  if (!SCHEMES.includes(scheme)) throw new Error(`"${scheme}://" is not supported. Use srt://, rtmp://, rtsp://, http:// or https://.`);
  if (!u.hostname) throw new Error("The address needs a host name or IP, like srt://192.168.1.50:9000.");
  if (["srt"].includes(scheme) && !u.port) throw new Error("SRT addresses need a port, like srt://192.168.1.50:9000.");
  return { url, local: false, scheme, label: lab || `${scheme.toUpperCase()} ${u.hostname}` };
}

export const networkDeviceId = (url: string) => `ffmpeg_source:${url}`;
export const networkDetail = (n: NetworkSource) => (n.local ? "Video file" : n.scheme.startsWith("http") ? "Web stream" : `${n.scheme.toUpperCase()} stream`);

/** What may be shown on screen for a source address: no credentials, no query, no stream key (everything after the first path segment). */
export function maskAddress(input: string): string {
  if (/^(\/|[a-zA-Z]:[\\/]|\\\\)/.test(input)) return input.split(/[\\/]/).pop() ?? input; // a file: just its name
  try {
    const u = new URL(input);
    const first = u.pathname.split("/").filter(Boolean)[0];
    return `${u.protocol}//${u.host}${first ? "/" + first : ""}${u.pathname.split("/").filter(Boolean).length > 1 || u.search ? "/..." : ""}`;
  } catch { return "(address hidden)"; }
}
