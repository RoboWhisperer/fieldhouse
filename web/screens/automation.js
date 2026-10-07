// Automation area: /automation/<tab>. Rules, Macros, Custom fields, Webhooks, Integrations, Run log. Backend: docs/dev/automation-api.md.
import { html, icon, api, toast, fail } from "../app.js";
import { rules } from "./automation-rules.js";
import { macros, fields } from "./automation-macros.js";
import { webhooks, integrations } from "./automation-hooks.js";
import { log } from "./automation-log.js";
import { clock } from "./automation-lib.js";

const TABS = { rules, macros, fields, webhooks, integrations, log };
const NAMES = [["rules", "Rules", "bolt"], ["macros", "Macros", "star"], ["fields", "Custom fields", "sliders"], ["webhooks", "Webhooks", "link"], ["integrations", "Integrations", "key"], ["log", "Run log", "clock"]];
const tabOf = (ctx) => TABS[ctx.params[0] || "rules"];

function head(s) {
  const until = s.pausedUntil && s.pausedUntil > Date.now() ? s.pausedUntil : 0;
  return html`${until ? html`<div class="banner warn" role="alert">${icon("alert", "lg")}<span><b>Automation paused itself for a few seconds.</b> <span class="muted">Rules were starting each other over and over, so Fieldhouse stopped them. It resumes at ${clock(until)}. Look in the Run log, then change the rules that trigger each other.</span></span></div>` : ""}
    ${s.paused ? html`<div class="banner warn">${icon("lock", "lg")}<span><b>Automation is paused.</b> <span class="muted">Rules do not start by themselves. Macro buttons and "Run now" still work.</span></span></div>` : ""}
    <div class="bar-row"><span class="chip ${s.paused ? "warn" : "ok"}">${icon(s.paused ? "pause" : "check", "sm")}${s.paused ? "Paused" : "Automation is on"}</span><span class="muted">${s.rules} rule${s.rules === 1 ? "" : "s"}, ${s.running} running now</span><span class="sp"></span>
      <button type="button" class="btn sm" data-h="pause" data-fk="fk-pause">${icon(s.paused ? "play" : "pause", "sm")}${s.paused ? "Resume automation" : "Pause automation"}</button>
      <button type="button" class="btn sm ${s.running ? "danger" : "ghost"}" data-h="cancel" ${s.running ? "" : 'disabled title="Nothing is running or waiting right now"'}>${icon("stop", "sm")}Cancel all running</button></div>`;
}
export default {
  shell: "manage", nav: "automation",
  css: `
.au{padding:32px;display:grid;gap:16px;align-content:start;max-width:1200px}.au [data-head]{display:grid;gap:12px}.au [data-tab]{margin-top:8px}.au [data-box],.au .editor{display:grid;gap:24px;align-content:start;min-width:0}
.au h1.t{margin:0}.au .h2{margin:0;font-size:18px}
.au .tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.au .tabs a{display:flex;align-items:center;gap:8px;padding:10px 14px;color:var(--text-2);font-weight:600;border-bottom:2px solid transparent;margin-bottom:-1px;text-decoration:none}
.au .tabs a:hover{color:var(--text)}.au .tabs a[aria-current]{color:var(--text);border-color:var(--action)}
.au .bar-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.au .bar-row:has(.lead){align-items:flex-start}.au .lead{margin:0;max-width:68ch;line-height:1.5;color:var(--text-2);flex:1 1 360px}.au .narrow{max-width:480px}
.au .row{display:flex;align-items:center;gap:8px}.au .row.wrap{flex-wrap:wrap}.au .sp{flex:1}
.au .stack{display:grid;gap:16px}.au .g2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.au .g3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;align-items:start}.au .g4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;align-items:start}
.au .wide2{grid-column:span 2}.au .wide3{grid-column:1/-1}
.au input.input,.au select.select,.au select.input{width:100%;font:inherit;color:var(--text)}.au .field{min-width:0}.au .field.inl{display:inline-grid}
.au .field>.fl,.au legend{font-size:12px;font-weight:600;color:var(--text-2)}.au .req{color:var(--caution)}.au .vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.au .mono{font-family:var(--mono)}.au code{font:12px var(--mono);color:var(--text-2);background:var(--inset);padding:1px 5px;border-radius:4px}
.au .chk{display:inline-flex;align-items:center;gap:8px;cursor:pointer;min-height:28px}.au .chk input{width:18px;height:18px;accent-color:var(--action)}
.au .cpick{width:44px;height:36px;padding:2px;border:1px solid var(--line-strong);border-radius:6px;background:var(--inset);cursor:pointer}
.au .panel>.ph .step,.au .step{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--action-fill);color:var(--action-ink);font-size:11px;margin-right:6px}
.au .panel>.pb{flex:none;padding:16px}.au .panel>.ph{height:40px;padding:0 16px}.au .empty{padding:48px 32px;gap:8px}.au .empty b{color:var(--text);font-size:16px;font-weight:600}.au .empty>span{max-width:52ch;line-height:1.5}.au .empty .i.xl{color:var(--text-3);margin-bottom:8px}.au .empty .row{margin-top:16px;justify-content:center}.au .empty.sm{padding:24px 16px}
.au .rowsfs{border:0;background:var(--inset);border-radius:8px;padding:12px 16px 16px;margin:0;display:grid;gap:12px;min-width:0}.au .rowsfs>legend{float:left;width:100%;padding:0 0 4px}.au .rowsfs>legend+*{clear:both}.au .act .rowsfs{background:var(--panel)}
.au .rowsfs>.btn{justify-self:start}.au .kvrow{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr) auto;gap:8px}
.au .actlist{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.au .act{border:1px solid var(--line);border-radius:8px;background:var(--inset);padding:12px 16px 16px;display:grid;gap:16px}.au .act:hover{border-color:var(--line-strong)}
.au .acthead{display:flex;align-items:center;gap:8px}.au .acthead .select{width:240px}
.au .grip{cursor:grab;color:var(--text-3);display:grid;place-items:center;width:24px;height:28px}
.au .num{display:inline-grid;place-items:center;min-width:24px;height:24px;border-radius:50%;background:var(--raised);font-weight:700;font-size:12px;border:1px solid var(--line-strong)}.au .num.sm{min-width:20px;height:20px;font-size:11px}
.au .actbody{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.au .actbody>.rowsfs,.au .actbody>.chk{grid-column:1/-1}
.au .actfoot{display:flex;gap:24px;align-items:end;flex-wrap:wrap}.au .actfoot .chk{padding-bottom:4px}.au .actfoot .field{flex:1;min-width:200px}
.au .addact{margin-top:16px;align-items:end;flex-wrap:wrap;gap:12px}.au .addact .select{width:260px}
.au .rlist{list-style:none;margin:0;padding:0}
.au .rrow{display:grid;grid-template-columns:36px minmax(0,1fr) 160px auto;gap:16px;align-items:center;padding:16px 20px;border-bottom:1px solid var(--line)}.au .rrow:last-child{border-bottom:0}.au .rrow:hover{background:color-mix(in srgb,var(--text) 3%,transparent)}.au .rrow.off .rname{color:var(--text-2)}
.au .rmain{display:grid;gap:4px;min-width:0}.au .rmain .rname{font-size:14px;font-weight:600}.au .rmain>.muted{line-height:1.5}.au .rlast{display:grid;gap:4px;justify-items:start}.au .rlast .muted{font-size:12px;color:var(--text-3)}.au .ract{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}
.au button.switch{border:0;padding:0;cursor:pointer}
.au .chips{display:flex;flex-wrap:wrap;gap:4px 8px}.au .chips .chip{height:auto;padding:2px 8px;font:12px var(--mono)}.au .rmain .chips{margin-top:4px}
.au .vcheck{min-height:20px;font-size:12.5px}.au .ok-t{color:var(--ready)}.au .warn-t{color:var(--caution)}.au .err-t{color:#FF8A8E}
html[data-theme=high-contrast] .au :is(.rowsfs,.fedit,.exlist li){border:1px solid var(--text-2)}html[data-theme=high-contrast] .exlist li{border:1px solid var(--text-2)}html[data-theme=light] .au .err-t{color:#B3261E}html[data-theme=light] .au .req,html[data-theme=light] .au .warn-t{color:#9A4500}
.au .cb{display:grid;grid-template-columns:2fr 1fr 1.2fr auto;gap:16px;align-items:end}
.au .savebar{position:sticky;bottom:0;margin:0 -32px -24px;padding:12px 32px;display:flex;align-items:center;gap:12px;background:var(--raised);border-top:1px solid var(--line-strong);z-index:5}
.au .would{margin:8px 0;padding:0;list-style:none;display:grid;gap:6px}.au .would li{display:flex;gap:10px;align-items:center}
.au .warns{margin:4px 0 0;padding-left:18px}
.au .dry{display:grid;gap:8px}
.au .exlist,.exlist{list-style:none;margin:0;padding:0;display:grid;gap:8px;max-height:60vh;overflow:auto}.exlist li{display:flex;gap:16px;align-items:center;padding:12px 16px;border-radius:8px;background:var(--panel)}.exlist li>div{display:grid;gap:4px;flex:1;justify-items:start}.exlist li>div>b{font-weight:600}.exlist li .muted{line-height:1.45}
.au .scrim.fx,.scrim.fx{position:fixed;inset:0;z-index:40}.modal.wide{width:min(680px,92vw)}
.au .loglist{list-style:none;margin:0;padding:0}.au .loglist li{border-bottom:1px solid var(--line)}.au .loglist li:last-child{border-bottom:0}
.au .loglist summary{display:grid;grid-template-columns:96px 56px minmax(0,1.2fr) 120px minmax(0,2fr);gap:16px;align-items:center;min-height:48px;padding:0 20px;cursor:pointer}.au .loglist summary>.pill{justify-self:start}.au [data-box]>.seg{justify-self:start;flex-wrap:wrap}.au .rlast .pill{justify-self:start}.au .loglist summary:hover{background:color-mix(in srgb,var(--text) 3%,transparent)}.au .loglist summary>.pill.off{background:none;padding:0;height:auto;color:var(--text-3);font-size:11px}.au .loglist details[open]>summary{background:color-mix(in srgb,var(--text) 3%,transparent)}
.au .loglist .ln{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.au .lt{font:12px var(--mono);color:var(--text-2)}.au .lr{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.au .ld{padding:8px 20px 20px 132px;display:grid;gap:12px}.au .ld p{margin:0}
.au .seg button{height:28px;padding:0 12px;border:0;border-radius:6px;background:transparent;color:var(--text-2);font-weight:600;font-size:12.5px;cursor:pointer}.au .seg button.on{background:var(--raised);color:var(--text);box-shadow:0 0 0 1px var(--line-strong) inset}
.au .mgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}.au .mcard .mmeta{display:grid;gap:4px;line-height:1.45}.au .mcard .mact{display:flex;gap:4px;flex-wrap:wrap;margin-top:4px}.au .mcard .pb{flex:none}
.au .icons{display:flex;flex-wrap:wrap;gap:6px}.au .ico{width:44px;height:44px;display:grid;place-items:center;border-radius:8px;border:1px solid var(--line-strong);background:var(--inset);color:var(--text-2);cursor:pointer}.au .ico.on{border-color:var(--action);background:var(--action-wash);color:var(--text);box-shadow:0 0 0 1px var(--action) inset}
.au .flist{list-style:none;margin:0;padding:0}.au .frow{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr) auto;gap:16px;align-items:center;padding:12px 20px;border-bottom:1px solid var(--line)}.au .frow:last-child{border-bottom:0}.au .fname code{background:none;padding:0;color:var(--text-3)}.au .fval .input{max-width:420px}
.au .fname{display:grid;gap:2px}.au .fval{display:flex;gap:10px;align-items:center}.au .fact{display:flex;gap:6px}.au .fedit{grid-column:1/-1;padding:16px;border-radius:8px;background:var(--inset)}
.au .copyline{display:flex;gap:8px;align-items:center;margin:6px 0;min-width:0}.au .copyline code{flex:1;min-width:0;padding:8px 10px;overflow-wrap:anywhere;font-size:12.5px}.au .copyline code.big{font-size:14px;color:var(--text)}
.au .keyshown{border-color:var(--caution)}.au .keynote{margin:0;line-height:1.5}.au .copyline code.big{letter-spacing:.02em}
.au .steps{display:grid;gap:16px;padding-left:20px;margin:0;line-height:1.5}.au .hints{margin:0;padding-left:20px;color:var(--text-2);display:grid;gap:4px;line-height:1.5}.au .hints b{color:var(--text);font-weight:600}
.au .evgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:2px 12px;margin-top:8px}
.au .how>summary{padding:12px 16px;cursor:pointer;font-weight:600;color:var(--text-2)}.au .how[open]>summary{color:var(--text)}.au .how>.pb{padding-top:0}
.au .wrapc{white-space:normal!important;min-width:180px}
.au .mbtn.pv{display:inline-flex;align-items:center;gap:10px;min-height:44px;padding:0 16px;border-radius:8px;background:var(--mc);color:var(--mi);font-weight:700;font-size:14px}.au .mbtn.pv.large{min-height:64px;font-size:16px;width:100%}
.au .mbtn.pv kbd{margin-left:auto;padding:1px 6px;border-radius:4px;border:1px solid currentColor;font:600 11px var(--mono)}
.au details>summary{list-style:revert}
@media (max-width:1100px){.au{padding:16px}.au .g3,.au .g4{grid-template-columns:repeat(2,minmax(0,1fr))}.au .cb{grid-template-columns:1fr 1fr}.au .rrow{grid-template-columns:44px minmax(0,1fr)}.au .rlast,.au .ract{grid-column:2}.au .ract{justify-content:flex-start}.au .loglist summary{grid-template-columns:80px minmax(0,1fr) auto}.au .loglist summary .pill:first-of-type,.au .lr{display:none}.au .frow{grid-template-columns:1fr}.au .savebar{margin:0 -16px -16px;padding:12px 16px}}
`,
  async load(ctx) {
    const t = tabOf(ctx); if (!t) throw new Error("That Automation page does not exist.");
    const [status, data] = await Promise.all([api.get("/automation/status"), t.load(ctx)]);
    return { status, data };
  },
  render(ctx, { status, data }) {
    const id = ctx.params[0] || "rules";
    return html`<div class="au"><h1 class="t">Automation</h1>
      <div data-head>${head(status)}</div>
      <nav class="tabs" aria-label="Automation sections">${NAMES.map(([k, l, ic]) => html`<a href="#/automation/${k}" ${k === id ? html`aria-current="page"` : ""}>${icon(ic, "sm")}${l}</a>`)}</nav>
      <div data-tab>${tabOf(ctx).render(ctx, data)}</div></div>`;
  },
  bind(root, ctx, { status, data }) {
    const h = root.querySelector("[data-head]"), s = { v: status };
    const paint = () => { const fk = document.activeElement?.dataset?.fk; h.innerHTML = head(s.v).s; if (fk) h.querySelector(`[data-fk="${fk}"]`)?.focus(); };
    const refresh = async () => { try { const n = await api.get("/automation/status"); if (JSON.stringify(n) !== JSON.stringify(s.v)) { s.v = n; paint(); } } catch {} };
    h.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-h]"); if (!b) return;
      try {
        if (b.dataset.h === "pause") { s.v = await api.post("/automation/pause", { paused: !s.v.paused }); toast(s.v.paused ? "Automation paused." : "Automation resumed."); paint(); }
        else if (confirm("Stop everything that is running or waiting?")) { const r = await api.post("/automation/cancel"); toast(r.cancelled ? `Cancelled ${r.cancelled}.` : "Nothing was running."); await refresh(); }
      } catch (x) { fail(x); }
    });
    const poll = setInterval(refresh, 3000), off = tabOf(ctx).bind?.(root.querySelector("[data-tab]"), ctx, data);
    return () => { clearInterval(poll); off?.(); };
  },
  onState(root, st, ctx, data) { tabOf(ctx).onState?.(root, st, ctx, data.data); },
};
