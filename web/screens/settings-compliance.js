// Settings > Audit and data: service health, the operator audit trail and a portable export.
import { html, icon, api, fail, toast, fmtDate, fmtTime, fmtBytes } from "../app.js";
import { delegate, panel } from "./settings-ui.js";

const LABEL = {
  "game.created": "Game created", "game.updated": "Game updated", "game.deleted": "Game deleted", "game.activated": "Game activated", "game.finished": "Game finished",
  "broadcast.started": "Broadcast started", "broadcast.stopped": "Broadcast stopped", "recording.deleted": "Recording deleted",
  "destination.deleted": "Destination removed", "sponsor.deleted": "Sponsor removed", "settings.updated": "Settings changed",
  "data.exported": "Data exported", "data.reset": "All data cleared",
  "device.paired": "Device paired", "device.key-created": "API key created", "device.revoked": "Device revoked", "device.role-changed": "Device role changed",
  "device.pair-allowed": "Pairing allowed", "device.pair-denied": "Pairing denied", "remote.code-rotated": "Remote code rotated", "remote.locked": "Remote locked", "remote.unlocked": "Remote unlocked",
};
const tone = (k) => (k.endsWith(".deleted") || k === "data.reset" ? "warn" : k.includes("started") ? "ok" : "info");
const when = (t) => `${fmtDate(t, { year: "numeric", month: "short", day: "numeric" })} ${fmtTime(t)}`;
const uptime = (s) => { const d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60; return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };

function view(d) {
  const h = d.health;
  return html`
    ${panel("Service health", html`<div class="sys">
      <div><span class="muted">Status</span><div class="row" style="gap:8px">${icon(h.status === "ok" ? "check" : "alert")}<b>${h.status === "ok" ? "Ready" : "Needs attention"}</b></div></div>
      <div><span class="muted">Version</span><div><b>${h.version}</b></div></div>
      <div><span class="muted">Uptime</span><div><b>${uptime(h.uptimeSec)}</b></div></div>
      <div><span class="muted">Database</span><div><b>${h.database.ok ? `Schema ${h.database.schema}` : "Unavailable"}</b></div></div>
      <div><span class="muted">Video engine</span><div><b>${h.engine.connected ? "Connected" : "Not connected"}</b> <span class="muted">${h.engine.kind}</span></div></div>
      <div><span class="muted">Broadcast</span><div><b>${h.engine.streaming ? "Live" : h.engine.recording ? "Recording" : "Idle"}</b></div></div>
      <div><span class="muted">Disk free</span><div><b>${fmtBytes(h.engine.diskFreeBytes)}</b></div></div>
      <div><span class="muted">Active game</span><div><b>${h.activeGame ? h.activeGame.title : "None"}</b></div></div>
    </div>`, html`<button class="btn sm ghost" data-act="refresh">${icon("refresh", "sm")}Refresh</button>`)}
    ${panel("Audit log", d.rows.length ? html`<div class="tblwrap"><table class="tbl"><thead><tr><th>When</th><th>Action</th><th>Object</th><th>Actor</th></tr></thead><tbody>${d.rows.map((r) => html`<tr><td class="m">${when(r.at)}</td><td><span class="pill ${tone(r.action)}">${LABEL[r.action] ?? r.action}</span></td><td class="m">${r.target ?? ""}</td><td>${r.actor}</td></tr>`)}</tbody></table></div>` : html`<div class="empty">${icon("shield", "lg")}<b>No changes recorded yet</b><span>Creating, changing and deleting games, recordings, settings and broadcasts appear here.</span></div>`) +
      html`<div class="row" style="padding:10px 14px;border-top:1px solid var(--line)">${icon("lock", "sm")}<span class="muted">Append-only, kept on this computer, capped at the 10,000 most recent entries. A full data reset keeps the audit history.</span></div>`}
    ${panel("Data export", html`<div class="pb col-g" style="gap:10px">
      <span class="muted">Download a JSON file with games, events, venues, sponsors, recordings metadata, profiles, automation and the audit log. Stream keys, passwords, remote codes, device tokens and web-request headers are removed.</span>
      <div class="row" style="flex-wrap:wrap"><a class="btn pri" href="/api/export" download>${icon("down2")}Download data export</a><span class="hint">The export is written by this computer and is not uploaded anywhere.</span></div>
    </div>`)}
    ${d.error ? html`<div class="banner err">${icon("alert")}<span>${d.error}</span></div>` : ""}`;
}

export const compliance = {
  async load() {
    const [health, audit] = await Promise.all([api.get("/health"), api.get("/audit?limit=100")]);
    return { health, rows: audit.rows, error: "" };
  },
  render: (ctx, data) => html`<div class="cp" data-box>${view(data)}</div>`,
  bind(root, ctx, data) {
    const paint = () => { const box = root.querySelector("[data-box]"); if (box) box.innerHTML = view(data).s; };
    return delegate(root, "click", "act", {
      refresh: async () => {
        try {
          data.health = await api.get("/health");
          data.rows = (await api.get("/audit?limit=100")).rows;
          data.error = "";
          toast("Health and audit log refreshed.");
        } catch (e) { data.error = e.message; fail(e); }
        paint();
      },
    });
  },
};
