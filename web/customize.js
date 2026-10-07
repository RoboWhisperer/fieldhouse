// Console look and layout: applies settings.ui (docs/dev/customization.md) and draws the macro buttons. Contract in web/README.md.
// Plain module on purpose: app.js loads it lazily, console.js imports it, and nothing here runs at import time.
import { api, S, esc, keys, toast, fail } from "./app.js";

// ---------------------------------------------------------------- look: applyUi(state)
const BASE_CSS = `
html,body{font-size:calc(13px * var(--ui-text-scale,1))}
html[data-motion=reduce] *,html[data-motion=reduce] *::before,html[data-motion=reduce] *::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}
.tbl td{height:calc(var(--ui-row,36px) + 8px)}
html[data-theme=light] .btn:hover,html[data-theme=high-contrast] .btn:hover{background:var(--line)}
html[data-theme=light] .btn.danger,html[data-theme=light] .pill.err,html[data-theme=light] .hint.err,html[data-theme=light] .banner.err>.i:first-child{color:#B3261E}
html[data-theme=light] .banner.warn{border-color:#E0A56B}html[data-theme=light] .banner.err{border-color:#E59A94}html[data-theme=light] .banner.ok{border-color:#8FD0B3}html[data-theme=light] .banner.info{border-color:#9DBBEA}
html[data-theme=light] .chip.ok{border-color:#8FD0B3}html[data-theme=light] .chip.warn{border-color:#E0A56B}
html[data-theme=light] .btn.pri,html[data-theme=high-contrast] .btn.pri{color:var(--action-ink)}
html[data-theme=high-contrast] .btn,html[data-theme=high-contrast] .input,html[data-theme=high-contrast] .select,html[data-theme=high-contrast] .panel{border-color:var(--text-2)}
html[data-theme=high-contrast] .btn.danger,html[data-theme=high-contrast] .pill.err,html[data-theme=high-contrast] .hint.err{color:var(--program)}
html[data-theme=high-contrast] :focus-visible{outline-width:3px}`;
let applied = [], lastSig = "", lastTokens = null, seq = 0, mqBound = false;
const el = (id) => { let s = document.getElementById(id); if (!s) { s = document.createElement("style"); s.id = id; document.head.append(s); } return s; };
const localConsole = () => !/^\/(remote|overlay|gfx)(\/|$)/.test(location.pathname);

/** Which of the three palettes is showing (auto follows the system). */
export const resolveTheme = (theme) => (theme === "auto" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : theme || "dark");

function paint(t) {
  const root = document.documentElement, name = resolveTheme(t.theme);
  for (const k of applied) root.style.removeProperty(k);
  applied = [];
  for (const [k, v] of Object.entries({ ...(t.themes?.[name] ?? {}), ...(t.common ?? {}) })) { root.style.setProperty(k, v); applied.push(k); }
  for (const [k, v] of Object.entries(t.attrs ?? {})) root.setAttribute(k, v);
  root.setAttribute("data-theme", name); root.style.colorScheme = name === "light" ? "light" : "dark";
  el("ui-base").textContent = BASE_CSS;
  const css = el("user-css"); css.textContent = localConsole() ? t.customCss || "" : ""; // custom CSS: local console only, last in <head>
  document.head.append(css);
  if (!mqBound) { mqBound = true; matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => lastTokens?.theme === "auto" && paint(lastTokens)); }
}

/** Apply settings.ui from a state push. Cheap when nothing about the look changed. */
export function applyUi(state) {
  const ui = state?.settings?.ui; if (!ui) return;
  const sig = JSON.stringify([ui.theme, ui.accent, ui.density, ui.textScale, ui.reducedMotion, ui.customCss]);
  const bars = JSON.stringify(ui.macroButtons);
  if (bars !== barsSig) { barsSig = bars; repaintBars(); }
  if (sig === lastSig) return;
  lastSig = sig; const mine = ++seq;
  api.get("/ui").then((t) => { if (mine === seq) { lastTokens = t; paint(t); } }).catch((e) => { lastSig = ""; console.error(e); });
}
/** For the Appearance screen: use the answer of PUT /api/ui straight away instead of waiting for the next push. */
export function applyTokens(t) { lastTokens = t; seq++; lastSig = JSON.stringify([t.ui.theme, t.ui.accent, t.ui.density, t.ui.textScale, t.ui.reducedMotion, t.ui.customCss]); paint(t); }

// ---------------------------------------------------------------- layout: consolePanels(state, column)
const DEFAULT_COLS = { left: ["game", "events"], center: ["graphics", "macros", "replay"], right: ["audio", "sponsor", "custom"] };
export const PANEL_NAMES = { graphics: "Graphics", audio: "Audio", events: "Event log", sponsor: "Sponsors", game: "Game controls", replay: "Replay", custom: "Custom fields", macros: "Macro buttons" };
export const activePreset = (state) => { const l = state?.settings?.ui?.layouts; return l?.presets?.find((p) => p.id === l.active) ?? l?.presets?.[0] ?? null; };
/** Ordered panel ids for "left" | "center" | "right" in the active layout preset. */
export const consolePanels = (state, column) => (activePreset(state)?.columns?.[column] ?? DEFAULT_COLS[column] ?? []).slice();

// ---------------------------------------------------------------- macro buttons
// The server has no macro list in state, so this module keeps a small cache (GET /api/macros) and repaints every bar when it changes.
const EXTRA_ICONS = { bell: '<path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4zM10 21h4"/>', tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>' };
export const macroIcon = (n) => (EXTRA_ICONS[n] ? `<svg class="i lg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${EXTRA_ICONS[n]}</svg>` : `<svg class="i lg" aria-hidden="true"><use href="#i-${esc(n)}"/></svg>`);
const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
export const inkOn = (bg) => ((lum(bg) + 0.05) / 0.05 >= 1.05 / (lum(bg) + 0.05) ? "#000000" : "#FFFFFF");
const CSS = `.macrobar{display:flex;flex-wrap:wrap;gap:8px}
.macrobar .mbtn{display:inline-flex;align-items:center;gap:10px;min-height:48px;padding:0 16px;border-radius:8px;border:2px solid transparent;background:var(--mc);color:var(--mi);font-weight:700;font-size:14px;cursor:pointer;text-align:left}
.macrobar .mbtn.large{min-height:72px;flex:1 1 180px;font-size:16px;padding:0 20px}
.macrobar .mbtn:hover{filter:brightness(1.1)}.macrobar .mbtn:active{transform:translateY(1px)}
.macrobar .mbtn[aria-busy=true]{opacity:.7}
.macrobar .mbtn kbd{margin-left:auto;padding:1px 6px;border-radius:4px;border:1px solid currentColor;font:600 11px var(--mono);opacity:.85}
.macrobar .mbtn:focus-visible{outline:3px solid var(--text)!important;outline-offset:2px!important}
.macrobar .none{color:var(--text-2);padding:8px 2px}.macrobar .none a{color:var(--action-hi)}`;
let macros = null, macrosAt = 0, loading = null, barsSig = null;
export function refreshMacros() {
  if (loading) return loading;
  loading = api.get("/macros").then((m) => { macros = m; macrosAt = Date.now(); repaintBars(); }).catch((e) => console.error(e)).finally(() => { loading = null; });
  return loading;
}
function bar(state) {
  if (!document.getElementById("macro-css")) { const s = document.createElement("style"); s.id = "macro-css"; s.textContent = CSS; document.head.append(s); }
  if (!macros || Date.now() - macrosAt > 15000) refreshMacros();
  const picks = state?.settings?.ui?.macroButtons ?? [], by = new Map((macros ?? []).map((m) => [m.id, m]));
  const btns = picks.map((p) => { const m = by.get(p.macroId); if (!m) return ""; const c = p.color || m.color || "#3D8BFD"; return `<button type="button" class="mbtn ${p.size === "large" ? "large" : ""}" style="--mc:${esc(c)};--mi:${inkOn(c)}" data-macro="${esc(m.id)}" aria-label="${esc(m.label)}${m.hotkey ? ", key " + esc(m.hotkey) : ""}" title="${esc(m.description || m.label)}">${macroIcon(m.icon || "bolt")}<span>${esc(m.label)}</span>${m.hotkey ? `<kbd>${esc(m.hotkey)}</kbd>` : ""}</button>`; }).join("");
  return btns || `<div class="none">${macros ? "No macro buttons yet. Make a macro in <a href=\"#/automation/macros\">Automation</a>, then add it under <a href=\"#/settings/appearance\">Settings, Appearance and layout</a>." : "Loading macro buttons..."}</div>`;
}
/** Html for the macro-button panel: `<div class="macrobar" data-macrobar>` with one big button per entry of settings.ui.macroButtons. */
export const macroBar = (state) => `<div class="macrobar" data-macrobar role="group" aria-label="Macro buttons">${bar(state)}</div>`;
function repaintBars() { document.querySelectorAll("[data-macrobar]").forEach((b) => { b.innerHTML = bar(S.state); }); }

export async function runMacro(id, label) {
  try {
    const r = await api.post(`/macros/${encodeURIComponent(id)}/run`, {});
    const name = label || r.name || "Macro";
    if (r.status === "ok") toast(`${name}: done.`);
    else if (r.status === "error") toast(`${name} stopped: ${r.reason || r.steps?.find((s) => !s.ok)?.error || "a step failed"}. See Automation, Run log.`);
    else toast(`${name}: ${r.status === "running" || r.status === "queued" ? "started, still running." : r.reason || r.status}.`);
    return r;
  } catch (e) { fail(e); }
}
/** Wire clicks and every macro's hotkey (works for macros that have no button too). Returns a cleanup function. */
export function bindMacroBar(root, state) {
  const click = (e) => { const b = e.target.closest?.("[data-macro]"); if (!b || !root.contains(b)) return; b.setAttribute("aria-busy", "true"); runMacro(b.dataset.macro, b.querySelector("span")?.textContent).finally(() => b.removeAttribute("aria-busy")); };
  root.addEventListener("click", click);
  const map = new Proxy({}, { get: (_, k) => { const m = typeof k === "string" && (macros ?? []).find((x) => x.hotkey === k); return m ? () => runMacro(m.id, m.label) : undefined; } });
  const off = keys(map);
  if (!macros) refreshMacros();
  return () => { root.removeEventListener("click", click); off(); };
}
