import { html, icon, api, fail, mmss, fmtDate, period } from "../app.js";

const TRIG = { pregame: "Pregame", timeout: "Timeout", period_end: "End of period", halftime: "Halftime", postgame: "Postgame" };
let st = { q: null, f: { sponsorId: "", gameId: "", from: "", to: "" }, sort: { key: "at", dir: -1 }, drawer: true, viewerForm: false };

const getViewers = () => { try { return JSON.parse(localStorage.getItem("fh.viewers") || "{}"); } catch { return {}; } };
const setViewer = (gameId, n) => { try { const v = getViewers(); v[gameId] = n; localStorage.setItem("fh.viewers", JSON.stringify(v)); return true; } catch { return false; } };

const qs = () => {
  const p = new URLSearchParams(), f = st.f;
  if (f.sponsorId) p.set("sponsorId", f.sponsorId);
  if (f.gameId) p.set("gameId", f.gameId);
  if (f.from) p.set("from", String(new Date(f.from + "T00:00:00").getTime()));
  if (f.to) p.set("to", String(new Date(f.to + "T23:59:59.999").getTime()));
  const s = p.toString(); return s ? "?" + s : "";
};
const dur = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const OUT = {
  aired: (r) => html`<span class="pill ready noDot">${icon("check", "sm")}Aired</span>`,
  skipped: () => html`<span class="pill off noDot">${icon("minus", "sm")}Skipped</span>`,
  delayed: () => html`<span class="pill check noDot">${icon("clock", "sm")}Delayed</span>`,
};
const val = { at: (r) => r.at, game: (r) => r.gameTitle, sponsor: (r) => r.sponsorName, trigger: (r) => r.trigger, seconds: (r) => r.seconds, outcome: (r) => r.outcome, viewers: (r) => getViewers()[r.gameId] ?? -1 };

const css = `
.pf-pg{display:grid;gap:16px}
.pf-body{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:16px;align-items:start}
.pf-body.nodrawer{grid-template-columns:minmax(0,1fr)}
.filters{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap}
.filters .field{min-width:0}
.pf-pg select.select,.pf-pg input.input{font:inherit;color:var(--text)}
.pf-pg select.select{appearance:none;-webkit-appearance:none;padding-right:28px}
.pf-pg :focus-visible{outline:2px solid var(--action);outline-offset:1px}
.sum{flex-direction:row;display:flex;align-items:center;gap:0;min-height:56px;padding:0 8px;flex-wrap:wrap}
.sum>div{display:flex;align-items:baseline;gap:8px;padding:0 20px}
.sum b{font-size:20px;font-weight:650;font-variant-numeric:tabular-nums}
.sum .vr{width:1px;height:28px;background:var(--line);padding:0}
.tbl.t2 td,.tbl.t2 th{padding:0 10px}
.tbl.t2 td{height:44px}
.tbl.t2 th button{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:4px;text-transform:inherit;letter-spacing:inherit}
.tbl.t2 th button:focus-visible{outline:2px solid var(--action)}
.tbl.t2 th[aria-sort] button{color:var(--text)}
.paper{background:var(--text);color:var(--ground);border-radius:6px;padding:20px;display:grid;gap:10px;align-content:start;min-height:0}
.paper h4{margin:0;font-size:16px;font-weight:700}
.paper .pm{font-size:12px;color:var(--ground)}
.paper .pr{display:flex;justify-content:space-between;gap:8px;font-size:12px;padding:5px 0;border-top:1px solid var(--text-2)}
.paper .pr span:last-child{font-family:var(--mono);white-space:nowrap}
.pf-pg [hidden]{display:none!important}
@media print{
  body *{visibility:hidden}
  .paper,.paper *{visibility:visible}
  .paper{position:absolute;left:0;top:0;width:100%;background:#fff;color:#000;border-radius:0}
  .paper .pr{border-color:#999}
}
`;

function paper(d) {
  const rows = d.rows, sel = (id, list) => list.find((x) => x.id === id);
  const scope = [st.f.sponsorId ? sel(st.f.sponsorId, d.sponsors)?.name : "All sponsors", st.f.gameId ? sel(st.f.gameId, d.games)?.title : "All games", st.f.from || st.f.to ? `${st.f.from || "start"} to ${st.f.to || "today"}` : "All dates"].join(" · ");
  const tally = (key) => { const m = new Map(); for (const r of rows) { const k = key(r); const e = m.get(k) ?? { n: 0, s: 0 }; e.n++; if (r.outcome === "aired") e.s += r.seconds; m.set(k, e); } return [...m]; };
  const v = getViewers(), gv = [...new Set(rows.map((r) => r.gameId))].filter((g) => v[g] != null);
  return html`<div class="paper" id="paper"><h4>Proof of play</h4>
    <div class="pm">${scope}<br>Generated ${fmtDate(Date.now(), { year: "numeric", month: "short", day: "numeric" })}</div>
    <div class="pr"><span>Airings</span><span>${d.summary.airings}</span></div>
    <div class="pr"><span>Total airtime</span><span>${dur(d.summary.seconds)}</span></div>
    <div class="pr"><span>Games</span><span>${d.summary.games}</span></div>
    <div class="pr"><span>Aired / skipped / delayed</span><span>${d.summary.aired} / ${d.summary.skipped} / ${d.summary.delayed}</span></div>
    ${tally((r) => r.gameTitle).map(([k, e]) => html`<div class="pr"><span>${k}</span><span>${e.n} airings</span></div>`)}
    ${tally((r) => r.sponsorName).map(([k, e]) => html`<div class="pr"><span>${k}</span><span>${e.n} airings, ${dur(e.s)}</span></div>`)}
    ${gv.map((g) => html`<div class="pr"><span>Viewers: ${rows.find((r) => r.gameId === g).gameTitle}</span><span>${v[g]}</span></div>`)}
    <div class="pm" style="margin-top:6px">Viewer counts are not included unless entered by the school.</div></div>`;
}

export default {
  shell: "manage", nav: "reports", css,
  async load(ctx) {
    if (st.q !== ctx.query) { st.q = ctx.query; st.f = { sponsorId: ctx.query.sponsorId || "", gameId: ctx.query.gameId || "", from: "", to: "" }; st.viewerForm = false; }
    const [sponsors, games, r] = await Promise.all([api.get("/sponsors"), api.get("/games"), api.get("/reports/airings" + qs())]);
    return { sponsors, games, rows: r.rows, summary: r.summary };
  },
  render(ctx, d) {
    const f = st.f, v = getViewers(), showV = d.rows.some((r) => v[r.gameId] != null);
    const rows = [...d.rows].sort((a, b) => { const x = val[st.sort.key](a), y = val[st.sort.key](b); return (x < y ? -1 : x > y ? 1 : 0) * st.sort.dir; });
    const th = (k, label, cls = "") => html`<th class="${cls}" ${st.sort.key === k ? `aria-sort="${st.sort.dir > 0 ? "ascending" : "descending"}"` : ""}><button data-sort="${k}">${label}${st.sort.key === k ? icon(st.sort.dir > 0 ? "up2" : "down2", "sm") : ""}</button></th>`;
    const gamesInRows = [...new Map(d.rows.map((r) => [r.gameId, r.gameTitle]))];
    return html`<div class="main-pad"><div class="pf-pg">
      <div class="row"><h1 class="t">Reports</h1><span class="sp"></span>
        <a class="btn" style="text-decoration:none" href="/api/reports/airings.csv${qs()}" download="proof-of-play.csv">${icon("down2")}Export CSV</a>
        <button class="btn pri" data-act="drawer">${icon("film")}Export PDF</button></div>

      <div class="filters">
        <div class="field" style="width:200px"><label for="f-sp">Sponsor</label><select id="f-sp" class="select" data-f="sponsorId"><option value="">All sponsors</option>${d.sponsors.map((s) => html`<option value="${s.id}" ${f.sponsorId === s.id ? "selected" : ""}>${s.name}</option>`)}</select></div>
        <div class="field" style="width:260px"><label for="f-game">Game</label><select id="f-game" class="select" data-f="gameId"><option value="">All games</option>${d.games.map((g) => html`<option value="${g.id}" ${f.gameId === g.id ? "selected" : ""}>${g.title}</option>`)}</select></div>
        <div class="field"><label for="f-from">From</label><input id="f-from" class="input" type="date" data-f="from" value="${f.from}"></div>
        <div class="field"><label for="f-to">To</label><input id="f-to" class="input" type="date" data-f="to" value="${f.to}"></div>
        ${f.sponsorId || f.gameId || f.from || f.to ? html`<button class="btn ghost" data-act="clear">Clear filters</button>` : ""}
      </div>

      ${d.rows.length ? html`
      <div class="panel sum">
        <div><b>${d.summary.airings}</b><span class="muted">airings</span></div><span class="vr"></span>
        <div><b>${dur(d.summary.seconds)}</b><span class="muted">total airtime</span></div><span class="vr"></span>
        <div><b>${d.summary.games}</b><span class="muted">games</span></div><span class="vr"></span>
        <div><span class="muted">${d.summary.aired} aired</span><span class="faint">${d.summary.skipped} skipped</span><span class="faint">${d.summary.delayed} delayed</span></div>
      </div>` : ""}

      <div class="pf-body ${st.drawer && d.rows.length ? "" : "nodrawer"}">
        <div class="panel">
          ${d.rows.length ? html`<div style="overflow-x:auto"><table class="tbl t2">
            <thead><tr>${th("game", "Game")}${th("at", "When")}${th("sponsor", "Sponsor")}${th("trigger", "Break")}${th("seconds", "Length", "n")}${th("outcome", "Outcome")}${showV ? th("viewers", "Viewers", "n") : ""}</tr></thead>
            <tbody>${rows.map((r) => html`<tr><td>${r.gameTitle}</td><td class="m">${fmtDate(r.at)} ${period(r.period)} ${mmss(r.gameClockMs)}</td><td>${r.sponsorName}</td><td class="muted">${TRIG[r.trigger] ?? r.trigger}</td><td class="n m">${dur(r.seconds)}</td><td>${OUT[r.outcome](r)}</td>${showV ? html`<td class="n m">${v[r.gameId] ?? ""}</td>` : ""}</tr>`)}</tbody></table></div>`
          : html`<div class="empty">${icon("chart", "lg")}<h3 class="t">No sponsor breaks have aired yet</h3><div>${f.sponsorId || f.gameId || f.from || f.to ? "Nothing matches these filters. Try clearing them." : "Once a sponsor break airs during a game, it shows up here as proof of play."}</div></div>`}
          <div class="row" style="padding:10px 14px;border-top:1px solid var(--line);flex-wrap:wrap">
            ${icon("info")}<span class="faint">Viewer counts are only shown when you enter them.</span><span class="sp"></span>
            ${st.viewerForm ? html`<select class="select" style="height:28px" aria-label="Game" id="vg">${(gamesInRows.length ? gamesInRows : d.games.map((g) => [g.id, g.title])).map(([id, t]) => html`<option value="${id}">${t}</option>`)}</select>
              <input class="input" style="height:28px;width:100px" type="number" min="0" id="vn" aria-label="Viewers" placeholder="Viewers">
              <button class="btn sm pri" data-act="vsave">Save</button><button class="btn sm ghost" data-act="vcancel">Cancel</button>`
            : html`<button class="btn sm ghost" data-act="vopen">${icon("plus", "sm")}Enter viewer count</button>`}
          </div>
        </div>
        ${st.drawer && d.rows.length ? html`<aside class="panel">
          <div class="ph"><h3>PDF preview</h3><span class="sp"></span><button class="btn sm" data-act="print">Print or save as PDF</button><button class="btn sm ghost" aria-label="Close preview" data-act="drawer">${icon("x", "sm")}</button></div>
          <div class="pb" style="padding:12px;display:grid">${paper(d)}</div></aside>` : ""}
      </div>
    </div></div>`;
  },
  bind(root, ctx) {
    const onChange = (e) => { const el = e.target.closest("[data-f]"); if (!el) return; st.f[el.dataset.f] = el.value; ctx.rerender(); };
    const onClick = (e) => {
      const s = e.target.closest("[data-sort]");
      if (s) { const k = s.dataset.sort; st.sort = { key: k, dir: st.sort.key === k ? -st.sort.dir : 1 }; return ctx.redraw(); }
      const a = e.target.closest("[data-act]")?.dataset.act; if (!a) return;
      if (a === "drawer") { st.drawer = !st.drawer; ctx.redraw(); }
      else if (a === "clear") { st.f = { sponsorId: "", gameId: "", from: "", to: "" }; ctx.rerender(); }
      else if (a === "print") window.print();
      else if (a === "vopen") { st.viewerForm = true; ctx.redraw(); }
      else if (a === "vcancel") { st.viewerForm = false; ctx.redraw(); }
      else if (a === "vsave") {
        const n = Number(root.querySelector("#vn").value), g = root.querySelector("#vg").value;
        if (!g || !Number.isInteger(n) || n < 0 || root.querySelector("#vn").value === "") return fail(new Error("Enter a whole number of viewers."));
        if (!setViewer(g, n)) fail(new Error("This browser would not save the viewer count."));
        st.viewerForm = false; ctx.redraw();
      }
    };
    root.addEventListener("change", onChange); root.addEventListener("click", onClick);
    return () => { root.removeEventListener("change", onChange); root.removeEventListener("click", onClick); };
  },
};
