// Settings > Video and audio: everything a volunteer might tune, without ever opening OBS.
// Fieldhouse keeps these choices and applies them to the video engine, then shows what the engine really reports.
import { html, raw, esc, icon, api, toast, fail } from "../app.js";
import { delegate, all, panel, sw } from "./settings-ui.js";

const RES = [["720p", "720p"], ["1080p", "1080p"]], FPS = [[30, "30 fps"], [60, "60 fps"]], FMT = [["mp4", "MP4"], ["mkv", "MKV"]], REPLAY = [[30, "30 s"], [60, "60 s"], [120, "2 min"]];
const KBPS = [2500, 4500, 6000, 8000], AUDIO = [64, 96, 128, 160, 192, 256, 320];
const FMT_NAME = { hybrid_mp4: "MP4", mkv: "MKV" };
const segs = (lv) => raw(Array.from({ length: 20 }, (_, k) => `<i class="${k < lv ? (k > 17 ? "r" : k > 13 ? "y" : "g") : ""}"></i>`).join(""));
const lvOf = (a) => Math.round(Math.min(1, a || 0) * 20);

const seg = (name, items, cur, locked) => html`<div class="seg" role="group" aria-label="${name}">${items.map(([v, l]) => html`<button type="button" class="${v === cur ? "on" : ""}" aria-pressed="${v === cur}" data-set="${name}" data-v="${v}" ${locked ? "disabled" : ""}>${l}</button>`)}</div>`;
const field = (label, body, hint = "") => html`<div class="fr"><div class="row" style="gap:12px;flex-wrap:wrap"><span class="fl muted" style="min-width:150px;font-weight:600">${label}</span>${body}</div>${hint ? html`<span class="hint">${hint}</span>` : ""}</div>`;
const describe = (a) => `${a.resolution} at ${a.fps} frames per second, ${a.videoKbps} kbps video, ${a.audioKbps} kbps audio`;

function quality(d) {
  const i = d.info, s = i.settings, a = i.applied, locked = i.live, custom = !KBPS.includes(s.videoKbps) || d.customOpen;
  const enc = i.encoders.find((e) => e.id === s.encoder);
  return html`
    ${d.applying ? html`<div class="banner info" role="status">${icon("refresh")}<span><b>Applying video settings...</b> The video engine restarts for a few seconds. Cameras and the score overlay come back by themselves.</span></div>` : ""}
    ${locked ? html`<div class="banner warn">${icon("alert")}<span><b>A broadcast is running.</b> Resolution, frame rate and the encoder cannot change until it ends. Bitrate, format and replay length are saved now and used for the next broadcast.</span></div>` : ""}
    ${panel("Quality", html`
      ${field("Resolution", seg("resolution", RES, s.resolution, locked), "The picture is always made at 1080p inside; this is the size that is streamed and recorded. 720p is easiest on the computer and the internet.")}
      ${field("Frame rate", seg("fps", FPS, s.fps, locked), "60 fps looks smoother for fast play but needs a stronger computer and about 1.5 times the upload speed.")}
      ${field("Video bitrate", html`<div class="seg" role="group" aria-label="Video bitrate">${KBPS.map((k) => html`<button type="button" class="${!custom && s.videoKbps === k ? "on" : ""}" aria-pressed="${!custom && s.videoKbps === k}" data-set="videoKbps" data-v="${k}">${k}</button>`)}<button type="button" class="${custom ? "on" : ""}" aria-pressed="${custom}" data-act="custom">Custom</button></div><span class="muted">kbps</span>`, "Higher is sharper but needs more upload speed. Rule of thumb: your upload speed should be at least double this number.")}
      ${custom ? html`<div class="fr"><div class="row" style="gap:8px"><label class="input" style="width:160px"><input id="kbps" type="number" inputmode="numeric" min="1000" max="20000" step="100" value="${s.videoKbps}" aria-label="Custom video bitrate in kbps" style="all:unset;flex:1;min-width:0;color:var(--text)"></label><span class="muted">kbps, from 1000 to 20000</span><button class="btn" data-act="applykbps">Apply</button></div></div>` : ""}
      ${field("Audio bitrate", html`<select class="select" data-in="audioKbps" aria-label="Audio bitrate">${AUDIO.map((k) => html`<option value="${k}" ${k === s.audioKbps ? "selected" : ""}>${k} kbps${k === 160 ? " (recommended)" : ""}</option>`)}</select>`)}
      ${field("Encoder", html`<select class="select" data-in="encoder" aria-label="Encoder" ${locked ? "disabled" : ""}>${i.encoders.map((e) => html`<option value="${e.id}" ${e.id === s.encoder ? "selected" : ""}>${e.label}</option>`)}</select>`,
        i.encoders.length > 2 ? "Automatic uses the software encoder unless a game needs 1080p at 60 fps. Hardware encoders are listed only because this computer has them." : "Automatic is right for almost everyone. Hardware encoders are shown here only when this computer has one the video engine can use.")}
      <div class="fr"><div class="row" style="gap:10px;flex-wrap:wrap">${a
        ? (i.differences.length ? html`<span class="chip warn">${icon("alert", "sm")}${i.pending.length ? "Applies after the broadcast" : "Not applied yet"}</span><span class="muted">The video engine currently uses ${describe(a)}${i.pending.length ? `. Waiting: ${i.pending.join(", ")}.` : `. Waiting: ${i.differences.join(", ")}.`}</span>`
          : html`<span class="chip ok">${icon("check", "sm")}Applied</span><span class="muted">The video engine reports ${describe(a)}${enc && s.encoder === "auto" ? `, encoder: ${i.encoderInUse === "x264" ? "software (x264)" : i.encoderInUse}` : ""}.</span>`)
        : html`<span class="chip warn">${icon("alert", "sm")}Saved</span><span class="muted">The video engine is not running right now. These choices are used as soon as it starts.</span>`}</div></div>`)}
    ${panel("Recording and instant replay", html`
      ${field("Recording format", seg("recordFormat", FMT, s.recordFormat), "MP4 plays everywhere. MKV is the same video in a container that is slightly safer if the computer loses power. Both survive a crash.")}
      ${field("Instant replay keeps", seg("replaySeconds", REPLAY, s.replaySeconds), "How far back a replay can go. Longer replays use more memory.")}
      <div class="fr"><div class="row">${icon("folder")}<span class="muted">Recordings are saved in the folder you chose in <a href="#/settings/storage">Storage</a>.</span></div></div>`)}`;
}

const devOptions = (d, a) => d.audio.devices.filter((x) => (a.role === "desktop") === (x.detail === "Desktop audio"));
function audioList(d) {
  const au = d.audio, add = d.add;
  return html`${panel("Audio inputs", html`
    ${au.inputs.length ? au.inputs.map((a) => html`<div class="swr" style="align-items:center;flex-wrap:wrap;gap:12px" data-ain="${a.id}">
      <span style="color:var(--text-2)">${icon(a.role === "desktop" ? "wifi" : "mic", "lg")}</span>
      <div style="min-width:180px;flex:1">${a.managed ? html`<input class="input" data-name="${a.id}" value="${a.label}" maxlength="40" aria-label="Name of ${a.label}" style="width:100%;height:30px">` : html`<b>${a.label}</b>`}
        <div class="hint">${a.role === "camera" ? "Sound from the camera" : a.role === "other" ? "Added outside Fieldhouse" : a.role === "desktop" ? "Desktop / room sound" : "Microphone"}</div></div>
      ${a.managed ? html`<select class="select" data-dev="${a.id}" aria-label="Device for ${a.label}" style="max-width:220px">${devOptions(d, a).map((x) => html`<option value="${x.id}" ${x.id === a.deviceId ? "selected" : ""}>${x.label}</option>`)}${devOptions(d, a).some((x) => x.id === a.deviceId) ? "" : html`<option value="${a.deviceId}" selected>${a.deviceLabel || "Current device"}</option>`}</select>` : ""}
      <div class="meter" data-lvl="${a.id}" style="width:90px">${segs(lvOf(a.level))}</div>
      <label class="row" style="gap:6px"><span class="muted" style="font-size:12px">Gain</span><input type="range" min="-40" max="12" step="1" value="${Math.round(a.gainDb)}" data-gain="${a.id}" aria-label="Gain for ${a.label}" style="width:110px"><b class="tnum" style="min-width:48px;font-size:12.5px" data-gv="${a.id}">${Math.round(a.gainDb)} dB</b></label>
      <span class="row" style="gap:6px"><span class="muted" style="font-size:12px">Mute</span>${raw(sw(a.muted, "mute", `Mute ${a.label}`).s.replace("<button", `<button data-id="${esc(a.id)}"`))}</span>
      ${a.removable ? html`<button class="btn sm ghost" data-act="remove" data-id="${a.id}" aria-label="Remove ${a.label}">${icon("x", "sm")}</button>` : ""}
    </div>`) : html`<div class="empty">${icon("mic", "xl")}<b>No audio inputs yet</b><span>Add a microphone below.</span></div>`}
    <div class="pb" style="border-top:1px solid var(--line);display:grid;gap:10px">
      ${add ? html`<div class="row" style="gap:8px;flex-wrap:wrap"><b>${add.role === "mic" ? "Add a microphone" : "Add desktop / room sound"}</b></div>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <label class="input" style="width:220px"><input id="add-label" maxlength="40" placeholder="${add.role === "mic" ? "Commentary mic" : "Crowd"}" aria-label="Name" value="${add.label}" style="all:unset;flex:1;min-width:0;color:var(--text)"></label>
          <select class="select" id="add-dev" aria-label="Device" style="max-width:280px"><option value="">Default device</option>${devOptions(d, { role: add.role }).map((x) => html`<option value="${x.id}" ${x.id === add.deviceId ? "selected" : ""}>${x.label}</option>`)}</select>
          <button class="btn pri" data-act="doadd" ${d.busy ? "disabled" : ""}>Add</button><button class="btn ghost" data-act="canceladd">Cancel</button></div>`
        : html`<div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn" data-act="add" data-role="mic">${icon("plus", "sm")}Add a microphone</button><button class="btn" data-act="add" data-role="desktop" ${au.canDesktop ? "" : "disabled"}>${icon("plus", "sm")}Add desktop / room sound</button></div>
          ${au.canDesktop ? "" : html`<span class="hint">Desktop sound capture is not available on this computer.</span>`}`}
      <span class="hint">Names are only for you. Fieldhouse never changes audio inputs it did not create.</span></div>`)}`;
}

const view = (d) => html`${quality(d)}${d.audio ? audioList(d) : html`<div class="skel"></div>`}`;

export const video = {
  async load() {
    const [info, audio] = await Promise.all([api.get("/engine/video"), api.get("/engine/audio").catch(() => null)]);
    return { info, audio, add: null, customOpen: false, busy: false };
  },
  render: (ctx, d) => html`<div class="cp" data-box>${view(d)}</div>`,
  bind(root, ctx, d) {
    const keep = () => { const o = {}; root.querySelectorAll("[data-box] input[id]").forEach((i) => { if (i.value) o[i.id] = i.value; }); return o; };
    const repaint = () => { const b = root.querySelector("[data-box]"); if (!b) return; const typed = keep(); b.innerHTML = view(d).s; for (const [id, v] of Object.entries(typed)) { const el = b.querySelector("#" + id); if (el) el.value = v; } };
    const refreshAudio = async () => { try { d.audio = await api.get("/engine/audio"); } catch { /* engine not running */ } };
    const save = async (patch, msg = "Saved.") => { d.applying = ["resolution", "fps", "encoder"].some((k) => k in patch); if (d.applying) repaint(); try { d.info = await api.put("/engine/video", patch); toast(msg); } catch (e) { fail(e); try { d.info = await api.get("/engine/video"); } catch {} } d.applying = false; d.customOpen = false; repaint(); };
    const audio = async (f, msg) => { d.busy = true; repaint(); try { await f(); if (msg) toast(msg); await refreshAudio(); } catch (e) { fail(e); } d.busy = false; repaint(); };

    const clicks = delegate(root, "click", "set", { // data-set="resolution" data-v="1080p"
      ...Object.fromEntries(["resolution", "fps", "videoKbps", "recordFormat", "replaySeconds"].map((k) => [k, (el) => { const v = el.dataset.v; save({ [k]: ["fps", "videoKbps", "replaySeconds"].includes(k) ? Number(v) : v }); }])),
    });
    const acts = delegate(root, "click", "act", {
      custom: () => { d.customOpen = true; repaint(); root.querySelector("#kbps")?.focus(); },
      applykbps: () => { const v = Number(root.querySelector("#kbps")?.value); if (!Number.isInteger(v) || v < 1000 || v > 20000) return fail(new Error("Video bitrate must be a whole number between 1000 and 20000 kbps.")); save({ videoKbps: v }); },
      add: (el) => { d.add = { role: el.dataset.role, deviceId: "", label: "" }; repaint(); root.querySelector("#add-label")?.focus(); },
      canceladd: () => { d.add = null; repaint(); },
      doadd: () => { const label = root.querySelector("#add-label")?.value ?? "", deviceId = root.querySelector("#add-dev")?.value ?? ""; const role = d.add.role; audio(async () => { await api.post("/engine/audio", { role, label, deviceId }); d.add = null; }, "Added."); },
      remove: (el) => { if (confirm("Remove this audio input?")) audio(() => api.del(`/engine/audio/${encodeURIComponent(el.dataset.id)}`), "Removed."); },
      mute: (el) => { const id = el.dataset.id, a = d.audio.inputs.find((x) => x.id === id); audio(() => api.put(`/engine/audio/${encodeURIComponent(id)}`, { muted: !a.muted })); },
    });
    const changes = delegate(root, "change", "in", { audioKbps: (el) => save({ audioKbps: Number(el.value) }), encoder: (el) => save({ encoder: el.value }) });
    const put = (id, patch, msg) => audio(() => api.put(`/engine/audio/${encodeURIComponent(id)}`, patch), msg);
    const c2 = (e) => { // controls that carry their own attribute (name / device / gain)
      const el = e.target;
      if (el.dataset.name) put(el.dataset.name, { label: el.value }, "Renamed.");
      else if (el.dataset.dev) put(el.dataset.dev, { deviceId: el.value }, "Device changed.");
      else if (el.dataset.gain) api.put(`/engine/audio/${encodeURIComponent(el.dataset.gain)}`, { gainDb: Number(el.value) }).catch(fail);
    };
    const i2 = (e) => { const el = e.target; if (el.dataset.gain) root.querySelector(`[data-gv="${CSS.escape(el.dataset.gain)}"]`).textContent = `${el.value} dB`; };
    root.addEventListener("change", c2); root.addEventListener("input", i2);
    const poll = setInterval(async () => { if (root.querySelector("input:focus,select:focus")) return; try { d.info = await api.get("/engine/video"); repaint(); } catch {} }, 4000);
    return all(clicks, acts, changes, () => { root.removeEventListener("change", c2); root.removeEventListener("input", i2); clearInterval(poll); });
  },
  onState(root, st, ctx, d) { // live meters only: never redraw while the user is dragging a slider
    for (const c of st.engine.mixer) { const m = root.querySelector(`[data-lvl="${CSS.escape(c.id)}"]`); if (m) m.innerHTML = segs(lvOf(c.muted ? 0 : c.level)).s; }
    const live = !!(st.engine.stream.live || st.engine.record.active);
    if (d.info && d.info.live !== live) { d.info.live = live; if (!root.querySelector("input:focus,select:focus")) ctx.redraw(); }
  },
};
