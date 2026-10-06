// Drives the real web UI (Settings > Video and audio, Video engine, Sources) in headless Chromium over the DevTools protocol,
// then checks the result through /api and (optionally) against the engine. Screenshots go to design/_shots/.
//
//   bun scripts/ui-video-e2e.ts [baseUrl=http://127.0.0.1:8301] [shotPrefix=video]
//
// Needs `chromium` on PATH (started here with --headless=new --no-sandbox --remote-debugging-port=9444) and a running Fieldhouse server.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://127.0.0.1:8301", PREFIX = process.argv[3] ?? "video", CDP = 9444;
const shots = join(import.meta.dir, "..", "design", "_shots"); mkdirSync(shots, { recursive: true });
const profile = join(homedir(), "snap", "chromium", "common", "fieldhouse-test-profile") /* snap Chromium may only write here */; rmSync(profile, { recursive: true, force: true }); mkdirSync(profile, { recursive: true });
let passes = 0, fails = 0;
const ok = (n: string, c: unknown, d = "") => { c ? passes++ : fails++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  [" + d + "]" : ""}`); return !!c; };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const api = async (p: string) => (await fetch(`${BASE}/api${p}`)).json() as Promise<any>;

const chrome = spawn("chromium", ["--headless=new", "--no-sandbox", `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, "--window-size=1440,1000", "about:blank"], { stdio: "ignore" });
let ws: WebSocket, id = 0; const pending = new Map<number, (r: any) => void>();
async function connect() {
  for (let i = 0; i < 60; i++) { try { const t = (await (await fetch(`http://127.0.0.1:${CDP}/json`)).json()).find((x: any) => x.type === "page"); if (t) { ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise<void>((r, j) => { ws.onopen = () => r(); ws.onerror = () => j(new Error("cdp")); }); ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); if (m.id) pending.get(m.id)?.(m); }; return; } } catch {} await sleep(250); }
  throw new Error("could not reach Chromium's debugging port");
}
const send = (method: string, params: object = {}) => new Promise<any>((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr: string) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "js error"); return r.result?.result?.value; };
const waitFor = async (expr: string, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await js(expr)) return true; } catch {} await sleep(150); } return false; };
const shot = async (name: string) => { const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }); writeFileSync(join(shots, `${PREFIX}-${name}.png`), Buffer.from(r.result.data, "base64")); };
const go = async (hash: string) => { await js(`location.hash = ${JSON.stringify(hash)}`); await sleep(600); };
const click = (sel: string) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
const setVal = (sel: string, v: string) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
const clickText = (sel: string, text: string) => js(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!e) return false; e.click(); return true; })()`);

try {
  await connect();
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${BASE}/#/settings/video` });
  ok("Video and audio page renders", await waitFor(`/quality/i.test(document.body.innerText) && /audio inputs/i.test(document.body.innerText)`, 20000));
  await sleep(800); await shot("1-settings-initial");
  const before = await api("/engine/video");

  await clickText(".seg button", "1080p"); await sleep(2500);
  let v = await api("/engine/video");
  ok("choosing 1080p saves and applies it", v.settings.resolution === "1080p" && v.applied?.outputHeight === 1080, JSON.stringify(v.applied));
  await clickText(".seg button", "60 fps"); await sleep(2500);
  v = await api("/engine/video"); ok("60 fps applied", v.settings.fps === 60 && v.applied?.fps === 60);
  await clickText(".seg button", "30 fps"); await sleep(2500);
  await click('[data-act="custom"]'); await sleep(300);
  await setVal("#kbps", "6500"); await click('[data-act="applykbps"]'); await sleep(2500);
  v = await api("/engine/video"); ok("custom bitrate 6500 applied and read back", v.settings.videoKbps === 6500 && v.applied?.videoKbps === 6500);
  await click('[data-act="custom"]'); await setVal("#kbps", "50"); await click('[data-act="applykbps"]'); await sleep(500);
  ok("an invalid bitrate is refused with a plain message", await waitFor(`document.body.innerText.includes("between 1000 and 20000")`, 3000));
  await setVal('[data-in="audioKbps"]', "192"); await sleep(2500);
  ok("audio bitrate 192", (await api("/engine/video")).applied?.audioKbps === 192);
  await clickText(".seg button", "2 min"); await sleep(2500);
  ok("replay length 2 min", (await api("/engine/video")).applied?.replaySeconds === 120);
  await clickText(".seg button", "MKV"); await sleep(2500);
  ok("recording format MKV", (await api("/engine/video")).applied?.recordFormat === "mkv");

  await click('[data-act="add"][data-role="mic"]'); await sleep(300);
  await setVal("#add-label", "Commentary mic"); await click('[data-act="doadd"]');
  ok("a microphone is added from the page", await waitFor(`[...document.querySelectorAll("[data-name]")].some((i) => i.value === "Commentary mic")`, 8000));
  await sleep(1000);
  const names = (await api("/state")).engine.mixer.map((m: any) => m.label);
  ok("it shows up in the live mixer", names.includes("Commentary mic"), names.join(", "));
  await shot("2-settings-after");
  await js(`window.confirm = () => true`); // a real confirm() dialog would block headless Chromium
  await click('[data-act="remove"]'); await sleep(2500);
  ok("and can be removed", !(await api("/state")).engine.mixer.some((m: any) => m.label === "Commentary mic"));

  await go("#/settings/engine"); await sleep(1500); await shot("3-video-engine");
  ok("Video engine page says OBS runs in the background", await js(`document.body.innerText.includes("you never need to open it")`));
  ok("no instruction to open or configure OBS anywhere on it", !(await js(`/open OBS|configure OBS|Launch OBS/i.test(document.body.innerText)`)));
  await go("#/sources"); await sleep(2000);
  if (await click('[data-gear="1"]')) { await sleep(1500); await shot("4-source-options"); ok("slot options open", await js(`document.body.innerText.includes("Reconnect now") || document.body.innerText.includes("Play from the start") || document.body.innerText.includes("Picture size") || document.body.innerText.includes("did not list")`)); }
  else console.log("NOTE  no slot 1 on the Sources screen; skipped the slot-options check");

  await go("#/settings/video"); await sleep(1200);
  await js(`fetch("/api/engine/video", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(${JSON.stringify({ resolution: before.settings.resolution, fps: before.settings.fps, videoKbps: before.settings.videoKbps, audioKbps: before.settings.audioKbps, recordFormat: before.settings.recordFormat, replaySeconds: before.settings.replaySeconds })}) })`);
  await sleep(2500);
  const errs = await js(`window.__errs || 0`);
  ok("settings restored", (await api("/engine/video")).settings.videoKbps === before.settings.videoKbps, `console errors: ${errs}`);
} catch (e: any) { fails++; console.log(`FAIL  unexpected: ${e?.stack ?? e}`); }
finally { try { await send("Browser.close"); } catch {} try { ws?.close(); } catch {} try { chrome.kill("SIGKILL"); } catch { /* snap Chromium cannot be signalled; Browser.close above ended it */ } await sleep(300); rmSync(profile, { recursive: true, force: true }); console.log(`\n${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0); }
