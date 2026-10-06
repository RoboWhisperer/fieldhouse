// Fieldhouse web app core: html templating, api, live state, router, shells, keys, toasts.
// No build step: native ES modules. Screens live in /screens/<name>.js (see the contract in web/README.md).

// ---------------------------------------------------------------- html templating (escapes by default)
class Raw { constructor(s) { this.s = s; } }
export const raw = (s) => new Raw(String(s));
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const part = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join("") : v === false || v == null ? "" : esc(v));
export const html = (strs, ...vals) => raw(strs.reduce((o, s, i) => o + s + (i < vals.length ? part(vals[i]) : ""), ""));
export const icon = (name, cls = "") => raw(`<svg class="i ${esc(cls)}"><use href="#i-${esc(name)}"/></svg>`);

// ---------------------------------------------------------------- formatting
export const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
export const fmtBytes = (n) => (n >= 1e12 ? (n / 1e12).toFixed(1) + " TB" : n >= 1e9 ? (n / 1e9).toFixed(1) + " GB" : n >= 1e6 ? (n / 1e6).toFixed(0) + " MB" : (n / 1e3).toFixed(0) + " KB");
export const fmtDate = (t, o = { month: "short", day: "numeric" }) => new Date(t).toLocaleDateString(undefined, o);
export const fmtTime = (t) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
export const fmtElapsed = (ms) => { const s = Math.floor(ms / 1000); return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, "0")).join(":"); };
export const period = (p) => (p > 4 ? "OT" + (p - 4 > 1 ? p - 4 : "") : "Q" + p);

// ---------------------------------------------------------------- api
async function call(method, path, body) {
  const r = await fetch("/api" + path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get("content-type") || "";
  const data = ct.includes("json") ? await r.json() : await r.text();
  if (!r.ok) throw new Error((data && data.error) || `Request failed (${r.status})`);
  return data;
}
export const api = { get: (p) => call("GET", p), post: (p, b = {}) => call("POST", p, b), put: (p, b = {}) => call("PUT", p, b), del: (p) => call("DELETE", p) };

// ---------------------------------------------------------------- live state (pushed over /ws)
// S.state = { gameId, game, events, engine, graphics, next, settings, serverNow }  (shape: src/app.ts `state()`)
export const S = { state: null, recvAt: 0, connected: false };
const listeners = new Set();
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
/** Clock for the active game, interpolated locally between pushes. */
export const clockMs = () => { const g = S.state?.game; if (!g) return 0; return g.running ? Math.max(0, g.clockMs - (performance.now() - S.recvAt)) : g.clockMs; };
const getPath = (o, p) => p.split(".").reduce((a, k) => (a == null ? a : a[k]), o);

function applyBindings(root = document) {
  const g = S.state;
  root.querySelectorAll("[data-clock]").forEach((el) => { el.textContent = mmss(clockMs()); });
  root.querySelectorAll("[data-bind]").forEach((el) => {
    let v = getPath(g, el.dataset.bind);
    if (el.dataset.bind === "game.period" && v != null) v = period(v);
    if (v != null && el.textContent !== String(v)) el.textContent = v;
  });
}
let noticeSeen = null; // server notices (disk space, cleanup) become toasts once; the first push only sets the baseline
function showNotices(list = []) {
  const top = list.at(-1)?.id ?? 0;
  if (noticeSeen === null) { noticeSeen = top; return; }
  for (const n of list) if (n.id > noticeSeen) toast(n.message);
  noticeSeen = Math.max(noticeSeen, top);
}
function connectWs() {
  const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
  ws.onopen = () => { S.connected = true; banner(); };
  ws.onmessage = (m) => {
    S.state = JSON.parse(m.data); S.recvAt = performance.now(); S.connected = true;
    applyBindings(); renderRibbon(); banner(); showNotices(S.state.notices);
    for (const fn of listeners) try { fn(S.state); } catch (e) { console.error(e); }
  };
  ws.onclose = () => { S.connected = false; banner(); setTimeout(connectWs, 1000); };
}
setInterval(() => applyBindings(), 100);

// ---------------------------------------------------------------- toasts + keys
function toastBox() { // created at startup so screen readers already watch it when the first toast arrives
  let box = document.querySelector(".toasts");
  if (!box) { box = document.createElement("div"); box.className = "toasts"; box.setAttribute("role", "status"); box.setAttribute("aria-live", "polite"); document.body.append(box); }
  return box;
}
export function toast(msg, action) {
  const box = toastBox();
  const el = document.createElement("div"); el.className = "toast";
  el.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) { const b = document.createElement("button"); b.className = "btn sm ghost"; b.textContent = action.label; b.onclick = () => { action.fn(); el.remove(); }; el.append(b); }
  box.append(el); setTimeout(() => el.remove(), action ? 6000 : 4000);
}
export const fail = (e) => toast(e?.message || String(e));

const keyHandlers = new Set();
const norm = (e) => [e.ctrlKey || e.metaKey ? "Ctrl" : "", e.shiftKey ? "Shift" : "", e.key.length === 1 ? e.key.toUpperCase() : e.key].filter(Boolean).join("+");
document.addEventListener("keydown", (e) => {
  if (e.target.closest?.("input,textarea,select,[contenteditable]") || e.altKey) return;
  const k = norm(e);
  for (const map of keyHandlers) if (map[k]) { e.preventDefault(); map[k](e); return; }
});
// Dialogs (role="dialog", see the console modals): Tab stays inside, Escape presses their [data-close], focus returns to what opened them.
let opener = null, dialogOpen = false;
document.addEventListener("click", (e) => { opener = e.target.closest?.("button,a,[tabindex]") ?? opener; }, true);
document.addEventListener("keydown", (e) => {
  const dlg = document.querySelector('[role="dialog"]'); if (!dlg) return;
  if (e.key === "Escape") { const c = dlg.querySelector("[data-close]"); if (c) { e.preventDefault(); c.click(); } return; }
  if (e.key !== "Tab") return;
  const f = [...dlg.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent);
  if (!f.length) return;
  const at = document.activeElement;
  if (!dlg.contains(at)) { e.preventDefault(); (e.shiftKey ? f.at(-1) : f[0]).focus(); }
  else if (e.shiftKey && at === f[0]) { e.preventDefault(); f.at(-1).focus(); }
  else if (!e.shiftKey && at === f.at(-1)) { e.preventDefault(); f[0].focus(); }
}, true);
new MutationObserver(() => {
  const open = !!document.querySelector('[role="dialog"]');
  if (dialogOpen && !open && opener?.isConnected) opener.focus();
  dialogOpen = open;
}).observe(document.body, { childList: true, subtree: true });

/** Register a {"Enter": fn, "Shift+R": fn} map; returns a cleanup function. */
export const keys = (map) => (keyHandlers.add(map), () => keyHandlers.delete(map));

// ---------------------------------------------------------------- shells
const $app = document.getElementById("app");
const brandMark = `<span class="mark"><svg class="i"><use href="#i-ball"/></svg></span>`;
const RAIL = [["home", "Home", "#/", "home"], ["sponsors", "Sponsors", "#/sponsors", "sponsor"], ["reports", "Reports", "#/reports", "chart"], ["settings", "Settings", "#/settings", "gear"]];
const STEPS = [["Setup", "#/game/new"], ["Check", "#/preflight"], ["Live", "#/live"], ["Wrap-up", "#/wrapup"]];
const freeChip = `<a class="chip" href="#/settings/about" style="text-decoration:none"><svg class="i sm"><use href="#i-link"/></svg>Free and open source</a>`;

export function ribbonHtml(g) {
  const t = (tm) => `<div class="team">${tm === "home" ? esc(g?.home.abbr ?? "HOME") + ` <span class="score" data-bind="game.home.score">${g?.home.score ?? 0}</span>` : `<span class="score" data-bind="game.away.score">${g?.away.score ?? 0}</span> ` + esc(g?.away.abbr ?? "AWAY")}</div>`;
  return `<i class="cap" style="background:var(--home)"></i>${t("home")}<div class="mid"><span style="font:700 12px var(--ui);color:var(--text-2)" data-bind="game.period">${g ? period(g.period) : "Q1"}</span><span class="clk" data-clock>${mmss(g ? g.clockMs : 0)}</span>${S.state?.gameDoc?.status === "final" ? '<span class="tag">Final</span>' : ""}</div>${t("away")}<i class="cap" style="background:var(--away)"></i>`;
}
function renderRibbon() {
  const el = document.getElementById("ribbon"); if (!el) return;
  const g = S.state?.game, prior = el.dataset.sig, sig = g ? g.home.abbr + g.away.abbr + S.state.gameDoc?.status : "";
  if (prior === sig && el.childElementCount) return; // bindings keep the numbers live; rebuild only if teams change
  el.dataset.sig = sig; el.innerHTML = ribbonHtml(g);
}
function banner() {
  let b = document.getElementById("conn");
  if (S.connected) { b?.remove(); return; }
  if (!b) { b = document.createElement("div"); b.id = "conn"; b.className = "banner warn"; b.setAttribute("role", "status"); b.setAttribute("aria-live", "polite"); b.style.cssText = "position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:60"; b.innerHTML = `<svg class="i"><use href="#i-alert"/></svg><b>Reconnecting to Fieldhouse…</b><span class="muted">Your game and recording are safe on this computer.</span>`; document.body.append(b); }
}
function manageShell(mod, ctx) {
  $app.innerHTML = `<div class="mg"><nav class="rail"><div class="brand">${brandMark}Fieldhouse</div>${RAIL.map(([id, label, href, ic]) => `<a href="${href}" ${mod.nav === id ? 'aria-current="page"' : ""}><svg class="i lg"><use href="#i-${ic}"/></svg>${label}</a>`).join("")}<span class="sp"></span><div class="foot"><span>Free and open source</span><span>${esc(S.state?.version ?? "")}</span></div></nav><div class="col"><header class="topbar"><div class="input" style="width:320px;color:var(--text-3)"><svg class="i"><use href="#i-search"/></svg>Search games, sponsors</div><span class="sp"></span><span id="top-right"></span>${freeChip}<span class="avatar" title="Operator">OP</span></header><main id="screen" class="main-pad scroll" style="padding:0"></main></div></div>`;
}
function nightShell(mod, ctx) {
  const stepper = STEPS.map(([label, href], i) => { const n = i + 1, cls = n < mod.step ? "done" : n === mod.step ? "on" + (n === 3 ? " live" : "") : ""; return `<a class="st ${cls}" href="${href}" aria-label="Step ${n}, ${label}${n < mod.step ? ", done" : ""}" ${n === mod.step ? 'aria-current="step"' : ""} style="text-decoration:none"><b>${n < mod.step ? '<svg class="i sm"><use href="#i-check"/></svg>' : n}</b><span>${label}</span></a>`; }).join('<i class="sep"></i>');
  $app.innerHTML = `<div class="gn"><header class="topbar"><div class="brand">${brandMark}</div><div class="stepper ${mod.step === 3 ? "compact" : ""}">${stepper}</div><div class="ribbon sm" id="ribbon" style="margin-left:4px"></div><span class="sp"></span><span id="top-right" class="row"></span><a class="btn ghost sm" href="#/" style="text-decoration:none">Save and exit</a></header><main id="screen" class="stage" style="padding:16px"></main></div>`;
  renderRibbon();
}

// ---------------------------------------------------------------- router
const ROUTES = [
  [/^\/$/, "home"], [/^\/welcome$/, "onboarding"], [/^\/game\/new$/, "new-game"], [/^\/game\/roster$/, "roster"], [/^\/sources$/, "sources"],
  [/^\/preflight$/, "preflight"], [/^\/live$/, "console"], [/^\/replay$/, "replay"], [/^\/wrapup$/, "postgame"],
  [/^\/sponsors$/, "sponsors"], [/^\/reports$/, "proof"], [/^\/settings(?:\/([a-z-]+))?$/, "settings"],
];
let cleanup = null, unsub = null, current = null, navSeq = 0;
const styled = new Set();

export const go = (path) => { location.hash = "#" + path; };

async function navigate() {
  const seq = ++navSeq;
  const full = location.hash.slice(1) || "/";
  const [path, qs] = full.split("?");
  let name = null, params = [];
  for (const [re, n] of ROUTES) { const m = re.exec(path); if (m) { name = n; params = m.slice(1); break; } }
  cleanup?.(); unsub?.(); cleanup = unsub = null;
  const query = Object.fromEntries(new URLSearchParams(qs || ""));
  const ctx = { params, query, go, api, S, toast, fail, keys, rerender: () => draw(true, true), redraw: () => draw(true, false) };
  let mod, data;
  async function draw(again, reload = true) {
    if (seq !== navSeq) return;
    const scroll = document.getElementById("screen")?.scrollTop ?? 0;
    cleanup?.(); cleanup = null;
    if (!again) (mod.shell === "night" ? nightShell : manageShell)(mod, ctx);
    const root = document.getElementById("screen");
    if (again && reload && mod.load) data = await mod.load(ctx);
    root.innerHTML = mod.render(ctx, data)?.s ?? "";
    root.scrollTop = scroll;
    applyBindings(root);
    cleanup = mod.bind?.(root, ctx, data) || null;
  }
  try {
    if (!name) throw new Error("That page does not exist.");
    // A screen must see the change the previous screen just made (activate a game, then open Roster): the websocket push is coalesced up to 100 ms late.
    try { S.state = await api.get("/state"); S.recvAt = performance.now(); } catch {}
    if (!S.state) await new Promise((r) => { const u = subscribe(() => (u(), r())); setTimeout(r, 1500); });
    mod = (await import(`/screens/${name}.js`)).default;
    if (mod.css && !styled.has(name)) { styled.add(name); const st = document.createElement("style"); st.textContent = mod.css; document.head.append(st); }
    data = mod.load ? await mod.load(ctx) : undefined;
    if (seq !== navSeq) return;
    current = name; await draw(false);
    if (mod.onState) unsub = subscribe((st) => { const root = document.getElementById("screen"); if (root) mod.onState(root, st, ctx, data); });
  } catch (e) {
    if (seq !== navSeq) return;
    manageShell({ nav: "" }, ctx);
    document.getElementById("screen").innerHTML = `<div class="main-pad"><div class="banner err"><svg class="i"><use href="#i-alert"/></svg><div><b>Something went wrong.</b> <span class="muted">${esc(e.message)}</span></div><span class="sp"></span><a class="btn" href="#/">Back to Home</a></div></div>`;
    console.error(e);
  }
}
window.addEventListener("hashchange", navigate);
toastBox();
connectWs();
navigate();
