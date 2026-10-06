// Fieldhouse phone remote. No framework, no build step. Talks only to the console it was served from:
//   POST /api/remote/pair, GET /api/remote/me, POST /api/event, and the /ws feed (trimmed state).
// Rules: never queue or replay taps while offline (controls are disabled instead); every user-visible string is set with
// textContent or escaped; all browser features (vibrate, wake lock, storage) are feature-detected.
(function () {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const text = (el, t) => { if (el && el.textContent !== String(t)) el.textContent = t; };
  const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
  const hex = (c) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : "");
  const buzz = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms || 12); } catch (e) {} };
  const store = {
    get(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };

  // ------------------------------------------------------------------ api
  async function call(method, path, body) {
    let r;
    try { r = await fetch(path, { method, cache: "no-store", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }); }
    catch (e) { const err = new Error("Could not reach the console. Check that you are on the gym Wi-Fi."); err.status = 0; throw err; }
    let data = null; try { data = await r.json(); } catch (e) {}
    if (!r.ok) { const err = new Error((data && data.error) || "Request failed (" + r.status + ")"); err.status = r.status; err.data = data || {}; throw err; }
    return data;
  }

  // ------------------------------------------------------------------ screens
  const SCREENS = ["pair", "wait", "msg", "live"];
  function show(name) { SCREENS.forEach((s) => { $("#s-" + s).hidden = s !== name; }); screen = name; if (name === "live") wake(); }
  let screen = "";
  function blocked(h, p) { show("msg"); text($("#msg-h"), h); text($("#msg-p"), p); stopLive(); }

  // ------------------------------------------------------------------ boot
  async function boot() {
    try {
      const me = await call("GET", "/api/remote/me");
      startLive(me.device);
    } catch (e) {
      if (e.status === 401) showPair(removedNote);
      else if (e.status === 403 || e.status === 0) blocked(e.status === 0 ? "Cannot reach the console" : "Remote is not available", e.message);
      else blocked("Something went wrong", e.message);
      removedNote = "";
    }
  }
  $("#msg-retry").addEventListener("click", boot);

  // ------------------------------------------------------------------ pairing
  let removedNote = "", lockTimer = 0;
  const codeEl = $("#code"), nameEl = $("#name"), perr = $("#perr"), pgo = $("#pgo");
  function showPair(note) {
    stopLive(); show("pair");
    text(perr, note || "");
    if (!nameEl.value) nameEl.value = store.get("fh_name");
    (codeEl.value ? nameEl : codeEl).focus({ preventScroll: true });
  }
  // The QR code carries ?c=<code>: pre-fill it, then strip it from the address bar so it is not kept in history or shared.
  (function () {
    try {
      const u = new URL(location.href), c = u.searchParams.get("c");
      if (c) { codeEl.value = c.slice(0, 24); u.searchParams.delete("c"); history.replaceState(null, "", u.pathname + (u.search || "") + u.hash); }
    } catch (e) {}
  })();

  function lockout(sec) {
    clearInterval(lockTimer);
    let left = sec;
    const tick = () => {
      if (left <= 0) { clearInterval(lockTimer); pgo.disabled = false; text(perr, ""); return; }
      pgo.disabled = true;
      text(perr, "Too many wrong tries. Try again in " + Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0") + ".");
      left--;
    };
    tick(); lockTimer = setInterval(tick, 1000);
  }

  $("#pf").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const name = nameEl.value.trim(), code = codeEl.value.trim();
    if (!name) { text(perr, "Enter your name so the console knows who you are."); nameEl.focus(); return; }
    pgo.disabled = true; text(perr, "");
    try {
      const r = await call("POST", "/api/remote/pair", { code, name });
      store.set("fh_name", name);
      if (r.pending) { pgo.disabled = false; return waitForConsole(r, name); }
      codeEl.value = ""; pgo.disabled = false;
      startLive(r.device);
    } catch (e) {
      if (e.status === 429 && e.data && e.data.retryAfterSec) return lockout(e.data.retryAfterSec);
      text(perr, e.message);
      pgo.disabled = false;
      if (e.status === 400 && /code/i.test(e.message)) codeEl.focus();
    }
  });

  // Approval mode: the console has "require code" off and shows Allow / Deny.
  let waitTimer = 0;
  function waitForConsole(r, name) {
    show("wait"); text($("#wait-name"), name); text($("#werr"), "");
    clearInterval(waitTimer);
    const poll = async () => {
      try {
        const x = await call("POST", "/api/remote/pair", { requestId: r.requestId, key: r.key });
        if (x.pending) return;
        clearInterval(waitTimer); startLive(x.device);
      } catch (e) {
        if (e.status === 0) return text($("#werr"), e.message); // keep trying
        clearInterval(waitTimer); pgo.disabled = false; showPair(e.status === 403 ? "The console did not allow this phone." : e.message);
      }
    };
    waitTimer = setInterval(poll, 2000);
  }
  $("#wcancel").addEventListener("click", () => { clearInterval(waitTimer); pgo.disabled = false; showPair(""); });

  // ------------------------------------------------------------------ live state
  let me = null, S = null, recvAt = 0, ws = null, wsOpen = false, lastMsg = 0, retry = 0, retryT = 0, gone = false, locked = false;
  let alive = false;

  function startLive(device) {
    me = device; show("live"); alive = true; gone = false; retry = 0;
    $("#mark").hidden = me.role !== "score+marks";
    connect();
  }
  function stopLive() {
    alive = false; clearTimeout(retryT);
    if (ws) { ws.onclose = ws.onmessage = ws.onopen = ws.onerror = null; try { ws.close(); } catch (e) {} ws = null; }
    wsOpen = false; S = null;
  }
  function connect() {
    if (!alive) return;
    clearTimeout(retryT);
    try { ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws"); }
    catch (e) { return scheduleRetry(); }
    const mine = ws;
    ws.onopen = () => { if (ws !== mine) return; wsOpen = true; retry = 0; lastMsg = performance.now(); render(); };
    ws.onmessage = (m) => {
      if (ws !== mine) return;
      let d; try { d = JSON.parse(m.data); } catch (e) { return; }
      lastMsg = performance.now();
      if (d.kind === "me") { me = d.device; $("#mark").hidden = me.role !== "score+marks"; render(); }
      else if (d.kind === "state") { S = d; recvAt = performance.now(); locked = !!d.locked; onState(); render(); }
    };
    ws.onclose = (e) => { if (ws !== mine) return; wsOpen = false; ws = null; render(); if (e && e.code === 4001) removedNote = "This phone was removed from the console. Enter the code to connect again."; verify(); };
    ws.onerror = () => {};
  }
  // After a drop: if the console no longer knows this phone, go back to pairing; otherwise keep reconnecting.
  async function verify() {
    if (!alive) return;
    try { await call("GET", "/api/remote/me"); removedNote = ""; scheduleRetry(); }
    catch (e) {
      if (e.status === 401) { const n = removedNote || "This phone is no longer connected to the console. Enter the code to connect again."; removedNote = ""; stopLive(); showPair(n); }
      else if (e.status === 403) blocked("Remote is not available", e.message);
      else scheduleRetry();
    }
  }
  function scheduleRetry() { if (!alive) return; clearTimeout(retryT); retryT = setTimeout(connect, Math.min(5000, 800 + retry++ * 700)); }
  setInterval(() => { if (alive && wsOpen && performance.now() - lastMsg > 25000 && ws) { try { ws.close(); } catch (e) {} } }, 3000); // the console pings every 10 s

  // ------------------------------------------------------------------ derived
  const game = () => (S && S.game) || null;
  const doc = () => (S && S.gameDoc) || null;
  const connected = () => alive && wsOpen && !!S;
  const canAct = () => connected() && !locked && !!game() && !(doc() && doc().status === "final");
  const clockNow = () => { const g = game(); if (!g) return 0; return g.running ? Math.max(0, g.clockMs - (performance.now() - recvAt)) : g.clockMs; };
  const teamName = (t) => (doc() && doc()[t] && doc()[t].name) || (game() && game()[t].name) || (t === "home" ? "Home" : "Away");
  const undoneSet = () => new Set((S ? S.events : []).filter((e) => e.type === "undo").map((e) => e.target));
  const lastUndoable = () => { const u = undoneSet(); return (S ? S.events : []).slice().reverse().find((e) => ["score", "foul", "timeout"].indexOf(e.type) >= 0 && !u.has(e.seq)); };
  const lastFoul = (team) => { // latest live foul this period (fouls reset on period.set)
    const u = undoneSet(), evs = S ? S.events : [];
    for (let i = evs.length - 1; i >= 0; i--) { const e = evs[i]; if (u.has(e.seq)) continue; if (e.type === "period.set") return null; if (e.type === "foul" && e.team === team) return e; }
    return null;
  };
  function describe(e) {
    const who = e.player != null ? " #" + e.player : "";
    switch (e.type) {
      case "score": return teamName(e.team) + " +" + e.points + who;
      case "foul": return teamName(e.team) + " foul" + who;
      case "timeout": return teamName(e.team) + " timeout";
      case "mark": return "Marked moment" + (e.note ? ": " + e.note : "");
      case "period.set": return "Period set to " + perLabel(e.period);
      default: return e.type;
    }
  }
  const perLabel = (p) => (p > 4 ? "OT" + (p - 4 > 1 ? p - 4 : "") : "Q" + p);
  const ago = (t) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 5 ? "now" : s < 60 ? s + " s ago" : s < 3600 ? Math.floor(s / 60) + " min ago" : Math.floor(s / 3600) + " h ago"; };

  // ------------------------------------------------------------------ sending events (never queued)
  let inflight = 0;
  const mineSeq = new Set();
  async function send(body) {
    if (!canAct()) return;
    buzz(); inflight++;
    try {
      const r = await call("POST", "/api/event", body);
      if (r && r.seq) mineSeq.add(r.seq);
      if (!$("#note").hidden && noteKind === "err") hideNote();
    } catch (e) {
      if (e.status === 401) { stopLive(); showPair("This phone is no longer connected to the console. Enter the code to connect again."); }
      else if (e.status === 423) { locked = true; render(); }
      else note("err", "Did not go through", e.message);
    } finally { inflight--; checkForeign(); }
  }

  // ------------------------------------------------------------------ notes ("Console changed score", errors)
  let noteKind = "", noteT = 0;
  function note(kind, h, p, act) {
    noteKind = kind; clearTimeout(noteT);
    const n = $("#note"); n.hidden = false; n.classList.toggle("err", kind === "err");
    $("#note-i").setAttribute("href", kind === "err" ? "#i-alert" : "#i-info");
    text($("#note-h"), h); text($("#note-p"), p || "");
    const b = $("#note-act"); b.hidden = !act; if (act) { text(b, act.label); b.onclick = () => { hideNote(); act.fn(); }; }
    noteT = setTimeout(hideNote, 9000);
    render();
  }
  function hideNote() { clearTimeout(noteT); noteKind = ""; $("#note").hidden = true; render(); }

  // Another operator changed the score: tell this one, with a one-tap undo for that change.
  let seen = null, scoresThen = null;
  function checkForeign() {
    if (!S || !S.game || inflight > 0) return;
    const evs = S.events, top = evs.reduce((m, e) => Math.max(m, e.seq), 0);
    const now = { home: S.game.home.score, away: S.game.away.score };
    if (seen === null || (S.gameId && scoresThen && scoresThen.id !== S.gameId)) { seen = top; scoresThen = { id: S.gameId, ...now }; return; }
    const fresh = evs.filter((e) => e.seq > seen && (e.type === "score" || e.type === "undo") && !mineSeq.has(e.seq));
    if (fresh.length && (now.home !== scoresThen.home || now.away !== scoresThen.away)) {
      const t = now.home !== scoresThen.home ? "home" : "away";
      const sc = fresh.filter((e) => e.type === "score").pop(), u = undoneSet();
      note("info", "Console changed score", teamName(t) + " now " + now[t] + ", was " + scoresThen[t], sc && !u.has(sc.seq) ? { label: "Undo", fn: () => send({ type: "undo", target: sc.seq }) } : null);
      buzz([20, 40, 20]);
    }
    seen = Math.max(seen, top); scoresThen = { id: S.gameId, ...now };
    if (mineSeq.size > 200) mineSeq.clear();
  }
  function onState() { checkForeign(); }

  // ------------------------------------------------------------------ rendering
  let tab = "foul", armed = 0, armT = 0, logSig = "";
  function render() {
    if (screen !== "live") return;
    const g = game(), d = doc(), ok = canAct();
    // connection chip + banner
    const state = !wsOpen || !S ? "off" : locked ? "lock" : "ok";
    $("#conn .dot").className = "dot " + (state === "ok" ? "ok" : state === "lock" ? "warn" : "err");
    text($("#conn-t"), state === "ok" ? "Connected" : state === "lock" ? "Locked" : (retry > 0 || S) ? "Reconnecting" : "Connecting");
    const bn = $("#banner");
    const msg = !wsOpen || !S ? ["Reconnecting to the console", "Controls are paused until it is back. Nothing you tap is saved for later."]
      : locked ? ["The console has locked the remote", "Scoring is paused. The console can unlock it."]
      : !g ? ["No game is on yet", "The console has not started a game."]
      : d && d.status === "final" ? ["This game is final", "Scoring is closed."] : null;
    bn.hidden = !msg; if (msg) { text($("#banner-h"), msg[0]); text($("#banner-p"), msg[1]); bn.classList.toggle("warn", true); }
    text($("#title"), d ? d.title || (d.home.name + " vs " + d.away.name) : "Fieldhouse");
    // controls
    $$("[data-ctl]").forEach((b) => { b.disabled = !ok; });
    if (g) {
      for (const t of ["home", "away"]) {
        const tm = g[t], col = hex(d && d[t].color) || (t === "home" ? "#F5A524" : "#8B6CFF");
        const blk = $('.score-block[data-team="' + t + '"]'), tm2 = $('.tm2[data-team="' + t + '"]');
        text(blk.querySelector(".tn"), teamName(t)); text(blk.querySelector(".sc"), tm.score); blk.querySelector(".nm i").style.background = col;
        $$("[data-pts]", blk).forEach((b) => b.setAttribute("aria-label", teamName(t) + " plus " + b.dataset.pts));
        text(tm2.querySelector(".tn"), teamName(t)); tm2.querySelector(".h i").style.background = col;
        text(tm2.querySelector(".fv"), tm.fouls); tm2.querySelector(".bn").hidden = !tm.bonus;
        const total = Math.max((S.profile && S.profile.timeouts) || 3, tm.timeouts), pk = tm.timeouts + "/" + total, pips = tm2.querySelector(".pips");
        if (pips.dataset.k !== pk) { pips.dataset.k = pk; pips.innerHTML = Array.from({ length: total }, (_, i) => '<i class="' + (i < tm.timeouts ? "on" : "") + '"></i>').join(""); pips.setAttribute("aria-label", tm.timeouts + " timeouts left"); }
        tm2.querySelector("[data-foul='1']").disabled = !ok; tm2.querySelector("[data-foul='-1']").disabled = !ok || !lastFoul(t);
        tm2.querySelector("[data-to]").disabled = !ok || tm.timeouts < 1;
        tm2.querySelector("[data-foul='1']").setAttribute("aria-label", "Add foul to " + teamName(t)); tm2.querySelector("[data-foul='-1']").setAttribute("aria-label", "Remove foul from " + teamName(t));
        const cap = $(t === "home" ? "#r-hc" : "#r-ac"); cap.style.background = col;
      }
      text($("#r-ha"), g.home.abbr); text($("#r-aa"), g.away.abbr); text($("#r-hs"), g.home.score); text($("#r-as"), g.away.score);
      text($("#r-pre"), g.period > 4 ? "OT" : "Q"); text($("#r-per"), g.period > 4 ? (g.period - 4 > 1 ? g.period - 4 : "") : g.period);
      text($("#clk-t"), g.running ? "Stop clock" : "Start clock"); text($("#clk-s"), g.running ? "Running" : "Stopped");
      $("#clk-i").setAttribute("href", g.running ? "#i-pause" : "#i-play");
    }
    tickClock();
    // undo row: the last undoable, unless a note is showing
    const lu = lastUndoable(), ub = $("#undo-last");
    ub.hidden = !$("#note").hidden; text($("#undo-t"), lu ? "Undo last: " + describe(lu) : "Nothing to undo");
    ub.disabled = !ok || !lu;
    renderPeriod(); renderLog();
  }
  function tickClock() { const t = mmss(clockNow()); $$("[data-clock]").forEach((el) => text(el, t)); }
  setInterval(() => { if (screen === "live") tickClock(); }, 100);

  function renderPeriod() {
    if (tab !== "per" || !S || !S.game) return;
    const n = (S.profile && S.profile.periods) || 4, box = $("#pbtns"), cur = S.game.period, k = n + "/" + cur + "/" + armed + "/" + canAct();
    if (box.dataset.k === k) return; box.dataset.k = k;
    box.innerHTML = Array.from({ length: n + 1 }, (_, i) => { const p = i + 1, a = armed === p; return '<button type="button" class="btn' + (a ? " arm" : "") + '" data-per="' + p + '" aria-pressed="' + (p === cur) + '"' + (canAct() ? "" : " disabled") + ">" + esc(a ? "Tap again" : perLabel(p)) + "</button>"; }).join("");
    text($("#p-hint"), armed ? "Tap " + perLabel(armed) + " again to start it. This resets the clock and team fouls." : "Changing the period resets the clock and team fouls.");
  }
  function renderLog() {
    if (tab !== "log" || !S) return;
    const u = undoneSet(), list = S.events.filter((e) => ["score", "foul", "timeout", "mark", "period.set"].indexOf(e.type) >= 0).slice(-30).reverse();
    const sig = list.map((e) => e.seq + (u.has(e.seq) ? "u" : "")).join() + canAct() + Math.floor(Date.now() / 10000);
    const box = $("#log"); if (box.dataset.k === sig) return; box.dataset.k = sig;
    box.innerHTML = list.length ? list.map((e) => {
      const undone = u.has(e.seq), can = canAct() && !undone && ["score", "foul", "timeout"].indexOf(e.type) >= 0;
      return '<div class="ev' + (undone ? " undone" : "") + '"><div class="tx"><b>' + esc(describe(e)) + '</b><div class="muted">' + esc(undone ? "Undone" : ago(e.t)) + "</div></div>" + (can ? '<button type="button" class="btn" data-undo="' + e.seq + '">Undo</button>' : "") + "</div>";
    }).join("") : '<div class="empty muted">Scores, fouls and timeouts show up here.</div>';
  }
  setInterval(() => { if (screen === "live" && tab === "log") renderLog(); }, 5000);

  // ------------------------------------------------------------------ input
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest && ev.target.closest("button");
    if (!b || b.disabled || screen !== "live") return;
    const team = b.closest("[data-team]") ? b.closest("[data-team]").dataset.team : "";
    if (b.id === "clk") { const g = game(); if (g) send({ type: g.running ? "clock.stop" : "clock.start" }); }
    else if (b.dataset.pts) send({ type: "score", team, points: Number(b.dataset.pts) });
    else if (b.dataset.foul === "1") send({ type: "foul", team });
    else if (b.dataset.foul === "-1") { const f = lastFoul(team); if (f) send({ type: "undo", target: f.seq }); }
    else if ("to" in b.dataset) send({ type: "timeout", team });
    else if (b.id === "undo-last") send({ type: "undo" });
    else if (b.id === "mark") send({ type: "mark" });
    else if (b.dataset.undo) send({ type: "undo", target: Number(b.dataset.undo) });
    else if (b.dataset.nudge) send({ type: "clock.set", ms: Math.min(3600000, Math.max(0, Math.round(clockNow() / 1000) * 1000 + Number(b.dataset.nudge))) });
    else if (b.dataset.per) {
      const p = Number(b.dataset.per);
      if (armed === p) { armed = 0; clearTimeout(armT); send({ type: "period.set", period: p }); }
      else { armed = p; clearTimeout(armT); armT = setTimeout(() => { armed = 0; render(); }, 4000); buzz(8); }
      $("#pbtns").dataset.k = ""; render();
    }
    else if (b.dataset.tab) setTab(b.dataset.tab);
  });
  function setTab(t) {
    tab = t;
    $$("[data-tab]").forEach((x) => { const on = x.dataset.tab === t; x.setAttribute("aria-selected", on); x.tabIndex = on ? 0 : -1; });
    $("#p-foul").hidden = t !== "foul"; $("#p-per").hidden = t !== "per"; $("#p-log").hidden = t !== "log";
    $("#pbtns").dataset.k = ""; $("#log").dataset.k = ""; render();
  }
  $(".tabs").addEventListener("keydown", (e) => { // arrow keys move between tabs
    const order = ["foul", "per", "log"], i = order.indexOf(tab);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { const n = order[(i + (e.key === "ArrowRight" ? 1 : 2)) % 3]; setTab(n); $('[data-tab="' + n + '"]').focus(); }
  });

  // ------------------------------------------------------------------ screen wake lock (best effort)
  let lock = null;
  async function wake() {
    try { if (!("wakeLock" in navigator) || lock || document.visibilityState !== "visible") return; lock = await navigator.wakeLock.request("screen"); lock.addEventListener("release", () => { lock = null; }); }
    catch (e) { lock = null; }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (screen === "live") { wake(); if (alive && !wsOpen) { clearTimeout(retryT); connect(); } }
  });
  window.addEventListener("online", () => { if (alive && !wsOpen) { clearTimeout(retryT); connect(); } });

  boot();
})();
