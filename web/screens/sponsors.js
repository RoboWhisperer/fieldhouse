import { html, raw, icon, api, toast, fail } from "../app.js";

const TRIG = { pregame: "Pregame", timeout: "Timeouts", period_end: "End of period", halftime: "Halftime", postgame: "Postgame" };
const KIND_ICON = { image: "film", video: "video", audio: "mic" };
const isDemo = (s) => /_demo_/.test(s.id || "");

// Editor state lives at module level so redraws (structural edits) never lose typing.
let st = { sel: null, draft: null, orig: null, confirm: false, resolving: null };
const clone = (o) => JSON.parse(JSON.stringify(o));
const dirty = () => !!st.draft && JSON.stringify(st.draft) !== JSON.stringify(st.orig);
const blank = (sponsors) => ({ name: "", abbr: "", color: "#3d8bfd", assets: [], displaySeconds: 15, rules: { triggers: ["timeout"], minGapMinutes: 8, maxPerSeason: 12, priority: Math.min(99, Math.max(0, ...sponsors.map((s) => s.rules.priority)) + 1) } });
const open = (s) => { st.sel = s.id; st.draft = clone(strip(s)); st.orig = clone(st.draft); st.confirm = false; };
const strip = ({ usage, ...s }) => s;
const ruleText = (s) => { const t = s.rules.triggers.map((x) => TRIG[x]).join(", "); return `${t}, 1 per ${s.rules.minGapMinutes} min`; };
const setPath = (o, path, v) => { const k = path.split("."); const last = k.pop(); const t = k.reduce((a, p) => a[p], o); if (v === undefined) delete t[last]; else t[last] = v; };

const css = `
.sp-body{display:grid;grid-template-columns:360px minmax(0,1fr);gap:16px;align-items:start}
.sp-pg{display:grid;gap:12px}
.lcol{display:grid;gap:12px;align-content:start;min-width:0}
.sc{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-panel);padding:14px;display:grid;gap:10px;min-width:0;text-align:left;color:var(--text);font:inherit;cursor:pointer}
.sc.sel{border-color:var(--action);background:var(--raised)}
.sc .nm{font-weight:650;font-size:15px}
.sc .rs{font-size:12.5px;color:var(--text-2)}
.us{display:flex;justify-content:space-between;font-size:12px;color:var(--text-2)}
.us b{color:var(--text);font-weight:650}
.plan{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px;padding:12px 14px}
.plan>div{display:grid;gap:6px;align-content:start;min-width:0}
.plan .pl{font-size:12px;font-weight:650;color:var(--text-2)}
.slot{display:flex;align-items:center;gap:8px;min-height:32px;padding:4px 8px;border:1px solid var(--line-strong);border-radius:6px;background:var(--inset);font-size:12px;min-width:0}
.slot i{width:10px;height:10px;border-radius:3px;flex:none}
.slot span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.slot.cf{border-color:#6b3d17;background:var(--caution-wash);color:var(--text)}
.slot.cf .i{color:var(--caution)}
.det>section{padding:14px 16px;border-bottom:1px solid var(--line);min-width:0}
.ar{display:grid;grid-template-columns:40px 110px minmax(0,1fr) 90px 36px;gap:12px;align-items:center;min-height:44px;border-top:1px solid var(--line)}
.th{width:40px;height:28px;border-radius:5px;display:grid;place-items:center;background:var(--raised);color:var(--text-2)}
.rule{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:13px;line-height:1.2}
.rule .select,.rule .input{height:32px;padding:0 10px}
.tg{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 6px 0 10px;border-radius:6px;background:var(--action-wash);border:1px solid #24467d;font-weight:600;font-size:13px}
.tg button{all:unset;cursor:pointer;display:grid;place-items:center;width:22px;height:22px;border-radius:4px;color:var(--text-2)}
.tg button:hover,.tg button:focus-visible{background:var(--raised);color:var(--text);outline:2px solid var(--action)}
.sp-pg input.input,.sp-pg select.select{font:inherit;color:var(--text)}
.sp-pg input[type=color]{width:44px;height:36px;padding:2px;background:var(--inset);border:1px solid var(--line-strong);border-radius:var(--r-ctl);cursor:pointer}
.sp-pg .num{width:64px;text-align:center;font-family:var(--mono)}
.sp-pg select.select{appearance:none;-webkit-appearance:none;padding-right:28px}
.sp-pg [hidden]{display:none!important}
.sp-pg :focus-visible{outline:2px solid var(--action);outline-offset:1px}
.sp-pg .pri-hl{border-color:var(--caution);box-shadow:0 0 0 3px var(--caution-wash)}
`;

function planStrip(d) {
  if (!d.sponsors.length) return "";
  const byId = new Map(d.sponsors.map((s) => [s.id, s]));
  const names = (trigger) => d.conflicts.filter((c) => c.trigger === trigger).flatMap((c) => c.sponsorIds.map((i) => byId.get(i)?.name)).filter(Boolean);
  const n = d.conflicts.length;
  return html`<div class="panel"><div class="ph"><h3>Break planner</h3><span class="faint" style="font-size:12px">A typical game, based on all rules</span><span class="sp"></span>
    ${n ? html`<span class="chip warn">${icon("alert", "sm")}${n} conflict${n > 1 ? "s" : ""}</span>` : html`<span class="chip ok">${icon("check", "sm")}No conflicts</span>`}</div>
    <div class="plan">${d.plan.map((p) => {
      const s = byId.get(p.sponsorId);
      return html`<div><span class="pl">${p.slot}</span>${p.conflict
        ? html`<div class="slot cf">${icon("alert", "sm")}<span>${names(p.trigger).slice(0, 2).join(" or ")}?</span></div>`
        : s ? html`<div class="slot"><i style="background:${s.color}"></i><span>${s.name}</span></div>` : html`<div class="slot"><span class="faint">Open</span></div>`}</div>`;
    })}</div></div>`;
}

function conflictBanner(d) {
  if (!d.conflicts.length) return "";
  const byId = new Map(d.sponsors.map((s) => [s.id, s]));
  const c = d.conflicts[0], nm = c.sponsorIds.map((i) => byId.get(i)?.name).filter(Boolean);
  return html`<div class="banner warn">${icon("alert", "lg")}
    <span><b>${nm.join(" and ")} both want the ${TRIG[c.trigger].toLowerCase()} slot.</b> Only one can air per break. Priority order decides who goes first.${d.conflicts.length > 1 ? ` (${d.conflicts.length - 1} more conflict${d.conflicts.length > 2 ? "s" : ""})` : ""}</span>
    <span class="sp"></span><button class="btn" data-act="resolve">Resolve by priority</button></div>`;
}

function card(s) {
  const pct = Math.min(100, Math.round((s.usage.aired / s.rules.maxPerSeason) * 100));
  return html`<button class="sc ${st.sel === s.id ? "sel" : ""}" data-act="pick" data-id="${s.id}" aria-pressed="${st.sel === s.id}">
    <div class="row"><span class="logo-ph" style="background:${s.color}">${s.abbr.slice(0, 2)}</span><div style="min-width:0"><div class="nm">${s.name}</div><div class="rs">${ruleText(s)}</div></div></div>
    <div class="bar"><b style="width:${pct}%"></b></div>
    <div class="us"><span><b>${s.usage.left} of ${s.rules.maxPerSeason}</b> airings left</span><span>${s.usage.aired} aired</span></div></button>`;
}

function editor(d) {
  const x = st.draft, isNew = !x.id, saved = d.sponsors.find((s) => s.id === x.id);
  const u = saved?.usage ?? { aired: 0, left: x.rules.maxPerSeason, seconds: 0 };
  const free = Object.keys(TRIG).filter((t) => !x.rules.triggers.includes(t));
  const byId = new Map(d.sponsors.map((s) => [s.id, s]));
  const hl = st.resolving?.includes(x.id);
  const pct = Math.min(100, Math.round((u.aired / Math.max(1, x.rules.maxPerSeason)) * 100));
  return html`<div class="panel det">
    ${st.resolving ? html`<section style="background:var(--action-wash)"><div class="row" style="align-items:flex-start">${icon("info", "lg")}<div style="min-width:0"><b>Resolve by priority.</b> <span class="muted">A lower priority number airs first, so give each of these sponsors a different number (1 goes first). Switch between them here:</span>
      <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:8px">${st.resolving.map((i) => html`<button class="btn sm ${i === x.id ? "pri" : ""}" data-act="pick" data-id="${i}">${byId.get(i)?.name ?? "Sponsor"} (priority ${byId.get(i)?.rules.priority})</button>`)}</div></div></div></section>` : ""}
    <section><div class="row">
      <span class="logo-ph" id="sp-logo" style="background:${x.color};width:56px;height:56px;font-size:20px;border-radius:12px">${(x.abbr || x.name || "?").slice(0, 2).toUpperCase()}</span>
      <div style="min-width:0"><h2 class="t">${isNew ? "New sponsor" : x.name || "Untitled"}</h2><div class="muted">${isDemo(x) ? "Demo sponsor. Edit it or remove it any time." : isNew ? "Fill in the basics, then save." : `Priority ${x.rules.priority}`}</div></div>
      <span class="sp"></span><span class="chip warn" id="sp-dirty" ${dirty() ? "" : "hidden"}>Unsaved changes</span></div>
      <div class="row" style="margin-top:14px;align-items:flex-end;flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:200px"><label for="f-name">Name</label><input id="f-name" class="input" data-f="name" value="${x.name}" maxlength="60" autocomplete="off"></div>
        <div class="field" style="width:120px"><label for="f-abbr">Short name</label><input id="f-abbr" class="input mono" data-f="abbr" value="${x.abbr}" maxlength="8" autocomplete="off"></div>
        <div class="field"><label for="f-color">Color</label><input id="f-color" type="color" data-f="color" value="${x.color}"></div>
        <div class="field" style="width:130px"><label for="f-len">Display length (s)</label><input id="f-len" class="input mono" type="number" min="1" max="120" data-f="displaySeconds" data-num value="${x.displaySeconds}"></div>
      </div></section>
    <section>
      <div class="row" style="margin-bottom:8px"><h3 class="t" style="font-size:14px">Assets</h3><span class="sp"></span><button class="btn sm" data-act="add-asset">${icon("plus", "sm")}Add asset</button></div>
      ${x.assets.length ? x.assets.map((a, i) => html`<div class="ar"><span class="th">${icon(KIND_ICON[a.kind])}</span>
        <select class="select" aria-label="Asset type" data-f="assets.${i}.kind"><option value="image" ${a.kind === "image" ? "selected" : ""}>Image</option><option value="video" ${a.kind === "video" ? "selected" : ""}>Video</option><option value="audio" ${a.kind === "audio" ? "selected" : ""}>Audio</option></select>
        <input class="input" aria-label="Asset name" placeholder="File name, e.g. corner-logo.png" data-f="assets.${i}.name" value="${a.name}">
        <input class="input mono" type="number" min="0" max="600" aria-label="Seconds" placeholder="sec" data-f="assets.${i}.seconds" data-num value="${a.seconds ?? ""}" ${a.kind === "image" ? "" : ""}>
        <button class="btn sm ghost" aria-label="Remove asset" data-act="del-asset" data-i="${i}">${icon("x", "sm")}</button></div>`)
        : html`<div class="muted" style="padding:8px 0">No assets yet. Sponsors can air with just their name and color.</div>`}
      <div class="faint" style="font-size:12px;margin-top:8px">Fieldhouse does not upload files in this version. Add the asset names so your notes and reports match what you keep on this computer.</div>
    </section>
    <section>
      <h3 class="t" style="font-size:14px;margin-bottom:12px">Rules</h3>
      <div class="rule"><span>Air at:</span>
        ${x.rules.triggers.map((t) => html`<span class="tg">${TRIG[t]}<button aria-label="Remove ${TRIG[t]}" data-act="del-trig" data-t="${t}">${icon("x", "sm")}</button></span>`)}
        ${free.length ? html`<select class="select" aria-label="Add a place to air" data-act="add-trig"><option value="">+ Add place</option>${free.map((t) => html`<option value="${t}">${TRIG[t]}</option>`)}</select>` : ""}
        <span>no more than once every</span><input class="input num" type="number" min="0" max="240" aria-label="Minutes between airings" data-f="rules.minGapMinutes" data-num value="${x.rules.minGapMinutes}">
        <span>minutes; max</span><input class="input num" type="number" min="1" max="1000" aria-label="Airings per season" data-f="rules.maxPerSeason" data-num value="${x.rules.maxPerSeason}"><span>airings this season</span></div>
      <div class="rule" style="margin-top:12px"><span>Priority</span><input class="input num ${hl ? "pri-hl" : ""}" type="number" min="1" max="99" aria-label="Priority" data-f="rules.priority" data-num value="${x.rules.priority}"><span class="muted">Lower numbers air first when two sponsors want the same break.</span></div>
    </section>
    <section style="border-bottom:0">
      <div class="row" style="margin-bottom:8px"><h3 class="t" style="font-size:14px">Season usage</h3></div>
      <div class="bar" style="height:8px"><b style="width:${pct}%"></b></div>
      <div class="row" style="margin-top:8px"><span><b>${u.aired} aired</b> <span class="muted">of ${x.rules.maxPerSeason}</span></span><span class="sp"></span><span class="muted">${Math.max(0, x.rules.maxPerSeason - u.aired)} airings left</span></div>
    </section>
    <div class="row" style="padding:12px 16px;border-top:1px solid var(--line);flex-wrap:wrap">
      ${isNew ? "" : st.confirm
        ? html`<span><b>Remove ${x.name}?</b> <span class="muted">Past airings stay in reports.</span></span><button class="btn sm" data-act="no-rm">Keep</button><button class="btn sm danger" data-act="rm">Yes, remove</button>`
        : html`<button class="btn ghost danger" style="border-color:transparent" data-act="ask-rm">Remove sponsor</button>`}
      <span class="sp"></span>
      <button class="btn" data-act="discard" id="sp-discard" ${dirty() || isNew ? "" : "disabled"}>Discard</button>
      <button class="btn pri" data-act="save" id="sp-save" ${dirty() || isNew ? "" : "disabled"}>${icon("check")}Save rules</button></div></div>`;
}

export default {
  shell: "manage", nav: "sponsors", css,
  async load() {
    const [sponsors, pl] = await Promise.all([api.get("/sponsors"), api.get("/sponsors/plan")]);
    sponsors.sort((a, b) => a.rules.priority - b.rules.priority);
    const keep = sponsors.find((s) => s.id === st.sel);
    if (st.draft && !st.draft.id) { /* unsaved new sponsor: keep editing */ }
    else if (keep && !dirty()) open(keep);
    else if (!keep) { st = { sel: null, draft: null, orig: null, confirm: false, resolving: null }; if (sponsors[0]) open(sponsors[0]); }
    return { sponsors, plan: pl.plan, conflicts: pl.conflicts };
  },
  render(ctx, d) {
    return html`<div class="main-pad"><div class="sp-pg">
      <div class="row"><h1 class="t">Sponsors</h1>${d.sponsors.some(isDemo) ? html`<span class="chip">Demo data</span>` : ""}<span class="sp"></span>
        <button class="btn" data-act="add">${icon("plus")}Add sponsor</button></div>
      ${d.sponsors.length || st.draft ? html`${planStrip(d)}${conflictBanner(d)}
      <div class="sp-body"><div class="lcol">${d.sponsors.map(card)}${st.draft && !st.draft.id ? html`<div class="sc sel"><div class="row"><span class="logo-ph" style="background:${st.draft.color}">+</span><div class="nm">New sponsor</div></div></div>` : ""}</div>
      ${st.draft ? editor(d) : ""}</div>`
      : html`<div class="panel"><div class="empty">${icon("sponsor", "lg")}<h3 class="t">No sponsors yet</h3><div>Add the businesses that support your team. Fieldhouse plans their breaks and keeps count of every airing.</div><button class="btn pri" data-act="add">${icon("plus")}Add your first sponsor</button></div></div>`}
    </div></div>`;
  },
  bind(root, ctx, d) {
    const refresh = () => {
      const on = dirty() || !st.draft?.id;
      root.querySelector("#sp-dirty")?.toggleAttribute("hidden", !dirty());
      root.querySelectorAll("#sp-save,#sp-discard").forEach((b) => (b.disabled = !on));
    };
    const onInput = (e) => {
      const el = e.target.closest("[data-f]"); if (!el || !st.draft) return;
      const v = el.hasAttribute("data-num") ? (el.value === "" ? undefined : Number(el.value)) : el.value;
      setPath(st.draft, el.dataset.f, v);
      const lg = root.querySelector("#sp-logo");
      if (lg) { lg.style.background = st.draft.color; lg.textContent = (st.draft.abbr || st.draft.name || "?").slice(0, 2).toUpperCase(); }
      if (e.type === "change" && /assets\.\d+\.kind/.test(el.dataset.f)) ctx.redraw();
      refresh();
    };
    const guard = () => (dirty() || (st.draft && !st.draft.id && st.draft.name)) && (toast("Save or discard your changes first."), true);
    const act = {
      add() { if (guard()) return; st = { sel: null, draft: blank(d.sponsors), orig: blank(d.sponsors), confirm: false, resolving: null }; st.orig = null; ctx.redraw(); setTimeout(() => root.querySelector("#f-name")?.focus(), 0); },
      pick(el) { const s = d.sponsors.find((x) => x.id === el.dataset.id); if (!s || s.id === st.sel) return; if (guard()) return; open(s); ctx.redraw(); },
      resolve() {
        if (guard()) return;
        const ids = [...new Set(d.conflicts.flatMap((c) => c.sponsorIds))];
        st.resolving = ids; const s = d.sponsors.find((x) => x.id === ids[0]); if (s) open(s); ctx.redraw();
        root.querySelector(".det")?.scrollIntoView({ block: "nearest" });
      },
      "add-asset"() { st.draft.assets.push({ kind: "image", name: "" }); ctx.redraw(); },
      "del-asset"(el) { st.draft.assets.splice(+el.dataset.i, 1); ctx.redraw(); },
      "del-trig"(el) { st.draft.rules.triggers = st.draft.rules.triggers.filter((t) => t !== el.dataset.t); ctx.redraw(); },
      discard() { if (st.draft.id) { st.draft = clone(st.orig); } else { st = { sel: null, draft: null, orig: null, confirm: false, resolving: null }; const f = d.sponsors[0]; if (f) open(f); } ctx.redraw(); },
      "ask-rm"() { st.confirm = true; ctx.redraw(); },
      "no-rm"() { st.confirm = false; ctx.redraw(); },
      async rm() { try { await api.del("/sponsors/" + st.draft.id); toast("Sponsor removed."); st = { sel: null, draft: null, orig: null, confirm: false, resolving: null }; ctx.rerender(); } catch (e) { fail(e); } },
      async save() {
        try {
          const body = clone(st.draft);
          body.assets = body.assets.map((a) => (a.seconds === undefined || a.seconds === null ? { kind: a.kind, name: a.name } : a));
          const s = await api.post("/sponsors", body);
          st.sel = s.id; st.draft = null; st.orig = null; st.confirm = false;
          if (st.resolving) st.resolving = null;
          toast("Saved."); ctx.rerender();
        } catch (e) { fail(e); }
      },
    };
    const onClick = (e) => { const el = e.target.closest("[data-act]"); if (el && el.tagName !== "SELECT" && act[el.dataset.act]) act[el.dataset.act](el); };
    const onChange = (e) => {
      const el = e.target;
      if (el.dataset?.act === "add-trig" && el.value) { st.draft.rules.triggers.push(el.value); ctx.redraw(); }
      else onInput(e);
    };
    root.addEventListener("click", onClick); root.addEventListener("input", onInput); root.addEventListener("change", onChange);
    // a new, never-saved sponsor has no orig: treat it as dirty via draft.id check in refresh
    return () => { root.removeEventListener("click", onClick); root.removeEventListener("input", onInput); root.removeEventListener("change", onChange); };
  },
};
