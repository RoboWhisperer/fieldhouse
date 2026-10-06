// Live Production Console (/live, night shell step 3). Spec: design/screens/07-live-console.html + 13a-d recovery frames.
// DOM is built once in render(); onState() only patches text/classes/attributes (inputs, drags, hold-to-end survive pushes).
import { esc, html, raw, icon, api, S, toast, fail, go, keys, fmtBytes, fmtDate, fmtElapsed, period, clockMs } from "../app.js";

const I = (n, c = "") => icon(n, c).s;
const TRIG = { timeout: "At next timeout", period_end: "At end of period", halftime: "At halftime", pregame: "Before tip-off", postgame: "After the game" };
const PTS = { 1: "free throw", 2: "basket", 3: "3-pointer" };
const MIX_ICON = { commentary: "mic", crowd: "vol", program: "sliders" };
const GAIN_MIN = -40, GAIN_MAX = 6;
const BYTES_PER_MIN = (6e6 / 8) * 60; // 6 Mbps recording estimate
const ACTIONS = [["cut", "Cut"], ["fade", "Fade"], ["preview1", "Preview source 1"], ["preview2", "Preview source 2"], ["preview3", "Preview source 3"], ["preview4", "Preview source 4"], ["clock", "Start / stop clock"], ["replay", "Replay last 10 s"], ["replayScore", "Replay last score"], ["mark", "Mark moment"], ["fireSponsor", "Fire sponsor"], ["homePlus1", "Home +1"], ["homePlus2", "Home +2"], ["homePlus3", "Home +3"], ["awayPlus1", "Away +1"], ["awayPlus2", "Away +2"], ["awayPlus3", "Away +3"], ["undo", "Undo"]];

// ---- pure helpers (checked with bun in the verify step)
export const normKey = (k) => { const p = String(k).split("+"), key = p.pop(); return [p.includes("Ctrl") ? "Ctrl" : "", p.includes("Shift") ? "Shift" : "", key.length === 1 ? key.toUpperCase() : key].filter(Boolean).join("+"); };
export const keyLabel = (k) => String(k).replace("Shift+", "⇧ ").replace("Ctrl+", "Ctrl ").replace(/^[a-z]$/, (c) => c.toUpperCase());
export const gainToPos = (g) => Math.min(1, Math.max(0, (g - GAIN_MIN) / (GAIN_MAX - GAIN_MIN)));
export const posToGain = (v) => { const g = Math.round((GAIN_MIN + v * (GAIN_MAX - GAIN_MIN)) * 2) / 2; return Math.abs(g) < 1 ? 0 : g; };
export const minutesLeft = (free) => Math.max(0, Math.floor(free / BYTES_PER_MIN));
export const replaySeconds = (ageMs) => Math.min(30, Math.max(5, Math.ceil(ageMs / 1000) + 2));
export const rel = (ms) => (ms < 5000 ? "now" : ms < 60000 ? Math.floor(ms / 1000) + "s" : ms < 3600000 ? Math.floor(ms / 60000) + "m" : Math.floor(ms / 3600000) + "h");
export const startingFive = (roster) => {
  const st = roster.filter((p) => p.starter);
  const names = st.map((p) => `#${p.number} ${(p.name.split(" ").pop() || "").trim()}`).join(" · ");
  return names.length <= 80 ? names : st.map((p) => "#" + p.number).join(" · ");
};

const css = `
.cons{display:flex;flex-direction:column;height:100%;min-height:0}
.bns{display:grid;gap:8px;flex:none}.bns:not(:empty){margin-bottom:12px}.bns .banner{min-width:0}.banner .sub{color:var(--text-2);font-size:12.5px}
.con{display:grid;grid-template-columns:minmax(0,1fr) 462px;gap:16px;flex:1;min-height:0}
.left{display:grid;grid-template-rows:auto auto auto minmax(0,1fr);gap:12px;min-height:0;overflow:auto;padding-right:2px}
.mons{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}
.srcs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.ctl{flex-direction:row;align-items:center;gap:12px;padding:8px 12px;height:76px}
.ctl .grp{display:flex;gap:10px;align-items:center;flex:none}.ctl .field{flex:none}
.ctl .btn.xl{padding:0 16px}.ctl .seg span{padding:0 9px}.ctl .vr{width:1px;align-self:stretch;background:var(--line);margin:4px 4px}
.low{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:16px;min-height:0}
.gfx{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.gfx .btn,.gfx .select{height:40px}.gfx .btn{justify-content:flex-start}
.gfx .btn .st{margin-left:auto;font-size:11px;font-weight:800;letter-spacing:.07em;color:var(--text-3)}
.gfx .btn.on{border-color:var(--ready);background:var(--ready-wash)}.gfx .btn.on .st{color:var(--ready)}
.gfx select.select{appearance:auto;width:100%;font-weight:600;cursor:pointer}
.mix{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;height:100%}
.ch{display:grid;gap:6px;align-content:start;min-width:0}
.ch .nm{display:flex;align-items:center;gap:8px;font-weight:600;min-width:0}.ch .nm .nt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ch .mute{background:none;border:0;padding:4px;border-radius:6px;cursor:pointer;color:var(--text-3);display:grid;place-items:center}.ch .mute:hover{background:var(--raised);color:var(--text)}.ch .mute.m{color:#FF8A8E}
.ch .vol{display:flex;gap:10px;align-items:stretch;height:92px;cursor:ns-resize;touch-action:none;border-radius:6px}
.ch .vol .meter.v{height:100%;width:10px}
.ch .vol .fd{width:4px;border-radius:2px;background:var(--line-strong);position:relative;margin:4px 10px}
.ch .vol .fd::after{content:"";position:absolute;left:50%;top:var(--v,30%);width:22px;height:10px;border-radius:3px;background:#dfe7f2;transform:translate(-50%,-50%)}
.ch .db{font:600 11px var(--mono);color:var(--text-3)}
.right{display:grid;grid-template-rows:auto minmax(0,1fr) auto;gap:12px;min-height:0}.right>*{min-width:0}
.gs{display:grid;gap:10px;padding:12px;min-width:0}
.gs2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}
.clockbox .led{font-size:52px}.score-block .led{font-size:52px}
.score-block .nm .tn{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.pipbtn{background:none;border:0;padding:3px;border-radius:5px;cursor:pointer;display:flex;align-items:center;gap:6px}.pipbtn:hover{background:var(--raised)}
.pips.bonus i.on{background:var(--caution)}.score-block{position:relative}.bn2{position:absolute;left:12px;top:44px;font-size:11px;font-weight:800;letter-spacing:.07em;color:var(--caution)}
.bug .cl{display:flex;align-items:center}
.gs3{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.seg span{cursor:pointer}
.sponsor{display:grid;gap:10px;padding:12px 14px}
.cd{height:4px;border-radius:2px;background:var(--line-strong);overflow:hidden}.cd b{display:block;height:100%;width:0;background:var(--action)}
.health{display:flex;align-items:center;gap:14px;font-size:12px;color:var(--text-2)}
.health span{display:flex;align-items:center;gap:6px;white-space:nowrap}.health b{color:var(--text);font-weight:600}
.hx{display:flex;align-items:center;gap:8px;height:36px;padding:0 10px;border-radius:var(--r-ctl);background:var(--raised);border:1px solid var(--line-strong);font-size:12px;color:var(--text-2);cursor:pointer}
.hx b{color:var(--text);font-weight:600}
.pop{position:fixed;top:60px;right:16px;width:392px;z-index:45;box-shadow:var(--shadow-float);background:var(--raised)}
.pop .crow:last-child{border-bottom:0}
.topbar .pill{flex:none}#top-right{flex:none;white-space:nowrap}#pz{flex:none}
.hold{position:relative;overflow:hidden;height:32px}.hold .hp{position:absolute;left:0;top:0;bottom:0;width:100%;transform:scaleX(0);transform-origin:left;background:var(--program-fill);opacity:.55}
.hold.go .hp{transform:scaleX(1);transition:transform 1.5s linear}.hold .hl{position:relative;display:flex;align-items:center;gap:8px}
.feed img,.monitor img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.tile{cursor:pointer}.tile .ov span{font-size:12px}.tile .meta .nmx{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.monitor.off img{filter:grayscale(1) brightness(.4)}
.slate{position:absolute;inset:0;background:var(--ground);display:grid;place-items:center;text-align:center;padding:0 8%}
.slate .bar2{position:absolute;left:0;right:0;height:10%;display:flex}.slate .bar2.t{top:0}.slate .bar2.b{bottom:0}.slate .bar2 i{flex:1}
.slate h4{margin:0;font-size:clamp(14px,2vw,26px);line-height:1.15;font-weight:700;letter-spacing:-.01em}
.slate .vs{margin-top:10px;font-size:13px;font-weight:600;color:var(--text-2)}
.l3{position:absolute;left:3.5%;bottom:21%;max-width:80%;background:#fff;color:#0b1018;border-radius:4px;padding:6px 12px;box-shadow:0 4px 14px rgba(0,0,0,.5);border-left:5px solid var(--action)}
.l3 b{display:block;font-size:clamp(11px,1.4vw,17px);font-weight:800}.l3 span{font-size:clamp(10px,1.1vw,13px);font-weight:600;color:#33425b}
.spc{position:absolute;right:3%;top:12%;display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:5px;background:#fff;color:#0b1018;font-weight:800;font-size:clamp(10px,1.2vw,15px);box-shadow:0 4px 14px rgba(0,0,0,.5)}
.spc i{width:10px;height:10px;border-radius:3px}
.monitor.pgm .tag .i{color:#fff}
.modal.big{width:600px}.modal h2{margin:0}.cons .scrim{position:fixed;z-index:40}
.modal .rec{display:flex;align-items:center;gap:12px;height:44px;padding:0 12px;border-bottom:1px solid var(--line);cursor:pointer}
.modal .rec:last-child{border-bottom:0}.modal .rec .n{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.modal .rec .d{color:var(--text-3);width:84px}.modal .rec .z{width:72px;text-align:right}
.modal .lst{border:1px solid var(--line);border-radius:8px;background:var(--panel);max-height:260px;overflow:auto}
.modal .ft{display:flex;gap:10px;align-items:center;justify-content:flex-end}
.modal .kr{display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line)}
.input input{all:unset;flex:1;min-width:0}
.hidden{display:none!important}
@media (max-width:1500px){.health .hx2{display:none}.health{gap:10px}}
@media (max-width:1400px){
  .con{grid-template-columns:minmax(0,1fr) 400px}
  .left{grid-template-columns:minmax(0,1fr) 150px;grid-template-rows:auto auto auto auto;grid-template-areas:"m m" "s a" "c c" "g g";align-content:start}
  .mons{grid-area:m;gap:12px}.srcs{grid-area:s;gap:8px}.ctl{grid-area:c}.low{display:contents}.gfxp{grid-area:g}.audp{grid-area:a}
  .audp>.ph{display:none}.audp>.pb{padding:8px}.mix{gap:6px}.ch .nm .nt,.ch .db{display:none}.ch .vol{height:64px;gap:4px;justify-content:center}.ch .vol .fd{margin:4px 6px}
  .ch .nm{justify-content:center}.ch .nm .sp{display:none}.ch .vol .fd::after{width:16px}
  .gfx{grid-template-columns:repeat(3,1fr)}.gfx .btn,.gfx .select{height:36px;font-size:12px;padding:0 8px;gap:6px}
  .clockbox .led{font-size:44px}.score-block .led{font-size:44px}.ctl .btn.xl{width:auto!important}.ctl .kbd{display:none}.ctl{gap:8px}.ctl .btn.xl{padding:0 16px}.ch .nm>svg{display:none}
  #top-right{gap:10px}
}
@media (max-height:780px){
  .clockbox .led,.score-block .led{font-size:34px}.plus .btn{height:30px}.clockbox{padding:6px 14px}.score-block{padding:6px 12px;gap:4px}.bn2{top:36px}.sponsor{gap:6px;padding:8px 12px}.gs{gap:8px;padding:8px 12px}.ctl{height:64px}.ctl .btn.xl{height:48px}
}`;

function render(ctx) {
  const st = S.state;
  if (!st?.gameDoc) return html`<div class="empty" style="margin-top:80px"><svg class="i xl"><use href="#i-ball"/></svg><h2 class="t">No game is active</h2><div>Pick or create a game first, then come back to run the broadcast.</div><a class="btn pri" href="#/game/new">Set up a game</a></div>`;
  const sc = st.settings.shortcuts, kb = (a) => html`<span class="kbd">${keyLabel(sc[a] ?? "")}</span>`;
  const blk = (t) => html`<div class="score-block" data-team="${t}"><div class="nm"><i></i><span class="tn"></span><span class="sp"></span><button class="pipbtn" data-foul="${t}"><span class="bn2 hidden">BONUS</span><span class="pips"></span></button></div><div class="led" data-bind="game.${t}.score"></div><div class="plus">${[1, 2, 3].map((p) => html`<button class="btn" data-pts="${t}:${p}" title="${keyLabel(sc[t + "Plus" + p] ?? "")}">+${p}</button>`)}</div></div>`;
  return html`<div class="cons"><div class="bns" id="bns"></div>
 <div class="con"><section class="left">
  <div class="mons">
   <div class="monitor pvw"><img data-mon="pvw" alt=""><span class="tag">PREVIEW</span><span class="src" id="pvwsrc"></span></div>
   <div class="monitor pgm" id="pgm"><img data-mon="pgm" alt="">
    <div class="bug" id="bug"><div class="tm h"><i></i><span class="ha"></span></div><div class="sc" data-bind="game.home.score"></div><div class="sc" style="background:#e6ecf4" data-bind="game.away.score"></div><div class="tm a"><span class="aa"></span><i></i></div><div class="cl"><small class="pl"></small><span class="pn"></span><small style="margin:0 6px"> </small><span data-clock></span></div></div>
    <div class="l3 hidden" id="l3"><b></b><span></span></div><div class="spc hidden" id="spc"><i></i><span></span></div>
    <div class="slate hidden" id="slate"><div class="bar2 t"><i></i><i></i></div><div class="bar2 b"><i></i><i></i></div><div><h4></h4><div class="vs"></div></div></div>
    <span class="tag">${icon("rec", "sm")}PROGRAM</span><span class="src" id="pgmsrc"></span></div>
  </div>
  <div class="srcs" id="srcs"></div>
  <div class="panel ctl">
   <div class="grp"><button class="btn pri xl" id="cut" data-cut style="min-width:150px">${icon("cut", "lg")}<span class="lab">Cut</span> ${kb("cut")}</button>
    <button class="btn xl" id="fade" data-fade>${icon("fade", "lg")}Fade ${kb("fade")}</button></div>
   <div class="field" style="width:88px"><select class="select mono" id="fms" aria-label="Fade length" style="height:32px;appearance:auto"><option value="250">0.25 s</option><option value="500" selected>0.5 s</option><option value="1000">1 s</option><option value="2000">2 s</option></select></div>
   <span class="vr"></span>
   <div class="grp"><button class="btn xl" id="replay">${icon("replay", "lg")}Replay 10 s ${kb("replay")}</button>
    <div class="seg" id="spd" role="group" aria-label="Replay speed"><span class="on" tabindex="0" data-sp="1">1×</span><span tabindex="0" data-sp="0.5">½×</span><span tabindex="0" data-sp="0.25">¼×</span></div></div>
   <div class="sp"></div>
   <button class="btn lg" disabled title="Coming later">${icon("pip")}PiP</button>
  </div>
  <div class="low">
   <div class="panel gfxp"><div class="ph"><h3>Graphics</h3><span class="sp"></span><span class="faint" style="font-size:12px">Theme: ${st.settings.theme[0].toUpperCase() + st.settings.theme.slice(1)}</span></div>
    <div class="pb"><div class="gfx">
     <button class="btn" id="g-bug">${icon("eye")}Score bug <span class="st"></span></button>
     <button class="btn" data-five="home">${icon("users")}Starting five · Home</button>
     <select class="select" id="g-player" aria-label="Player lower third"></select>
     <button class="btn" data-five="away">${icon("users")}Starting five · Away</button>
     <button class="btn" id="g-slate">${icon("clock")}Halftime card <span class="st"></span></button>
     <button class="btn" id="g-spon">${icon("sponsor")}Sponsor corner <span class="st"></span></button>
    </div></div></div>
   <div class="panel audp"><div class="ph"><h3>Audio</h3></div><div class="pb"><div class="mix" id="mix"></div></div></div>
  </div>
 </section>
 <aside class="right">
  <div class="panel"><div class="ph"><h3>Game state</h3><span class="sp"></span>
    <span class="seg" id="per" role="group" aria-label="Period">${[1, 2, 3, 4, 5].map((p) => html`<span tabindex="0" data-per="${p}">${p === 5 ? "OT" : "Q" + p}</span>`)}</span></div>
   <div class="hidden" style="padding:10px 14px 0"><a class="chip" id="phones" href="#/settings/remote" style="text-decoration:none"></a></div>
   <div class="gs"><div class="clockbox"><span class="led" data-clock></span>
     <div class="col-g" style="gap:8px;align-items:flex-end"><button class="btn lg" id="clk" style="width:124px"></button>
      <div class="row" style="gap:6px"><button class="btn sm" data-nudge="-1000">−1s</button><button class="btn sm" data-nudge="1000">+1s</button></div></div></div>
    <div class="gs2">${blk("home")}${blk("away")}</div>
    <div class="gs3"><span class="lbl">Timeouts</span><span class="muted" data-ta="home"></span><button class="pipbtn" data-to="home"><span class="pips"></span></button><span class="muted" data-ta="away"></span><button class="pipbtn" data-to="away"><span class="pips"></span></button></div>
   </div></div>
  <div class="panel" style="min-height:0"><div class="ph"><h3>Events</h3><span class="sp"></span><button class="btn sm" id="mark">${icon("flag", "sm")}Mark moment ${kb("mark")}</button></div>
   <div class="scroll" style="flex:1" id="evs"></div></div>
  <div class="panel sponsor" id="spon"></div>
 </aside></div>
 <div id="modal"></div></div>`;
}

function bind(root, ctx) {
  const st0 = S.state;
  const tr = document.getElementById("top-right");
  if (!st0?.gameDoc) { root._onState = (state) => state.gameDoc && ctx.rerender(); return () => {}; }
  const $ = (s) => root.querySelector(s), $$ = (s) => [...root.querySelectorAll(s)];
  const sc = st0.settings.shortcuts;
  let skew = 0, speed = 1, popOpen = false, editing = false, lastAir = null, airKey = "", busy = false;
  const prevStatus = {}, dragging = {}, gainTimers = {};
  const cleanups = [];
  const nowMs = () => Date.now() + skew;
  const st = () => S.state;
  const eng = () => st().engine;
  const src = (id) => eng().sources.find((s) => s.id === id);
  const sig = (el, key, fn) => { if (el.dataset.sig !== key) { el.dataset.sig = key; fn(); } };
  const put = (el, h) => { el.innerHTML = h.s; };
  const text = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
  const cls = (el, c, on) => el.classList.toggle(c, !!on);
  const run = async (fn) => { try { return await fn(); } catch (e) { fail(e); } };

  // ---------------- actions
  const evt = (body, msg, undoable) => run(async () => { await api.post("/event", body); if (msg) toast(msg, undoable ? { label: "Undo", fn: undo } : undefined); });
  const undo = () => run(async () => { await api.post("/event", { type: "undo" }); toast("Undone"); });
  const teamName = (t) => st().game?.[t]?.name ?? t;
  const score = (team, points) => evt({ type: "score", team, points }, `${teamName(team)} +${points}`, true);
  const foul = (team) => evt({ type: "foul", team }, `Foul on ${teamName(team)}`, true);
  const timeout = (team) => evt({ type: "timeout", team }, `Timeout: ${teamName(team)}`, true);
  const toggleClock = () => evt({ type: st().game?.running ? "clock.stop" : "clock.start" });
  const nudge = (d) => evt({ type: "clock.set", ms: Math.max(0, Math.round(clockMs()) + d) }, d > 0 ? "Clock +1 s" : "Clock −1 s");
  const mark = () => evt({ type: "mark" }, "Moment marked");
  const programDown = () => { const e = eng(), p = src(e.program); return !!p && p.status !== "ok"; };
  const switchTarget = () => { const e = eng(), pv = src(e.preview); if (pv && pv.status === "ok" && pv.id !== e.program) return pv; return e.sources.find((s) => s.status === "ok" && s.id !== e.program); };
  const cut = () => run(async () => { if (programDown()) { const t = switchTarget(); if (!t) return toast("No other source is available yet."); if (eng().preview !== t.id) await api.post("/engine/preview", { sourceId: t.id }); } await api.post("/engine/cut"); });
  const fade = () => { if (programDown()) return; return run(() => api.post("/engine/fade", { ms: Number($("#fms").value) })); };
  const preview = (id) => run(() => api.post("/engine/preview", { sourceId: id }));
  const replay = (secondsBack) => run(async () => { await api.post("/replay", { secondsBack, speed }); toast(`Replaying the last ${secondsBack} s`); });
  const replayScore = () => { const e = [...st().events].reverse().find((x) => x.type === "score" && !undone().has(x.seq)); if (!e) return toast("No score to replay yet."); replay(replaySeconds(nowMs() - e.t)); };
  const graphics = (b) => run(() => api.post("/graphics", b));
  const undone = () => new Set(st().events.filter((e) => e.type === "undo").map((e) => e.target));
  const fire = (outcome) => run(async () => { const n = st().next; if (!n) return toast("No sponsor is due right now."); await api.post("/sponsors/fire", { sponsorId: n.sponsorId, ...(outcome ? { outcome } : {}) }); toast(outcome === "skipped" ? `${n.name} skipped` : outcome === "delayed" ? `${n.name} delayed` : `${n.name} is on air`); loadAir(); });
  const loadAir = () => api.get("/reports/airings?gameId=" + encodeURIComponent(st().gameId ?? "")).then((r) => { lastAir = r.rows.filter((x) => x.outcome === "aired").slice(0, 3); airKey = ""; patchSponsor(); }).catch(() => {});

  // ---------------- keyboard
  const onEnterGuard = (fn) => (e) => { const t = e.target; if (e.key === "Enter" && t.closest?.("button,[role=button],.tile") && !t.closest("[data-cut],[data-fade]")) return t.click(); fn(); };
  const H = {
    cut, fade, clock: toggleClock, replay: () => replay(10), replayScore, mark, fireSponsor: () => fire(), undo,
    ...Object.fromEntries([1, 2, 3, 4].map((n) => [`preview${n}`, () => { const s = eng().sources.find((x) => x.slot === n); if (s) preview(s.id); }])),
    ...Object.fromEntries(["home", "away"].flatMap((t) => [1, 2, 3].map((p) => [`${t}Plus${p}`, () => score(t, p)]))),
  };
  const map = { Escape: () => { closeModal(); }, "Shift+?": () => openKeys(), "?": () => openKeys() };
  for (const [a, k] of Object.entries(sc)) if (H[a] && k) map[normKey(k)] = onEnterGuard(H[a]);
  cleanups.push(keys(map));

  // ---------------- static click wiring (delegation; root content never re-rendered)
  root.addEventListener("click", (e) => {
    const t = e.target, b = (s) => t.closest(s);
    let x;
    if ((x = b("[data-src]"))) return preview(x.dataset.src);
    if ((x = b("[data-pts]"))) { const [tm, p] = x.dataset.pts.split(":"); return score(tm, +p); }
    if ((x = b("[data-foul]"))) return foul(x.dataset.foul);
    if ((x = b("[data-to]"))) return timeout(x.dataset.to);
    if ((x = b("[data-nudge]"))) return nudge(+x.dataset.nudge);
    if ((x = b("[data-per]"))) return evt({ type: "period.set", period: +x.dataset.per }, "Period set to " + period(+x.dataset.per));
    if ((x = b("[data-sp]"))) { speed = +x.dataset.sp; $$("#spd span").forEach((s) => cls(s, "on", s === x)); return; }
    if ((x = b("[data-five]"))) { const d = st().gameDoc, tm = d[x.dataset.five]; return graphics({ lower: { title: `Starting five · ${tm.name}`, sub: startingFive(tm.roster) } }); }
    if ((x = b("[data-replay]"))) return replay(+x.dataset.replay);
    if (b("#cut")) return cut();
    if (b("#fade")) return fade();
    if (b("#replay")) return replay(10);
    if (b("#clk")) return toggleClock();
    if (b("#mark")) return mark();
    if (b("#g-bug")) return graphics({ scorebug: !st().graphics.scorebug });
    if (b("#g-slate")) return graphics({ slate: st().graphics.slate ? null : "Halftime" });
    if (b("#g-spon")) return st().graphics.sponsor ? null : fire();
    if (b("#sp-fire")) return fire();
    if (b("#sp-skip")) return fire("skipped");
    if (b("#sp-delay")) return fire("delayed");
    if ((x = b("[data-mute]"))) { const ch = st().engine.mixer.find((m) => m.id === x.dataset.mute); return run(() => api.post("/engine/mute", { id: ch.id, muted: !ch.muted })); }
    if (b("#b-check")) { editing = !editing; return patchBanners(true); }
    if (b("#b-dismiss")) return run(() => api.post("/recovered/dismiss"));
    if (b("#b-clock-set")) { const m = +$("#ce-m").value, s = +$("#ce-s").value; if (!(m >= 0 && s >= 0 && s < 60)) return toast("Enter minutes and seconds, like 4 and 21."); editing = false; return evt({ type: "clock.set", ms: (m * 60 + s) * 1000 }, "Clock set to " + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0")).then(() => patchBanners(true)); }
    if (b("#b-clock-x")) { editing = false; return patchBanners(true); }
    if (b("#b-free")) return openFree();
  });
  root.addEventListener("change", (e) => {
    if (e.target.id === "g-player") { const [tm, i] = e.target.value.split(":"); if (!tm) return; const p = st().gameDoc[tm].roster[+i]; e.target.value = ""; if (p) graphics({ lower: { title: `#${p.number} ${p.name}`, sub: `${st().gameDoc[tm].name}${p.position ? " · " + p.position : ""}` } }); }
  });
  root.addEventListener("keydown", (e) => { if ((e.key === " " || e.key === "Enter") && e.target.matches?.("[data-sp],[data-per]")) { e.preventDefault(); e.stopPropagation(); e.target.click(); } if ((e.key === "Enter") && e.target.matches?.(".tile")) { e.preventDefault(); e.stopPropagation(); e.target.click(); } });

  // ---------------- faders
  const faderSet = (vol, y, flush) => {
    const r = vol.getBoundingClientRect(), v = 1 - Math.min(1, Math.max(0, (y - r.top - 4) / Math.max(1, r.height - 8)));
    setGain(vol.dataset.fd, posToGain(v), flush);
  };
  const setGain = (id, g, flush) => {
    const v = $(`[data-fd="${id}"]`); v.querySelector(".fd").style.setProperty("--v", (100 - gainToPos(g) * 100) + "%"); text(root.querySelector(`[data-db="${id}"]`), (g > 0 ? "+" : "") + g + " dB");
    v.setAttribute("aria-valuenow", g);
    clearTimeout(gainTimers[id]); delete gainTimers[id];
    const send = () => run(() => api.post("/engine/gain", { id, gainDb: g }));
    if (flush) send(); else gainTimers[id] = setTimeout(() => { delete gainTimers[id]; send(); }, 120);
  };
  root.addEventListener("pointerdown", (e) => { const v = e.target.closest?.(".vol"); if (!v) return; dragging[v.dataset.fd] = true; v.setPointerCapture(e.pointerId); faderSet(v, e.clientY); });
  root.addEventListener("pointermove", (e) => { const v = e.target.closest?.(".vol"); if (v && dragging[v.dataset.fd]) faderSet(v, e.clientY); });
  const endDrag = (e) => { const v = e.target.closest?.(".vol"); if (v && dragging[v.dataset.fd]) { dragging[v.dataset.fd] = false; } };
  root.addEventListener("pointerup", endDrag); root.addEventListener("pointercancel", endDrag);
  root.addEventListener("keydown", (e) => { const v = e.target.closest?.(".vol"); if (!v || !["ArrowUp", "ArrowDown"].includes(e.key)) return; e.preventDefault(); const m = st().engine.mixer.find((x) => x.id === v.dataset.fd); const cur = Number(v.getAttribute("aria-valuenow") ?? m.gainDb); setGain(v.dataset.fd, Math.min(GAIN_MAX, Math.max(GAIN_MIN, cur + (e.key === "ArrowUp" ? 1 : -1))), false); });

  // ---------------- images
  const loadInto = (img) => {
    const id = img.dataset.snap; if (!id || img._busy) return; img._busy = 1;
    const n = new Image(); n.onload = () => { img.src = n.src; img.style.visibility = ""; img._busy = 0; }; n.onerror = () => { img._busy = 0; img.style.visibility = "hidden"; };
    n.src = `/snap/${encodeURIComponent(id)}?t=${Date.now()}`;
  };
  const monT = setInterval(() => $$(".monitor img[data-snap]").forEach(loadInto), 250);
  const tileT = setInterval(() => $$(".tile img[data-snap]").forEach(loadInto), 1000);
  cleanups.push(() => { clearInterval(monT); clearInterval(tileT); });

  // ---------------- patchers
  const meter = (m, level) => {
    const n = +(m.dataset.n || 12), lv = Math.round(Math.max(0, Math.min(1, level)) * n);
    if (m.children.length !== n) m.innerHTML = "<i></i>".repeat(n);
    m.dataset.lv = lv;
    [...m.children].forEach((c, k) => { const k2 = k < lv ? (k > n * 0.85 ? "r" : k > n * 0.65 ? "y" : "g") : ""; if (c.className !== k2) c.className = k2; });
  };
  function patchMonitors() {
    const s = st(), e = s.engine, d = s.gameDoc, p = src(e.program), v = src(e.preview), down = programDown();
    const pi = $('img[data-mon="pvw"]'), gi = $('img[data-mon="pgm"]');
    const gp = e.graphicsInProgram; // OBS composes the overlay itself: show its program/preview output, with graphics, and draw none of our own
    const pvId = gp ? "preview" : e.preview ?? "", pgId = gp ? "program" : e.program ?? "";
    if (pi.dataset.snap !== pvId) { pi.dataset.snap = pvId; loadInto(pi); }
    if (gi.dataset.snap !== pgId) { gi.dataset.snap = pgId; loadInto(gi); }
    text($("#pvwsrc"), v ? `${v.slot} · ${v.label}` : "No source");
    const pgm = $("#pgm"), g = s.graphics;
    text($("#pgmsrc"), down ? `Slate · ${p.label} dropped` : p ? `${p.slot} · ${p.label}` : "No source");
    cls(pgm, "off", down);
    // score bug
    cls($("#bug"), "hidden", !g.scorebug || gp);
    text($("#bug .ha"), d.home.abbr); text($("#bug .aa"), d.away.abbr);
    $("#bug .tm.h i").style.background = d.home.color; $("#bug .tm.a i").style.background = d.away.color;
    const pr = s.game?.period ?? 1;
    text($("#bug .pl"), pr > 4 ? "OT" : "Q"); text($("#bug .pn"), pr > 4 ? (pr - 4 > 1 ? String(pr - 4) : "") : String(pr));
    // lower third
    cls($("#l3"), "hidden", !g.lower);
    if (g.lower) { text($("#l3 b"), g.lower.title); text($("#l3 span"), g.lower.sub); }
    // sponsor corner
    cls($("#spc"), "hidden", !g.sponsor || !s.settings.showSponsorCorner);
    if (g.sponsor) { text($("#spc span"), g.sponsor.name); $("#spc i").style.background = g.sponsor.color; }
    // slate
    const sl = $("#slate"), msg = down ? "Technical difficulties.\nWe'll be right back." : g.slate;
    cls(sl, "hidden", !msg);
    if (msg) {
      const [a, b] = msg.split("\n"); const h4 = sl.querySelector("h4"); if (h4.dataset.m !== msg) { h4.dataset.m = msg; h4.textContent = ""; h4.append(a); if (b) { h4.append(document.createElement("br"), b); } }
      text(sl.querySelector(".vs"), `${d.home.name} vs ${d.away.name}`);
      const bars = sl.querySelectorAll(".bar2"); bars.forEach((r) => { r.children[0].style.background = d.home.color; r.children[1].style.background = d.away.color; });
    }
  }
  function patchTiles() {
    const s = st(), e = s.engine;
    sig($("#srcs"), JSON.stringify(e.sources.map((x) => [x.id, x.slot, x.label, x.status])) + e.program + e.preview, () => {
      put($("#srcs"), html`${e.sources.slice(0, 4).map((x) => { const pg = x.id === e.program, pv = x.id === e.preview, off = x.status !== "ok";
        return html`<div class="tile ${pg ? "pgm" : pv ? "pvw" : ""} ${off ? "off" : ""}" data-src="${x.id}" role="button" tabindex="0" aria-label="Preview ${x.label}"><div class="feed"><img data-snap="${x.id}" alt=""></div><span class="k">${x.slot}</span>
          ${pg ? html`<span class="hd pill live noDot" style="height:18px;padding:0 7px;font-size:11px">On air</span>` : pv ? html`<span class="hd pill ready noDot" style="height:18px;padding:0 7px;font-size:11px">Next</span>` : ""}
          ${off ? html`<div class="ov">${icon("alert", "lg")}<span>Reconnecting…</span></div>` : ""}
          <div class="meta"><span class="dot ${off ? "warn" : "ok"}"></span><span class="nmx">${x.label}</span><div class="meter mt" data-n="10" data-aud="${x.id}" style="width:54px"></div></div></div>`; })}
        ${e.sources.length ? "" : html`<div class="muted" style="grid-column:1/-1;padding:12px">No video sources are connected. Add them in Check.</div>`}`);
      $$(".tile img").forEach(loadInto);
    });
    $$(".tile .meter").forEach((m) => meter(m, src(m.dataset.aud)?.audio ?? 0));
    for (const x of e.sources) { if (prevStatus[x.id] && prevStatus[x.id] !== "ok" && x.status === "ok") toast(`${x.label} is back`); prevStatus[x.id] = x.status; }
  }
  function patchControls() {
    const s = st(), e = s.engine, down = programDown(), t = switchTarget(), pv = src(e.preview);
    const cutB = $("#cut"), lab = cutB.querySelector(".lab");
    text(lab, down && t ? `Switch to ${t.label}` : "Cut");
    cutB.disabled = down ? !t : !!pv && pv.status !== "ok";
    cutB.title = cutB.disabled && !down ? "The preview source is reconnecting" : "";

    $("#fade").disabled = down || (!!pv && pv.status !== "ok");
    $("#fade").title = down ? "The program source is down" : "";
  }
  function patchGfx() {
    const g = st().graphics, d = st().gameDoc;
    const tog = (id, on, label) => { const b = $(id); cls(b, "on", on); text(b.querySelector(".st"), label); b.setAttribute("aria-pressed", !!on); };
    tog("#g-bug", g.scorebug, g.scorebug ? "ON" : "OFF"); tog("#g-slate", !!g.slate, g.slate ? "ON" : "");
    tog("#g-spon", !!g.sponsor, g.sponsor ? "ON AIR" : ""); $("#g-spon").disabled = !g.sponsor && !st().next; $("#g-spon").title = $("#g-spon").disabled ? "No sponsor break is due" : "Fire the next sponsor";
    const pl = $("#g-player");
    sig(pl, d.id + d.home.roster.length + d.away.roster.length, () => put(pl, html`<option value="">Player lower third…</option>${["home", "away"].map((t) => html`<optgroup label="${d[t].name}">${d[t].roster.map((p, i) => html`<option value="${t}:${i}">#${p.number} ${p.name}</option>`)}</optgroup>`)}`));
    const noRoster = !d.home.roster.length && !d.away.roster.length; pl.disabled = noRoster; pl.title = noRoster ? "Add a roster to use player graphics" : "";
    $$("[data-five]").forEach((b) => { const r = d[b.dataset.five].roster; b.disabled = !r.some((p) => p.starter); b.title = b.disabled ? "No starters marked in the roster" : ""; });
  }
  function patchMixer() {
    const mx = st().engine.mixer;
    sig($("#mix"), mx.map((m) => m.id + m.label).join(), () => put($("#mix"), html`${mx.map((m) => html`<div class="ch"><div class="nm">${icon(MIX_ICON[m.id] ?? "vol")}<span class="nt">${m.label}</span><span class="sp"></span><button class="mute" data-mute="${m.id}" aria-label="Mute ${m.label}" title="Mute ${m.label}"></button></div>
      <div class="vol" data-fd="${m.id}" role="slider" tabindex="0" aria-label="${m.label} level" aria-valuemin="${GAIN_MIN}" aria-valuemax="${GAIN_MAX}"><div class="meter v" data-n="18" data-aud="${m.id}"></div><div class="fd"></div></div><div class="db" data-db="${m.id}"></div></div>`)}`));
    for (const m of mx) {
      const mu = root.querySelector(`[data-mute="${m.id}"]`); const k = String(m.muted);
      if (mu.dataset.m !== k) { mu.dataset.m = k; mu.innerHTML = I(m.muted ? "mute" : "vol"); cls(mu, "m", m.muted); mu.setAttribute("aria-pressed", m.muted); }
      meter(root.querySelector(`.meter[data-aud="${m.id}"]`), m.muted ? 0 : m.level);
      if (!dragging[m.id] && !gainTimers[m.id]) { const v = root.querySelector(`[data-fd="${m.id}"]`); v.querySelector(".fd").style.setProperty("--v", (100 - gainToPos(m.gainDb) * 100) + "%"); v.setAttribute("aria-valuenow", m.gainDb); text(root.querySelector(`[data-db="${m.id}"]`), (m.gainDb > 0 ? "+" : "") + m.gainDb + " dB"); }
    }
  }
  const pips = (el, n, total, c) => { const k = n + "/" + total + c; if (el.dataset.k === k) return; el.dataset.k = k; el.className = "pips " + c; el.innerHTML = Array.from({ length: total }, (_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join(""); };
  function patchGame() {
    const s = st(), g = s.game, d = s.gameDoc, pr = s.settings.profile; if (!g) return;
    const clk = $("#clk"), run_ = g.running;
    sig(clk, String(run_), () => put(clk, html`${icon(run_ ? "pause" : "play")}${run_ ? "Stop" : "Start"} <span class="kbd">${keyLabel(sc.clock ?? "")}</span>`));
    $$("#per span").forEach((x) => { const p = +x.dataset.per; cls(x, "on", p === 5 ? g.period >= 5 : g.period === p); });
    for (const t of ["home", "away"]) {
      const b = $(`[data-team="${t}"]`), tm = g[t];
      text(b.querySelector(".tn"), d[t].name); b.querySelector(".nm i").style.background = d[t].color;
      const fo = b.querySelector(".pips"); pips(fo, tm.fouls, Math.max(pr.bonusAt, tm.fouls), tm.bonus ? "bonus" : "");
      cls(b.querySelector(".bn2"), "hidden", !tm.bonus);
      b.querySelector("[data-foul]").title = `Add a foul to ${d[t].name}. ${tm.fouls} this period${tm.bonus ? ", in the bonus" : ""}.`;
      b.querySelector("[data-foul]").setAttribute("aria-label", b.querySelector("[data-foul]").title);
      text($(`[data-ta="${t}"]`), tm.abbr); pips($(`[data-to="${t}"] .pips`), tm.timeouts, pr.timeouts, "");
      $(`[data-to="${t}"]`).title = `Use a timeout for ${d[t].name} (${tm.timeouts} left)`;
    }
  }
  const evGlyph = { score: ["score", "ball"], foul: ["foul", "whistle"], timeout: ["to", "timeout"], mark: ["mark", "mark"], "period.set": ["", "flag"] };
  function patchEvents() {
    const s = st(), d = s.gameDoc, un = undone();
    const list = s.events.filter((e) => evGlyph[e.type]).slice(-30).reverse();
    sig($("#evs"), list.map((e) => e.seq + (un.has(e.seq) ? "u" : "")).join() + s.game?.home.name, () => {
      const who = (e) => { const tm = e.team, p = e.player != null ? d[tm]?.roster.find((r) => String(r.number) === String(e.player)) : null; return p ? ` · #${p.number} ${p.name}` : e.player != null ? ` · #${e.player}` : ""; };
      put($("#evs"), list.length ? html`${list.map((e) => { const [c, ic] = evGlyph[e.type], u = un.has(e.seq), nm = e.team ? d[e.team].name : "";
        return html`<div class="ev ${c}" data-t="${e.t}" style="${u ? "opacity:.45" : ""}"><span class="t" style="width:auto;min-width:38px"></span><span class="g">${icon(ic)}</span>
          <span style="${u ? "text-decoration:line-through" : ""}">${e.type === "score" ? html`<b>${nm}</b> ${PTS[e.points]}${who(e)}` : e.type === "foul" ? html`<b>${nm}</b> foul${who(e)}` : e.type === "timeout" ? html`<b>${nm}</b> timeout` : e.type === "mark" ? html`Marked moment${e.note ? " · " + e.note : ""}` : html`Period set to ${period(e.period)}`}</span>
          ${u ? "" : html`<button class="btn sm ghost x" data-replay="${replaySeconds(Math.max(0, nowMs() - e.t))}" data-seq="${e.seq}" title="Replay this moment">${icon("replay", "sm")}Replay</button>`}</div>`; })}`
        : html`<div class="empty" style="padding:20px">Scores, fouls and timeouts will show up here.</div>`);
    });
    $$("#evs [data-replay]").forEach((b) => { const e = s.events.find((x) => x.seq === +b.dataset.seq); if (e) b.dataset.replay = replaySeconds(Math.max(0, nowMs() - e.t)); });
    $$("#evs .ev").forEach((r) => text(r.querySelector(".t"), rel(Math.max(0, nowMs() - +r.dataset.t))));
  }
  function patchSponsor() {
    const s = st(), n = s.next, a = s.graphics.sponsor, box = $("#spon");
    const last = lastAir === null ? "" : lastAir.length ? "Last aired · " + lastAir.map((r) => `${r.sponsorName} ${rel(nowMs() - r.at) === "now" ? "just now" : rel(nowMs() - r.at) + " ago"}`).join(" · ") : "Nothing has aired yet tonight";
    const k = JSON.stringify([n?.sponsorId, n?.trigger, !!a, a?.name, last.length ? last.replace(/ (\d+[smh] ago|just now)/g, "") : ""]);
    sig(box, k + airKey, () => put(box, html`<div class="row"><span class="lbl">Next sponsor break</span><span class="sp"></span>${n ? html`<span class="chip">${TRIG[n.trigger] ?? ""}</span>` : ""}</div>
      ${n ? html`<div class="row"><span class="logo-ph" style="background:${n.color}">${n.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</span><div style="min-width:0"><div style="font-weight:650;font-size:15px">${n.name}</div><div class="muted" style="font-size:12px">${n.seconds} s${n.assets[0] ? " " + n.assets[0].kind : ""}${a ? " · on air now" : ""}</div></div></div>
       ${a ? html`<div class="cd" aria-label="Time left on air"><b id="cd-b"></b></div>` : ""}
       <div class="row"><button class="btn pri" id="sp-fire" style="flex:1.3" ${a ? "disabled" : ""}>${icon("bolt")}Fire now <span class="kbd">${keyLabel(sc.fireSponsor ?? "")}</span></button><button class="btn" id="sp-skip">Skip</button><button class="btn" id="sp-delay">Delay</button></div>`
      : a ? html`<div class="row"><span class="logo-ph" style="background:${a.color}">${a.name.slice(0, 2).toUpperCase()}</span><div style="font-weight:650;font-size:15px">${a.name} <span class="muted" style="font-weight:500;font-size:12px">on air now</span></div></div><div class="cd"><b id="cd-b"></b></div>`
      : html`<div class="muted">No sponsor break is due. Sponsors show here at timeouts, period ends and halftime.</div>`}
      ${last ? html`<div class="faint" style="font-size:12px">${last}</div>` : ""}`));
  }
  function patchCountdown() {
    const a = S.state?.graphics.sponsor, b = root.querySelector("#cd-b"); if (!b || !a) return;
    b.style.width = Math.max(0, Math.min(100, ((a.until - nowMs()) / (a.seconds * 1000)) * 100)) + "%";
  }
  function patchBanners(force) {
    const s = st(), e = s.engine, g = s.game, d = s.gameDoc, bn = $("#bns"), items = [];
    const pre = !e.record.active && !e.stream.live;
    const low = e.diskFreeBytes < s.settings.lowSpaceGb * 1e9 && (e.record.active || e.diskFreeBytes > 0);
    const k = [!!s.recovered, editing, pre, e.stream.reconnecting, e.stream.destination, low && Math.floor(minutesLeft(e.diskFreeBytes) / 5)].join();
    sig(bn, k, () => put(bn, html`
      ${s.recovered ? html`<div class="banner ok">${icon("shield", "lg")}<span><b>We restored your game:</b> <span data-bind="game.period"></span> <span data-clock></span>, <span data-bind="game.home.score"></span>-<span data-bind="game.away.score"></span>. ${s.engine.record.active ? "Recording is still running." : "Recording stopped when the app closed. Press Start broadcast to record again."}</span><span class="sp"></span>
        <button class="btn pri sm" id="b-check">${icon("clock", "sm")}Check clock</button><button class="btn ghost sm" id="b-dismiss">${icon("x", "sm")}Dismiss</button></div>
        ${editing ? html`<div class="banner"><span>Set the game clock to match the scoreboard</span><span class="sp"></span><div class="input" style="width:70px"><input id="ce-m" inputmode="numeric" aria-label="Minutes" value="${Math.floor(clockMs() / 60000)}"></div>:<div class="input" style="width:70px"><input id="ce-s" inputmode="numeric" aria-label="Seconds" value="${String(Math.floor(clockMs() / 1000) % 60).padStart(2, "0")}"></div>
          <button class="btn pri sm" id="b-clock-set">Set clock</button><button class="btn ghost sm" id="b-clock-x">Cancel</button></div>` : ""}` : ""}
      ${e.stream.reconnecting ? html`<div class="banner warn">${icon("refresh", "lg")}<span><b>Reconnecting to ${e.stream.destination ?? "your destination"}…</b> recording is safe.</span></div>` : ""}
      ${low ? html`<div class="banner warn">${icon("disk", "lg")}<span><b>Recording space is low:</b> about ${minutesLeft(e.diskFreeBytes)} minutes left. Streaming is not affected.</span><span class="sp"></span><button class="btn pri sm" id="b-free">${icon("folder", "sm")}Free up space</button></div>` : ""}
      ${pre ? html`<div class="banner info">${icon("info", "lg")}<span><b>Not live yet.</b> <span class="sub">You can rehearse here. Nothing is streamed or recorded until you press Start broadcast.</span></span></div>` : ""}`));
    if (editing && force) setTimeout(() => $("#ce-m")?.focus(), 0);
  }

  // ---------------- top bar (health, live pill, end broadcast)
  function buildTop() {
    tr.innerHTML = `<div class="health" id="hl"></div><span id="pz" class="row" style="gap:10px"></span><span id="act"></span>`; tr.append(keyBtn);
    tr.onclick = async (ev) => {
      if (ev.target.closest("#hx")) { popOpen = !popOpen; return patchTop(); }
      if (ev.target.closest("#start")) { if (busy) return; busy = true; try { await api.post("/broadcast/start"); toast("You are live"); } catch (e) { fail(e); } busy = false; }
    };
  }
  const topEl = (s) => tr.querySelector(s);
  function patchTop() {
    const s = st(), e = s.engine, live = e.stream.live, rec = e.record.active, rc = e.stream.reconnecting;
    const hl = topEl("#hl"), dest = e.stream.destination ?? "Stream";
    const free = fmtBytes(e.diskFreeBytes), lowD = e.diskFreeBytes < s.settings.lowSpaceGb * 1e9;
    const hk = [rc, live, rec, dest, Math.round(e.stream.kbps / 100), e.stream.droppedFrames, free, Math.round(e.cpu), lowD, popOpen].join();
    sig(hl, hk, () => {
      put(hl, rc ? html`<button class="hx" id="hx" aria-expanded="${popOpen}"><span style="display:flex;align-items:center;gap:6px">${icon("wifioff")}<b>${dest}</b> disconnected</span>${icon("down", "d")}</button>`
        : html`<span>${icon("wifi")}${live ? html`<b class="tnum">${(e.stream.kbps / 1000).toFixed(1)}</b> Mbps<span class="hx2">&nbsp;· ${e.stream.droppedFrames} dropped</span>` : html`Not streaming`}</span>`);
      hl.insertAdjacentHTML("beforeend", html`${rc ? "" : html`<span>${icon("rec")}${rec ? "REC" : "Not recording"} <b class="tnum" ${lowD ? 'style="color:var(--caution)"' : ""}>${free}</b> free</span>`}<span class="hx2">${icon("cpu")}<b class="tnum">${Math.round(e.cpu)}%</b></span>`.s);
      hl.querySelector("svg use[href='#i-wifi']")?.closest("svg")?.setAttribute("style", `color:var(--${e.stream.droppedFrames > 50 ? "caution" : live ? "ready" : "text-3"})`);
      hl.querySelector("svg use[href='#i-rec']")?.closest("svg")?.setAttribute("style", `color:var(--${rec ? "program" : "text-3"})`);
    });
    const pk = rc ? "rc" : live ? "live" : rec ? "rec" : "pre";
    sig(topEl("#pz"), pk, () => put(topEl("#pz"), pk === "pre" ? html`` : html`${pk === "live" ? html`<span class="pill live">Live</span>` : pk === "rc" ? html`<span class="pill check">Reconnecting</span>` : html`<span class="pill info">Recording</span>`}<span class="mono" id="el" style="font-size:14px;font-weight:600"></span>`));
    sig(topEl("#act"), pk === "pre" ? "start" : "end", () => { put(topEl("#act"), pk === "pre" ? html`<button class="btn pri" id="start" style="height:36px">${icon("play")}Start broadcast</button>` : html`<button class="btn danger sm hold" id="endb" title="Press and hold for 1.5 seconds to end the broadcast"><i class="hp"></i><span class="hl">${icon("stop")}<span class="t">End broadcast</span></span></button>`); wireHold(); });
    tickElapsed();
    let pop = document.getElementById("hpop");
    if (rc && popOpen) {
      if (!pop) { pop = document.createElement("div"); pop.id = "hpop"; pop.className = "panel pop"; root.append(pop); }
      pop.innerHTML = html`<div class="ph"><h3>Connection health</h3></div>
        <div class="crow"><span class="st err">${icon("wifioff")}</span><div><div class="nm">${dest}</div><div class="rs">Disconnected · retrying automatically</div></div></div>
        <div class="crow"><span class="st ${rec ? "ok" : "warn"}">${icon("rec")}</span><div><div class="nm">${rec ? "Recording to this computer" : "Not recording"}</div><div class="rs">${rec ? "Safe" : "Start recording to keep a copy"} · ${free} free · about ${fmtMin(minutesLeft(e.diskFreeBytes))} left</div></div></div>
        <div class="crow"><span class="st warn">${icon("wifi")}</span><div><div class="nm">Upload</div><div class="rs"><span class="tnum">${(e.stream.kbps / 1000).toFixed(1)}</span> Mbps · ${e.stream.droppedFrames} dropped frames</div></div></div>`.s;
    } else pop?.remove();
  }
  const fmtMin = (m) => (m >= 120 ? Math.floor(m / 60) + " h" : m + " min");
  function tickElapsed() {
    const el = tr.querySelector("#el"); if (!el) return;
    const e = st().engine, t0 = e.stream.startedAt ?? e.record.startedAt;
    text(el, t0 ? fmtElapsed(Math.max(0, nowMs() - t0)) : "00:00:00");
  }
  // hold-to-end (1.5 s)
  function wireHold() {
    const b = tr.querySelector("#endb"); if (!b) return;
    let timer = null;
    const lab = b.querySelector(".t");
    const cancel = () => { clearTimeout(timer); timer = null; b.classList.remove("go"); lab.textContent = "End broadcast"; };
    const begin = () => { if (timer || busy) return; b.classList.add("go"); lab.textContent = "Keep holding…"; timer = setTimeout(done, 1500); };
    const done = async () => {
      cancel(); busy = true; lab.textContent = "Ending…";
      try { await api.post("/broadcast/stop"); const id = st().gameId; if (id) await api.post(`/games/${id}/finish`); go("/wrapup"); } catch (e) { fail(e); lab.textContent = "End broadcast"; }
      busy = false;
    };
    b.onpointerdown = (e) => { if (e.button === 0) { b.setPointerCapture?.(e.pointerId); begin(); } };
    b.onpointerup = b.onpointercancel = b.onpointerleave = cancel;
    b.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); if (!e.repeat) begin(); } };
    b.onkeyup = (e) => { if (e.key === "Enter" || e.key === " ") cancel(); };
    b.onblur = cancel;
    b.oncontextmenu = (e) => e.preventDefault();
  }

  // ---------------- modals: free up space, shortcuts
  const modal = () => $("#modal");
  function closeModal() { const m = modal(); m.onclick = m.onkeydown = m.oninput = null; m.innerHTML = ""; }
  function openKeys() {
    put(modal(), html`<div class="scrim" id="scrim"><div class="modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts"><div class="row"><h2 class="t">Keyboard shortcuts</h2><span class="sp"></span><button class="btn ghost sm" data-close>${icon("x", "sm")}Close</button></div>
      <div>${ACTIONS.filter(([a]) => sc[a]).map(([a, l]) => html`<div class="kr"><span>${l}</span><span class="kbd">${keyLabel(sc[a])}</span></div>`)}</div>
      <div class="hint">Change keys in Settings. Shortcuts pause while you type in a box.</div></div></div>`);
    modal().querySelector("[data-close]").focus();
  }
  async function openFree() {
    let recs, games;
    try { [recs, games] = await Promise.all([api.get("/recordings"), api.get("/games")]); } catch (e) { return fail(e); }
    const title = new Map(games.map((g) => [g.id, g.title]));
    const cur = st().gameId;
    const list = recs.filter((r) => r.endedAt && r.gameId !== cur).sort((a, b) => a.startedAt - b.startedAt);
    const sel = new Set();
    put(modal(), html`<div class="scrim"><div class="modal big" role="dialog" aria-modal="true" aria-label="Free up space"><div><h2 class="t">Free up space</h2><div class="muted" style="margin-top:4px">Old recordings on this computer. Tonight's game is not listed.</div></div>
      ${list.length ? html`<div class="lst">${list.map((r) => html`<div class="rec" data-rec="${r.id}" role="checkbox" aria-checked="false" tabindex="0"><span class="check"></span><span class="n">${title.get(r.gameId) ?? r.gameId}</span><span class="d">${fmtDate(r.startedAt)}</span><span class="z mono">${fmtBytes(r.bytes)}</span></div>`)}</div>`
        : html`<div class="empty">There are no older recordings to remove. Free space by moving files off this computer.</div>`}
      <div class="row"><span class="muted"><b style="color:var(--text)" id="fs-n">0 selected</b> · <span class="tnum" id="fs-z">0 MB</span> will be freed</span><span class="sp"></span><span class="chip">Highlights are kept</span></div>
      <div class="field" id="fs-f" style="display:none"><label for="fs-in">Type the oldest game's name to confirm: <b id="fs-name"></b></label><div class="input"><input id="fs-in" autocomplete="off" spellcheck="false"></div></div>
      <div class="ft"><button class="btn" data-close>Cancel</button><button class="btn danger dis" id="fs-del" disabled>${icon("xcircle")}Delete selected</button></div></div></div>`);
    const m = modal(), name = () => { const o = list.filter((r) => sel.has(r.id)).sort((a, b) => a.startedAt - b.startedAt)[0]; return o ? title.get(o.gameId) ?? o.gameId : ""; };
    const upd = () => {
      m.querySelector("#fs-n").textContent = sel.size + " selected";
      m.querySelector("#fs-z").textContent = fmtBytes(list.filter((r) => sel.has(r.id)).reduce((t, r) => t + r.bytes, 0));
      m.querySelector("#fs-f").style.display = sel.size ? "" : "none"; m.querySelector("#fs-name").textContent = name();
      const ok = sel.size > 0 && m.querySelector("#fs-in").value === name(); const d = m.querySelector("#fs-del"); d.disabled = !ok; d.classList.toggle("dis", !ok);
    };
    const toggle = (row) => { const id = row.dataset.rec; sel.has(id) ? sel.delete(id) : sel.add(id); row.setAttribute("aria-checked", sel.has(id)); const c = row.querySelector(".check"); c.classList.toggle("on", sel.has(id)); c.innerHTML = sel.has(id) ? I("check") : ""; upd(); };
    m.onclick = async (e) => {
      if (e.target.closest("[data-close]") || e.target.classList.contains("scrim")) return closeModal();
      const row = e.target.closest("[data-rec]"); if (row) return toggle(row);
      if (e.target.closest("#fs-del") && !m.querySelector("#fs-del").disabled) {
        const d = m.querySelector("#fs-del"); d.disabled = true; let n = 0;
        try { for (const id of sel) { await api.del("/recordings/" + encodeURIComponent(id)); n++; } toast(`Deleted ${n} recording${n === 1 ? "" : "s"}`); closeModal(); } catch (er) { fail(er); closeModal(); }
      }
    };
    m.onkeydown = (e) => { const row = e.target.closest?.("[data-rec]"); if (row && (e.key === " " || e.key === "Enter")) { e.preventDefault(); e.stopPropagation(); toggle(row); } };
    m.oninput = upd;
    upd();
  }
  root.addEventListener("click", (e) => { if (!modal().onclick && (e.target.closest("[data-close]") || e.target.classList.contains("scrim"))) closeModal(); });
  const keyBtn = document.createElement("button");
  keyBtn.className = "btn ghost sm"; keyBtn.id = "helpb"; keyBtn.title = "Keyboard shortcuts"; keyBtn.setAttribute("aria-label", "Keyboard shortcuts"); keyBtn.innerHTML = I("help");
  keyBtn.onclick = openKeys;

  // ---------------- wiring
  // phone remote chip: how many phones are connected, or who is asking to join (details in Settings > Remote)
  function patchPhones(r) {
    const el = $("#phones"); if (!el) return;
    const ask = r?.pending?.[0], n = r?.connected ?? 0, k = ask ? "p" + ask.id : "n" + n + (r?.locked ? "l" : "");
    el.parentElement.classList.toggle("hidden", !ask && !n); if (el.dataset.k === k) return; el.dataset.k = k;
    el.className = "chip " + (ask ? "warn" : "ok");
    el.innerHTML = ask ? `${icon("phone", "sm").s}${esc(ask.name)} wants to connect` : `${icon("phone", "sm").s}${n} phone${n === 1 ? "" : "s"}${r?.locked ? " (locked)" : ""}`;
    el.title = ask ? "Allow or deny this phone in Settings > Remote" : "Phone remote connected";
  }
  const onState = (state) => {
    skew = state.serverNow - Date.now();
    if (!state.gameDoc) return ctx.rerender();
    patchBanners(); patchMonitors(); patchTiles(); patchControls(); patchGfx(); patchMixer(); patchGame(); patchEvents(); patchSponsor(); patchTop(); patchCountdown(); patchPhones(state.remote);
  };
  buildTop();
  skew = st0.serverNow - Date.now();
  onState(st0);
  loadAir();
  root._onState = onState;
  const sec = setInterval(() => { tickElapsed(); $$("#evs .ev").forEach((r) => text(r.querySelector(".t"), rel(Math.max(0, nowMs() - +r.dataset.t)))); }, 1000);
  const cdT = setInterval(patchCountdown, 200);
  const poll = setInterval(() => { if (popOpen) patchTop(); }, 1000);
  return () => { cleanups.forEach((f) => f()); clearInterval(sec); clearInterval(cdT); clearInterval(poll); Object.values(gainTimers).forEach(clearTimeout); keyBtn.remove(); if (tr) { tr.innerHTML = ""; tr.onclick = null; } document.getElementById("hpop")?.remove(); };
}

export default {
  shell: "night", step: 3, css,
  render, bind,
  onState(root, state) { root._onState?.(state); },
};
