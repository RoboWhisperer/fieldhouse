// Shared pieces of the Automation screens: lookups, the action-list editor (used by rules and macros), dry-run view, examples.
// Everything here renders plain-language forms from GET /api/automation/catalog; the server stays the judge of what is valid.
import { html, raw, esc, icon, api, S } from "../app.js";

// ---------------------------------------------------------------- small helpers
export const getp = (o, p) => p.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
export function setp(o, path, v) {
  const ks = path.split("."), last = ks.pop();
  const t = ks.reduce((a, k) => a[k], o);
  if (v === undefined) { if (Array.isArray(t)) t.splice(+last, 1); else delete t[last]; } else t[last] = v;
}
export const ago = (t) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 5 ? "just now" : s < 90 ? `${s} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`; };
export const clock = (t) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
export const STATUS = { ok: ["ready", "Done", "check"], error: ["err", "Failed", "alert"], skipped: ["off", "Did nothing", "minus"], cancelled: ["check", "Cancelled", "x"], running: ["info", "Running", "play"], queued: ["info", "Waiting", "clock"] };
export const statusPill = (s) => { const [c, t, ic] = STATUS[s] ?? ["off", s, "info"]; return html`<span class="pill ${c} noDot">${icon(ic, "sm")}${t}</span>`; };
export const pill = (cls, text, ic) => html`<span class="pill ${cls} noDot">${ic ? icon(ic, "sm") : ""}${text}</span>`;
export const sw = (on, act, label, extra = "") => html`<button type="button" class="switch ${on ? "on" : ""}" role="switch" aria-checked="${on}" aria-label="${label}" data-act="${act}" ${raw(extra)}></button>`;
export const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------- lookups for pickers
let catalog = null;
export async function lookups(extra = {}) {
  const [cat, rules, macros, custom, sponsors, gfx] = await Promise.all([catalog ?? api.get("/automation/catalog"), api.get("/automation/rules"), api.get("/macros"), api.get("/custom"), api.get("/sponsors").catch(() => []), api.get("/graphics").catch(() => [])]);
  catalog = cat;
  const st = S.state ?? {};
  return {
    catalog: cat, rules, macros, fields: custom.fields, values: custom.values, sponsors: sponsors.map((s) => ({ id: s.id, name: s.name })),
    graphics: gfx.filter((g) => g.enabled !== false).map((g) => ({ id: g.id, name: g.name, fields: (g.fields ?? []).map((f) => f.name) })),
    sources: (st.engine?.sources ?? []).map((s) => ({ id: s.id, label: s.label })), audio: (st.engine?.mixer ?? []).map((m) => ({ id: m.id, label: m.label ?? m.id })), ...extra,
  };
}
export const datalists = (lk) => html`
  <datalist id="dl-graphics">${lk.graphics.map((g) => html`<option value="${g.id}">${g.name}</option>`)}</datalist>
  <datalist id="dl-fields">${lk.fields.map((f) => html`<option value="${f.key}">${f.label}</option>`)}</datalist>
  <datalist id="dl-sources">${lk.sources.map((s) => html`<option value="${s.id}">${s.label}</option>`)}</datalist>
  <datalist id="dl-audio">${lk.audio.map((s) => html`<option value="${s.id}">${s.label}</option>`)}</datalist>`;

// ---------------------------------------------------------------- one form control per catalog parameter
const LIST_OF = { "graphic.id": "dl-graphics", "custom.set.key": "dl-fields", "custom.clear.key": "dl-fields", "engine.sourceId": "dl-sources", "engine.id": "dl-audio", "trigger.engine.sourceId": "dl-sources" };
const OP_LABEL = { show: "Show", hide: "Hide", toggle: "Show or hide (toggle)", update: "Change the text on screen", next: "Go to the next item", clear: "Clear all graphics", preview: "Put a camera in preview", cut: "Cut preview to program", fade: "Fade preview to program", replay: "Play a replay", "replay.stop": "Stop the replay", mute: "Mute or unmute a channel" };
const optText = (v) => OP_LABEL[v] ?? String(v);
const needs = (kind, op, name) => {
  if (kind === "graphic") return name === "op" || (name === "id" && op !== "clear") || (name === "fields" && (op === "update" || op === "show"));
  if (kind === "engine") return name === "op" || ({ preview: ["sourceId"], fade: ["ms"], replay: ["secondsBack", "speed"], mute: ["id", "muted"] }[op] ?? []).includes(name);
  if (kind === "http") return true;
  return true;
};

/** `scope` names where the control lives (for suggestion lists): "graphic", "engine", "trigger.engine"... */
export function param(p, val, path, scope, lk, opts = {}) {
  const fk = `fk-${path}`, label = html`${p.label}${p.required ? html` <span class="req" title="Required">*</span>` : ""}`;
  const hint = p.hint || p.templated ? html`<span class="hint">${p.hint ?? ""}${p.templated ? html`${p.hint ? " " : ""}You can use values like <code>{{home.score}}</code>.` : ""}</span>` : "";
  const rd = opts.repaint ? 'data-r="1"' : "";
  if (p.kind === "bool") return html`<label class="chk"><input type="checkbox" data-f="${path}" data-t="bool" data-fk="${fk}" ${raw(val ? "checked" : "")}> <span>${p.label}</span></label>`;
  if (p.kind === "fields" || p.kind === "headers") return rows(p, val ?? [], path, scope, lk, opts);
  if (p.kind === "event") return evEditor(p, val, path, lk);
  let ctl;
  const pick = scope === "trigger.after" && p.name === "ruleId" ? lk.rules.filter((r) => r.id !== opts.selfId).map((r) => [r.id, r.name])
    : (scope === "macro" && p.name === "macroId") ? lk.macros.filter((m) => m.id !== opts.selfId).map((m) => [m.id, m.label])
    : (p.name === "sponsorId") ? lk.sponsors.map((s) => [s.id, s.name]) : null;
  if (p.kind === "select" || pick) {
    const o = pick ?? (p.options ?? []).map((x) => [x, optText(x)]);
    const known = o.some(([v]) => v === val);
    ctl = html`<select class="select" data-f="${path}" data-fk="${fk}" ${raw(rd)}>${!p.required || pick ? html`<option value="" ${raw(!val ? "selected" : "")}>${pick ? (p.required ? "Choose..." : "Any / the one that is due") : "Any"}</option>` : ""}${val && !known ? html`<option value="${val}" selected>${val} (not found)</option>` : ""}${o.map(([v, l]) => html`<option value="${v}" ${raw(v === val ? "selected" : "")}>${l}</option>`)}</select>`;
  } else if (p.kind === "list") ctl = html`<input class="input" data-f="${path}" data-t="list" data-fk="${fk}" value="${(val ?? []).join(", ")}" placeholder="${p.options ? "e.g. " + p.options.join(", ") + " (empty = any)" : ""}" inputmode="numeric">`;
  else if (p.kind === "number") ctl = html`<input class="input" type="number" step="any" data-f="${path}" data-t="num" data-fk="${fk}" value="${val ?? ""}">`;
  else ctl = html`<input class="input ${p.kind === "expression" ? "mono" : ""}" data-f="${path}" data-fk="${fk}" value="${val ?? ""}" ${raw(LIST_OF[`${scope}.${p.name}`] ? `list="${LIST_OF[`${scope}.${p.name}`]}"` : "")} autocomplete="off" spellcheck="false">`;
  return html`<label class="field"><span class="fl">${label}</span>${ctl}${hint}</label>`;
}

function rows(p, list, path, scope, lk, o) {
  const hdr = p.kind === "headers", dl = scope === "graphic" ? `list="dl-gf-${esc(path)}"` : "";
  const gfx = scope === "graphic" && o.graphicId ? lk.graphics.find((g) => g.id === o.graphicId)?.fields ?? [] : [];
  return html`<fieldset class="rowsfs"><legend>${p.label}${p.hint ? html` <span class="hint">${p.hint}</span>` : ""}</legend>
    ${scope === "graphic" && html`<datalist id="dl-gf-${path}">${gfx.map((f) => html`<option value="${f}"></option>`)}</datalist>`}
    ${list.map((r, i) => html`<div class="kvrow"><input class="input" data-f="${path}.${i}.k" data-fk="fk-${path}.${i}.k" value="${r.k}" placeholder="${hdr ? "Header name" : "Field name"}" aria-label="${p.label} name ${i + 1}" ${raw(dl)} autocomplete="off">
      <input class="input" data-f="${path}.${i}.v" data-fk="fk-${path}.${i}.v" value="${r.v}" placeholder="${hdr && r.hidden ? "Saved and hidden. Type to replace." : hdr ? "Value" : "Text or {{value}}"}" aria-label="${p.label} value ${i + 1}" ${raw(hdr && r.hidden ? 'data-hid="1"' : "")} autocomplete="off">
      <button type="button" class="btn sm ghost" data-a="row-del" data-p="${path}" data-i="${i}" aria-label="Remove ${p.label.toLowerCase()} row ${i + 1}">${icon("x", "sm")}</button></div>`)}
    <button type="button" class="btn sm" data-a="row-add" data-p="${path}" data-fk="fk-add-${path}">${icon("plus", "sm")}Add ${hdr ? "header" : "field"}</button></fieldset>`;
}
function evEditor(p, ev, path, lk) {
  const evs = lk.catalog.triggers.find((t) => t.type === "event").params[0].options.filter((e) => e !== "game.start");
  return html`<fieldset class="rowsfs"><legend>Game event to add <span class="hint">Same as pressing the button on the console.</span></legend>
    <label class="field"><span class="fl">Event</span><select class="select" data-f="${path}.type" data-fk="fk-${path}.type">${evs.map((e) => html`<option ${raw(e === ev.type ? "selected" : "")}>${e}</option>`)}</select></label>
    ${rows({ label: "Details", kind: "fields" }, ev.rows ?? [], `${path}.rows`, "event", lk, {})}</fieldset>`;
}

// ---------------------------------------------------------------- actions <-> draft rows
const DEFAULTS = { graphic: { op: "show" }, "custom.set": { key: "", value: "" }, "custom.clear": { key: "" }, engine: { op: "preview" }, "sponsor.fire": {}, event: { event: { type: "mark" } }, http: { method: "POST", url: "" }, wait: { seconds: 5 }, notice: { level: "info", message: "" }, log: { level: "INFO", message: "" }, macro: { macroId: "" } };
export const newAction = (type) => fromApiAction({ type, ...structuredClone(DEFAULTS[type] ?? {}) });
const toRows = (o) => Object.entries(o ?? {}).map(([k, v]) => ({ k, v: String(v) }));
export function fromApiAction(a, pos) {
  const o = structuredClone(a);
  if (a.type === "http") o._pos = pos; // server keeps hidden header values by step position, so remember where this step came from
  if (a.type === "http") o.headers = Object.entries(a.headers ?? {}).map(([k, v]) => ({ k, v: v === "[hidden]" ? "" : v, hidden: v === "[hidden]" }));
  if (a.type === "graphic") o.fields = toRows(a.fields);
  if (a.type === "event") { const { type, ...rest } = a.event ?? { type: "mark" }; o.event = { type, rows: toRows(rest) }; }
  return o;
}
const scalar = (v) => (v === "true" ? true : v === "false" ? false : v !== "" && !isNaN(+v) ? +v : v);
const fromRows = (rs, sc = false) => Object.fromEntries((rs ?? []).filter((r) => r.k.trim()).map((r) => [r.k.trim(), sc ? scalar(r.v) : r.hidden && r.v === "" ? "[hidden]" : r.v]));
export function toApiAction(a, i = 0, isNew = false) {
  const o = { ...a }; delete o._pos;
  if (a.type === "http") { const moved = isNew || (a._pos !== undefined && a._pos !== i); o.headers = fromRows(moved ? (a.headers ?? []).map((r) => ({ ...r, hidden: false })) : a.headers); if (!Object.keys(o.headers).length) delete o.headers; if (a.method === "GET") delete o.body; }
  if (a.type === "graphic") { if (a.op === "clear") delete o.id; if (a.op !== "update" && a.op !== "show") delete o.fields; else { o.fields = fromRows(a.fields); if (!Object.keys(o.fields).length) delete o.fields; } }
  if (a.type === "event") o.event = { type: a.event.type, ...fromRows(a.event.rows, true) };
  if (a.type === "engine") { const keep = ["type", "op", "label", "continueOnError", ...({ preview: ["sourceId"], fade: ["ms"], replay: ["secondsBack", "speed"], mute: ["id", "muted"] }[a.op] ?? [])]; for (const k of Object.keys(o)) if (!keep.includes(k)) delete o[k]; if (a.op === "mute") o.muted = !!a.muted; }
  for (const k of Object.keys(o)) if (o[k] === "" || o[k] === undefined || (typeof o[k] === "number" && isNaN(o[k])) || o[k] === false && k === "continueOnError") delete o[k];
  return o;
}
export const toApiActions = (l, isNew = false) => l.map((a, i) => toApiAction(a, i, isNew));
/** Header names whose saved (hidden) values cannot follow a step that moved, was copied, or belongs to a new rule. */
export const lostHeaders = (l, isNew = false) => l.flatMap((a, i) => (a.type === "http" && (isNew || (a._pos !== undefined && a._pos !== i)) ? (a.headers ?? []).filter((r) => r.hidden && r.v === "").map((r) => r.k) : []));

// ---------------------------------------------------------------- the ordered action list
export function actionsEditor(actions, lk, opts = {}) {
  const at = lk.catalog.actions;
  return html`<div class="acts">
    ${actions.length ? html`<ol class="actlist" aria-label="Steps, in the order they happen">${actions.map((a, i) => actionCard(a, i, actions.length, lk, opts))}</ol>` : html`<div class="empty sm">${icon("bolt", "xl")}<b>No steps yet</b><span>Add the first thing that should happen.</span></div>`}
    <div class="row addact"><label class="field inl"><span class="fl">Add a step</span><select class="select" data-add-type aria-label="Kind of step to add">${at.map((t) => html`<option value="${t.type}" ${raw(t.type === "graphic" ? "selected" : "")}>${t.label}</option>`)}</select></label>
      <button type="button" class="btn" data-a="act-add" data-fk="fk-act-add">${icon("plus")}Add step</button>
      <span class="hint">Steps run from top to bottom. A step that fails stops the rest, unless you tick "Keep going if this fails".</span></div></div>`;
}
function actionCard(a, i, n, lk, opts) {
  const def = lk.catalog.actions.find((t) => t.type === a.type), base = `actions.${i}`;
  const ps = (def?.params ?? []).filter((p) => needs(a.type, a.op, p.name));
  const hasFirst = ps.length && ps[0].name === "op";
  const body = ps.map((p) => {
    const path = `${base}.${p.name}`, v = p.kind === "fields" || p.kind === "headers" ? a[p.name] : p.name === "event" ? a.event : a[p.name];
    return param(p, v, path, a.type, lk, { repaint: p.name === "op" || p.name === "method", graphicId: a.id, selfId: opts.selfId });
  });
  const wide = ps.filter((p) => ["fields", "headers", "event"].includes(p.kind)).length;
  return html`<li class="act" data-i="${i}"><div class="acthead"><span class="grip" draggable="true" title="Drag to reorder (or use the arrow buttons)" aria-hidden="true">${icon("drag", "sm")}</span><span class="num">${i + 1}</span>
      <label class="field inl"><span class="fl vh">Kind of step ${i + 1}</span><select class="select" data-f="${base}.type" data-t="type" data-i="${i}" data-r="1" data-fk="fk-${base}.type">${lk.catalog.actions.map((t) => html`<option value="${t.type}" ${raw(t.type === a.type ? "selected" : "")}>${t.label}</option>`)}</select></label>
      <span class="sp"></span>
      <button type="button" class="btn sm ghost" data-a="act-up" data-i="${i}" data-fk="fk-up-${i}" aria-label="Move step ${i + 1} up" ${raw(i === 0 ? "disabled" : "")}>${icon("up2", "sm")}</button>
      <button type="button" class="btn sm ghost" data-a="act-down" data-i="${i}" data-fk="fk-down-${i}" aria-label="Move step ${i + 1} down" ${raw(i === n - 1 ? "disabled" : "")}>${icon("down2", "sm")}</button>
      <button type="button" class="btn sm ghost" data-a="act-dup" data-i="${i}" aria-label="Copy step ${i + 1}" title="Copy this step">${icon("plus", "sm")}Copy</button>
      <button type="button" class="btn sm ghost" data-a="act-del" data-i="${i}" aria-label="Delete step ${i + 1}">${icon("x", "sm")}</button></div>
    <div class="actbody ${wide ? "wide" : ""}">${body}</div>
    <div class="actfoot"><label class="field inl"><span class="fl">Note (for you)</span><input class="input" data-f="${base}.label" data-fk="fk-${base}.label" value="${a.label ?? ""}" maxlength="40"></label>
      <label class="chk"><input type="checkbox" data-f="${base}.continueOnError" data-t="bool" data-fk="fk-${base}.coe" ${raw(a.continueOnError ? "checked" : "")}> <span>Keep going if this fails</span></label></div></li>`;
}

// ---------------------------------------------------------------- editor wiring shared by rules and macros
/** Delegated events for a draft that has `actions`. `ed` = {draft(), paint(focusKey), dirty()}. Returns a cleanup. */
export function bindDraft(root, lk, ed) {
  const D = () => ed.draft();
  const coerce = (el) => {
    const t = el.dataset.t, v = el.type === "checkbox" ? el.checked : el.value;
    if (t === "num") return v === "" ? undefined : +v;
    if (t === "list") return String(v).split(/[,\s]+/).filter(Boolean).map(Number).filter((n) => !isNaN(n));
    return v;
  };
  const onInput = (e) => {
    const el = e.target.closest?.("[data-f]"); if (!el || !root.contains(el)) return;
    if (e.type === "input" && el.tagName === "SELECT") return;
    const path = el.dataset.f;
    if (el.dataset.t === "type") { if (e.type !== "change") return; const i = +el.dataset.i; D().actions[i] = newAction(el.value); ed.paint(`fk-actions.${i}.type`); return; }
    let v = coerce(el);
    if (el.dataset.hid) { const r = getp(D(), path.replace(/\.v$/, "")); if (r) r.hidden = false; }
    if (Array.isArray(v) && el.dataset.t === "list" && !v.length) v = undefined;
    setp(D(), path, v);
    if (e.type === "change" && el.dataset.r) ed.paint(el.dataset.fk);
    else ed.changed?.(path, el);
  };
  const move = (i, j) => { const l = D().actions; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; };
  const click = (e) => {
    const b = e.target.closest?.("[data-a]"); if (!b || !root.contains(b) || !D()) return;
    const a = b.dataset.a, i = +b.dataset.i, l = D().actions;
    if (a === "act-add") { const t = root.querySelector("[data-add-type]").value; l.push(newAction(t)); ed.paint(`fk-actions.${l.length - 1}.type`); }
    else if (a === "act-del") { l.splice(i, 1); ed.paint(l.length ? `fk-act-add` : "fk-act-add"); }
    else if (a === "act-dup") { l.splice(i + 1, 0, structuredClone(l[i])); ed.paint(`fk-up-${i + 1}`); }
    else if (a === "act-up") { move(i, i - 1); ed.paint(i > 1 ? `fk-up-${i - 1}` : `fk-down-0`); }
    else if (a === "act-down") { move(i, i + 1); ed.paint(i + 1 < l.length - 1 ? `fk-down-${i + 1}` : `fk-up-${i + 1}`); }
    else if (a === "row-add") { const arr = getp(D(), b.dataset.p) ?? (setp(D(), b.dataset.p, []), getp(D(), b.dataset.p)); arr.push({ k: "", v: "" }); ed.paint(`fk-${b.dataset.p}.${arr.length - 1}.k`); }
    else if (a === "row-del") { getp(D(), b.dataset.p).splice(i, 1); ed.paint(`fk-add-${b.dataset.p}`); }
  };
  let from = null;
  const ds = (e) => { const g = e.target.closest?.(".grip"); if (!g) return; from = +g.closest("[data-i]").dataset.i; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(from)); e.dataTransfer.setDragImage(g.closest(".act"), 10, 10); };
  const dov = (e) => { if (from !== null && e.target.closest?.(".act")) e.preventDefault(); };
  const drop = (e) => { const t = e.target.closest?.(".act"); if (from === null || !t) return; e.preventDefault(); const to = +t.dataset.i, l = D().actions; if (to !== from) { const [x] = l.splice(from, 1); l.splice(to, 0, x); ed.paint(`fk-up-${to}`); } from = null; };
  root.addEventListener("input", onInput); root.addEventListener("change", onInput); root.addEventListener("click", click);
  root.addEventListener("dragstart", ds); root.addEventListener("dragover", dov); root.addEventListener("drop", drop);
  return () => { for (const [t, f] of [["input", onInput], ["change", onInput], ["click", click], ["dragstart", ds], ["dragover", dov], ["drop", drop]]) root.removeEventListener(t, f); };
}
/** Repaint a box and put the keyboard focus back on the control with the same data-fk (or the first button). */
export function repaintBox(box, markup, fk) {
  const sc = box.closest(".scroll"), top = sc?.scrollTop ?? 0, key = fk ?? document.activeElement?.dataset?.fk;
  box.innerHTML = markup; if (sc) sc.scrollTop = top;
  const t = key && [...box.querySelectorAll("[data-fk]")].find((x) => x.dataset.fk === key && !x.disabled);
  if (t) { t.focus({ preventScroll: true }); if (t.setSelectionRange && /text|search|^$/.test(t.type || "")) try { t.setSelectionRange(t.value.length, t.value.length); } catch {} }
}

// ---------------------------------------------------------------- dry run
export function dryView(r, kind = "rule") {
  if (!r) return "";
  if (r.error) return html`<div class="banner err" role="alert">${icon("alert", "lg")}<span><b>This ${kind} cannot be tested yet.</b> <span class="muted">${r.error}</span></span></div>`;
  const reasons = [r.triggerMatches === false && "the \"when\" does not match the sample situation", r.condition && r.condition.result === false && `the condition "${r.condition.text}" is not true`].filter(Boolean);
  return html`<section class="dry" aria-live="polite"><div class="banner ${r.wouldRun || kind === "macro" ? "ok" : "warn"}">${icon(r.wouldRun || kind === "macro" ? "check" : "info", "lg")}<span><b>${kind === "macro" ? "This is what the button would do." : r.wouldRun ? "This rule would run." : "This rule would not run for this sample."}</b> <span class="muted">${reasons.length ? "Because " + reasons.join(" and ") + ". The steps below show what it would do if it did." : "Nothing was shown, sent or saved."}</span></span></div>
    ${r.trigger && html`<p class="muted">When: <b>${r.trigger}</b>${r.condition ? html`. Condition <code>${r.condition.text}</code> is <b>${r.condition.result ? "true" : "false"}</b> with the sample values.` : ""}</p>`}
    <ol class="would">${r.steps.map((s, i) => html`<li style="margin-left:${(s.depth ?? 0) * 18}px"><span class="num sm">${i + 1}</span><span>${s.text}</span></li>`)}</ol>
    ${r.warnings?.length ? html`<div class="banner warn">${icon("alert", "lg")}<div><b>Check these</b><ul class="warns">${r.warnings.map((w) => html`<li>${w}</li>`)}</ul></div></div>` : html`<p class="hint">${icon("check", "sm")} No warnings.</p>`}</section>`;
}

// ---------------------------------------------------------------- the eight examples from the guide
export const EXAMPLES = [
  { id: 1, kind: "rule", title: "Lower third when the home team hits a 3", blurb: "Shows a lower third for 6 seconds, then hides it.",
    rule: { name: "Home three: lower third", trigger: { type: "event", event: "score", team: "home", points: [3] }, when: "event.team == 'home'", actions: [{ type: "graphic", op: "show", id: "builtin-lowerthird", fields: { title: "{{home.abbr}} hits a three!" } }, { type: "wait", seconds: 6 }, { type: "graphic", op: "hide", id: "builtin-lowerthird" }] } },
  { id: 2, kind: "rule", title: "Ticker text from a custom field", blurb: "Changes the text in your ticker whenever a timeout is called.", needs: [{ key: "tickerText", label: "Ticker text", type: "text" }],
    rule: { name: "Timeout: ticker text", trigger: { type: "event", event: "timeout" }, actions: [{ type: "custom.set", key: "tickerText", value: "Timeout {{event.team}}. Score {{home.score}} to {{away.score}}" }] } },
  { id: 3, kind: "webhook", title: "Tell Companion about every timeout", blurb: "Sends a web message to another program when a timeout happens.", webhook: { name: "Companion", url: "", events: ["game.timeout"], enabled: true } },
  { id: 4, kind: "rule", title: "Replay when the home team scores late", blurb: "Home score in the last minute of period 4: wait 2 seconds, then a 10 second replay. At most once every 20 seconds.",
    rule: { name: "Late home score: replay", trigger: { type: "event", event: "score", team: "home" }, when: "clock <= 60000 and period == 4", cooldownSec: 20, actions: [{ type: "wait", seconds: 2 }, { type: "engine", op: "replay", secondsBack: 10, speed: 1 }] } },
  { id: 5, kind: "rule", title: "Fire a sponsor at every timeout", blurb: "Uses the sponsor that is due. Your sponsor rules still apply.",
    rule: { name: "Timeout: sponsor", trigger: { type: "event", event: "timeout" }, actions: [{ type: "sponsor.fire" }] } },
  { id: 6, kind: "rule", title: "One-minute warning, once per period", blurb: "Shows a notice when one minute is left in each period.",
    rule: { name: "One minute left", trigger: { type: "clock", atSec: 60 }, actions: [{ type: "notice", level: "info", message: "One minute left in period {{period}}" }] } },
  { id: 7, kind: "rule", title: "A camera dropped", blurb: "Warns you and puts another camera in preview.",
    rule: { name: "Camera dropped", trigger: { type: "engine", event: "source.dropped" }, actions: [{ type: "notice", level: "warn", message: "{{source.label}} dropped" }, { type: "engine", op: "preview", sourceId: "cam1", continueOnError: true }] } },
  { id: 8, kind: "macro", title: "A big Goal horn button with a key", blurb: "Turns a custom field on for 3 seconds. Red button, bell icon, key Shift+H.", needs: [{ key: "horn", label: "Horn", type: "text", default: "off" }],
    macro: { label: "Goal horn", color: "#E5484D", icon: "bell", hotkey: "Shift+H", actions: [{ type: "custom.set", key: "horn", value: "on" }, { type: "wait", seconds: 3 }, { type: "custom.set", key: "horn", value: "off" }] } },
];
