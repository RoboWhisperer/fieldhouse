// All games: find, open and safely remove old or upcoming games.
import { html, icon, api, fail, go, toast, fmtDate, fmtTime, fmtBytes } from "../app.js";

const ST = { scheduled: ["info", "Scheduled"], live: ["warn", "Live"], final: ["ok", "Final"] };
const sportName = (n) => (n ? n[0].toUpperCase() + n.slice(1) : "");
const when = (t) => `${fmtDate(t, { year: "numeric", month: "short", day: "numeric" })}, ${fmtTime(t)}`;

export default {
  shell: "manage", nav: "home",
  css: `.gm{padding:24px 32px;display:grid;gap:16px;align-content:start}.gm .top{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.gm .tbl td:first-child,.gm .tbl th:first-child{padding-left:14px}.gm .acts{display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap}.gm .empty{padding:36px}.gm .tblwrap{overflow-x:auto}`,
  async load() {
    const [games, recordings] = await Promise.all([api.get("/games"), api.get("/recordings")]);
    return {
      games: games.sort((a, b) => b.startsAt - a.startsAt),
      recs: Object.fromEntries(recordings.map((r) => [r.gameId, r])),
    };
  },
  render(ctx, d) {
    const upcoming = d.games.filter((g) => g.status !== "final").length;
    const done = d.games.length - upcoming;
    return html`<div class="gm">
      <div class="top"><div><h1 class="t">All games</h1><div class="muted">${d.games.length} game${d.games.length === 1 ? "" : "s"} · ${upcoming} upcoming or live · ${done} final</div></div><span class="sp"></span><a class="btn pri" href="#/game/new?fresh=1">${icon("plus")}New game</a></div>
      <section class="panel">
        <div class="ph"><h3>Game history</h3><span class="sp"></span><span class="hint">Deleting a game removes its event log and sponsor airings. Recordings stay until you remove them in Storage.</span></div>
        ${d.games.length ? html`<div class="tblwrap"><table class="tbl"><thead><tr><th>Date</th><th>Matchup</th><th>Sport</th><th>Status</th><th class="n">Score</th><th>Recording</th><th></th></tr></thead><tbody>${d.games.map((g) => {
          const r = d.recs[g.id], st = ST[g.status] ?? ["off", g.status];
          return html`<tr><td class="m">${when(g.startsAt)}</td><td>${g.title}</td><td class="sp-c">${sportName(g.sport)}</td><td><span class="pill ${st[0]}">${st[1]}</span></td>
            <td class="n">${g.finalScore ? `${g.finalScore.home} – ${g.finalScore.away}` : "-"}</td>
            <td>${r ? html`<span class="muted">${fmtBytes(r.bytes)}${r.exported ? " · exported" : ""}</span>` : html`<span class="faint">None</span>`}</td>
            <td class="n"><div class="acts">
              ${g.status === "live" ? html`<a class="btn sm" href="#/live">${icon("play", "sm")}Resume</a>` : g.status === "final" ? html`<a class="btn sm ghost" href="#/reports?gameId=${encodeURIComponent(g.id)}">${icon("chart", "sm")}Proof of play</a>` : html`<a class="btn sm" href="#/game/new?fresh=1&game=${encodeURIComponent(g.id)}">${icon("sliders", "sm")}Open</a>`}
              <button class="btn sm ghost del" data-del="${g.id}" ${g.status === "live" ? "disabled title=\"Stop the game before deleting it\"" : ""}>${icon("x", "sm")}Delete</button>
            </div></td></tr>`;
        })}</tbody></table></div>` : html`<div class="empty">${icon("cal", "lg")}<b>No games yet</b><span>Create a game to set up teams, rosters and cameras.</span><a class="btn pri" href="#/game/new?fresh=1">${icon("plus")}Create a game</a></div>`}
      </section>
    </div>`;
  },
  bind(root, ctx, d) {
    root.onclick = async (e) => {
      const t = e.target.closest("button[data-del]"); if (!t || t.disabled) return;
      const g = d.games.find((x) => x.id === t.dataset.del); if (!g) return;
      if (!confirm(`Delete "${g.title}"?\n\nThis removes the game, its event log and sponsor airings. The recording file stays on this computer, and the audit log keeps a record of the deletion. This cannot be undone.`)) return;
      try { await api.del(`/games/${encodeURIComponent(g.id)}`); toast(`Deleted "${g.title}".`); ctx.rerender(); }
      catch (err) { fail(err); }
    };
  },
};
