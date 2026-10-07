// Automation > Macros (big buttons) and Custom fields (values you change during a game).
import { html, raw, esc, icon, api, toast, fail, S, subscribe } from "../app.js";
import { lostHeaders, lookups, datalists, actionsEditor, bindDraft, repaintBox, dryView, fromApiAction, toApiActions, sw, EXAMPLES } from "./automation-lib.js";
import { macroIcon as mIcon, inkOn, refreshMacros } from "../customize.js";
const macroIcon = (n) => raw(mIcon(n));

const ICONS = ["play", "stop", "replay", "flag", "bolt", "bell", "star", "tv", "mic", "ball", "sponsor", "link", "clock", "eye", "check", "gear"];
const blank = () => ({ label: "", color: "#3D8BFD", icon: "bolt", hotkey: "", description: "", actions: [], _needs: [] });
const fromApi = (m) => ({ id: m.id, label: m.label, color: m.color, icon: m.icon, hotkey: m.hotkey ?? "", description: m.description ?? "", actions: m.actions.map(fromApiAction), _needs: [] });
const toApi = (d) => ({ label: d.label.trim(), color: d.color, icon: d.icon, hotkey: d.hotkey || "", description: d.description || "", actions: toApiActions(d.actions, !d.id) });
const keyName = (e) => { const k = e.key.length === 1 ? e.key.toUpperCase() : e.key; return [e.ctrlKey || e.metaKey ? "Ctrl" : "", e.shiftKey ? "Shift" : "", k].filter(Boolean).join("+"); };
const preview = (m, size = "") => html`<span class="mbtn pv ${size}" style="--mc:${m.color};--mi:${inkOn(m.color)}">${macroIcon(m.icon)}<span>${m.label || "Button name"}</span>${m.hotkey ? html`<kbd>${m.hotkey}</kbd>` : ""}</span>`;

function list(d) {
  const shown = new Set(d.buttons.map((b) => b.macroId));
  return html`<div class="bar-row"><p class="muted lead">A macro is a button that does several things in order. Give it a color, an icon and a keyboard key. Buttons you switch on appear on the Live console.</p><span class="sp"></span>
    ${d.macros.length ? html`<button type="button" class="btn" data-a="example">${icon("book")}Start from an example</button><button type="button" class="btn pri" data-a="new">${icon("plus")}New macro</button>` : ""}</div>
    ${d.macros.length ? html`<div class="mgrid">${d.macros.map((m) => html`<div class="panel mcard"><div class="pb stack">${preview(m, "large")}
      <div class="mmeta">${m.description ? html`<span class="muted">${m.description}</span>` : ""}<span class="faint">${m.actions.length} step${m.actions.length === 1 ? "" : "s"}</span></div>
      <label class="chk"><button type="button" class="switch ${shown.has(m.id) ? "on" : ""}" role="switch" aria-checked="${shown.has(m.id)}" aria-label="Show ${m.label} as a big button on the console" data-a="show" data-id="${m.id}" data-fk="fk-${m.id}"></button> <span>Show on the console</span></label>
      <div class="mact"><button type="button" class="btn sm" data-a="run" data-id="${m.id}" aria-label="Run ${m.label} now">${icon("play", "sm")}Run now</button><button type="button" class="btn sm" data-a="edit" data-id="${m.id}" aria-label="Edit ${m.label}">Edit</button><span class="sp"></span><button type="button" class="btn sm ghost" data-a="dupe" data-id="${m.id}" aria-label="Duplicate ${m.label}">Duplicate</button>
        ${d.confirm === m.id ? html`<button type="button" class="btn sm danger" data-a="del" data-id="${m.id}" data-fk="fk-del-${m.id}">Delete ${m.label}</button><button type="button" class="btn sm ghost" data-a="keep">Keep</button>` : html`<button type="button" class="btn sm ghost" data-a="askdel" data-id="${m.id}" data-fk="fk-askdel-${m.id}" aria-label="Delete ${m.label}">Delete</button>`}</div></div></div>`)}</div>`
    : html`<div class="panel"><div class="empty">${icon("bolt", "xl")}<b>No macros yet</b><span>Make a "Goal horn" or "Show sponsor" button once, then press it during the game.</span><div class="row"><button type="button" class="btn pri" data-a="new">${icon("plus")}New macro</button><button type="button" class="btn" data-a="example">${icon("book")}Start from an example</button></div></div></div>`}`;
}
function editor(d, lk) {
  const m = d.draft;
  return html`<div class="editor"><div class="bar-row"><button type="button" class="btn ghost" data-a="back">${icon("left")}Back to macros</button><h2 class="h2">${m.id ? "Edit macro" : "New macro"}</h2></div>
    ${m._needs?.length ? html`<div class="banner info">${icon("info", "lg")}<span>This example uses the custom field <b>${m._needs.map((n) => n.key).join(", ")}</b>. It is created when you save, if missing.</span></div>` : ""}
    <section class="panel"><div class="ph"><h3>Button</h3></div><div class="pb stack"><div class="g3">
      <label class="field"><span class="fl">Name on the button <span class="req">*</span></span><input class="input" data-f="label" data-fk="fk-label" value="${m.label}" maxlength="40" placeholder="Goal horn" autocomplete="off"></label>
      <div class="field"><span class="fl">Color</span><div class="row"><input type="color" data-f="color" data-fk="fk-color" value="${m.color}" aria-label="Button color" class="cpick"><input class="input mono" data-f="color" data-fk="fk-colortxt" value="${m.color}" maxlength="7" aria-label="Button color as a code like #3D8BFD" style="width:110px"></div></div>
      <div class="field"><span class="fl">Keyboard key (optional)</span><div class="row"><input class="input" data-hk data-fk="fk-hk" value="${m.hotkey}" readonly placeholder="Click here, then press a key" aria-label="Keyboard key. Click, then press the key you want. Backspace removes it."><button type="button" class="btn sm ghost" data-a="hkclear" ${raw(m.hotkey ? "" : "disabled")}>Clear</button></div><span class="hint">Letters, numbers, F1 to F12, with Ctrl or Shift if you like. Keys the console already uses are refused.</span></div></div>
      <fieldset class="rowsfs"><legend>Icon</legend><div class="icons" role="radiogroup" aria-label="Icon">${ICONS.map((n) => html`<button type="button" class="ico ${m.icon === n ? "on" : ""}" role="radio" aria-checked="${m.icon === n}" aria-label="${n}" title="${n}" data-a="icon" data-n="${n}" data-fk="fk-ico-${n}">${macroIcon(n)}</button>`)}</div></fieldset>
      <label class="field"><span class="fl">Description (optional)</span><input class="input" data-f="description" data-fk="fk-desc" value="${m.description}" maxlength="120" placeholder="Shown when you hover the button"></label>
      <div class="field"><span class="fl">How it will look</span><div>${preview(m)}</div></div></div></section>
    <section class="panel"><div class="ph"><h3>Steps</h3></div><div class="pb">${actionsEditor(m.actions, lk, {})}</div></section>
    <section class="panel"><div class="ph"><h3>Try it (dry run)</h3></div><div class="pb stack"><p class="muted">Shows what pressing the button would do. Nothing is shown, sent or saved.</p><div class="row"><button type="button" class="btn" data-a="dry">${icon("play")}Test this macro</button></div><div data-dry>${d.dry ? dryView(d.dry, "macro") : ""}</div></div></section>
    <div class="dirty savebar"><span class="hint err" data-err role="alert"></span><span class="sp"></span><button type="button" class="btn" data-a="back">Cancel</button><button type="button" class="btn pri" data-a="save" data-fk="fk-save">${icon("check")}Save macro</button></div></div>`;
}
const view = (d) => (d.mode === "edit" ? editor(d, d.lk) : list(d));

export const macros = {
  async load() { const [lk, ui] = await Promise.all([lookups(), api.get("/ui")]); return { lk, macros: lk.macros, buttons: ui.ui.macroButtons, mode: "list", draft: null, snap: null, dry: null, confirm: null }; },
  render: (ctx, d) => html`<div data-box>${datalists(d.lk)}${view(d)}</div>`,
  bind(root, ctx, d) {
    const box = root.querySelector("[data-box]"), lk = d.lk;
    const paint = (fk) => repaintBox(box, html`${datalists(lk)}${view(d)}`.s, fk);
    const reload = async () => { d.macros = lk.macros = await api.get("/macros"); d.buttons = (await api.get("/ui")).ui.macroButtons; refreshMacros(); };
    const open = (draft) => { d.mode = "edit"; d.draft = draft; d.snap = JSON.stringify(toApi(draft)); d.dry = null; d.confirm = null; paint("fk-label"); window.scrollTo(0, 0); };
    const err = (m) => { const e = box.querySelector("[data-err]"); if (e) e.textContent = m || ""; };
    const back = () => { if (d.mode === "edit" && JSON.stringify(toApi(d.draft)) !== d.snap && !confirm("Leave without saving your changes?")) return; d.mode = "list"; d.draft = null; paint(); };
    const off = bindDraft(box, lk, { draft: () => d.draft, paint, changed: (path, el) => { if (path === "color") { box.querySelectorAll('[data-f="color"]').forEach((x) => x !== el && (x.value = el.value)); box.querySelectorAll(".pv").forEach((p) => p.style.setProperty("--mc", d.draft.color)); } } });
    async function save() {
      err(""); const body = toApi(d.draft);
      const lost = lostHeaders(d.draft.actions, !d.draft.id);
      if (lost.length && !confirm(`A web request step was moved or copied, so its saved header values (${[...new Set(lost)].join(", ")}) cannot be kept. They will be empty unless you type them again. Save anyway?`)) return; if (!body.label) { err("Give the button a name."); box.querySelector('[data-f="label"]')?.focus(); return; }
      try {
        for (const n of d.draft._needs ?? []) if (!lk.fields.some((f) => f.key === n.key)) { const c = await api.put(`/custom/${n.key}`, { label: n.label, type: n.type, ...(n.default ? { default: n.default } : {}) }); lk.fields = c.fields; }
        const saved = d.draft.id ? await api.put(`/macros/${d.draft.id}`, body) : await api.post("/macros", body);
        toast(`Macro "${saved.label}" saved.`); await reload(); d.mode = "list"; d.draft = null; paint(`fk-askdel-${saved.id}`);
      } catch (e) { err(e.message); fail(e); }
    }
    const click = async (e) => {
      const b = e.target.closest?.("[data-a]"); if (!b || !box.contains(b)) return; const a = b.dataset.a, id = b.dataset.id;
      try {
        if (a === "new") open(blank());
        else if (a === "example") open(example(8));
        else if (a === "edit") open(fromApi(d.macros.find((m) => m.id === id)));
        else if (a === "dupe") { const c = fromApi(d.macros.find((m) => m.id === id)); delete c.id; c.label = `${c.label} (copy)`.slice(0, 40); c.hotkey = ""; open(c); toast("Copy ready. Its key was removed so it does not clash."); }
        else if (a === "askdel") { d.confirm = id; paint(`fk-del-${id}`); } else if (a === "keep") { d.confirm = null; paint(); }
        else if (a === "del") { await api.del(`/macros/${id}`); await api.put("/ui", { macroButtons: d.buttons.filter((x) => x.macroId !== id) }).catch(() => {}); toast("Macro deleted."); d.confirm = null; await reload(); paint(); }
        else if (a === "show") { const on = b.getAttribute("aria-checked") === "true"; const next = on ? d.buttons.filter((x) => x.macroId !== id) : [...d.buttons, { macroId: id }]; await api.put("/ui", { macroButtons: next }); d.buttons = next; toast(on ? "Removed from the console." : "Added to the console."); paint(`fk-${id}`); }
        else if (a === "run") { const { runMacro } = await import("../customize.js"); await runMacro(id, d.macros.find((m) => m.id === id)?.label); }
        else if (a === "back") back(); else if (a === "save") await save();
        else if (a === "icon") { d.draft.icon = b.dataset.n; paint(b.dataset.fk); }
        else if (a === "hkclear") { d.draft.hotkey = ""; paint("fk-hk"); }
        else if (a === "dry") { const out = box.querySelector("[data-dry]"); out.innerHTML = html`<p class="muted">Testing...</p>`.s; try { d.dry = await api.post("/automation/test", { macro: toApi(d.draft) }); } catch (x) { d.dry = { error: x.message }; } out.innerHTML = dryView(d.dry, "macro").s; }
      } catch (x) { fail(x); }
    };
    const key = (e) => {
      if (!e.target.matches?.("[data-hk]")) return; if (e.key === "Tab" || e.key === "Shift" || e.key === "Control" || e.key === "Meta" || e.key === "Alt") return;
      e.preventDefault();
      if (e.key === "Escape") { e.target.blur(); return; }
      if (e.key === "Backspace" || e.key === "Delete") d.draft.hotkey = ""; else if (e.altKey) { toast("Alt is not supported. Try Ctrl or Shift."); return; } else d.draft.hotkey = keyName(e);
      paint("fk-hk");
    };
    function example(n) { const ex = EXAMPLES.find((x) => x.id === n); const m = fromApi({ ...structuredClone(ex.macro), id: undefined }); m._needs = ex.needs ?? []; return m; }
    box.addEventListener("click", click); box.addEventListener("keydown", key);
    if (ctx.query?.example) { history.replaceState(null, "", "#/automation/macros"); open(example(+ctx.query.example)); }
    return () => { off(); box.removeEventListener("click", click); box.removeEventListener("keydown", key); };
  },
};

// ================================================================ custom fields
const TYPES = [["text", "Text"], ["number", "Number"], ["color", "Color"], ["image", "Image address or file"], ["bool", "On / off"]];
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
function control(f) {
  const base = `data-k="${esc(f.key)}" data-fk="fk-v-${esc(f.key)}" aria-label="Value of ${esc(f.label)}"`;
  if (f.type === "bool") return html`<button type="button" class="switch ${f.effective === "true" ? "on" : ""}" role="switch" aria-checked="${f.effective === "true"}" aria-label="${f.label} is ${f.effective === "true" ? "on" : "off"}" data-a="flip" data-k="${f.key}" data-fk="fk-v-${f.key}"></button><span>${f.effective === "true" ? "On" : "Off"}</span>`;
  if (f.type === "color") return html`<input type="color" class="cpick" data-v ${raw(base)} value="${/^#[0-9a-f]{6}$/i.test(f.effective) ? f.effective : "#000000"}"><span class="mono">${f.effective || "none"}</span>`;
  return html`<input class="input" data-v ${raw(base)} type="${f.type === "number" ? "number" : "text"}" step="any" value="${f.value}" placeholder="${f.default ? "Default: " + f.default : "Empty"}" maxlength="500" autocomplete="off">`;
}
function fview(d) {
  return html`<div class="bar-row"><p class="muted lead">A custom field is a piece of text, a number, a color or an on/off switch that your graphics and rules can use. Change a value here at any time, even during a game. Press Enter or leave the box and it is applied.</p></div>
    <div class="panel"><div class="ph"><h3>Live values</h3><span class="sp"></span><span class="hint" data-saved role="status" aria-live="polite"></span></div>
      ${d.fields.length ? html`<ul class="flist">${d.fields.map((f) => html`<li class="frow"><div class="fname"><b>${f.label}</b><code class="muted">custom.${f.key}</code></div><div class="fval">${control(f)}</div>
        <div class="fact"><button type="button" class="btn sm ghost" data-a="reset" data-k="${f.key}" aria-label="Reset ${f.label} to its default" ${raw(f.value === "" ? "disabled" : "")}>Reset</button><button type="button" class="btn sm ghost" data-a="fedit" data-k="${f.key}" aria-label="Edit settings of ${f.label}" data-fk="fk-fe-${f.key}">Settings</button></div>
        ${d.edit === f.key ? html`<div class="fedit g3"><label class="field"><span class="fl">Label</span><input class="input" data-e="label" value="${f.label}" maxlength="40"></label><label class="field"><span class="fl">Kind</span><select class="select" data-e="type">${TYPES.map(([t, l]) => html`<option value="${t}" ${raw(f.type === t ? "selected" : "")}>${l}</option>`)}</select></label><label class="field"><span class="fl">Default (used when the value is empty)</span><input class="input" data-e="default" value="${f.default}" maxlength="500"></label>
          <div class="row wrap wide3"><button type="button" class="btn sm pri" data-a="fsave" data-k="${f.key}">Save settings</button><button type="button" class="btn sm" data-a="fcancel">Cancel</button><span class="sp"></span>${d.confirm === f.key ? html`<button type="button" class="btn sm danger" data-a="fdel" data-k="${f.key}">Delete ${f.label}</button><button type="button" class="btn sm ghost" data-a="keep">Keep</button>` : html`<button type="button" class="btn sm danger" data-a="faskdel" data-k="${f.key}">Delete field</button>`}</div></div>` : ""}</li>`)}</ul>`
      : html`<div class="empty">${icon("sliders", "xl")}<b>No custom fields yet</b><span>Add one below, for example "Sponsor line" or "Home coach".</span></div>`}</div>
    <section class="panel"><div class="ph"><h3>Add a field</h3></div><div class="pb"><div class="g4"><label class="field"><span class="fl">Name used in rules and graphics <span class="req">*</span></span><input class="input mono" data-n="key" placeholder="coachName" maxlength="40" autocomplete="off" spellcheck="false" aria-describedby="nk-h"><span class="hint" id="nk-h">Letters, numbers and _ only, starting with a letter. You use it as <code>{{custom.coachName}}</code>.</span></label>
      <label class="field"><span class="fl">Label shown here</span><input class="input" data-n="label" placeholder="Coach name" maxlength="40"></label>
      <label class="field"><span class="fl">Kind</span><select class="select" data-n="type">${TYPES.map(([t, l]) => html`<option value="${t}">${l}</option>`)}</select></label>
      <label class="field"><span class="fl">Default</span><input class="input" data-n="default" maxlength="500"></label></div>
      <div class="row" style="margin-top:12px"><button type="button" class="btn pri" data-a="fadd">${icon("plus")}Add field</button><span class="hint err" data-nerr role="alert"></span></div></div></section>`;
}
export const fields = {
  async load() { const c = await api.get("/custom"); return { fields: c.fields, values: c.values, edit: null, confirm: null }; },
  render: (ctx, d) => html`<div data-box>${fview(d)}</div>`,
  bind(root, ctx, d) {
    const box = root.querySelector("[data-box]"), say = (m) => { const s = box.querySelector("[data-saved]"); if (s) s.textContent = m; };
    const paint = (fk) => repaintBox(box, fview(d).s, fk);
    const apply = (c) => { d.fields = c.fields; d.values = c.values; };
    const put = async (k, body, msg) => { try { apply(await api.put(`/custom/${k}`, body)); say(msg ?? "Saved."); } catch (e) { fail(e); say(""); } };
    box.addEventListener("change", (e) => { const el = e.target; if (el.dataset.v !== undefined) { const f = d.fields.find((x) => x.key === el.dataset.k); put(el.dataset.k, { value: el.value }, `${f.label} set to "${el.value}". The graphics use it now.`).then(() => f.type === "color" && paint(el.dataset.fk)); } });
    box.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-a]"); if (!b) return; const a = b.dataset.a, k = b.dataset.k, f = d.fields.find((x) => x.key === k);
      if (a === "flip") { await put(k, { value: f.effective === "true" ? "false" : "true" }, `${f.label} is now ${f.effective === "true" ? "off" : "on"}.`); paint(b.dataset.fk); }
      else if (a === "reset") { await put(k, { value: "" }, `${f.label} is back to its default.`); paint(); }
      else if (a === "fedit") { d.edit = d.edit === k ? null : k; d.confirm = null; paint(); }
      else if (a === "fcancel") { const was = d.edit; d.edit = null; paint(`fk-fe-${was}`); }
      else if (a === "keep") { d.confirm = null; paint(); }
      else if (a === "faskdel") { d.confirm = k; paint(); }
      else if (a === "fsave") { const row = b.closest(".fedit"), body = Object.fromEntries([...row.querySelectorAll("[data-e]")].map((x) => [x.dataset.e, x.value])); await put(k, body, "Settings saved."); d.edit = null; paint(`fk-fe-${k}`); }
      else if (a === "fdel") { try { apply(await api.del(`/custom/${k}`)); toast("Field deleted. Rules and graphics that use it will show empty text."); d.edit = null; d.confirm = null; paint(); } catch (x) { fail(x); } }
      else if (a === "fadd") {
        const v = Object.fromEntries([...box.querySelectorAll("[data-n]")].map((x) => [x.dataset.n, x.value.trim()])), er = box.querySelector("[data-nerr]");
        if (!KEY_RE.test(v.key)) { er.textContent = "The name needs letters, numbers or _, and must start with a letter."; box.querySelector('[data-n="key"]').focus(); return; }
        try { apply(await api.put(`/custom/${v.key}`, { label: v.label || v.key, type: v.type, default: v.default })); toast(`Field "${v.label || v.key}" added.`); paint(`fk-v-${v.key}`); } catch (x) { er.textContent = x.message; }
      }
    });
    // follow changes made elsewhere (a rule, another window) without touching a box someone is typing in
    const off = subscribe((st) => {
      if (!st.custom || JSON.stringify(st.custom) === JSON.stringify(d.values)) return;
      api.get("/custom").then((c) => { apply(c); const ae = document.activeElement; if (!(ae && box.contains(ae) && ae.matches("input,select"))) paint(ae?.dataset?.fk); }).catch(() => {});
    });
    return off;
  },
};
