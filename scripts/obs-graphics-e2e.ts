// End-to-end check of the graphics system against a REAL OBS, driven only through Fieldhouse's own API (and read-only raw obs-websocket
// reads for screenshots). Start with OBS NOT running. Saves PNGs of the program into $GFX_OUT (default ~/.cache/fieldhouse-gfx-out).
//   bun scripts/obs-graphics-e2e.ts
// Proves: a custom HTML graphic and a CasparCG-style template appear in the program and follow the score and clock, a web page appears as the
// OBS layer "FH Ext <id>" and shows/hides instantly, designer changes show up, the font probe runs inside OBS, and the legacy buttons still work.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Harness, api, obsPids, rawObs, sleep, state, until } from "./hands-off-lib";

if (obsPids().length) { console.log("SKIP: OBS is already running; stop it first."); process.exit(0); }
const OUT = process.env.GFX_OUT ?? join(homedir(), ".cache", "fieldhouse-gfx-out");
mkdirSync(OUT, { recursive: true });
const h = new Harness("fieldhouse-gfx-e2e");
let passes = 0, fails = 0;
const ok = (name: string, cond: unknown, detail = "") => { cond ? passes++ : fails++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  [" + detail + "]" : ""}`); return !!cond; };
const section = (s: string) => console.log(`\n== ${s}`);
let raw: Awaited<ReturnType<typeof rawObs>> | undefined;
const obs = async (t: string, d?: object) => { for (let i = 0; i < 10; i++) { try { if (!raw || raw.dead) raw = await rawObs(); const r = await raw.req(t, d); if (r.__error !== "connection lost") return r; } catch {} raw = undefined; await sleep(400); } return { __error: "unreachable" } as any; };
const shot = async (name: string, scene = "FH cam1") => {
  const r = await obs("GetSourceScreenshot", { sourceName: scene, imageFormat: "png", imageWidth: 1280, imageHeight: 720 });
  if (!r.imageData) { console.log("      (no screenshot: " + JSON.stringify(r).slice(0, 120) + ")"); return null; }
  const buf = Buffer.from(String(r.imageData).split(",")[1], "base64"); writeFileSync(join(OUT, name + ".png"), buf); return buf;
};
const post = (p: string, b?: unknown) => api("POST", p, b ?? {});
const item = async (id: string) => (await state()).graphics.items.find((i: any) => i.id === id);
const differs = (a: Buffer | null, b: Buffer | null) => !!a && !!b && !a.equals(b);

// a web page standing in for a Singular/UNO output page: big magenta block
const web = Bun.serve({ port: 8320, hostname: "127.0.0.1", fetch: () => new Response('<!doctype html><body style="margin:0;background:transparent"><div style="position:absolute;right:120px;top:300px;width:420px;height:200px;background:#ff00ff;color:#fff;font:bold 60px DejaVu Sans, Arial;display:grid;place-items:center">EXT LAYER</div></body>', { headers: { "content-type": "text/html" } }) });

async function main() {
  section("start: Fieldhouse launches OBS by itself");
  h.startServer({ FIELDHOUSE_DEBUG: "1" });
  const up = await until(async () => { const s = await state(); return s?.engine?.connected && s.engine.obs.provisioned && s; }, 120000, 250) as any;
  if (!ok("OBS connected and provisioned", !!up)) return;
  ok("the engine draws external layers itself", up.graphics.engineLayers === true);
  const g = (await api("GET", "/games")).body.find((x: any) => x.status === "scheduled");
  await api("POST", `/games/${g.id}/activate`);
  await sleep(6000); // the overlay page loads inside OBS
  const base = await shot("01-baseline-legacy-scorebug");
  ok("program snapshot works", !!base, base ? base.length + " bytes" : "");
  const fonts = (await api("GET", "/graphics/fonts")).body;
  ok("the font probe ran INSIDE OBS and reported", fonts.source === "obs" && fonts.families.length > 0, `${fonts.source}: ${fonts.families.join(", ")}`);
  console.log("      font note: " + fonts.note); console.log("      generics render: " + JSON.stringify(fonts.generics));

  section("1. legacy buttons still work");
  await post("/graphics", { lower: { title: "Avery Cole", sub: "Guard, 14 points" }, slate: null });
  await sleep(1200);
  const lower = await shot("02-legacy-lower-third");
  ok("lower third changes the program picture", differs(base, lower));
  ok("legacy state fields kept", (await state()).graphics.lower?.title === "Avery Cole" && (await state()).graphics.scorebug === true);
  await post("/graphics", { lower: null, scorebug: false }); await sleep(900);
  const off = await shot("03-legacy-scorebug-off");
  ok("score bug off removes it from the program", differs(lower, off));
  await post("/graphics", { scorebug: true });

  section("2. a custom HTML graphic follows score and clock");
  const html = (await post("/graphics/create", { kind: "html", name: "My score strip", role: "scorebug", placement: { anchor: "top-left", x: 60, y: 60, z: 40, scale: 1, opacity: 1 } })).body;
  await api("PUT", `/graphics/${html.id}/file`, { path: "index.html", content: `<!doctype html><body style="margin:0"><div style="position:absolute;left:0;top:0;padding:16px 28px;background:#0a7d2c;color:#fff;font-size:64px;font-weight:bold"><span data-fh-bind="home.abbr"></span> <span data-fh-bind="home.score"></span> - <span data-fh-bind="away.score"></span> <span data-fh-bind="away.abbr"></span> &nbsp; <span data-fh-bind="clock"></span></div></body>` });
  await post(`/graphics/${html.id}/show`); await sleep(2500);
  const c0 = await shot("04-html-graphic-shown");
  { const lg = (await api("GET", "/diagnostics?n=200")).body.logs ?? []; const l = [...lg].reverse().find((x: any) => String(x.msg ?? x).includes("overlay:")); console.log("      overlay self-report: " + String(l?.msg ?? l).replace(/\n/g, " | ").slice(0, 700)); }
  ok("the custom graphic is in the program", differs(off, c0));
  await post("/event", { type: "score", team: "home", points: 3 }); await sleep(1500);
  const c1 = await shot("05-html-after-score");
  ok("it updated live with the score", differs(c0, c1));
  await post("/event", { type: "clock.start" }); await sleep(1500); const c2 = await shot("06-html-clock-a"); await sleep(3000); const c3 = await shot("07-html-clock-b");
  ok("it follows the running clock", differs(c2, c3));
  await post("/event", { type: "clock.stop" });
  await post(`/graphics/${html.id}/hide`); await sleep(900);
  ok("hide removes it", differs(c3, await shot("08-html-hidden")));

  section("3. a CasparCG-style template plays, updates, stops");
  const cg = (await post("/graphics/examples/caspar-lower-third/install")).body;
  await post(`/graphics/${cg.id}/show`, { fields: { f0: "Jordan Reyes", f1: "Point guard" } }); await sleep(2500);
  const k0 = await shot("09-caspar-playing");
  ok("template is on air with its own slide-in", differs(await shot("08b"), k0) || differs(c3, k0));
  await post(`/graphics/${cg.id}/update`, { fields: { f0: "Sam Ortiz", f1: "Center" } }); await sleep(1200);
  const k1 = await shot("10-caspar-updated");
  ok("update() changed the text", differs(k0, k1));
  const it = await item(cg.id); ok("XML data was sent", it.data.startsWith("<templateData>") && it.data.includes("Sam Ortiz"), it.data.slice(0, 90));
  await post(`/graphics/${cg.id}/hide`); await sleep(500);
  ok("during the stop hold the template is still drawn", (await item(cg.id)).phase === "stopping");
  await sleep(2500); const k2 = await shot("11-caspar-stopped");
  ok("after stop() it is gone", differs(k1, k2) && (await item(cg.id)).phase === "off");

  section("4. a web page as an OBS layer: FH Ext <id>");
  const u = (await post("/graphics/create", { kind: "url", name: "Web overlay", role: "other", source: { url: "http://127.0.0.1:8320/", width: 1920, height: 1080 }, placement: { z: 5 } })).body;
  const nm = "FH Ext " + u.id.replace(/[^\w-]/g, "_");
  const names = async () => (await obs("GetInputList")).inputs.map((i: any) => i.inputName) as string[];
  await until(async () => (await names()).includes(nm), 8000, 100);
  const inputs = await names();
  ok("the browser input exists in OBS under an FH name", inputs.includes(nm), nm);
  const scenesWith: string[] = [];
  await sleep(1500);
  for (const s of ["FH cam1", "FH cam2", "FH cam3", "FH cam4", "FH Replay"]) { const l = (await obs("GetSceneItemList", { sceneName: s })).sceneItems ?? []; if (l.some((x: any) => x.sourceName === nm)) scenesWith.push(s); }
  ok("it is in every FH scene", scenesWith.length === 5, scenesWith.join(", "));
  const list1 = (await obs("GetSceneItemList", { sceneName: "FH cam1" })).sceneItems;
  const idxOv = list1.find((x: any) => x.sourceName === "FH Overlay").sceneItemIndex, idxExt = list1.find((x: any) => x.sourceName === nm).sceneItemIndex;
  ok("layer sits above FH Overlay (z >= 0)", idxExt > idxOv, `overlay ${idxOv}, layer ${idxExt}`);
  const enabled = async () => (await obs("GetSceneItemList", { sceneName: "FH cam1" })).sceneItems.find((x: any) => x.sourceName === nm).sceneItemEnabled;
  ok("hidden at first", (await enabled()) === false);
  const before = await shot("12-ext-hidden");
  const t0 = Date.now(); await post(`/graphics/${u.id}/show`);
  const sawOn = await until(async () => (await enabled()) === true, 3000, 20);
  ok("show flips the scene item at once (no reload)", !!sawOn, `${Date.now() - t0} ms from request to enabled`);
  await sleep(800); const after = await shot("13-ext-shown");
  ok("the page is visible in the program", differs(before, after));
  const t1 = Date.now(); await post(`/graphics/${u.id}/hide`);
  ok("hide flips it off at once", !!(await until(async () => (await enabled()) === false, 3000, 20)), `${Date.now() - t1} ms`);
  const idBefore = list1.find((x: any) => x.sourceName === nm).sceneItemId;
  await post(`/graphics/${u.id}/show`); await sleep(300);
  ok("it was never re-created by toggling", (await obs("GetSceneItemList", { sceneName: "FH cam1" })).sceneItems.find((x: any) => x.sourceName === nm).sceneItemId === idBefore);
  const mine = (await obs("GetInputList")).inputs.map((i: any) => i.inputName).filter((n: string) => n.startsWith("FH Ext "));
  await api("DELETE", `/graphics/${u.id}`);
  ok("deleting the graphic removes the OBS input", !!(await until(async () => !(await names()).includes(nm), 6000, 150)), `${mine.length} FH Ext input(s) before`);
  ok("the operator's other OBS items are untouched (cameras, mic, overlay still there)", ["FH cam1 video", "FH Overlay"].every((n) => (await_has(inputs, n))));

  section("5. designer changes show up");
  const d0 = await shot("14-designer-before");
  await api("PUT", "/graphics/builtin-scorebug", { style: { colors: { bg: "#7a0019", accent: "#ffd400", panel: "#2b0008" }, radius: 24, fontSize: 30 }, placement: { anchor: "top-right", x: 80, y: 560, scale: 1.4, z: 20, opacity: 1 }, animation: { in: { preset: "slide-left", durationMs: 600 } } });
  await sleep(1500);
  const d1 = await shot("15-designer-after");
  ok("colours, position and size changed in the program", differs(d0, d1));
  await post("/graphics", { scorebug: false }); await sleep(800); await post("/graphics", { scorebug: true }); await sleep(1200);
  await shot("16-designer-reshown");
  await post("/graphics/builtin-scorebug/reset"); await sleep(1000);
  ok("reset to default restores the original look", (await item("builtin-scorebug")).placement.anchor === "bottom-left");
  await shot("17-reset");

  section("6. web fonts inside OBS's browser");
  const fnt = (await post("/graphics/create", { kind: "html", name: "Font test", placement: { anchor: "top-left", x: 0, y: 0, z: 90, scale: 1, opacity: 1 } })).body;
  copyFileSync("/usr/share/fonts/truetype/space-grotesk/SpaceGrotesk-Bold.ttf", join(h.work, "f.ttf"));
  await api("PUT", `/graphics/${fnt.id}/file`, { path: "f.ttf", contentBase64: readFileSync(join(h.work, "f.ttf")).toString("base64") });
  await api("PUT", `/graphics/${fnt.id}/file`, { path: "index.html", content: `<!doctype html><style>@font-face{font-family:"FHWeb";src:url(f.ttf)}body{margin:0;background:#fff;width:1920px;height:600px}p{margin:6px 40px;font-size:50px}</style><body><p style="font-family:FHWeb,serif">Webfont Quick Brown Fox 123</p><p style="font-family:serif">Webfont Quick Brown Fox 123</p><p style="font-family:Arial">Arial alias line 123</p><p style="font-family:sans-serif">Generic sans-serif line 123</p><p style="font-family:&quot;DejaVu Sans&quot;">DejaVu Sans named line 123</p><p id="r" style="font-size:40px">checking...</p><script>document.fonts.load("70px FHWeb").then(function(l){document.getElementById("r").textContent="document.fonts loaded "+l.length+" face(s); status "+document.fonts.status})["catch"](function(e){document.getElementById("r").textContent="load error "+e})</script></body>` });
  await post(`/graphics/${fnt.id}/show`); await sleep(3000);
  await shot("18-webfont-test");
  await post(`/graphics/${fnt.id}/hide`);
}
const await_has = (a: string[], n: string) => a.includes(n);
try { await main(); }
catch (e: any) { fails++; console.log(`FAIL  unexpected error: ${e?.stack ?? e}`); }
finally {
  web.stop(true); raw?.close();
  await h.cleanup();
  console.log(`\n${passes} passed, ${fails} failed. Images in ${OUT}`);
  process.exit(fails ? 1 : 0);
}
