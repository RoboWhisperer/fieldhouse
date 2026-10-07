// Settings > Appearance and layout: theme, accent, density, text size, motion, custom CSS, console layouts, macro buttons, workspace export/import.
// Server half: src/automation/ui-settings.ts, ui-theme.ts, routes.ts. Every change is saved at once (PUT /api/ui) and applied with applyTokens().
import { html, raw, esc, icon, api, toast, fail } from "../app.js";
import { delegate, all, panel, sw } from "./settings-ui.js";
import { contrast, rate } from "./settings-lib.js";
import { applyTokens, resolveTheme, PANEL_NAMES, macroBar, inkOn } from "../customize.js";

const THEMES = [["dark", "Dark", "The default. Easy on the eyes in a dim gym."], ["light", "Light", "For bright rooms and printed screenshots."], ["high-contrast", "High contrast", "Strong borders and the clearest text."], ["auto", "Automatic", "Light or dark, whichever your computer uses."]];
const ACCENTS = [["", "Fieldhouse blue"], ["#2FB67C", "Green"], ["#F5A524", "Amber"], ["#E5484D", "Red"], ["#8B6CFF", "Purple"], ["#17A2B8", "Teal"], ["#E255A1", "Pink"], ["#7A8CA5", "Slate"]];
const DENSITY = [["compact", "Compact", "More on screen"], ["comfortable", "Comfortable", "Balanced"], ["spacious", "Spacious", "Bigger targets"]];
const MOTION = [["system", "Follow my computer"], ["on", "Reduce motion"], ["off", "Allow all motion"]];
const COLS = [["left", "Left"], ["center", "Center"], ["right", "Right"]];
const PANEL_INFO = { game: "Clock, score, fouls, timeouts", events: "Log of what happened", graphics: "Show and hide graphics", macros: "Your big macro buttons", replay: "Instant replay", audio: "Audio mixer", sponsor: "Sponsor breaks", custom: "Custom field values" };
const BAD_CSS = ["@import, @charset, @namespace and @font-face", "url() of anything except a small embedded image (data:image/png, jpeg, gif or webp)", "image-set(), src(), element(), cross-fade()", "expression(), javascript:, vbscript:, behavior, -moz-binding", "web addresses (anything with ://)", "backslash escapes and the < > characters", "unmatched { } brackets", "more than 8000 characters"];
const SECTION_NAMES = { rules: "Rules", macros: "Macros", customFields: "Custom fields", webhooks: "Webhooks", looks: "Looks (display settings)", layouts: "Console layouts", graphics: "Graphics", profiles: "Sport profiles" };

const themeNow = (d) => d.tokens.themes[resolveTheme(d.ui.theme)];
const rateTxt = (r) => `${r.toFixed(1)} to 1 (${rate(r).label.toLowerCase()})`;
const presetOf = (d) => d.ui.layouts.presets.find((p) => p.id === d.editing) ?? d.ui.layouts.presets.find((p) => p.id === d.ui.layouts.active) ?? d.ui.layouts.presets[0];

// ---------------------------------------------------------------- look
function look(d) {
  const ui = d.ui, tk = themeNow(d), acc = ui.accent || tk["--action"];
  const rBg = contrast(acc, tk["--panel"]), rInk = contrast(tk["--action-ink"], acc);
  return panel("Look", html`
    <div class="fr"><div class="fl2" id="th-l"><b>Theme</b><span class="muted">How the whole console looks.</span></div>
      <div class="thgrid" role="radiogroup" aria-labelledby="th-l">${THEMES.map(([k, l, t]) => { const p = k === "auto" ? d.tokens.themes[resolveTheme("auto")] : d.tokens.themes[k]; return html`<button type="button" class="thc ${ui.theme === k ? "on" : ""}" role="radio" aria-checked="${ui.theme === k}" data-act="theme" data-v="${k}" data-fk="fk-th-${k}">
        <span class="thmini" style="background:${p["--ground"]};border-color:${p["--line-strong"]}"><i style="background:${p["--panel"]};border-color:${p["--line"]}"><b style="background:${p["--text"]}"></b><b style="background:${p["--text-2"]};width:60%"></b></i><em style="background:${p["--action-fill"]}"></em></span>
        <span class="thn">${ui.theme === k ? icon("check", "sm") : ""}${l}</span><span class="muted">${t}</span></button>`; })}</div></div>
    <div class="fr"><div class="fl2" id="ac-l"><b>Accent color</b><span class="muted">Used for buttons, links and the current item.</span></div>
      <div class="acrow" role="radiogroup" aria-labelledby="ac-l">${ACCENTS.map(([c, n]) => html`<button type="button" class="acs ${ui.accent.toUpperCase() === c ? "on" : ""}" role="radio" aria-checked="${ui.accent.toUpperCase() === c}" aria-label="${n}" title="${n}" data-act="accent" data-v="${c}" style="background:${c || "#3D8BFD"};color:${inkOn(c || "#3D8BFD")}" data-fk="fk-ac-${c || "default"}">${ui.accent.toUpperCase() === c ? icon("check") : ""}</button>`)}
        <label class="row" style="gap:8px">Your own <input type="color" data-in="accent" value="${/^#[0-9a-f]{6}$/i.test(ui.accent) ? ui.accent : "#3D8BFD"}" aria-label="Pick your own accent color"></label></div>
      <div class="acchk" role="status" aria-live="polite">
        <span class="${rInk >= 4.5 ? "ok-t" : "warn-t"}">${icon(rInk >= 4.5 ? "check" : "alert", "sm")} Button text on this color: ${rateTxt(rInk)}.</span>
        <span class="${rBg >= 3 ? "ok-t" : "warn-t"}">${icon(rBg >= 3 ? "check" : "alert", "sm")} Against the ${resolveTheme(ui.theme).replace("-", " ")} background: ${rBg.toFixed(1)} to 1. ${rBg >= 3 ? "Easy to see." : "Low: outlines and focus rings in this color may be hard to see. Pick a lighter or darker color, or a different theme."}</span>
        <span class="muted">Link text is lightened or darkened for you so it stays readable.</span></div></div>
    <div class="fr"><div class="fl2" id="de-l"><b>Spacing</b><span class="muted">How tight table rows and lists are.</span></div>${seg("density", DENSITY, ui.density, "de-l")}</div>
    <div class="fr"><div class="fl2"><b>Text size</b><span class="muted">Scales the console's text. Currently ${Math.round(ui.textScale * 100)}%.</span></div>
      <div class="row"><span aria-hidden="true">A</span><input type="range" min="0.9" max="1.3" step="0.05" value="${ui.textScale}" data-in="scale" aria-label="Text size" aria-valuetext="${Math.round(ui.textScale * 100)} percent" data-fk="fk-scale"><span aria-hidden="true" style="font-size:20px">A</span><button type="button" class="btn sm ghost" data-act="scale100" ${raw(ui.textScale === 1 ? "disabled" : "")}>Reset</button></div></div>
    <div class="fr"><div class="fl2" id="mo-l"><b>Motion</b><span class="muted">Fades and slides in the console. Never changes your broadcast graphics.</span></div>${seg("motion", MOTION, ui.reducedMotion, "mo-l")}</div>`);
}
const seg = (act, list, cur, lab) => html`<div class="seg" role="radiogroup" aria-labelledby="${lab}">${list.map(([k, l, t]) => html`<button type="button" class="${cur === k ? "on" : ""}" role="radio" aria-checked="${cur === k}" data-act="${act}" data-v="${k}" data-fk="fk-${act}-${k}" title="${t ?? l}">${cur === k ? icon("check", "sm") : ""}${l}</button>`)}</div>`;

// ---------------------------------------------------------------- custom css
function cssBox(d) {
  const changed = d.css !== d.ui.customCss;
  return panel("Custom CSS (advanced)", html`<div class="fr">
    <p class="muted" style="margin:0">For people who know CSS. It changes only the console on this computer: never the phone remote and never the OBS overlay. It is checked when you save, so a typo cannot break the page with something unsafe.</p>
    <label class="field"><span class="fl">Your CSS</span><textarea class="input mono" data-in="css" rows="7" spellcheck="false" aria-describedby="css-s" style="height:auto;padding:10px 12px;resize:vertical;width:100%" placeholder=".panel { border-radius: 4px; }">${d.css}</textarea></label>
    <div id="css-s" class="vcheck2" role="status" aria-live="polite">${cssMsg(d)}</div>
    <div class="row"><button type="button" class="btn pri" data-act="csssave" ${raw(changed && d.cssOk !== false ? "" : "disabled")}>${icon("check")}Save CSS</button><button type="button" class="btn" data-act="cssrevert" ${raw(changed ? "" : "disabled")}>Undo my edits</button><button type="button" class="btn ghost" data-act="cssclear" ${raw(d.ui.customCss || d.css ? "" : "disabled")}>Remove all custom CSS</button><span class="sp"></span><span class="muted" data-count>${d.css.length} of 8000 characters</span></div>
    <details><summary>What is not allowed</summary><ul class="bul">${BAD_CSS.map((x) => html`<li>${x}</li>`)}</ul><p class="muted">These checks are a safety net for mistakes and pasted code, not a security wall: anyone who can use this computer's console can already change it.</p></details></div>`);
}
const cssMsg = (d) => (d.cssOk === false ? html`<span class="err-t">${icon("alert", "sm")} ${d.cssMsg}</span>` : d.css === d.ui.customCss ? (d.css ? html`<span class="ok-t">${icon("check", "sm")} Saved and applied.</span>` : html`<span class="muted">No custom CSS.</span>`) : d.cssOk ? html`<span class="ok-t">${icon("check", "sm")} Looks fine. Press Save CSS to apply it.</span>` : html`<span class="muted">Checking...</span>`);

// ---------------------------------------------------------------- layouts
function layouts(d) {
  const L = d.ui.layouts, p = presetOf(d), n = L.presets.length;
  const colName = (c) => COLS.find((x) => x[0] === c)[1];
  const colView = ([c, label]) => html`<section class="lcol" aria-label="${label} column"><h4>${label} column</h4>${p.columns[c].length ? html`<ol>${p.columns[c].map((id, i) => html`<li><span class="pn"><b>${PANEL_NAMES[id]}</b><small class="muted">${PANEL_INFO[id]}</small></span><span class="pb2">
      <button type="button" class="btn sm ghost" data-act="pup" data-c="${c}" data-i="${i}" data-fk="fk-pup-${id}" aria-label="Move ${PANEL_NAMES[id]} up in the ${label.toLowerCase()} column" ${raw(i === 0 ? "disabled" : "")}>${icon("up2", "sm")}</button>
      <button type="button" class="btn sm ghost" data-act="pdown" data-c="${c}" data-i="${i}" data-fk="fk-pdown-${id}" aria-label="Move ${PANEL_NAMES[id]} down in the ${label.toLowerCase()} column" ${raw(i === p.columns[c].length - 1 ? "disabled" : "")}>${icon("down2", "sm")}</button>
      ${c !== "left" ? html`<button type="button" class="btn sm ghost" data-act="pmove" data-c="${c}" data-i="${i}" data-to="${COLS[COLS.findIndex((x) => x[0] === c) - 1][0]}" data-fk="fk-pl-${id}" aria-label="Move ${PANEL_NAMES[id]} to the ${colName(COLS[COLS.findIndex((x) => x[0] === c) - 1][0]).toLowerCase()} column">${icon("left", "sm")}</button>` : ""}
      ${c !== "right" ? html`<button type="button" class="btn sm ghost" data-act="pmove" data-c="${c}" data-i="${i}" data-to="${COLS[COLS.findIndex((x) => x[0] === c) + 1][0]}" data-fk="fk-pr-${id}" aria-label="Move ${PANEL_NAMES[id]} to the ${colName(COLS[COLS.findIndex((x) => x[0] === c) + 1][0]).toLowerCase()} column">${icon("right", "sm")}</button>` : ""}
      <button type="button" class="btn sm ghost" data-act="phide" data-c="${c}" data-i="${i}" data-fk="fk-ph-${id}" aria-label="Hide ${PANEL_NAMES[id]}">${icon("eye", "sm")}Hide</button></span></li>`)}</ol>` : html`<p class="muted" style="margin:6px 0">Empty column.</p>`}</section>`;
  return panel("Console layout", html`
    <div class="fr"><p class="muted" style="margin:0">A layout decides which cards the Live console shows and where. Make one for each kind of broadcast, for example a plain scoring layout and a full production layout. Changes are saved at once.</p>
      <ul class="prlist" aria-label="Your layouts">${L.presets.map((x) => html`<li class="${x.id === p.id ? "ed" : ""}"><span class="prn"><b>${x.name}</b>${x.id === L.active ? html`<span class="pill ready noDot">${icon("check", "sm")}In use</span>` : ""}${x.builtin ? html`<span class="pill off noDot">Built in</span>` : ""}</span>
        <span class="row wrap"><button type="button" class="btn sm ${x.id === p.id ? "on" : ""}" data-act="pedit" data-id="${x.id}" aria-pressed="${x.id === p.id}" data-fk="fk-pe-${x.id}">${x.id === p.id ? "Editing" : "Edit"}</button>${x.id !== L.active ? html`<button type="button" class="btn sm pri" data-act="puse" data-id="${x.id}" aria-label="Use ${x.name} on the console">Use this</button>` : ""}</span></li>`)}</ul>
      <div class="row wrap"><label class="field inl"><span class="fl">New layout name</span><input class="input" data-in="newname" value="${d.newName}" maxlength="40" placeholder="Production night" autocomplete="off"></label><button type="button" class="btn" data-act="pnew" ${raw(n >= 12 ? "disabled" : "")}>${icon("plus")}New from "${p.name}"</button>${n >= 12 ? html`<span class="hint">12 layouts is the most.</span>` : ""}<span class="hint err" data-lerr role="alert"></span></div></div>
    <div class="fr"><div class="row wrap"><h3 class="h3">Editing "${p.name}"</h3><span class="sp"></span>
      ${!p.builtin ? html`<label class="field inl"><span class="fl vh">Layout name</span><input class="input" data-in="rename" data-id="${p.id}" value="${p.name}" maxlength="40" aria-label="Layout name" style="width:200px"></label>` : ""}
      <button type="button" class="btn sm" data-act="preset-reset" data-fk="fk-reset">Reset to default arrangement</button>
      ${!p.builtin ? (d.confirm === p.id ? html`<button type="button" class="btn sm danger" data-act="pdel" data-fk="fk-pdel">Delete "${p.name}"</button><button type="button" class="btn sm ghost" data-act="keep">Keep</button>` : html`<button type="button" class="btn sm danger" data-act="askdel" data-fk="fk-askdel">Delete layout</button>`) : ""}</div>
      <div class="lprev" role="img" aria-label="Preview of the layout: ${COLS.map(([c, l]) => `${l} column: ${p.columns[c].map((id) => PANEL_NAMES[id]).join(", ") || "empty"}`).join(". ")}${p.hidden.length ? ". Hidden: " + p.hidden.map((id) => PANEL_NAMES[id]).join(", ") : ""}">${COLS.map(([c, l]) => html`<div><small>${l}</small>${p.columns[c].map((id) => html`<span class="pv2">${PANEL_NAMES[id]}</span>`)}</div>`)}</div>
      <div class="lcols">${COLS.map(colView)}</div>
      <section class="lcol hid" aria-label="Hidden cards"><h4>Hidden</h4>${p.hidden.length ? html`<ul>${p.hidden.map((id) => html`<li><span class="pn"><b>${PANEL_NAMES[id]}</b><small class="muted">${PANEL_INFO[id]}</small></span><span class="pb2">${COLS.map(([c, l]) => html`<button type="button" class="btn sm" data-act="pshow" data-id="${id}" data-to="${c}" data-fk="fk-ps-${id}-${c}" aria-label="Show ${PANEL_NAMES[id]} in the ${l.toLowerCase()} column">${icon("plus", "sm")}${l}</button>`)}</span></li>`)}</ul>` : html`<p class="muted" style="margin:6px 0">Nothing is hidden.</p>`}</section></div>`);
}

// ---------------------------------------------------------------- macro buttons
function macroButtons(d) {
  const mb = d.ui.macroButtons, by = new Map(d.macros.map((m) => [m.id, m])), left = d.macros.filter((m) => !mb.some((b) => b.macroId === m.id));
  return panel("Macro buttons on the console", html`<div class="fr"><p class="muted" style="margin:0">Big buttons for the macros you use most. The first ones are easiest to reach. Make or change macros in <a href="#/automation/macros">Automation, Macros</a>.</p>
    ${mb.length ? html`<ul class="mblist">${mb.map((b, i) => { const m = by.get(b.macroId); return html`<li><span class="mbn"><b>${m ? m.label : "(deleted macro)"}</b>${m?.hotkey ? html`<span class="kbd">${m.hotkey}</span>` : ""}</span>
      <label class="row" style="gap:6px">Color <input type="color" data-in="mbcolor" data-i="${i}" value="${b.color || m?.color || "#3D8BFD"}" aria-label="Button color for ${m?.label ?? "this macro"}"></label>
      <label class="row" style="gap:6px"><span>Size</span><select class="select" data-in="mbsize" data-i="${i}" aria-label="Size of ${m?.label ?? "this button"}" style="width:110px"><option value="normal" ${raw(b.size !== "large" ? "selected" : "")}>Normal</option><option value="large" ${raw(b.size === "large" ? "selected" : "")}>Large</option></select></label>
      <span class="row" style="gap:4px"><button type="button" class="btn sm ghost" data-act="mbup" data-i="${i}" data-fk="fk-mbup-${i}" aria-label="Move ${m?.label ?? "button"} earlier" ${raw(i === 0 ? "disabled" : "")}>${icon("up2", "sm")}</button><button type="button" class="btn sm ghost" data-act="mbdown" data-i="${i}" data-fk="fk-mbdown-${i}" aria-label="Move ${m?.label ?? "button"} later" ${raw(i === mb.length - 1 ? "disabled" : "")}>${icon("down2", "sm")}</button>${b.color ? html`<button type="button" class="btn sm ghost" data-act="mbcolorreset" data-i="${i}" aria-label="Use the macro's own color">Own color</button>` : ""}<button type="button" class="btn sm ghost" data-act="mbdel" data-i="${i}" data-fk="fk-mbdel-${i}" aria-label="Remove ${m?.label ?? "button"} from the console">${icon("x", "sm")}Remove</button></span></li>`; })}</ul>` : html`<p class="muted">No macro buttons yet.</p>`}
    <div class="row wrap">${left.length ? html`<label class="field inl"><span class="fl">Add a macro</span><select class="select" data-in="mbadd" style="width:240px"><option value="">Choose a macro...</option>${left.map((m) => html`<option value="${m.id}">${m.label}</option>`)}</select></label>` : html`<span class="muted">${d.macros.length ? "Every macro is already here." : "You have no macros yet."}</span>`}${mb.length >= 24 ? html`<span class="hint">24 buttons is the most.</span>` : ""}</div>
    <div class="field"><span class="fl">Preview (buttons do nothing here)</span><div inert>${raw(macroBar({ settings: { ui: d.ui } }))}</div></div></div>`);
}

// ---------------------------------------------------------------- workspace export / import
function workspace(d) {
  const w = d.ws, names = d.sections, f = w.file;
  const step = w.result;
  const statusPill = (s) => ({ "would import": ["info", "Would change", "info"], imported: ["ready", "Imported", "check"], "unknown section": ["check", "Not understood", "alert"], "not selected": ["off", "Skipped", "minus"], error: ["err", "Problem", "alert"] }[s] ?? ["off", s, "info"]);
  return panel("Workspace: move your setup", html`
    <div class="banner info" style="margin:16px 20px 0">${icon("shield", "lg")}<span><b>Passwords and keys are never included.</b> <span class="muted">Stream keys, API keys, webhook secrets, header values and pairing codes stay on this computer. After importing, type them again.</span></span></div>
    <div class="fr"><div class="fl2"><b>Export</b><span class="muted">Save your rules, macros, custom fields, webhooks, looks and layouts (and graphics and sport profiles) as one file you can keep or load on another computer.</span></div>
      <div class="chips2">${names.map((n) => html`<label class="chk"><input type="checkbox" data-in="exsec" data-n="${n}" ${raw(w.ex.has(n) ? "checked" : "")}> <span>${SECTION_NAMES[n] ?? n}</span></label>`)}</div>
      <div class="row"><a class="btn pri" href="/api/workspace/export${w.ex.size && w.ex.size < names.length ? "?sections=" + [...w.ex].map(encodeURIComponent).join(",") : ""}" download style="text-decoration:none" ${raw(w.ex.size ? "" : 'aria-disabled="true" tabindex="-1"')}>${icon("down2")}Download workspace file</a><span class="muted">Opens as a file named fieldhouse-workspace-date.json.</span></div></div>
    <div class="fr"><div class="fl2"><b>Import</b><span class="muted">Pick a workspace file. You see what would change first. Nothing is changed until you press Apply.</span></div>
      <label class="field"><span class="fl">Workspace file</span><input class="input" type="file" accept=".json,application/json" data-in="file" aria-label="Workspace file to import" style="height:auto;padding:8px"></label>
      ${w.err ? html`<div class="banner err" role="alert">${icon("alert", "lg")}<span>${w.err}</span></div>` : ""}
      ${f ? html`<div class="row wrap"><b>${w.fileName}</b><span class="muted">from ${f.app ?? "Fieldhouse"}${f.exportedAt ? ", saved " + new Date(f.exportedAt).toLocaleString() : ""}</span></div>
        <div class="field"><span class="fl">What to bring in</span><div class="chips2">${Object.keys(f.sections ?? {}).map((n) => html`<label class="chk"><input type="checkbox" data-in="imsec" data-n="${n}" ${raw(w.im.has(n) ? "checked" : "")}> <span>${SECTION_NAMES[n] ?? n}</span></label>`)}</div></div>
        <div class="field"><span class="fl" id="md-l">How to combine it</span><div class="seg" role="radiogroup" aria-labelledby="md-l">${[["merge", "Add to what I have"], ["replace", "Replace what I have"]].map(([k, l]) => html`<button type="button" class="${w.mode === k ? "on" : ""}" role="radio" aria-checked="${w.mode === k}" data-act="wmode" data-v="${k}" data-fk="fk-wm-${k}">${w.mode === k ? icon("check", "sm") : ""}${l}</button>`)}</div>
          <span class="hint">${w.mode === "merge" ? "Adds new things and updates ones with the same name or id. Nothing you have is removed." : "Makes the chosen sections match the file exactly. Things that are not in the file are removed."}</span></div>
        <div class="row"><button type="button" class="btn" data-act="wcheck" ${raw(w.im.size ? "" : "disabled")} data-fk="fk-wcheck">${icon("eye")}Check what would change</button><button type="button" class="btn pri" data-act="wapply" ${raw(step && step.ok && step.dryRun && !w.stale ? "" : "disabled")} data-fk="fk-wapply">${icon("check")}Apply import</button>${step && !w.stale ? "" : html`<span class="hint">Check first, then Apply unlocks.</span>`}</div>` : ""}
      ${step ? html`<div class="field" role="status" aria-live="polite"><span class="fl">${step.dryRun ? "This is what would happen (nothing has changed yet)" : "Done"}${w.stale ? " (out of date: you changed a choice, check again)" : ""}</span>
        <table class="tbl"><thead><tr><th>Section</th><th>Result</th><th>Add</th><th>Update</th><th>Remove</th><th>Notes</th></tr></thead><tbody>${step.sections.map((s) => { const [c, t, ic] = statusPill(s.status); return html`<tr><td>${SECTION_NAMES[s.name] ?? s.name}</td><td><span class="pill ${c} noDot">${icon(ic, "sm")}${t}</span></td><td class="n">${s.plan?.add ?? "-"}</td><td class="n">${s.plan?.update ?? "-"}</td><td class="n">${s.plan?.remove ?? "-"}</td><td style="white-space:normal">${s.message ?? s.plan?.note ?? ""}</td></tr>`; })}</tbody></table></div>` : ""}</div>`);
}
const seg2 = null;

const CSS = `
.stg .thgrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.stg .thc{display:grid;gap:6px;text-align:left;padding:10px;border-radius:8px;border:1px solid var(--line-strong);background:var(--inset);color:var(--text);cursor:pointer}
.stg .thc.on{border-color:var(--action);box-shadow:0 0 0 1px var(--action) inset}.stg .thc .thn{display:flex;gap:6px;align-items:center;font-weight:650}.stg .thc .muted{font-size:12px}
.stg .thmini{display:block;position:relative;height:56px;border:1px solid;border-radius:6px;overflow:hidden}.stg .thmini i{position:absolute;left:8px;top:8px;right:36px;bottom:8px;border:1px solid;border-radius:4px;padding:6px;display:grid;gap:4px;align-content:start}.stg .thmini i b{display:block;height:5px;border-radius:3px;width:85%}.stg .thmini em{position:absolute;right:8px;bottom:8px;width:20px;height:10px;border-radius:3px}
.stg .cp .fr{gap:12px;padding:20px}.stg .cp .fr>p.muted{line-height:1.5;max-width:75ch}.stg .cp .ph{height:40px}.stg .fl2{display:grid;gap:4px}.stg .fl2>b{font-weight:600}.stg .fl2>.muted{line-height:1.4}.stg .acrow{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.stg .acs{width:36px;height:36px;border-radius:50%;border:2px solid var(--line-strong);cursor:pointer;display:grid;place-items:center;padding:0}.stg .acs.on{box-shadow:0 0 0 2px var(--ground),0 0 0 4px var(--text)}
.stg .acchk{display:grid;gap:3px;font-size:12.5px}.stg .ok-t{color:var(--ready)}.stg .warn-t{color:var(--caution)}.stg .err-t{color:#FF8A8E}html[data-theme=light] .stg .err-t{color:#B3261E}html[data-theme=light] .stg .warn-t{color:#9A4500}
.stg .row{display:flex;align-items:center;gap:10px}.stg .row.wrap{flex-wrap:wrap}.stg .sp{flex:1}.stg .vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.stg .seg button:focus-visible,.stg .thc:focus-visible,.stg .acs:focus-visible{outline:2px solid var(--action-hi);outline-offset:2px}
.stg .field.inl{display:inline-grid}.stg .bul{margin:6px 0;padding-left:20px;display:grid;gap:3px}.stg .h3{margin:0;font-size:15px}
.stg .prlist{list-style:none;margin:0;padding:0;display:grid;gap:6px}.stg .prlist li{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:8px 12px;border:1px solid var(--line);border-radius:8px}.stg .prlist li.ed{border-color:var(--action);background:var(--action-wash)}.stg .prn{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.stg .btn.on{background:var(--action-wash);border-color:var(--action)}
.stg .lprev{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:10px;border-radius:8px;background:var(--ground);border:1px dashed var(--line-strong)}.stg .lprev small{display:block;color:var(--text-3);font-size:11px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px}.stg .lprev .pv2{display:block;margin-bottom:4px;padding:6px 8px;border-radius:5px;background:var(--raised);border:1px solid var(--line);font-size:12px}
.stg .lcols{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.stg .lcol{border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--inset);min-width:0}.stg .lcol h4{margin:0 0 6px;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--text-3)}
.stg .lcol ol,.stg .lcol ul{list-style:none;margin:0;padding:0;display:grid;gap:6px}.stg .lcol li{display:grid;gap:4px;padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--panel)}.stg .lcol .pn{display:grid}.stg .lcol .pn small{font-size:12px}.stg .lcol .pb2{display:flex;flex-wrap:wrap;gap:2px}
.stg .lcol.hid{margin-top:2px}.stg .lcol.hid ul{grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
.stg .mblist{list-style:none;margin:0;padding:0;display:grid;gap:6px}.stg .mblist li{display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:8px 12px;border:1px solid var(--line);border-radius:8px}.stg .mbn{display:flex;gap:8px;align-items:center;min-width:160px;flex:1}
.stg .chips2{display:flex;flex-wrap:wrap;gap:6px 18px}.stg .chk{display:inline-flex;gap:8px;align-items:center;min-height:28px;cursor:pointer}.stg .chk input{width:18px;height:18px;accent-color:var(--action)}
.stg a.btn[aria-disabled=true]{opacity:.45;pointer-events:none}
.stg textarea.input{display:block;font-size:12.5px;line-height:1.5}
.stg .tbl td,.stg .tbl th{white-space:normal}
.stg .cp .prlist li,.stg .cp .mblist li{border:0;background:var(--inset);padding:12px 16px}.stg .cp .prlist li.ed{background:var(--action-wash);box-shadow:0 0 0 1px var(--action) inset}
.stg .cp .lcol{border:0;padding:12px 16px 16px}.stg .cp .lcol li{border:0;background:var(--panel);padding:12px}.stg .cp .lcol .pn b{font-weight:600}.stg .cp .lcols{gap:16px}.stg .cp .lcol .btn.sm{padding:0 6px}.stg .cp .lcol .pb2{gap:0 2px}
.stg .cp .lprev{padding:16px;gap:16px}.stg .cp .lprev .pv2{border:0}
.stg .cp .seg{justify-self:start;flex-wrap:wrap}.stg .cp .acchk{gap:4px}.stg .cp .thc{padding:12px;gap:8px}
html[data-theme=high-contrast] .stg .cp :is(.prlist li,.mblist li,.lcol,.lcol li,.lprev .pv2){border:1px solid var(--text-2)}
@media (max-width:1100px){.stg .thgrid{grid-template-columns:repeat(2,minmax(0,1fr))}.stg .lcols,.stg .lprev{grid-template-columns:1fr}}`;

const view = (d) => html`${look(d)}${layouts(d)}${macroButtons(d)}${cssBox(d)}${workspace(d)}`;

export const appearance = {
  async load() {
    const [tokens, macros, sections] = await Promise.all([api.get("/ui"), api.get("/macros"), api.get("/workspace/sections").catch(() => [])]);
    return { tokens, ui: tokens.ui, macros, sections, css: tokens.ui.customCss, cssOk: true, cssMsg: "", editing: null, confirm: null, newName: "", ws: { ex: new Set(sections), file: null, fileName: "", im: new Set(), mode: "merge", result: null, err: "", stale: false } };
  },
  render: (ctx, d) => html`<div data-box class="cp">${view(d)}</div>`,
  bind(root, ctx, d) {
    if (!document.getElementById("appearance-css")) { const s = document.createElement("style"); s.id = "appearance-css"; s.textContent = CSS; document.head.append(s); }
    const box = root.querySelector("[data-box]");
    const paint = (fk) => {
      const ae = document.activeElement, key = fk ?? ae?.dataset?.fk, top = window.scrollY;
      box.innerHTML = view(d).s; window.scrollTo(0, top);
      const t = key && [...box.querySelectorAll("[data-fk]")].find((x) => x.dataset.fk === key && !x.disabled); if (t) t.focus({ preventScroll: true });
    };
    const take = (r) => { d.tokens = r; d.ui = r.ui; if (d.css === undefined) d.css = r.ui.customCss; applyTokens(r); };
    const save = async (patch, msg) => { try { take(await api.put("/ui", patch)); if (msg) toast(msg); } catch (e) { fail(e); } };
    const layout = async (id, body) => { try { take(await api.put(`/ui/layouts/${id}`, body)); } catch (e) { fail(e); } };
    const mbSave = (mb, fk) => save({ macroButtons: mb }).then(() => paint(fk));
    const P = () => presetOf(d);
    let cssTimer = 0, cssSeq = 0;
    const checkCss = () => {
      d.cssOk = null; clearTimeout(cssTimer);
      cssTimer = setTimeout(async () => { const mine = ++cssSeq; try { const r = await api.post("/ui/check-css", { css: d.css }); if (mine !== cssSeq) return; d.cssOk = r.ok; d.cssMsg = r.message ?? ""; const s = box.querySelector("#css-s"); if (s) s.innerHTML = cssMsg(d).s; const b = box.querySelector('[data-act="csssave"]'); if (b) b.disabled = !(d.css !== d.ui.customCss && d.cssOk); } catch {} }, 300);
    };
    const stale = () => { if (d.ws.result?.dryRun) d.ws.stale = true; };
    const click = async (el) => {
      const a = el.dataset.act, v = el.dataset.v, c = el.dataset.c, i = +el.dataset.i, p = P();
      try {
        if (a === "theme") await save({ theme: v }), paint(`fk-th-${v}`);
        else if (a === "accent") await save({ accent: v }), paint(`fk-ac-${v || "default"}`);
        else if (a === "density") await save({ density: v }), paint(`fk-density-${v}`);
        else if (a === "motion") await save({ reducedMotion: v }), paint(`fk-motion-${v}`);
        else if (a === "scale100") await save({ textScale: 1 }), paint();
        else if (a === "csssave") { await save({ customCss: d.css }, "Custom CSS saved."); paint(); }
        else if (a === "cssrevert") { d.css = d.ui.customCss; d.cssOk = true; paint("fk-none"); }
        else if (a === "cssclear") { d.css = ""; await save({ customCss: "" }, "Custom CSS removed."); d.cssOk = true; paint(); }
        else if (a === "pedit") { d.editing = el.dataset.id; d.confirm = null; paint(); }
        else if (a === "puse") { take(await api.post(`/ui/layouts/${el.dataset.id}/activate`)); toast("Layout in use. Open the Live console to see it."); paint(); }
        else if (a === "pnew") { const name = d.newName.trim(); if (!name) { box.querySelector("[data-lerr]").textContent = "Give the new layout a name."; return; } const r = await api.post("/ui/layouts", { name, from: p.id }); take(r); d.editing = r.id; d.newName = ""; toast(`Layout "${name}" created.`); paint(); }
        else if (a === "askdel") { d.confirm = p.id; paint("fk-pdel"); } else if (a === "keep") { d.confirm = null; paint(); }
        else if (a === "pdel") { take(await api.del(`/ui/layouts/${p.id}`)); d.editing = null; d.confirm = null; toast("Layout deleted."); paint(); }
        else if (a === "preset-reset") { if (confirm(`Put "${p.name}" back to the default arrangement?`)) { take(await api.post(`/ui/layouts/${p.id}/reset`)); toast("Layout reset."); paint(); } }
        else if (a === "pup" || a === "pdown") { const col = [...p.columns[c]], j = a === "pup" ? i - 1 : i + 1; [col[i], col[j]] = [col[j], col[i]]; const id = col[j]; await layout(p.id, { columns: { ...p.columns, [c]: col } }); paint(`fk-${a}-${id}`); }
        else if (a === "pmove") { const id = p.columns[c][i], to = el.dataset.to; await layout(p.id, { columns: { ...p.columns, [c]: p.columns[c].filter((x) => x !== id), [to]: [...p.columns[to], id] } }); paint(`fk-${to === "left" || (c === "right" && to === "center") ? "pl" : "pr"}-${id}`); }
        else if (a === "phide") { const id = p.columns[c][i]; await layout(p.id, { columns: { ...p.columns, [c]: p.columns[c].filter((x) => x !== id) }, hidden: [...p.hidden, id] }); paint(`fk-ps-${id}-${c}`); }
        else if (a === "pshow") { const id = v ?? el.dataset.id, to = el.dataset.to; await layout(p.id, { columns: { ...p.columns, [to]: [...p.columns[to], id] }, hidden: p.hidden.filter((x) => x !== id) }); paint(`fk-ph-${id}`); }
        else if (a === "mbup" || a === "mbdown") { const mb = [...d.ui.macroButtons], j = a === "mbup" ? i - 1 : i + 1; [mb[i], mb[j]] = [mb[j], mb[i]]; await mbSave(mb, `fk-${a}-${j}`); }
        else if (a === "mbdel") { await mbSave(d.ui.macroButtons.filter((_, k) => k !== i), "fk-none"); }
        else if (a === "mbcolorreset") { const mb = d.ui.macroButtons.map((b, k) => { if (k !== i) return b; const { color, ...r } = b; return r; }); await mbSave(mb); }
        else if (a === "wmode") { d.ws.mode = v; stale(); paint(`fk-wm-${v}`); }
        else if (a === "wcheck") await runImport(true);
        else if (a === "wapply") {
          if (d.ws.mode === "replace" && !confirm("Replace removes anything in the chosen sections that is not in the file. Continue?")) return;
          await runImport(false);
        }
      } catch (e) { fail(e); }
    };
    async function runImport(dry) {
      const w = d.ws; w.err = "";
      try {
        const r = await api.post("/workspace/import", { workspace: w.file, mode: w.mode, dryRun: dry, sections: [...w.im] });
        w.result = r; w.stale = false;
        if (!dry) { toast(r.applied ? "Imported. Re-enter any passwords, keys and header values." : "Nothing was imported."); const u = await api.get("/ui"); take(u); d.macros = await api.get("/macros"); }
      } catch (e) { w.result = null; w.err = e.message; }
      paint(dry ? "fk-wapply" : "fk-wcheck");
    }
    const acts = delegate(box, "click", "act", { theme: click, accent: click, density: click, motion: click, scale100: click, csssave: click, cssrevert: click, cssclear: click, pedit: click, puse: click, pnew: click, askdel: click, keep: click, pdel: click, "preset-reset": click, pup: click, pdown: click, pmove: click, phide: click, pshow: click, mbup: click, mbdown: click, mbdel: click, mbcolorreset: click, wmode: click, wcheck: click, wapply: click });
    let accentT = 0, scaleT = 0;
    const onInput = async (e) => {
      const el = e.target, k = el.dataset.in; if (!k) return;
      if (k === "accent") { clearTimeout(accentT); accentT = setTimeout(async () => { await save({ accent: el.value.toUpperCase() }); const ac = box.querySelector(".acchk"); if (ac) paint(); }, 250); }
      else if (k === "scale") { d.ui.textScale = +el.value; clearTimeout(scaleT); scaleT = setTimeout(() => save({ textScale: +el.value }).then(() => paint()), 250); box.querySelector("[data-fk=fk-scale]")?.setAttribute("aria-valuetext", Math.round(+el.value * 100) + " percent"); }
      else if (k === "css") { d.css = el.value; checkCss(); const n = box.querySelector("[data-count]"); if (n) n.textContent = `${d.css.length} of 8000 characters`; const s = box.querySelector("#css-s"); if (s) s.innerHTML = cssMsg(d).s; const b = box.querySelector('[data-act="csssave"]'); if (b) b.disabled = true; }
      else if (k === "newname") d.newName = el.value;
    };
    const onChange = async (e) => {
      const el = e.target, k = el.dataset.in; if (!k) return; const p = P();
      try {
        if (k === "rename") { const n = el.value.trim(); if (n && n !== p.name) { await layout(el.dataset.id, { name: n }); toast("Layout renamed."); paint(); } }
        else if (k === "mbcolor") { const mb = d.ui.macroButtons.map((b, j) => (j === +el.dataset.i ? { ...b, color: el.value.toUpperCase() } : b)); await mbSave(mb); }
        else if (k === "mbsize") { const mb = d.ui.macroButtons.map((b, j) => (j === +el.dataset.i ? { ...b, size: el.value } : b)); await mbSave(mb); }
        else if (k === "mbadd" && el.value) await mbSave([...d.ui.macroButtons, { macroId: el.value }], "fk-none");
        else if (k === "exsec") { el.checked ? d.ws.ex.add(el.dataset.n) : d.ws.ex.delete(el.dataset.n); paint(); }
        else if (k === "imsec") { el.checked ? d.ws.im.add(el.dataset.n) : d.ws.im.delete(el.dataset.n); stale(); paint(); }
        else if (k === "file") {
          const f = el.files?.[0]; const w = d.ws; w.result = null; w.err = ""; w.file = null; if (!f) { paint(); return; }
          if (f.size > 8e6) { w.err = "That file is too big to be a workspace file."; paint(); return; }
          try { const doc = JSON.parse(await f.text()); if (doc?.format !== "fieldhouse-workspace" || typeof doc.sections !== "object") throw 0; w.file = doc; w.fileName = f.name; w.im = new Set(Object.keys(doc.sections)); } catch { w.err = "That is not a Fieldhouse workspace file. Pick a file made with Download workspace file."; }
          paint("fk-wcheck");
        }
      } catch (x) { fail(x); }
    };
    box.addEventListener("input", onInput); box.addEventListener("change", onChange);
    return all(acts, () => { box.removeEventListener("input", onInput); box.removeEventListener("change", onChange); clearTimeout(cssTimer); clearTimeout(accentT); clearTimeout(scaleT); });
  },
};
