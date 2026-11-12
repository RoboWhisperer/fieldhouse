// Producer and graphics screens: run the broadcast or control graphics from another computer. Loaded by remote.js for the Producer, Admin and Graphics roles.
// The server enforces everything (src/auth.ts): this file only decides what to draw. User text goes through textContent or esc().
(function () {
  "use strict";
  const R = window.FHR; if (!R) return;
  const { esc, text } = R;
  const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const E = () => { const s = R.state(); return s && s.engine; };
  const GB = 1e9, fmtBytes = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + " GB" : n >= 1e6 ? (n / 1e6).toFixed(0) + " MB" : (n / 1e3).toFixed(0) + " KB");
  const TRIG = { pregame: "Pre-game", timeout: "At next timeout", period_end: "End of period", halftime: "Halftime", postgame: "Post-game" };
  let mounted = false, graphicsOnly = false, ac = null, timers = [], speed = 1, fadeMs = 500, rosterKey = "", msgT = 0, hold = null;

  const GFX_LEGACY = `
  <div class="panel"><div class="ph"><h3>Graphics</h3></div><div class="pb gfx">
    <button class="btn" id="g-bug" data-pc type="button" aria-pressed="false">Score bug <span class="st"></span></button>
    <button class="btn" id="g-slate" data-pc type="button" aria-pressed="false">Halftime card <span class="st"></span></button>
    <div class="lt"><select class="select" id="g-player" aria-label="Player lower third"></select>
      <button class="btn" id="g-lower" data-pc type="button">Show</button><button class="btn ghost" id="g-lowerx" data-pc type="button">Hide</button></div>
  </div></div>`;
  const GFX_PANEL = `<div class="panel pgfx"><div class="ph"><h3>Graphic controls</h3><span class="sp"></span><span class="muted" id="pgfx-count"></span></div><div class="pb gfxs" id="pgfx"></div></div>`;
  const FULL_HEAD = `<span class="chip" id="pe-eng"></span><span class="chip" id="pe-str"></span><span class="chip" id="pe-rec"></span><span class="chip" id="pe-sys"></span>`;
  const FULL_BC = `<div id="pe-bc" class="bc"></div>`;
  const FULL_MONITORS = `
  <div class="mons">
    <div class="monitor pvw"><span class="tag">PREVIEW</span><img data-mon="pvw" alt="Preview picture"><span class="src" id="pvwsrc"></span></div>
    <div class="monitor pgm"><span class="tag">PROGRAM</span><img data-mon="pgm" alt="Program picture"><span class="src" id="pgmsrc"></span></div>
  </div>`;
  const FULL_TILES = `<div class="tiles" id="ptiles"></div>`;
  const FULL_CTL = `
  <div class="panel pctl">
    <button class="btn pri xl" id="pcut" data-pc type="button">Cut <span class="kbd">Enter</span></button>
    <button class="btn xl" id="pfade" data-pc type="button">Fade <span class="kbd">Shift+Enter</span></button>
    <label class="sel"><span class="sr">Fade length</span><select class="select" id="pfms" aria-label="Fade length"><option value="250">0.25 s</option><option value="500" selected>0.5 s</option><option value="1000">1 s</option><option value="2000">2 s</option></select></label>
    <span class="vr"></span>
    <button class="btn xl" id="prep" data-pc type="button">Replay 10 s <span class="kbd">R</span></button>
    <div class="seg" id="pspd" role="group" aria-label="Replay speed"><button type="button" class="on" data-sp="1" aria-pressed="true">1x</button><button type="button" data-sp="0.5" aria-pressed="false">&frac12;x</button><button type="button" data-sp="0.25" aria-pressed="false">&frac14;x</button></div>
    <button class="btn" id="prepx" data-pc type="button">Stop replay</button>
  </div>`;
  const AUDIO_PANEL = `<div class="panel"><div class="ph"><h3>Audio</h3></div><div class="pb" id="pmix"></div></div>`;
  const SPONSOR_PANEL = `<div class="panel" id="pspon"></div>`;

  function shell(gfxOnly) {
    return `
  <div class="phead">${gfxOnly ? '<span class="chip" id="pe-conn"></span>' : FULL_HEAD}<span class="sp"></span>${gfxOnly ? "" : FULL_BC}</div>
  <div class="banner warn" id="pe-lock" role="status" hidden><svg class="i"><use href="#i-lock"/></svg><div><b>The console has locked the remote</b><div class="muted">${gfxOnly ? "Graphics are paused." : "Cameras, graphics and replay are paused. Pictures keep updating."} The console can unlock it.</div></div></div>
  <div class="banner err" id="pe-msg" role="alert" hidden><svg class="i"><use href="#i-alert"/></svg><div id="pe-msg-t"></div></div>
  ${gfxOnly ? "" : FULL_MONITORS + FULL_TILES + FULL_CTL}
  ${gfxOnly ? GFX_LEGACY : `<div class="prow">${GFX_LEGACY}${AUDIO_PANEL}</div>`}
  ${GFX_PANEL}
  ${gfxOnly ? "" : SPONSOR_PANEL}`;
  }

  function mount(opts) {
    const mode = !!(opts && opts.graphicsOnly);
    if (mounted) { if (mode === graphicsOnly) return; unmount(); }
    mounted = true; graphicsOnly = mode; rosterKey = ""; clearTimeout(msgT);
    ac = new AbortController();
    const box = document.getElementById("pmain"); box.innerHTML = shell(graphicsOnly);
    const signal = ac.signal;
    box.addEventListener("click", onClick, { signal }); box.addEventListener("change", onChange, { signal }); box.addEventListener("input", onGfxInput, { signal });
    box.addEventListener("pointerdown", holdStart, { signal }); box.addEventListener("pointerup", holdCancel, { signal }); box.addEventListener("pointerleave", holdCancel, { capture: true, signal }); box.addEventListener("pointercancel", holdCancel, { signal });
    box.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && !e.repeat && e.target.closest && e.target.closest("[data-hold]")) { e.preventDefault(); holdStart(e); } }, { signal });
    box.addEventListener("keyup", (e) => { if (e.key === "Enter" || e.key === " ") holdCancel(); }, { signal });
    R.onRenderProducer = render;
    R.extraHelp.length = 0;
    if (!graphicsOnly) {
      R.extraKeys.Enter = keyCut; R.extraKeys["Shift+Enter"] = keyFade; R.extraKeys.r = keyReplay;
      for (const n of [1, 2, 3, 4]) R.extraKeys[String(n)] = () => previewSlot(n);
      R.extraHelp.push(["Producer", [["Enter", "Cut"], ["Shift+Enter", "Fade"], ["1  2  3  4", "Put a camera in preview"], ["R", "Replay"]]]);
      timers.push(setInterval(() => { if (!document.hidden) $$(".monitor img[data-snap]").forEach(loadInto); }, 250));   // about 4 pictures a second
      timers.push(setInterval(() => { if (!document.hidden) $$(".ptile img[data-snap]").forEach(loadInto); }, 1000));   // about 1 a second
    }
    render();
  }
  function unmount() {
    if (!mounted) return; mounted = false; graphicsOnly = false; timers.forEach(clearInterval); timers = []; holdCancel(); clearTimeout(msgT);
    if (ac) { ac.abort(); ac = null; }
    gfxCards.clear(); drafts.clear();
    delete R.onRenderProducer; for (const k of ["Enter", "Shift+Enter", "r", "1", "2", "3", "4"]) delete R.extraKeys[k];
    R.extraHelp.length = 0; document.getElementById("pmain").innerHTML = "";
  }
  window.FHR.producer = { mount, unmount };
  R.onRender(() => { if (mounted) render(); });

  const loadInto = (img) => {
    const id = img.dataset.snap; if (!id || img._busy || !R.connected()) return; img._busy = 1;
    const n = new Image(); n.onload = () => { img.src = n.src; img.style.visibility = ""; img._busy = 0; }; n.onerror = () => { img._busy = 0; };
    n.src = "/snap/" + encodeURIComponent(id) + "?t=" + Date.now();
  };

  function can() { return R.ready(); }
  function perr(e) { // plain message in the producer column; a lost pairing or the console lock is handled by the core
    if (e.status === 401 || e.status === 423) return R.fail(e);
    text($("#pe-msg-t"), e.message); $("#pe-msg").hidden = false; clearTimeout(msgT); msgT = setTimeout(() => { $("#pe-msg").hidden = true; }, 7000);
  }
  async function act(path, body) {
    if (!can()) return; R.buzz(); $("#pe-msg").hidden = true;
    try { return await R.call("POST", "/api" + path, body || {}); } catch (e) { perr(e); }
  }
  const cut = () => act("/engine/cut"), fade = () => act("/engine/fade", { ms: fadeMs }), replay = () => act("/replay", { secondsBack: 10, speed });
  const free = (e) => !(e.target.closest && e.target.closest("button,a,select,[role=tab]"));
  function keyCut(e) { if (free(e)) cut(); }
  function keyFade(e) { if (free(e)) fade(); }
  function keyReplay() { replay(); }
  function previewSlot(n) { const s = (E() || { sources: [] }).sources.find((x) => x.slot === n); if (s) act("/engine/preview", { sourceId: s.id }); }

  // ---- hold to confirm (stopping a live broadcast is not a single click)
  function holdStart(e) {
    const b = e.target.closest && e.target.closest("[data-hold]"); if (!b || b.disabled || hold) return;
    b.classList.add("holding");
    hold = { b, t: setTimeout(() => { const x = hold; hold = null; x.b.classList.remove("holding"); act("/broadcast/stop"); }, 1500) };
  }
  function holdCancel() { if (!hold) return; clearTimeout(hold.t); hold.b.classList.remove("holding"); hold = null; }

  function onClick(e) {
    const b = e.target.closest("button"); if (!b || b.disabled) return;
    if (b.id === "pcut") cut(); else if (b.id === "pfade") fade(); else if (b.id === "prep") replay();
    else if (b.id === "prepx") act("/replay/stop");
    else if (b.dataset.sp) { speed = Number(b.dataset.sp); $$("#pspd button").forEach((x) => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-pressed", on); }); }
    else if (b.dataset.tile) act("/engine/preview", { sourceId: b.dataset.tile });
    else if (b.id === "g-bug") act("/graphics", { scorebug: !(R.state().graphics || {}).scorebug });
    else if (b.id === "g-slate") act("/graphics", { slate: (R.state().graphics || {}).slate ? null : "Halftime" });
    else if (b.id === "g-lower") { const o = $("#g-player").selectedOptions[0]; if (o && o.value) act("/graphics", { lower: { title: o.dataset.title, sub: o.dataset.sub } }); }
    else if (b.id === "g-lowerx") act("/graphics", { lower: null });
    else if (b.hasAttribute("data-gshow")) gfxAct(b, "show");
    else if (b.hasAttribute("data-gupdate")) gfxAct(b, "update");
    else if (b.hasAttribute("data-ghide")) gfxAct(b, "hide");
    else if (b.hasAttribute("data-gnext")) gfxAct(b, "next");
    else if (b.dataset.mute) act("/engine/mute", { id: b.dataset.mute, muted: b.getAttribute("aria-pressed") !== "true" });
    else if (b.dataset.fire) { const n = (R.state() || {}).next; if (n) act("/sponsors/fire", { sponsorId: n.sponsorId, outcome: b.dataset.fire }); }
    else if (b.id === "pbc-start") act("/broadcast/start");
  }
  function onChange(e) {
    if (e.target.id === "pfms") fadeMs = Number(e.target.value);
    else onGfxInput(e);
  }

  // ---- graphic field editors (every enabled custom graphic; built-ins keep the legacy buttons above)
  const gfxCards = new Map(), drafts = new Map();
  const fieldInput = (card, name) => $$("[data-gfield]", card).find((x) => x.dataset.gfield === name);
  function setDraft(id, name, value) { let d = drafts.get(id); if (!d) drafts.set(id, d = {}); if (value === "") delete d[name]; else d[name] = value; }
  function draftFor(id) { const d = drafts.get(id); return d ? { ...d } : {}; }
  function onGfxInput(e) {
    const pick = e.target.closest && e.target.closest("[data-gcolor]");
    if (pick) { const card = pick.closest("[data-gid]"), input = card && fieldInput(card, pick.dataset.gcolor); if (input) input.value = pick.value; if (card) setDraft(card.dataset.gid, pick.dataset.gcolor, pick.value); return; }
    const f = e.target.closest && e.target.closest("[data-gfield]"), card = f && f.closest("[data-gid]");
    if (card) setDraft(card.dataset.gid, f.dataset.gfield, f.value);
  }
  function gfxAct(b, action) {
    const card = b.closest("[data-gid]"); if (!card) return;
    return act("/graphics/" + encodeURIComponent(card.dataset.gid) + "/" + action, action === "show" || action === "update" ? { fields: draftFor(card.dataset.gid) } : {});
  }
  const gfield = (f, cur) => {
    const name = esc(f.name), label = esc(f.label || f.name), now = String(cur == null ? (f.default || "") : cur), empty = now ? "" : "Empty";
    if (f.type === "bool") { const on = /^(true|1|yes)$/i.test(now); return `<label class="gf"><span class="gfl">${label}</span><select class="select" data-gfield="${name}"><option value="">Use current (${on ? "Yes" : "No"})</option><option value="true">Yes</option><option value="false">No</option></select></label>`; }
    if (f.type === "color") { const hx = /^#[0-9a-f]{6}$/i.test(now) ? now : "#000000"; return `<label class="gf"><span class="gfl">${label}</span><span class="gfrow"><input type="color" value="${hx}" data-gcolor="${name}" aria-label="Pick ${label}"><input class="input mono" type="text" data-gfield="${name}" placeholder="${esc(now || empty)}" spellcheck="false" autocomplete="off"></span></label>`; }
    if (f.type === "multiline") return `<label class="gf"><span class="gfl">${label}</span><textarea class="input" rows="2" data-gfield="${name}" placeholder="${esc(now || empty)}"></textarea></label>`;
    const step = f.type === "number" ? ' type="number" step="any" inputmode="decimal"' : ' type="text"';
    return `<label class="gf"><span class="gfl">${label}</span><input class="input"${step} data-gfield="${name}" placeholder="${esc(now || empty)}" autocomplete="off" spellcheck="false"></label>`;
  };
  const gcard = (item) => {
    const fields = (item.fieldDefs || []).map((f) => gfield(f, item.fields && item.fields[f.name])).join("");
    return `<div class="ghead"><div class="gname"><b>${esc(item.name)}</b><span class="grole">${esc(item.role)}</span></div><span class="gstate"></span></div>
      <div class="gfields">${fields || '<p class="muted">This graphic has no data fields. Everything it shows comes from the game.</p>'}</div>
      <div class="gacts"><button class="btn pri" data-gshow data-pc type="button">Show</button><button class="btn" data-gupdate data-pc type="button">Update</button><button class="btn ghost" data-ghide data-pc type="button">Hide</button><button class="btn ghost" data-gnext data-pc type="button">Next</button></div>`;
  };
  function renderGraphics(items, ok) {
    const box = $("#pgfx"), list = items.filter((i) => !i.builtin), live = new Set(list.map((i) => i.id));
    for (const [id, c] of gfxCards) if (!live.has(id)) { c.el.remove(); gfxCards.delete(id); drafts.delete(id); }
    text($("#pgfx-count"), list.length ? list.length + (list.length === 1 ? " graphic" : " graphics") : "");
    if (!list.length) { if (box.dataset.empty !== "1") { box.innerHTML = '<p class="muted">No custom graphics are enabled. Import or enable graphics on the console.</p>'; box.dataset.empty = "1"; } return; }
    if (box.dataset.empty === "1") { box.innerHTML = ""; box.dataset.empty = ""; }
    for (const item of list) {
      let c = gfxCards.get(item.id), sig = item.id + "|" + item.name + "|" + item.role + "|" + (item.fieldDefs || []).map((f) => f.name + ":" + f.label + ":" + f.type + ":" + f.default).join("|");
      if (!c || c.sig !== sig) {
        if (c) c.el.remove();
        const el = document.createElement("article"); el.className = "gcard"; el.dataset.gid = item.id; el.innerHTML = gcard(item);
        c = { sig, el }; gfxCards.set(item.id, c); box.append(el);
        for (const [name, value] of Object.entries(drafts.get(item.id) || {})) { const input = fieldInput(el, name); if (input) input.value = value; }
      }
      const el = c.el, on = !!item.visible, stopping = item.phase === "stopping", manual = item.showMode === "manual" || item.showMode === "auto-hide";
      const state = $(".gstate", el); state.textContent = on ? "ON AIR" : stopping ? "STOPPING" : item.showMode === "always" ? "ALWAYS ON" : item.showMode === "while-live" ? "WHILE LIVE" : "OFF";
      state.className = "gstate" + (on ? " on" : stopping ? " stopping" : "");
      const show = $("[data-gshow]", el), upd = $("[data-gupdate]", el), hide = $("[data-ghide]", el), next = $("[data-gnext]", el);
      for (const input of $$("[data-gfield],[data-gcolor]", el)) input.disabled = !ok;
      show.disabled = !ok || !manual || on; upd.disabled = !ok || !on; hide.disabled = !ok || !manual || !on; next.disabled = !ok || !on || item.kind === "url";
      show.title = manual ? "" : "This graphic follows its show policy. Change it on the console.";
      hide.title = show.title; next.title = item.kind === "url" ? "URL graphics have no next step." : "";
      for (const f of item.fieldDefs || []) if (f.type === "color") { const pick = el.querySelector('[data-gcolor="' + CSS.escape(f.name) + '"]'); if (pick && !(drafts.get(item.id) || {})[f.name]) { const v = String((item.fields || {})[f.name] || f.default || ""), hx = /^#[0-9a-f]{6}$/i.test(v) ? v : "#000000"; if (pick.value !== hx) pick.value = hx; } }
    }
  }

  // ---- drawing
  const chip = (id, cls, t) => { const el = $("#" + id); el.className = "chip " + cls; text(el, t); };
  function render() {
    const s = R.state(); if (!s) return;
    const ok = can(), g = s.graphics || {};
    $("#pe-lock").hidden = !R.locked();
    const conn = $("#pe-conn");
    if (conn) { conn.className = "chip " + (R.connected() ? "ok" : "warn"); text(conn, R.connected() ? (R.locked() ? "Locked" : "Connected") : "Reconnecting"); }
    $$("[data-pc]").forEach((b) => { b.disabled = !ok; });
    // legacy graphics controls
    const tog = (id, on) => { const b = $(id); b.setAttribute("aria-pressed", !!on); text(b.querySelector(".st"), on ? "ON" : "OFF"); b.classList.toggle("on", !!on); };
    tog("#g-bug", g.scorebug); tog("#g-slate", g.slate);
    const gd = s.gameDoc, rk = gd ? gd.id + gd.home.roster.length + gd.away.roster.length : "";
    if (rk !== rosterKey) {
      rosterKey = rk; const sel = $("#g-player"); sel.innerHTML = "";
      const first = document.createElement("option"); first.value = ""; first.textContent = "Player lower third..."; sel.append(first);
      if (gd) for (const t of ["home", "away"]) for (const p of gd[t].roster) { const o = document.createElement("option"); o.value = t + p.number; o.textContent = "#" + p.number + " " + p.name + " (" + gd[t].name + ")"; o.dataset.title = "#" + p.number + " " + p.name; o.dataset.sub = gd[t].name + (p.position ? " · " + p.position : ""); sel.append(o); }
    }
    $("#g-player").disabled = !ok; $("#g-lower").disabled = !ok; $("#g-lowerx").disabled = !ok;
    renderGraphics(g.items || [], ok);
    if (graphicsOnly) return;
    const e = E(); if (!e) return;
    $("#prepx").disabled = !ok || !e.replay.active;
    chip("pe-eng", e.connected ? "ok" : "warn", (e.engine === "obs" ? "OBS" : "Demo engine") + (e.connected ? "" : " not connected"));
    chip("pe-str", e.stream.reconnecting ? "warn" : e.stream.live ? "ok" : "", e.stream.reconnecting ? "Stream reconnecting" : e.stream.live ? "Live " + e.stream.kbps + " kbps" + (e.stream.droppedFrames ? ", " + e.stream.droppedFrames + " dropped" : "") : "Not streaming");
    chip("pe-rec", e.record.active ? "ok" : "", e.record.active ? "Recording " + fmtBytes(e.record.bytes) : "Not recording");
    chip("pe-sys", e.diskFreeBytes < 5 * GB ? "warn" : "", "CPU " + Math.round(e.cpu) + "%, " + (e.diskFreeBytes / GB).toFixed(0) + " GB free");
    const bc = $("#pe-bc"), live = e.stream.live || e.record.active, bk = (s.canBroadcast ? "y" : "n") + live;
    if (bc.dataset.k !== bk) {
      bc.dataset.k = bk;
      bc.innerHTML = !s.canBroadcast ? '<span class="muted">Start and stop the broadcast on the console. It can allow this in Settings, Remote access.</span>'
        : live ? '<button class="btn danger hold" id="pbc-stop" data-hold data-pc type="button"><span class="bar"></span><span>Hold to stop broadcast</span></button>'
        : '<button class="btn pri" id="pbc-start" data-pc type="button">Start broadcast</button>';
    }
    $$("#pe-bc [data-pc]").forEach((b) => { b.disabled = !ok; });
    // monitors and tiles
    const gp = e.graphicsInProgram, src = (id) => e.sources.find((x) => x.id === id);
    const pv = gp ? "preview" : e.preview || "", pg = gp ? "program" : e.program || "";
    for (const [sel, id] of [['img[data-mon="pvw"]', pv], ['img[data-mon="pgm"]', pg]]) { const im = $(sel); if (im.dataset.snap !== id) { im.dataset.snap = id; loadInto(im); } }
    text($("#pvwsrc"), src(e.preview) ? src(e.preview).slot + " · " + src(e.preview).label : "No source");
    text($("#pgmsrc"), src(e.program) ? src(e.program).slot + " · " + src(e.program).label : "No source");
    const tk = e.sources.map((x) => x.id + x.label + x.status + (x.id === e.program) + (x.id === e.preview)).join("|"), tl = $("#ptiles");
    if (tl.dataset.k !== tk) {
      tl.dataset.k = tk;
      tl.innerHTML = e.sources.map((x) => `<button type="button" class="ptile ${x.id === e.program ? "pgm" : x.id === e.preview ? "pvw" : ""}" data-pc data-tile="${esc(x.id)}" aria-label="Preview ${esc(x.label)}"><span class="feed"><img data-snap="${esc(x.id)}" alt=""></span><span class="cap"><b>${esc(x.slot)}</b> ${esc(x.label)}${x.id === e.program ? ' <i class="t pg">ON AIR</i>' : x.id === e.preview ? ' <i class="t pv">NEXT</i>' : ""}${x.status !== "ok" ? ' <i class="t bad">' + esc(x.status) + "</i>" : ""}<span class="mt"><i></i></span></span></button>`).join("");
      $$("#ptiles .ptile img").forEach(loadInto); $$("#ptiles [data-pc]").forEach((b) => { b.disabled = !ok; });
    }
    $$("#ptiles .ptile").forEach((t) => { const x = src(t.dataset.tile); if (x) t.querySelector(".mt i").style.width = Math.round(Math.max(0, Math.min(1, x.audio)) * 100) + "%"; });
    // mixer
    const mk = e.mixer.map((m) => m.id + m.muted).join("|"), mx = $("#pmix");
    if (mx.dataset.k !== mk) { mx.dataset.k = mk; mx.innerHTML = e.mixer.length ? e.mixer.map((m) => `<div class="mix"><span class="nm">${esc(m.label)}</span><span class="mt"><i data-lv="${esc(m.id)}"></i></span><button type="button" class="btn sm" data-pc data-mute="${esc(m.id)}" aria-pressed="${m.muted}" aria-label="${m.muted ? "Unmute" : "Mute"} ${esc(m.label)}">${m.muted ? "Muted" : "Mute"}</button></div>`).join("") : '<div class="muted">No audio channels.</div>'; $$("#pmix [data-pc]").forEach((b) => { b.disabled = !ok; }); }
    e.mixer.forEach((m) => { const i = $(`#pmix [data-lv="${CSS.escape(m.id)}"]`); if (i) i.style.width = Math.round((m.muted ? 0 : Math.max(0, Math.min(1, m.level))) * 100) + "%"; });
    // next sponsor
    const n = s.next, sp = $("#pspon"), nk = JSON.stringify([n && n.sponsorId, n && n.trigger, g.sponsor && g.sponsor.name, ok]);
    if (sp.dataset.k !== nk) {
      sp.dataset.k = nk;
      sp.innerHTML = `<div class="ph"><h3>Next sponsor break</h3><span class="sp"></span>${n ? `<span class="chip">${esc(TRIG[n.trigger] || "")}</span>` : ""}</div><div class="pb spb">${n ? `<span class="logo" style="background:${/^#[0-9a-f]{6}$/i.test(n.color) ? n.color : "var(--raised)"}">${esc(n.abbr)}</span><div class="spt"><b>${esc(n.name)}</b><div class="muted">${esc(n.seconds)} s</div></div><button class="btn pri" data-pc data-fire="aired" type="button">Fire now</button><button class="btn" data-pc data-fire="skipped" type="button">Skip</button><button class="btn" data-pc data-fire="delayed" type="button">Delay</button>` : '<span class="muted">No sponsor is due right now.</span>'}${g.sponsor ? `<span class="chip ok">On air: ${esc(g.sponsor.name)}</span>` : ""}</div>`;
      $$("#pspon [data-pc]").forEach((b) => { b.disabled = !ok; });
    }
  }
})();
