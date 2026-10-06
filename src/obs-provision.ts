// Idempotent OBS setup. Everything Fieldhouse owns is prefixed "FH" (scenes, inputs) or lives in the "Fieldhouse" profile;
// the user's own scenes, inputs and profiles are never modified or removed. Safe to run on every (re)connect.
//
// Findings on OBS 32.2.2 (Flatpak) + obs-websocket 5.7.4:
//  - The replay buffer is only created when an OUTPUT PROFILE is loaded. Setting SimpleOutput.RecRB=true over the websocket
//    is not enough: StartReplayBuffer keeps answering 604 "not available" until the profile is reloaded, so we hop to another
//    profile and back once (no OBS restart needed). Length is SimpleOutput.RecRBTime (seconds).
//  - Simple output mode and its RecFormat2 default (hybrid_mp4) are crash-safe; plain mp4/mov are not and get replaced.
//  - The replay buffer writes its clips into the profile's recording folder as it was when the buffer STARTED, so provisioning
//    points that folder at a scratch directory, with a timestamp file name format (unique clips), before the buffer starts.
//    startRecord later switches folder + name to the game's; those only affect recordings until the next provisioning.
//  - Recording and streaming attach to the encoder the replay buffer already runs and must wait for its next keyframe. OBS's
//    default x264 keyframe interval (250 frames, ~8 s) made recordings lose their first seconds and a stream send nothing for
//    8 s, so we pin keyint=60 (2 s, also what YouTube asks for) through SimpleOutput's custom x264 settings.
//  - SetVideoSettings and profile switches are refused while streaming/recording, so those steps are skipped when live.
import type { Req } from "./obs-devices";

export const PROFILE = "Fieldhouse";
export const PROBE_SCENE = "FH Probe"; // empty scene that is never on air: device probes live here, and it is where a previewed scene is parked
export const OVERLAY = "FH Overlay", REPLAY_SCENE = "FH Replay", REPLAY_MEDIA = "FH Replay media", MIC = "FH Mic";
export const SLOTS = [1, 2, 3, 4];
export const sceneOf = (id: string) => `FH ${id}`;
export const camInput = (id: string) => `FH ${id} video`;
/** Scene name -> Fieldhouse source id; null for scenes that are not ours. */
export const idOfScene = (name: string | null | undefined) => (!name ? null : name === REPLAY_SCENE ? "replay" : /^FH cam\d$/.test(name) ? name.slice(3) : null);

export interface ProvisionReport { profile: string; scenes: string[]; replayBuffer: boolean; notes: string[] }
const CRASH_SAFE = ["hybrid_mp4", "hybrid_mov", "mkv", "fragmented_mp4", "fragmented_mov"];
const OVERLAY_CSS = "body { background-color: rgba(0, 0, 0, 0); margin: 0px auto; overflow: hidden; }";

const getParam = async (req: Req, c: string, n: string): Promise<string> => String((await req("GetProfileParameter", { parameterCategory: c, parameterName: n }))?.parameterValue ?? "");
async function setParams(req: Req, want: [string, string, string][]) {
  let changed = false;
  for (const [c, n, v] of want) if ((await getParam(req, c, n)) !== v) { await req("SetProfileParameter", { parameterCategory: c, parameterName: n, parameterValue: v }); changed = true; }
  return changed;
}
const rbAvailable = (req: Req) => req("GetReplayBufferStatus").then((r) => ({ ok: true, active: !!r.outputActive }), () => ({ ok: false, active: false }));

/** Dedicated profile with the replay buffer on and a crash-safe recording format. Returns whether the replay buffer runs. */
async function ensureOutputs(req: Req, notes: string[], replayDir?: string): Promise<boolean> {
  const [st, rec] = await Promise.all([req("GetStreamStatus"), req("GetRecordStatus")]);
  if (st.outputActive || rec.outputActive) { notes.push("A broadcast is running, so OBS output settings were left alone."); return (await rbAvailable(req)).active; }
  const list = await req("GetProfileList");
  let fresh = false;
  if (list.currentProfileName !== PROFILE) {
    if ((list.profiles as string[]).includes(PROFILE)) await req("SetCurrentProfile", { profileName: PROFILE });
    else { await req("CreateProfile", { profileName: PROFILE }); fresh = true; notes.push(`Created the OBS profile "${PROFILE}".`); }
  }
  if (fresh) {
    await req("SetVideoSettings", { baseWidth: 1920, baseHeight: 1080, outputWidth: 1280, outputHeight: 720, fpsNumerator: 30, fpsDenominator: 1 }).catch(() => notes.push("Could not set the video size."));
    await setParams(req, [["SimpleOutput", "VBitrate", "4500"], ["SimpleOutput", "ABitrate", "160"], ["SimpleOutput", "StreamEncoder", "x264"]]);
  }
  const fmt = await getParam(req, "SimpleOutput", "RecFormat2");
  const changed = await setParams(req, [["Output", "Mode", "Simple"], ["SimpleOutput", "RecRB", "true"], ["SimpleOutput", "RecRBTime", "60"], ["SimpleOutput", "UseAdvanced", "true"], ["SimpleOutput", "x264Settings", "keyint=60"], ...(replayDir ? [["SimpleOutput", "FilePath", replayDir] as [string, string, string], ["Output", "FilenameFormatting", "%CCYY-%MM-%DD %hh-%mm-%ss"] as [string, string, string]] : []), ["SimpleOutput", "RecFormat2", CRASH_SAFE.includes(fmt) ? fmt : "hybrid_mp4"]]);
  let rb = await rbAvailable(req);
  if (rb.ok && rb.active && changed) { // the running buffer keeps its old encoder settings: restart it
    await req("StopReplayBuffer").catch(() => {});
    for (let i = 0; i < 100 && (await rbAvailable(req)).active; i++) await new Promise((r) => setTimeout(r, 100));
    rb = await rbAvailable(req);
  }
  if (!rb.ok) { // hop to any other profile and back so OBS rebuilds its outputs with the new settings
    const other = ((await req("GetProfileList")).profiles as string[]).find((p) => p !== PROFILE);
    if (other) { await req("SetCurrentProfile", { profileName: other }); await req("SetCurrentProfile", { profileName: PROFILE }); rb = await rbAvailable(req); }
  }
  if (!rb.ok) { notes.push("The OBS replay buffer is not available; instant replay is off."); return false; }
  if (!rb.active) await req("StartReplayBuffer").catch((e) => notes.push(`Replay buffer would not start: ${e.message}`));
  return (await rbAvailable(req)).active;
}

export async function canvasSize(req: Req) {
  const v = await req("GetVideoSettings").catch(() => ({}));
  return { w: Number(v.baseWidth) || 1920, h: Number(v.baseHeight) || 1080 };
}

/** Scale-to-fit, centered in the canvas, so any camera resolution fills the frame without distortion. */
export async function fitItem(req: Req, sceneName: string, sceneItemId: number, c: { w: number; h: number }) {
  await req("SetSceneItemTransform", { sceneName, sceneItemId, sceneItemTransform: { positionX: c.w / 2, positionY: c.h / 2, alignment: 0, boundsType: "OBS_BOUNDS_SCALE_INNER", boundsAlignment: 0, boundsWidth: c.w, boundsHeight: c.h } });
}

async function ensureInScene(req: Req, scene: string, input: string, created: (n: string) => void) {
  const items = (await req("GetSceneItemList", { sceneName: scene })).sceneItems as { sourceName: string; sceneItemId: number }[] | undefined;
  if (items?.some((i) => i.sourceName === input)) return;
  await req("CreateSceneItem", { sceneName: scene, sourceName: input });
  created(`${input} in ${scene}`);
}

export async function provision(req: Req, o: { overlayUrl: string; inputKinds: Set<string>; replayDir?: string }): Promise<ProvisionReport> {
  const notes: string[] = [];
  const replayBuffer = await ensureOutputs(req, notes, o.replayDir);
  if (!(await req("GetStudioModeEnabled").then((r) => r.studioModeEnabled, () => false))) await req("SetStudioModeEnabled", { studioModeEnabled: true });
  const tr = ((await req("GetSceneTransitionList")).transitions ?? []) as { transitionName: string }[];
  for (const t of ["Cut", "Fade"]) if (tr.length && !tr.some((x) => x.transitionName === t)) notes.push(`OBS has no "${t}" transition; add one in OBS (Scene Transitions).`);

  const canvas = await canvasSize(req);
  const have = new Set(((await req("GetSceneList")).scenes as { sceneName: string }[]).map((s) => s.sceneName));
  const inputs = new Map(((await req("GetInputList")).inputs as { inputName: string; inputKind: string }[]).map((i) => [i.inputName, i.inputKind]));
  const note = (m: string) => notes.push(`Added ${m}.`);
  const scenes = [...SLOTS.map((n) => sceneOf(`cam${n}`)), REPLAY_SCENE];
  for (const s of [...scenes, PROBE_SCENE]) if (!have.has(s)) { await req("CreateScene", { sceneName: s }); note(s); }

  const make = async (scene: string, inputName: string, inputKind: string, inputSettings: object) => {
    if (inputs.has(inputName)) return;
    await req("CreateInput", { sceneName: scene, inputName, inputKind, inputSettings, sceneItemEnabled: true });
    inputs.set(inputName, inputKind); note(inputName);
  };
  const placeholder = { color: 0xff1f2933, width: canvas.w, height: canvas.h };
  for (const n of SLOTS) await make(sceneOf(`cam${n}`), camInput(`cam${n}`), "color_source", placeholder);
  await make(REPLAY_SCENE, REPLAY_MEDIA, "ffmpeg_source", { is_local_file: true, local_file: "", looping: false, close_when_inactive: false, restart_on_activate: false });
  const overlay = { url: o.overlayUrl, width: canvas.w, height: canvas.h, fps: 30, css: OVERLAY_CSS, shutdown: false, restart_when_active: false, reroute_audio: false };
  await make(scenes[0], OVERLAY, "browser_source", overlay);
  if (inputs.has(OVERLAY)) { // only touch the settings when they differ: re-applying identical ones can reload the page
    const cur = (await req("GetInputSettings", { inputName: OVERLAY })).inputSettings ?? {};
    if (Object.entries(overlay).some(([k, v]) => cur[k] !== v)) await req("SetInputSettings", { inputName: OVERLAY, inputSettings: overlay, overlay: true });
  }
  const micKind = ["pulse_input_capture", "wasapi_input_capture", "coreaudio_input_capture"].find((k) => o.inputKinds.has(k));
  if (micKind) await make(scenes[0], MIC, micKind, { device_id: "default" });

  for (const s of scenes) {
    const video = s === REPLAY_SCENE ? REPLAY_MEDIA : camInput(s.slice(3));
    for (const inp of [video, ...(micKind ? [MIC] : []), OVERLAY]) await ensureInScene(req, s, inp, note);
    const items = (await req("GetSceneItemList", { sceneName: s })).sceneItems as { sourceName: string; sceneItemId: number; sceneItemIndex: number; sceneItemTransform?: any }[] | undefined;
    if (!items) continue;
    const by = (n: string) => items.find((i) => i.sourceName === n);
    const v = by(video), ov = by(OVERLAY);
    if (v && (v.sceneItemTransform?.boundsType !== "OBS_BOUNDS_SCALE_INNER" || v.sceneItemTransform?.boundsWidth !== canvas.w)) await fitItem(req, s, v.sceneItemId, canvas);
    if (v && v.sceneItemIndex !== 0) await req("SetSceneItemIndex", { sceneName: s, sceneItemId: v.sceneItemId, sceneItemIndex: 0 });
    if (ov && ov.sceneItemIndex !== items.length - 1) await req("SetSceneItemIndex", { sceneName: s, sceneItemId: ov.sceneItemId, sceneItemIndex: items.length - 1 });
  }
  return { profile: PROFILE, scenes, replayBuffer, notes };
}
