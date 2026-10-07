// Sport-profile helpers shared by the console, New game, and the profile editor. A plain script (no exports) that sets
// globalThis.FHSport, so it can be `import "../sport.js"`-ed by screens. The phone remote (web/remote/remote.js) keeps its own
// small copy because the phone listener only serves an allowlist of files (src/auth.ts FILES).
// Everything here draws from a ProfileSummary (state.sport) or a ProfileDoc; nothing assumes basketball.
(function (g) {
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const lc = (s) => String(s).toLowerCase();

  // ---- counters
  /** Pip total: limit, else start value, else the highest threshold (docs/dev/profiles.md). */
  const total = (d) => d.limit || d.startValue || Math.max(0, ...(d.thresholds || []).map((t) => t.at));
  /** "3 left" counters (timeouts): a tap uses one. Counters that start at 0 (fouls, cards) count up. */
  const countsDown = (d) => (d.startValue || 0) > 0;
  /** Legacy `foul` and `timeout` events stay in use for those two counters so old automation rules and logs keep working. */
  const counterEvent = (d, team, delta) => (d.id === "fouls" && delta === 1 ? { type: "foul", team } : d.id === "timeouts" && delta === -1 ? { type: "timeout", team } : { type: "counter", team, id: d.id, delta });
  const val = (game, id, team) => game?.counters?.[id]?.[team] ?? game?.[team]?.[id] ?? 0;

  // ---- scoring
  /** The classic +1 +2 +3 row shows just the points; everything else shows the option's own name too. */
  const plainScoring = (sc) => sc.length === 3 && sc.every((s, i) => s.points === i + 1);
  const scoreBtn = (sport, i, team, title) => {
    const s = sport.scoring[i], plain = plainScoring(sport.scoring);
    return `<button type="button" class="btn${plain ? "" : " two"}" data-pts="${esc(team)}:${i}" data-i="${i}" title="${esc(title || s.label)}" aria-label="${esc(s.label)}, ${s.points} point${s.points === 1 ? "" : "s"}">${plain ? "+" + s.points : `<b>+${s.points}</b><small>${esc(s.label)}</small>`}</button>`;
  };
  const plusRow = (sport, team, titleOf) => `<div class="plus${sport.scoring.length > 3 ? " many" : sport.scoring.length === 1 ? " one" : ""}">${sport.scoring.map((_, i) => scoreBtn(sport, i, team, titleOf && titleOf(team, i))).join("")}</div>`;

  /** Which key scores each option: [{team, i, key}] with raw keys ("q", "Shift+T"). Settings shortcuts keep +1/+2/+3; an option's own hotkey wins. */
  function scoreKeys(sport, sc) {
    const out = [], seen = new Set();
    sport.scoring.forEach((s, i) => {
      const first = !seen.has(s.points); seen.add(s.points);
      for (const team of ["home", "away"]) {
        const legacy = first && s.points <= 3 ? sc?.[team + "Plus" + s.points] : "";
        const hk = s.hotkey && s.hotkey.length === 1 ? (team === "home" ? s.hotkey : /[a-z]/i.test(s.hotkey) ? "Shift+" + s.hotkey.toUpperCase() : "") : "";
        const key = hk || legacy;
        if (key) out.push({ team, i, key });
      }
    });
    return out;
  }

  // ---- periods
  const periodLabel = (sport, p) => {
    const n = p - sport.periodCount;
    if (n <= 0) return sport.periodLabels[p - 1];
    return sport.overtime ? (sport.periodLabels[sport.periodCount] || "OT").replace(/\d+$/, "") + (n > 1 ? n : "") : "Period " + p;
  };
  /** "Q3" -> ["Q","3"], "Set 2" -> ["Set","2"] so the score bug keeps a small word and a big number; "OT" and "2nd half" stay words: [label, ""]. */
  const splitLabel = (l) => { const m = /^(.*?)\s*(\d+)$/.exec(l || ""); return m ? [m[1], m[2]] : [l || "", ""]; };
  const periodOn = (sport, i, period) => (sport.overtime && i === sport.periodCount ? period > sport.periodCount : period === i + 1);

  // ---- state
  /** The sport of the active game; a state from an older server has none, so draw the classic basketball buttons from settings.profile. */
  function sportOf(st) {
    if (st?.sport) return st.sport;
    const p = st?.settings?.profile || { periods: 4, bonusAt: 5, timeouts: 3 };
    return {
      id: "basketball", name: "Basketball", sport: "Basketball", periodCount: p.periods, overtime: true, clockMode: "down", displayFormat: "tenths", win: null, sponsorBreakCounter: "timeouts", display: { clock: true, period: true, counters: true },
      scoring: [{ id: "ft", label: "Free throw", points: 1 }, { id: "fg2", label: "Basket", points: 2 }, { id: "fg3", label: "3-pointer", points: 3 }],
      counters: [{ id: "fouls", label: "Team fouls", perTeam: true, startValue: 0, resetEachPeriod: true, thresholds: [{ at: p.bonusAt, label: "Bonus" }], thresholdsApplyTo: "opponent", showAs: "pips" }, { id: "timeouts", label: "Timeouts", perTeam: true, startValue: p.timeouts, resetEachPeriod: false, showAs: "pips" }],
      periodLabels: [...Array.from({ length: p.periods }, (_, i) => "Q" + (i + 1)), "OT"],
    };
  }

  // ---- counter controls (drawn once; patchCtl fills in the numbers on every push)
  const ctl = (d, team, o = {}) => {
    const k = `data-ctr="${esc(d.id)}" data-t="${esc(team)}"`;
    const body = d.showAs === "pips"
      ? `<button type="button" class="pipbtn" ${k} data-d="${countsDown(d) ? -1 : 1}">${o.inName ? '<span class="bn2 hidden"></span>' : ""}<span class="pips"></span></button>`
      : `<span class="stp2" role="group"><button type="button" class="btn sm" ${k} data-d="-1">&minus;</button><b class="cn mono">0</b><button type="button" class="btn sm" ${k} data-d="1">+</button></span>`;
    return `<span class="cc" data-cc="${esc(d.id)}" data-t="${esc(team)}">${body}${o.inName ? "" : '<span class="thr chip warn hidden"></span>'}</span>`;
  };
  const setPips = (el, n, tot, c) => { const k = n + "/" + tot + c; if (el.dataset.k === k) return; el.dataset.k = k; el.className = "pips " + c; el.innerHTML = Array.from({ length: tot }, (_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join(""); };
  const setText = (el, t) => { if (el && el.textContent !== String(t)) el.textContent = t; };
  /** Fill every `.cc` under root from the live game: pips or number, threshold label, tooltips, disabled at the ends. */
  function patchCtl(root, sport, game, nameOf, off) {
    root.querySelectorAll(".cc").forEach((cc) => {
      const d = sport.counters.find((c) => c.id === cc.dataset.cc); if (!d) return;
      const t = cc.dataset.t, v = val(game, d.id, t), thr = game?.thresholds?.[d.id]?.[t] || "", nm = nameOf(t), lab = lc(d.label), down = countsDown(d);
      const pips = cc.querySelector(".pips"); if (pips) setPips(pips, v, Math.max(total(d), v), thr ? "bonus" : "");
      setText(cc.querySelector(".cn"), v);
      cc.querySelectorAll("[data-ctr]").forEach((b) => {
        const dd = +b.dataset.d;
        b.disabled = !!off || (dd < 0 ? v <= 0 : d.limit != null && v >= d.limit);
        const tip = b.classList.contains("pipbtn") ? (down ? `Use one ${lab} for ${nm} (${v} left)` : `Add one to ${lab} for ${nm}. ${v} now${thr ? ", " + thr : ""}.`) : dd < 0 ? `Take one off ${lab} for ${nm} (${v} now)` : `Add one to ${lab} for ${nm} (${v} now)`;
        if (b.title !== tip) { b.title = tip; b.setAttribute("aria-label", tip); }
      });
      const bn = cc.querySelector(".bn2"); if (bn) { bn.classList.toggle("hidden", !thr); setText(bn, thr.toUpperCase()); }
      const tc = cc.querySelector(".thr"); if (tc) { tc.classList.toggle("hidden", !thr); setText(tc, thr); }
    });
  }

  // ---- from a ProfileDoc (the editor and the New game picker)
  function summaryOf(p) {
    const n = p.periods.count, nm = (i) => (p.periods.names && p.periods.names[i]) || p.periodLabelFormat.replace("{n}", i + 1);
    const labels = Array.from({ length: n }, (_, i) => nm(i));
    if (p.periods.overtime.enabled) labels.push(p.periods.overtime.namePrefix || "OT");
    return { id: p.id, name: p.name, sport: p.sport, scoring: p.scoring, counters: p.counters, periodLabels: labels, periodCount: n, overtime: p.periods.overtime.enabled, clockMode: p.clock.mode, displayFormat: p.clock.displayFormat, win: p.win || null, display: p.display, sponsorBreakCounter: p.sponsorBreakCounter || null };
  }
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;
  /** One plain sentence about a profile, for lists and the picker. */
  function describe(p) {
    const clock = p.clock.mode === "none" ? "no clock" : `${p.periods.lengthMin || "?"} min each, clock counts ${p.clock.mode === "down" ? "down" : "up"}`;
    const sets = p.win ? `, first to ${p.win.points} wins a set, ${p.win.setsToWin} sets to win` : "";
    return `${plural(p.periods.count, "period")}, ${clock}${sets}. ${plural(p.scoring.length, "way")} to score, ${plural(p.counters.length, "counter")}.`;
  }

  // ---- how an event reads in a log
  function eventText(e, sport, nameOf) {
    const nm = e.team ? nameOf(e.team) : "";
    const opt = e.type === "score" ? sport.scoring.find((s) => s.id === e.kind) || sport.scoring.find((s) => s.points === e.points) : null;
    switch (e.type) {
      case "score": return [nm, (opt ? lc(opt.label) : "+" + e.points)];
      case "foul": return [nm, "foul"];
      case "timeout": return [nm, "timeout"];
      case "counter": { const d = sport.counters.find((c) => c.id === e.id); return [nm, (d ? lc(d.label) : e.id) + (e.delta > 0 ? " +1" : " −1")]; }
      default: return [nm, e.type];
    }
  }

  const CSS = `
.plus.many{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.plus.many .btn:last-child:nth-child(odd){grid-column:1/-1}
.plus .btn.two{display:inline-flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:2px;line-height:1.1;padding:0 6px;min-width:0}.plus .btn.two b{font-size:16px}.plus .btn.two small{font-size:12px;font-weight:600;color:var(--text-2);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.plus.many .btn,.plus.one .btn{height:52px}.plus.one .btn{height:72px}.plus.one .btn b{font-size:22px}.plus.one .btn small{font-size:13px}
.cc{display:inline-flex;align-items:center;gap:8px;min-width:0}
.stp2{display:inline-flex;align-items:center;gap:6px}.stp2 .btn{width:36px;height:36px;padding:0;font-size:18px}.stp2 .cn{min-width:24px;text-align:center;font-size:16px;color:var(--text)}
.pipbtn{background:none;border:0;padding:3px;border-radius:5px;cursor:pointer;display:flex;align-items:center;gap:6px;color:inherit}.pipbtn:hover:not(:disabled){background:var(--raised)}.pipbtn:disabled{cursor:default;opacity:.55}
.pips{display:flex;gap:4px;flex-wrap:wrap}.pips.bonus i.on{background:var(--caution)}
.cc .thr{height:20px;font-size:11px}
.hidden{display:none!important}`;

  g.FHSport = { esc, total, countsDown, counterEvent, val, plainScoring, scoreBtn, plusRow, scoreKeys, periodLabel, splitLabel, periodOn, sportOf, ctl, setPips, patchCtl, summaryOf, describe, plural, eventText, CSS };
})(globalThis);
