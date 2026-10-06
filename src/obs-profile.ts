// Writes the "Fieldhouse" OBS profile (resolution, frame rate, bitrate, encoder, replay length, reconnect rules) straight into its
// basic.ini while OBS is NOT running, so OBS starts with the right values and nothing has to be changed in a live OBS.
//
// Why: against a live OBS 32.2.2, SetVideoSettings (and the profile hop that used to follow it) was intermittently fatal: in 15-iteration
// loops OBS segfaulted inside obs-websocket's request handler, hung for 12 minutes inside SetVideoSettings, or timed out on
// SetCurrentProfile. Changing the same values with OBS stopped and relaunching (two seconds) never failed. The replay buffer also only
// exists for a profile OBS loaded with RecRB already true, which is exactly what a pre-written profile gives, so the old
// "hop to another profile and back" workaround is only a fallback for an OBS Fieldhouse did not start.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, posix } from "node:path";
import { mergeIni, type Ini } from "./obs-quiet";
import { obsConfigDir, type ObsInstall } from "./obs-manager";
import { PROFILE } from "./obs-provision";
import type { EncoderChoice, VideoSettings } from "./types";
import { dims, outputParams, resolveEncoder } from "./video-settings";

export const profileIniPath = (kind: NonNullable<ObsInstall["kind"]>, o: { home: string; env: Record<string, string | undefined> }) => {
  const dir = obsConfigDir(kind, o);
  return kind === "windows" ? `${dir}\\basic\\profiles\\${PROFILE}\\basic.ini` : posix.join(dir, "basic", "profiles", PROFILE, "basic.ini");
};

/** The ini sections for these settings. Keys are the ones OBS itself writes (checked against a real basic.ini). */
export function profileSettings(v: VideoSettings, hw: EncoderChoice[]): Ini {
  const d = dims(v), enc = resolveEncoder(v.encoder, v, hw);
  const ini: Ini = {
    General: { Name: PROFILE },
    Video: { BaseCX: String(d.baseWidth), BaseCY: String(d.baseHeight), OutputCX: String(d.outputWidth), OutputCY: String(d.outputHeight), FPSType: "0", FPSCommon: String(v.fps), FPSInt: String(v.fps), FPSNum: String(v.fps), FPSDen: "1" },
    Output: { Mode: "Simple" },
    SimpleOutput: { RecRB: "true", UseAdvanced: "true", x264Settings: "keyint=60" },
  };
  for (const [c, n, val] of outputParams(v, enc)) (ini[c] ??= {})[n] = val;
  return ini;
}

/** Write (or update) the profile. Returns the path, or null when it could not be written. Only call while OBS is closed. */
export function writeProfile(o: { install: ObsInstall; video: VideoSettings; hw?: EncoderChoice[]; home?: string; env?: Record<string, string | undefined> }): string | null {
  if (!o.install.kind) return null;
  const path = profileIniPath(o.install.kind, { home: o.home ?? homedir(), env: o.env ?? process.env });
  try {
    let cur = ""; try { cur = readFileSync(path, "utf8"); } catch {}
    const r = mergeIni(cur, profileSettings(o.video, o.hw ?? []));
    if (r.changed || !existsSync(path)) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, r.text); }
    return path;
  } catch { return null; }
}
