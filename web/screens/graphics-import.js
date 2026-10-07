// Import wizard: #/graphics?import=1. Choose files (or an example, or a web address) -> see what Fieldhouse found -> match the values -> name and place -> add.
// Two API steps: POST /graphics/import (nothing is stored) then POST /graphics/import/commit { token, ... }.
import { html, raw, icon, api, toast, fail, go, fmtBytes } from "../app.js";
import { ROLE_LABEL, ROLE_HELP, ANCHORS, ANCHOR_LABEL, slugName } from "./graphics-lib.js";
import { text, num, sel, chk, pill, sec, bindForm } from "./graphics-ui.js";
import { fieldsEditor, bindFieldButtons } from "./graphics-fields.js";

const FN = [["play", "Knows when to appear", "play()"], ["stop", "Knows when to leave", "stop()"], ["update", "Can receive new values", "update()"], ["next", "Has a second step", "next()"]];
const STEPS = ["Choose", "Check", "Match values", "Name and place"];
const FOUND = { "element id": "an element named like it", "json key": "a JSON key", componentData: "CasparCG data", "data-fh-bind": "a Fieldhouse binding" };
const fresh = () => ({ step: 0, token: "", res: null, busy: false, err: "", fields: [], kind: "caspar", entry: "", dataFormat: "json", allowNetwork: false, width: 1920, height: 1080, name: "", role: "other", requiresGame: false, placement: { anchor: "top-left", x: 0, y: 0, scale: 1, z: 30, opacity: 1 }, url: { name: "", url: "", width: 1920, height: 1080, role: "other" } });

async function upload(files) {
  const fd = new FormData();
  for (const f of files) fd.append("file", f, f.webkitRelativePath || f.name);
  const r = await fetch("/api/graphics/import", { method: "POST", body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `The upload failed (${r.status}).`);
  return j;
}

const stepper = (w) => html`<ol class="gx-steps" aria-label="Steps">${STEPS.map((s, i) => html`<li ${i === w.step ? raw('aria-current="step"') : ""} class="${i < w.step ? "done" : ""}"><b>${i < w.step ? icon("check", "sm") : i + 1}</b>${s}</li>`)}</ol>`;
const errBox = (w) => (w.err ? html`<div class="banner err" role="alert">${icon("alert", "lg")}<div><b>That did not work.</b> <span class="muted">${w.err}</span></div></div>` : "");

function startHtml(w, d) {
  return html`${errBox(w)}
    ${sec("Add files", html`<div class="gx-drop" data-drop><span class="gx-ic">${icon("up2", "lg")}</span><b>Drop files here</b>
        <span>A .html file, a .zip of a template folder, a .fhgfx pack exported from Fieldhouse, or a page together with its images and fonts.</span>
        <div class="row" style="flex-wrap:wrap;justify-content:center"><button type="button" class="btn pri" data-pick="files" ${w.busy ? "disabled" : ""}>${icon("folder")}${w.busy ? "Checking..." : "Choose files"}</button><button type="button" class="btn ghost" data-pick="dir" ${w.busy ? "disabled" : ""}>Choose a folder</button></div>
        <input type="file" multiple hidden data-in="files" aria-label="Choose files to import"><input type="file" hidden webkitdirectory data-in="dir" aria-label="Choose a folder to import"></div>
      <p class="hint">Nothing is saved yet. Next you see what Fieldhouse found and can change it. Files stay on this computer.</p>`)}
    ${sec("Or try an example", html`<p class="muted">Small CasparCG-style templates to try and to copy from. Adding one makes a graphic you can edit.</p>
      ${d.examples.length ? html`<div class="gx-stack" style="gap:8px">${d.examples.map((x) => html`<div class="gx-fld gx-ex"><div><b>${x.title}</b><p class="hint">${x.description}</p></div>${pill("info", ROLE_LABEL[x.role])}<button type="button" class="btn sm" data-ex="${x.id}">${icon("plus", "sm")}Add this example</button></div>`)}</div>` : html`<p class="muted">No examples are available.</p>`}`)}
    ${sec("Or add a web overlay by its address", html`<p class="muted">For an overlay that lives on a web page, such as the output page of an online graphics service. OBS loads the page and draws it over your video, so it needs internet while you broadcast.</p>
      <div class="gx-g2">${text("url.name", w.url.name, "Name", { max: 60, ph: "Sponsor ticker" })}${text("url.url", w.url.url, "Address (URL)", { mono: true, ph: "https://" })}</div>
      <div class="gx-g3">${num("url.width", w.url.width, "Page width", { min: 16, max: 7680 })}${num("url.height", w.url.height, "Page height", { min: 16, max: 4320 })}${sel("url.role", w.url.role, "What kind of graphic is it", Object.entries(ROLE_LABEL))}</div>
      <div><button type="button" class="btn" data-act="addurl" ${w.busy ? "disabled" : ""}>${icon("plus")}Add web overlay</button></div>`)}`;
}

function checkHtml(w) {
  const r = w.res, a = r.analysis;
  if (r.kind === "pack") { const g = r.graphic; return html`${sec("What is in the pack", html`<div class="banner ok">${icon("check", "lg")}<div><b>${g.name}</b> <span class="muted">is a ${ROLE_LABEL[g.role] || g.role} (${g.kind}) with ${g.fields.length} field${g.fields.length === 1 ? "" : "s"} and ${r.files.length} file${r.files.length === 1 ? "" : "s"}.</span></div></div>
      <p class="muted">A pack made by Fieldhouse already has its values, place and animation set. You can still rename it on the next step.</p>${filesHtml(r)}`)}`; }
  return html`${sec("What Fieldhouse found", html`
    <ul class="gx-list">${FN.map(([k, label, code]) => html`<li>${a.functions[k] ? icon("check", "gx-ok") : icon("minus", "faint")}<span><b>${label}</b> <span class="muted">(${code}) ${a.functions[k] ? "found" : k === "play" || k === "update" ? "not found" : "not used"}</span></span></li>`)}
      <li>${icon("info", "faint")}<span><b>Main file:</b> <span class="mono">${a.entry}</span>, <span class="muted">${a.width} by ${a.height} pixels, data as ${a.dataFormat.toUpperCase()}</span></span></li>
      <li>${a.fields.length ? icon("check", "gx-ok") : icon("minus", "faint")}<span><b>${a.fields.length} value${a.fields.length === 1 ? "" : "s"} to fill in</b> ${a.fields.length ? html`<span class="muted">${a.fields.map((f) => f.id).join(", ")}</span>` : html`<span class="muted">The page does not seem to take data. It will be shown as it is.</span>`}</span></li></ul>
    ${a.warnings.length ? html`<div class="banner warn">${icon("alert", "lg")}<div><b>Things to know</b><ul class="gx-list" style="margin-top:8px">${a.warnings.map((m) => html`<li><span>${m}</span></li>`)}</ul></div></div>` : html`<div class="banner ok">${icon("check", "lg")}<span>Nothing looks wrong.</span></div>`}
    ${a.needsNetwork ? html`<div class="banner warn">${icon("alert", "lg")}<div><b>This page asks for things from the internet.</b> <span class="muted">By default Fieldhouse blocks that. You can allow it on the last step. Without it the page may look incomplete.</span></div></div>` : ""}`)}
    ${sec("How to treat it", html`<div class="gx-pick" role="radiogroup" aria-label="Kind of graphic">
        <label><input type="radio" name="kind" value="caspar" ${w.kind === "caspar" ? "checked" : ""} data-p="kind"><b>CasparCG template</b><span class="hint">Fieldhouse calls play, stop and update the way CasparCG does. Choose this for templates made for CasparCG.</span></label>
        <label><input type="radio" name="kind" value="html" ${w.kind === "html" ? "checked" : ""} data-p="kind"><b>Custom page</b><span class="hint">An ordinary page. It can read live game values with data-fh-bind (see the authoring guide).</span></label></div>
      ${a.entries.length > 1 ? sel("entry", w.entry, "Main file", a.entries.map((e) => [e, e]), { hint: "More than one page was found. Pick the one to open." }) : ""}`)}
    ${sec(`Files (${r.files.length})`, filesHtml(r))}`;
}
const filesHtml = (r) => html`<table class="gx-tbl"><thead><tr><th scope="col">File</th><th scope="col">Type</th><th scope="col">Size</th></tr></thead><tbody>${r.files.map((f) => html`<tr><td class="mono">${f.path}</td><td>${f.type}</td><td>${fmtBytes(f.bytes)}</td></tr>`)}</tbody></table>
  ${r.skipped?.length ? html`<div class="banner warn" style="margin-top:16px">${icon("alert", "lg")}<div><b>${r.skipped.length} file${r.skipped.length === 1 ? " was" : "s were"} left out</b><ul class="gx-list" style="margin-top:8px">${r.skipped.map((s) => html`<li><span><span class="mono">${s.path}</span> <span class="muted">${s.why}</span></span></li>`)}</ul></div></div>` : ""}`;

function mapHtml(w, d) {
  const a = w.res.analysis;
  return html`${sec("Match the values", html`<p class="muted">The page expects these values. For each, choose where it should come from: the live game (scores, names, clock), fixed text, or something you type when you show it.</p>
    ${a.fields.length ? html`<p class="hint">Fieldhouse guessed from the names. Check each one.</p>` : ""}
    <div data-fields>${fieldsEditor(w.fields, { prefix: "fields", vars: d.vars })}</div>`)}
    ${w.kind === "caspar" ? sec("Data format", html`${sel("dataFormat", w.dataFormat, "How the template wants its data", [["json", "JSON"], ["xml", "XML"]], { hint: w.dataFormat === a.dataFormat ? `Fieldhouse found ${a.dataFormat.toUpperCase()} in the template. Older Flash-style templates use XML; newer HTML templates often use JSON.` : "Fieldhouse found " + a.dataFormat.toUpperCase() + " in the template. Change this only if you know it is wrong." })}`) : ""}`;
}

function nameHtml(w) {
  const p = w.placement, a = w.res.analysis;
  return sec("Name it and place it", html`
    <div class="gx-g2">${text("name", w.name, "Name", { max: 60 })}${sel("role", w.role, "What kind of graphic is it", Object.entries(ROLE_LABEL).map(([k, v]) => [k, `${v} - ${ROLE_HELP[k]}`]))}</div>
    ${w.res.kind === "pack" ? html`<p class="muted">The pack keeps its own place and animation.</p>` : html`<div class="gx-g3">${sel("placement.anchor", p.anchor, "Anchored to", ANCHORS.map((x) => [x, ANCHOR_LABEL[x]]))}${num("placement.x", p.x, "Across (pixels)", { min: -4000, max: 4000 })}${num("placement.y", p.y, "Down (pixels)", { min: -4000, max: 4000 })}</div>
      <p class="hint">You can fine-tune this in the editor, where you can drag the graphic on a preview.</p>
      ${chk("requiresGame", w.requiresGame, "Only while a game is active")}
      ${a?.needsNetwork ? chk("allowNetwork", w.allowNetwork, "Allow it to load things from the internet", "The page asked for online files. Leave off unless it looks broken without them.") : ""}`}`);
}

export default {
  async load() { const [examples, vars] = await Promise.all([api.get("/graphics/examples"), api.get("/graphics/sample-vars")]); return { examples, vars }; },
  render(ctx, d) { return html`<div class="gx-head gx-w"><div><h1>Add a graphic</h1><p class="sub">Bring in a graphic someone made, or try an example. You check everything before it is added.</p></div><span class="sp"></span><a class="btn ghost" href="#/graphics">Cancel</a></div><div class="gx-stack gx-w" data-wz></div>`; },
  bind(root, ctx, d) {
    const w = fresh(), box = root.querySelector("[data-wz]"), un = [];
    const paint = () => {
      const w2 = w, body = w2.step === 0 ? startHtml(w2, d) : w2.step === 1 ? checkHtml(w2) : w2.step === 2 ? mapHtml(w2, d) : nameHtml(w2);
      const last = w2.step === 3, skipMap = w2.res?.kind === "pack";
      box.innerHTML = html`${w2.step ? stepper(w2) : ""}${w2.step ? errBox(w2) : ""}${body}
        ${w2.step ? html`<div class="gx-ft"><button type="button" class="btn ghost gx-l" data-act="back">${icon("left")}Back</button><button type="button" class="btn pri" data-act="${last || (skipMap && w2.step === 1) ? (last ? "commit" : "next") : "next"}" ${w2.busy ? "disabled" : ""}>${last ? html`${icon("check")}Add graphic` : html`Next${icon("right")}`}</button></div>` : ""}`.s;
    };
    un.push(bindForm(box, w, { onRedraw: (p) => { if (p === "kind" && w.kind === "html") w.dataFormat = w.dataFormat; paint(); } }));
    un.push(bindFieldButtons(box, () => w.fields, paint));
    const stage = async (files) => {
      if (!files.length) return; w.busy = true; w.err = ""; paint();
      try {
        const r = await upload([...files]); w.res = r; w.token = r.token; w.name = r.name || ""; w.busy = false; w.step = 1;
        if (r.kind === "pack") { w.role = r.graphic.role; }
        else { const a = r.analysis; w.entry = a.entry; w.dataFormat = a.dataFormat; w.width = a.width; w.height = a.height; w.allowNetwork = a.needsNetwork; w.kind = a.functions.play || a.functions.update || a.functions.stop ? "caspar" : "html"; w.fields = a.fields.map((f) => ({ name: f.id, label: f.id, type: "text", default: "", binding: f.suggestion ? { ...f.suggestion } : { kind: "manual", value: "" } })); }
      } catch (e) { w.busy = false; w.err = e.message; w.step = 0; }
      paint();
    };
    const click = async (e) => {
      const t = e.target;
      const pick = t.closest("[data-pick]")?.dataset.pick; if (pick) return box.querySelector(`[data-in="${pick}"]`).click();
      const ex = t.closest("[data-ex]")?.dataset.ex;
      if (ex) { try { const g = await api.post(`/graphics/examples/${encodeURIComponent(ex)}/install`); toast(`Added ${g.name}.`); go(`/graphics?edit=${encodeURIComponent(g.id)}`); } catch (x) { fail(x); } return; }
      const a = t.closest("[data-act]")?.dataset.act; if (!a) return;
      if (a === "addurl") {
        const u = w.url; if (!slugName(u.name)) { w.err = "Give the overlay a name."; return paint(); } if (!/^https?:\/\/\S+$/i.test(u.url.trim())) { w.err = "The address must start with http:// or https://"; return paint(); }
        w.busy = true; w.err = ""; paint();
        try { const g = await api.post("/graphics/create", { kind: "url", name: slugName(u.name), role: u.role, source: { url: u.url.trim(), width: u.width, height: u.height, css: "" } }); toast("Web overlay added."); go(`/graphics?edit=${encodeURIComponent(g.id)}`); } catch (x) { w.busy = false; w.err = x.message; paint(); }
      }
      if (a === "back") { w.err = ""; if (w.step === 1) { w.step = 0; w.res = null; } else w.step = w.res.kind === "pack" ? 1 : w.step - 1; paint(); }
      if (a === "next") { w.err = ""; w.step = w.res.kind === "pack" ? 3 : w.step + 1; paint(); }
      if (a === "commit") {
        if (!slugName(w.name)) { w.err = "Give the graphic a name."; return paint(); }
        w.busy = true; w.err = ""; paint();
        try {
          const body = w.res.kind === "pack" ? { token: w.token, name: slugName(w.name) } : { token: w.token, name: slugName(w.name), kind: w.kind, entry: w.entry, role: w.role, fields: w.fields, dataFormat: w.dataFormat, allowNetwork: w.allowNetwork, width: w.width, height: w.height, placement: w.placement, requiresGame: w.requiresGame };
          const g = await api.post("/graphics/import/commit", body); toast(`Added ${g.name}.`); go(`/graphics?edit=${encodeURIComponent(g.id)}`);
        } catch (x) { w.busy = false; w.err = /expired|410/.test(x.message) ? "The upload expired. Choose the files again." : x.message; if (/expired/.test(w.err)) { w.step = 0; w.res = null; } paint(); }
      }
    };
    const change = (e) => { const i = e.target.closest("[data-in]"); if (i) { stage(i.files); i.value = ""; } };
    const over = (e) => { const z = e.target.closest("[data-drop]"); if (z) { e.preventDefault(); z.classList.add("over"); } };
    const leave = (e) => { e.target.closest?.("[data-drop]")?.classList.remove("over"); };
    const drop = (e) => { const z = e.target.closest("[data-drop]"); if (z) { e.preventDefault(); z.classList.remove("over"); stage(e.dataTransfer.files); } };
    box.addEventListener("click", click); box.addEventListener("change", change); box.addEventListener("dragover", over); box.addEventListener("dragleave", leave); box.addEventListener("drop", drop);
    un.push(() => { box.removeEventListener("click", click); box.removeEventListener("change", change); box.removeEventListener("dragover", over); box.removeEventListener("dragleave", leave); box.removeEventListener("drop", drop); });
    paint();
    return () => un.forEach((f) => f());
  },
};
