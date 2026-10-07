import { html, icon, api, S, fail, go, toast, fmtDate } from "../app.js";
import "../sport.js";

const SP = globalThis.FHSport;

const HOME = "#F5A524", AWAY = "#8B6CFF"; // = --home / --away in tokens.css (color inputs need hex)
const pad = (n) => String(n).padStart(2, "0");
const dateStr = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const timeStr = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const team = (t, color) => ({ name: t?.name || "", abbr: t?.abbr || "", color: t?.color || color, roster: t?.roster || [] });

function ribbon(f, prof) {
  const ab = (t, d) => (t.abbr || t.name || d).toUpperCase().slice(0, 8);
  const sp = prof ? SP.summaryOf(prof) : null, [pl, pn] = sp ? SP.splitLabel(sp.periodLabels[0]) : ["Q", "1"];
  return html`<i class="cap" style="background:${f.home.color}"></i><div class="team">${ab(f.home, "Home")} <span class="score">00</span></div><div class="mid"><span class="per"><small style="font:700 11px var(--ui);color:var(--text-2);margin-right:2px">${pl}</small>${pn}</span>${sp?.clockMode === "none" ? "" : html`<span class="clk">00:00</span>`}</div><div class="team"><span class="score">00</span> ${ab(f.away, "Away")}</div><i class="cap" style="background:${f.away.color}"></i>`;
}
const autoAbbr = (name) => name.trim().split(/\s+/)[0].replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase();
const autoTitle = (f) => (f.home.name && f.away.name ? `${f.home.name} vs ${f.away.name}` : "");

export default {
  shell: "night", step: 1,
  css: `.ng{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:start}.ng .full{grid-column:1/-1}
.ng .pb.f{display:grid;gap:16px;align-content:start}.ng .tm{display:grid;gap:12px;padding-bottom:16px;border-bottom:1px solid var(--line)}.ng .tm:last-of-type{border-bottom:0;padding-bottom:0}
.ng .g2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}.ng .g2.t{grid-template-columns:minmax(0,1fr) 100px}
.ng .dest{display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid var(--line)}.ng .dest .nm{font-weight:600}.ng .dest .sub{font-size:12px;color:var(--text-2)}
.ng button.switch{border:0;padding:0;cursor:pointer}.ng .input input,.ng .input select{background:none;border:0;color:inherit;font:inherit;outline:0;width:100%;min-width:0}
.ng input[type=color]{width:28px;height:24px;padding:0;border:0;background:none;flex:none}.ng .input:focus-within{border-color:var(--action);box-shadow:0 0 0 3px rgba(61,139,253,.25)}
.sports{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:8px}
.sports .sc{position:relative;display:grid;gap:2px;text-align:left;padding:10px 12px;border-radius:var(--r-ctl);border:1px solid var(--line-strong);background:var(--inset);color:var(--text);cursor:pointer;min-height:56px;align-content:start}
.sports .sc b{font-weight:650}.sports .sc span{font-size:12px;color:var(--text-2)}.sports .sc:hover:not(:disabled){background:var(--raised)}
.sports .sc[aria-checked=true]{border-color:var(--action);background:var(--action-wash);box-shadow:0 0 0 1px var(--action) inset}
.sports .sc:disabled{cursor:default;opacity:.7}.sports .sc .df{position:absolute;top:8px;right:8px;font:600 11px var(--ui);font-style:normal;color:var(--text-3)}
.ng select option{background:var(--panel)}.ng .foot{display:flex;align-items:center;gap:12px}`,
  async load(ctx) {
    const [venues, dests, games, profiles] = await Promise.all([api.get("/venues"), api.get("/destinations"), api.get("/games"), api.get("/profiles")]);
    const cur = S.state?.gameDoc;
    const editing = !ctx.query.fresh && cur && cur.status !== "final" ? cur : null;
    const last = games.filter((g) => g.status === "final").sort((a, b) => b.startsAt - a.startsAt)[0];
    const clone = !editing && !ctx.query.blank && last ? last : null;
    const src = editing || clone;
    let t = new Date(); t.setHours(19, 0, 0, 0); if (t < Date.now()) t.setDate(t.getDate() + 1);
    const f = {
      id: editing?.id, status: editing?.status || "scheduled", titleTouched: !!editing,
      home: team(src?.home, HOME), away: team(src?.away, AWAY), title: editing?.title || (clone ? autoTitle({ home: clone.home, away: clone.away }) : ""),
      date: dateStr(editing?.startsAt || t), time: timeStr(editing?.startsAt || t),
      profileId: editing?.profileId || clone?.profileId || S.state?.settings?.defaultProfileId || "basketball",
      venueId: src?.venueId || venues[0]?.id || "", destinationIds: src?.destinationIds || dests.filter((x) => x.kind === "record").map((x) => x.id),
    };
    return { f, venues, dests, clone, form: null, profiles, started: !!editing?.profileSnapshot }; // a started game keeps the sport (and rules) it began with
  },
  render(ctx, d) {
    const { f } = d, prof = d.profiles.find((p) => p.id === f.profileId);
    const tm = (side, label) => html`<div class="tm"><div class="row"><span class="chip">${label}</span></div>
      <div class="g2 t"><div class="field"><label>Team name</label><div class="input"><input data-f="${side}.name" value="${f[side].name}" maxlength="40" placeholder="${label === "Home" ? "Westfield Wildcats" : "Lincoln Lions"}"></div></div>
        <div class="field"><label>Abbreviation</label><div class="input mono"><input data-f="${side}.abbr" value="${f[side].abbr}" maxlength="8" placeholder="WIL" style="text-transform:uppercase"></div></div></div>
      <div class="field"><label>Team color</label><div class="input"><input type="color" data-f="${side}.color" value="${f[side].color}" aria-label="${label} team color"><span class="mono muted" data-hex="${side}">${f[side].color.toUpperCase()}</span><span class="sp"></span><span class="faint">Score bug and ribbon only</span></div></div></div>`;
    const frm = d.form;
    return html`<div class="ng">
      ${d.clone && html`<div class="banner info full">${icon("info")}<span>Cloned from your last game${d.clone.title ? html`: <b>${d.clone.title}</b>` : ""} (${fmtDate(d.clone.startsAt)}). Change anything below.</span><span class="sp"></span><button class="btn sm ghost" data-go="/game/new?fresh=1&blank=1">Start blank</button></div>`}
      <section class="panel"><div class="ph"><h3>Teams</h3></div><div class="pb f">${tm("home", "Home")}${tm("away", "Away")}
        <div class="col-g" style="gap:8px"><span class="muted" style="font-size:12px;font-weight:600">Preview on air</span><div class="ribbon pre" id="prev" style="align-self:flex-start">${ribbon(f, prof)}</div></div></div></section>
      <section class="panel"><div class="ph"><h3>Details</h3></div><div class="pb f"><div class="g2">
        <div class="field"><label>Date</label><div class="input">${icon("cal")}<input type="date" data-f="date" value="${f.date}"></div></div>
        <div class="field"><label>Start time</label><div class="input">${icon("clock")}<input type="time" data-f="time" value="${f.time}"></div></div>
        <div class="field" style="grid-column:1/-1"><span class="fl" id="sport-l">Sport</span><div class="sports" role="radiogroup" aria-labelledby="sport-l" aria-describedby="sport-h" id="sport">${d.profiles.map((p) => html`<button type="button" class="sc" role="radio" data-sport="${p.id}" aria-checked="${p.id === f.profileId}" ${d.started ? "disabled" : ""}><b>${p.name}</b><span>${p.clock.mode === "none" ? SP.plural(p.periods.count, "set") + ", no clock" : SP.plural(p.periods.count, "period") + (p.periods.lengthMin ? ` of ${p.periods.lengthMin} min` : "")}</span>${p.id === (S.state?.settings?.defaultProfileId || "basketball") ? html`<i class="df">Default</i>` : ""}</button>`)}</div>
          <span class="hint" id="sport-h">${d.started ? "This game has started, so it keeps its sport and rules. " : ""}<span data-sdesc>${prof ? SP.describe(prof) : ""}</span> <a href="#/settings/sport">Edit sports</a></span></div>
        <div class="field" style="grid-column:1/-1"><label>Venue</label><div class="input"><select data-f="venueId" aria-label="Venue">${d.venues.length ? d.venues.map((v) => html`<option value="${v.id}" ${v.id === f.venueId ? "selected" : ""}>${v.name}</option>`) : html`<option value="">No venues yet (add one on Sources)</option>`}</select></div></div>
        <div class="field" style="grid-column:1/-1"><label>Broadcast title</label><div class="input"><input data-f="title" id="title" value="${f.title}" maxlength="100" placeholder="${autoTitle(f) || "Home vs Away · Boys Varsity Basketball"}"></div></div></div></div>
        <div class="ph" style="border-top:1px solid var(--line)"><h3>Destinations</h3></div>
        <div>${d.dests.map((x) => html`<div class="dest"><button class="switch ${f.destinationIds.includes(x.id) ? "on" : ""}" role="switch" aria-checked="${f.destinationIds.includes(x.id)}" aria-label="Use ${x.name}" data-tog="${x.id}"></button>
          <div><div class="nm">${x.name}</div><div class="sub">${x.kind === "record" ? "Saves to this laptop" : x.url || "No server address yet"}</div></div><span class="sp"></span>
          ${x.kind === "record" ? html`<span class="chip ok">${icon("check", "sm")}Ready</span>` : x.keySet ? html`<span class="chip ok">${icon("check", "sm")}Connected</span><button class="btn sm" data-test="${x.id}">Test</button>` : html`<button class="btn sm" data-edit="${x.id}">Connect</button>`}</div>`)}
          <div class="dest"><div><div class="nm">Custom RTMP or SRT</div><div class="sub">For other streaming services</div></div><span class="sp"></span><button class="btn sm" data-edit="new">Add</button></div>
          ${frm && html`<form class="col-g" id="dform" style="padding:14px;border-top:1px solid var(--line)"><div class="g2"><div class="field"><label>Name</label><div class="input"><input name="name" value="${frm.name}" required maxlength="60"></div></div>
            <div class="field"><label>Type</label><div class="input"><select name="kind" ${frm.id ? "disabled" : ""}>${["rtmp", "srt", "youtube", "facebook"].map((k) => html`<option ${k === frm.kind ? "selected" : ""}>${k}</option>`)}</select></div></div></div>
            <div class="field"><label>Server address</label><div class="input mono"><input name="url" value="${frm.url}" placeholder="rtmp://live.example.com/app"></div></div>
            <div class="field"><label>Stream key</label><div class="input mono"><input name="key" type="password" autocomplete="off" placeholder="${frm.keySet ? "Saved. Type a new key to replace it" : "Paste your stream key"}"></div><span class="hint">The key is saved on this computer and never shown again.</span></div>
            <div class="row"><button class="btn pri sm" type="submit">Save destination</button><button class="btn ghost sm" type="button" data-edit="">Cancel</button></div></form>`}</div></section>
      <div class="foot full"><button class="btn ghost" data-go="/">${icon("left")}Cancel</button><span class="sp"></span><span class="muted">Next: rosters</span><button class="btn pri lg" data-act="save">Continue to Rosters${icon("right")}</button></div></div>`;
  },
  bind(root, ctx, d) {
    const { f } = d;
    root.querySelectorAll(".field").forEach((fl, i) => { const l = fl.querySelector(":scope > label"), c = fl.querySelector("input,select"); if (l && c && !l.htmlFor) { c.id ||= "ngf" + i; l.htmlFor = c.id; } }); // labels name their fields for screen readers
    const touched = new Set(["home", "away"].filter((t) => f[t].abbr)); // a cloned or saved abbreviation is the operator's choice
    const set = (path, v) => { const k = path.split("."); const last = k.pop(); k.reduce((o, x) => o[x], f)[last] = v; };
    const profOf = () => d.profiles.find((p) => p.id === f.profileId);
    const prev = () => { root.querySelector("#prev").innerHTML = ribbon(f, profOf()).s; root.querySelector("[data-sdesc]").textContent = profOf() ? SP.describe(profOf()) : ""; };
    root.oninput = (e) => {
      const p = e.target.dataset.f; if (!p) return;
      set(p, p.endsWith("abbr") ? e.target.value.toUpperCase() : e.target.value);
      if (p.endsWith("color")) root.querySelector(`[data-hex="${p.split(".")[0]}"]`).textContent = e.target.value.toUpperCase();
      const side = p.split(".")[0];
      if (p.endsWith("abbr")) touched.add(side);
      if (p.endsWith("name") && !touched.has(side)) { f[side].abbr = autoAbbr(f[side].name); root.querySelector(`[data-f="${side}.abbr"]`).value = f[side].abbr; } // the operator can still type their own
      if (!f.titleTouched && /name$/.test(p)) { f.title = autoTitle(f); root.querySelector("#title").value = f.title; }
      if (p === "title") f.titleTouched = true;
      prev();
    };
    root.onsubmit = async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(e.target)); const x = d.form;
      try {
        const saved = await api.post("/destinations", { id: x.id || undefined, kind: x.id ? x.kind : v.kind, name: v.name, url: v.url, key: v.key || undefined });
        if (!x.id) f.destinationIds.push(saved.id);
        d.form = null; d.dests = await api.get("/destinations"); ctx.redraw();
      } catch (err) { fail(err); }
    };
    root.onclick = async (e) => {
      const t = e.target.closest("button"); if (!t) return;
      try {
        if (t.dataset.sport) { f.profileId = t.dataset.sport; root.querySelectorAll("[data-sport]").forEach((b) => b.setAttribute("aria-checked", b === t)); prev(); }
        else if (t.dataset.go) go(t.dataset.go);
        else if (t.dataset.tog) { const i = f.destinationIds.indexOf(t.dataset.tog); i < 0 ? f.destinationIds.push(t.dataset.tog) : f.destinationIds.splice(i, 1); t.classList.toggle("on", i < 0); t.setAttribute("aria-checked", i < 0); }
        else if (t.dataset.test) { const r = await api.post(`/destinations/${t.dataset.test}/test`); toast(r.message); }
        else if (t.dataset.edit !== undefined) {
          const x = d.dests.find((y) => y.id === t.dataset.edit);
          d.form = t.dataset.edit === "" ? null : x ? { ...x, url: x.url || "" } : { kind: "rtmp", name: "", url: "" };
          ctx.redraw();
        } else if (t.dataset.act === "save") {
          const when = new Date(`${f.date}T${f.time}`).getTime();
          const base = f.id ? await api.get(`/games/${f.id}`) : {};
          const game = { ...base, ...(d.started ? {} : { profileId: f.profileId }), title: f.title.trim() || autoTitle(f), startsAt: when, venueId: f.venueId, destinationIds: f.destinationIds, status: f.status,
            home: { ...f.home, roster: base.home?.roster || f.home.roster }, away: { ...f.away, roster: base.away?.roster || f.away.roster } };
          const saved = f.id ? await api.put(`/games/${f.id}`, game) : await api.post("/games", game);
          await api.post(`/games/${saved.id}/activate`);
          go("/game/roster");
        }
      } catch (err) { fail(err); }
    };
  },
};
