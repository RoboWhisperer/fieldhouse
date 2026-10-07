// The graphic editor: #/graphics?edit=<id>. Left: a live preview on a 1920x1080 canvas (drag the box to move it) and a test panel.
// Right: placement, animation, when it shows, data fields, look (built-ins) or source and code (custom pages), remote target.
import { html, raw, icon, api, S, toast, fail, go, fmtBytes } from "../app.js";
import { ROLE_LABEL, ROLE_HELP, KIND_LABEL, KIND_HELP, ANCHORS, ANCHOR_LABEL, PRESETS, EASINGS, SHOW_MODES, PART_LABEL, COLOR_LABEL, BUILTIN_COLORS, CONTRAST_PAIRS, resolveFields, dragTo, slugName } from "./graphics-lib.js";
import { contrast, isHex, rate } from "./settings-lib.js";
import { REPO } from "./settings-ui.js";
import { text, num, sel, chk, area, pill, sec, bindForm, openDialog, confirmDialog } from "./graphics-ui.js";
import { fieldsEditor, bindFieldButtons } from "./graphics-fields.js";
import { targetFields, cleanTarget, CONN_KIND } from "./graphics-connectors.js";
import { mountPreview } from "./graphics-preview.js";

export const EDITOR_CSS = `
.gx-bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.gx-bar .ttl{display:grid;gap:4px;min-width:0}
.gx-bar .ttl .gx-note{color:var(--text-2)}
.gx-bar h1{font-size:20px;line-height:1.2;min-width:0;overflow:hidden;text-overflow:ellipsis}
.gx-vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.gx-col{display:flex;align-items:center;gap:8px}
.gx-ctr{display:grid;gap:8px}
.gx-ctr .r{display:grid;grid-template-columns:120px minmax(0,1fr) auto;gap:12px;align-items:center}
.gx-note{font-size:13px;line-height:1.5;color:var(--text-2)}
.gx-testrow{display:flex;gap:8px;flex-wrap:wrap}
.gx-sub{font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:8px;display:flex;align-items:center;gap:8px}
.gx-tg{display:grid;gap:8px}
.gx-tg+.gx-tg{padding-top:16px;border-top:1px solid var(--line)}
.gx-opv{display:grid;grid-template-columns:minmax(0,1fr) 48px;gap:12px;align-items:center}
.gx-parts{border:0;padding:0;margin:0;display:grid;gap:12px}.gx-parts legend{font-size:12px;font-weight:600;color:var(--text-2);padding:0 0 12px}
.gx-code-pb{display:grid;gap:16px}
.gx-bar2{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
details.gx-det summary{cursor:pointer;color:var(--action-hi);font-size:12.5px}
details.gx-det summary:focus-visible{outline:2px solid var(--action-hi);outline-offset:2px}
`;

const clone = (o) => structuredClone(o);
const enc = encodeURIComponent;
const WEIGHTS = [[400, "Regular"], [500, "Medium"], [600, "Semi-bold"], [700, "Bold"], [800, "Extra bold"], [900, "Black"]];
const FILE_KINDS = ["html", "caspar"];
const hasFiles = (d) => FILE_KINDS.includes(d.draft.kind);
const bare = (doc) => { const o = clone(doc); delete o.visible; delete o.updatedAt; return o; };
const assign = (to, from) => { for (const k of Object.keys(to)) delete to[k]; Object.assign(to, from); };
const isOn = (id) => (S.state?.graphics?.items || []).some((i) => i.id === id && i.phase === "on");
const b64 = (buf) => { let s = ""; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const IMG = /\.(png|jpe?g|gif|webp)$/i, BIN = /\.(png|jpe?g|gif|webp|woff2?|ttf|otf|mp4|webm)$/i;

// ---------------------------------------------------------------- form sections
const aboutSec = (g) => sec("About", html`<div class="gx-g2">${text("name", g.name, "Name", { max: 60 })}${sel("role", g.role, "What kind of graphic is it", Object.entries(ROLE_LABEL).map(([k, v]) => [k, `${v} - ${ROLE_HELP[k]}`]))}</div>
  ${text("description", g.description, "Note (optional)", { max: 200, hint: "A reminder for you and your helpers. It is not shown on the video." })}
  <div class="gx-g2">${chk("enabled", g.enabled, "Switched on", "A switched-off graphic cannot be shown.")}${chk("requiresGame", g.requiresGame, "Only while a game is active", "Hidden when no game has been started.")}</div>`);

const placeSec = (g) => { const p = g.placement; return sec("Where it sits", html`
  <p class="gx-note">Drag the dashed box in the preview, or use the arrow keys on it. The picture is 1920 by 1080 pixels.</p>
  <div class="gx-g2">${sel("placement.anchor", p.anchor, "Anchored to", ANCHORS.map((a) => [a, ANCHOR_LABEL[a]]), { hint: "The edge or corner it is measured from." })}
    ${num("placement.scale", p.scale, "Size", { min: 0.1, max: 5, step: 0.05, hint: "1 is normal, 2 is twice as big." })}</div>
  <div class="gx-g3">${num("placement.x", p.x, "Across (pixels)", { min: -4000, max: 4000 })}${num("placement.y", p.y, "Down (pixels)", { min: -4000, max: 4000 })}${num("placement.z", p.z, "In front (layer)", { min: -100, max: 1000, hint: "Higher sits in front." })}</div>
  <div class="field"><label for="gx-op">See-through amount (opacity)</label><div class="gx-opv"><input id="gx-op" type="range" min="0" max="1" step="0.05" value="${p.opacity}" data-p="placement.opacity" data-n><output class="mono" data-out="placement.opacity" style="text-align:right">${Math.round(p.opacity * 100)}%</output></div></div>`); };

const spec = (g, dir, label) => { const a = g.animation[dir]; return html`<div class="gx-fld"><b>${label}</b><div class="gx-g2">${sel(`animation.${dir}.preset`, a.preset, "Style", PRESETS)}${sel(`animation.${dir}.easing`, a.easing, "Feel", EASINGS)}</div>
  <div class="gx-g2">${num(`animation.${dir}.durationMs`, a.durationMs, "Takes (milliseconds)", { min: 0, max: 5000, step: 50 })}${num(`animation.${dir}.delayMs`, a.delayMs, "Waits first (milliseconds)", { min: 0, max: 5000, step: 50 })}</div></div>`; };
const animSec = (g) => sec("How it moves", html`
  ${g.kind === "caspar" ? html`<div class="banner info">${icon("info", "lg")}<span>A CasparCG template animates itself when it plays and stops. These settings do not change that.</span></div>` : g.kind === "url" || g.kind === "remote" ? html`<div class="banner info">${icon("info", "lg")}<span>Web pages and remote graphics are simply switched on and off. Their own animation is up to the page.</span></div>` : ""}
  <div class="gx-stack" style="gap:16px">${spec(g, "in", "Appearing")}${spec(g, "out", "Disappearing")}</div>
  <div><button type="button" class="btn sm ghost" data-act="replay">${icon("replay", "sm")}Play it in the preview</button></div>`);

const showSec = (g) => { const m = SHOW_MODES.find((x) => x[0] === g.show.mode) || SHOW_MODES[0]; return sec("When it shows", html`
  ${sel("show.mode", g.show.mode, "Show it", SHOW_MODES.map(([v, l]) => [v, l]), { re: "", hint: m[2] })}
  ${g.show.mode === "auto-hide" ? num("show.seconds", g.show.seconds ?? 8, "Hide after (seconds)", { min: 1, max: 3600 }) : ""}
  ${g.show.mode === "manual" ? chk("show.startVisible", !!g.show.startVisible, "On air when a game starts", "The score bug uses this so it is up as soon as the game begins.") : ""}`); };

const fieldsSec = (d) => sec("Values it shows", html`<p class="gx-note">${d.draft.kind === "builtin" ? "These are the words and numbers this graphic uses. Choose where each comes from." : "Each field is a value your page or system receives. Choose where each value comes from."} The preview uses a sample game (Lions 42, Tigers 38).</p>${fieldsEditor(d.draft.fields, { vars: d.vars, locked: d.draft.kind === "builtin" })}`);

// -- look (built-ins)
const hexIn = (path, v, label, extra = "") => html`<div class="field"><span class="fl">${label}</span><div class="row"><input type="color" value="${isHex(v) ? v : "#000000"}" ${isHex(v) ? "" : "disabled"} data-p="${path}" aria-label="${label}, color picker"><input class="input mono" value="${v}" data-p="${path}" data-hex aria-label="${label}, color code" maxlength="30">${extra}</div></div>`;
function contrastHtml(g) {
  const used = BUILTIN_COLORS[g.builtinId] || [], c = g.style.colors;
  const rows = CONTRAST_PAIRS.filter(([a, b]) => used.includes(a) && used.includes(b) && isHex(c[a]) && isHex(c[b]));
  if (!rows.length) return "";
  return html`<div class="gx-ctr" role="status" aria-label="Readability of your colors">${rows.map(([a, b, name]) => { const r = contrast(c[a], c[b]), t = rate(r); return html`<div class="r">${pill(t.id, t.label, t.id === "ready" ? "check" : t.id === "check" ? "alert" : "x")}<span>${name}</span><span class="faint mono">${r.toFixed(1)} to 1</span></div>`; })}
    <span class="hint">Readable is easy to see across a room or on a phone. Low means some viewers will struggle.</span></div>`;
}
function fontHtml(d) {
  const f = d.fonts, cur = d.draft.style.fontFamily, fams = f.families || [];
  const none = f.source === "none" || !fams.length;
  return html`${sel("style.fontFamily", cur, "Font", [["", "Default (works everywhere)"], ...(cur && !fams.includes(cur) ? [[cur, `${cur} (not found in the video engine)`]] : []), ...fams.map((x) => [x, x])], { hint: none ? "Fieldhouse has not listed the video engine's fonts yet. They appear here a few seconds after the preview first loads." : undefined })}
    <div class="banner ${none || (cur && !fams.includes(cur)) ? "warn" : "info"}">${icon("info", "lg")}<div><b>Only these fonts draw in the video.</b> <span class="muted">The list is what OBS (the video engine) really has installed${f.source === "browser" ? ", measured in this browser because OBS has not reported yet, so it may be longer than OBS's own" : ""}. A font from your own computer can look right in this preview and then be missing on the stream.</span>
      ${f.note ? html`<details class="gx-det"><summary>More about fonts</summary><p class="muted" style="margin-top:6px">${f.note}</p></details>` : ""}</div></div>`;
}
const lookSec = (d) => {
  const g = d.draft, s = g.style, used = BUILTIN_COLORS[g.builtinId] || Object.keys(COLOR_LABEL), parts = Object.keys(s.parts || {});
  return sec("Look", html`
    <div class="gx-g2">${used.map((k) => hexIn(`style.colors.${k}`, s.colors[k], COLOR_LABEL[k], k === "accent" ? html`<button type="button" class="btn sm" data-team="home">Home team</button><button type="button" class="btn sm" data-team="away">Away team</button>` : ""))}</div>
    ${used.includes("accent") ? html`<p class="hint">Accent can follow the team: press Home team or Away team to use their color.</p>` : ""}
    <div data-contrast>${contrastHtml(g)}</div>
    <div class="gx-g3">${num("style.radius", s.radius, "Corner roundness", { min: 0, max: 100 })}${num("style.fontSize", s.fontSize, "Text size", { min: 8, max: 200 })}${["scorebug", "scoreboard", "final"].includes(g.builtinId) ? num("style.scoreSize", s.scoreSize, "Score size", { min: 8, max: 300 }) : ""}
      ${g.builtinId === "ticker" ? num("style.speed", s.speed, "Scroll speed (pixels per second)", { min: 10, max: 2000 }) : ""}${sel("style.fontWeight", s.fontWeight, "Text weight", WEIGHTS)}</div>
    ${chk("style.shadow", s.shadow, "Soft shadow behind it")}
    <div data-font>${fontHtml(d)}</div>
    ${parts.length ? html`<fieldset class="gx-parts"><legend>Parts to show</legend><div class="gx-g2">${parts.map((k) => chk(`style.parts.${k}`, s.parts[k] !== false, PART_LABEL[k] || k))}</div></fieldset>` : ""}`);
};

// -- source (custom pages, web pages, remote)
function sourceSec(d) {
  const g = d.draft, s = g.source;
  if (g.kind === "html" || g.kind === "caspar") return sec("The page", html`
    <div class="gx-g3">${sel("source.entry", s.entry, "Main file", [...new Set([s.entry, ...d.files.map((f) => f.path).filter((p) => /\.html?$/i.test(p))])].map((p) => [p, p]), { hint: "The file Fieldhouse opens." })}${num("source.width", s.width, "Page width", { min: 16, max: 7680 })}${num("source.height", s.height, "Page height", { min: 16, max: 4320 })}</div>
    ${g.kind === "caspar" ? html`<div class="gx-g3">${sel("source.dataFormat", s.dataFormat || "xml", "Data format", [["xml", "XML (classic templates)"], ["json", "JSON (newer templates)"]], { hint: "How the template expects its data." })}${num("source.stopHoldMs", s.stopHoldMs ?? 1500, "Keep drawing after Hide (ms)", { min: 0, max: 60000, step: 100, hint: "Time for its exit animation." })}${chk("source.nextIsPlay", !!s.nextIsPlay, "Next acts like Play", "For templates that start over on Next.", { cls: "" })}</div>` : ""}
    ${chk("source.allowNetwork", !!s.allowNetwork, "Allow it to load things from the internet", "Off is safer and works without internet. Turn on only if the page needs online fonts, images or data.")}`);
  if (g.kind === "url") return sec("The web page", html`${text("source.url", s.url, "Address (URL)", { mono: true, ph: "https://", hint: "OBS loads this page and draws it over your video. It needs internet while you broadcast." })}
    <div class="gx-g2">${num("source.width", s.width, "Page width", { min: 16, max: 7680 })}${num("source.height", s.height, "Page height", { min: 16, max: 4320 })}</div>
    ${area("source.css", s.css, "Extra styling (optional)", { rows: 2, mono: true, ph: "body { background: transparent; }", hint: "CSS added to the page, for example to hide a header." })}`);
  if (g.kind === "remote") { const c = d.conns.find((x) => x.id === s.connectorId); return sec("Remote system", html`
    ${sel("source.connectorId", s.connectorId, "Connector", [...(c ? [] : [[s.connectorId || "", s.connectorId ? "(deleted connector)" : "Choose a connector"]]), ...d.conns.map((x) => [x.id, `${x.name} (${CONN_KIND[x.kind]})`])], { re: "", hint: "Add or change connectors on the Connectors tab." })}
    ${c ? targetFields(c.kind, "source.target", s.target || {}) : html`<div class="banner warn">${icon("alert", "lg")}<span>This graphic has no working connector, so nothing will be sent. Pick one above.</span></div>`}
    ${text("source.outputUrl", s.outputUrl, "Output page (optional)", { mono: true, ph: "https://", hint: "The page that shows this graphic. Fieldhouse adds it to OBS as a layer. Leave empty if another system shows it." })}
    <div class="gx-g2">${num("source.width", s.width, "Page width", { min: 16, max: 7680 })}${num("source.height", s.height, "Page height", { min: 16, max: 4320 })}</div>
    ${area("source.css", s.css, "Extra styling (optional)", { rows: 2, mono: true })}`); }
  return "";
}

const formHtml = (d) => html`${aboutSec(d.draft)}${placeSec(d.draft)}${animSec(d.draft)}${showSec(d.draft)}${fieldsSec(d)}${d.draft.kind === "builtin" ? lookSec(d) : ""}${sourceSec(d)}`;

// -- test panel
function testHtml(d) {
  const g = d.draft, vals = resolveFields(g, d.vars), canNext = g.kind !== "builtin", on = isOn(g.id);
  return sec("Try it", html`
    ${g.fields.length ? html`<div class="gx-g3">${g.fields.map((f) => html`<div class="field"><label for="gx-t-${f.name}">${f.label || f.name}</label><input class="input" id="gx-t-${f.name}" data-t="${f.name}" value="${d.test[f.name] ?? ""}" placeholder="${vals[f.name] ?? ""}" autocomplete="off"></div>`)}</div><p class="hint">Type a value to use instead of the usual one. Empty boxes use the value shown in grey.</p>` : html`<p class="muted">This graphic has no fields to type. It shows the game as it is.</p>`}
    <div class="gx-tg"><div class="gx-sub">In the preview only <span class="faint">(nothing goes to the stream)</span></div>
      <div class="gx-testrow"><button type="button" class="btn sm" data-pv="show">${icon("play", "sm")}Show</button><button type="button" class="btn sm" data-pv="update">${icon("refresh", "sm")}Update</button>${canNext ? html`<button type="button" class="btn sm" data-pv="next">${icon("right", "sm")}Next</button>` : ""}<button type="button" class="btn sm" data-pv="hide">${icon("x", "sm")}Hide</button></div></div>
    <div class="gx-tg"><div class="gx-sub">On the stream, for real ${on ? pill("live", "On air now") : ""}</div>
      <div class="gx-testrow"><button type="button" class="btn sm ${on ? "" : "pri"}" data-live="show" ${g.enabled ? "" : "disabled"}>${icon("play", "sm")}Show on air</button><button type="button" class="btn sm" data-live="update">${icon("refresh", "sm")}Update on air</button>${canNext ? html`<button type="button" class="btn sm" data-live="next">${icon("right", "sm")}Next</button>` : ""}<button type="button" class="btn sm" data-live="hide">${icon("x", "sm")}Hide</button></div>
      <p class="hint">These use the saved version, so save your changes first.</p></div>`);
}

const render = (ctx, d) => {
  const g = d.saved;
  return html`<div class="gx-stack">
    <div class="gx-bar"><a class="btn ghost" href="#/graphics">${icon("left")}All graphics</a><div class="ttl"><h1>${g.name}</h1><p class="gx-note">${ROLE_LABEL[g.role]} · ${KIND_LABEL[g.kind]}. ${KIND_HELP[g.kind]}</p></div><span data-air>${isOn(g.id) ? pill("live", "On air") : pill("off", "Off air")}</span><span class="sp"></span><a class="btn" href="/api/graphics/${enc(g.id)}/export" download>${icon("down2")}Export</a></div>
    <div class="gx-two">
      <div class="gx-sticky">
        ${sec("Preview", html`<div class="gx-stage" data-stage><div class="gx-handle hide" data-handle tabindex="0" role="group" aria-roledescription="draggable" aria-label="Position of the graphic. Use the arrow keys to move it by 1 pixel, or hold Shift to move by 10."></div></div>
          <div class="row" style="flex-wrap:wrap"><div class="gx-chk"><input type="checkbox" id="gx-live" data-live-vars><label for="gx-live">Use the live game instead of the sample</label></div><span class="sp"></span>${g.kind === "url" || g.kind === "remote" ? html`<button type="button" class="btn sm" data-act="ext">${icon("eye", "sm")}Load the page in the preview</button>` : ""}</div>
          ${g.kind === "url" || g.kind === "remote" ? html`<p class="hint">The preview only loads the page when you ask, because it comes from the internet.</p>` : html`<p class="hint">Shown the way the video engine draws it, on a sample picture. Colors and fonts on the real stream can differ slightly.</p>`}`)}
        <div data-test>${testHtml(d)}</div>
      </div>
      <div class="gx-stack"><div class="gx-stack" data-form>${formHtml(d)}</div></div>
    </div>
    <div class="gx-stack" data-code></div>
    <div class="gx-dirty" data-bar hidden role="status"><span>${icon("alert", "lg")}</span><span><b>You have unsaved changes.</b> <span class="muted">They are not on the stream until you save.</span></span><span class="sp"></span><span class="hint gx-bad" role="alert" data-err></span><button type="button" class="btn ghost" data-act="discard">Discard</button><button type="button" class="btn pri" data-act="save">${icon("check")}Save changes</button></div></div>`;
};

// ---------------------------------------------------------------- code editor (custom pages)
function codeHtml(d, cs) {
  const g = d.draft, bin = cs.path && BIN.test(cs.path);
  return sec("Page files", html`
    <div class="row" style="flex-wrap:wrap"><span class="muted">The HTML, styles, scripts and images this graphic is made of. Saving reloads the preview.</span><span class="sp"></span><a class="btn sm ghost" href="${REPO}/blob/main/docs/graphics-authoring.md" target="_blank" rel="noopener noreferrer">${icon("book", "sm")}Authoring guide</a></div>
    <div class="gx-code"><div class="gx-ftabs"><ul class="gx-files" aria-label="Files">${d.files.map((f) => html`<li><button type="button" data-file="${f.path}" ${f.path === cs.path ? raw('aria-current="true"') : ""}>${f.path}<span class="sz">${fmtBytes(f.bytes)}</span></button></li>`)}</ul>
        <button type="button" class="btn sm ghost" data-cf="new">${icon("plus", "sm")}New file</button><button type="button" class="btn sm ghost" data-cf="upload">${icon("up2", "sm")}Upload or replace</button><input type="file" multiple hidden data-upload aria-label="Choose files to upload"></div>
      <div class="gx-code-pb">${cs.path ? html`
        <div class="row" style="flex-wrap:wrap"><b class="mono">${cs.path}</b>${cs.path === g.source.entry ? pill("info", "Main file") : ""}<span class="sp"></span><span class="hint" data-fd>${cs.content !== cs.orig ? "Unsaved changes in this file" : ""}</span>
          ${bin ? "" : html`<button type="button" class="btn sm pri" data-cf="save">${icon("check", "sm")}Save file</button>`}<button type="button" class="btn sm ghost" data-cf="reload">${icon("refresh", "sm")}Reload preview</button><button type="button" class="btn sm ghost del" data-cf="del" ${cs.path === g.source.entry ? raw('disabled title="This is the main file"') : ""}>${icon("x", "sm")}Delete</button></div>
        ${bin ? html`<div class="gx-drop">${IMG.test(cs.path) && cs.b64 ? html`<img alt="${cs.path}" src="data:image/${cs.path.split(".").pop().replace("jpg", "jpeg")};base64,${cs.b64}" style="max-width:100%;max-height:240px">` : icon("film", "xl")}<span>This is an image, font or video, so it cannot be edited as text. Use Upload or replace to change it.</span></div>`
          : html`<label class="gx-vh" for="gx-ta">Contents of ${cs.path}</label><textarea class="gx-ta" id="gx-ta" spellcheck="false" autocapitalize="off" autocomplete="off" data-ta aria-describedby="gx-ta-h">${cs.content}</textarea><span class="hint" id="gx-ta-h">Tab types spaces. To move on to the next control, press Escape and then Tab. Ctrl+S saves the file.</span>`}` : html`<div class="empty"><b>Pick a file to edit</b></div>`}</div></div>`);
}

async function loadFile(d, cs, path) {
  const r = await api.get(`/graphics/${enc(d.draft.id)}/file?path=${enc(path)}`);
  cs.path = path; cs.content = cs.orig = r.content ?? ""; cs.b64 = r.contentBase64 || "";
}

export default {
  async load(ctx) {
    const id = ctx.query.edit;
    const [saved, vars, fonts, conns] = await Promise.all([api.get(`/graphics/${enc(id)}`), api.get("/graphics/sample-vars"), api.get("/graphics/fonts"), api.get("/graphics/connectors")]);
    const files = FILE_KINDS.includes(saved.kind) ? await api.get(`/graphics/${enc(id)}/files`) : [];
    return { saved: bare(saved), draft: bare(saved), vars, fonts, conns, files, test: {} };
  },
  render,
  bind(root, ctx, d) {
    const un = [], $ = (s) => root.querySelector(s), form = $("[data-form]"), testEl = $("[data-test]"), bar = $("[data-bar]"), stage = $("[data-stage]"), handle = $("[data-handle]");
    const cs = { path: "", content: "", orig: "", b64: "" }, g = d.draft;
    let prev = mountPreview(stage, { docs: [g], vars: d.vars, onDraw: pos }); un.push(() => prev.destroy());
    const err = (m) => { $("[data-err]").textContent = m || ""; };
    const dirty = () => JSON.stringify(d.draft) !== JSON.stringify(d.saved);
    const mark = () => { bar.hidden = !dirty(); };
    const paintTest = () => { testEl.innerHTML = testHtml(d).s; };
    const paintForm = () => { form.innerHTML = formHtml(d).s; paintTest(); };
    const repaint = () => prev.set([g], d.vars);
    const paintCode = () => { if (hasFiles(d)) $("[data-code]").innerHTML = codeHtml(d, cs).s; };
    const refreshContrast = () => { const c = $("[data-contrast]"); if (c) c.innerHTML = contrastHtml(g).s; };

    // ---- the form
    un.push(bindForm(form, g, {
      onChange(path, el) {
        err(""); mark(); repaint();
        if (path.startsWith("style.colors")) { refreshContrast(); const pick = form.querySelector(`input[type=color][data-p="${CSS.escape(path)}"]`); if (pick) { const ok = isHex(g.style.colors[path.split(".").pop()]); pick.disabled = !ok; } }
        if (path.startsWith("fields")) paintTest();
        const out = form.querySelector(`[data-out="${CSS.escape(path)}"]`); if (out) out.textContent = Math.round(el.value * 100) + "%";
      },
      onRedraw(path) {
        if (path === "show.mode" && g.show.mode === "auto-hide" && !g.show.seconds) g.show.seconds = 8;
        if (path === "source.connectorId") g.source.target = {};
        mark(); repaint(); paintForm();
      },
    }));
    un.push(bindFieldButtons(form, () => g.fields, () => { mark(); repaint(); paintForm(); }));
    form.addEventListener("click", (e) => {
      const t = e.target.closest("[data-team]"); if (t) { g.style.colors.accent = t.dataset.team; mark(); repaint(); paintForm(); }
      if (e.target.closest('[data-act="replay"]')) { prev.hide(); setTimeout(() => prev.show(d.test), 450); }
    });

    // ---- preview: drag handle
    function pos() {
      const r = prev.rect(), k = prev.scale(); if (!r || !k) { handle.classList.add("hide"); return; }
      Object.assign(handle.style, { left: r.x * k + "px", top: r.y * k + "px", width: r.w * k + "px", height: r.h * k + "px" }); handle.classList.remove("hide");
    }
    setTimeout(pos, 500); const ro = new ResizeObserver(pos); ro.observe(stage); un.push(() => ro.disconnect());
    const move = (x, y) => { const p = g.placement; p.x = Math.max(-4000, Math.min(4000, x)); p.y = Math.max(-4000, Math.min(4000, y)); for (const k of ["x", "y"]) { const i = form.querySelector(`[data-p="placement.${k}"]`); if (i) i.value = p[k]; } mark(); repaint(); };
    let drag = null;
    handle.addEventListener("pointerdown", (e) => { handle.setPointerCapture(e.pointerId); drag = { cx: e.clientX, cy: e.clientY, p: { ...g.placement } }; e.preventDefault(); });
    handle.addEventListener("pointermove", (e) => { if (!drag) return; const k = prev.scale(), n = dragTo(drag.p, (e.clientX - drag.cx) / k, (e.clientY - drag.cy) / k); move(n.x, n.y); });
    const end = () => { drag = null; }; handle.addEventListener("pointerup", end); handle.addEventListener("pointercancel", end);
    handle.addEventListener("keydown", (e) => {
      const st = e.shiftKey ? 10 : 1, a = g.placement.anchor, dx = { ArrowLeft: -st, ArrowRight: st }[e.key] || 0, dy = { ArrowUp: -st, ArrowDown: st }[e.key] || 0;
      if (!dx && !dy) return; e.preventDefault(); const n = dragTo(g.placement, dx, dy); move(n.x, n.y); setTimeout(pos, 60);
    });
    $("[data-live-vars]").addEventListener("change", async (e) => { try { d.vars = await api.get(`/graphics/sample-vars${e.target.checked ? "?live=1" : ""}`); repaint(); paintForm(); } catch (x) { fail(x); } });
    root.addEventListener("click", (e) => { if (e.target.closest('[data-act="ext"]')) { prev.setExternal(true); e.target.closest("button").disabled = true; } });

    // ---- test panel
    testEl.addEventListener("input", (e) => { const n = e.target.dataset.t; if (n) { if (e.target.value === "") delete d.test[n]; else d.test[n] = e.target.value; } });
    testEl.addEventListener("click", async (e) => {
      const pv = e.target.closest("[data-pv]")?.dataset.pv, lv = e.target.closest("[data-live]")?.dataset.live;
      if (pv) { if (pv === "show") prev.show({ ...d.test }); if (pv === "update") prev.update({ ...d.test }); if (pv === "next") prev.next(); if (pv === "hide") prev.hide(); }
      if (lv) { try { await api.post(`/graphics/${enc(g.id)}/${lv}`, lv === "show" || lv === "update" ? { fields: { ...d.test } } : {}); } catch (x) { fail(x); } }
    });

    // ---- save and discard
    const cleanSource = () => {
      const s = clone(g.source);
      if (g.kind === "remote") { s.target = cleanTarget(d.conns.find((c) => c.id === s.connectorId)?.kind, s.target); }
      return s;
    };
    async function save() {
      if (!slugName(g.name)) return err("Give the graphic a name.");
      if (g.kind === "url" && !/^https?:\/\//i.test(g.source.url || "")) return err("The web page address must start with http:// or https://");
      if (g.kind === "remote" && g.source.outputUrl && !/^https?:\/\//i.test(g.source.outputUrl)) return err("The output page must start with http:// or https://");
      try {
        const body = { name: slugName(g.name), enabled: g.enabled, role: g.role, requiresGame: g.requiresGame, description: g.description || "", placement: g.placement, animation: g.animation, show: g.show, fields: g.fields, style: g.style };
        if (g.kind !== "builtin") body.source = cleanSource();
        const r = await api.put(`/graphics/${enc(g.id)}`, body);
        assign(d.saved, bare(r)); assign(g, bare(r)); mark(); err(""); paintForm(); repaint(); toast("Saved.");
        $(".gx-bar h1").textContent = g.name;
      } catch (x) { err(x.message); }
    }
    bar.addEventListener("click", (e) => {
      const a = e.target.closest("[data-act]")?.dataset.act;
      if (a === "save") save(); if (a === "discard") { assign(g, clone(d.saved)); mark(); err(""); paintForm(); repaint(); }
    });

    // ---- code
    if (hasFiles(d)) {
      const code = $("[data-code]");
      const open = async (p) => { try { await loadFile(d, cs, p); paintCode(); } catch (x) { fail(x); } };
      const guard = async () => cs.content === cs.orig || (await confirmDialog("Leave without saving?", `${cs.path} has changes you have not saved.`, "Leave without saving", { danger: true }));
      const saveFile = async () => { try { d.files = await api.put(`/graphics/${enc(g.id)}/file`, { path: cs.path, content: cs.content }); cs.orig = cs.content; prev.reload(); paintCode(); toast("File saved. The preview reloaded."); } catch (x) { fail(x); } };
      const startFile = g.source.entry || "index.html";
      if (d.files.some((f) => f.path === startFile)) open(startFile); else paintCode();
      code.addEventListener("input", (e) => { if (e.target.matches("[data-ta]")) { cs.content = e.target.value; const h = code.querySelector("[data-fd]"); if (h) h.textContent = cs.content !== cs.orig ? "Unsaved changes in this file" : ""; } });
      let esc = false;
      code.addEventListener("keydown", (e) => {
        if (!e.target.matches("[data-ta]")) return;
        if (e.key === "Escape") { esc = true; return; }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveFile(); return; }
        if (e.key === "Tab" && !esc && !e.shiftKey) { e.preventDefault(); const t = e.target, a = t.selectionStart; t.setRangeText("  ", a, t.selectionEnd, "end"); t.dispatchEvent(new Event("input", { bubbles: true })); }
        esc = false;
      });
      code.addEventListener("click", async (e) => {
        const f = e.target.closest("[data-file]"), c = e.target.closest("[data-cf]")?.dataset.cf;
        try {
          if (f && f.dataset.file !== cs.path && await guard()) await open(f.dataset.file);
          if (c === "save") await saveFile();
          if (c === "reload") { prev.reload(); toast("Preview reloaded."); }
          if (c === "upload") code.querySelector("[data-upload]").click();
          if (c === "del" && await confirmDialog(`Delete ${cs.path}?`, "The file is removed from this graphic.", "Delete file", { danger: true })) { d.files = await api.del(`/graphics/${enc(g.id)}/file?path=${enc(cs.path)}`); prev.reload(); await open(g.source.entry || d.files[0]?.path); }
          if (c === "new") {
            const dlg = openDialog("New file", html`<div class="field"><label for="gx-nf">File name</label><input class="input mono" id="gx-nf" placeholder="style.css" autocomplete="off" spellcheck="false"><span class="hint">Letters, numbers, dashes and dots. Use a folder like img/logo.png if you want. Allowed: html, css, js, json, svg, png, jpg, gif, webp, woff, woff2, ttf, otf, mp4, webm.</span></div><div class="gx-ft"><button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn pri" data-ok>Create file</button></div>`);
            dlg.el.querySelector("[data-ok]").onclick = async () => { const name = dlg.el.querySelector("#gx-nf").value.trim(); if (!name) return; try { d.files = await api.put(`/graphics/${enc(g.id)}/file`, { path: name, content: "" }); dlg.close(); await open(name); } catch (x) { fail(x); } };
          }
        } catch (x) { fail(x); }
      });
      code.addEventListener("change", async (e) => {
        if (!e.target.matches("[data-upload]")) return;
        try { for (const f of e.target.files) d.files = await api.put(`/graphics/${enc(g.id)}/file`, { path: f.name, contentBase64: b64(await f.arrayBuffer()) }); toast(`Uploaded ${e.target.files.length} file${e.target.files.length === 1 ? "" : "s"}.`); prev.reload(); if (cs.path) await loadFile(d, cs, cs.path).catch(() => {}); paintCode(); } catch (x) { fail(x); }
        e.target.value = "";
      });
    }

    // ---- the font list fills in a few seconds after the first preview (the overlay measures fonts in the browser or OBS)
    if (d.draft.kind === "builtin" && (d.fonts.source === "none" || !d.fonts.families?.length)) { const t = setTimeout(async () => { try { d.fonts = await api.get("/graphics/fonts"); const f = $("[data-font]"); if (f && d.fonts.families?.length) f.innerHTML = fontHtml(d).s; } catch {} }, 4000); un.push(() => clearTimeout(t)); }
    const beforeUnload = (e) => { if (dirty()) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload); un.push(() => window.removeEventListener("beforeunload", beforeUnload));
    return () => un.forEach((f) => f());
  },
  onState(root, st, ctx, d) {
    const a = root.querySelector("[data-air]"), on = isOn(d.saved.id);
    if (a && a.dataset.on !== String(on)) { a.dataset.on = String(on); a.innerHTML = (on ? pill("live", "On air") : pill("off", "Off air")).s; root.querySelector("[data-test]").innerHTML = testHtml(d).s; }
  },
};
