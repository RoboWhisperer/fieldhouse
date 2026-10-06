import { html, raw, icon, api, S, fail, go, toast, fmtDate, fmtTime } from "../app.js";

const slotDev = {}; // slot -> deviceId chosen in this app (SourceInfo does not carry the device id)
const segs = (lv) => raw(Array.from({ length: 20 }, (_, k) => `<i class="${k < lv ? (k > 17 ? "r" : k > 13 ? "y" : "g") : ""}"></i>`).join(""));
const lvOf = (a) => Math.round(Math.min(1, a || 0) * 20);
const DOT = { ok: "ok", reconnecting: "warn", missing: "err" };
const KIND = { usb: "Camera", ndi: "Network", srt: "Network", screen: "Screen", test: "Video file", audio: "Audio" };

export default {
  shell: "night", step: 1,
  css: `.sv{display:grid;grid-template-columns:336px minmax(0,1fr) 340px;gap:16px;align-items:start;height:calc(100vh - 88px);overflow:auto}
.sv .dg{height:30px;display:flex;align-items:center;padding:0 14px;background:var(--inset);border-bottom:1px solid var(--line)}
.sv .dev{display:flex;align-items:center;gap:12px;padding:0 14px;height:72px;border:0;border-bottom:1px solid var(--line);min-width:0;width:100%;background:none;color:inherit;font:inherit;text-align:left}
.sv button.dev{cursor:pointer}.sv button.dev:hover{background:var(--raised)}
.sv .dev .ic{width:36px;height:36px;border-radius:8px;background:var(--raised);display:grid;place-items:center;flex:none;color:var(--text-2)}
.sv .dev .tx{min-width:0;flex:1}.sv .dev .tx b{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sv .dev .tx span{display:block;font-size:12px;color:var(--text-3)}
.sv .dev.picked{background:var(--action-wash);box-shadow:inset 3px 0 0 var(--action)}
.sv .slots{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}
.sv .slot .meta{padding:8px 10px 2px}.sv .slot .sub{padding:0 10px 9px;font-size:12px;color:var(--text-3);display:flex;gap:8px;align-items:center}
.sv .slot img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;background:#000}
.sv .drop{aspect-ratio:16/9;border:2px dashed var(--line-strong);border-radius:6px;display:grid;place-items:center;align-content:center;gap:6px;text-align:center;color:var(--text-2);font-weight:600;cursor:pointer;width:100%;background:none;font:inherit}
.sv .drop.armed{background:var(--action-wash)}.sv .tile.empty-slot{border-style:dashed}
.sv .cell{height:28px;border-radius:6px;border:1px solid var(--line-strong);background:var(--inset);color:var(--text);font:inherit;padding:0 8px;min-width:0;width:100%}
.sv .ctl{display:grid;gap:6px;padding:0 10px 10px}
.sv .aud{flex-direction:row;align-items:center;gap:14px;padding:10px 14px;height:64px}
.sv .kv{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--line);font-size:13px}
.sv .kv .k2{width:20px;height:20px;border-radius:5px;background:var(--raised);display:grid;place-items:center;font:700 11px/1 var(--mono);color:var(--text-2);flex:none}
.sv .kv span.v{color:var(--text-2);font-size:12px;margin-left:auto;white-space:nowrap}`,
  async load() {
    const [devices, venues] = await Promise.all([api.get("/devices"), api.get("/venues")]);
    const gv = S.state?.gameDoc?.venueId;
    return { devices, venues, vid: (venues.find((v) => v.id === gv) || venues[0])?.id, picked: null, saveAs: false, sources: null };
  },
  render(ctx, d) {
    const srcs = d.sources || S.state?.engine?.sources || [];
    const vid = d.devices.filter((x) => x.kind !== "audio"), aud = d.devices.filter((x) => x.kind === "audio");
    // Which device sits in which slot: ours if known, otherwise the first unused device with the same kind and detail.
    const used = new Set(Object.values(slotDev));
    d.cur = srcs.map((s) => { let id = slotDev[s.slot] || s.deviceId; if (!id) { id = vid.find((x) => x.kind === s.kind && x.detail === s.detail && !used.has(x.id))?.id; if (id) used.add(id); } return { slot: s.slot, deviceId: id || "", label: s.label }; });
    const slotOf = (id) => d.cur.find((c) => c.deviceId === id)?.slot;
    const venue = d.venues.find((v) => v.id === d.vid);
    const sig = (l) => JSON.stringify(l.filter((x) => x.deviceId).map((x) => [x.slot, x.deviceId, x.label]).sort());
    const dirty = sig(d.cur) !== sig(venue?.slots || []);
    const nameOf = (id) => d.devices.find((x) => x.id === id)?.label || "";
    const mix = Math.max(0, ...(S.state?.engine?.mixer || []).map((m) => m.muted ? 0 : m.level));
    const dev = (v, ic) => { const sl = slotOf(v.id); return html`<button class="dev ${d.picked === v.id ? "picked" : ""}" data-dev="${v.id}" aria-pressed="${d.picked === v.id}"><span class="ic">${icon(ic, "lg")}</span><div class="tx"><b>${v.label}</b><span>${KIND[v.kind] || v.kind} · ${v.detail}${sl ? "" : " · not placed"}</span></div>${sl ? html`<span class="chip ok">Slot ${sl}</span>` : html`<span class="chip">Not placed</span>`}</button>`; };
    return html`<div class="sv">
      <section class="panel"><div class="ph"><h3>Detected devices</h3><span class="sp"></span><span class="chip ${d.devices.length ? "ok" : "warn"}">${icon(d.devices.length ? "check" : "alert", "sm")}${d.devices.length} found</span><button class="btn sm ghost" data-act="scan" aria-label="Scan again">${icon("refresh", "sm")}</button></div>
        <div class="dg lbl">Video sources</div>${vid.length ? vid.map((v) => dev(v, v.kind === "usb" ? "video" : "wifi")) : html`<div class="empty">No video devices. Plug in a camera or capture card.</div>`}
        <div class="dg lbl">Audio</div>${aud.length ? aud.map((v) => html`<div class="dev"><span class="ic">${icon("mic", "lg")}</span><div class="tx"><b>${v.label}</b><span>${v.detail}</span></div><span class="chip ok">Mixer</span></div>`) : html`<div class="empty">No audio device found.</div>`}
        <div style="padding:14px;border-top:1px solid var(--line)">${d.net ? html`<form class="col-g" id="netform" style="gap:8px;margin-bottom:10px"><div class="input"><input name="url" required placeholder="srt://192.168.1.50:9000, rtmp://, rtsp://, https:// or a video file path" aria-label="Stream address or file" style="background:none;border:0;color:inherit;font:inherit;outline:0;width:100%"></div><div class="input"><input name="label" maxlength="40" placeholder="Name (optional)" aria-label="Name" style="background:none;border:0;color:inherit;font:inherit;outline:0;width:100%"></div><div class="row" style="gap:8px"><button class="btn pri sm" type="submit">Add</button><button class="btn sm ghost" type="button" data-act="netcancel">Cancel</button></div></form>` : html`<button class="btn" data-act="net" style="margin-bottom:10px">${icon("plus", "sm")}Add network source</button>`}<span class="hint">Don't see a device? Plug it in and press scan. It appears here within a few seconds.</span></div></section>
      <section class="col-g" style="gap:12px"><div class="col-g" style="gap:4px"><h2 class="t">Sources</h2><span class="muted">${d.picked ? html`Now click a slot to place <b>${nameOf(d.picked)}</b>.` : "Click a device, then a slot, and give it a name you will recognize. One camera is enough."}</span></div>
        <div class="slots">${[1, 2, 3, 4].map((n) => { const s = srcs.find((x) => x.slot === n), cur = d.cur.find((c) => c.slot === n);
          return s ? html`<div class="tile slot" data-slot="${n}"><img alt="Slot ${n} preview" data-snap="${s.id}" src="/snap/${s.id}?t=${Date.now()}"><span class="k">${n}</span>
            <span class="hd"><span class="pill ${s.status === "ok" ? "ready" : "check"} noDot" data-st="${n}" style="height:18px;padding:0 7px;font-size:11px">${s.status === "ok" ? "Live" : s.status}</span></span>
            <div class="meta"><div class="nmx row" style="gap:8px;font-weight:650"><span data-dot="${n}" class="dot ${DOT[s.status]}"></span><span>${s.detail}</span><div class="meter" data-m="${s.id}" style="width:64px;margin-left:auto">${segs(lvOf(s.audio))}</div></div></div>
            <div class="ctl"><input class="cell" data-label="${n}" value="${s.label}" maxlength="40" aria-label="Name for slot ${n}">
              <select class="cell" data-pick="${n}" aria-label="Device for slot ${n}">${vid.map((v) => html`<option value="${v.id}" ${v.id === cur?.deviceId ? "selected" : ""}>${v.label}</option>`)}${!cur?.deviceId && html`<option selected>(current device)</option>`}</select>
              </div><button class="btn sm ghost" data-clear="${n}" style="position:absolute;top:30px;right:6px;background:rgba(5,8,14,.78);color:#fff" aria-label="Remove slot ${n}">${icon("x", "sm")}</button></div>`
          : html`<div class="tile slot empty-slot"><button class="drop ${d.picked ? "armed" : ""}" data-fill="${n}">${icon("down2", "xl")}<span>${d.picked ? `Place ${nameOf(d.picked)} here` : "Empty slot"}</span><span class="hint">Optional. Pick a device to add a view.</span></button><span class="k">${n}</span><div class="ctl" style="padding-top:10px"><select class="cell" data-pick="${n}" aria-label="Device for slot ${n}"><option value="">Choose a device</option>${vid.map((v) => html`<option value="${v.id}">${v.label}</option>`)}</select></div></div>`; })}</div>
        <div class="panel aud">${icon("mic", "lg")}<div style="min-width:0"><div style="font-weight:650">${aud[0]?.label || "No audio device"}</div><div class="faint" style="font-size:12px">${aud[0] ? "Level from the live mixer" : "Plug in a microphone or mixer"}</div></div><span class="sp"></span><div class="meter" data-mix style="width:120px">${segs(lvOf(mix))}</div><span class="chip ${aud[0] ? "ok" : "warn"}" id="sig">${icon(aud[0] ? "check" : "alert", "sm")}${aud[0] ? "Signal OK" : "No signal"}</span></div>
        <div class="row" style="justify-content:flex-end"><span class="muted">${srcs.length} of 4 slots in use</span><button class="btn pri lg" data-go="/preflight" ${srcs.length ? "" : "disabled"}>Run checks${icon("right")}</button></div></section>
      <aside class="panel"><div class="ph"><h3>Venue setup</h3></div><div class="pb col-g" style="gap:14px">
        <div class="field"><label for="vsel">Saved setup</label>${d.venues.length ? html`<div class="input" style="padding:0"><select id="vsel" class="cell" style="height:34px;border:0;background:none">${d.venues.map((v) => html`<option value="${v.id}" ${v.id === d.vid ? "selected" : ""}>${v.name}</option>`)}</select></div>` : html`<span class="hint">No saved setups yet.</span>`}
          ${venue && html`<span class="hint">Last saved ${fmtDate(venue.updatedAt, { weekday: "long" })}, ${fmtTime(venue.updatedAt)}</span>`}</div>
        <div>${[1, 2, 3, 4].map((n) => { const c = d.cur.find((x) => x.slot === n); return html`<div class="kv"><span class="k2">${n}</span>${c ? c.label : html`<span class="faint">Empty</span>`}<span class="v">${c ? nameOf(c.deviceId) || "" : "Not set"}</span></div>`; })}</div>
        ${venue && (dirty ? html`<div class="banner warn" style="align-items:flex-start">${icon("alert")}<div><b>Changes not saved</b><div class="muted" style="font-size:12px">Sources differ from ${venue.name}.</div></div></div>` : html`<div class="banner ok">${icon("check")}<span>Matches ${venue.name}.</span></div>`)}
        ${venue && html`<button class="btn" data-act="apply">Apply ${venue.name} to slots</button>`}
        ${d.saveAs ? html`<form class="row" id="saveas"><div class="input" style="flex:1"><input name="name" placeholder="Venue name" required maxlength="60" aria-label="New setup name" style="background:none;border:0;color:inherit;font:inherit;outline:0;width:100%"></div><button class="btn pri sm" type="submit">Save</button></form>` : ""}
        <div class="row"><button class="btn" style="flex:1" data-act="save" ${venue ? "" : "disabled"}>${icon("disk")}Save</button><button class="btn" style="flex:1" data-act="saveas">Save as</button></div>
        <span class="hint">Saved setups remember camera names and devices for the next game at this venue.</span></div></aside></div>`;
  },
  bind(root, ctx, d) {
    const assign = async (slot, deviceId, label) => {
      try { d.sources = await api.post("/slots", { slot, deviceId, label }); if (deviceId) slotDev[slot] = deviceId; else delete slotDev[slot]; d.picked = null; ctx.redraw(); } catch (e) { fail(e); }
    };
    const timer = setInterval(() => root.querySelectorAll("img[data-snap]").forEach((im) => { im.src = `/snap/${im.dataset.snap}?t=${Date.now()}`; }), 1000);
    root.onclick = async (e) => {
      const t = e.target.closest("button"); if (!t) return;
      const D = t.dataset;
      try {
        if (D.go) go(D.go);
        else if (D.dev) { d.picked = d.picked === D.dev ? null : D.dev; ctx.redraw(); }
        else if (D.fill) { if (d.picked) assign(+D.fill, d.picked, d.devices.find((x) => x.id === d.picked).label); else toast("Click a device on the left first, or use the list under the slot."); }
        else if (D.clear) assign(+D.clear, null);
        else if (D.act === "net") { d.net = true; ctx.redraw(); }
        else if (D.act === "netcancel") { d.net = false; ctx.redraw(); }
        else if (D.act === "scan") { d.devices = await api.get("/devices"); ctx.redraw(); }
        else if (D.act === "apply") { d.sources = await api.post(`/venues/${d.vid}/apply`); Object.keys(slotDev).forEach((k) => delete slotDev[k]); d.venues.find((v) => v.id === d.vid).slots.forEach((s) => s.deviceId && (slotDev[s.slot] = s.deviceId)); ctx.redraw(); }
        else if (D.act === "save" || D.act === "saveas") {
          if (D.act === "saveas") { d.saveAs = !d.saveAs; return ctx.redraw(); }
          const v = d.venues.find((x) => x.id === d.vid); const saved = await api.put("/venues", { ...v, slots: d.cur.filter((c) => c.deviceId) });
          Object.assign(v, saved); toast(`Saved ${v.name}.`); ctx.redraw();
        }
      } catch (err) { fail(err); }
    };
    root.onchange = (e) => {
      const el = e.target;
      if (el.dataset.pick && el.value) assign(+el.dataset.pick, el.value, root.querySelector(`[data-label="${el.dataset.pick}"]`)?.value || d.devices.find((x) => x.id === el.value).label);
      else if (el.dataset.label) { const c = d.cur.find((x) => x.slot === +el.dataset.label); if (c?.deviceId) assign(c.slot, c.deviceId, el.value.trim() || d.devices.find((x) => x.id === c.deviceId)?.label); else toast("This device was set before this page opened. Pick it again from the list to rename it."); }
      else if (el.id === "vsel") { d.vid = el.value; ctx.redraw(); }
    };
    root.onsubmit = async (e) => {
      e.preventDefault();
      if (e.target.id === "netform") {
        const f = new FormData(e.target);
        try { const dev = await api.post("/devices/network", { url: f.get("url"), label: f.get("label") }); d.devices = await api.get("/devices"); d.net = false; d.picked = dev.id; toast(`Added ${dev.label}. Now click a slot to place it.`); ctx.redraw(); } catch (err) { fail(err); }
        return;
      }
      try { const v = await api.put("/venues", { name: new FormData(e.target).get("name"), slots: d.cur.filter((c) => c.deviceId) }); d.venues.push(v); d.vid = v.id; d.saveAs = false; ctx.redraw(); } catch (err) { fail(err); }
    };
    return () => clearInterval(timer);
  },
  onState(root, st, ctx, d) {
    d.sources = null;
    for (const s of st.engine.sources) {
      const dot = root.querySelector(`[data-dot="${s.slot}"]`); if (dot) dot.className = `dot ${DOT[s.status]}`;
      const pill = root.querySelector(`[data-st="${s.slot}"]`); if (pill) { pill.textContent = s.status === "ok" ? "Live" : s.status; pill.className = `pill ${s.status === "ok" ? "ready" : "check"} noDot`; }
      const m = root.querySelector(`[data-m="${s.id}"]`); if (m) m.innerHTML = segs(lvOf(s.audio)).s;
    }
    const mix = root.querySelector("[data-mix]"); if (mix) mix.innerHTML = segs(lvOf(Math.max(0, ...st.engine.mixer.map((x) => (x.muted ? 0 : x.level))))).s;
  },
};
