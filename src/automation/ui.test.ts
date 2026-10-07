import { expect, test } from "bun:test";
import { getSettings, saveSettings } from "../data";
import { openStore } from "../store";
import { createApp } from "../app";
import { FakeEngine } from "../engine";
import { CONTRAST_PAIRS, PALETTES, buildTokens, contrast, ensureContrast, inkOn, themeVars } from "./ui-theme";
import { DEFAULT_UI, PANELS, checkCss, validateUi } from "./ui-settings";

const save = (patch: any) => { const s = openStore(":memory:"); return saveSettings(s, { ui: patch }).ui; };

test("settings.ui defaults come with every install, old databases get them too", () => {
  const s = openStore(":memory:");
  expect(getSettings(s).ui).toEqual(DEFAULT_UI());
  s.put("settings", { id: "main", theme: "hardwood" }); // an old document without ui
  expect(getSettings(s).ui.layouts.presets[0].id).toBe("default");
});

test("settings.ui validation: every field has a range and a plain message", () => {
  const bad = (p: any, msg: string) => expect(() => save(p), JSON.stringify(p).slice(0, 60)).toThrow(msg);
  bad({ theme: "neon" }, "Theme must be one of");
  bad({ accent: "red" }, "accent color");
  bad({ accent: "#12345" }, "accent color");
  bad({ density: "tiny" }, "Density");
  bad({ textScale: 0.5 }, "0.9 to 1.3");
  bad({ textScale: 1.31 }, "0.9 to 1.3");
  bad({ textScale: "big" }, "0.9 to 1.3");
  bad({ reducedMotion: "maybe" }, "Reduced motion");
  bad({ colour: 1 }, "Unknown display setting");
  bad({ macroButtons: "x" }, "Macro buttons");
  bad({ macroButtons: [{ macroId: "a" }, { macroId: "a" }] }, "only appear once");
  bad({ macroButtons: [{ macroId: "a", color: "blue" }] }, "color");
  bad({ macroButtons: Array.from({ length: 25 }, (_, i) => ({ macroId: "m" + i })) }, "at most 24");
  bad({ layouts: { presets: [] } }, "1 to 12");
  bad({ layouts: { active: "nope" } }, "does not exist");
  bad({ layouts: { presets: [{ id: "Bad Id", name: "x" }] } }, "layout id");
  bad({ layouts: { presets: [{ id: "a", name: "" }] } }, "name is required");
  bad({ layouts: { presets: [{ id: "a", name: "x", columns: { left: ["nonsense"] } }] } }, "not a console panel");
  bad({ layouts: { presets: [{ id: "a", name: "x", columns: { top: [] } }] } }, "Unknown column");
  const ok = save({ theme: "auto", accent: "#3d8bfd", density: "spacious", textScale: 1.3, reducedMotion: "on" });
  expect(ok).toMatchObject({ theme: "auto", accent: "#3D8BFD", density: "spacious", textScale: 1.3, reducedMotion: "on" });
});

test("layouts: each panel ends up in exactly one place, unplaced panels are hidden, duplicates collapse", () => {
  const ui = save({ layouts: { presets: [{ id: "default", name: "Default", columns: { left: ["game", "game", "events"], center: ["events", "graphics"], right: [] }, hidden: ["audio", "game"] }] } });
  const p = ui.layouts.presets[0];
  expect(p.columns).toEqual({ left: ["game", "events"], center: ["graphics"], right: [] });
  expect([...p.columns.left, ...p.columns.center, ...p.columns.right, ...p.hidden].sort()).toEqual([...PANELS].sort());
  expect(p.hidden).toContain("audio");
});

test("layout presets through the API: create, duplicate, edit, activate, reset, delete", async () => {
  const engine = new FakeEngine(), app = createApp({ store: openStore(":memory:"), engine });
  const call = async (method: string, path: string, body?: unknown) => { const r = await app.handle(new Request("http://x/api" + path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: body === undefined ? {} : { "content-type": "application/json" } })); return { status: r.status, body: await r.json() }; };
  const made = (await call("POST", "/ui/layouts", { name: "Night" })).body;
  expect(made.id).toBe("night");
  const dup = (await call("POST", "/ui/layouts", { name: "Night", from: "night" })).body;
  expect(dup.id).toBe("night-2");
  await call("PUT", "/ui/layouts/night", { columns: { left: ["audio"], center: ["graphics", "macros"], right: ["events"] }, hidden: ["replay"] });
  const got = (await call("GET", "/ui")).body.ui.layouts.presets.find((p: any) => p.id === "night");
  expect(got.columns.left).toEqual(["audio"]);
  expect(got.hidden).toEqual(expect.arrayContaining(["replay", "game", "sponsor", "custom"]));
  expect((await call("POST", "/ui/layouts/night/activate")).body.ui.layouts.active).toBe("night");
  expect((await call("POST", "/ui/layouts/night/reset")).body.ui.layouts.presets.find((p: any) => p.id === "night")).toMatchObject({ name: "Night", columns: { left: ["game", "events"] } });
  expect((await call("DELETE", "/ui/layouts/default")).body.error).toContain("cannot be deleted");
  expect((await call("DELETE", "/ui/layouts/night")).body.ui.layouts.active).toBe("default"); // the active one fell back
  expect((await call("DELETE", "/ui/layouts/ghost")).status).toBe(400);
  expect((await call("PUT", "/ui/layouts/ghost", {})).status).toBe(404);
  expect((await call("POST", "/ui/layouts", { name: "" })).status).toBe(400);
  for (let i = 0; i < 10; i++) await call("POST", "/ui/layouts", { name: "x" });
  expect((await call("POST", "/ui/layouts", { name: "one more" })).body.error).toContain("1 to 12");
  expect((await call("PUT", "/settings", { ui: { theme: "light" } })).status).toBe(200); // the generic settings route accepts it too
  expect((await call("GET", "/settings")).body.ui.theme).toBe("light");
});

test("custom CSS: ordinary styles pass; anything that could load, run or escape is refused with a reason", () => {
  const good = ["", ".x{color:#fff;background:var(--panel)}", "@media (max-width:600px){.a{display:none}} /* note */", "@keyframes k{from{opacity:0}to{opacity:1}}",
    ".i{background:url(data:image/png;base64,iVBORw0KGgo=)}", ':root{--ui-gap:12px}'];
  for (const css of good) expect(() => checkCss(css), css).not.toThrow();
  const evil: [string, string][] = [
    ['@import url("https://evil.example/x.css");', "@import"], ["@import 'a.css';", "@import"], ["@IMPORT 'a';", "@import"],
    [".a{background:url(https://evil.example/a.png)}", "url()"], [".a{background:url('//evil.example/a')}", "url()"], [".a{background:URL( http://x )}", "url()"],
    [".a{background:url(data:text/html;base64,PHNjcmlwdD4=)}", "url()"], [".a{background:url(data:image/svg+xml;base64,AAAA)}", "url()"], [".a{background:url(/local.png)}", "url()"],
    [".a{background:image-set('https://x/a.png' 1x)}", "image-set"], [".a{content:src('x')}", "image-set"],
    [".a{width:expression(alert(1))}", "scripting"], [".a{background:javascript:alert(1)}", "scripting"], [".a{behavior:x}", "scripting"], [".a{-moz-binding:x}", "scripting"],
    [".a{content:'https://x.example'}", "web addresses"], [".a{background:u\\72l(x)}", "backslash"], [".a{}</style><script>alert(1)</script>", "angle brackets"],
    ["@charset 'x';", "@charset"], ["@font-face{font-family:x;src:local(y)}", "@font-face"], [".a{color:red", "curly brackets"], ["}.a{color:red}", "curly brackets"],
    ["/* url(https://x) */ .a{background:url(https://x)}", "url()"], [".a{b:u/**/rl(https://x)}", "web addresses"],
  ];
  for (const [css, why] of evil) expect(() => checkCss(css), css).toThrow(why);
  expect(() => checkCss("a".repeat(8001))).toThrow("at most 8000");
  expect(() => checkCss(5 as any)).toThrow("must be text");
  expect(() => save({ customCss: "@import 'x';" })).toThrow("not saved");
});

test("themes: light and high-contrast meet WCAG AA for every pairing the console uses", () => {
  for (const name of ["light", "high-contrast"] as const) for (const [fg, bg, min] of CONTRAST_PAIRS) expect(contrast(PALETTES[name][fg], PALETTES[name][bg]), `${name}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(min);
  // dark = the shipped look; its text pairs are AA
  for (const [fg, bg] of [["text", "ground"], ["text", "panel"], ["text", "raised"], ["text-2", "panel"], ["text-3", "panel"], ["action-hi", "panel"], ["ready", "panel"], ["caution", "panel"], ["led", "panel"]]) expect(contrast(PALETTES.dark[fg], PALETTES.dark[bg]), `dark: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 0);
  expect(contrast("#777777", "#FFFFFF")).toBeCloseTo(4.48, 1);
});

test("any accent stays readable: ink on the accent and the text-colour accent meet AA in every theme", () => {
  for (const accent of ["#FFFF00", "#000000", "#FF0000", "#3D8BFD", "#808080", "#00FF00", "#123456", "#FFFFFF"]) {
    for (const name of ["dark", "light", "high-contrast"] as const) {
      const v = themeVars(name, accent);
      expect(contrast(v["--action-ink"], v["--action"]), `${accent} ink`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v["--action-hi"], v["--panel"]), `${accent} in ${name} as text`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v["--text"], v["--action-wash"]), `${accent} wash`).toBeGreaterThanOrEqual(4.5);
    }
  }
  expect(inkOn("#FFFF00")).toBe("#000000");
  expect(contrast(ensureContrast("#888888", "#FFFFFF"), "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
});

test("tokens: the settings map onto documented CSS variables", () => {
  const ui = validateUi({ theme: "auto", accent: "#E5484D", density: "compact", textScale: 1.2, reducedMotion: "off", customCss: ".a{b:c}" }, DEFAULT_UI());
  const t = buildTokens(ui);
  expect(Object.keys(t.themes)).toEqual(["dark", "light", "high-contrast"]);
  expect(t.themes.dark["--ground"]).toBe("#0B1018");
  expect(t.themes.light["--action"]).toBe("#E5484D");
  expect(t.common).toEqual({ "--ui-gap": "6px", "--ui-pad": "6px", "--ui-row": "28px", "--ui-text-scale": "1.2" });
  expect(t.attrs).toEqual({ "data-density": "compact", "data-motion": "full" });
  expect(t.theme).toBe("auto");
  expect(t.customCss).toBe(".a{b:c}");
  expect(buildTokens(DEFAULT_UI()).themes.dark["--action-fill"]).toBe("#2E6FD8"); // no accent: the shipped colours untouched
});
