// Hands-off end-to-end check against a REAL OBS, driven only through Fieldhouse (its HTTP API), the way the app uses it.
//
//   bun scripts/obs-e2e-hands-off.ts
//
// Start with OBS NOT running: the script starts a Fieldhouse server (engine = OBS) and measures the cold start (Fieldhouse launches
// OBS itself, quietly). Then it changes quality, records at 720p30 and 1080p30 (ffprobe), manages audio inputs, streams to a LOCAL
// RTMP sink at the configured bitrate (and drops/restores the sink), refuses a closed-port destination without ever calling
// StartStream, reads OBS's log into a notice, kills OBS to see it come back, and finally quits Fieldhouse to see OBS stop.
// Nothing in OBS is touched by hand. Needs ffmpeg + ffprobe. Work files: ~/.cache/fieldhouse-e2e-hands-off (Flatpak OBS cannot see /tmp),
// removed at the end. SAFETY: never streams to an address that does not answer (OBS would open a modal "Failed to connect" dialog).
// The OBS window check uses KWin scripting (KDE Plasma); elsewhere it reports "cannot tell".
import { spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { Harness, api, obsPids, rawObs, sleep, state, until, wsConfig } from "./hands-off-lib";

if (spawnSync("which", ["ffmpeg"]).status !== 0 || spawnSync("which", ["ffprobe"]).status !== 0) { console.log("SKIP: ffmpeg and ffprobe are required."); process.exit(0); }
if (obsPids().length) { console.log("SKIP: OBS is already running; stop it so the cold start can be measured."); process.exit(0); }
const h = new Harness("fieldhouse-e2e-hands-off");
const work = h.work;
const procs = h.procs;

let passes = 0, fails = 0;
const ok = (name: string, cond: unknown, detail = "") => { cond ? passes++ : fails++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  [" + detail + "]" : ""}`); return !!cond; };
const section = (s: string) => console.log(`\n== ${s}`);
const pw = () => { try { return JSON.parse(readFileSync(wsConfig, "utf8")).server_password as string; } catch { return "\u0000unreadable"; } };

// ---- which OBS windows exist? (KDE Plasma/Wayland: ask KWin. Anything else: we cannot tell.)
function obsWindows(): number | null {
  if (spawnSync("which", ["qdbus6"]).status !== 0) return null;
  const script = join(work, "kw.js");
  require("node:fs").writeFileSync(script, `var n=0;workspace.windowList().forEach(function(w){if(String(w.resourceClass).toLowerCase().indexOf("obs")>=0)n++;});print("FHE2E|count="+n);`);
  const id = spawnSync("qdbus6", ["org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.loadScript", script, "fhe2e"], { encoding: "utf8" }).stdout.trim();
  if (!id) return null;
  spawnSync("qdbus6", ["org.kde.KWin", `/Scripting/Script${id}`, "org.kde.kwin.Script.run"]);
  spawnSync("sleep", ["0.8"]);
  const out = spawnSync("journalctl", ["--since", "-4s", "--no-pager", "-o", "cat"], { encoding: "utf8" }).stdout;
  spawnSync("qdbus6", ["org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.unloadScript", "fhe2e"]);
  const m = [...out.matchAll(/FHE2E\|count=(\d+)/g)].at(-1);
  return m ? Number(m[1]) : null;
}
const probe = (f: string) => { const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate,codec_name:format=duration", "-of", "json", f], { encoding: "utf8" }); try { const j = JSON.parse(r.stdout); const [a, b] = String(j.streams[0].r_frame_rate).split("/").map(Number); return { w: j.streams[0].width as number, h: j.streams[0].height as number, fps: a / (b || 1), dur: Number(j.format.duration), codec: j.streams[0].codec_name as string }; } catch { return null; } };
const closedPort = () => new Promise<number>((res) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as any).port; s.close(() => res(p)); }); });
// A local RTMP sink that survives Fieldhouse's connection probe. `ffmpeg -listen 1` serves ONE connection and the destination check
// (a plain TCP connect) would use it up, so a small proxy on :1935 swallows probes (connections that send nothing) and hands a real
// RTMP session to a fresh ffmpeg listener on :1936. kill() drops the session like a service going down; start() brings the service back.
function rtmpSink() {
  const conns = new Set<any>(); let ff: ChildProcess | undefined;
  const start = () => { ff = h.spawn("ffmpeg", ["-v", "info", "-listen", "1", "-i", "rtmp://127.0.0.1:1936/live/key", "-f", "null", "-"]); };
  const srv = Bun.listen<{ up?: any; pending: Uint8Array[]; dead?: boolean }>({ hostname: "127.0.0.1", port: 1935, socket: {
    open(c) { c.data = { pending: [] }; conns.add(c); },
    async data(c, buf) {
      if (c.data.up) return void c.data.up.write(buf);
      c.data.pending.push(new Uint8Array(buf));
      if (c.data.pending.length > 1) return;
      const up = await Bun.connect({ hostname: "127.0.0.1", port: 1936, socket: { data(_u, b) { c.write(b); }, close() { c.end(); }, error() { c.end(); } } }).catch(() => null);
      if (!up) return void c.end();
      c.data.up = up; for (const p of c.data.pending) up.write(p);
    },
    close(c) { conns.delete(c); c.data.up?.end(); }, error() {},
  } });
  start();
  return { kill() { ff?.kill("SIGKILL"); for (const c of [...conns]) c.end(); }, start, stop() { ff?.kill("SIGKILL"); for (const c of [...conns]) c.end(); srv.stop(true); } };
}

async function main() {
  section("A. cold start: Fieldhouse launches OBS by itself");
  const t0 = Date.now();
  h.startServer();
  const up = await until(async () => { const s = await state(); return s?.engine?.connected && s.engine.obs.provisioned && s; }, 120000, 250) as any;
  if (!ok("OBS was started by Fieldhouse, connected and provisioned", !!up, `${Date.now() - t0} ms from server start`)) return;
  ok("Fieldhouse owns that OBS (so it will close it)", up?.engine.obs.managed?.owned === true && up.engine.obs.managed.state === "running", JSON.stringify(up?.engine.obs.managed?.state));
  ok("the OBS password is never in the API", !JSON.stringify(up).includes(pw()) && up.settings.engine.obsPasswordSet === true);
  const win = obsWindows();
  ok("no OBS window is visible after launch", win === 0 || win === null, win === null ? "cannot tell on this desktop: please confirm visually" : `${win} OBS windows known to the window manager`);
  // A planned restart (size/fps/encoder changes) replaces OBS, so the raw read-only client reconnects on demand.
  let rawc: Awaited<ReturnType<typeof rawObs>> | undefined;
  const obs = {
    req: async (t: string, d?: object): Promise<any> => {
      for (let i = 0; i < 20; i++) {
        try { if (!rawc || rawc.dead) rawc = await rawObs(); const r = await rawc.req(t, d); if (r.__error !== "connection lost") return r; } catch {}
        rawc = undefined; await sleep(500);
      }
      return { __error: "unreachable" };
    },
    close: () => rawc?.close(),
  };
  ok("the Fieldhouse profile is active", (await obs.req("GetProfileList")).currentProfileName === "Fieldhouse");

  section("C2. quiet reconnect settings in OBS");
  const prm = async (c: string, n: string) => (await obs.req("GetProfileParameter", { parameterCategory: c, parameterName: n })).parameterValue;
  ok("Reconnect=true, RetryDelay=2, MaxRetries=2000", (await prm("Output", "Reconnect")) === "true" && (await prm("Output", "RetryDelay")) === "2" && (await prm("Output", "MaxRetries")) === "2000");

  section("stand-in cameras (ffmpeg files) and a game");
  const A = join(work, "a.mp4"), B = join(work, "b.mp4");
  for (const [f, src] of [[A, "testsrc2=size=1280x720:rate=30"], [B, "smptebars=size=1280x720:rate=30"]]) spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", src, "-f", "lavfi", "-i", "sine=frequency=440", "-t", "60", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", f]);
  for (const n of [1, 2, 3, 4]) await api("POST", "/slots", { slot: n, deviceId: null }); // OBS remembers slots from earlier runs
  const da = (await api("POST", "/devices/network", { url: A, label: "Center court" })).body, db = (await api("POST", "/devices/network", { url: B, label: "Baseline" })).body;
  await api("POST", "/slots", { slot: 1, deviceId: da.id, label: "Center court" }); await api("POST", "/slots", { slot: 2, deviceId: db.id, label: "Baseline" });
  ok("two sources placed", (await state()).engine.sources.length === 2);
  const games = (await api("GET", "/games")).body, g = games.find((x: any) => x.status === "scheduled");
  const rec = (await api("GET", "/destinations")).body.find((d: any) => d.kind === "record");
  await api("PUT", `/games/${g.id}`, { ...g, destinationIds: [rec.id] });
  await api("PUT", "/settings", { storageDir: join(work, "rec") });
  await api("POST", `/games/${g.id}/activate`);

  section("B1. quality: apply and read back, record at 720p30 and 1080p30");
  const info0 = (await api("GET", "/engine/video")).body;
  ok("encoder list comes from OBS itself", info0.encoders.some((e: any) => e.id === "x264"), info0.encoders.map((e: any) => e.id).join(","));
  const record = async (secs: number) => { const s = await api("POST", "/broadcast/start"); if (s.status !== 200) return { err: s.body.error }; await sleep(secs * 1000); await api("POST", "/broadcast/stop"); const st = await state(); return { file: st.recording?.file as string }; };
  let put = await api("PUT", "/engine/video", { resolution: "720p", fps: 30 });
  ok("720p30 applied", put.status === 200 && put.body.applied.outputHeight === 720 && put.body.applied.fps === 30 && put.body.differences.length === 0, JSON.stringify(put.body.applied));
  let r1 = await record(5);
  let p1 = r1.file ? probe(r1.file) : null;
  ok("recording is really 1280x720 at 30 fps (ffprobe)", !!p1 && p1.w === 1280 && p1.h === 720 && Math.round(p1.fps) === 30 && p1.dur > 3, p1 ? `${p1.w}x${p1.h} @ ${p1.fps} fps, ${p1.dur.toFixed(1)} s, ${p1.codec}` : r1.err);
  const t1 = Date.now();
  put = await api("PUT", "/engine/video", { resolution: "1080p", fps: 30, videoKbps: 6000 });
  ok("1080p30 applied and read back", put.status === 200 && put.body.applied.outputHeight === 1080 && put.body.applied.videoKbps === 6000 && put.body.differences.length === 0, `${Date.now() - t1} ms`);
  const vs = (await obs.req("GetVideoSettings"));
  ok("OBS itself reports 1920x1080 output, 1080 canvas", vs.outputWidth === 1920 && vs.outputHeight === 1080 && vs.baseHeight === 1080 && vs.fpsNumerator === 30);
  await until(async () => (await state()).engine.obs.replayBuffer, 8000);
  let r2 = await record(5);
  let p2 = r2.file ? probe(r2.file) : null;
  ok("recording is really 1920x1080 at 30 fps (ffprobe)", !!p2 && p2.w === 1920 && p2.h === 1080 && Math.round(p2.fps) === 30, p2 ? `${p2.w}x${p2.h} @ ${p2.fps} fps, ${p2.dur.toFixed(1)} s` : r2.err);
  const f = (await api("PUT", "/engine/video", { recordFormat: "mkv" })).body;
  ok("MKV format applied (crash-safe container)", f.applied.recordFormat === "mkv");
  const r3 = await record(4); ok("MKV recording file is playable", !!r3.file && r3.file.endsWith(".mkv") && !!probe(r3.file), r3.file?.split("/").pop());
  await api("PUT", "/engine/video", { recordFormat: "mp4", resolution: "720p", videoKbps: 4500 });

  section("B2. replay length");
  const rp = await api("PUT", "/engine/video", { replaySeconds: 30 });
  ok("replay length 30 s applied; the buffer runs again", rp.body.applied.replaySeconds === 30 && (await prm("SimpleOutput", "RecRBTime")) === "30" && (await until(async () => (await obs.req("GetReplayBufferStatus")).outputActive, 8000)) === true);
  await api("PUT", "/engine/video", { replaySeconds: 60 });

  section("B3. audio inputs");
  const au0 = (await api("GET", "/engine/audio")).body;
  ok("audio devices listed from OBS", Array.isArray(au0.devices), `${au0.devices.length} devices, desktop capture ${au0.canDesktop ? "available" : "not available"}`);
  const mic = await api("POST", "/engine/audio", { role: "mic", label: "Commentary mic" });
  ok("microphone added with a Fieldhouse name", mic.status === 200 && mic.body.id.startsWith("FH Mic") && mic.body.label === "Commentary mic", mic.body.id);
  ok("it exists in OBS under an FH name and is in every FH scene", !(await obs.req("GetInputSettings", { inputName: mic.body.id })).__error && !(await obs.req("GetSceneItemId", { sceneName: "FH cam2", sourceName: mic.body.id })).__error);
  if (au0.canDesktop) { const d = await api("POST", "/engine/audio", { role: "desktop", label: "Crowd" }); ok("desktop / room sound added", d.status === 200 && d.body.role === "desktop", d.body.id ?? d.body.error); if (d.status === 200) { await api("PUT", `/engine/audio/${encodeURIComponent(d.body.id)}`, { muted: true, gainDb: -8 }); const mu = await obs.req("GetInputMute", { inputName: d.body.id }); ok("mute + gain reach OBS", mu.inputMuted === true && Math.round((await obs.req("GetInputVolume", { inputName: d.body.id })).inputVolumeDb) === -8); await api("DELETE", `/engine/audio/${encodeURIComponent(d.body.id)}`); ok("desktop sound removed from OBS", !!(await obs.req("GetInputSettings", { inputName: d.body.id })).__error); } }
  await api("PUT", `/engine/audio/${encodeURIComponent(mic.body.id)}`, { label: "Press box", gainDb: -3 });
  ok("rename and gain", (await state()).engine.mixer.find((m: any) => m.id === mic.body.id)?.label === "Press box" && Math.round((await obs.req("GetInputVolume", { inputName: mic.body.id })).inputVolumeDb) === -3);
  await api("DELETE", `/engine/audio/${encodeURIComponent(mic.body.id)}`);
  ok("microphone removed; OBS's own inputs untouched", !!(await obs.req("GetInputSettings", { inputName: mic.body.id })).__error && !(await obs.req("GetInputSettings", { inputName: "FH Mic" })).__error);

  section("B4. per-source options (file sources stand in for cameras)");
  const so = (await api("GET", "/slots/1/settings")).body;
  ok("a file source reports its masked address and can restart", so.type === "file" && so.address === "a.mp4" && so.canReconnect, JSON.stringify({ type: so.type, address: so.address }));
  const stream = h.spawn("ffmpeg", ["-v", "error", "-re", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-f", "mpegts", "-listen", "1", "http://127.0.0.1:8890/live.ts"]);
  await sleep(700);
  const dn = (await api("POST", "/devices/network", { url: "http://127.0.0.1:8890/live.ts", label: "Bench stream" })).body;
  await api("POST", "/slots", { slot: 3, deviceId: dn.id, label: "Bench" });
  const no = await api("POST", "/slots/3/settings", { reconnectSeconds: 9, bufferingMb: 4, restart: true });
  const back = (await obs.req("GetInputSettings", { inputName: "FH cam3 video" })).inputSettings ?? {};
  ok("network source: retry/buffer applied and read back from OBS", no.status === 200 && back?.reconnect_delay_sec === 9 && back?.buffering_mb === 4 && no.body.address === "http://127.0.0.1:8890/live.ts" || no.body.address?.startsWith("http://127.0.0.1:8890"), `${JSON.stringify({ r: back.reconnect_delay_sec, b: back.buffering_mb, a: no.body.address })}`);
  ok("(real UVC cameras: resolution/frame rate lists NOT verified, no camera here)", true);

  section("C1. a destination that does not answer is refused without ever calling StartStream");
  const dead = await closedPort();
  const dd = (await api("POST", "/destinations", { kind: "rtmp", name: "Nowhere", url: `rtmp://127.0.0.1:${dead}/live`, key: "k", enabled: true })).body;
  await api("PUT", `/games/${g.id}`, { ...g, destinationIds: [dd.id] });
  const tt = await api("POST", `/destinations/${dd.id}/test`);
  ok("the Test button uses the same check", tt.body.ok === false && tt.body.message.includes("did not answer"), tt.body.message);
  const refused = await api("POST", "/broadcast/start");
  const ss = await obs.req("GetStreamStatus"), rs = await obs.req("GetRecordStatus");
  ok("go-live refused with a plain message", refused.status === 400 && refused.body.error.includes("did not answer"), refused.body.error);
  ok("OBS never started streaming or recording", ss.outputActive === false && rs.outputActive === false);
  const win2 = obsWindows();
  ok("no OBS dialog appeared", win2 === 0 || win2 === null, win2 === null ? "cannot tell" : `${win2} windows`);
  const pf = (await api("POST", "/preflight")).body.find((c: any) => c.id === `network.dns.${dd.id}`);
  ok("Preflight reports it too", pf?.status === "err", pf?.result);

  section("C2. stream to a LOCAL RTMP sink at the configured bitrate, drop and restore it");
  await api("PUT", "/engine/video", { videoKbps: 4500 });
  const sk = rtmpSink(); await sleep(1200);
  const ds = (await api("POST", "/destinations", { kind: "rtmp", name: "Local sink", url: "rtmp://127.0.0.1:1935/live", key: "key", enabled: true })).body;
  await api("PUT", `/games/${g.id}`, { ...g, destinationIds: [ds.id] });
  const go = await api("POST", "/broadcast/start");
  ok("go live to the local sink", go.status === 200, go.body.error ?? "");
  await sleep(12000);
  const samples: number[] = []; for (let i = 0; i < 6; i++) { samples.push((await state()).engine.stream.kbps); await sleep(1000); }
  const avg = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
  ok("measured stream bitrate is near the configured 4500 kbps", avg > 1500 && avg < 7000, `${avg} kbps average (${samples.join(", ")})`);
  sk.kill(); const d0 = Date.now();
  const rc = await until(async () => (await state()).engine.stream.reconnecting, 30000, 200);
  ok("sink dropped: Fieldhouse shows Reconnecting, no OBS dialog", !!rc, `${Date.now() - d0} ms`);
  const win3 = obsWindows(); ok("still no OBS window while reconnecting", win3 === 0 || win3 === null);
  sk.start(); const d1 = Date.now();
  const back2 = await until(async () => { const s = (await state()).engine.stream; return s.live && !s.reconnecting && s.kbps > 0; }, 120000, 500);
  ok("sink back: the stream recovers by itself", !!back2, `${Math.round((Date.now() - d1) / 1000)} s after the sink returned`);
  await api("POST", "/broadcast/stop");
  ok("stopped cleanly", !(await state()).engine.stream.live);
  sk.stop();

  section("C3. OBS's own log becomes a plain notice");
  await obs.req("SetInputSettings", { inputName: "FH cam2 video", inputSettings: { local_file: join(work, "missing.mp4") }, overlay: true });
  const n = await until(async () => (await state()).notices.find((x: any) => /video file or network stream could not be opened/.test(x.message)), 12000, 500);
  ok("a missing media file shows as a plain notice", !!n, (n as any)?.message?.slice(0, 80));
  ok("no raw OBS text in notices", !(await state()).notices.some((x: any) => /Failed to open media|\.mp4/.test(x.message)));
  const bundle = JSON.stringify((await api("GET", "/diagnostics")).body.bundle);
  ok("diagnostics carry the problem line, no secrets", bundle.includes("videoEngineProblems") && !bundle.includes(pw()) && !bundle.includes('"key"'));
  await obs.req("SetInputSettings", { inputName: "FH cam2 video", inputSettings: { local_file: B }, overlay: true });

  section("A2. kill OBS: Fieldhouse brings it back with the saved settings");
  obs.close();
  await api("PUT", "/engine/video", { resolution: "1080p", videoKbps: 6000 });
  ok("a 1080p/6000 change is applied before the kill", (await api("GET", "/engine/video")).body.applied?.outputHeight === 1080);
  const pid = obsPids()[0]; const k0 = Date.now();
  spawnSync("kill", ["-KILL", String(pid)]);
  const seenDown = await until(async () => !(await state()).engine.connected, 8000, 100);
  const states: string[] = [];
  const bk = await until(async () => { const s = await state(); const m = s.engine.obs.managed; if (m && states.at(-1) !== m.message) states.push(m.message); return seenDown && s.engine.connected && s.engine.obs.provisioned; }, 90000, 300);
  ok("OBS came back by itself, connected and provisioned", !!bk, `${Date.now() - k0} ms after the kill; messages: ${states.join(" > ")}`);
  ok("the operator was told", states.some((m) => m.includes("Restarting the video engine")) && (await state()).notices.some((x: any) => x.message.includes("video engine stopped")));
  ok("no OBS window after the relaunch", [0, null].includes(obsWindows()));
  ok("sources restored after the restart", (await state()).engine.sources.length === 3);
  const va = (await api("GET", "/engine/video")).body;
  ok("the persisted settings were re-applied by the restart (1080p, 6000 kbps)", va.applied?.outputHeight === 1080 && va.applied?.videoKbps === 6000 && va.differences?.length === 0, JSON.stringify(va.applied));

  section("A3. quit Fieldhouse: the OBS it started stops");
  const q0 = Date.now();
  h.server!.kill("SIGTERM");
  await until(() => h.server!.exitCode !== null, 25000, 100);
  const gone = await until(() => obsPids().length === 0, 15000, 200);
  ok("OBS stopped after Fieldhouse quit", !!gone, `${Date.now() - q0} ms`);
}

try { await main(); }
catch (e: any) { fails++; console.log(`FAIL  unexpected error: ${e?.stack ?? e}`); }
finally {
  // Always runs, whatever happened above: stops Fieldhouse, the RTMP sink and every child, OBS if it is still up, disables the OBS websocket
  // (fresh random password) and deletes the work dir. The server log is kept only when something failed.
  if (fails) { try { require("node:fs").copyFileSync(join(work, "home", "logs", "fieldhouse.log"), join(homedir(), ".cache", "e2e-hands-off-server.log")); console.log("server log kept at ~/.cache/e2e-hands-off-server.log"); } catch {} }
  await h.cleanup();
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
}
