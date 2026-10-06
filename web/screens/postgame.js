// Post-game wrap-up (route /wrapup). Spec: 10-ui-design-spec.md 5.12, frame design/screens/12-post-game.html
import { html, raw, esc, icon, api, S, toast, fail, go, fmtBytes, fmtDate, period, mmss } from "../app.js";
import { clockAtEvent, loadHighlightSeqs } from "./replay.js";

const dur = (ms) => { const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`; };
const base = (p) => String(p || "").split(/[\\/]/).pop();
const dirOf = (p) => String(p || "").replace(/[\\/][^\\/]*$/, "");
const PLAYED = new Set(["score", "foul", "timeout", "mark"]);
const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

// Module state: survives redraws.
const P = { order: [], on: new Set(), key: "", title: true, exp: null, busy: false, vt: 0, playing: false, vfail: false };

export default {
  shell: "night",
  step: 4,
  css: `
.pg{display:grid;grid-template-columns:minmax(0,1fr) 440px;gap:16px;height:100%}
.pg .left{display:grid;grid-template-rows:auto minmax(0,1fr);gap:16px;min-height:0;min-width:0}
.pg .top{display:grid;grid-template-columns:minmax(0,704px) minmax(0,1fr);gap:16px;min-width:0}
.pg .pl{display:grid;gap:8px;min-width:0;align-content:start}
.pg .pl .monitor{width:100%}
.pg .monitor img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.pg .fl{display:grid;gap:4px;padding:12px 14px;border-bottom:1px solid var(--line);min-width:0}
.pg .fl:last-child{border-bottom:0}
.pg .fl .fn{font:12px/1.4 var(--mono);color:var(--text-2);word-break:break-all}
.pg .tl{padding:12px 14px;display:grid;grid-template-columns:96px minmax(0,1fr);gap:0 12px;align-items:center}
.pg .tl .ln{height:44px;display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-2);min-width:0;overflow:hidden;white-space:nowrap}
.pg .tl .tr{position:relative;height:44px;border-bottom:1px solid var(--line)}
.pg .tl .tr.ax{height:24px;font:11px/24px var(--mono);color:var(--text-3)}
.pg .tl .tr.ax span{position:absolute;top:0;transform:translateX(-50%)}
.pg .tl .tr i{position:absolute;top:50%;width:4px;height:16px;border-radius:2px;transform:translate(-50%,-50%);background:var(--text-2)}
.pg .tl .tr i.h{background:var(--home)}.pg .tl .tr i.a{background:var(--away)}
.pg .tl .tr i.f{background:var(--caution)}.pg .tl .tr i.t{background:var(--action-hi)}.pg .tl .tr i.m{background:#B7A4FF}
.pg .hl{display:grid;grid-template-columns:62px 18px minmax(0,1fr) 44px 56px;gap:10px;align-items:center;padding:0 14px;height:48px;border-bottom:1px solid var(--line);font-size:13px}
.pg .hl .tm{font:12px var(--mono);color:var(--text-3)}
.pg .hl .ds{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pg .hl .du{font:12px var(--mono);color:var(--text-2);text-align:right}
.pg .hl.off .ds,.pg .hl.off .du{color:var(--text-3)}
.pg .hl .mv{display:flex;gap:2px}
.pg .hl .mv .btn{width:26px;height:24px;padding:0}
.pg .hl .mv .i{width:12px;height:12px}
.pg .hl .check{cursor:pointer;background:none}
.pg .hl .check.on{background:var(--action-fill)}
.pg .switch{cursor:pointer}
.pg .monitor video{position:absolute;inset:0;width:100%;height:100%;background:#000}
.pg .tl .tr i[data-seek]{cursor:pointer;width:6px}
.pg .tl .tr i[data-seek]:hover,.pg .tl .tr i[data-seek]:focus-visible{outline:2px solid var(--text);outline-offset:2px}
.pg .tl .tr input[type=range]{position:absolute;inset:0;width:100%;margin:0}
.pg a.lnk{display:inline-flex;align-items:center;gap:6px;color:var(--action-hi);font-weight:600;text-decoration:none}
`,

  async load() {
    const id = S.state?.gameId;
    if (!id) return { id: null };
    const [hl, log, air] = await Promise.all([api.get(`/highlights/${id}`), api.get("/log"), api.get(`/reports/airings?gameId=${encodeURIComponent(id)}`).catch(() => null)]);
    return { id, hl, log, air };
  },

  render(ctx, d) {
    if (!d.id) return html`<div class="empty" style="height:100%;align-content:center">${icon("film", "xl")}<h2 class="t">No game to wrap up</h2><span>Pick or start a game and this screen will show its recording and highlights.</span><a class="btn pri" href="#/">Back to Home</a></div>`;
    const gd = S.state.gameDoc, g = S.state.game;
    const rec = d.hl.recording || S.state.recording;
    const clips = d.hl.clips;
    const pr = S.state.settings?.profile ? { periods: S.state.settings.profile.periods, periodMs: S.state.settings.profile.periodMin * 60000, overtimeMs: S.state.settings.profile.overtimeMin * 60000 } : undefined;

    // highlight selection state: reset when the clip set changes
    const sig = d.id + ":" + clips.map((c) => c.startMs).join(",");
    if (P.key !== sig) {
      const saved = new Set(loadHighlightSeqs(d.id));
      const pick = saved.size ? clips.map((c, i) => (c.eventSeq.some((s) => saved.has(s)) ? i : -1)).filter((i) => i >= 0) : clips.map((_, i) => i);
      Object.assign(P, { key: sig, order: clips.map((_, i) => i), on: new Set(pick.length ? pick : clips.map((_, i) => i)), exp: null, busy: false });
    }
    const len = rec ? (rec.endedAt ?? Date.now()) - rec.startedAt : 0;
    const total = P.order.filter((i) => P.on.has(i)).reduce((n, i) => n + clips[i].endMs - clips[i].startMs, 0);
    const name = (t) => gd?.[t]?.name || g?.[t]?.name || (t === "home" ? "Home" : "Away");

    // timeline from the log, positioned in recording time
    const undone = new Set(d.log.filter((e) => e.type === "undo").map((e) => e.target));
    const evs = d.log.filter((e) => PLAYED.has(e.type) && !undone.has(e.seq));
    const pos = (t) => (len > 0 ? Math.max(0, Math.min(100, ((t - rec.startedAt) / len) * 100)) : 0);
    const inRec = (e) => rec && e.t >= rec.startedAt - 1000 && (!rec.endedAt || e.t <= rec.endedAt + 1000);
    const at = (e) => Math.max(0, Math.round((e.t - rec.startedAt) / 1000));
    const ticks = (arr, c) => arr.filter(inRec).map((e) => html`<i class="${c}" style="left:${pos(e.t)}%" title="${e.type} at ${dur(at(e) * 1000)}" ${canPlay ? raw(`data-seek="${at(e)}" role="button" tabindex="0" aria-label="${esc(e.type)} at ${dur(at(e) * 1000)}, jump to it"`) : ""}></i>`);
    const axis = d.log.filter((e) => e.type === "period.set" && e.period > 1 && inRec(e));
    const lanes = [["ball", name("home"), "h", evs.filter((e) => e.type === "score" && e.team === "home")], ["ball", name("away"), "a", evs.filter((e) => e.type === "score" && e.team === "away")], ["whistle", "Fouls", "f", evs.filter((e) => e.type === "foul")], ["timeout", "Timeouts", "t", evs.filter((e) => e.type === "timeout")], ["mark", "Marked", "m", evs.filter((e) => e.type === "mark")]];

    const finalScore = g ? `${name("home")} ${g.home.score}, ${name("away")} ${g.away.score}` : "";
    const dateTxt = gd ? fmtDate(gd.startsAt) : "";
    const prog = S.state.engine.program;
    const loc = dirOf(rec?.file);
    const canPlay = !!(rec && rec.endedAt && rec.bytes > 0);

    return html`<div class="pg">
      <section class="left">
        <div class="top">
          <div class="pl">
            ${canPlay ? html`<div class="monitor"><video id="pg-video" controls preload="metadata" playsinline aria-label="Game recording" src="/rec/${encodeURIComponent(rec.id)}"></video></div>
              <div class="row faint" style="font-size:12.5px;gap:8px;flex-wrap:wrap" id="pg-vnote">${icon("info", "sm")}<span>Click a mark on the timeline to jump to that play.</span><span class="sp"></span><a class="lnk" id="pg-dl" href="/rec/${encodeURIComponent(rec.id)}?download=1">${icon("down2", "sm")}Download recording</a></div>` : html`<div class="monitor">${prog && rec ? html`<img id="pg-img" alt="Program output" src="/snap/${prog}?t=${Date.now()}">` : html`<div class="feed center"></div>`}<span class="src">${rec ? "Program · " + dur(len) : "No recording"}</span></div>
              <div class="row faint" style="font-size:12.5px;gap:8px">${icon("info", "sm")}${rec ? "Playback is available once the recording has finished." : "No recording was made for this game."}</div>`}
          </div>
          <div class="panel">
            <div class="ph"><h3>Files and exports</h3></div>
            <div class="fl"><span class="lbl">Recording</span>
              ${rec ? html`<span class="fn">${base(rec.file)}</span><span class="faint">${fmtBytes(rec.bytes)} · ${dur(len)}${rec.endedAt ? "" : " · still recording"}</span>
                <span class="fn" id="pg-path" style="color:var(--text-3)">${loc}</span>
                <button class="btn sm" id="pg-copy" style="justify-self:start;margin-top:4px">${icon("folder", "sm")}Copy folder path</button><span class="faint" style="font-size:12px">Paste it into your file manager to open the folder.</span>` : html`<span class="faint">No recording</span>`}</div>
            <div class="fl"><span class="lbl">Events (${evs.length})</span>
              <div class="row" style="gap:8px"><a class="btn sm" id="pg-csv" download="events.csv" href="#">${icon("down2", "sm")}CSV</a><a class="btn sm" id="pg-json" download="events.json" href="#">${icon("down2", "sm")}JSON</a></div></div>
            <div class="fl"><span class="lbl">Sponsors</span><span class="faint">${d.air ? `${d.air.rows.length} airing${d.air.rows.length === 1 ? "" : "s"} recorded` : "Airings unavailable"}</span>
              <a class="lnk" href="#/reports?gameId=${encodeURIComponent(d.id)}">${icon("chart", "sm")}Proof-of-play report</a></div>
          </div>
        </div>

        <div class="panel">
          <div class="ph"><h3>Event timeline</h3><span class="sp"></span>
            <span class="row faint" style="gap:12px;font-size:12px"><span class="row" style="gap:6px"><i class="swatch" style="background:var(--home)"></i>${name("home")}</span><span class="row" style="gap:6px"><i class="swatch" style="background:var(--away)"></i>${name("away")}</span><span class="row" style="gap:6px"><i class="swatch" style="background:var(--caution)"></i>Foul</span><span class="row" style="gap:6px"><i class="swatch" style="background:var(--action-hi)"></i>Timeout</span><span class="row" style="gap:6px"><i class="swatch" style="background:#B7A4FF"></i>Marked</span></span></div>
          ${!rec || !len ? html`<div class="empty">${icon("clock", "xl")}<b>No timeline yet</b><span>The timeline appears once the game has been recorded.</span></div>` : html`
          <div class="tl scroll">
            <span></span><div class="tr ax"><span style="left:0;transform:none">0:00</span>${axis.map((e) => html`<span style="left:${pos(e.t)}%">${period(e.period)}</span>`)}<span style="left:99%;transform:translateX(-100%)">${dur(len)}</span></div>
            ${canPlay && html`<div class="ln">${icon("play", "sm")}Playback</div><div class="tr"><input type="range" id="pg-scrub" min="0" max="${Math.round(len / 1000)}" step="1" value="0" aria-label="Playback position"></div>`}
            ${lanes.map(([ic, label, c, arr], i) => html`<div class="ln">${icon(ic, "sm")}${label}</div><div class="tr" ${i === lanes.length - 1 ? raw('style="border-bottom:0"') : ""}>${ticks(arr, c)}</div>`)}
          </div>`}
        </div>
      </section>

      <aside class="panel">
        <div class="ph"><h3>Highlights</h3><span class="sp"></span><span class="chip">${icon("film", "sm")}${[...P.on].length} of ${clips.length} clips</span></div>
        <div class="row" style="padding:10px 14px;border-bottom:1px solid var(--line)">
          <span class="switch ${P.title ? "on" : ""}" id="pg-title" role="switch" aria-checked="${P.title}" aria-label="Title card" tabindex="0"></span><div style="min-width:0"><div style="font-weight:600">Title card</div><div class="faint" style="font-size:12px">${finalScore}${dateTxt ? " · " + dateTxt : ""}</div></div>
          <span class="sp"></span><span class="chip" title="Each clip starts 5 s before the play and ends 3 s after.">Pre 5 s · Post 3 s</span>
        </div>
        <div class="scroll" style="flex:1">
          ${!clips.length ? html`<div class="empty">${icon("film", "xl")}<b>${rec ? "No highlights yet" : "Nothing to cut"}</b><span>${rec ? "Clips are made from baskets scored during the recording." : "Highlights need a recording."}</span></div>` :
            P.order.map((i, pos2) => { const c = clips[i], on = P.on.has(i), cl = clockAtEvent(d.log, c.eventSeq[0], pr);
              return html`<div class="hl ${on ? "" : "off"}"><span class="tm">${cl ? period(cl.period) + " " + mmss(cl.clockMs) : "—"}</span><span class="check ${on ? "on" : ""}" data-tog="${i}" role="checkbox" aria-checked="${on}" aria-label="Include ${c.label}" tabindex="0">${on ? icon("check") : ""}</span><span class="ds">${c.label}</span><span class="du">${dur(c.endMs - c.startMs)}</span>
              <span class="mv"><button class="btn sm ghost" data-up="${pos2}" aria-label="Move up" ${pos2 === 0 ? "disabled" : ""}><svg class="i" style="transform:rotate(180deg)"><use href="#i-down"/></svg></button><button class="btn sm ghost" data-dn="${pos2}" aria-label="Move down" ${pos2 === P.order.length - 1 ? "disabled" : ""}>${icon("down")}</button></span></div>`; })}
        </div>
        ${P.exp ? html`<div style="padding:10px 14px;border-top:1px solid var(--line)">${P.exp.err ? html`<div class="banner err">${icon("alert")}<div><b>Highlights could not be made.</b> <span class="muted">${P.exp.err}</span></div></div>` : P.exp.out ? html`<div class="banner ok">${icon("check")}<div style="min-width:0"><b>Highlights ready</b> · ${dur(P.exp.seconds * 1000)}<div class="fn mono" style="font-size:12px;color:var(--text-2);word-break:break-all" id="pg-out">${P.exp.out}</div></div><span class="sp"></span><a class="btn sm" href="/rec/highlights-${encodeURIComponent(d.id)}" target="_blank" rel="noopener">${icon("play", "sm")}Watch</a><a class="btn sm" href="/rec/highlights-${encodeURIComponent(d.id)}?download=1">${icon("down2", "sm")}Download</a><button class="btn sm" id="pg-copyout">Copy path</button></div>` : html`<div class="banner info"><span style="width:18px;height:18px;border-radius:50%;border:2px solid var(--line-strong);border-top-color:var(--action);animation:spin 1s linear infinite;flex:none"></span><div><b>Making your highlights…</b> <span class="muted">This can take a minute. Keep this page open.</span></div></div>`}</div>` : ""}
        <div class="row" style="padding:12px 14px;border-top:1px solid var(--line)">
          <div style="min-width:0"><div class="faint" style="font-size:12px">Total length</div><div class="mono" style="font-size:16px;font-weight:650">${dur(total)}</div></div>
          <span class="sp"></span>
          <button class="btn pri lg" id="pg-export" ${P.busy || !P.on.size || !rec ? "disabled" : ""}>${icon("film")}${P.busy ? "Exporting…" : "Export highlights"}</button>
        </div>
      </aside>
    </div>`;
  },

  bind(root, ctx, d) {
    const tr = document.getElementById("top-right");
    if (d.id) {
      const rec = d.hl.recording || S.state.recording, gd = S.state.gameDoc;
      if (tr) {
        tr.innerHTML = html`${rec ? (rec.endedAt ? html`<span class="chip ok">${icon("check", "sm")}Remux finished</span>` : html`<span class="chip warn">Recording in progress</span>`) : ""}<span class="faint" style="font-size:12px">${gd ? fmtDate(gd.startsAt, { month: "short", day: "numeric", year: "numeric" }) : ""}</span><button class="btn pri sm" id="pg-done" style="height:32px">${icon("home")}Done</button>`.s;
        tr.querySelector("#pg-done").onclick = () => go("/");
      }
    }
    if (!d.id) return () => { if (tr) tr.innerHTML = ""; };

    // client-side event exports (normal downloads work in the local app)
    const urls = [];
    const undone = new Set(d.log.filter((e) => e.type === "undo").map((e) => e.target));
    const evs = d.log.filter((e) => PLAYED.has(e.type) && !undone.has(e.seq));
    const rec = d.hl.recording || S.state.recording;
    const pr = S.state.settings?.profile ? { periods: S.state.settings.profile.periods, periodMs: S.state.settings.profile.periodMin * 60000, overtimeMs: S.state.settings.profile.overtimeMin * 60000 } : undefined;
    const rows = [["seq", "time", "recording_offset_s", "period", "game_clock", "type", "team", "points", "player", "note"]].concat(evs.map((e) => {
      const c = clockAtEvent(d.log, e.seq, pr);
      return [e.seq, new Date(e.t).toISOString(), rec ? Math.round((e.t - rec.startedAt) / 1000) : "", c ? period(c.period) : "", c ? Math.ceil(c.clockMs / 1000) : "", e.type, e.team ?? "", e.points ?? "", e.player ?? "", e.note ?? ""];
    }));
    const mk = (sel, text, type) => { const a = root.querySelector(sel); if (!a) return; const u = URL.createObjectURL(new Blob([text], { type })); urls.push(u); a.href = u; };
    mk("#pg-csv", rows.map((r) => r.map(csvCell).join(",")).join("\n"), "text/csv");
    mk("#pg-json", JSON.stringify(d.log.filter((e) => PLAYED.has(e.type) || e.type === "undo" || e.type === "period.set"), null, 2), "application/json");

    // player: keeps its place across redraws, ticks and the scrubber seek it
    const v = root.querySelector("#pg-video"), scrub = root.querySelector("#pg-scrub");
    if (v) {
      v.addEventListener("loadedmetadata", () => { if (P.vt) v.currentTime = P.vt; if (P.playing) v.play().catch(() => {}); }, { once: true });
      v.addEventListener("timeupdate", () => { P.vt = v.currentTime; P.playing = !v.paused; if (scrub && document.activeElement !== scrub) scrub.value = Math.round(v.currentTime); });
      v.addEventListener("error", () => { P.vfail = true; const n = root.querySelector("#pg-vnote span"); if (n) n.textContent = "This browser cannot play this file format. Download it and open it in your video player."; });
      if (scrub) scrub.oninput = () => { v.currentTime = +scrub.value; };
    }
    const seek = (el) => { if (!v) return; v.currentTime = Math.max(0, +el.dataset.seek - 3); v.play().catch(() => {}); }; // 3 s of lead-in so the play is seen
    async function copy(text, label) {
      try { await navigator.clipboard.writeText(text); toast(`${label} copied.`); }
      catch {
        const el = root.querySelector("#pg-path") || root.querySelector("#pg-out");
        if (el) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
        toast("Press Ctrl+C to copy the selected path.");
      }
    }
    const move = (from, to) => { const o = P.order; [o[from], o[to]] = [o[to], o[from]]; ctx.redraw(); };
    const toggle = (i) => { P.on.has(i) ? P.on.delete(i) : P.on.add(i); ctx.redraw(); };
    async function doExport() {
      const indexes = P.order.filter((i) => P.on.has(i));
      if (!indexes.length) return toast("Pick at least one clip.");
      P.busy = true; P.exp = {}; ctx.redraw();
      try { P.exp = await api.post(`/highlights/${d.id}/export`, { indexes }); }
      catch (e) { P.exp = { err: (/^ffmpeg failed/.test(e.message) ? "The video tool stopped partway: " + e.message.replace(/^ffmpeg failed: /, "") + ". " : e.message + " ") + "Your recording is safe." }; }
      P.busy = false; ctx.redraw();
    }
    const click = (e) => {
      const t = e.target; let el;
      if ((el = t.closest("[data-seek]"))) return seek(el);
      if ((el = t.closest("[data-tog]"))) return toggle(+el.dataset.tog);
      if ((el = t.closest("[data-up]"))) return move(+el.dataset.up, +el.dataset.up - 1);
      if ((el = t.closest("[data-dn]"))) return move(+el.dataset.dn, +el.dataset.dn + 1);
      if (t.closest("#pg-title")) { P.title = !P.title; return ctx.redraw(); }
      if (t.closest("#pg-export")) return doExport();
      if (t.closest("#pg-copy")) return copy(String(rec.file).replace(/[\\/][^\\/]*$/, ""), "Folder path");
      if (t.closest("#pg-copyout")) return copy(P.exp.out, "Path");
    };
    const key = (e) => { if ((e.key === " " || e.key === "Enter") && e.target.matches("[role=checkbox],[role=switch],[data-seek]")) { e.preventDefault(); e.target.click(); } };
    root.addEventListener("click", click); root.addEventListener("keydown", key);
    return () => { root.removeEventListener("click", click); root.removeEventListener("keydown", key); urls.forEach(URL.revokeObjectURL); if (tr) tr.innerHTML = ""; };
  },
};
