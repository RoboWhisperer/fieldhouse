// Settings sections: diagnostics, about.
import { html, icon, api, S, toast, fail, fmtBytes } from "../app.js";
import { REPO, delegate, all, sw, copyText, lnk, panel } from "./settings-ui.js";

const paint = (root, view) => { const b = root.querySelector("[data-box]"); if (b) b.innerHTML = view().s; const l = root.querySelector(".stlog"); if (l) l.scrollTop = l.scrollHeight; };
const pill = (cls, text) => html`<span class="pill ${cls}">${text}</span>`;
const LV = { INFO: ["info", "Info"], WARN: ["check", "Warn"], ERROR: ["err", "Error"] };
const hhmmss = (t) => new Date(t).toLocaleTimeString([], { hour12: false });

// ================================================================ diagnostics
const clockTxt = (sec) => { const s = Math.max(0, Math.round(sec)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`; };
const niceMax = (v, step) => Math.max(step * 2, Math.ceil(v / step) * step);
/** Line chart in the design's style (design/screens/14g): real samples, scaled axes. pick(sample) -> value; unit divides it for labels. */
function lineChart(series, { pick, unit, step, label, h = 150, stroke = "var(--action)", fill = false, mark }) {
  const L = 44, R = 870, T = 10, B = h - 24, W = R - L, H = B - T;
  const sm = series.samples, t0 = sm[0].t, span = Math.max(1, sm.at(-1).t - t0);
  const vals = sm.map((x) => pick(x) / unit), top = niceMax(Math.max(...vals), step);
  const X = (t) => L + ((t - t0) / span) * W, Y = (v) => B - (v / top) * H;
  const grid = [0, 1, 2, 3, 4].map((i) => top * i / 4);
  const pts = sm.map((x, i) => `${X(x.t).toFixed(1)},${Y(vals[i]).toFixed(1)}`);
  const secs = span / 1000, xl = [0, 0.25, 0.5, 0.75, 1];
  const m = mark?.(sm, vals);
  return html`<svg viewBox="0 0 882 ${h}" role="img" aria-label="${label}" style="width:100%;height:auto;display:block">
    <g stroke="var(--line)" stroke-width="1">${grid.map((v) => html`<line x1="${L}" x2="${R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/>`)}</g>
    <line x1="${L}" x2="${R}" y1="${B}" y2="${B}" stroke="var(--line-strong)"/>
    <g fill="var(--text-3)" font-size="12">${grid.map((v) => html`<text x="${L - 8}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${+v.toFixed(1)}</text>`)}</g>
    <g fill="var(--text-3)" font-size="12">${xl.map((f, i) => html`<text x="${(L + f * W).toFixed(1)}" y="${h - 5}" text-anchor="${i === 0 ? "start" : i === 4 ? "end" : "middle"}">${clockTxt(f * secs)}</text>`)}</g>
    ${fill && html`<polygon points="${L},${B} ${pts.join(" ")} ${X(sm.at(-1).t).toFixed(1)},${B}" fill="${stroke}" opacity=".14"/>`}
    <polyline points="${pts.join(" ")}" fill="none" stroke="${stroke}" stroke-width="2.25" stroke-linejoin="round"/>
    ${m && html`<circle cx="${X(sm[m.i].t).toFixed(1)}" cy="${Y(vals[m.i]).toFixed(1)}" r="5" fill="var(--panel)" stroke="var(--caution)" stroke-width="2.5"/>
      <text x="${Math.min(X(sm[m.i].t) + 12, R - 4).toFixed(1)}" y="${Math.min(Y(vals[m.i]) + 16, B - 6).toFixed(1)}" ${X(sm[m.i].t) > R - 190 ? raw('text-anchor="end" dx="-24"') : ""} fill="var(--caution)" font-size="12" font-weight="650">${m.text}</text>`}
  </svg>`;
}
function healthPanel(d, st) {
  const se = d.series;
  if (!se || se.samples.length < 2) return panel("Last game health", html`<div class="empty" style="padding:24px">${icon("chart", "xl")}<b>No bitrate history yet</b><span>Fieldhouse keeps a health record while a game is live or recording. ${st?.live ? `Right now: ${(st.kbps / 1000).toFixed(1)} Mbps, ${st.droppedFrames} dropped frames.` : "Start a broadcast and it will be charted here afterwards."}</span></div>`);
  const sm = se.samples, streamed = sm.some((x) => x.kbps > 0), dropped = se.droppedFrames;
  const sorted = sm.map((x) => x.kbps).sort((a, b) => a - b), med = sorted[Math.floor(sorted.length / 2)];
  const dip = (s2, v) => { if (!med) return null; let i = 0; v.forEach((x, k) => { if (x < v[i]) i = k; }); const sec = (s2[i].t - s2[0].t) / 1000; return v[i] < (med / 1000) * 0.7 ? { i, text: `Dip to ${v[i].toFixed(1)} Mbps at ${clockTxt(sec)}` } : null; };
  const when = new Date(se.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const chip = dropped ? html`<span class="chip warn">${icon("alert", "sm")}${dropped} dropped frame${dropped === 1 ? "" : "s"}</span>` : html`<span class="chip ok">${icon("check", "sm")}No dropped frames</span>`;
  const bitrate = streamed ? lineChart(se, { pick: (x) => x.kbps, unit: 1000, step: 2, label: `Bitrate in megabits per second over game time. Median ${(med / 1000).toFixed(1)}, lowest ${(Math.min(...sm.map((x) => x.kbps)) / 1000).toFixed(1)}.`, mark: dip }) : html`<div class="muted" style="padding:10px 0">This game was recorded but not streamed, so there is no bitrate to chart.</div>`;
  const drops = dropped ? html`<div class="muted" style="padding:6px 0 0">Dropped frames, running total</div>${lineChart(se, { pick: (x) => x.dropped, unit: 1, step: 10, h: 96, stroke: "var(--caution)", fill: true, label: `Dropped frames over game time, ${dropped} in total` })}` : "";
  return panel("Last game health", html`<div style="padding:10px 14px 10px">${streamed ? html`<div class="muted" style="padding-bottom:4px">Bitrate in Mbps over game time${se.title ? ", " + se.title : ""}, ${when}</div>` : ""}${bitrate}${drops}</div>`, chip);
}
function diagView(d) {
  const b = d.bundle, sys = b.system ?? {}, eng = b.engine ?? {}, st = S.state?.engine?.stream;
  const logs = d.logs.filter((l) => d.level === "all" || (d.level === "warn" ? l.level !== "INFO" : l.level === "ERROR")).slice(-80);
  const rows = [["OS", sys.os], ["Cores", sys.cpus], ["RAM", sys.memoryBytes ? fmtBytes(sys.memoryBytes) : "Unknown"], ["Engine", `${eng.engine ?? "unknown"} (${eng.connected ? "connected" : "not connected"})`], ["Runtime", sys.bun ? `Bun ${sys.bun}` : "Unknown"], ["App version", S.state?.version ?? ""]];
  const x = d.exp;
  return html`
  ${healthPanel(d, st)}
  <div class="g2">
    ${panel("Recent log", html`<div class="stlog">${logs.length ? logs.map((l) => html`<div><span>${hhmmss(l.t)}</span><span class="pill ${LV[l.level]?.[0] ?? "off"}">${LV[l.level]?.[1] ?? l.level}</span><span title="${l.msg}">${l.msg}</span></div>`) : html`<div style="display:block;padding:14px;height:auto" class="muted">${d.logs.length ? "No lines at this level." : "Nothing has been logged since Fieldhouse started."}</div>`}</div>`,
      html`<span class="seg" role="group" aria-label="Log level">${[["all", "All"], ["warn", "Warnings"], ["error", "Errors"]].map(([v, l]) => html`<button type="button" class="${d.level === v ? "on" : ""}" aria-pressed="${d.level === v}" data-act="level" data-v="${v}">${l}</button>`)}</span>`)}
    ${panel("System info", html`<dl class="si">${rows.map(([k, v]) => html`<div><dt>${k}</dt><b>${v}</b></div>`)}</dl>`)}
  </div>
  <div class="r3">
    ${panel("Export", html`<div class="pb col-g"><button class="btn pri" style="align-self:flex-start" data-act="export" ${d.busy ? "disabled" : ""}>${icon("down2")}Export diagnostics bundle</button>
      ${x ? html`<div class="banner ok">${icon("check", "lg")}<span style="min-width:0"><b>Saved (${fmtBytes(x.bytes)}).</b> <span class="muted mono" style="word-break:break-all">${x.path}</span></span></div>
      <div class="cx"><div><b>Contains</b><ul class="muted">${x.contains.map((c) => html`<li><svg class="i" style="color:var(--ready)"><use href="#i-check"/></svg>${c}</li>`)}</ul></div><div><b>Does not contain</b><ul class="muted">${x.excludes.map((c) => html`<li><svg class="i" style="color:var(--text-3)"><use href="#i-x"/></svg>${c}</li>`)}</ul></div></div>`
        : html`<span class="muted">Export saves a file on this computer and shows exactly what it contains and leaves out.</span>`}</div>`)}
    ${panel("Share diagnostics", html`<div class="pb col-g"><span class="muted">Fieldhouse is open source, so you can attach the bundle to a public issue. Review it first, because anything you attach is public.</span>
      <div class="row" style="flex-wrap:wrap;gap:8px"><button class="btn sm" data-act="preview">${icon("eye", "sm")}${d.prev ? "Hide preview" : "Preview contents"}</button>${x && html`<button class="btn sm" data-act="copypath">${icon("link", "sm")}Copy bundle path</button>`}</div></div>`)}
    ${panel("Telemetry", html`<div class="pb col-g"><div class="row">${sw(d.settings.telemetry, "tel", "Send anonymous usage data")}<b>Send anonymous usage data</b></div><span class="muted">Fieldhouse never sends data unless you turn this on. This switch is saved now, but no usage data is collected or sent yet.</span></div>`, pill(d.settings.telemetry ? "info" : "off", d.settings.telemetry ? "On" : "Off"))}
  </div>
  ${d.prev && panel("Bundle preview", html`<div class="hint" style="padding:10px 14px">This is exactly what an export would contain right now. Stream keys and the remote code are removed.</div><pre class="pre" tabindex="0">${JSON.stringify(b, null, 2)}</pre>`)}`;
}
export const diagnostics = {
  async load() { const [r, settings] = await Promise.all([api.get("/diagnostics?n=500"), api.get("/settings")]); return { logs: r.logs, bundle: r.bundle, series: r.series, settings, level: "all", exp: null, prev: false, busy: false }; },
  render: (ctx, data) => html`<div class="cp" data-box>${diagView(data)}</div>`,
  bind(root, ctx, data) {
    const view = () => diagView(data); paint(root, view);
    const a = delegate(root, "click", "act", {
      level: (el) => { data.level = el.dataset.v; paint(root, view); },
      export: async () => { data.busy = true; paint(root, view); try { data.exp = await api.post("/diagnostics/bundle"); toast("Diagnostics bundle saved."); } catch (e) { fail(e); } data.busy = false; paint(root, view); },
      preview: async () => { data.prev = !data.prev; if (data.prev) { try { data.bundle = (await api.get("/diagnostics?n=500")).bundle; } catch (e) { fail(e); } } paint(root, view); },
      copypath: () => copyText(data.exp.path),
      tel: async () => { try { data.settings = await api.put("/settings", { telemetry: !data.settings.telemetry }); paint(root, view); } catch (e) { fail(e); } },
    });
    return a;
  },
};

// ================================================================ about
const HELP = [["alert", "Report a bug", "/issues/new"], ["star", "Suggest a feature", "/discussions"], ["users", "Contribute code or a sport profile", "/blob/main/CONTRIBUTING.md"], ["book", "Improve the docs", "/tree/main/docs"]];
const COMM = [["users", "Code of Conduct", "/blob/main/CODE_OF_CONDUCT.md"], ["shield", "Security policy", "/blob/main/SECURITY.md"]];
const NOTICES = [["OBS Studio", "GPL-2.0-or-later"], ["FFmpeg", "LGPL-2.1+"], ["SRT", "MPL-2.0"], ["Chromium Embedded Framework", "BSD-3"], ["DSEG font", "OFL-1.1"]];
const helpList = (items) => html`<div class="sthelp">${items.map(([ic, l, p]) => html`<a href="${REPO + p}" target="_blank" rel="noopener noreferrer">${icon(ic)}${l}${icon("link")}</a>`)}</div>`;
export const about = {
  render: () => html`<div class="g2" style="grid-template-columns:1fr 1fr">
    <div class="col-g" style="gap:16px">
      ${panel("Fieldhouse", html`<div class="pb col-g" style="gap:14px">
        <div class="row" style="gap:14px"><span class="brand"><span class="mark" style="width:48px;height:48px;border-radius:12px">${icon("ball", "xl")}</span></span><div><h2 class="t">Fieldhouse</h2><div class="muted">Version ${S.state?.version ?? "unknown"}</div></div></div>
        <div class="row"><button class="btn" data-act="upd">${icon("refresh")}Check for updates</button></div>
        <div class="hint" role="status" aria-live="polite" data-upd>Fieldhouse only looks for updates when you press this button. It sends nothing about you or your games.</div></div>`)}
      <div class="panel" style="background:var(--action-wash);border-color:var(--action)"><div class="pb col-g" style="gap:12px">
        <h2 class="t">Free and open source</h2>
        <span>Fieldhouse is free for every school and league, forever. There are no accounts, no license keys and no trial.</span>
        <div class="ok2"><span>${icon("check")}No accounts</span><span>${icon("check")}No license keys</span><span>${icon("check")}No trial</span></div>
        <div class="row"><span class="muted">License</span><span class="chip mono" style="color:var(--text)">GPL-3.0-or-later</span><span class="hint">Working choice, not final.</span></div>
        <div class="row" style="flex-wrap:wrap;gap:8px">${lnk(REPO, "View source on GitHub", "btn pri")}${lnk(`${REPO}/blob/main/LICENSE`, "View license text", "btn", "book")}</div>
        <div class="hint"><span class="mono">github.com/RoboWhisperer/fieldhouse</span></div></div></div>
      ${panel("Ways to help", helpList(HELP))}
    </div>
    <div class="col-g" style="gap:16px">
      ${panel("Built on open source", html`<table class="tbl"><thead><tr><th>Component</th><th>License</th></tr></thead><tbody>${NOTICES.map(([n, l]) => html`<tr><td>${n}</td><td class="m">${l}</td></tr>`)}</tbody></table><div class="row" style="padding:12px 14px">${lnk(`${REPO}/blob/main/NOTICE`, "View all notices", "btn", "book")}</div>`)}
      ${panel("Community", html`${helpList(COMM)}`)}
    </div></div>`,
  bind(root) {
    const out = () => root.querySelector("[data-upd]");
    return delegate(root, "click", "act", { upd: async (btn) => {
      btn.disabled = true; out().textContent = "Checking…";
      try {
        const r = await api.get("/update?force=1");
        if (r.status === "available") out().innerHTML = html`<b>Version ${r.latest} is available.</b> You have ${r.current}. <a href="${r.url}" target="_blank" rel="noopener noreferrer">Read the release notes and download</a>.`.s;
        else if (r.status === "current") out().textContent = `You are up to date (version ${r.current}).`;
        else out().textContent = r.reason === "no-release" ? "No published release was found yet, so there is nothing to compare with." : "Could not check for updates. Check the internet connection and try again. Fieldhouse works fully offline.";
      } catch { out().textContent = "Could not check for updates. Try again in a moment."; }
      btn.disabled = false;
    } });
  },
};

