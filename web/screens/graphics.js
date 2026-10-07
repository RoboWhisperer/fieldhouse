// Graphics Studio: #/graphics (library + connectors), #/graphics?edit=<id> (editor), #/graphics?import=1 (import wizard),
// #/graphics?tab=connectors[&c=<id|new>][&remote=1]. This file holds the page frame, the live on-air strip and the library; the rest lives in graphics-*.js.
import { html, raw, icon, api, S, toast, fail, go } from "../app.js";
import { ROLE_LABEL, KIND_LABEL, slugName } from "./graphics-lib.js";
import { STUDIO_CSS, openDialog, confirmDialog, pill, sw } from "./graphics-ui.js";
import { PREVIEW_CSS, mountPreview, lazyPreviews } from "./graphics-preview.js";
import editor, { EDITOR_CSS } from "./graphics-editor.js";
import wizard from "./graphics-import.js";
import connectors from "./graphics-connectors.js";

const viewOf = (q) => (q.edit ? editor : q.import ? wizard : q.tab === "connectors" ? connectors : library);
const KEEP_ON = (d) => d?.show?.mode === "always" || d?.show?.mode === "while-live";
const airItems = () => (S.state?.graphics?.items || []).filter((i) => i.phase === "on");
const isOn = (id) => airItems().some((i) => i.id === id);

// ---------------------------------------------------------------- on-air strip
function strip(docs) {
  const on = airItems(), byId = Object.fromEntries(docs.map((d) => [d.id, d]));
  return html`<div class="gx-air ${on.length ? "on" : ""}" role="region" aria-label="On air now">
    <span class="lbl">${on.length ? html`${pill("live", "On air")}` : "On air"}</span>
    ${on.length ? on.map((i) => html`<span class="it"><b>${i.name}</b>${KEEP_ON(byId[i.id]) ? html`<span class="hint">always on</span>` : html`<button type="button" class="btn sm" data-hide="${i.id}" aria-label="Hide ${i.name}">${icon("x", "sm")}Hide</button>`}</span>`) : html`<span class="muted">Nothing is on the stream right now.</span>`}
    <span class="sp"></span>
    <button type="button" class="btn sm" data-act="clear" ${on.some((i) => !KEEP_ON(byId[i.id])) ? "" : "disabled"}>${icon("x")}Clear all graphics</button>
  </div>`;
}
const sig = () => airItems().map((i) => i.id).join(",");

// ---------------------------------------------------------------- library
function card(d) {
  const on = isOn(d.id), keep = KEEP_ON(d), builtin = d.kind === "builtin";
  const thumb = d.kind === "url" || d.kind === "remote";
  return html`<article class="gx-card ${on ? "air" : ""} ${d.enabled ? "" : "off"}" data-card="${d.id}" aria-label="${d.name}">
    <div class="gx-stage" ${thumb ? "" : raw(`data-thumb data-id="${d.id}"`)}>${thumb ? html`<div class="gx-ph">${icon(d.kind === "url" ? "link" : "bolt", "lg")}<b>${KIND_LABEL[d.kind]}</b><span>${d.kind === "url" ? d.source?.url : d.source?.outputUrl || "Drawn by another system"}</span><span>Preview opens in the editor.</span></div>` : ""}</div>
    <div class="gx-cb">
      <div class="row"><h3 class="gx-name" title="${d.name}">${d.name}</h3><span class="sp"></span><span data-air="${d.id}">${airPill(on)}</span></div>
      <div class="gx-meta"><span>${ROLE_LABEL[d.role] || d.role}</span><span class="dotsep" aria-hidden="true">·</span><span>${KIND_LABEL[d.kind] || d.kind}</span>${d.requiresGame ? html`<span class="dotsep" aria-hidden="true">·</span><span>Needs a game</span>` : ""}${d.modified ? pill("check", "Changed") : ""}</div>
      <p class="desc">${d.description || (d.kind === "caspar" ? "A CasparCG template." : d.kind === "html" ? "A custom page you made or imported." : "")}</p>
      <div class="gx-cf"><div class="r">${sw(d.enabled, "enable", `Switched on: ${d.name}`, `data-id="${d.id}"`)}<span class="lab">${d.enabled ? "Switched on" : "Switched off"}</span>
        <a class="btn sm" href="#/graphics?edit=${encodeURIComponent(d.id)}">${icon("sliders", "sm")}Edit</a>
        ${keep ? html`<span class="hint">${d.show.mode === "always" ? "Always on" : "On while live"}</span>` : html`<span data-ctl="${d.id}">${ctl(d, on)}</span>`}</div>
      <div class="gx-acts">
        <button type="button" class="btn sm ghost" data-act="dup" data-id="${d.id}">${icon("plus", "sm")}Duplicate</button>
        <a class="btn sm ghost" href="/api/graphics/${encodeURIComponent(d.id)}/export" download>${icon("down2", "sm")}Export</a>
        ${builtin ? html`<button type="button" class="btn sm ghost del" data-act="reset" data-id="${d.id}" aria-label="Reset ${d.name} to default" ${d.modified ? "" : "disabled"} title="${d.modified ? "Go back to the design Fieldhouse shipped" : "Already the shipped design"}">${icon("undo", "sm")}Reset</button>` : html`<button type="button" class="btn sm ghost del" data-act="del" data-id="${d.id}">${icon("x", "sm")}Delete</button>`}
      </div></div></div></article>`;
}
const airPill = (on) => (on ? pill("live", "On air") : pill("off", "Off air"));
const ctl = (d, on) => html`<button type="button" class="btn sm ${on ? "" : "pri"}" data-act="${on ? "hide" : "show"}" data-id="${d.id}" ${d.enabled ? "" : "disabled"} title="${d.enabled ? "" : "Switch it on first"}">${icon(on ? "x" : "play", "sm")}${on ? "Hide" : "Show"}</button>`;

const library = {
  async load() { return { docs: await api.get("/graphics"), vars: await api.get("/graphics/sample-vars") }; },
  render(ctx, { docs }) {
    const mine = docs.filter((d) => d.kind !== "builtin"), built = docs.filter((d) => d.kind === "builtin");
    return html`
      <div class="gx-secs"><div class="gx-sech"><h2>Your graphics</h2><span class="faint">${mine.length ? mine.length + " added" : ""}</span></div>
      ${mine.length ? html`<div class="gx-grid">${mine.map(card)}</div>` : html`<div class="panel"><div class="empty"><span class="gx-ic">${icon("film", "lg")}</span><b>You have not added any graphics yet</b><span>Start from a copy of a built-in, import one you downloaded, or try an example.</span><span class="row" style="justify-content:center"><button type="button" class="btn pri" data-act="new">${icon("plus")}New graphic</button><a class="btn" href="#/graphics?import=1">${icon("up2")}Import or try an example</a></span></div></div>`}</div>
      <div class="gx-secs"><div class="gx-sech"><h2>Built-in graphics</h2><span class="muted">These come with Fieldhouse. Change them with Edit, put them back with Reset to default.</span></div>
      <div class="gx-grid">${built.map(card)}</div></div>`;
  },
  bind(root, ctx, data) {
    const lz = lazyPreviews(root, (el) => { const d = data.docs.find((x) => x.id === el.dataset.id); return d ? mountPreview(el, { docs: [d], vars: data.vars }) : null; });
    const act = async (e) => {
      const b = e.target.closest("[data-act]"); if (!b) return;
      const id = b.dataset.id, d = data.docs.find((x) => x.id === id), a = b.dataset.act;
      try {
        if (a === "show" || a === "hide") { await api.post(`/graphics/${id}/${a}`); }
        else if (a === "enable") { await api.put(`/graphics/${id}`, { enabled: !d.enabled }); ctx.rerender(); }
        else if (a === "dup") { const n = await api.post(`/graphics/${id}/duplicate`, {}); toast(`Made a copy: ${n.name}.`); ctx.rerender(); }
        else if (a === "reset") { if (await confirmDialog("Reset to default?", `${d.name} goes back to the design Fieldhouse shipped. Your colors, size, place and animation changes are lost.`, "Reset", { danger: true })) { await api.post(`/graphics/${id}/reset`); toast("Back to the default design."); ctx.rerender(); } }
        else if (a === "del") { if (await confirmDialog(`Delete ${d.name}?`, "The graphic and its files are removed from this computer. You can export it first to keep a copy.", "Delete", { danger: true })) { await api.del(`/graphics/${id}`); toast("Deleted."); ctx.rerender(); } }
        else if (a === "new") newDialog(ctx, data);
      } catch (err) { fail(err); }
    };
    root.addEventListener("click", act);
    return () => { root.removeEventListener("click", act); lz.stop(); };
  },
  onState(root, st, ctx, data) {
    for (const d of data.docs) {
      const on = isOn(d.id);
      const a = root.querySelector(`[data-air="${CSS.escape(d.id)}"]`); if (a && a.dataset.on !== String(on)) { a.dataset.on = String(on); a.innerHTML = airPill(on).s; }
      const c = root.querySelector(`[data-ctl="${CSS.escape(d.id)}"]`); if (c && c.dataset.on !== String(on)) { c.dataset.on = String(on); c.innerHTML = ctl(d, on).s; }
      root.querySelector(`[data-card="${CSS.escape(d.id)}"]`)?.classList.toggle("air", on);
    }
  },
};

function newDialog(ctx, data) {
  const builtins = data.docs.filter((d) => d.kind === "builtin");
  const d = openDialog("New graphic", html`
    <div class="gx-pick" role="radiogroup" aria-label="Start from">
      ${[["blank", "A blank custom page", "A starter web page you can edit. Good if you know a little HTML."], ["copy", "A copy of a built-in graphic", "Start from the score bug, lower third and so on, then change it."], ["import", "Import a file or try an example", "A .html, .zip or .fhgfx file, or one of the CasparCG examples."], ["url", "A web overlay by its address", "For example the output page of an online overlay service."], ["remote", "A remote graphic", "Controlled from Fieldhouse but drawn by Singular, CasparCG or another system."]].map(([v, t, h], i) => html`<label><input type="radio" name="how" value="${v}" ${i === 0 ? "checked" : ""}><b>${t}</b><span class="hint">${h}</span></label>`)}
    </div>
    <div class="field" data-for="blank copy"><label for="gx-nn">Name</label><input class="input" id="gx-nn" maxlength="60" placeholder="My graphic" autocomplete="off"></div>
    <div class="field hidden" data-for="copy"><label for="gx-cp">Copy of</label><select class="input" id="gx-cp">${builtins.map((b) => html`<option value="${b.id}">${b.name}</option>`)}</select></div>
    <div class="gx-ft"><button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn pri" data-go>Continue</button></div>`);
  const how = () => d.el.querySelector("input[name=how]:checked").value;
  const sync = () => d.el.querySelectorAll("[data-for]").forEach((f) => f.classList.toggle("hidden", !f.dataset.for.split(" ").includes(how())));
  d.el.addEventListener("change", sync);
  d.el.querySelector("[data-go]").onclick = async () => {
    const h = how(), name = slugName(d.el.querySelector("#gx-nn").value);
    try {
      if (h === "blank") { const n = await api.post("/graphics/create", { kind: "html", name: name || "My graphic", role: "other" }); d.close(); go(`/graphics?edit=${encodeURIComponent(n.id)}`); }
      else if (h === "copy") { const n = await api.post(`/graphics/${d.el.querySelector("#gx-cp").value}/duplicate`, name ? { name } : {}); d.close(); go(`/graphics?edit=${encodeURIComponent(n.id)}`); }
      else if (h === "import") { d.close(); go("/graphics?import=1"); }
      else if (h === "url") { d.close(); go("/graphics?import=1&url=1"); }
      else { d.close(); go("/graphics?tab=connectors&remote=1"); }
    } catch (e) { fail(e); }
  };
}

// ---------------------------------------------------------------- the screen
let lastKey = "";
export default {
  shell: "manage", nav: "graphics",
  css: STUDIO_CSS + PREVIEW_CSS + EDITOR_CSS,
  async load(ctx) {
    const sub = viewOf(ctx.query), [docs, d] = await Promise.all([api.get("/graphics"), sub.load ? sub.load(ctx) : null]);
    return { sub, docs: sub === library ? d.docs : docs, d };
  },
  render(ctx, data) {
    const { sub } = data, q = ctx.query, top = sub === library || (sub === connectors && !q.c && !q.remote);
    return html`<div class="gx">
      ${top ? html`<div class="gx-top"><div class="gx-head"><div><h1>Graphics</h1><p class="sub">Everything that can appear on top of your video: scores, names, tickers, sponsor cards and graphics from other systems. Pick one to change how it looks or where it sits.</p></div><span class="sp"></span><button type="button" class="btn pri" data-act="new">${icon("plus")}New graphic</button></div>
        <nav class="gx-tabs" aria-label="Graphics sections"><a href="#/graphics" ${sub === library ? raw('aria-current="page"') : ""}>Library</a><a href="#/graphics?tab=connectors" ${sub === connectors ? raw('aria-current="page"') : ""}>Connectors</a></nav></div>` : ""}
      <div id="gx-strip">${strip(data.docs)}</div>
      <div id="gx-view">${sub.render(ctx, data.d)}</div></div>`;
  },
  bind(root, ctx, data) {
    const { sub, docs } = data;
    const key = JSON.stringify(ctx.query); if (key !== lastKey) { lastKey = key; root.scrollTop = 0; } // a different view starts at the top; a redraw keeps its place
    const v = root.querySelector("#gx-view");
    const clicks = async (e) => {
      const h = e.target.closest("[data-hide]"), c = e.target.closest('#gx-strip [data-act="clear"]');
      try {
        if (h) await api.post(`/graphics/${h.dataset.hide}/hide`);
        else if (c) { await api.post("/graphics/clear"); toast("Everything is off air."); }
        else if (e.target.closest('.gx-head [data-act="new"]')) newDialog(ctx, { docs });
      } catch (err) { fail(err); }
    };
    root.addEventListener("click", clicks);
    const un = sub.bind?.(v, ctx, data.d);
    return () => { root.removeEventListener("click", clicks); un?.(); };
  },
  onState(root, st, ctx, data) {
    const s = sig(), el = root.querySelector("#gx-strip");
    if (el && el.dataset.sig !== s) { el.dataset.sig = s; el.innerHTML = strip(data.docs).s; }
    data.sub.onState?.(root.querySelector("#gx-view"), st, ctx, data.d);
  },
};
