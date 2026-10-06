// End-to-end check of ObsEngine against a REAL, running OBS Studio (obs-websocket v5).
//
//   bun scripts/obs-e2e.ts            (OBS_PASSWORD is required: the obs-websocket password; OBS_URL overrides ws://127.0.0.1:4455)
//   OBS_E2E_RESTART=1 bun scripts/obs-e2e.ts   also kills and relaunches OBS to prove reconnect + re-provisioning
//
// Skips (exit 0) with a clear message when OBS or its websocket is unreachable. Uses ffmpeg/ffprobe for stand-in cameras, a
// local RTMP sink (never an unreachable server: a failing StartStream makes the real OBS open a modal "Failed to connect"
// dialog on the desktop; that failure path is covered by the mock-server tests only) and verifying recordings; stage 1 of each section is skipped if a tool is missing. Work files live in
// ~/.cache/fieldhouse-e2e (a Flatpak OBS can read $HOME but not /tmp) and are removed at the end. Touches only FH-prefixed
// things in OBS plus the "Fieldhouse" profile; leaves OBS running. WARNING: it takes the program output on air briefly.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ObsEngine } from "../src/obs";
import { launchObs, wsAnswers } from "../src/obs-manager";
import { paths } from "../src/config";

const URL_ = process.env.OBS_URL ?? "ws://127.0.0.1:4455", PW = process.env.OBS_PASSWORD ?? "", PORT = 8201;
if (!PW) { console.log("SKIP: set OBS_PASSWORD to the obs-websocket password to run this script against a live OBS."); process.exit(0); }
if (!(await wsAnswers(URL_))) { console.log(`SKIP: no OBS websocket answers at ${URL_}. Start OBS (Tools > WebSocket Server Settings > enable) and rerun.`); process.exit(0); }

const work = join(homedir(), ".cache", "fieldhouse-e2e"), recDir = join(work, "rec");
rmSync(work, { recursive: true, force: true }); mkdirSync(recDir, { recursive: true });
const procs: ChildProcess[] = [];
let fails = 0, passes = 0;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const ok = (name: string, cond: unknown, detail = "") => { cond ? passes++ : fails++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  [" + detail + "]" : ""}`); return !!cond; };
const section = (s: string) => console.log(`\n== ${s}`);
const until = async (f: () => unknown | Promise<unknown>, ms = 8000, step = 100) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await f(); if (v) return v; await sleep(step); } return null; };
const have = (bin: string) => spawnSync("which", [bin]).status === 0;
const ff = (args: string[]) => { const p = spawn("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "ignore" }); procs.push(p); return p; };
const ffDone = (args: string[]) => new Promise<number | null>((r) => ff(args).on("exit", r));
const probe = (f: string) => { const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_name,codec_type", "-of", "json", f], { encoding: "utf8" }); try { const j = JSON.parse(r.stdout); return { dur: Number(j.format.duration), codecs: j.streams.map((s: any) => s.codec_name) as string[] }; } catch { return null; } };
const isJpeg = (b?: Uint8Array | null) => !!b && b.length > 1000 && b[0] === 0xff && b[1] === 0xd8;

// The overlay page OBS loads: a tiny server standing in for Fieldhouse's own on port 8201.
const overlay = Bun.serve({ port: PORT, hostname: "127.0.0.1", fetch: (r) => (new URL(r.url).pathname === "/overlay" ? new Response(Bun.file(paths().overlay)) : new Response("no", { status: 404 })) });
const e = new ObsEngine(URL_, PW, { overlayUrl: `http://127.0.0.1:${PORT}/overlay`, replayDir: join(work, "replays") });
const raw = (t: string, d?: object) => e.request(t, d, 15000);
const programScene = async () => (await raw("GetCurrentProgramScene")).currentProgramSceneName as string;
const previewScene = async () => (await raw("GetCurrentPreviewScene")).currentPreviewSceneName as string;

let startScenes: { program: string; preview: string | null } | undefined;
async function main() {
  section("connect + provision");
  const t0 = Date.now();
  ok("connects, identifies, provisions", await until(() => e.status().connected && e.status().obs?.provisioned, 30000), `${Date.now() - t0} ms`);
  startScenes = { program: await programScene(), preview: await previewScene().catch(() => null) };
  const st = e.status();
  ok("OBS version reported", !!st.obs?.version, st.obs?.version);
  ok("graphicsInProgram is true", st.graphicsInProgram === true);
  const snapshotState = async () => JSON.stringify({ scenes: (await raw("GetSceneList")).scenes.map((s: any) => s.sceneName).sort(), inputs: (await raw("GetInputList")).inputs.map((i: any) => i.inputName).sort(), studio: (await raw("GetStudioModeEnabled")).studioModeEnabled, profile: (await raw("GetProfileList")).currentProfileName, items: (await Promise.all(["FH cam1", "FH cam2", "FH cam3", "FH cam4", "FH Replay"].map((s) => raw("GetSceneItemList", { sceneName: s })))).map((r: any) => r.sceneItems.map((i: any) => i.sourceName).join("|")) });
  const before = await snapshotState();
  const t1 = Date.now();
  await e.provision();
  const after = await snapshotState();
  ok("provisioning twice changes nothing (idempotent)", before === after, `second run ${Date.now() - t1} ms, notes: ${e.status().obs!.notes.length}`);
  ok("second run reports no additions", e.status().obs!.notes.length === 0, e.status().obs!.notes.join("; "));
  const s0 = JSON.parse(after);
  ok("scenes FH cam1..4 + FH Replay exist", ["FH cam1", "FH cam2", "FH cam3", "FH cam4", "FH Replay"].every((n) => s0.scenes.includes(n)));
  ok("studio mode on, profile 'Fieldhouse'", s0.studio === true && s0.profile === "Fieldhouse");
  ok("every FH scene has the overlay on top", (await Promise.all(["FH cam1", "FH cam2", "FH cam3", "FH cam4", "FH Replay"].map(async (s) => { const it = (await raw("GetSceneItemList", { sceneName: s })).sceneItems; return it.at(-1).sourceName === "FH Overlay" && it.at(-1).sceneItemIndex === it.length - 1; }))).every(Boolean));
  const ov = (await raw("GetInputSettings", { inputName: "FH Overlay" })).inputSettings;
  ok("overlay is a 1920x1080 browser source on our URL", ov.url === `http://127.0.0.1:${PORT}/overlay` && ov.width === 1920 && ov.height === 1080, ov.url);
  ok("replay buffer running, 60 s", st.obs?.replayBuffer && (await raw("GetProfileParameter", { parameterCategory: "SimpleOutput", parameterName: "RecRBTime" })).parameterValue === "60");
  const fmt = (await raw("GetProfileParameter", { parameterCategory: "SimpleOutput", parameterName: "RecFormat2" })).parameterValue;
  ok("recording format is crash-safe", ["hybrid_mp4", "hybrid_mov", "mkv", "fragmented_mp4", "fragmented_mov"].includes(fmt), fmt);

  section("devices + sources");
  const devs = await e.detectDevices();
  ok("detectDevices returns stable ids", devs.every((d) => /^[\w-]+:.+/.test(d.id)), devs.map((d) => d.id).join(", "));
  ok("probe inputs were cleaned up", !(await raw("GetInputList")).inputs.some((i: any) => i.inputName.startsWith("FH probe")));
  ok("PipeWire camera listed", devs.some((d) => d.id === "pipewire-camera-source:portal"));
  for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "ftp://x/y", "srt://host", "rtmp://", "/etc/passwd", "not a url", ""])
    ok(`rejects "${bad}"`, await e.addNetworkSource(bad, "x").then(() => false, () => true));

  if (!have("ffmpeg")) { console.log("ffmpeg missing: skipping the media sections"); return; }
  const A = join(work, "a.mp4"), B = join(work, "b.mp4");
  await ffDone(["-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "40", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", A]);
  await ffDone(["-f", "lavfi", "-i", "smptebars=size=1280x720:rate=30", "-f", "lavfi", "-i", "sine=frequency=880", "-t", "40", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", B]);
  ok("test videos generated", existsSync(A) && existsSync(B));
  const da = await e.addNetworkSource(A, "Center court"), db = await e.addNetworkSource(B, "Baseline");
  ok("file source device ids", da.id === `ffmpeg_source:${A}` && db.kind === "test", da.id);
  const live = ff(["-re", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-f", "lavfi", "-i", "sine=frequency=660", "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-c:a", "aac", "-f", "mpegts", "-listen", "1", "http://127.0.0.1:8890/live.ts"]);
  await sleep(700);
  const dn = await e.addNetworkSource("http://127.0.0.1:8890/live.ts", "Bench stream");
  ok("network source device", dn.kind === "srt" && dn.detail === "Web stream", `${dn.kind} ${dn.detail}`);
  const t2 = Date.now();
  await e.setSlot(1, da.id, "Center court");
  await e.setSlot(2, db.id, "Baseline");
  await e.setSlot(3, dn.id, "Bench");
  ok("setSlot x3", true, `${Date.now() - t2} ms`);
  const srcs = e.status().sources;
  ok("sources reflect slots with deviceId + label", srcs.length === 3 && srcs[0].deviceId === da.id && srcs[0].label === "Center court" && srcs[2].label === "Bench", srcs.map((s) => `${s.id}:${s.label}:${s.status}`).join(" "));
  const inp = (await raw("GetInputSettings", { inputName: "FH cam1 video" }));
  ok("OBS input keeps its name and is an ffmpeg_source", inp.inputKind === "ffmpeg_source" && inp.inputSettings.is_local_file === true && inp.inputSettings.local_file === A);
  const inp3 = (await raw("GetInputSettings", { inputName: "FH cam3 video" })).inputSettings;
  ok("network source is not a local file, reconnects", inp3.is_local_file === false && inp3.input === "http://127.0.0.1:8890/live.ts" && inp3.reconnect_delay_sec === 5, `buffering ${inp3.buffering_mb} MB`);
  ok("devices list marks in-use + network sources", (await e.detectDevices()).filter((d) => d.inUse).length === 3);
  await until(() => e.status().sources.every((s) => s.status === "ok"), 8000);
  ok("all sources report ok", e.status().sources.every((s) => s.status === "ok"), e.status().sources.map((s) => s.status).join(","));
  ok("program/preview auto-routed to real cameras", e.status().program === "cam1" && e.status().preview === "cam2", `${e.status().program}/${e.status().preview}`);

  section("transport");
  await e.setPreview("cam2");
  ok("setPreview changes OBS preview scene", (await previewScene()) === "FH cam2");
  const c0 = Date.now();
  await e.cut();
  ok("cut changes OBS program scene", (await programScene()) === "FH cam2", `${Date.now() - c0} ms; preview now ${await previewScene()}`);
  ok("status follows from events", e.status().program === "cam2" && e.status().preview === "cam1", `${e.status().program}/${e.status().preview}`);
  const f0 = Date.now();
  await e.fade(800);
  const fadeMs = Date.now() - f0;
  ok("fade(800) takes ~800 ms and swaps", (await programScene()) === "FH cam1" && fadeMs >= 700 && fadeMs < 3000, `${fadeMs} ms`);
  ok("Fade transition duration set to 800", (await raw("GetCurrentSceneTransition")).transitionDuration === 800);
  await e.setPreview("cam3"); await e.cut(); await e.setPreview("cam1"); await e.cut();
  await expectReject("setPreview of an empty slot", e.setPreview("cam4"), "no such source");

  section("snapshots");
  const p = await e.snapshot("program"), pv = await e.snapshot("preview"), c1 = await e.snapshot("cam1"), c3 = await e.snapshot("cam3");
  ok("program snapshot is a JPEG", p?.type === "image/jpeg" && isJpeg(p.body), `${p?.body.length} bytes`);
  ok("preview/cam/stream snapshots are JPEGs", isJpeg(pv?.body) && isJpeg(c1?.body) && isJpeg(c3?.body), `${pv?.body.length}/${c1?.body.length}/${c3?.body.length} bytes`);
  ok("empty slot and unknown id give null", (await e.snapshot("cam4")) === null && (await e.snapshot("nope")) === null);
  const a1 = e.snapshot("program"), a2 = e.snapshot("program");
  ok("snapshots are cached within 150 ms", a1 === a2);
  const t3 = Date.now(); let n = 0; while (Date.now() - t3 < 1000) { await Promise.all(["program", "preview", "cam1", "cam2", "cam3", "program"].map((i) => e.snapshot(i))); n++; await sleep(250); }
  ok("polling 6 images x 4 fps stays cheap", n >= 3, `${n} rounds in 1 s`);

  section("mixer + meters");
  await until(() => e.status().mixer.some((m) => m.id === "FH cam1 video" && m.level > 0.05), 8000);
  const mx = e.status().mixer;
  const m1 = mx.find((m) => m.id === "FH cam1 video");
  ok("mixer lists OBS audio inputs with friendly labels", !!m1 && m1.label === "Center court" && mx.some((m) => m.id === "FH Mic") && mx.some((m) => m.id === "Desktop Audio") && !mx.some((m) => m.id === "FH Overlay"), mx.map((m) => m.label).join(", "));
  const lv: number[] = []; for (let i = 0; i < 10; i++) { lv.push(e.status().mixer.find((m) => m.id === "FH cam1 video")!.level); await sleep(120); }
  ok("program camera meter moves (live peaks)", Math.max(...lv) > 0.05 && Math.max(...lv) <= 1, `levels ${lv.map((x) => x.toFixed(2)).join(" ")}`);
  ok("SourceInfo.audio follows the camera meter", e.status().sources.find((s) => s.id === "cam1")!.audio > 0.01, String(e.status().sources[0].audio.toFixed(2)));
  await e.setGain("FH cam1 video", -12);
  ok("setGain -12 dB reaches OBS and status", (await raw("GetInputVolume", { inputName: "FH cam1 video" })).inputVolumeDb.toFixed(1) === "-12.0" && !!(await until(() => e.status().mixer.find((m) => m.id === "FH cam1 video")!.gainDb < -11.9, 2000)));
  await e.setGain("FH cam1 video", 0);
  await e.setMute("FH cam1 video", true);
  ok("setMute reaches OBS and status, level drops to 0", (await raw("GetInputMute", { inputName: "FH cam1 video" })).inputMuted === true && !!(await until(() => { const m = e.status().mixer.find((x) => x.id === "FH cam1 video")!; return m.muted && m.level === 0; }, 2000)));
  await e.setMute("FH cam1 video", false);

  section("record");
  const rf = await e.startRecord(recDir, "e2e-game");
  ok("startRecord returns the REAL path", rf.startsWith(recDir) && /e2e-game/.test(rf) && /\.(mp4|mkv|mov)$/.test(rf), rf);
  ok("record status active", e.status().record.active && e.status().record.file === rf);
  await sleep(6000);
  const bytes = e.status().record.bytes;
  ok("record.bytes grows while recording", bytes > 0, `${bytes} bytes after 6 s`);
  const r0 = Date.now();
  await e.stopRecord();
  ok("stopRecord waits for finalize", !e.status().record.active && existsSync(rf), `${Date.now() - r0} ms`);
  const pr = probe(rf);
  ok("recording is playable (ffprobe)", !!pr && pr.dur >= 3.5 && pr.dur < 8 && pr.codecs.includes("h264"), pr ? `${pr.dur.toFixed(2)} s, ${pr.codecs.join("+")}, ${statSync(rf).size} bytes` : "unreadable");
  await e.stopRecord(); ok("stopRecord twice is harmless", true);

  section("stream (local RTMP sink)");
  if (!have("ffmpeg")) console.log("skipped");
  else {
    const sinkLog: string[] = [];
    const sink = spawn("ffmpeg", ["-v", "info", "-listen", "1", "-i", "rtmp://127.0.0.1:1935/live/key", "-f", "null", "-"], { stdio: ["ignore", "ignore", "pipe"] });
    procs.push(sink); sink.stderr!.on("data", (d) => sinkLog.push(String(d)));
    await sleep(800);
    const s0t = Date.now();
    await e.startStream({ name: "Local sink", url: "rtmp://127.0.0.1:1935/live", key: "key" });
    ok("startStream goes live", e.status().stream.live && e.status().stream.destination === "Local sink", `${Date.now() - s0t} ms`);
    await sleep(4500);
    const sx = e.status().stream;
    ok("kbps > 0 and not reconnecting", sx.kbps > 0 && !sx.reconnecting, `${sx.kbps} kbps, dropped ${sx.droppedFrames}`);
    ok("the sink received video", sinkLog.join("").includes("Video:"), "sink saw an h264 stream");
    await e.stopStream();
    ok("stopStream", !e.status().stream.live && (await raw("GetStreamStatus")).outputActive === false);
    await expectReject("startStream without a key", e.startStream({ name: "x", url: "rtmp://127.0.0.1:1935/live", key: "" }), "no stream key");
  }

  section("instant replay");
  const bufAge = Date.now() - t0;
  if (bufAge < 14000) await sleep(14000 - bufAge);
  ok("program is cam1 before replay", (await programScene()) === "FH cam1");
  const seen: string[] = [];
  const watcher = (async () => { const t = Date.now(); while (Date.now() - t < 20000) { const s = await programScene(); if (seen.at(-1) !== s) seen.push(s); await sleep(60); } })();
  const rp0 = Date.now();
  await e.replay({ secondsBack: 5, speed: 1 });
  ok("replay() returns once playing; replay.active true", e.status().replay.active === true, `${Date.now() - rp0} ms`);
  const onAir = await until(async () => (await programScene()) === "FH Replay", 3000, 50);
  ok("program goes to FH Replay", !!onAir && e.status().program === "replay", `OBS says ${await programScene()}, status says ${e.status().program}`);
  const rs = await e.snapshot("program");
  ok("program snapshot works during replay", isJpeg(rs?.body), `${rs?.body.length} bytes`);
  const onT = Date.now();
  await until(async () => (await programScene()) !== "FH Replay", 15000, 100);
  const dur = Date.now() - onT;
  ok("replay plays about 5 s then returns to the previous scene", (await programScene()) === "FH cam1" && dur > 3000 && dur < 8500, `on air ${(dur / 1000 + 0.2).toFixed(1)} s`);
  await until(() => !e.status().replay.active, 3000);
  ok("replay.active is false afterwards", !e.status().replay.active);
  ok("scene order was cam1 -> Replay -> cam1", seen.join(" > ").startsWith("FH cam1 > FH Replay > FH cam1"), seen.join(" > "));
  const rfile = (await raw("GetInputSettings", { inputName: "FH Replay media" })).inputSettings;
  ok("replay media points at the saved buffer file", typeof rfile.local_file === "string" && existsSync(rfile.local_file) && rfile.speed_percent === 100 && rfile.looping === false, `${rfile.local_file}`);
  const rpr = probe(rfile.local_file);
  ok("saved replay is playable and ~buffer-sized", !!rpr && rpr.dur > 8, rpr ? `${rpr.dur.toFixed(1)} s clip` : "unreadable");
  // half speed + stopReplay
  const h0 = Date.now();
  await e.replay({ secondsBack: 4, speed: 0.5 });
  ok("half-speed replay sets speed_percent=50", (await raw("GetInputSettings", { inputName: "FH Replay media" })).inputSettings.speed_percent === 50);
  await sleep(1200);
  const k0 = Date.now();
  await e.stopReplay();
  ok("stopReplay restores the previous scene immediately", (await programScene()) === "FH cam1" && !e.status().replay.active && Date.now() - k0 < 1500, `${Date.now() - k0} ms (replay lasted ${Date.now() - h0} ms)`);
  await watcher.catch(() => {});

  section("failure modes");
  const dead = new ObsEngine("ws://127.0.0.1:1", "x");
  await sleep(400);
  const tt = Date.now();
  const rej = await Promise.all([dead.cut(), dead.startRecord(recDir, "x"), dead.setSlot(1, null), dead.replay({ secondsBack: 5, speed: 1 }), dead.detectDevices()].map((pr) => pr.then(() => false, (x) => /not connected/i.test(x.message))));
  ok("OBS unreachable: connected=false and every action rejects fast", !dead.status().connected && rej.every(Boolean) && Date.now() - tt < 1000, `${Date.now() - tt} ms; "${dead.status().obs?.error}"`);
  await dead.close();
  const wrong = new ObsEngine(URL_, "definitely-wrong");
  await until(() => wrong.status().obs?.error?.includes("password"), 5000);
  ok("wrong password gives a plain-language reason", !wrong.status().connected && /password/i.test(wrong.status().obs?.error ?? ""), wrong.status().obs?.error);
  await wrong.close();

  if (process.env.OBS_E2E_RESTART === "1") await restartTest();
  live.kill();
}

async function expectReject(name: string, p: Promise<unknown>, text: string) { const m = await p.then(() => null, (x) => String(x.message)); ok(name, m?.includes(text), m ?? "did not reject"); }

async function restartTest() {
  section("OBS restart (reconnect + re-provision)");
  spawnSync("flatpak", ["kill", "com.obsproject.Studio"]);
  ok("engine notices OBS is gone", !!(await until(() => !e.status().connected, 10000)));
  await expectReject("actions reject while down", e.cut(), "not connected");
  const t = Date.now();
  await launchObs({ timeoutMs: 90000 });
  ok("engine reconnects and re-provisions on its own", !!(await until(() => e.status().connected && e.status().obs?.provisioned, 60000)), `${Date.now() - t} ms after relaunch`);
  ok("FH scenes still there, sources restored from the sidecar", e.status().sources.length === 3 && e.status().obs!.replayBuffer, e.status().sources.map((s) => s.label).join(", "));
}

try { await main(); }
catch (err: any) { fails++; console.log(`FAIL  unexpected error: ${err?.stack ?? err}`); }
finally {
  for (const p of procs) try { p.kill("SIGKILL"); } catch {}
  try {
    if (startScenes && !startScenes.program.startsWith("FH ")) { await raw("SetCurrentProgramScene", { sceneName: startScenes.program }); if (startScenes.preview && !startScenes.preview.startsWith("FH ")) await raw("SetCurrentPreviewScene", { sceneName: startScenes.preview }); }
    await e.setSlot(1, null); await e.setSlot(2, null); await e.setSlot(3, null);
  } catch {}
  try { await raw("SetStreamServiceSettings", { streamServiceType: "rtmp_custom", streamServiceSettings: { server: "rtmp://127.0.0.1:1935/live", key: "" } }); } catch {}
  await e.close(); overlay.stop(true);
  try { for (const f of readdirSync(recDir)) rmSync(join(recDir, f)); } catch {}
  rmSync(work, { recursive: true, force: true });
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
}
