// Quantifies how safe applying video settings is against a REAL OBS: the quality-change sequence in a loop through Fieldhouse's API
// (720p30 -> 1080p30 -> replay length -> record -> audio add/remove), counting OBS crashes and where they happen.
//
//   bun scripts/obs-apply-loop.ts [iterations=15]
//
// Start with OBS not running. Cleanup always runs (see hands-off-lib.ts). Exit code 1 if anything failed or OBS crashed.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Harness, api, obsPids, sleep, state, until } from "./hands-off-lib";

const N = Number(process.argv[2] ?? 15);
if (obsPids().length) { console.log("SKIP: OBS is already running."); process.exit(0); }
const h = new Harness("fieldhouse-apply-loop");
let crashes = 0, failures = 0; const where: string[] = [];
const t0 = Date.now();
try {
  h.startServer();
  if (!(await until(async () => { const s = await state(); return s?.engine?.connected && s.engine.obs.provisioned; }, 120000, 250))) throw new Error("engine did not come up");
  const g = (await api("GET", "/games")).body.find((x: any) => x.status === "scheduled");
  const rec = (await api("GET", "/destinations")).body.find((d: any) => d.kind === "record");
  await api("PUT", `/games/${g.id}`, { ...g, destinationIds: [rec.id] });
  await api("PUT", "/settings", { storageDir: join(h.work, "rec") });
  await api("POST", `/games/${g.id}/activate`);
  const src = join(h.work, "a.mp4");
  spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "60", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", src]);
  const d = (await api("POST", "/devices/network", { url: src, label: "Center" })).body;
  await api("POST", "/slots", { slot: 1, deviceId: d.id, label: "Center" });

  let pid = obsPids()[0];
  for (let i = 1; i <= N; i++) {
    const stops = async () => ((await state())?.notices ?? []).filter((n: any) => /video engine stopped/i.test(n.message)).length;
    const step = async (name: string, f: () => Promise<{ status: number; body: any } | any>) => {
      const before = await stops(), r = await f();
      await sleep(300);
      const crashed = (await stops()) - before; // a planned restart (size/fps change) raises no "engine stopped" notice; a crash does
      if (crashed > 0) { crashes += crashed; where.push(`iter ${i}: OBS crashed during "${name}"`); await until(async () => { const s = await state(); return s?.engine?.connected && s.engine.obs.provisioned; }, 90000, 300); }
      else if (r?.status && r.status !== 200) { failures++; where.push(`iter ${i}: "${name}" -> ${r.status} ${r.body?.error ?? ""}`); }
      return r;
    };
    await step("720p30", () => api("PUT", "/engine/video", { resolution: "720p", fps: 30, videoKbps: 4500 }));
    await step("1080p30", () => api("PUT", "/engine/video", { resolution: "1080p", fps: 30, videoKbps: 6000 }));
    await step("replay 30", () => api("PUT", "/engine/video", { replaySeconds: 30 }));
    await step("record", async () => {
      const want = (await api("GET", "/engine/video")).body.applied;
      const s = await api("POST", "/broadcast/start"); await sleep(2500); await api("POST", "/broadcast/stop");
      const f = (await state())?.recording?.file as string | undefined;
      const pr = f && existsSync(f) ? spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=height", "-of", "csv=p=0", f], { encoding: "utf8" }).stdout.trim() : "";
      if (s.status === 200 && want && String(want.outputHeight) !== pr) { failures++; where.push(`iter ${i}: recording is ${pr || "unreadable"}p but OBS reports ${want.outputHeight}p`); }
      return s;
    });
    await step("audio add", () => api("POST", "/engine/audio", { role: "mic", label: "Loop mic" }));
    const mic = (await state())?.engine?.mixer?.find((m: any) => m.label === "Loop mic");
    if (mic) await step("audio remove", () => api("DELETE", `/engine/audio/${encodeURIComponent(mic.id)}`));
    await api("PUT", "/engine/video", { replaySeconds: 60 });
    const v = (await api("GET", "/engine/video")).body;
    console.log(`iter ${i}/${N}: crashes so far ${crashes}, failures ${failures}, applied ${v.applied?.resolution ?? "?"}/${v.applied?.replaySeconds ?? "?"}s`);
  }
  // Crash injection: kill OBS while a change is being applied. The call must not claim success unless the settings are really
  // applied, and after the supervisor's restart the persisted settings must be what OBS runs.
  for (let k = 1; k <= 5; k++) {
    const res = k % 2 ? "720p" : "1080p", delay = [0, 150, 400, 900, 1500][k - 1];
    const call = api("PUT", "/engine/video", { resolution: res, videoKbps: 5000 + k * 100 });
    await sleep(delay);
    const victim = obsPids()[0]; if (victim) spawnSync("kill", ["-KILL", String(victim)]);
    const r = await call;
    const back = await until(async () => { const s = await state(); const p = obsPids()[0]; return p && p !== victim && s?.engine?.connected && s.engine.obs.provisioned && s.engine.obs.managed?.state === "running"; }, 90000, 300);
    const v = ((await until(async () => { const x = (await api("GET", "/engine/video")).body; return x?.applied && x; }, 20000, 500)) ?? {}) as any;
    const good = !!back && v.applied?.resolution === res && v.applied?.videoKbps === 5000 + k * 100 && v.differences?.length === 0;
    if (!good) { failures++; where.push(`crash injection ${k}: after restart OBS runs ${v.applied?.resolution}/${v.applied?.videoKbps}, saved ${res}/${5000 + k * 100} (call said ${r.status})`); }
    console.log(`crash injection ${k} (kill after ${delay} ms): call -> ${r.status}${r.status === 200 ? "" : " " + (r.body?.error ?? "").slice(0, 70)}; after restart ${v.applied?.resolution}/${v.applied?.videoKbps} ${good ? "OK" : "WRONG"}`);
  }
} catch (e: any) { failures++; console.log(`FAIL unexpected: ${e?.stack ?? e}`); }
finally {
  const log = h.serverLog();
  if (crashes || failures) { try { const p = join(homedir(), ".cache", "apply-loop-server.log"); require("node:fs").writeFileSync(p, log); console.log(`server log kept at ${p}`); } catch {} }
  await h.cleanup();
  console.log(`\n${N} iterations in ${Math.round((Date.now() - t0) / 1000)} s: ${crashes} OBS crashes, ${failures} failed steps`);
  for (const w of where) console.log("  " + w);
  process.exit(crashes || failures ? 1 : 0);
}
