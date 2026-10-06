// Settings > Video engine: Fieldhouse starts, watches and restarts the video engine (OBS Studio) by itself.
// This page only shows its state and offers: try again, install it, repair its setup, or (advanced) use an OBS you run yourself.
import { html, icon, api, toast, fail } from "../app.js";
import { delegate, panel } from "./settings-ui.js";

const KIND = { flatpak: "Flatpak", native: "installed", windows: "Windows", macos: "macOS" };
const GOOD = ["running", "adopted"];

function status(i) {
  if (i.engine === "fake") return { cls: "warn", ic: "alert", text: "Demo engine (no real video)", why: "This copy is running with the built-in demo engine." };
  if (i.connected) return { cls: "ok", ic: "check", text: i.managed?.state === "adopted" ? "Connected (your OBS)" : "Running", why: i.managed?.state === "adopted" ? "Fieldhouse is using the OBS Studio that was already open. It will not close it." : "The video engine is running quietly in the background." };
  const st = i.managed?.state;
  if (st === "starting" || st === "restarting") return { cls: "warn", ic: "refresh", text: st === "restarting" ? "Restarting" : "Starting", why: i.managed.message };
  return { cls: "warn", ic: "alert", text: "Not running", why: i.managed?.message || i.error || "The video engine is not running yet." };
}

function installPanel(i) {
  const n = i.install;
  if (i.installed && !(n && n.status === "running")) return "";
  if (n?.status === "running") return panel("Installing the video engine", html`<div class="pb col-g" style="gap:10px">
    <div class="row" style="gap:10px"><b>${n.label}${n.steps > 1 ? ` (${n.step} of ${n.steps})` : ""}</b>${n.dryRun ? html`<span class="chip warn">Practice run: nothing is installed</span>` : ""}</div>
    <div class="bar" role="progressbar" aria-valuenow="${n.percent ?? 0}" aria-valuemin="0" aria-valuemax="100"><b style="width:${n.percent ?? 8}%"></b></div>
    <span class="muted">${n.message} This can take a few minutes.</span>
    <div><button class="btn" data-act="cancelinstall">Cancel</button></div></div>`);
  return panel("The video engine is not installed", html`<div class="pb col-g" style="gap:10px">
    <div>Fieldhouse needs a free video program (OBS Studio) to mix cameras, add graphics and record. Fieldhouse can install it for you.</div>
    ${n && (n.status === "failed" || n.status === "cancelled") ? html`<div class="banner warn">${icon("alert")}<span>${n.message}</span></div>` : ""}
    <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn pri lg" data-act="install">${icon("down2", "sm")}Install video engine</button>
      <a class="btn" href="${n?.downloadUrl || "https://obsproject.com/download"}" target="_blank" rel="noopener noreferrer" style="text-decoration:none">${icon("link", "sm")}Open the download page</a></div>
    <span class="hint">It is free and open source. If your computer has an installer tool, Fieldhouse uses it; if not, the download page has an installer. Fieldhouse continues by itself when it is installed.</span></div>`);
}

function view(d) {
  const i = d.info, s = status(i);
  return html`
    ${panel("Video engine", html`<div class="pb col-g" style="gap:12px">
      <div class="row" style="gap:10px;align-items:center;flex-wrap:wrap"><span class="chip ${s.cls}">${icon(s.ic, "sm")}${s.text}</span><span class="muted">${s.why}</span></div>
      ${i.error && !i.connected && i.engine === "obs" && i.managed?.state !== "restarting" && i.managed?.state !== "starting" && i.error !== s.why ? html`<div class="banner warn">${icon("alert")}<span>${i.error}</span></div>` : ""}
      <div class="row" style="gap:8px;flex-wrap:wrap">
        ${i.engine === "obs" && !i.connected && i.installed ? html`<button class="btn pri" data-act="launch" ${d.busy ? "disabled" : ""}>${d.busy === "launch" ? "Starting..." : "Try again"}</button>` : ""}
        ${i.engine === "fake" && i.installed ? html`<button class="btn pri" data-act="launch" ${d.busy ? "disabled" : ""}>${d.busy === "launch" ? "Starting..." : "Start the video engine"}</button>` : ""}
        <button class="btn" data-act="repair" ${i.connected && !d.busy ? "" : "disabled"}>${d.busy === "repair" ? "Repairing..." : "Repair setup"}</button>
        ${i.demoAllowed && i.engine === "obs" ? html`<button class="btn ghost" data-act="fake">Use demo engine</button>` : ""}
      </div>
      <span class="hint">Fieldhouse runs OBS Studio quietly in the background; you never need to open it. If Fieldhouse started it, Fieldhouse also closes it when you quit.${i.installed ? ` Found: OBS Studio ${i.version || ""} (${KIND[i.kind] || i.kind}).` : ""}</span></div>`)}
    ${installPanel(i)}
    ${i.created.length ? panel("What Fieldhouse set up", html`<div class="pb col-g" style="gap:10px">
      <div>${i.created.map((s) => html`<span class="chip" style="margin:0 6px 6px 0">${s}</span>`)}</div>
      <span class="muted">Instant replay: ${i.replayBuffer ? `ready (last ${i.replaySeconds} seconds)` : "off"}. Fieldhouse uses its own profile ("${i.profile || "Fieldhouse"}") and scenes starting with FH, so nothing of yours is changed.</span>
      ${(i.notes || []).length ? html`<span class="hint">${i.notes.join(" ")}</span>` : ""}</div>`) : ""}
    ${panel("Use an OBS you run yourself (advanced)", html`<div class="pb col-g" style="gap:10px">
      <span class="muted">Most people never need this. If you already run OBS Studio with its WebSocket server turned on, enter its address and password and Fieldhouse will use it without closing or hiding it.</span>
      <div class="field"><label for="obs-url">Address</label><div class="input"><input id="obs-url" value="${d.url}" placeholder="ws://127.0.0.1:4455" style="background:none;border:0;color:inherit;font:inherit;outline:0;width:100%"></div></div>
      <div class="field"><label for="obs-pw">Password</label><div class="input"><input id="obs-pw" type="password" autocomplete="off" placeholder="${i.passwordSet ? "Saved (type to replace)" : "OBS WebSocket password"}" style="background:none;border:0;color:inherit;font:inherit;outline:0;width:100%"></div><span class="hint">Write-only: Fieldhouse never shows it again.</span></div>
      <div><button class="btn" data-act="connect" ${d.busy ? "disabled" : ""}>Connect</button></div></div>`)}`;
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
      repair: () => run("repair", async () => { const r = await api.post("/engine/obs/provision"); toast("Video engine setup repaired."); return r; }),
      fake: () => run("fake", () => api.post("/engine/use-fake")),
      install: () => run("install", async () => { await api.post("/engine/obs/install"); return api.get("/engine/obs"); }),
      cancelinstall: () => run("cancel", async () => { await api.post("/engine/obs/install/cancel"); return api.get("/engine/obs"); }),
    });
    const t = setInterval(async () => { if (d.busy || root.querySelector("input:focus")) return; try { d.info = await api.get("/engine/obs"); repaint(); } catch {} }, 1500);
    return () => { off(); clearInterval(t); };
  },
};
