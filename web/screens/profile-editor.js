// Settings > Sport profiles: the list of sports (built-in, yours, import and export) and the plain-language profile editor.
// Data model and rules: src/profiles/types.ts, docs/dev/profiles.md. Every error message comes from the API (src/profiles/validate.ts).
// The editor edits a "draft" (numbers kept as typed so a box can be empty), turns it into a profile on Save, and previews the console
// buttons with the same helpers the console uses (web/sport.js).
import { html, raw, icon, api, S, toast, fail } from "../app.js";
import "../sport.js";
import { delegate, all, sw } from "./settings-ui.js";

const SP = globalThis.FHSport;
const errOf = (e) => (e?.message || String(e));
const n = (v) => (v === "" || v == null ? undefined : Number(v)); // empty box = "not set"; the API says what is wrong with anything else
const lc = (s) => String(s).toLowerCase();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export const CSS = SP.CSS + `
.pe{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(300px,1fr);gap:16px;align-items:start}.pe .pcol{display:grid;gap:16px;min-width:0}
.pe .sticky{position:sticky;top:12px;display:grid;gap:16px}
.pl{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:14px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--line)}.pl:last-child{border-bottom:0}
.pl .acts{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}.pl .sub{font-size:12.5px;color:var(--text-2)}
.pl input[type=radio]{width:18px;height:18px;accent-color:var(--action);margin:0}
.pl .nm{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-weight:650;font-size:15px}
.stg a.btn,.pe a.btn{text-decoration:none}
.pe .row2 .input{width:auto}.pe .row2 select.input{min-width:180px}.pe .row2 input.input[type=text]{width:220px}
.pe .row2 .w{width:100%}
.pe .input,.pe select.input{box-sizing:border-box}.pe .sub2{padding:10px 16px 12px;border-bottom:1px solid var(--line);display:grid;gap:8px}.pe .sub2:last-child{border-bottom:0}
.pe .names{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px}.pe .names>div{min-width:0}.pe .names label{font-size:11.5px;color:var(--text-3)}
.pe .names .input{width:100%}
.pe .opt{display:grid;grid-template-columns:minmax(0,1fr) 84px 64px auto;gap:8px;align-items:end;padding:8px 16px;border-bottom:1px solid var(--line)}.pe .opt:last-of-type{border-bottom:0}
.pe .opt .input{width:100%}.pe .opt label{font-size:11.5px;color:var(--text-3);display:block;margin-bottom:3px}
.pe .card2{padding:12px 16px;border-bottom:1px solid var(--line);display:grid;gap:10px}.pe .card2:last-of-type{border-bottom:0}
.pe .g3{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}.pe .g3 .input{width:100%}.pe .g3 label{font-size:11.5px;color:var(--text-3);display:block;margin-bottom:3px}
.pe .thr{display:flex;align-items:end;gap:8px}.pe .thr .input{width:100%}.pe .thr label{font-size:11.5px;color:var(--text-3);display:block;margin-bottom:3px}
.topErr{margin-bottom:12px;padding:10px 14px;border-radius:8px;background:var(--program-wash);border:1px solid #6b2029;color:#FF8A8E;font-weight:600}.topErr:empty{display:none}
.pe .head{display:flex;align-items:center;gap:8px}
.pebar{position:sticky;bottom:0;display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--raised);border:1px solid var(--line-strong);border-radius:10px;z-index:3}
.pv .gs{display:grid;gap:10px;padding:12px}.pv .gs3{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.pv .gs3 .lbl{min-width:76px}
.pv .clockbox .led,.pv .score-block .led{font-size:40px}.pv .score-block{position:relative}.pv .nm .tn{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pv .bn2{position:absolute;left:12px;top:44px;font-size:11px;font-weight:800;letter-spacing:.07em;color:var(--caution)}
.pv .setsum{display:flex;align-items:center;gap:10px;padding:8px 12px;border:1px solid var(--line-strong);border-radius:8px;background:#06090f}.pv .setsum .led{font-size:26px}
.pv .keys{font-size:12.5px;color:var(--text-2);padding:0 12px 12px}.pv .keys b{color:var(--text)}
.pv .plab{font-size:24px;font-weight:700}
.pv .seg{flex-wrap:wrap}.pv [inert]{pointer-events:none}
@media (max-width:1100px){.pe{grid-template-columns:minmax(0,1fr)}.pe .sticky{position:static}}`;

// ---------------------------------------------------------------- draft <-> profile
const BLANK = () => ({ name: "", sport: "", starters: 0, periods: { count: 2, names: ["1st half", "2nd half"], lengthMin: 20, overtime: { enabled: false, lengthMin: 5, namePrefix: "OT" } }, clock: { mode: "down", displayFormat: "mm:ss" }, scoring: [{ id: "point", label: "Point", points: 1 }], counters: [], periodLabelFormat: "Period {n}" });
function toDraft(p) {
  const d = structuredClone(p);
  d._orig = structuredClone(p); // fields the editor does not show (clock stop hints, graphics flags) travel with it
  d.periods.names = Array.from({ length: d.periods.count }, (_, i) => d.periods.names?.[i] ?? "");
  d.periods.lengthMin ??= "";
  d.clock.carryOver ??= true; d.clock.maxMin ??= "";
  d.counters = d.counters.map((c) => ({ ...c, limit: c.limit ?? "", startValue: c.startValue ?? 0, thresholds: (c.thresholds || []).map((t) => ({ ...t })), applyTo: c.thresholdsApplyTo || "self", reset: c.resetAtPeriods?.length ? "at" : c.resetEachPeriod ? "each" : "never", resetAt: (c.resetAtPeriods || []).join(", ") }));
  d.scoring = d.scoring.map((s) => ({ ...s, hotkey: s.hotkey || "" }));
  d.win = p.win ? { enabled: true, points: p.win.points, winBy: p.win.winBy, cap: p.win.cap ?? "", decidingPoints: p.win.decidingPoints ?? "", setsToWin: p.win.setsToWin } : { enabled: false, points: 25, winBy: 2, cap: "", decidingPoints: "", setsToWin: 2 };
  d.sbc = p.sponsorBreakCounter || "";
  return d;
}
// Ids are the stable keys the engine and old logs use; people only see labels. New rows get an id made from the label.
const slug = (s, taken, fallback) => { let b = lc(s).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20); if (!/^[a-z]/.test(b)) b = fallback; let id = b, k = 2; while (taken.has(id)) id = b + "_" + k++; taken.add(id); return id; };
function fromDraft(d) {
  const o = d._orig || {}, mode = d.clock.mode, count = n(d.periods.count), fmt = d.periodLabelFormat || "Period {n}";
  const names = d.periods.names.slice(0, count || 0).map((x, i) => x.trim() || fmt.replace("{n}", i + 1));
  const p = {
    name: d.name, sport: d.sport || d.name, starters: n(d.starters) ?? 0,
    periods: { count, ...(d.periods.names.some((x) => x.trim()) && { names }), ...(mode !== "none" && { lengthMin: n(d.periods.lengthMin) }), overtime: { enabled: !!d.periods.overtime.enabled, lengthMin: n(d.periods.overtime.lengthMin) ?? 1, namePrefix: d.periods.overtime.namePrefix || "OT" } },
    clock: { mode, displayFormat: d.clock.displayFormat, ...(mode === "up" && { carryOver: !!d.clock.carryOver, ...(n(d.clock.maxMin) !== undefined && { maxMin: n(d.clock.maxMin) }) }), ...(mode !== "none" && o.clock?.stopsOn && { stopsOn: o.clock.stopsOn }) },
    periodLabelFormat: fmt,
  };
  const taken = new Set(d.scoring.map((s) => s.id).filter(Boolean));
  p.scoring = d.scoring.map((s, i) => ({ id: s.id || slug(s.label, taken, "score"), label: s.label, points: n(s.points), ...(s.hotkey && { hotkey: s.hotkey }) }));
  const ct = new Set(d.counters.map((c) => c.id).filter(Boolean));
  p.counters = d.counters.map((c) => {
    const th = c.thresholds.filter((t) => t.at !== "" || t.label !== "").map((t) => ({ at: n(t.at), label: t.label }));
    return { id: c.id || slug(c.label, ct, "counter"), label: c.label, perTeam: true, startValue: n(c.startValue) ?? 0, ...(n(c.limit) !== undefined && { limit: n(c.limit) }), resetEachPeriod: c.reset === "each",
      ...(c.reset === "at" && { resetAtPeriods: String(c.resetAt).split(/[,\s]+/).filter(Boolean).map(Number) }), ...(th.length && { thresholds: th, thresholdsApplyTo: c.applyTo }), showAs: c.showAs };
  });
  if (d.win.enabled) p.win = { points: n(d.win.points), winBy: n(d.win.winBy), setsToWin: n(d.win.setsToWin), ...(n(d.win.cap) !== undefined && { cap: n(d.win.cap) }), ...(n(d.win.decidingPoints) !== undefined && { decidingPoints: n(d.win.decidingPoints) }) };
  if (d.sbc && p.counters.some((c) => c.id === d.sbc)) p.sponsorBreakCounter = d.sbc;
  p.display = { clock: mode !== "none", period: o.display?.period ?? true, counters: p.counters.length > 0 };
  return p;
}
const dirty = (d) => !same(stripped(d), d._base);
const stripped = (d) => { const { _orig, _base, ...x } = d; return x; };

/** A forgiving ProfileSummary of the draft, so the preview works while the form is half filled in. */
function previewSport(d) {
  const count = Math.min(12, Math.max(1, Math.round(Number(d.periods.count)) || 1)), fmt = d.periodLabelFormat || "Period {n}";
  const labels = Array.from({ length: count }, (_, i) => (d.periods.names[i] || "").trim() || fmt.replace("{n}", i + 1));
  if (d.periods.overtime.enabled) labels.push(d.periods.overtime.namePrefix || "OT");
  return {
    name: d.name || "This sport", scoring: d.scoring.map((s, i) => ({ id: s.id || "s" + i, label: s.label || "Score", points: Math.max(1, Math.round(Number(s.points)) || 1), hotkey: s.hotkey || undefined })),
    counters: d.counters.map((c, i) => ({ id: c.id || "c" + i, label: c.label || "Counter", startValue: Math.max(0, Number(c.startValue) || 0), limit: Number(c.limit) || undefined, showAs: c.showAs, thresholds: c.thresholds.filter((t) => Number(t.at) > 0).map((t) => ({ at: Number(t.at), label: t.label || "" })) })),
    periodLabels: labels, periodCount: count, overtime: !!d.periods.overtime.enabled, clockMode: d.clock.mode,
    win: d.win.enabled ? { points: Number(d.win.points) || 25, setsToWin: Number(d.win.setsToWin) || 2 } : null,
  };
}
function previewHtml(d) {
  const sp = previewSport(d), sc = S.state?.settings?.shortcuts || {}, keys = SP.scoreKeys(sp, sc);
  const nameCtr = sp.counters.find((c) => c.id === "fouls" && c.showAs === "pips"), rows = sp.counters.filter((c) => c !== nameCtr);
  const clock = sp.clockMode === "none" ? html`<div class="clockbox"><div><span class="lbl">Now playing</span><div class="plab">${sp.periodLabels[0]}</div></div><span class="muted">No clock</span></div>`
    : html`<div class="clockbox"><span class="led">${sp.clockMode === "down" ? String(Math.max(0, Math.round(Number(d.periods.lengthMin)) || 0)).padStart(2, "0") + ":00" : "00:00"}</span><span class="muted">${sp.clockMode === "down" ? "Counts down" : "Counts up"}</span></div>`;
  const kl = (k) => k.replace("Shift+", "⇧ ").toUpperCase();
  return html`<div class="gs">
      <div class="seg" role="group" aria-label="Periods">${sp.periodLabels.map((l, i) => html`<span class="${i === 0 ? "on" : ""}">${l}</span>`)}</div>
      ${clock}
      ${sp.win ? html`<div class="setsum"><span class="lbl">Sets won</span><span class="led">0</span><span class="muted">to</span><span class="led">0</span><span class="muted">first to ${sp.win.setsToWin}</span></div>` : ""}
      <div class="score-block" data-team="home"><div class="nm"><i style="background:var(--home)"></i><span class="tn">Home team</span>${nameCtr ? raw(SP.ctl(nameCtr, "home", { inName: true })) : ""}</div><div class="led">0</div>${raw(SP.plusRow(sp, "home", (t, i) => sp.scoring[i].label))}</div>
      ${rows.map((c) => html`<div class="gs3"><span class="lbl">${c.label}</span>${raw(SP.ctl(c, "home"))}</div>`)}
    </div>
    <div class="keys">${keys.length ? html`Keys: ${keys.filter((k) => k.team === "home").map((k, i) => html`${i ? ", " : ""}<b>${kl(k.key)}</b> ${sp.scoring[k.i].label}`)} for the home team${keys.some((k) => k.team === "away") ? ", the matching keys for the away team" : ""}.` : "No keys are set for these scoring buttons."}</div>`;
}
function fillPreview(root, d) {
  const box = root.querySelector("[data-preview]"); if (!box) return;
  box.innerHTML = previewHtml(d).s;
  const sp = previewSport(d);
  SP.patchCtl(box, sp, { counters: Object.fromEntries(sp.counters.map((c) => [c.id, { home: c.startValue }])), thresholds: {} }, () => "Home team", true);
}

// ---------------------------------------------------------------- list view
const chip = (cls, t) => html`<span class="chip ${cls}">${t}</span>`;
function listView(data) {
  const rows = data.list.map((p) => {
    const del = !p.builtin && p.id !== data.defaultId;
    return html`<div class="pl"><input type="radio" name="dflt" data-act="default" data-id="${p.id}" ${p.id === data.defaultId ? "checked" : ""} aria-label="Use ${p.name} for new games" title="Use this sport for new games">
      <div style="min-width:0"><div class="nm">${p.name}${p.builtin && chip("", "Built in")}${p.modified && chip("warn", "Edited")}${p.id === data.defaultId && chip("ok", "Default")}</div>
        <div class="sub">${p.sport}. ${SP.describe(p)}</div></div>
      <div class="acts"><button class="btn sm" data-act="edit" data-id="${p.id}">Edit</button><button class="btn sm ghost" data-act="dup" data-id="${p.id}">Duplicate</button>
        <a class="btn sm ghost" href="/api/profiles/${encodeURIComponent(p.id)}/export" download>Export</a>
        ${p.modified && html`<button class="btn sm ghost" data-act="reset" data-id="${p.id}">Reset</button>`}
        ${!p.builtin && html`<button class="btn sm ghost" data-act="del" data-id="${p.id}" ${del ? "" : "disabled"} title="${del ? "" : "Choose another default sport first"}">Delete</button>`}</div></div>`;
  });
  return html`<div class="banner info">${icon("info", "lg")}<span><b>Games you have already started keep their own rules.</b> <span class="muted">Changing or deleting a sport here only affects games you start from now on.</span></span></div>
    <div class="panel"><div class="ph"><h3>Sport profiles</h3><span class="sp"></span><input type="file" id="imp" accept=".json,application/json" hidden aria-label="Import a sport file"><button class="btn sm" data-act="import">Import file</button><button class="btn sm pri" data-act="new">${icon("plus", "sm")}New sport</button></div>
      <div role="radiogroup" aria-label="Sport used for new games">${rows}</div>
      <div class="hint" style="padding:10px 16px">The selected sport is the one new games start with. You can pick a different sport for each game when you set it up.</div></div>
    <div class="hint err" role="alert" data-err>${data.err || ""}</div>`;
}

// ---------------------------------------------------------------- editor view
const field = (label, hint, ctl) => html`<div class="row2"><div><b>${label}</b>${hint && html`<div class="muted" style="font-size:12px">${hint}</div>`}</div><div class="row" style="gap:8px">${ctl}</div></div>`;
const numIn = (path, v, label, o = {}) => html`<input class="input mono" type="number" inputmode="numeric" step="1" min="${o.min ?? 0}" max="${o.max ?? 999}" style="width:${o.w ?? 84}px" data-p="${path}" value="${v ?? ""}" aria-label="${label}" ${o.ph ? raw(`placeholder="${o.ph}"`) : ""}>`;
const txtIn = (path, v, label, o = {}) => html`<input class="input" type="text" maxlength="${o.max ?? 40}" data-p="${path}" value="${v ?? ""}" aria-label="${label}" placeholder="${o.ph ?? ""}">`;
const withId = (h, id) => raw(h.s.replace(/^<(input|select)/, `<$1 id="${id}"`)); // labels point at their box
const sel = (path, v, opts, label) => html`<select class="input" data-p="${path}" aria-label="${label}">${opts.map(([k, t]) => html`<option value="${k}" ${k === v ? "selected" : ""}>${t}</option>`)}</select>`;

function namesView(d) {
  return html`${d.periods.names.map((x, i) => html`<div><label for="pn${i}">Period ${i + 1}</label><input id="pn${i}" class="input" type="text" maxlength="24" data-p="periods.names.${i}" value="${x}" placeholder="${(d.periodLabelFormat || "Period {n}").replace("{n}", i + 1)}"></div>`)}`;
}
function scoringView(d) {
  return html`${d.scoring.map((s, i) => html`<div class="opt"><div><label for="sl${i}">Button name</label><input id="sl${i}" class="input" type="text" maxlength="24" data-p="scoring.${i}.label" value="${s.label}" placeholder="Touchdown"></div>
      <div><label for="sp${i}">Points</label>${withId(numIn(`scoring.${i}.points`, s.points, "Points", { min: 1, max: 99 }), "sp" + i)}</div>
      <div><label for="sk${i}">Key</label><input id="sk${i}" class="input mono" type="text" maxlength="1" data-p="scoring.${i}.hotkey" value="${s.hotkey}" placeholder="-" aria-label="Keyboard key for ${s.label || "this button"}"></div>
      <button class="btn sm ghost" data-act="rm-score" data-i="${i}" ${d.scoring.length < 2 ? "disabled" : ""} aria-label="Remove ${s.label || "this scoring button"}">${icon("x", "sm")}Remove</button></div>`)}
    <div class="sub2"><div><button class="btn sm" data-act="add-score" ${d.scoring.length >= 8 ? "disabled" : ""}>${icon("plus", "sm")}Add a way to score</button> <span class="muted" style="font-size:12px">Up to 8. Two buttons may give the same points (touchdown and safety are different words).</span></div>
      <div class="hint">Key: a letter or number. For the home team it scores directly; Shift plus the letter scores for the away team. Leave empty to use the usual +1, +2, +3 keys.</div></div>`;
}
function thrView(d, ci) {
  const c = d.counters[ci];
  return html`${c.thresholds.map((t, ti) => html`<div class="thr"><div style="width:84px"><label for="th${ci}-${ti}">When it reaches</label>${withId(numIn(`counters.${ci}.thresholds.${ti}.at`, t.at, "Count that shows the label", { min: 1, max: 99 }), `th${ci}-${ti}`)}</div>
      <div style="flex:1;min-width:0"><label for="tl${ci}-${ti}">Show the words</label><input id="tl${ci}-${ti}" class="input" type="text" maxlength="24" data-p="counters.${ci}.thresholds.${ti}.label" value="${t.label}" placeholder="Bonus"></div>
      <button class="btn sm ghost" data-act="rm-thr" data-i="${ci}" data-t="${ti}" aria-label="Remove this label">${icon("x", "sm")}</button></div>`)}
    <div class="row"><button class="btn sm" data-act="add-thr" data-i="${ci}" ${c.thresholds.length >= 4 ? "disabled" : ""}>${icon("plus", "sm")}Show words at a count</button>
      ${c.thresholds.length > 0 && html`<span class="row" style="gap:8px"><label for="ap${ci}" class="muted" style="font-size:12.5px">Counted from</label>${withId(sel(`counters.${ci}.applyTo`, c.applyTo, [["self", "this team's own count"], ["opponent", "the other team's count"]], "Whose count shows the words"), "ap" + ci)}</span>`}</div>`;
}
function countersView(d) {
  return html`${d.counters.map((c, i) => html`<div class="card2"><div class="head"><b style="flex:1">${c.label || "New counter"}</b><button class="btn sm ghost" data-act="rm-counter" data-i="${i}">${icon("x", "sm")}Remove</button></div>
      <div class="g3"><div><label for="cl${i}">Name</label><input id="cl${i}" class="input" type="text" maxlength="24" data-p="counters.${i}.label" value="${c.label}" placeholder="Yellow cards"></div>
        <div><label for="cs${i}">Starts at</label>${withId(numIn(`counters.${i}.startValue`, c.startValue, "Starting number", { max: 99 }), "cs" + i)}</div>
        <div><label for="cm${i}">Highest allowed</label>${withId(numIn(`counters.${i}.limit`, c.limit, "Highest allowed number, empty for no limit", { min: 1, max: 99, ph: "none" }), "cm" + i)}</div>
        <div><label for="ca${i}">Shown as</label>${withId(sel(`counters.${i}.showAs`, c.showAs, [["pips", "Dots"], ["number", "Number"]], "How to show it"), "ca" + i)}</div>
        <div><label for="cr${i}">Starts over</label>${withId(sel(`counters.${i}.reset`, c.reset, [["never", "Never"], ["each", "Every period"], ["at", "At certain periods"]], "When it starts over"), "cr" + i)}</div>
        <div ${c.reset === "at" ? "" : "hidden"} data-sh="reset-at-${i}"><label for="cp${i}">Periods (like 3)</label><input id="cp${i}" class="input mono" type="text" data-p="counters.${i}.resetAt" value="${c.resetAt}" placeholder="3"></div></div>
      <div class="hint">${(Number(c.startValue) || 0) > 0 ? "Starts above 0, so it counts what is left: each tap on the console uses one (like timeouts)." : "Starts at 0, so each tap on the console adds one (like fouls and cards)."}</div>
      ${thrView(d, i)}</div>`)}
    <div class="sub2"><div><button class="btn sm" data-act="add-counter" ${d.counters.length >= 12 ? "disabled" : ""}>${icon("plus", "sm")}Add a counter</button> <span class="muted" style="font-size:12px">Each team gets its own. Up to 12.</span></div>
      ${d.counters.length > 0 && html`<div class="row"><label for="sbc" class="muted" style="font-size:12.5px">A sponsor break can start when someone uses</label>${withId(sel("sbc", d.sbc, [["", "Timeouts (if this sport has them)"], ...d.counters.map((c) => [c.id || c.label, c.label || "(unnamed)"])], "Counter that starts a sponsor break"), "sbc")}</div>`}</div>`;
}

function editView(data) {
  const d = data.draft, isB = !!d._orig?.builtin;
  return html`<div class="topErr" role="alert" data-err>${data.err || ""}</div><div class="banner info" style="margin-bottom:16px">${icon("info", "lg")}<span><b>Games you have already started keep their own rules.</b> <span class="muted">${isB ? "This is a built-in sport. Your changes are saved on top of it, and Reset on the list brings the original back. " : ""}Your changes apply to games you start from now on.</span></span></div>
    <div class="pe">
    <div class="pcol">
      <div class="panel"><div class="ph"><h3>${data.isNew ? "New sport" : "Sport"}</h3></div>
        ${field("Name", "Shown in lists and when you set up a game (up to 40 letters)", txtIn("name", d.name, "Profile name", { ph: "Ultimate frisbee" }))}
        ${field("Sport", "The short word for the sport (up to 24 letters)", txtIn("sport", d.sport, "Sport label", { max: 24, ph: "Frisbee" }))}
        ${field("Players per side to start", "Used by the pre-game check. 0 means do not check.", numIn("starters", d.starters, "Starters per side", { max: 30 }))}</div>
      <div class="panel"><div class="ph"><h3>Periods and clock</h3></div>
        ${field("Number of periods", "Quarters, halves, sets, innings (1 to 12)", numIn("periods.count", d.periods.count, "Number of periods", { min: 1, max: 12 }))}
        <div class="sub2"><b>Period names</b><div class="names" data-sec="names">${namesView(d)}</div>
          <div class="row" style="gap:8px"><label for="plf" class="muted" style="font-size:12.5px">A period with no name above is called</label><input id="plf" class="input" type="text" maxlength="24" style="width:150px" data-p="periodLabelFormat" value="${d.periodLabelFormat}"><span class="muted" style="font-size:12px">{n} becomes the number</span></div></div>
        ${field("Clock", "", sel("clock.mode", d.clock.mode, [["down", "Counts down from the period length"], ["up", "Counts up and keeps going"], ["none", "No clock"]], "Clock"))}
        <div data-vis="clock">${field("Minutes per period", "", numIn("periods.lengthMin", d.periods.lengthMin, "Minutes per period", { min: 1, max: 180 }))}
          ${field("Clock shows", "", sel("clock.displayFormat", d.clock.displayFormat, [["mm:ss", "08:00"], ["m:ss", "8:00"], ["tenths", "0:09.4 in the last minute"]], "Clock format"))}</div>
        <div data-vis="up">${field("Later periods carry on", "A second half starts at 45:00, not 0:00", sw(d.clock.carryOver, "tog-carry", "Later periods carry on from the earlier clock"))}
          ${field("Stop the clock at", "Minutes. Leave empty to keep going.", numIn("clock.maxMin", d.clock.maxMin, "Clock cap in minutes", { min: 1, max: 600, ph: "none" }))}</div>
        ${field("Overtime", "Extra periods when the game is tied", sw(d.periods.overtime.enabled, "tog-ot", "Overtime periods"))}
        <div data-vis="ot">${field("Overtime length", "Minutes. Sets-based sports can use 1.", numIn("periods.overtime.lengthMin", d.periods.overtime.lengthMin, "Overtime minutes", { min: 1, max: 180 }))}
          ${field("Overtime name", "", txtIn("periods.overtime.namePrefix", d.periods.overtime.namePrefix, "Overtime name", { max: 8 }))}</div></div>
      <div class="panel"><div class="ph"><h3>Scoring buttons</h3></div><div data-sec="scoring">${scoringView(d)}</div></div>
      <div class="panel"><div class="ph"><h3>Counters</h3><span class="sp"></span><span class="muted" style="font-size:12px">Fouls, timeouts, cards, penalties</span></div><div data-sec="counters">${countersView(d)}</div></div>
      <div class="panel"><div class="ph"><h3>Played in sets</h3></div>
        ${field("Each period is a set", "Volleyball, badminton, table tennis: the game records each set and starts the next at 0-0", sw(d.win.enabled, "tog-win", "Played in sets"))}
        <div data-vis="sets">${field("Points to win a set", "", numIn("win.points", d.win.points, "Points to win a set", { min: 1, max: 99 }))}
          ${field("Win by", "Lead needed (2 means no win at 25-24)", numIn("win.winBy", d.win.winBy, "Winning margin", { min: 1, max: 10 }))}
          ${field("Hard stop at", "Optional. First to this wins whatever the lead (badminton 30)", numIn("win.cap", d.win.cap, "Point cap", { min: 1, max: 200, ph: "none" }))}
          ${field("Last set is played to", "Optional (volleyball 15)", numIn("win.decidingPoints", d.win.decidingPoints, "Points in the deciding set", { min: 1, max: 99, ph: "same" }))}
          ${field("Sets to win the match", "Best of 5 is 3", numIn("win.setsToWin", d.win.setsToWin, "Sets to win the match", { min: 1, max: 10 }))}</div></div>
    </div>
    <div class="pcol"><div class="sticky"><div class="panel pv"><div class="ph"><h3>Console preview</h3></div><div role="img" aria-label="Preview of the console buttons for this sport" inert data-preview></div></div>
      <div class="hint">The preview updates as you type. It shows the buttons the console and the phone remote will draw for this sport.</div></div></div>
    </div>
    <div class="pebar"><span class="hint err" role="alert" data-err style="flex:1">${data.err || ""}</span><button class="btn" data-act="cancel">Cancel</button><button class="btn pri" data-act="save" ${data.busy ? "disabled" : ""}>${data.isNew ? "Create sport" : "Save sport"}</button></div>`;
}

// ---------------------------------------------------------------- section
const view = (data) => (data.draft ? editView(data) : listView(data));
function syncVis(root, d) {
  const set = (k, on) => root.querySelectorAll(`[data-vis="${k}"]`).forEach((e) => { e.hidden = !on; });
  set("clock", d.clock.mode !== "none"); set("up", d.clock.mode === "up"); set("ot", !!d.periods.overtime.enabled); set("sets", !!d.win.enabled);
  d.counters.forEach((c, i) => { const e = root.querySelector(`[data-sh="reset-at-${i}"]`); if (e) e.hidden = c.reset !== "at"; });
}
const setPath = (o, path, v) => { const k = path.split("."), last = k.pop(); const t = k.reduce((a, x) => a[x], o); t[last] = v; };

export const sport = {
  async load() {
    const [list, settings] = await Promise.all([api.get("/profiles"), api.get("/settings")]);
    return { list, defaultId: settings.defaultProfileId || "basketball", draft: null, err: "", busy: false, isNew: false };
  },
  render: (ctx, data) => html`<div class="cp" data-box>${view(data)}</div>`,
  bind(root, ctx, data) {
    const box = () => root.querySelector("[data-box]");
    const paint = () => { box().innerHTML = view(data).s; if (data.draft) { syncVis(root, data.draft); fillPreview(root, data.draft); } };
    const err = (m) => { data.err = m || ""; root.querySelectorAll("[data-err]").forEach((e) => { e.textContent = data.err; }); };
    const refresh = async () => { data.list = await api.get("/profiles"); data.defaultId = (await api.get("/settings")).defaultProfileId || "basketball"; };
    const sec = (name, fn) => { const e = root.querySelector(`[data-sec="${name}"]`); if (e) e.innerHTML = fn(data.draft).s; };
    const open = (p, isNew) => { const d = toDraft(p); d._base = stripped(d); data.draft = d; data.isNew = isNew; err(""); paint(); window.scrollTo?.(0, 0); document.getElementById("screen")?.scrollTo?.(0, 0); root.querySelector('[data-p="name"]')?.focus(); };
    const focus = (sel) => root.querySelector(sel)?.focus();
    const upd = () => { syncVis(root, data.draft); fillPreview(root, data.draft); };
    const run = async (fn) => { err(""); try { await fn(); } catch (e) { err(errOf(e)); fail(e); } };

    const a = delegate(root, "click", "act", {
      default: (el) => run(async () => { await api.put("/settings", { defaultProfileId: el.dataset.id }); await refresh(); paint(); toast("New games will start with " + data.list.find((p) => p.id === el.dataset.id)?.name + "."); }),
      edit: (el) => open(data.list.find((p) => p.id === el.dataset.id), false),
      new: () => open({ ...BLANK(), id: "", builtin: false }, true),
      dup: (el) => run(async () => { const src = data.list.find((p) => p.id === el.dataset.id); const c = await api.post("/profiles", { duplicateOf: src.id, name: `${src.name} copy` }); await refresh(); paint(); toast(`Made a copy: ${c.name}.`); }),
      reset: (el) => { const p = data.list.find((x) => x.id === el.dataset.id); if (!confirm(`Put the original ${p.name} rules back? Your changes to it will be lost. Games already started keep their own rules.`)) return; run(async () => { await api.post(`/profiles/${p.id}/reset`); await refresh(); paint(); toast(`${p.name} is back to the original rules.`); }); },
      del: (el) => { const p = data.list.find((x) => x.id === el.dataset.id); if (!confirm(`Delete ${p.name}? Games already started with it keep their rules.`)) return; run(async () => { await api.del(`/profiles/${p.id}`); await refresh(); paint(); toast(`Deleted ${p.name}.`); }); },
      import: () => root.querySelector("#imp").click(),
      cancel: () => { if (data.draft && dirty(data.draft) && !confirm("Leave without saving your changes?")) return; data.draft = null; err(""); paint(); },
      save: () => run(async () => {
        err(""); const d = data.draft, body = fromDraft(d); data.busy = true;
        try {
          const saved = data.isNew ? await api.post("/profiles", body) : await api.put(`/profiles/${d._orig.id}`, body);
          await refresh(); data.draft = null; data.busy = false; paint(); toast(`Saved ${saved.name}. New games use these rules.`);
        } catch (e) { data.busy = false; throw e; }
      }),
      "tog-carry": () => { const d = data.draft; d.clock.carryOver = !d.clock.carryOver; paint(); },
      "tog-ot": () => { const d = data.draft; d.periods.overtime.enabled = !d.periods.overtime.enabled; paint(); },
      "tog-win": () => { const d = data.draft; d.win.enabled = !d.win.enabled; paint(); },
      "add-score": () => { const d = data.draft; d.scoring.push({ id: "", label: "", points: 1, hotkey: "" }); sec("scoring", scoringView); upd(); focus(`[data-p="scoring.${d.scoring.length - 1}.label"]`); },
      "rm-score": (el) => { data.draft.scoring.splice(+el.dataset.i, 1); sec("scoring", scoringView); upd(); },
      "add-counter": () => { const d = data.draft; d.counters.push({ id: "", label: "", perTeam: true, startValue: 0, limit: "", showAs: "number", thresholds: [], applyTo: "self", reset: "never", resetAt: "" }); sec("counters", countersView); upd(); focus(`[data-p="counters.${d.counters.length - 1}.label"]`); },
      "rm-counter": (el) => { data.draft.counters.splice(+el.dataset.i, 1); sec("counters", countersView); upd(); },
      "add-thr": (el) => { const c = data.draft.counters[+el.dataset.i]; c.thresholds.push({ at: "", label: "" }); sec("counters", countersView); upd(); focus(`[data-p="counters.${el.dataset.i}.thresholds.${c.thresholds.length - 1}.at"]`); },
      "rm-thr": (el) => { data.draft.counters[+el.dataset.i].thresholds.splice(+el.dataset.t, 1); sec("counters", countersView); upd(); },
    });
    // typing: write into the draft and refresh the preview only (the form is not redrawn, so focus stays put)
    const onInput = (e) => {
      const el = e.target, p = el.dataset?.p; if (!p || !data.draft) return;
      setPath(data.draft, p, el.value);
      if (p === "periods.count") { const c = Math.min(12, Math.max(1, Math.round(Number(el.value)) || 0)), names = data.draft.periods.names; if (c && c !== names.length) { while (names.length < c) names.push(""); names.length = c; sec("names", namesView); } }
      if (p === "periodLabelFormat") sec("names", namesView);
      const cl = /^counters\.(\d+)\.label$/.exec(p); if (cl) el.closest(".card2").querySelector(".head b").textContent = el.value || "New counter";
      if (/^counters\.\d+\.(startValue|reset)$/.test(p) || p === "clock.mode") { paintKeep(el); return; }
      upd();
    };
    // fields whose choice changes what else is shown: redraw, then put the cursor back where it was
    const paintKeep = (el) => { const p = el.dataset.p; paint(); const e2 = root.querySelector(`[data-p="${p}"]`); if (e2) { e2.focus(); if (e2.setSelectionRange && el.selectionStart != null && e2.type === "text") try { e2.setSelectionRange(el.selectionStart, el.selectionEnd); } catch {} } };
    root.addEventListener("input", onInput);
    // keyboard: Enter in a box of the editor does not submit anything; Escape leaves the editor like Cancel
    const onFile = async (e) => {
      if (e.target.id !== "imp") return;
      const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
      run(async () => {
        let body; try { body = JSON.parse(await f.text()); } catch { throw new Error("That file is not a Fieldhouse sport file. Choose a .json file you exported from Fieldhouse."); }
        const p = await api.post("/profiles/import", body); await refresh(); paint(); toast(`Imported ${p.name}. You can edit it now.`);
      });
    };
    root.addEventListener("change", onFile);
    paint();
    return all(a, () => { root.removeEventListener("input", onInput); root.removeEventListener("change", onFile); });
  },
};
