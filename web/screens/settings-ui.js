// Shared UI helpers + page CSS for the Settings screens.
import { html, icon, toast } from "../app.js";

export const REPO = "https://github.com/fieldhouse-app/fieldhouse"; // placeholder address, shown as such wherever it is linked
export const NAV = [["engine", "Engine (OBS)", "video"], ["destinations", "Destinations", "link"], ["themes", "Graphics themes", "film"], ["sport", "Sport profile", "ball"], ["shortcuts", "Keyboard shortcuts", "sliders"], ["remote", "Remote", "phone"], ["storage", "Storage", "disk"], ["diagnostics", "Diagnostics", "help"], ["about", "About and open source", "book"]];

/** Delegated listener: elements with data-<attr>="name" call map[name](el, event). Returns a cleanup. */
export function delegate(root, type, attr, map) {
  const h = (e) => { const el = e.target.closest?.(`[data-${attr}]`); const f = el && root.contains(el) && map[el.dataset[attr]]; if (f) f(el, e); };
  root.addEventListener(type, h);
  return () => root.removeEventListener(type, h);
}
export const all = (...fns) => () => fns.forEach((f) => f?.());

export const sw = (on, act, label) => html`<button type="button" class="switch ${on ? "on" : ""}" role="switch" aria-checked="${on}" aria-label="${label}" data-act="${act}"></button>`;
export const dirtyBar = (note) => html`<div class="dirty" hidden><svg class="i lg" style="color:var(--caution)"><use href="#i-alert"/></svg><span><b>You have unsaved changes.</b> <span class="muted" data-note>${note}</span></span><span class="sp"></span><span class="hint err" data-err role="alert"></span><button class="btn" data-act="discard">Discard</button><button class="btn pri" data-act="save">${icon("check")}Save changes</button></div>`;
export const setDirty = (root, notes) => { const bar = root.querySelector(".dirty"); if (!bar) return; bar.hidden = !notes.length; bar.querySelector("[data-note]").textContent = notes.join(", ") + (notes.length ? " edited." : ""); };
export const setErr = (root, msg) => { const e = root.querySelector("[data-err]"); if (e) e.textContent = msg || ""; };

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast("Copied."); return; } catch {}
  const t = document.createElement("textarea"); t.value = text; t.style.cssText = "position:fixed;opacity:0"; document.body.append(t); t.select();
  try { document.execCommand("copy") ? toast("Copied.") : toast("Could not copy. Select the text and copy it by hand."); } finally { t.remove(); }
}
export const lnk = (href, label, cls = "btn", ic = "link") => html`<a class="${cls}" href="${href}" target="_blank" rel="noopener noreferrer" style="text-decoration:none">${icon(ic)}${label}</a>`;
export const panel = (title, body, right = "") => html`<div class="panel"><div class="ph"><h3>${title}</h3>${right ? html`<span class="sp"></span>${right}` : ""}</div>${body}</div>`;
export const sectionName = (id) => NAV.find((n) => n[0] === id)?.[1] ?? "Settings";

export const CSS = `
.stg{padding:24px 32px;display:grid;gap:16px;align-content:start}
.stg .two{display:grid;grid-template-columns:240px minmax(0,1fr);gap:24px;align-items:start}
.stg .stnav{display:grid;gap:2px;align-content:start;position:sticky;top:0}
.stg .stnav a{display:flex;align-items:center;gap:10px;height:38px;padding:0 12px;border-radius:var(--r-ctl);color:var(--text-2);text-decoration:none;font-weight:550}
.stg .stnav a[aria-current]{background:var(--raised);color:var(--text)}
.stg .stnav a:hover{background:var(--raised)}
.stg .cp{display:grid;gap:16px;align-content:start;min-width:0}
.stg .dst{display:grid;grid-template-columns:40px minmax(0,1fr) auto;gap:14px;align-items:center;padding:14px 16px;border-bottom:1px solid var(--line)}
.stg .dst:last-child{border-bottom:0}
.stg .kv{display:grid;grid-template-columns:140px minmax(0,1fr) auto;gap:12px;align-items:center}
.stg input.input,.stg select.input,.stg select.select{font:inherit;width:100%}
.stg input.input.mono{font-family:var(--mono)}
.stg input[type=color]{width:34px;height:30px;padding:0;border:1px solid var(--line-strong);border-radius:6px;background:var(--inset);cursor:pointer}
.stg input[type=range]{accent-color:var(--action);width:100%}
.stg button.switch,.stg button.check{border:0;padding:0;cursor:pointer}
.stg button.check{border:1.5px solid var(--line-strong);background:transparent;color:inherit}
.stg button.check.on{border-color:var(--action-fill)}
.dirty{position:sticky;bottom:0;display:flex;align-items:center;gap:12px;padding:14px 32px;background:var(--raised);border-top:1px solid var(--line-strong)}
.dirty[hidden]{display:none}
.stg .row2{display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--line)}
.stg .row2:last-child{border-bottom:0}
.stg .row2>div:first-child{min-width:0;flex:1}
.stg .sys{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;padding:14px 16px}
.stg .g2{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:16px;align-items:start}
.stg .g4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;padding:14px}
.stg .th{display:grid;gap:10px;min-width:0;text-align:left;cursor:pointer;font:inherit;color:inherit}
.stg .qrb{display:grid;gap:12px;justify-items:center;padding:16px}
.stg .stcode{font:700 26px/1 var(--mono);letter-spacing:.08em}
.stg .swr{display:flex;align-items:center;gap:14px;padding:12px 16px;border-bottom:1px solid var(--line)}
.stg .swr:last-of-type{border-bottom:0}
.stg .swr div{min-width:0;flex:1}
.stg .ststack{display:flex;gap:2px;height:22px;border-radius:4px;overflow:hidden;background:var(--line-strong)}
.stg .ststack b{display:block;height:100%}
.stg .stcat{display:grid;grid-template-columns:12px minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px 0;border-top:1px solid var(--line)}
.stg .stcat i{width:10px;height:10px;border-radius:2px;display:block}
.stg .fr{display:grid;gap:6px;padding:12px 16px;border-bottom:1px solid var(--line)}
.stg .fr:last-child{border-bottom:0}
.stg .stlog{display:flex;flex-direction:column;font:12px/1 var(--mono);max-height:340px;overflow:auto}
.stg .stlog div{display:grid;grid-template-columns:62px 72px minmax(0,1fr);gap:10px;align-items:center;min-height:26px;padding:0 14px;border-bottom:1px solid var(--line);color:var(--text-2)}
.stg .stlog .pill{justify-content:flex-start;height:20px;font-size:11px}
.stg .stlog span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.stg .si{display:flex;flex-direction:column;padding:6px 14px;margin:0}
.stg .si div{display:grid;grid-template-columns:104px minmax(0,1fr);gap:10px;align-items:center;min-height:30px}
.stg .si dt{color:var(--text-3)}.stg .si b{font-weight:600}
.stg .cx{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.stg .cx ul{margin:6px 0 0;padding:0;list-style:none;display:grid;gap:4px}
.stg .cx li{display:flex;align-items:center;gap:6px}
.stg .r3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;align-items:start}
.stg .sthelp{display:flex;flex-direction:column}
.stg .sthelp a{display:flex;align-items:center;gap:12px;min-height:44px;padding:0 14px;border-bottom:1px solid var(--line);color:var(--text);text-decoration:none;font-weight:600}
.stg .sthelp a:last-child{border-bottom:0}.stg .sthelp a:hover{background:var(--raised)}
.stg .sthelp a .i:first-child{color:var(--action-hi)}.stg .sthelp a .i:last-child{color:var(--text-3);margin-left:auto}
.stg .ok2{display:flex;gap:16px;flex-wrap:wrap}.stg .ok2 span{display:flex;align-items:center;gap:6px;font-weight:600}.stg .ok2 .i{color:var(--ready)}
.stg .grp{height:30px;background:var(--inset);font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--text-3)}
.stg .tbl td.act{text-align:right}
.stg .pre{margin:0;padding:12px 14px;max-height:320px;overflow:auto;font:12px/1.5 var(--mono);color:var(--text-2);background:var(--inset);white-space:pre-wrap;word-break:break-word}
.stg .skel{height:120px;border-radius:var(--r-panel);background:var(--panel);border:1px solid var(--line)}
@media (max-width:1100px){.stg .two{grid-template-columns:1fr}.stg .stnav{position:static;grid-template-columns:repeat(4,1fr)}.stg .g2,.stg .r3{grid-template-columns:1fr}.stg .g4{grid-template-columns:repeat(2,1fr)}}
`;
