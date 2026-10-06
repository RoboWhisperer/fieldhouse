// OBS-side device model: which OBS input kinds give us cameras/mics, how a DeviceInfo id maps to input settings.
// DeviceInfo ids are "<obs input kind>:<value>", e.g. "v4l2_input:/dev/video0", "ffmpeg_source:srt://10.0.0.5:9000".
import type { DeviceInfo } from "./types";
import { networkDetail, networkDeviceId, parseNetworkSource } from "./source-url";

export type Req = (type: string, data?: object, timeoutMs?: number) => Promise<any>;

interface Probe { kind: string; prop: string; dev: DeviceInfo["kind"]; detail: string; fallback?: string }
// kind: OBS input kind; prop: the list property holding device choices; fallback: used when OBS lists nothing (e.g. pulse in a sandbox).
const PROBES: Probe[] = [
  { kind: "v4l2_input", prop: "device_id", dev: "usb", detail: "USB camera" },
  { kind: "dshow_input", prop: "video_device_id", dev: "usb", detail: "USB camera" },
  { kind: "av_capture_input", prop: "device", dev: "usb", detail: "Camera" },
  { kind: "ndi_source", prop: "ndi_source_name", dev: "ndi", detail: "NDI" },
  { kind: "monitor_capture", prop: "monitor_id", dev: "screen", detail: "Screen" },
  { kind: "pulse_input_capture", prop: "device_id", dev: "audio", detail: "Microphone", fallback: "Default microphone" },
  { kind: "wasapi_input_capture", prop: "device_id", dev: "audio", detail: "Microphone", fallback: "Default microphone" },
  { kind: "coreaudio_input_capture", prop: "device_id", dev: "audio", detail: "Microphone", fallback: "Default microphone" },
  // Desktop / room sound (what the computer plays). macOS has no equivalent input kind in OBS 32's websocket-creatable set.
  { kind: "pulse_output_capture", prop: "device_id", dev: "audio", detail: "Desktop audio", fallback: "Default desktop sound" },
  { kind: "wasapi_output_capture", prop: "device_id", dev: "audio", detail: "Desktop audio", fallback: "Default desktop sound" },
];
// Portal-based capture: the user picks the device in a system dialog inside OBS, so there is nothing to enumerate.
const PORTAL: { kind: string; label: string; dev: DeviceInfo["kind"]; detail: string }[] = [
  { kind: "pipewire-camera-source", label: "PipeWire camera", dev: "usb", detail: "Camera (system picker)" },
  { kind: "pipewire-screen-capture-source", label: "Screen capture (PipeWire)", dev: "screen", detail: "Screen (system picker)" },
];

export const deviceId = (kind: string, value: string) => `${kind}:${value}`;
export function parseDeviceId(id: string): { kind: string; value: string } {
  const i = id.indexOf(":");
  if (i <= 0) throw new Error(`unknown device: ${id}`);
  return { kind: id.slice(0, i), value: id.slice(i + 1) };
}

export const isAudioDevice = (id: string) => PROBES.some((p) => p.dev === "audio" && id.startsWith(p.kind + ":"));

/** Input kind + settings to put in `FH camN video` for a device id (network/file sources included). */
export function cameraInput(id: string): { kind: string; settings: Record<string, unknown>; device: Pick<DeviceInfo, "kind" | "detail"> } {
  const { kind, value } = parseDeviceId(id);
  if (kind === "ffmpeg_source") {
    const n = parseNetworkSource(value);
    const base = { close_when_inactive: false, restart_on_activate: false, clear_on_media_end: false, hw_decode: false };
    // Files loop so a clip can stand in for a camera; streams reconnect after 5 s and buffer 2 MB (OBS default) to smooth jitter.
    const settings = n.local
      ? { ...base, is_local_file: true, local_file: n.url, looping: true }
      : { ...base, is_local_file: false, input: n.url, input_format: "", reconnect_delay_sec: 5, buffering_mb: 2, looping: false };
    return { kind, settings, device: { kind: n.local ? "test" : "srt", detail: networkDetail(n) } };
  }
  const probe = PROBES.find((p) => p.kind === kind && p.dev !== "audio");
  if (probe) return { kind, settings: { [probe.prop]: value }, device: { kind: probe.dev, detail: probe.detail } };
  const portal = PORTAL.find((p) => p.kind === kind);
  if (portal) return { kind, settings: {}, device: { kind: portal.dev, detail: portal.detail } };
  throw new Error(`unknown device: ${id}`);
}

/** OBS 32 quirk: RemoveInput alone leaves the input alive (and its name taken) when it sits in a scene created over the websocket.
 *  Removing its scene item first frees it; RemoveInput then only matters for inputs that are in no scene. */
export async function dropInput(req: Req, scene: string, inputName: string) {
  const id = await req("GetSceneItemId", { sceneName: scene, sourceName: inputName }).then((r) => r.sceneItemId, () => null);
  if (id != null) await req("RemoveSceneItem", { sceneName: scene, sceneItemId: id }).catch(() => {});
  await req("RemoveInput", { inputName }).catch(() => {});
}

/** Enumerate by creating a throwaway input per kind and reading its device list; the probes are always removed.
 *  The pause matters: OBS's UI handles the "item added" signal on its own thread, and removing the item before that
 *  crashed OBS 32 (null scene in the handler). Probes are created together, so the pause is paid once. */
export async function probeDevices(req: Req, kinds: Set<string>, probeScene: string): Promise<DeviceInfo[]> {
  const out: DeviceInfo[] = [];
  for (const p of PORTAL) if (kinds.has(p.kind)) out.push({ id: deviceId(p.kind, "portal"), label: p.label, kind: p.dev, detail: p.detail, inUse: false });
  const made: Probe[] = [];
  const nameOf = (p: Probe) => `FH probe ${p.kind}`;
  try {
    for (const p of PROBES) {
      if (!kinds.has(p.kind)) continue;
      await dropInput(req, probeScene, nameOf(p)); // leftover from an earlier crash
      try { await req("CreateInput", { sceneName: probeScene, inputName: nameOf(p), inputKind: p.kind, inputSettings: p.dev === "audio" ? { device_id: "fh-probe-none" } : {}, sceneItemEnabled: false }); made.push(p); } catch { /* kind unusable here */ }
    }
    await new Promise((r) => setTimeout(r, 400));
    for (const p of made) {
      try {
        const r = await req("GetInputPropertiesListPropertyItems", { inputName: nameOf(p), propertyName: p.prop });
        const items = ((r.propertyItems ?? []) as { itemName: string; itemValue: unknown; itemEnabled?: boolean }[]).filter((i) => i.itemValue !== "" && i.itemValue != null && i.itemEnabled !== false);
        for (const i of items) out.push({ id: deviceId(p.kind, String(i.itemValue)), label: String(i.itemName).replace(/_/g, " "), kind: p.dev, detail: p.detail, inUse: false });
        if (!items.length && p.fallback) out.push({ id: deviceId(p.kind, "default"), label: p.fallback, kind: p.dev, detail: p.detail, inUse: false });
      } catch { /* no device list for this kind */ }
    }
  } finally { for (const p of made) await dropInput(req, probeScene, nameOf(p)); }
  return out;
}

export const networkDevice = (n: { url: string; label: string; local: boolean; scheme: string }): DeviceInfo =>
  ({ id: networkDeviceId(n.url), label: n.label, kind: n.local ? "test" : "srt", detail: networkDetail(n), inUse: false });
