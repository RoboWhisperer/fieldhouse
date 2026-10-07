// Automation > Rules: list, plain-language editor (when / only if / do), dry run, examples.
import { html, raw, esc, icon, api, toast, fail } from "../app.js";
import { lostHeaders, lookups, datalists, param, actionsEditor, bindDraft, repaintBox, dryView, statusPill, pill, sw, ago, fromApiAction, toApiActions, sameJson, setp, getp, EXAMPLES } from "./automation-lib.js";

const FACT_NAMES = { period: "Period", clockSec: "Seconds left on the clock", clock: "Clock in milliseconds", clockText: "Clock as text (like 4:32)", running: "The clock is running", diff: "Home score minus away score", lead: "Points the leader is ahead", "home.score": "Home score", "away.score": "Away score", "home.abbr": "Home team short name", "away.abbr": "Away team short name", "home.fouls": "Home fouls", "away.fouls": "Away fouls", "home.timeouts": "Home timeouts left", "away.timeouts": "Away timeouts left", "home.bonus": "Home is in the bonus", "event.type": "Kind of event", "event.team": "Team in the event (home or away)", "event.points": "Points in the event", "event.player": "Player in the event", "engine.live": "Stream is live", "engine.recording": "Recording is on", "engine.replaying": "A replay is playing", "engine.program": "Camera on air", "engine.cpu": "Computer load (percent)", "source.id": "Camera that changed" };
const OPS = [["==", "is"], ["!=", "is not"], ["<", "is less than"], ["<=", "is at most"], [">", "is more than"], [">=", "is at least"], ["contains", "contains"]];
const TRIGGER_START = { event: { event: "score" }, state: { when: "" }, clock: { atSec: 60 }, timer: { everySec: 60 }, after: { ruleId: "", afterSec: 10 }, engine: { event: "stream.live" }, sponsor: {}, manual: { name: "" } };

const blank = () => ({ name: "", enabled: true, priority: 50, trigger: { type: "event", event: "score" }, when: "", cooldownSec: 0, once: "", note: "", actions: [], _needs: [] });
const fromApi = (r) => ({ id: r.id, name: r.name, enabled: r.enabled, priority: r.priority, trigger: structuredClone(r.trigger), when: r.when ?? "", cooldownSec: r.cooldownSec ?? 0, once: r.once ?? "", note: r.note ?? "", actions: r.actions.map(fromApiAction), _needs: [] });
const cleanObj = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v !== undefined && !(typeof v === "number" && isNaN(v)) && !(Array.isArray(v) && !v.length)));
const toApi = (d) => ({ name: d.name.trim(), enabled: d.enabled, priority: d.priority || 50, trigger: cleanObj(d.trigger), when: (d.when || "").trim(), cooldownSec: d.cooldownSec || 0, once: d.once || "", ...(d.note ? { note: d.note } : {}), actions: toApiActions(d.actions, !d.id) });

const factOptions = (lk) => {
  const keys = new Set();
  for (const g of lk.catalog.factGroups) for (const ex of g.examples) { const k = g.prefix + ex.replace(/ \(.*$/, ""); if (!/[<>]/.test(k)) keys.add(g.prefix && ex.startsWith(g.prefix) ? ex.replace(/ \(.*$/, "") : k); }
  for (const f of lk.fields) keys.add(`custom.${f.key}`);
  for (const k of Object.keys(FACT_NAMES)) keys.add(k);
  return [...keys].filter((k) => !k.includes("<")).sort((a, b) => (a in FACT_NAMES ? 0 : 1) - (b in FACT_NAMES ? 0 : 1) || a.localeCompare(b));
};
const quote = (v) => { const t = v.trim(); return t === "" ? "''" : /^-?\d+(\.\d+)?$/.test(t) || /^(true|false)$/.test(t) ? t : /^'.*'$/.test(t) ? t : `'${t.replace(/'/g, "")}'`; };

// ---------------------------------------------------------------- views
function list(d) {
  const last = new Map(); for (const e of d.log) if (e.kind === "rule" && e.matched !== false && !last.has(e.ref)) last.set(e.ref, e);
  return html`<div class="bar-row"><p class="muted lead">A rule watches for something to happen and then does the steps you choose. Try one with <b>Test</b> before you rely on it.</p><span class="sp"></span>
      ${d.rules.length ? html`<button type="button" class="btn" data-a="examples">${icon("book")}Start from an example</button><button type="button" class="btn pri" data-a="new">${icon("plus")}New rule</button>` : ""}</div>
    ${d.rules.length ? html`<div class="panel"><ul class="rlist">${d.rules.map((r) => { const l = last.get(r.id); return html`<li class="rrow ${r.enabled ? "" : "off"}">
      <div>${sw(r.enabled, "toggle", `${r.name} is ${r.enabled ? "on" : "off"}`, `data-id="${esc(r.id)}"`)}</div>
      <div class="rmain"><b class="rname">${r.name}</b><span class="muted">When ${r.summary}${r.when ? html`, only if <code>${r.when}</code>` : ""}. ${r.actions.length} step${r.actions.length === 1 ? "" : "s"}.${r.cooldownSec ? ` Waits ${r.cooldownSec} s between runs.` : ""}${r.once ? ` Once per ${r.once}.` : ""}</span></div>
      <div class="rlast">${l ? html`${statusPill(l.status)}<span class="muted">${ago(l.at)}</span>` : html`<span class="muted">Has not run</span>`}</div>
      <div class="ract"><button type="button" class="btn sm" data-a="edit" data-id="${r.id}" aria-label="Edit ${r.name}">Edit</button><button type="button" class="btn sm ghost" data-a="dupe" data-id="${r.id}" aria-label="Duplicate ${r.name}">Duplicate</button>
        ${d.confirm === r.id ? html`<button type="button" class="btn sm danger" data-a="del" data-id="${r.id}" data-fk="fk-del-${r.id}">Delete ${r.name}</button><button type="button" class="btn sm ghost" data-a="keep">Keep</button>` : html`<button type="button" class="btn sm ghost" data-a="askdel" data-id="${r.id}" data-fk="fk-askdel-${r.id}" aria-label="Delete ${r.name}">Delete</button>`}</div></li>`; })}</ul></div>`
    : html`<div class="panel"><div class="empty">${icon("bolt", "xl")}<b>No rules yet</b><span>Automation is optional. Rules can show a graphic, play a replay or tell another program when something happens in the game.</span><div class="row"><button type="button" class="btn pri" data-a="new">${icon("plus")}New rule</button><button type="button" class="btn" data-a="examples">${icon("book")}Start from an example</button></div></div></div>`}`;
}

function condition(d, lk) {
  const cs = d.cond ?? (d.cond = { fact: "period", op: "==", val: "" });
  return html`<section class="panel"><div class="ph"><h3><span class="step">2</span> Only if (optional)</h3></div><div class="pb stack">
    <p class="muted">Leave this empty to run every time. Otherwise the rule only runs when the condition is true.</p>
    <fieldset class="rowsfs"><legend>Build a condition</legend>
      <div class="cb"><label class="field"><span class="fl">What to look at</span><select class="select" data-c="fact" data-fk="fk-c-fact">${factOptions(lk).map((k) => html`<option value="${k}" ${raw(k === cs.fact ? "selected" : "")}>${FACT_NAMES[k] ? `${FACT_NAMES[k]} (${k})` : k}</option>`)}</select></label>
        <label class="field"><span class="fl">Compare</span><select class="select" data-c="op" data-fk="fk-c-op">${OPS.map(([o, l]) => html`<option value="${o}" ${raw(o === cs.op ? "selected" : "")}>${l}</option>`)}</select></label>
        <label class="field"><span class="fl">To</span><input class="input" data-c="val" data-fk="fk-c-val" value="${cs.val}" placeholder="4, 60000, home, true..." autocomplete="off"></label>
        <div class="row"><button type="button" class="btn sm" data-a="cadd" data-j="and" data-fk="fk-cadd-and">${icon("plus", "sm")}And</button><button type="button" class="btn sm" data-a="cadd" data-j="or" data-fk="fk-cadd-or">${icon("plus", "sm")}Or</button></div></div>
      <span class="hint">Adds one line to the condition below. Words are put in quotes for you.</span></fieldset>
    <label class="field"><span class="fl">The condition itself (advanced)</span><input class="input mono" data-f="when" data-fk="fk-when" value="${d.draft.when}" placeholder="clock <= 60000 and period == 4" autocomplete="off" spellcheck="false" aria-describedby="when-check"><span class="hint">You can type it directly: numbers, 'text', true/false, facts like <code>home.score</code>, and <code>== != &lt; &lt;= &gt; &gt;= contains and or not</code>.</span></label>
    <div id="when-check" class="vcheck" data-check role="status" aria-live="polite"></div></div></section>`;
}

function editor(d, lk) {
  const r = d.draft, td = lk.catalog.triggers.find((t) => t.type === r.trigger.type), isNew = !r.id;
  const sampleEvent = r.trigger.type === "event";
  return html`<div class="editor"><div class="bar-row"><button type="button" class="btn ghost" data-a="back">${icon("left")}Back to rules</button><h2 class="h2">${isNew ? "New rule" : "Edit rule"}</h2><span class="sp"></span>
      ${!isNew && html`<button type="button" class="btn sm ghost" data-a="dupe-draft">Duplicate</button>${d.confirm === "draft" ? html`<button type="button" class="btn sm danger" data-a="del" data-id="${r.id}">Delete this rule</button><button type="button" class="btn sm ghost" data-a="keep">Keep</button>` : html`<button type="button" class="btn sm ghost" data-a="askdel" data-id="draft">Delete</button>`}`}</div>
    ${r._needs?.length ? html`<div class="banner info">${icon("info", "lg")}<span>This example uses the custom field${r._needs.length > 1 ? "s" : ""} <b>${r._needs.map((n) => n.key).join(", ")}</b>. ${r._needs.length > 1 ? "They are" : "It is"} created for you when you save, if missing.</span></div>` : ""}
    <div class="panel"><div class="pb g3">
      <label class="field wide2"><span class="fl">Name <span class="req">*</span></span><input class="input" data-f="name" data-fk="fk-name" value="${r.name}" maxlength="40" placeholder="Example: Home three, lower third" autocomplete="off"></label>
      <div class="field"><span class="fl">Rule is</span><label class="chk"><input type="checkbox" data-f="enabled" data-t="bool" data-fk="fk-enabled" ${raw(r.enabled ? "checked" : "")}> <span>On (runs automatically)</span></label></div></div></div>
    <section class="panel"><div class="ph"><h3><span class="step">1</span> When this happens</h3></div><div class="pb stack">
      <label class="field narrow"><span class="fl">What to watch for</span><select class="select" data-f="trigger.type" data-t="trig" data-fk="fk-trig">${lk.catalog.triggers.map((t) => html`<option value="${t.type}" ${raw(t.type === r.trigger.type ? "selected" : "")}>${t.label}</option>`)}</select></label>
      <div class="g3">${td.params.map((p) => param(p, r.trigger[p.name], `trigger.${p.name}`, `trigger.${r.trigger.type}`, lk, { selfId: r.id }))}</div></div></section>
    ${condition(d, lk)}
    <section class="panel"><div class="ph"><h3><span class="step">3</span> Do this</h3></div><div class="pb">${actionsEditor(r.actions, lk, { selfId: r.id })}</div></section>
    <section class="panel"><div class="ph"><h3><span class="step">4</span> How often</h3></div><div class="pb g3">
      <label class="field"><span class="fl">Wait at least this many seconds between runs</span><input class="input" type="number" min="0" data-f="cooldownSec" data-t="num" data-fk="fk-cool" value="${r.cooldownSec ?? 0}"><span class="hint">0 = no waiting. Stops a quick double score from running the rule twice.</span></label>
      <label class="field"><span class="fl">Only once per</span><select class="select" data-f="once" data-fk="fk-once"><option value="" ${raw(!r.once ? "selected" : "")}>No limit</option><option value="game" ${raw(r.once === "game" ? "selected" : "")}>Game</option><option value="period" ${raw(r.once === "period" ? "selected" : "")}>Period</option></select></label>
      <label class="field"><span class="fl">Order (1 runs first)</span><input class="input" type="number" min="1" max="99" data-f="priority" data-t="num" data-fk="fk-prio" value="${r.priority ?? 50}"><span class="hint">Matters only when two rules start at the same moment.</span></label>
      <label class="field wide3"><span class="fl">Your note</span><input class="input" data-f="note" data-fk="fk-note" value="${r.note ?? ""}" maxlength="300" placeholder="Why this rule exists"></label></div></section>
    <section class="panel"><div class="ph"><h3>Try it (dry run)</h3></div><div class="pb stack">
      <p class="muted">A dry run shows what this rule <b>would</b> do. It does not show, send or save anything, and it uses up no waiting time.</p>
      ${sampleEvent && html`<div class="g3"><label class="field"><span class="fl">Pretend this team did it</span><select class="select" data-s="team"><option value="">Either team</option><option value="home" ${raw(d.sample.team === "home" ? "selected" : "")}>Home</option><option value="away" ${raw(d.sample.team === "away" ? "selected" : "")}>Away</option></select></label>
        <label class="field"><span class="fl">Points (score events)</span><input class="input" type="number" min="1" max="3" data-s="points" value="${d.sample.points ?? ""}"></label></div>`}
      <label class="field"><span class="fl">Pretend the game looks like this (advanced, optional)</span><input class="input mono" data-s="facts" value="${d.sample.facts ?? ""}" placeholder='{"clock": 45000, "period": 4}' autocomplete="off" spellcheck="false"></label>
      <div class="row"><button type="button" class="btn" data-a="dry" data-fk="fk-dry">${icon("play")}Test this rule</button><span class="hint" data-sampleerr role="alert"></span></div>
      <div data-dry>${d.dry ? dryView(d.dry) : ""}</div></div></section>
    <div class="dirty savebar"><span class="hint err" data-err role="alert"></span><span class="sp"></span><button type="button" class="btn" data-a="back">Cancel</button><button type="button" class="btn pri" data-a="save" data-fk="fk-save">${icon("check")}Save rule</button></div></div>`;
}

// ---------------------------------------------------------------- examples dialog
function examples() {
  return html`<div class="scrim fx"><div class="modal wide" role="dialog" aria-modal="true" aria-labelledby="ex-t"><div class="row"><h2 class="h2" id="ex-t">Start from an example</h2><span class="sp"></span><button type="button" class="btn ghost sm" data-a="close" data-close aria-label="Close">${icon("x")}</button></div>
    <p class="muted">Pick one and change it to fit. Nothing is saved until you press Save.</p>
    <ul class="exlist">${EXAMPLES.map((e) => html`<li><div><b>${e.title}</b><span class="muted">${e.blurb}</span><span class="pill info noDot">${e.kind === "rule" ? "Rule" : e.kind === "macro" ? "Big button" : "Web message"}</span></div><button type="button" class="btn sm" data-a="pick" data-n="${e.id}" ${raw(e.id === 1 ? 'data-fk="fk-ex1"' : "")}>Use this</button></li>`)}</ul></div></div>`;
}

export const rules = {
  async load() { const [lk, log] = await Promise.all([lookups(), api.get("/automation/log?n=300")]); return { lk, rules: lk.rules, log, mode: "list", draft: null, snap: null, dry: null, confirm: null, sample: {}, modal: false }; },
  render: (ctx, d) => html`<div data-box>${datalists(d.lk)}${view(d)}</div>`,
  bind(root, ctx, d) {
    const box = root.querySelector("[data-box]"), lk = d.lk;
    const paint = (fk) => repaintBox(box, html`${datalists(lk)}${view(d)}${d.modal ? examples() : ""}`.s, fk);
    const reload = async () => { d.rules = lk.rules = await api.get("/automation/rules"); d.log = await api.get("/automation/log?n=300"); };
    const open = (draft, fk) => { d.mode = "edit"; d.draft = draft; d.snap = JSON.stringify(toApi(draft)); d.dry = null; d.confirm = null; d.sample = {}; d.cond = null; d.modal = false; paint(fk ?? "fk-name"); checkWhen(); window.scrollTo(0, 0); };
    const back = () => { if (d.mode === "edit" && JSON.stringify(toApi(d.draft)) !== d.snap && !confirm("Leave without saving your changes?")) return; d.mode = "list"; d.draft = null; paint(); };
    const err = (m) => { const e = box.querySelector("[data-err]"); if (e) e.textContent = m || ""; };
    // inline validation of the condition text: the server judges it with a throw-away rule
    let timer = 0, seq = 0;
    const checkWhen = () => {
      clearTimeout(timer); const el = box.querySelector("[data-check]"); if (!el || d.mode !== "edit") return;
      const w = (d.draft.when || "").trim(); if (!w) { el.innerHTML = ""; return; }
      timer = setTimeout(async () => {
        const mine = ++seq;
        try {
          const r = await api.post("/automation/test", { rule: { name: "check", trigger: { type: "manual", name: "check" }, when: w, actions: [{ type: "wait", seconds: 1 }] } });
          if (mine !== seq || !el.isConnected) return;
          const unk = (r.warnings ?? []).filter((x) => /Unknown fact/.test(x));
          el.innerHTML = unk.length ? html`<span class="ok-t">${icon("check", "sm")} The condition is written correctly.</span> <span class="warn-t">${icon("alert", "sm")} ${unk[0]} No game is running, or the name is misspelled.</span>`.s : html`<span class="ok-t">${icon("check", "sm")} The condition is written correctly${r.condition ? ` and is ${r.condition.result ? "true" : "false"} right now.` : "."}</span>`.s;
        } catch (e) { if (mine === seq && el.isConnected) el.innerHTML = html`<span class="err-t">${icon("alert", "sm")} ${e.message}</span>`.s; }
      }, 350);
    };
    const ed = { draft: () => d.draft, paint: (fk) => { paint(fk); checkWhen(); }, changed: (path) => { if (path === "when") checkWhen(); } };
    const off = bindDraft(box, lk, ed);
    const sample = () => {
      const t = d.draft.trigger, s = {}; if (t.type === "event") s.event = cleanObj({ type: t.event, team: d.sample.team || t.team, points: d.sample.points || t.points?.[0] });
      if (d.sample.facts?.trim()) { try { s.facts = JSON.parse(d.sample.facts); } catch { throw new Error("The sample values must be written like {\"clock\": 45000}."); } }
      return s;
    };
    async function save() {
      const body = toApi(d.draft); err("");
      const lost = lostHeaders(d.draft.actions, !d.draft.id);
      if (lost.length && !confirm(`A web request step was moved or copied, so its saved header values (${[...new Set(lost)].join(", ")}) cannot be kept. They will be empty unless you type them again. Save anyway?`)) return;
      if (!body.name) { err("Give the rule a name."); box.querySelector('[data-f="name"]')?.focus(); return; }
      try {
        for (const n of d.draft._needs ?? []) if (!lk.fields.some((f) => f.key === n.key)) { const c = await api.put(`/custom/${n.key}`, { label: n.label, type: n.type, ...(n.default ? { default: n.default } : {}) }); lk.fields = c.fields; }
        const saved = d.draft.id ? await api.put(`/automation/rules/${d.draft.id}`, body) : await api.post("/automation/rules", body);
        toast(`Rule "${saved.name}" saved.`); await reload(); d.mode = "list"; d.draft = null; paint("fk-edit-" + saved.id);
      } catch (e) { err(e.message); fail(e); }
    }
    const click = async (e) => {
      const b = e.target.closest?.("[data-a],[data-act]"); if (!b || !box.contains(b)) return; const a = b.dataset.a ?? b.dataset.act, id = b.dataset.id;
      try {
        if (a === "new") open(blank());
        else if (a === "edit") open(fromApi(d.rules.find((r) => r.id === id)));
        else if (a === "dupe" || a === "dupe-draft") { const src = a === "dupe" ? fromApi(d.rules.find((r) => r.id === id)) : structuredClone(d.draft); delete src.id; src.name = `${src.name} (copy)`.slice(0, 40); src.enabled = false; open(src); toast("Copy ready. It is off until you save and turn it on."); }
        else if (a === "toggle") { await api.put(`/automation/rules/${id}`, { enabled: b.getAttribute("aria-checked") !== "true" }); await reload(); paint(); }
        else if (a === "askdel") { d.confirm = id; paint(`fk-del-${id}`); }
        else if (a === "keep") { d.confirm = null; paint(); }
        else if (a === "del") { const rid = d.mode === "edit" ? d.draft.id : id; await api.del(`/automation/rules/${rid}`); toast("Rule deleted."); d.confirm = null; d.mode = "list"; d.draft = null; await reload(); paint(); }
        else if (a === "back") back();
        else if (a === "save") await save();
        else if (a === "examples") { d.modal = true; paint("fk-ex1"); }
        else if (a === "close") { d.modal = false; paint(); }
        else if (a === "pick") pick(+b.dataset.n);
        else if (a === "cadd") { const c = d.cond, clause = `${c.fact} ${c.op} ${quote(c.val)}`; d.draft.when = d.draft.when.trim() ? `${d.draft.when.trim()} ${b.dataset.j} ${clause}` : clause; paint(`fk-when`); checkWhen(); }
        else if (a === "dry") {
          const out = box.querySelector("[data-dry]"), se = box.querySelector("[data-sampleerr]"); se.textContent = ""; out.innerHTML = html`<p class="muted">Testing...</p>`.s;
          let s; try { s = sample(); } catch (x) { se.textContent = x.message; out.innerHTML = ""; return; }
          try { d.dry = await api.post("/automation/test", { rule: toApi(d.draft), sample: s }); } catch (x) { d.dry = { error: x.message }; }
          out.innerHTML = dryView(d.dry).s;
        }
      } catch (x) { fail(x); }
    };
    function pick(n) {
      const ex = EXAMPLES.find((x) => x.id === n); d.modal = false;
      if (ex.kind === "rule") { const r = fromApi({ id: undefined, enabled: true, priority: 50, ...structuredClone(ex.rule) }); r._needs = ex.needs ?? []; open(r); }
      else ctx.go(`/automation/${ex.kind === "macro" ? "macros" : "webhooks"}?example=${n}`);
    }
    const change = (e) => {
      const el = e.target;
      if (el.dataset.c) { d.cond[el.dataset.c] = el.value; return; }
      if (el.dataset.s) { d.sample[el.dataset.s] = el.value; return; }
      if (el.dataset.t === "trig" && e.type === "change") { d.draft.trigger = { type: el.value, ...structuredClone(TRIGGER_START[el.value] ?? {}) }; d.dry = null; paint("fk-trig"); checkWhen(); }
    };
    box.addEventListener("click", click); box.addEventListener("input", change); box.addEventListener("change", change);
    const q = ctx.query?.example; if (q) { history.replaceState(null, "", "#/automation/rules"); pick(+q); }
    return () => { off(); clearTimeout(timer); box.removeEventListener("click", click); box.removeEventListener("input", change); box.removeEventListener("change", change); };
  },
};
const view = (d) => (d.mode === "edit" ? editor(d, d.lk) : list(d));
