// Automation > Run log: what ran, what did not and why. Newest first, filters, per-step detail.
import { html, esc, icon, api } from "../app.js";
import { statusPill, pill, ago, clock } from "./automation-lib.js";

const FILTERS = [["all", "Everything"], ["ok", "Done"], ["error", "Failed"], ["skipped", "Did nothing"], ["cancelled", "Cancelled"], ["active", "Running now"]];
const match = (e, f) => f === "all" || (f === "active" ? e.status === "running" || e.status === "queued" : e.status === f);

function view(d) {
  const list = d.log.filter((e) => match(e, d.filter)), counts = Object.fromEntries(FILTERS.map(([k]) => [k, d.log.filter((e) => match(e, k)).length]));
  return html`<div class="bar-row"><p class="muted lead">The last runs of your rules and macro buttons. "Did nothing" means a rule woke up but held back: the condition was false, it was cooling down or it already ran once.</p></div>
    <div class="seg" role="group" aria-label="Show">${FILTERS.map(([k, l]) => html`<button type="button" class="${d.filter === k ? "on" : ""}" aria-pressed="${d.filter === k}" data-a="filter" data-k="${k}" data-fk="fk-f-${k}">${l} <small class="muted">${counts[k]}</small></button>`)}</div>
    <div class="panel">${list.length ? html`<ul class="loglist">${list.map((e) => html`<li><details data-id="${e.id}" ${d.open.has(e.id) ? "open" : ""}><summary><span class="lt">${clock(e.at)}</span>${pill("off", e.kind === "macro" ? "Button" : "Rule")}<b class="ln">${e.name}</b>${statusPill(e.status)}<span class="muted lr">${e.reason ?? e.steps?.find((x) => x.ok === false)?.error ?? (e.status === "ok" ? "Ran all steps" : "")}${e.ms != null ? ` (${e.ms} ms)` : ""}</span></summary>
      <div class="ld"><p class="muted">Started by: ${e.trigger || "unknown"}. ${ago(e.at)}.</p>${e.steps?.length ? html`<ol class="would">${e.steps.map((s, i) => html`<li style="margin-left:${(s.depth ?? 0) * 18}px"><span class="num sm">${i + 1}</span><span>${s.text}${s.ok === false ? html` ${pill("err", "Failed", "alert")} <span class="err-t">${s.error ?? ""}</span>` : ""}</span></li>`)}</ol>` : html`<p class="muted">No steps ran.</p>`}</div></details></li>`)}</ul>`
      : html`<div class="empty">${icon("clock", "xl")}<b>${d.log.length ? "Nothing matches this filter" : "Nothing has run yet"}</b><span>${d.log.length ? "Pick another filter above." : "When a rule or a macro button runs, it shows up here with every step."}</span></div>`}</div>`;
}
export const log = {
  async load() { return { log: await api.get("/automation/log?n=200"), filter: "all", open: new Set() }; },
  render: (ctx, d) => html`<div data-box>${view(d)}</div>`,
  bind(root, ctx, d) {
    const box = root.querySelector("[data-box]"), paint = (fk) => { const t = document.getElementById("screen"), y = t?.scrollTop; box.innerHTML = view(d).s; if (fk) box.querySelector(`[data-fk="${fk}"]`)?.focus(); if (t) t.scrollTop = y; };
    box.addEventListener("click", (e) => { const b = e.target.closest("[data-a=filter]"); if (b) { d.filter = b.dataset.k; paint(`fk-f-${b.dataset.k}`); } });
    box.addEventListener("toggle", (e) => { const id = e.target.dataset?.id; if (id) e.target.open ? d.open.add(id) : d.open.delete(id); }, true);
    let sig = JSON.stringify(d.log.map((x) => x.id + x.status));
    const poll = setInterval(async () => { try { const l = await api.get("/automation/log?n=200"), s = JSON.stringify(l.map((x) => x.id + x.status)); if (s !== sig) { sig = s; d.log = l; paint(document.activeElement?.dataset?.fk); } } catch {} }, 3000);
    return () => clearInterval(poll);
  },
};
