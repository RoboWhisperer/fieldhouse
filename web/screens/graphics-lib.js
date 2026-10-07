// Pure helpers for the Graphics Studio (no DOM, no app.js import) so they can be unit-checked with bun.
// The contract lives in src/graphics/types.ts and docs/dev/graphics-api.md.

export const ROLE_LABEL = { scorebug: "Score bug", lowerthird: "Lower third", fullscreen: "Full screen", ticker: "Ticker", corner: "Corner", other: "Other" };
export const ROLE_HELP = { scorebug: "Teams, score and clock", lowerthird: "A name bar near the bottom", fullscreen: "Covers the whole picture", ticker: "A strip of scrolling text", corner: "A small logo or badge", other: "Anything else" };
export const KIND_LABEL = { builtin: "Built-in", html: "Custom page", caspar: "CasparCG template", url: "Web page", remote: "Remote" };
export const KIND_HELP = {
  builtin: "Comes with Fieldhouse. You can change its look and place.",
  html: "A web page (HTML) that Fieldhouse fills with live game data.",
  caspar: "A CasparCG-style template with play, stop and update.",
  url: "Any web overlay with an address. Drawn as its own layer in the video.",
  remote: "Drawn by another system (Singular, CasparCG server, any web service).",
};
export const ANCHORS = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"];
export const ANCHOR_LABEL = { "top-left": "Top left", top: "Top", "top-right": "Top right", left: "Left", center: "Center", right: "Right", "bottom-left": "Bottom left", bottom: "Bottom", "bottom-right": "Bottom right" };
export const PRESETS = [["none", "None (appears at once)"], ["fade", "Fade"], ["slide-left", "Slide from the left"], ["slide-right", "Slide from the right"], ["slide-up", "Slide down from the top"], ["slide-down", "Slide up from the bottom"], ["wipe", "Wipe"], ["scale", "Grow"]];
export const EASINGS = [["ease", "Smooth"], ["linear", "Even"], ["ease-in", "Slow start"], ["ease-out", "Slow finish"], ["ease-in-out", "Slow start and finish"]];
export const SHOW_MODES = [
  ["manual", "Only when I show it", "You press Show and Hide."],
  ["auto-hide", "Show, then hide by itself", "It goes away after the number of seconds you choose."],
  ["always", "Always on", "On whenever it is switched on here. No Show or Hide buttons."],
  ["while-live", "While streaming or recording", "On automatically while a stream or recording runs."],
];
export const PART_LABEL = { colorBars: "Team color bars", clock: "Game clock", period: "Period", fouls: "Fouls", timeouts: "Timeouts", bonus: "Bonus", accentBar: "Accent bar", swatch: "Color square", caption: "Caption", names: "Team names", numbers: "Jersey numbers", positions: "Positions", label: "Label" };
export const COLOR_LABEL = { bg: "Background", panel: "Panel", text: "Text", muted: "Soft text", accent: "Accent", score: "Score box", scoreText: "Score digits", clock: "Clock digits", clockOff: "Clock (unlit segments)" };
/** Which colors each built-in actually uses (others would change nothing). */
export const BUILTIN_COLORS = {
  scorebug: ["bg", "panel", "text", "muted", "score", "scoreText", "clock", "clockOff"], lowerthird: ["bg", "text", "muted", "accent"], slate: ["bg", "text"], sponsor: ["bg", "text", "muted"],
  scoreboard: ["bg", "text", "muted", "score", "scoreText", "clock", "clockOff"], ticker: ["bg", "text"], clock: ["panel", "muted", "clock", "clockOff"], lineup: ["bg", "text", "muted", "accent"], final: ["bg", "text", "muted", "score", "scoreText"],
};
/** Pairs worth checking for readability: [foreground, background, plain-language name]. */
export const CONTRAST_PAIRS = [["text", "bg", "Text on background"], ["muted", "bg", "Soft text on background"], ["scoreText", "score", "Score digits on score box"], ["clock", "panel", "Clock digits on panel"], ["text", "panel", "Text on panel"]];

export const VAR_LABEL = {
  "home.name": "Home team name", "home.abbr": "Home team short name", "home.color": "Home team color", "home.score": "Home score", "home.fouls": "Home fouls", "home.timeouts": "Home timeouts left", "home.bonus": "Home in bonus (yes or no)",
  "away.name": "Away team name", "away.abbr": "Away team short name", "away.color": "Away team color", "away.score": "Away score", "away.fouls": "Away fouls", "away.timeouts": "Away timeouts left", "away.bonus": "Away in bonus (yes or no)",
  period: "Period number", periodLabel: "Period (Q3, OT...)", clock: "Game clock (mm:ss)", clockMs: "Game clock in milliseconds", running: "Clock running (yes or no)",
  "game.title": "Game title", "game.date": "Game date", "game.venue": "Venue", "game.status": "Game status", "game.sport": "Sport",
  "lower.title": "Lower third: title", "lower.sub": "Lower third: subtitle", "sponsor.name": "Sponsor name", "sponsor.color": "Sponsor color", "sponsor.seconds": "Sponsor seconds",
};
export const GROUP_LABEL = { home: "Home team", away: "Away team", game: "Game", lower: "Lower third", sponsor: "Sponsor", custom: "Your custom fields", counters: "Sport counters", other: "Clock and period" };

/** Variable keys worth offering in a picker: drops the long numbered roster lists but keeps their counts, lists and the first player. */
export function varGroups(vars) {
  const groups = {};
  for (const k of Object.keys(vars || {}).sort()) {
    const m = /\.(roster|starters)\.(\d+)\./.exec(k);
    if (m && m[2] !== "1") continue;
    const g = k.includes(".") ? (GROUP_LABEL[k.split(".")[0]] ? k.split(".")[0] : "other") : "other";
    (groups[g] ||= []).push(k);
  }
  return Object.entries(groups).sort((a, b) => Object.keys(GROUP_LABEL).indexOf(a[0]) - Object.keys(GROUP_LABEL).indexOf(b[0])).map(([g, keys]) => [GROUP_LABEL[g], keys]);
}

export const substitute = (tpl, vars) => String(tpl ?? "").replace(/\{\{\s*([\w.\-]+)\s*(?:\|([^}]*))?\}\}/g, (_m, p, fb) => { const v = vars?.[p]; return v === undefined || v === "" ? (fb ?? "") : String(v); });

/** The value each field has right now: typed-in override, else its binding, else its default. Mirrors the server (items[].fields). */
export function resolveFields(doc, vars, over = {}) {
  const out = {};
  for (const f of doc.fields || []) {
    if (over[f.name] !== undefined) { out[f.name] = String(over[f.name]); continue; }
    const b = f.binding || { kind: "manual", value: "" };
    if (b.kind === "var") { const v = vars?.[b.value]; out[f.name] = v === undefined || v === "" ? f.default : String(v); }
    else if (b.kind === "const") out[f.name] = substitute(b.value, vars);
    else out[f.name] = f.default;
  }
  return out;
}

const xmlEsc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
/** The string a CasparCG template's update() receives (same as src/graphics/caspar.ts). */
export function casparData(values, format, defs = []) {
  if (format === "json") return JSON.stringify(Object.fromEntries(Object.entries(values).map(([k, v]) => { const t = defs.find((d) => d.name === k)?.type; return [k, t === "number" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : t === "bool" ? v === "true" || v === "1" : v]; })));
  return "<templateData>" + Object.entries(values).map(([k, v]) => `<componentData id="${xmlEsc(k)}"><data id="text" value="${xmlEsc(v)}"/></componentData>`).join("") + "</templateData>";
}

/** One RenderItem for the overlay page (see RenderItem in src/graphics/types.ts). */
export function renderItem(doc, vars, c = {}) {
  const phase = c.phase ?? "on", fields = resolveFields(doc, vars, c.over), s = doc.source || {};
  const it = { id: doc.id, name: doc.name, kind: doc.kind, role: doc.role, builtin: doc.builtinId, z: doc.placement.z, visible: phase === "on", phase, seq: c.seq ?? 1, nextSeq: c.nextSeq ?? 0, placement: doc.placement, animation: doc.animation, style: doc.style, fields };
  if (doc.kind === "html" || doc.kind === "caspar") {
    it.source = { entry: s.entry, src: `/gfx/${encodeURIComponent(doc.id)}/${String(s.entry || "index.html").split("/").map(encodeURIComponent).join("/")}?v=${doc.updatedAt ?? 0}-${c.nonce ?? 0}`, width: s.width, height: s.height, allowNetwork: !!s.allowNetwork, dataFormat: s.dataFormat };
    if (doc.kind === "caspar") it.data = casparData(fields, s.dataFormat || "xml", doc.fields);
  } else if (doc.kind === "url" || (doc.kind === "remote" && s.outputUrl)) {
    it.external = { url: doc.kind === "url" ? s.url : s.outputUrl, width: s.width, height: s.height, css: s.css || "" };
  }
  return it;
}

/** Set a value at a dotted path ("placement.x", "fields.2.label"), creating nothing that is missing on the way. */
export function setPath(o, path, v) {
  const ks = path.split("."), last = ks.pop();
  let t = o;
  for (const k of ks) { t = t?.[k]; if (t == null) return false; }
  t[last] = v; return true;
}
export const getPath = (o, path) => path.split(".").reduce((a, k) => (a == null ? a : a[k]), o);

/** Dragging by (dx, dy) canvas pixels: x and y are distances from the anchored edge, so moving away from the right/bottom edge shrinks them. */
export function dragTo(placement, dx, dy) {
  const a = placement.anchor, right = a.endsWith("right"), bottom = a.startsWith("bottom"), r = (n) => Math.round(n);
  return { x: r(placement.x + (right ? -dx : dx)), y: r(placement.y + (bottom ? -dy : dy)) };
}

/** Plain-language reading of a failed connector or import message that is already plain; adds a hint for the common network failures. */
export function plainError(msg) {
  const m = String(msg || "");
  if (/failed to fetch|networkerror|load failed/i.test(m)) return "Fieldhouse could not be reached. Is it still running?";
  return m || "Something went wrong.";
}

/** "key: value" lines -> object (for HTTP headers and remote targets). Lines without a colon or equals sign are ignored. */
export function parsePairs(text) {
  const o = {};
  for (const line of String(text || "").split("\n")) { const m = /^\s*([^:=\s][^:=]*?)\s*[:=]\s*(.*?)\s*$/.exec(line); if (m) o[m[1]] = m[2]; }
  return o;
}
export const pairsText = (o) => Object.entries(o || {}).map(([k, v]) => `${k}: ${v}`).join("\n");

export const slugName = (s) => String(s || "").trim().replace(/\s+/g, " ").slice(0, 60);
