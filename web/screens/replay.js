// Replay and events (route /replay). Spec: 10-ui-design-spec.md 5.9, frame design/screens/09-replay-events.html
import { html, raw, icon, api, S, toast, fail, go, mmss, fmtElapsed, period, clockMs } from "../app.js";

/** Pure: game-clock position (period + remaining ms) at the moment event `seq` was logged, by replaying clock events. */
export function clockAtEvent(log, seq, prof = { periods: 4, periodMs: 480000, overtimeMs: 240000 }) {
  let p = 1, ms = prof.periodMs, running = false, since = 0;
  const at = (t) => (running ? Math.max(0, ms - (t - since)) : ms);
  for (const e of log) {
    if (e.seq === seq) return { period: p, clockMs: at(e.t) };
    switch (e.type) {
      case "game.start": p = 1; ms = prof.periodMs; running = false; break;
      case "clock.start": if (!running) { running = true; since = e.t; } break;
      case "clock.stop": if (running) { ms = at(e.t); running = false; } break;
      case "clock.set": ms = Math.max(0, e.ms); since = e.t; break;
      case "period.set": p = e.period; running = false; ms = e.period > prof.periods ? prof.overtimeMs : prof.periodMs; break;
    }
  }
  return null;
}

const KINDS = { score: ["score", "ball", "Score"], foul: ["foul", "whistle", "Foul"], timeout: ["to", "timeout", "Timeout"], mark: ["mark", "mark", "Marked"] };
const FILTERS = [["all", "All"], ["score", "Score"], ["foul", "Foul"], ["timeout", "Timeout"], ["mark", "Mark"]];
const hlKey = (gameId) => `fieldhouse.highlights.${gameId}`;
export const loadHighlightSeqs = (gameId) => { try { return JSON.parse(localStorage.getItem(hlKey(gameId)) || "[]"); } catch { return []; } };
const saveHighlightSeqs = (gameId, a) => { try { localStorage.setItem(hlKey(gameId), JSON.stringify(a)); } catch { /* storage blocked: the toast below still tells the operator */ } };

// Module state: survives redraws.
const M = { sel: null, filter: "all", per: null, pre: 10, post: 5, angle: null, speed: 1, seen: 0, play: null, stopTimer: null, gameId: null };

const prof = () => { const p = S.state?.settings?.profile; return p ? { periods: p.periods, periodMs: p.periodMin * 60000, overtimeMs: p.overtimeMin * 60000 } : undefined; };
const axisMs = (per, pr) => (per > pr.periods ? pr.overtimeMs : pr.periodMs);

function build(log) {
  const pr = prof() || { periods: 4, periodMs: 480000, overtimeMs: 240000 };
  const undone = new Set(log.filter((e) => e.type === "undo").map((e) => e.target));
  const gd = S.state?.gameDoc;
  const name = (t) => gd?.[t]?.name || S.state?.game?.[t]?.name || (t === "home" ? "Home" : "Away");
  const who = (e) => { const pl = e.player !== undefined && gd?.[e.team]?.roster.find((r) => String(r.number) === String(e.player)); return e.player === undefined ? "" : ` · #${e.player}${pl ? " " + pl.name.split(" ").pop() : ""}`; };
  const evs = [];
  for (const e of log) {
    if (undone.has(e.seq) || !KINDS[e.type]) continue;
    const c = clockAtEvent(log, e.seq, pr);
    if (!c) continue;
    const shot = e.type === "score" ? (e.points === 3 ? "3-pointer" : e.points === 2 ? "basket" : "free throw") : "";
    const text = e.type === "score" ? { team: e.team, rest: `${shot}${who(e)}` } : e.type === "foul" ? { team: e.team, rest: `foul${who(e)}` } : e.type === "timeout" ? { team: e.team, rest: "timeout" } : { rest: e.note || "Marked moment" };
    evs.push({ ...e, per: c.period, clock: c.clockMs, title: shot ? shot[0].toUpperCase() + shot.slice(1) : e.type === "foul" ? "Foul" : e.type === "timeout" ? "Timeout" : "Marked moment", teamName: text.team ? name(text.team) : "", text: text.rest, color: e.team === "home" ? "var(--home)" : e.team === "away" ? "var(--away)" : null });
  }
  return { evs, pr };
}

const glyph = (k, size) => html`<span class="g" ${size ? raw(`style="width:${size}px;height:${size}px"`) : ""}>${icon(KINDS[k][1])}</span>`;

export default {
  shell: "night",
  step: 3,
  css: `
.rp{display:grid;grid-template-columns:minmax(0,1fr) 440px;gap:16px;height:100%}
.rp .lc{display:grid;grid-template-rows:auto minmax(0,1fr);gap:16px;min-width:0;min-height:0}
.rp .top2{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:16px;min-width:0}
.rp .tr{display:flex;align-items:center;gap:10px;margin-top:10px;min-width:0}
.rp .tr .btn{width:40px;padding:0}
.rp .monitor img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.rp .clip{display:flex;flex-direction:column;gap:12px;padding:14px;min-width:0}
.rp .io{display:grid;grid-template-columns:36px minmax(0,1fr) auto auto;gap:6px;align-items:center}
.rp .io .mono{font-size:15px;font-weight:600}
.rp .io .btn{width:44px;padding:0}
.rp .seg span{cursor:pointer}
.rp .tl{display:grid;grid-template-columns:104px minmax(0,1fr);grid-template-rows:28px repeat(4,minmax(0,1fr));flex:1;min-height:0;position:relative}
.rp .tl .lab{display:flex;align-items:center;gap:8px;padding:0 12px 0 14px;border-top:1px solid var(--line);font-weight:600;font-size:12.5px;color:var(--text-2)}
.rp .tl .lab b{margin-left:auto;font-weight:600;color:var(--text-3);font-variant-numeric:tabular-nums}
.rp .tl .lane{position:relative;border-top:1px solid var(--line)}
.rp .tl .axis{position:relative;font:11px/28px var(--mono);color:var(--text-3)}
.rp .tl .axis span{position:absolute;top:0;transform:translateX(-50%)}
.rp .tl .axis span:first-child{transform:none}.rp .tl .axis span:last-child{transform:translateX(-100%)}
.rp .tl .ev{position:absolute;top:50%;transform:translate(-50%,-50%);padding:0;border:0;flex-direction:column;gap:3px;background:none;cursor:pointer;color:inherit}
.rp .tl .ev .g{width:26px;height:26px}.rp .tl .ev .g .i{width:15px;height:15px}
.rp .tl .ev .td{width:7px;height:7px;border-radius:50%}
.rp .tl .ev.sel .g{outline:2px solid var(--action-hi);outline-offset:2px}
.rp .ov{position:absolute;left:104px;right:0;top:0;bottom:0;pointer-events:none;overflow:hidden}
.rp .ov .gl{position:absolute;top:28px;bottom:0;width:1px;background:var(--line)}
.rp .ov .fut{position:absolute;top:28px;bottom:0;right:0;background:var(--inset);opacity:.78;display:grid;place-items:center;color:var(--text-3);font-size:12.5px}
.rp .ov .rng{position:absolute;top:28px;bottom:0;background:rgba(61,139,253,.18)}
.rp .ov .hd2{position:absolute;top:28px;bottom:0;width:2px;background:var(--action-hi)}
.rp .ov .hd2::before{content:"";position:absolute;top:-2px;left:-4px;width:10px;height:18px;border-radius:3px;background:var(--action-hi)}
.rp .ov .ph2{position:absolute;top:2px;bottom:0;width:2px;background:var(--text);margin-left:-1px}
.rp .ov .ph2::before{content:"";position:absolute;top:0;left:-5px;border:6px solid transparent;border-top-color:var(--text);border-bottom:0;width:12px}
.rp .evl .ev{height:44px;padding:0 14px;min-width:0;cursor:pointer}
.rp .evl .ev .tx{min-width:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rp .evl .ev.cur{background:var(--action-wash)}
.rp .evl .gl2{padding:8px 14px 6px;background:var(--inset);border-bottom:1px solid var(--line)}
.rp .select select{appearance:none;background:none;border:0;color:inherit;font:inherit;flex:1;min-width:0;outline:none;cursor:pointer}
.rp .select select option{background:var(--raised)}
.rp .select:focus-within{border-color:var(--action);box-shadow:0 0 0 3px rgba(61,139,253,.25)}
.rp .empty-tl{display:grid;place-items:center;flex:1;color:var(--text-2);padding:24px;text-align:center}
`,

  async load() {
    const log = await api.get("/log");
    return { log };
  },

  render(ctx, data) {
    const { evs, pr } = build(data.log);
    const g = S.state?.game, gameId = S.state?.gameId;
    if (M.gameId !== gameId) Object.assign(M, { gameId, sel: null, per: null, filter: "all" });
    M.seen = S.state?.events.at(-1)?.seq ?? 0;
    const anyPlayable = evs.length > 0;
    if (!evs.find((e) => e.seq === M.sel)) M.sel = (evs.filter((e) => e.type === "score").at(-1) || evs.at(-1))?.seq ?? null;
    const sel = evs.find((e) => e.seq === M.sel);
    const per = M.per ?? sel?.per ?? g?.period ?? 1;
    const maxPer = Math.max(pr.periods, g?.period ?? 1, ...evs.map((e) => e.per));
    const ax = axisMs(per, pr);
    const pct = (ms) => Math.max(0, Math.min(100, (1 - ms / ax) * 100));
    const inPer = evs.filter((e) => e.per === per);
    const sources = S.state?.engine.sources ?? [];
    if (!sources.find((s) => s.id === M.angle)) M.angle = S.state?.engine.program ?? sources[0]?.id ?? null;
    const prog = S.state?.engine.program;
    const angleSrc = sources.find((s) => s.id === M.angle);
    const speedLbl = { 1: "1×", 0.5: "½×", 0.25: "¼×" };
    const saved = new Set(loadHighlightSeqs(gameId));
    const ticks = Array.from({ length: 7 }, (_, i) => i);
    const lane = (k) => inPer.filter((e) => e.type === k);
    const listAll = evs.filter((e) => M.filter === "all" || e.type === M.filter).sort((a, b) => b.seq - a.seq);
    const pers = [...new Set(listAll.map((e) => e.per))].sort((a, b) => b - a);
    const live = S.state?.engine.stream.live;
    const len = M.pre + M.post;

    return html`<div class="rp">
      <section class="lc">
        <div class="top2">
          <div style="min-width:0">
            <div class="monitor" id="rp-mon">
              ${prog ? html`<img id="rp-img" alt="Program output" src="/snap/${prog}?t=${Date.now()}">` : html`<div class="feed center"></div>`}
              <span class="tag" id="rp-tag" style="${S.state?.engine.replay.active ? "background:var(--action)" : ""}">${S.state?.engine.replay.active ? icon("replay", "sm") : ""}${S.state?.engine.replay.active ? "REPLAY" : "PROGRAM"}</span><span class="src">${angleSrc ? `${angleSrc.slot} · ${angleSrc.label} · ` : ""}${speedLbl[M.speed]}</span></div>
            <div class="tr">
              <button class="btn" id="rp-play" aria-label="${S.state?.engine.replay.active ? "Stop replay" : "Play to program"}" ${anyPlayable ? "" : "disabled"}>${icon(S.state?.engine.replay.active ? "stop" : "play")}</button>
              <span class="mono muted" style="font-size:12.5px" id="rp-t0">0:00</span><div class="slider" id="rp-slider" style="--v:0%"><b style="width:0%"></b></div><span class="mono muted" style="font-size:12.5px">0:${String(Math.round(len / M.speed)).padStart(2, "0")}</span>
              <div class="seg" id="rp-speed">${[1, 0.5, 0.25].map((s) => html`<span data-speed="${s}" class="${M.speed === s ? "on" : ""}" role="button" tabindex="0">${speedLbl[s]}</span>`)}</div>
            </div>
          </div>
          <div class="panel clip">
            ${sel ? html`
            <div class="col-g" style="gap:6px">
              <div class="row" style="gap:8px"><span class="ev ${KINDS[sel.type][0]}" style="padding:0;border:0">${glyph(sel.type)}</span><b style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${sel.title}</b><span class="sp"></span><span class="led" style="font-size:20px">${mmss(sel.clock)}</span></div>
              <span class="muted" style="font-size:12.5px">${sel.teamName ? html`<b style="color:var(--text)">${sel.teamName}</b> · ` : ""}${sel.type === "mark" ? sel.text : sel.text.replace(/^[^·]*· ?/, "") || period(sel.per)} · ${period(sel.per)}</span>
            </div>
            <hr class="hr">
            <div class="io">
              <span class="lbl">In</span><span class="mono">${mmss(sel.clock + M.pre * 1000)}</span><button class="btn sm" data-io="pre:1" aria-label="In point 1 second earlier">−1s</button><button class="btn sm" data-io="pre:-1" aria-label="In point 1 second later">+1s</button>
              <span class="lbl">Out</span><span class="mono">${mmss(Math.max(0, sel.clock - M.post * 1000))}</span><button class="btn sm" data-io="post:-1" aria-label="Out point 1 second earlier">−1s</button><button class="btn sm" data-io="post:1" aria-label="Out point 1 second later">+1s</button>
            </div>
            <div class="field"><span class="fl">Angle</span><div class="select">${icon("video")}<select id="rp-angle" aria-label="Angle">${sources.map((s) => html`<option value="${s.id}" ${s.id === M.angle ? "selected" : ""}>${s.slot} · ${s.label}</option>`)}</select></div></div>
            <div class="row" style="gap:8px"><span class="muted">Clip length</span><span class="sp"></span><span class="mono" style="font-weight:600">${len} s</span></div>
            <div class="sp"></div>
            <button class="btn pri lg" id="rp-go" style="width:100%">${icon("play")}Play to program</button>
            <button class="btn lg" id="rp-save" style="width:100%">${icon("star")}${saved.has(sel.seq) ? "Saved to highlights" : "Save to highlights"}</button>` : html`
            <div class="empty" style="padding:12px">${icon("replay", "xl")}<b>No moment selected</b><span>Pick an event on the timeline to set up a replay.</span></div>`}
          </div>
        </div>

        <div class="panel">
          <div class="ph"><h3>Timeline</h3><span class="muted" style="font-size:12px">Game clock, counting down</span><span class="sp"></span>
            <div class="seg" id="rp-per">${Array.from({ length: maxPer }, (_, i) => html`<span data-per="${i + 1}" class="${per === i + 1 ? "on" : ""}" role="button" tabindex="0">${period(i + 1)}</span>`)}</div></div>
          ${!evs.length ? html`<div class="empty-tl"><div class="col-g" style="align-items:center;gap:8px">${icon("flag", "xl")}<b>No events yet</b><span>Marks appear here as the game is played.</span></div></div>` : html`
          <div class="pb" style="display:flex;padding:0 14px 0 0">
            <div class="tl">
              <div></div>
              <div class="axis">${ticks.map((i) => html`<span style="left:${(i / 6) * 100}%">${mmss(ax * (1 - i / 6))}</span>`)}</div>
              ${["score", "foul", "timeout", "mark"].map((k) => html`
                <div class="lab"><span class="ev ${KINDS[k][0]}" style="position:static;transform:none;display:block;padding:0;border:0">${glyph(k, 22)}</span>${KINDS[k][2]}<b>${lane(k).length}</b></div>
                <div class="lane">${lane(k).map((e) => html`<button class="ev ${KINDS[k][0]} ${e.seq === M.sel ? "sel" : ""}" data-seq="${e.seq}" style="left:${pct(e.clock)}%" aria-label="${e.title} at ${mmss(e.clock)}">${glyph(k)}${e.color ? html`<i class="td" style="background:${raw(e.color)}"></i>` : ""}</button>`)}</div>`)}
              <div class="ov">
                ${[1, 2, 3, 4, 5].map((i) => html`<i class="gl" style="left:${(i / 6) * 100}%"></i>`)}
                ${(() => { if (!g) return ""; const played = g.period === per ? pct(clockMs()) : g.period < per ? 0 : 100; return played >= 100 ? "" : html`<div class="fut" style="left:${played}%">Not played yet</div>`; })()}
                ${sel && sel.per === per ? html`<div class="rng" style="left:${pct(sel.clock + M.pre * 1000)}%;width:${Math.max(0.4, pct(Math.max(0, sel.clock - M.post * 1000)) - pct(sel.clock + M.pre * 1000))}%"></div><i class="hd2" style="left:${pct(sel.clock + M.pre * 1000)}%"></i><i class="hd2" style="left:${pct(Math.max(0, sel.clock - M.post * 1000))}%"></i><i class="ph2" style="left:${pct(sel.clock)}%"></i>` : ""}
              </div>
            </div>
          </div>`}
        </div>
      </section>

      <aside class="panel evl">
        <div class="ph"><h3>Events</h3><span class="sp"></span><span class="chip">${inPer.length} in ${period(per)}</span><button class="btn sm" id="rp-mark">${icon("flag", "sm")}Mark moment</button></div>
        <div style="padding:10px 14px;border-bottom:1px solid var(--line)"><div class="seg" id="rp-filter">${FILTERS.map(([k, l]) => html`<span data-f="${k}" class="${M.filter === k ? "on" : ""}" role="button" tabindex="0">${l}</span>`)}</div></div>
        <div class="scroll" style="flex:1">
          ${!listAll.length ? html`<div class="empty">${icon("flag", "xl")}<b>${evs.length ? "Nothing in this filter" : "No events yet"}</b><span>${evs.length ? "Try another filter." : "Marks appear here as the game is played."}</span></div>` : pers.map((p) => html`
            <div class="gl2 lbl">${period(p)}</div>
            ${listAll.filter((e) => e.per === p).map((e) => html`<div class="ev ${KINDS[e.type][0]} ${e.seq === M.sel ? "cur" : ""}" data-pick="${e.seq}" role="button" tabindex="0"><span class="t">${mmss(e.clock)}</span>${glyph(e.type)}<span class="tx">${e.teamName ? html`<b>${e.teamName}</b> ` : ""}${e.text}</span><button class="btn sm ${e.seq === M.sel ? "" : "ghost"}" data-replay="${e.seq}">${icon("replay", "sm")}Replay</button></div>`)}`)}
        </div>
      </aside>
    </div>`;
  },

  bind(root, ctx, data) {
    const { evs } = build(data.log);
    const sel = () => evs.find((e) => e.seq === M.sel);
    const setSel = (seq) => { M.sel = seq; const e = evs.find((x) => x.seq === seq); if (e) M.per = e.per; ctx.redraw(); };

    // header: Live pill, elapsed, back link
    const tr = document.getElementById("top-right");
    const eng = () => S.state?.engine;
    if (tr) {
      tr.innerHTML = html`${eng()?.stream.live ? html`<span class="pill live">Live</span><span class="mono" id="rp-el" style="font-size:14px;font-weight:600">00:00:00</span>` : ""}<button class="btn ghost sm" id="rp-back" style="height:32px">${icon("left")}Back to console</button>`.s;
      tr.querySelector("#rp-back").onclick = () => go("/live");
    }

    async function play(e) {
      if (!e) return;
      const inWall = e.t - M.pre * 1000;
      const secondsBack = Math.max(1, Math.ceil((Date.now() - inWall) / 1000));
      try {
        await api.post("/replay", { secondsBack, speed: M.speed });
        clearTimeout(M.stopTimer);
        const dur = (M.pre + M.post) / M.speed;
        M.play = { t0: performance.now(), dur: dur * 1000 };
        // The engine plays from the in-point up to live; stop at the out-point ourselves.
        M.stopTimer = setTimeout(() => api.post("/replay/stop").catch(() => {}), dur * 1000);
      } catch (err) { fail(err); }
    }
    async function stop() { clearTimeout(M.stopTimer); M.play = null; try { await api.post("/replay/stop"); } catch (err) { fail(err); } }

    const click = (ev) => {
      const t = ev.target;
      let el;
      if ((el = t.closest("[data-replay]"))) { ev.stopPropagation(); M.sel = +el.dataset.replay; const e = sel(); if (e) M.per = e.per; play(e); ctx.redraw(); return; }
      if ((el = t.closest("[data-seq]"))) return setSel(+el.dataset.seq);
      if ((el = t.closest("[data-pick]"))) return setSel(+el.dataset.pick);
      if ((el = t.closest("[data-f]"))) { M.filter = el.dataset.f; return ctx.redraw(); }
      if ((el = t.closest("[data-per]"))) { M.per = +el.dataset.per; return ctx.redraw(); }
      if ((el = t.closest("[data-speed]"))) { M.speed = +el.dataset.speed; return ctx.redraw(); }
      if ((el = t.closest("[data-io]"))) {
        const [k, d] = el.dataset.io.split(":"), v = M[k] + +d;
        if (v < 1 || v > 60) return toast(k === "pre" ? "The in point can be 1 to 60 seconds before the moment." : "The out point can be 1 to 60 seconds after the moment.");
        M[k] = v; return ctx.redraw();
      }
      if (t.closest("#rp-play")) return S.state?.engine.replay.active ? stop() : play(sel());
      if (t.closest("#rp-go")) return play(sel());
      if (t.closest("#rp-save")) {
        const e = sel(); if (!e) return;
        const cur = new Set(loadHighlightSeqs(M.gameId));
        cur.has(e.seq) ? cur.delete(e.seq) : cur.add(e.seq);
        saveHighlightSeqs(M.gameId, [...cur]);
        toast(cur.has(e.seq) ? "Saved to highlights. It will be in the post-game builder." : "Removed from highlights.");
        return ctx.redraw();
      }
      if (t.closest("#rp-mark")) return api.post("/event", { type: "mark" }).then(() => toast("Moment marked.")).catch(fail);
    };
    const key = (ev) => { if ((ev.key === "Enter" || ev.key === " ") && ev.target.matches("[role=button]")) { ev.preventDefault(); ev.target.click(); } };
    const change = (ev) => { if (ev.target.id === "rp-angle") { M.angle = ev.target.value; ctx.redraw(); } };
    root.addEventListener("click", click); root.addEventListener("keydown", key); root.addEventListener("change", change);

    // ~2 fps program monitor + replay progress + elapsed
    const tick = setInterval(() => {
      const img = root.querySelector("#rp-img"), p = eng()?.program;
      if (img && p) img.src = `/snap/${p}?t=${Date.now()}`;
      const sl = root.querySelector("#rp-slider");
      if (sl) {
        const f = M.play && eng()?.replay.active ? Math.min(1, (performance.now() - M.play.t0) / M.play.dur) : 0;
        sl.style.setProperty("--v", f * 100 + "%"); sl.firstElementChild.style.width = f * 100 + "%";
        root.querySelector("#rp-t0").textContent = "0:" + String(Math.round((f * M.play?.dur || 0) / 1000)).padStart(2, "0");
      }
      const el = document.getElementById("rp-el"), s = eng()?.stream;
      if (el && s?.startedAt) el.textContent = fmtElapsed(Date.now() - s.startedAt);
    }, 500);
    return () => { clearInterval(tick); root.removeEventListener("click", click); root.removeEventListener("keydown", key); root.removeEventListener("change", change); if (tr) tr.innerHTML = ""; };
  },

  async onState(root, st, ctx, data) {
    const tag = root.querySelector("#rp-tag");
    const active = st.engine.replay.active;
    if (tag && tag.textContent.includes("REPLAY") !== active) return ctx.redraw();
    const last = st.events.at(-1)?.seq ?? 0;
    if (last !== M.seen) { M.seen = last; try { data.log = await api.get("/log"); ctx.redraw(); } catch { /* next push retries */ } }
  },
};
