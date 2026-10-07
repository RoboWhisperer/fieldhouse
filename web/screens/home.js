import { html, icon, api, S, fail, go, fmtDate, fmtTime, fmtBytes } from "../app.js";

const chip = (cls, ic, text) => html`<span class="chip ${cls}">${icon(ic, "sm")}${text}</span>`;
const logo = (t) => html`<span class="logo-ph" style="background:${t.color};color:var(--action-ink)">${(t.abbr || "").slice(0, 2)}</span>`;
const when = (t) => `${new Date(t).toDateString() === new Date().toDateString() ? "Today" : fmtDate(t)}, ${fmtTime(t)}`;
const hasRoster = (g) => g.home.roster.length > 0 && g.away.roster.length > 0;
const seen = () => { try { return !!localStorage.getItem("fieldhouse.seenOnboarding"); } catch { return true; } };

const sportName = (n) => (n ? n[0].toUpperCase() + n.slice(1) : "");
export default {
  shell: "manage", nav: "home",
  css: `.hm{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:24px;padding:24px 32px}
.hm-l{display:grid;gap:16px;min-width:0;align-content:start}.hm-r{display:grid;gap:16px;align-content:start;min-width:0}
.hm-hero{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:24px;align-items:center;padding:20px 24px;flex-direction:row}
.hm-vs{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.hm-vs .tm{display:flex;align-items:center;gap:12px;font-size:20px;font-weight:650}.hm-vs .at{color:var(--text-3);font-weight:600}
.sp-c{color:var(--text-2)}.ok-t{display:inline-flex;align-items:center;gap:6px;color:var(--ready);font-weight:550}.hm .tbl td:first-child,.hm .tbl th:first-child{padding-left:14px}.hm-stat{display:flex;justify-content:space-between;align-items:baseline;padding:10px 0;border-bottom:1px solid var(--line)}.hm-stat:last-child{border-bottom:0}.hm-stat b{font-size:20px;font-weight:650;font-variant-numeric:tabular-nums}`,
  async load(ctx) {
    const games = await api.get("/games");
    if (!games.length && !seen()) { go("/welcome"); return { games, redirect: true }; }
    const [recordings, storage, airings, venues] = await Promise.all([api.get("/recordings"), api.get("/storage"), api.get("/reports/airings"), api.get("/venues")]);
    return { games, recordings, storage, airings, venueNames: Object.fromEntries(venues.map((v) => [v.id, v.name])) };
  },
  render(ctx, d) {
    if (d.redirect) return html``;
    const st = S.state, low = (st?.settings?.lowSpaceGb ?? 20) * 1e9;
    const sched = d.games.filter((g) => g.status !== "final").sort((a, b) => a.startsAt - b.startsAt);
    const done = d.games.filter((g) => g.status === "final").sort((a, b) => b.startsAt - a.startsAt);
    const venue = (g) => g.venueId || "";
    const next = sched[0];
    const recOf = (g) => d.recordings.find((r) => r.id === g.recordingId || r.gameId === g.id);
    const hours = d.recordings.reduce((t, r) => t + (r.endedAt ? r.endedAt - r.startedAt : 0), 0) / 3.6e6;
    const sp = {}; for (const r of d.airings.rows) if (r.outcome === "aired") sp[r.sponsorName] = (sp[r.sponsorName] || 0) + 1;
    const free = d.storage.freeBytes, total = d.storage.totalBytes, usedPct = Math.round(((total - free) / total) * 100);
    const hrsLeft = hours > 0 ? free / (d.recordings.reduce((t, r) => t + r.bytes, 0) / hours) : 0;
    const resume = st?.game && st.gameDoc?.status === "live";
    const empty = !d.games.length;
    return html`<div class="hm"><div class="hm-l">
      <div class="banner ok ${resume ? "" : "hidden"}" id="resume">${icon("play")}<div><b>A game is live.</b> <span class="muted">${st?.gameDoc?.title}</span></div><span class="sp"></span><button class="btn pri sm" data-go="/live">Resume live game</button></div>
      ${free < low && html`<div class="banner warn">${icon("alert")}<div><b>Disk space is low.</b> <span class="muted">${fmtBytes(free)} free. A full game recording needs about 3 GB.</span></div><span class="sp"></span><button class="btn sm" data-go="/settings/storage">Free up space</button></div>`}
      ${empty ? html`<section class="panel"><div class="empty"><h2 class="t">No games yet</h2><div>Add your first game to set up teams, rosters and cameras.</div><div class="row"><button class="btn pri lg" data-go="/game/new?fresh=1">${icon("plus")}Create your first game</button><button class="btn lg" data-act="demo">Load demo data</button></div></div></section>` : html`
      <section class="panel hm-hero">${next ? html`<div>
          <h2 class="t" style="margin-bottom:12px">Next game</h2>
          <div class="hm-vs"><div class="tm">${logo(next.home)}${next.home.name}</div><span class="at">vs</span><div class="tm">${logo(next.away)}${next.away.name}</div></div>
          <div class="muted" style="margin-top:10px;font-size:14px">${next.sport ? `${sportName(next.sport)} · ` : ""}${when(next.startsAt)}${d.venueNames[venue(next)] ? ` · ${d.venueNames[venue(next)]}` : ""}</div>
          <div class="row" style="margin-top:12px;gap:8px;flex-wrap:wrap">
            ${hasRoster(next) ? chip("ok", "check", "Rosters") : chip("warn", "alert", "Roster missing")}
            ${(st?.engine?.sources?.length || 0) > 0 ? chip("ok", "check", `Sources (${st.engine.sources.length})`) : chip("warn", "alert", "No sources")}
            ${chip("", "clock", "Preflight not run")}
          </div></div>
          <button class="btn pri xl" style="width:240px" data-start="${next.id}">${icon("play", "lg")}Start game night</button>`
        : html`<div><h2 class="t">No upcoming games</h2><div class="muted" style="margin-top:8px">Create the next game to get set up.</div></div><button class="btn pri xl" data-go="/game/new?fresh=1">${icon("plus", "lg")}New game</button>`}</section>
      <section class="panel"><div class="ph"><h3>Upcoming games</h3><span class="sp"></span><button class="btn sm ghost" data-go="/game/new?fresh=1">${icon("plus", "sm")}New game</button></div>
        ${sched.length ? html`<table class="tbl"><thead><tr><th>Date</th><th>Matchup</th><th>Sport</th><th>Setup</th><th></th></tr></thead><tbody>${sched.map((g) => html`<tr><td class="m">${fmtDate(g.startsAt)}, ${fmtTime(g.startsAt)}</td><td>${g.title}</td><td class="sp-c">${sportName(g.sport)}</td><td>${hasRoster(g) ? html`<span class="ok-t">${icon("check", "sm")}Rosters ready</span>` : chip("warn", "alert", "Roster missing")}</td><td class="n"><button class="btn sm ghost" data-open="${g.id}">Open</button></td></tr>`)}</tbody></table>` : html`<div class="empty">Nothing scheduled.</div>`}</section>
      <section class="panel"><div class="ph"><h3>Recent games</h3></div>
        ${done.length ? html`<table class="tbl"><thead><tr><th>Date</th><th>Matchup</th><th>Sport</th><th class="n">Score</th><th>Recording</th><th>Highlights</th></tr></thead><tbody>${done.slice(0, 5).map((g) => { const r = recOf(g); return html`<tr><td class="m">${fmtDate(g.startsAt)}</td><td>${g.title}</td><td class="sp-c">${sportName(g.sport)}</td><td class="n">${g.finalScore ? `${g.finalScore.home} – ${g.finalScore.away}` : "-"}</td><td>${r ? chip("ok", "check", `Saved · ${fmtBytes(r.bytes)}`) : html`<span class="faint">No recording</span>`}</td><td>${r ? (r.exported ? chip("ok", "check", "Exported") : chip("warn", "alert", "Not exported")) : ""}</td></tr>`; })}</tbody></table>` : html`<div class="empty">Finished games appear here.</div>`}</section>`}
    </div><aside class="hm-r">
      <section class="panel"><div class="ph"><h3>Season</h3></div><div class="pb" style="padding:4px 14px">
        <div class="hm-stat"><span class="muted">Games streamed</span><b>${done.length}</b></div>
        <div class="hm-stat"><span class="muted">Hours on air</span><b>${hours.toFixed(1)}</b></div>
        <div class="hm-stat"><span class="muted">Sponsor airings</span><b>${d.airings.summary.aired}</b></div>
        <div class="hm-stat"><span class="muted">Highlights exported</span><b>${d.recordings.filter((r) => r.exported).length}</b></div></div></section>
      <section class="panel"><div class="ph"><h3>Storage</h3></div><div class="pb col-g">
        <div class="row"><b style="font-size:20px">${fmtBytes(free)}</b><span class="muted">free of ${fmtBytes(total)}</span></div>
        <div class="bar ${free < low ? "warn" : "ok"}"><b style="width:${usedPct}%"></b></div>
        <div class="muted" style="font-size:12.5px">${hrsLeft ? `About ${Math.floor(hrsLeft)} hours of recording left at your usual quality. ` : ""}Recordings use ${fmtBytes(d.storage.recordingsBytes)}.</div>
        <button class="btn sm" data-go="/settings/storage">${icon("folder", "sm")}Manage recordings</button></div></section>
      <section class="panel"><div class="ph"><h3>Sponsor airings</h3></div><div class="pb" style="padding:4px 14px">
        ${Object.keys(sp).length ? Object.entries(sp).sort((a, b) => b[1] - a[1]).map(([n, c]) => html`<div class="hm-stat"><span>${n}</span><b>${c}</b></div>`) : html`<div class="muted" style="padding:10px 0">No sponsor breaks aired yet.</div>`}</div></section>
    </aside></div>`;
  },
  bind(root, ctx, d) {
    root.onclick = async (e) => {
      const t = e.target.closest("button"); if (!t) return;
      try {
        if (t.dataset.go) go(t.dataset.go);
        else if (t.dataset.start || t.dataset.open) { await api.post(`/games/${t.dataset.start || t.dataset.open}/activate`); go("/game/new"); }
        else if (t.dataset.act === "demo") { await api.post("/demo"); ctx.rerender(); }
      } catch (err) { fail(err); }
    };
  },
  onState(root, st) { root.querySelector("#resume")?.classList.toggle("hidden", !(st.game && st.gameDoc?.status === "live")); },
};
