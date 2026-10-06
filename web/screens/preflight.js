// Preflight check (route /preflight). Spec: 10-ui-design-spec.md 5.6, frame design/screens/06-preflight.html
import { html, raw, icon, api, S, toast, fail, go } from "../app.js";

const GROUPS = [["Video", "video"], ["Audio", "vol"], ["Network", "wifi"], ["Storage", "disk"], ["Destination", "link"], ["Game", "ball"]];
const ST = { ok: ["ok", "check"], warn: ["warn", "alert"], err: ["err", "x"] };

// Where each fix goes. `to` = route, `again` = just re-run, otherwise `tip` is shown inline in plain language.
function fixFor(c) {
  const id = c.id;
  if (id.startsWith("video.")) return { to: "/sources" };
  if (id === "storage.space") return { to: "/settings/storage" };
  if (id === "game.set" || id.startsWith("destination.")) return { to: "/game/new" };
  if (id.startsWith("game.")) return { to: "/game/roster" };
  if (id.startsWith("network.dns.")) return { again: true };
  if (id === "network.upload") return { tip: "Upload speed can only be measured while streaming. Check that this computer is on wired internet or strong Wi-Fi, then go live and watch the stream health on the console." };
  if (id === "audio.levels") return { tip: "Check that the microphone is plugged in and not muted on the mixer, then ask someone to speak. The meters on the right should move." };
  if (id === "audio.clipping") return { tip: "Lower the gain on the loud input on the console mixer until the meter stays out of the red." };
  return { tip: c.fix || "Follow the message above, then run the checks again." };
}

const meter = (lv, n = 20) => { const k = Math.round(Math.max(0, Math.min(1, lv)) * n); return raw(Array.from({ length: n }, (_, i) => `<i class="${i < k ? (i > n * 0.85 ? "r" : i > n * 0.65 ? "y" : "g") : ""}"></i>`).join("")); };

export default {
  shell: "night",
  step: 2,
  css: `
.pf{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:16px;height:100%}
.pf>.panel{overflow:hidden}
.grp{padding:12px 14px 6px;background:var(--inset);border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px}
.grp .lbl{color:var(--text-2)}
.crow{min-height:56px}
.crow .tx{min-width:0;display:grid;gap:1px}
.crow.bad{background:var(--program-wash)}
.crow.cau{background:var(--caution-wash)}
.crow .tip{font-size:12.5px;color:var(--text);margin-top:4px}
.sum{display:flex;flex-direction:column;gap:14px;padding:16px;min-height:0;flex:1;overflow:auto}
.cnt{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.cnt div{background:var(--inset);border:1px solid var(--line);border-radius:8px;padding:8px 10px;display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--text-2)}
.cnt b{font-size:18px;color:var(--text);font-variant-numeric:tabular-nums}
.cnt .i{width:14px;height:14px}
.aud2{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px 12px;align-items:center;font-size:12.5px;color:var(--text-2)}
.pf .monitor img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.ack{display:flex;align-items:center;gap:10px;font-size:13px;cursor:pointer}
.ack input{width:18px;height:18px;accent-color:var(--action-fill)}
`,

  render() {
    return html`<div class="pf">
      <section class="panel">
        <div class="ph"><h3>Preflight checks</h3><span class="sp"></span><span class="muted" style="font-size:12px" id="pf-last">Running…</span><button class="btn sm" id="pf-again"><svg class="i sm"><use href="#i-refresh"/></svg>Run again</button></div>
        <div id="pf-list" class="scroll" style="flex:1;min-height:0"></div>
      </section>
      <aside class="panel"><div class="sum" id="pf-sum"></div></aside>
    </div>`;
  },

  bind(root, ctx) {
    let checks = [], shown = 0, running = true, acked = false, error = "", lastAt = 0, token = 0;
    const open = new Set();
    let stagger = null;
    const $ = (id) => root.querySelector("#" + id);

    // ---- left list
    function paintList() {
      const by = (g) => checks.filter((c) => c.group === g);
      const gone = new Set(checks.slice(shown).map((c) => c.id));
      $("pf-list").innerHTML = (error ? html`<div class="banner err" style="margin:14px"><svg class="i"><use href="#i-alert"/></svg><div><b>The checks could not run.</b> <span class="muted">${error}</span></div></div>`.s : "") +
        (running && !checks.length ? GROUPS.map(([g, ic]) => html`<div class="grp"><svg class="i" style="color:var(--text-2)"><use href="#i-${ic}"/></svg><span class="lbl">${g}</span></div><div class="crow"><span class="st run"></span><div class="tx"><span class="nm">Checking ${g.toLowerCase()}…</span></div></div>`.s).join("") :
        GROUPS.filter(([g]) => by(g).length).map(([g, ic]) => html`<div class="grp"><svg class="i" style="color:var(--text-2)"><use href="#i-${ic}"/></svg><span class="lbl">${g}</span></div>${by(g).map((c) => {
          if (gone.has(c.id)) return html`<div class="crow"><span class="st run"></span><div class="tx"><span class="nm">${c.name}</span><span class="rs">Checking…</span></div></div>`;
          const [cls, ic2] = ST[c.status], fx = c.status !== "ok" && fixFor(c);
          return html`<div class="crow ${c.status === "err" ? "bad" : c.status === "warn" ? "cau" : ""}"><span class="st ${cls}">${icon(ic2)}</span><div class="tx"><span class="nm">${c.name}</span><span class="rs">${c.result}</span>${fx && open.has(c.id) && fx.tip ? html`<span class="tip">${fx.tip}</span>` : ""}</div><span class="sp"></span>${fx ? html`<button class="btn sm" data-fix="${c.id}">${c.fix || "Fix"}</button>` : ""}</div>`;
        })}`.s).join(""));
      $("pf-last").textContent = running ? "Running…" : lastAt ? "Last run just now" : "";
    }

    // ---- right summary
    const final = () => !running && shown >= checks.length;
    const counts = () => { const done = checks.slice(0, shown); return { ok: done.filter((c) => c.status === "ok").length, warn: done.filter((c) => c.status === "warn").length, err: done.filter((c) => c.status === "err").length }; };
    function paintSum() {
      const n = counts(), fin = final(), el = $("pf-sum"), eng = S.state?.engine, prog = eng?.program;
      const errs = checks.filter((c) => c.status === "err"), warns = checks.filter((c) => c.status === "warn");
      const needAck = fin && !errs.length && warns.length > 0 && !acked;
      const ready = fin && !errs.length && !needAck;
      const bad = errs.length + warns.length;
      const title = !fin ? "Checking everything…" : !bad ? "Ready to go live" : `${bad} thing${bad > 1 ? "s" : ""} to fix`;
      const sub = !fin ? "This takes a few seconds." : !bad ? "Everything checked out." : errs.length ? `Fix ${errs.length > 1 ? "the red items" : errs[0].name.toLowerCase()} to go live.${warns.length ? " The caution items are optional." : ""}` : "You can go live now. Cautions are optional to fix.";
      const why = !fin ? "Go live turns on when the checks finish." : errs.length ? `Go live turns on once ${errs.length > 1 ? "the red items are" : errs[0].name.toLowerCase() + " is"} fixed.` : needAck ? "Tick “I understand” to unlock Go live." : "";
      const pill = !fin ? html`<span class="pill info">Checking</span>` : !bad ? html`<span class="pill ready">Ready</span>` : html`<span class="pill check">Check</span>`;
      el.innerHTML = html`
        <div class="row" style="align-items:flex-start;gap:14px">
          <div class="col-g" style="gap:6px;flex:1"><h2 class="t" style="${fin && !bad ? "color:var(--ready)" : ""}">${title}</h2><span class="muted">${sub}</span></div>${pill}
        </div>
        <div class="monitor" style="flex:none">${prog ? html`<img id="pf-img" alt="Program preview" src="/snap/${prog}?t=${Date.now()}">` : html`<div class="feed center"></div>`}
          <span class="tag">PROGRAM PREVIEW</span><span class="src">${eng?.sources.find((s) => s.id === prog) ? `${eng.sources.find((s) => s.id === prog).slot} · ${eng.sources.find((s) => s.id === prog).label}` : "No program source"}</span></div>
        <div class="cnt">
          <div><svg class="i" style="color:var(--ready)"><use href="#i-check"/></svg><b>${n.ok}</b>passed</div>
          <div><svg class="i" style="color:var(--caution)"><use href="#i-alert"/></svg><b>${n.warn}</b>caution</div>
          <div><svg class="i" style="color:#FF8A8E"><use href="#i-x"/></svg><b>${n.err}</b>to fix</div>
        </div>
        <div class="aud2" id="pf-aud">${audioRows()}</div>
        ${fin && bad ? html`<div class="col-g" style="gap:0;border:1px solid var(--line);border-radius:8px;overflow:hidden">
          ${errs.length ? html`<div class="row" style="padding:10px 12px;background:var(--program-wash);gap:10px"><svg class="i" style="color:#FF8A8E"><use href="#i-x"/></svg><div style="flex:1;min-width:0"><b>Blocks going live</b><div class="muted" style="font-size:12px">${errs.map((c) => c.name).join(", ")}</div></div></div>` : ""}
          ${warns.length ? html`<div class="row" style="padding:10px 12px;background:var(--caution-wash);gap:10px"><svg class="i" style="color:var(--caution)"><use href="#i-alert"/></svg><div style="flex:1;min-width:0"><b>Can go live anyway</b><div class="muted" style="font-size:12px">${warns.map((c) => c.name).join(", ")}</div></div></div>` : ""}
        </div>` : ""}
        ${fin && !errs.length && warns.length ? html`<label class="ack"><input type="checkbox" id="pf-ack" ${acked ? "checked" : ""}>I understand the cautions and want to go live anyway</label>` : ""}
        <div class="sp"></div>
        <button class="btn lg" disabled title="Coming later"><svg class="i"><use href="#i-link"/></svg>Test stream privately</button>
        <div class="col-g" style="gap:8px">
          <button class="btn pri xl ${ready ? "" : "dis"}" id="pf-go" ${ready ? "" : "disabled"} style="width:100%"><svg class="i lg"><use href="#i-play"/></svg>${eng?.stream.live ? "Back to the live console" : "Go live"}</button>
          ${why ? html`<div class="row" style="gap:8px;color:var(--text-2);font-size:12.5px"><svg class="i sm"><use href="#i-lock"/></svg>${why}</div>` : ""}
        </div>`.s;
    }
    function audioRows() {
      const m = (S.state?.engine.mixer || []).slice(0, 3);
      return html`${m.map((c) => html`<span>${c.label}</span><div class="meter" data-mx="${c.id}">${meter(c.muted ? 0 : c.level)}</div>`)}`;
    }

    // ---- run
    async function run() {
      const my = ++token;
      clearInterval(stagger);
      running = true; error = ""; checks = []; shown = 0; acked = false; open.clear();
      paintList(); paintSum();
      try {
        const [res] = await Promise.all([api.post("/preflight"), new Promise((r) => setTimeout(r, 400))]);
        if (my !== token) return;
        checks = res; running = false; lastAt = Date.now();
        stagger = setInterval(() => {
          shown++; paintList(); paintSum();
          if (shown >= checks.length) clearInterval(stagger);
        }, 130);
        paintList(); paintSum();
      } catch (e) {
        if (my !== token) return;
        running = false; error = e.message; paintList(); paintSum();
      }
    }

    // ---- events
    const click = (e) => {
      const f = e.target.closest("[data-fix]");
      if (f) {
        const c = checks.find((x) => x.id === f.dataset.fix), fx = fixFor(c);
        if (fx.to) go(fx.to); else if (fx.again) run(); else { open.has(c.id) ? open.delete(c.id) : open.add(c.id); paintList(); }
        return;
      }
      if (e.target.closest("#pf-again")) run();
      if (e.target.closest("#pf-go")) goLive();
    };
    const change = (e) => { if (e.target.id === "pf-ack") { acked = e.target.checked; paintSum(); } };
    async function goLive() {
      const b = $("pf-go");
      if (S.state?.engine.stream.live) return go("/live");
      b.disabled = true; b.classList.add("dis");
      try { await api.post("/broadcast/start"); go("/live"); } catch (e) { fail(e); paintSum(); }
    }
    root.addEventListener("click", click); root.addEventListener("change", change);

    // preview at ~2 fps, meters from live state
    const tick = setInterval(() => { const img = $("pf-img"); if (img && S.state?.engine.program) img.src = `/snap/${S.state.engine.program}?t=${Date.now()}`; }, 500);
    run();
    return () => { clearInterval(tick); clearInterval(stagger); token++; root.removeEventListener("click", click); root.removeEventListener("change", change); };
  },

  onState(root, st) {
    for (const el of root.querySelectorAll("[data-mx]")) {
      const c = st.engine.mixer.find((m) => m.id === el.dataset.mx);
      if (c) el.innerHTML = meter(c.muted ? 0 : c.level).s;
    }
  },
};
