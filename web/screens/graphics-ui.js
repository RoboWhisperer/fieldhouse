// Shared UI helpers and page CSS for the Graphics Studio.
import { html, raw, icon, esc } from "../app.js";
import { setPath, getPath, parsePairs } from "./graphics-lib.js";

let uid = 0;
const id = () => "gx" + ++uid;
const attrs = (o) => raw(Object.entries(o || {}).map(([k, v]) => (v === false || v == null ? "" : v === true ? ` ${esc(k)}` : ` ${esc(k)}="${esc(v)}"`)).join(""));

// ---- labelled form controls. `path` is where the value lives in the draft object being edited (see bindForm).
export const text = (path, v, label, o = {}) => { const i = id(); return html`<div class="field ${o.cls || ""}"><label for="${i}">${label}</label><input class="input ${o.mono ? "mono" : ""}" id="${i}" type="${o.type || "text"}" value="${v ?? ""}" data-p="${path}" ${attrs({ placeholder: o.ph, maxlength: o.max, autocomplete: "off", spellcheck: o.mono ? "false" : null, readonly: o.ro, "data-re": o.re, "aria-describedby": o.hint ? i + "h" : null })}>${o.hint ? html`<span class="hint" id="${i}h">${o.hint}</span>` : ""}</div>`; };
export const num = (path, v, label, o = {}) => { const i = id(); return html`<div class="field ${o.cls || ""}"><label for="${i}">${label}</label><input class="input" id="${i}" type="number" value="${v ?? ""}" data-p="${path}" data-n ${attrs({ min: o.min, max: o.max, step: o.step ?? 1, "aria-describedby": o.hint ? i + "h" : null })}>${o.hint ? html`<span class="hint" id="${i}h">${o.hint}</span>` : ""}</div>`; };
export const sel = (path, v, label, options, o = {}) => { const i = id(); return html`<div class="field ${o.cls || ""}"><label for="${i}">${label}</label><select class="input" id="${i}" data-p="${path}" ${attrs({ "data-re": o.re, "aria-describedby": o.hint ? i + "h" : null })}>${options.map(([val, lab, dis]) => html`<option value="${val}" ${String(val) === String(v) ? "selected" : ""} ${dis ? "disabled" : ""}>${lab}</option>`)}</select>${o.hint ? html`<span class="hint" id="${i}h">${o.hint}</span>` : ""}</div>`; };
export const chk = (path, v, label, hint = "", o = {}) => { const i = id(); return html`<div class="gx-chk ${o.cls || ""}"><input type="checkbox" id="${i}" data-p="${path}" ${v ? "checked" : ""} ${attrs({ "data-re": o.re, "aria-describedby": hint ? i + "h" : null })}><label for="${i}">${label}</label>${hint ? html`<span class="hint" id="${i}h">${hint}</span>` : ""}</div>`; };
export const area = (path, v, label, o = {}) => { const i = id(); return html`<div class="field ${o.cls || ""}"><label for="${i}">${label}</label><textarea class="input ${o.mono ? "mono" : ""}" id="${i}" rows="${o.rows || 3}" data-p="${path}" ${attrs({ placeholder: o.ph, spellcheck: "false", "data-pairs": o.pairs, "aria-describedby": o.hint ? i + "h" : null })}>${v ?? ""}</textarea>${o.hint ? html`<span class="hint" id="${i}h">${o.hint}</span>` : ""}</div>`; };
export const sw = (on, act, label, data = "") => html`<button type="button" class="switch ${on ? "on" : ""}" role="switch" aria-checked="${on}" aria-label="${label}" data-act="${act}" ${raw(data)}></button>`;
export const sec = (title, body, right = "", o = {}) => html`<section class="panel ${o.cls || ""}" ${attrs({ id: o.id })}><div class="ph"><h3>${title}</h3>${right ? html`<span class="sp"></span>${right}` : ""}</div><div class="pb gx-pb">${body}</div></section>`;
export const pill = (cls, label, ic) => html`<span class="pill ${cls} ${ic ? "noDot" : ""}">${ic ? icon(ic, "sm") : ""}${label}</span>`;

/**
 * Wire every [data-p] control under `root` to `draft`: typing changes draft at that dotted path and calls onChange(path, el).
 * Controls with data-n give numbers, checkboxes give booleans, other controls with the same path are kept in step (a color picker and its hex box).
 */
export function bindForm(root, draft, { onChange, onRedraw } = {}) {
  const h = (e) => {
    const el = e.target.closest?.("[data-p]"); if (!el || !root.contains(el)) return;
    const path = el.dataset.p; let v;
    if (el.type === "checkbox") v = el.checked;
    else if (el.type === "radio") { if (!el.checked) return; v = el.value; }
    else if ("pairs" in el.dataset) v = parsePairs(el.value);
    else if ("n" in el.dataset) { if (el.value.trim() === "" || !Number.isFinite(+el.value)) return; v = +el.value; }
    else v = el.value;
    if (el.type === "color" || el.dataset.hex !== undefined) { // keep picker and hex box in step
      root.querySelectorAll(`[data-p="${CSS.escape(path)}"]`).forEach((o) => { if (o !== el && o.type !== "checkbox" && !(o.type === "color" && !/^#[0-9a-f]{6}$/i.test(v))) o.value = v; });
    }
    if (!setPath(draft, path, v)) return;
    onChange?.(path, el);
    if (el.dataset.re !== undefined && e.type === "change") onRedraw?.(path, el);
  };
  root.addEventListener("input", h); root.addEventListener("change", h);
  return () => { root.removeEventListener("input", h); root.removeEventListener("change", h); };
}

// ---- dialogs (role="dialog": app.js traps Tab, closes on Escape through [data-close] and gives focus back)
export function openDialog(title, body, { wide = false } = {}) {
  const el = document.createElement("div"); el.className = "gx-scrim";
  el.innerHTML = html`<div class="modal ${wide ? "big" : ""}" role="dialog" aria-modal="true" aria-label="${title}"><div class="row"><h2 class="t" style="margin:0">${title}</h2><span class="sp"></span><button type="button" class="btn ghost sm" data-close>${icon("x", "sm")}Close</button></div>${body}</div>`.s;
  const close = () => el.remove();
  el.addEventListener("click", (e) => { if (e.target.closest("[data-close]") || e.target === el) close(); });
  document.body.append(el);
  (el.querySelector("[autofocus]") || el.querySelector("input,select,textarea,button:not([data-close])") || el.querySelector("[data-close]")).focus();
  return { el, close };
}
export function confirmDialog(title, message, okLabel, { danger = false } = {}) {
  return new Promise((res) => {
    let done = false;
    const d = openDialog(title, html`<p class="muted" style="margin:0">${message}</p><div class="gx-ft"><button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn ${danger ? "danger" : "pri"}" data-ok>${okLabel}</button></div>`);
    d.el.querySelector("[data-ok]").addEventListener("click", () => { done = true; res(true); d.close(); });
    new MutationObserver(() => { if (!d.el.isConnected && !done) { done = true; res(false); } }).observe(document.body, { childList: true });
  });
}

export const STUDIO_CSS = `
.mg .col:has(.gx){height:100vh;min-height:720px}#screen:has(>.gx){overflow:auto}
.gx{padding:24px 32px 48px;display:grid;gap:24px;align-content:start;max-width:1600px}
.gx h1{margin:0;font-size:28px;line-height:1.15;font-weight:650;letter-spacing:-.015em}
.gx h2{margin:0;font-size:16px;font-weight:650}.gx p{margin:0}
.gx a.btn{text-decoration:none}
.gx .btn.ghost.del:hover{background:var(--program-wash);color:#FF8A8E}
.gx input.input,.gx select.input,.gx textarea.input{font:inherit;width:100%;box-sizing:border-box}
.gx select.input{padding-right:8px}
.gx input.input.mono,.gx textarea.input.mono{font-family:var(--mono);font-size:13px}
.gx textarea.input{height:auto;padding:8px 12px;line-height:1.5;resize:vertical;display:block}
.gx input:focus-visible,.gx select:focus-visible,.gx textarea:focus-visible,.gx a:focus-visible,.gx [tabindex]:focus-visible{outline:2px solid var(--action-hi);outline-offset:2px}
.gx input[type=color]{width:40px;height:36px;padding:4px;border:1px solid var(--line-strong);border-radius:var(--r-ctl);background:var(--inset);cursor:pointer;flex:none}
.gx input[type=range]{accent-color:var(--action);width:100%}
.gx input[type=checkbox],.gx input[type=radio]{accent-color:var(--action);width:18px;height:18px;margin:0;flex:none}
.gx button.switch{border:0;padding:0;cursor:pointer}
.gx .panel>.ph{height:44px;padding:0 16px}
.gx .panel>.pb{padding:16px}
.gx .hint{line-height:1.5}
#gx-view{display:grid;gap:24px;align-content:start;min-width:0}
.gx .field>.row{flex-wrap:wrap;gap:8px}.gx .field>.row>.input{flex:1 1 112px}
.gx-w{max-width:880px;width:100%}
.gx-top{display:grid;gap:16px}
.gx-chk{display:grid;grid-template-columns:18px 1fr;gap:4px 12px;align-items:center}
.gx-chk .hint{grid-column:2}
.gx-chk label{font-weight:600;color:var(--text)}
.gx-head{display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap}
.gx-head .sub{color:var(--text-2);margin-top:8px;flex:1 1 320px;max-width:64ch;line-height:1.5}
.gx-tabs{display:flex;gap:8px;border-bottom:1px solid var(--line)}
.gx-tabs a{padding:8px 12px;color:var(--text-2);font-weight:600;border-bottom:2px solid transparent;margin-bottom:-1px;text-decoration:none}
.gx-tabs a:hover{color:var(--text)}.gx-tabs a[aria-current]{color:var(--text);border-color:var(--action)}
.gx-air{display:flex;align-items:center;gap:12px;flex-wrap:wrap;min-height:52px;padding:8px 8px 8px 16px;border-radius:var(--r-panel);background:var(--panel)}
.gx-air.on{box-shadow:inset 3px 0 0 var(--program)}
.gx-air .lbl{color:var(--text-2);display:inline-flex;align-items:center}
.gx-air .it{display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 4px 0 12px;border-radius:var(--r-ctl);background:var(--raised)}
.gx-air .it b{font-weight:650}
.gx-sech{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.gx-sech .muted{font-size:13px}.gx-sech .faint{font-size:12px}
.gx-secs{display:grid;gap:16px}
.gx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:24px}
.gx-card{display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-panel);overflow:hidden;min-width:0}
.gx-card.air{border-color:var(--program)}
.gx-card.off .gx-stage{opacity:.55}
.gx-card .gx-stage{border:0;border-radius:0}
.gx-cb{display:flex;flex-direction:column;gap:8px;padding:16px;flex:1}
.gx-name{margin:0;font-size:16px;font-weight:650;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gx-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;color:var(--text-2);font-size:12px;min-height:24px}
.gx-meta .dotsep{color:var(--text-3)}
.gx-cb .desc{color:var(--text-2);line-height:1.5}
.gx-cb .desc:empty{display:none}
.gx-cf{margin-top:auto;display:grid;gap:12px;padding-top:12px}
.gx-cf .r{display:flex;align-items:center;gap:8px}
.gx-cf .r .lab{color:var(--text-2);font-size:12px;margin-left:4px;margin-right:auto}
.gx-acts{display:flex;gap:4px;flex-wrap:wrap;margin:0 -8px -8px}
.gx-acts .del{margin-left:auto}
.gx-two{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:24px;align-items:start}
.gx-sticky{position:sticky;top:16px;display:grid;gap:24px;min-width:0}
.gx-stack{display:grid;gap:24px;min-width:0}
.gx-stack:empty{display:none}
.gx-pb{display:grid;gap:16px;align-content:start}
.gx-g2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start}
.gx-g3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;align-items:start}
.gx-ft{display:flex;gap:8px;align-items:center;justify-content:flex-end;flex-wrap:wrap}
.gx-ft>.gx-l{margin-right:auto}
.gx-scrim{position:fixed;inset:0;background:rgba(4,7,12,.7);display:grid;place-items:center;z-index:70;padding:16px}
.gx-scrim .modal{max-height:calc(100vh - 32px);overflow:auto;width:min(560px,100%);box-sizing:border-box;padding:24px;gap:16px}.gx-scrim .modal.big{width:min(720px,100%)}
.gx-scrim .modal .btn.danger{background:var(--program-fill);border-color:var(--program-fill);color:#fff}.gx-scrim .modal .btn.danger:hover{background:var(--program)}
.gx-scrim .modal .gx-ft{margin-top:8px}
.gx-pick{display:grid;gap:8px}
.gx-pick label{display:grid;grid-template-columns:18px 1fr;gap:4px 12px;padding:12px 16px;border:1px solid var(--line);border-radius:8px;cursor:pointer;background:var(--inset)}
.gx-pick label:hover{border-color:var(--line-strong)}
.gx-pick label:has(input:checked){border-color:var(--action);background:var(--action-wash)}
.gx-pick label:has(input:focus-visible){outline:2px solid var(--action-hi);outline-offset:2px}
.gx-pick label>input{margin-top:1px}
.gx-pick label b{font-weight:600}
.gx-pick label span{grid-column:2}.gx-pick .hint{grid-column:2}
.gx-kinds{max-width:880px;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}
.gx-kind{display:grid;grid-template-columns:40px 1fr;gap:4px 16px;align-items:center;padding:16px;border:1px solid var(--line);border-radius:var(--r-panel);background:var(--panel);color:var(--text);text-decoration:none}
.gx-kind:hover{background:var(--raised);border-color:var(--line-strong)}
.gx-kind .gx-ic{grid-row:1/3}
.gx-kind .hint{grid-column:2;line-height:1.5}
.gx-ic{display:grid;place-items:center;width:40px;height:40px;border-radius:50%;background:var(--raised);color:var(--text-2);flex:none}
.gx-dirty{position:sticky;bottom:0;z-index:5;display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--raised);border:1px solid var(--line-strong);border-radius:var(--r-panel);box-shadow:var(--shadow-float);flex-wrap:wrap}
.gx-dirty[hidden]{display:none}
.gx-dirty>span:first-child{color:var(--caution);display:inline-flex}
.gx-fld{display:grid;gap:12px;padding:16px;border-radius:8px;background:var(--raised)}
.gx-fld>b,.gx-fld .row>b{font-weight:650}
.gx-fld .gx-g2,.gx-fld .gx-g3{align-items:start}
.gx-ex{grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:16px}.gx-ex .hint{margin-top:4px}
.gx-code{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;align-items:start}
.gx-ftabs{display:flex;align-items:flex-end;gap:8px;border-bottom:1px solid var(--line)}
.gx-files{display:flex;gap:4px;margin:0;padding:0;list-style:none;overflow-x:auto;flex:1;min-width:0}
.gx-files button{text-align:left;border:0;border-bottom:2px solid transparent;margin-bottom:-1px;background:transparent;color:var(--text-2);padding:8px 12px;border-radius:6px 6px 0 0;cursor:pointer;font:12px var(--mono);display:flex;gap:8px;align-items:center;white-space:nowrap}
.gx-files button:hover{background:var(--raised);color:var(--text)}.gx-files button[aria-current]{color:var(--text);border-bottom-color:var(--action)}
.gx-files .sz{color:var(--text-3)}
.gx-ftabs .btn{margin-bottom:4px}
.gx-ta{width:100%;box-sizing:border-box;min-height:420px;max-height:70vh;padding:16px;font:13px/1.5 var(--mono);color:var(--text);background:var(--inset);border:1px solid var(--line-strong);border-radius:8px;resize:vertical;tab-size:2;white-space:pre}
.gx-handle{z-index:2;position:absolute;border:2px dashed #fff;box-shadow:0 0 0 1px #1c64d6,0 0 0 3px rgba(28,100,214,.35) inset;background:rgba(61,139,253,.16);cursor:move;touch-action:none;border-radius:2px;min-width:12px;min-height:12px}
.gx-handle:focus-visible{outline:2px solid #fff;outline-offset:2px}
.gx-handle.hide{display:none}
.gx-guide{position:absolute;pointer-events:none;border:1px dashed rgba(255,255,255,.25)}
.gx-drop{display:grid;gap:12px;justify-items:center;text-align:center;padding:48px 24px;border:2px dashed color-mix(in srgb,var(--text-3) 80%,var(--inset));border-radius:12px;background:var(--inset);color:var(--text-2)}
.gx-drop>b{color:var(--text);font-size:16px;font-weight:650}
.gx-drop>span{max-width:52ch;line-height:1.5}
.gx-drop.over{border-color:var(--action);background:var(--action-wash)}
.gx-steps{display:flex;gap:4px;flex-wrap:wrap;list-style:none;padding:0;margin:0}
.gx-steps li{display:flex;align-items:center;gap:8px;height:32px;padding:0 12px 0 6px;border-radius:999px;color:var(--text-3);font-weight:600;font-size:12px}
.gx-steps li b{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--raised);color:var(--text-2);font-size:11px;font-weight:650}
.gx-steps li[aria-current]{color:var(--text);background:var(--raised)}.gx-steps li[aria-current] b{background:var(--action-fill);color:#fff}
.gx-steps li.done{color:var(--text-2)}.gx-steps li.done b{background:var(--ready-wash);color:var(--ready)}
.gx-list{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.gx-list li{display:flex;gap:12px;align-items:flex-start;line-height:1.5}.gx-list .i{flex:none;margin-top:2px}
.gx-conn{display:grid;grid-template-columns:40px minmax(0,1fr) auto;gap:16px;align-items:center;padding:16px;border-bottom:1px solid var(--line)}
.gx-conn:last-child{border-bottom:0}
.gx-conn .acts{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;align-items:center}
.gx-conn .sub{color:var(--text-2);font-size:12px;margin-top:4px}
.gx-tbl{width:100%;border-collapse:collapse}
.gx-tbl th{text-align:left;font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--text-3);padding:8px 12px;border-bottom:1px solid var(--line)}
.gx-tbl td{padding:8px 12px;border-bottom:1px solid var(--line);vertical-align:middle;color:var(--text-2)}
.gx-tbl td:first-child{color:var(--text)}
.gx-tbl th:last-child,.gx-tbl td:last-child{text-align:right;font-variant-numeric:tabular-nums}
.gx-tbl tr:last-child td{border-bottom:0}
.gx-ok{color:var(--ready)}.gx-bad{color:#FF8A8E}
html[data-theme=light] .gx-bad,html[data-theme=light] .gx .btn.ghost.del:hover{color:#B3261E}
.gx .empty{padding:48px 24px;gap:12px}
.gx .empty>b{font-size:16px;font-weight:650;color:var(--text)}
.gx .empty>span{max-width:52ch;line-height:1.5}
.gx .skel{height:160px;border-radius:var(--r-panel);background:var(--panel);border:1px solid var(--line)}
@media (max-width:1100px){.gx{padding:16px}.gx-two{grid-template-columns:1fr}.gx-sticky{position:static}.gx-g3{grid-template-columns:repeat(2,minmax(0,1fr))}.gx-conn{grid-template-columns:40px minmax(0,1fr)}.gx-conn .acts{grid-column:1/-1;justify-content:flex-start}}
@media (max-width:640px){.gx-g2,.gx-g3{grid-template-columns:1fr}}
`;
export { getPath };
