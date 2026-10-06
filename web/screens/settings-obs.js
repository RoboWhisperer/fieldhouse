// Settings > Engine (OBS): find OBS, launch or connect it, see what Fieldhouse set up inside it, repair that setup.
import { html, icon, api, toast, fail } from "../app.js";
import { delegate, panel } from "./settings-ui.js";

const KIND = { flatpak: "Flatpak", native: "Installed", windows: "Windows", macos: "macOS" };

function view(d) {
  const i = d.info, ok = i.connected;
  const status = ok ? html`<span class="chip ok">${icon("check", "sm")}Connected</span>` : i.engine === "fake" ? html`<span class="chip warn">Demo engine (no real video)</span>` : html`<span class="chip warn">${icon("alert", "sm")}Not connected</span>`;
  return html`
    ${panel("OBS Studio", html`<div class="pb col-g" style="gap:12px">
      <div class="kv" style="display:flex;gap:10px;align-items:center">${status}<span class="muted">${i.installed ? `OBS ${i.version || ""} (${KIND[i.kind] || i.kind})${i.running ? ", running" : ", not running"}` : "OBS Studio was not found on this computer."}</span></div>
      ${i.error && !ok && i.engine === "obs" ? html`<div class="banner warn">${icon("alert")}<span>${i.error}</span></div>` : ""}
      ${!i.installed ? html`<div class="banner warn">${icon("alert")}<span>Install OBS Studio from obsproject.com (free), then press Scan again.</span></div>` : ""}
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <button class="btn pri" data-act="launch" ${i.installed && !d.busy ? "" : "disabled"}>${d.busy === "launch" ? "Starting OBS..." : i.running ? "Connect to OBS" : "Launch OBS"}</button>
        <button class="btn" data-act="scan" ${d.busy ? "disabled" : ""}>${icon("refresh", "sm")}Scan again</button>
        ${i.demoAllowed && i.engine === "obs" ? html`<button class="btn ghost" data-act="fake">Use demo engine</button>` : ""}
      </div>
      <span class="hint">Launch OBS sets up the connection for you and opens OBS. You never need to touch OBS settings.</span></div>`)}
    ${panel("Connect to an OBS that is already open", html`<div class="pb col-g" style="gap:10px">
      <div class="field"><label for="obs-url">Address</label><div class="input"><input id="obs-url" value="${d.url}" placeholder="ws://127.0.0.1:4455" style="background:none;border:0;color:inherit;font:inherit;outline:0;width:100%"></div></div>
      <div class="field"><label for="obs-pw">Password</label><div class="input"><input id="obs-pw" type="password" autocomplete="off" placeholder="${i.passwordSet ? "Saved (type to replace)" : "OBS websocket password"}" style="background:none;border:0;color:inherit;font:inherit;outline:0;width:100%"></div><span class="hint">Write-only: Fieldhouse never shows it again.</span></div>
      <div><button class="btn" data-act="connect" ${d.busy ? "disabled" : ""}>Connect</button></div></div>`)}
    ${panel("What Fieldhouse created in OBS", html`<div class="pb col-g" style="gap:10px">
      ${i.created.length ? html`<div>${i.created.map((s) => html`<span class="chip" style="margin:0 6px 6px 0">${s}</span>`)}</div>
        <span class="muted">Profile "${i.profile || "Fieldhouse"}". Instant replay: ${i.replayBuffer ? "ready (last 60 seconds)" : "off"}. Your own scenes are never changed.</span>`
        : html`<span class="muted">Nothing yet. Connect to OBS first.</span>`}
      ${(i.notes || []).length ? html`<span class="hint">${i.notes.join(" ")}</span>` : ""}
      <div><button class="btn" data-act="repair" ${ok && !d.busy ? "" : "disabled"}>${d.busy === "repair" ? "Repairing..." : "Repair OBS setup"}</button></div></div>`)}`;
}

export const engine = {
  async load() { const info = await api.get("/engine/obs"); return { info, url: info.url, busy: "" }; },
  render: (ctx, d) => html`<div class="cp" data-box>${view(d)}</div>`,
  bind(root, ctx, d) {
    const repaint = () => { // keep what the user has typed (the periodic refresh must never wipe the password field)
      const b = root.querySelector("[data-box]"); if (!b) return;
      const typed = {}; b.querySelectorAll("input").forEach((i) => { if (i.id && i.value) typed[i.id] = i.value; });
      b.innerHTML = view(d).s;
      b.querySelectorAll("input").forEach((i) => { if (typed[i.id] !== undefined) i.value = typed[i.id]; });
    };
    const run = async (name, f) => { d.busy = name; repaint(); try { d.info = await f(); d.url = d.info.url; } catch (e) { fail(e); } d.busy = ""; repaint(); };
    const off = delegate(root, "click", "act", {
      launch: () => run("launch", () => api.post("/engine/obs/connect", { mode: "launch" })),
      connect: () => { const url = root.querySelector("#obs-url").value, password = root.querySelector("#obs-pw").value; /* read before run() repaints and clears the password field */ return run("connect", () => api.post("/engine/obs/connect", { mode: "connect", url, password }).then((r) => { const f = root.querySelector("#obs-pw"); if (f) f.value = ""; return r; })); },
      repair: () => run("repair", async () => { const r = await api.post("/engine/obs/provision"); toast("OBS setup repaired."); return r; }),
      scan: () => run("scan", () => api.get("/engine/obs")),
      fake: () => run("fake", () => api.post("/engine/use-fake")),
    });
    const t = setInterval(async () => { if (d.busy || root.querySelector("input:focus")) return; try { d.info = await api.get("/engine/obs"); repaint(); } catch {} }, 3000);
    return () => { off(); clearInterval(t); };
  },
};
