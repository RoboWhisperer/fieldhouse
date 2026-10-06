// Settings area: /settings/<section>. Shell + section nav; each section lives in settings-a/b/c.js.
import { html, raw, icon } from "../app.js";
import { NAV, CSS, sectionName } from "./settings-ui.js";
import * as A from "./settings-a.js";
import * as B from "./settings-b.js";
import * as C from "./settings-c.js";
import * as O from "./settings-obs.js";
import { video } from "./settings-video.js";

const SECTIONS = { engine: O.engine, video, destinations: A.destinations, themes: A.themes, sport: A.sport, shortcuts: B.shortcuts, remote: B.remote, storage: B.storage, diagnostics: C.diagnostics, about: C.about };
const sec = (ctx) => SECTIONS[ctx.params[0] || "destinations"];

export default {
  shell: "manage",
  nav: "settings",
  css: CSS + `.stg .seg button{height:28px;padding:0 12px;border:0;border-radius:6px;background:transparent;color:var(--text-2);font-weight:600;font-size:12.5px;cursor:pointer}.stg .seg button.on{background:var(--raised);color:var(--text);box-shadow:0 0 0 1px var(--line-strong) inset}`,
  async load(ctx) {
    const s = sec(ctx);
    if (!s) throw new Error("That settings page does not exist.");
    return s.load ? s.load(ctx) : null;
  },
  render(ctx, data) {
    const id = ctx.params[0] || "destinations", s = sec(ctx);
    return html`<div class="stg"><h1 class="t">Settings</h1><div class="two">
      <nav class="stnav" aria-label="Settings sections">${NAV.map(([k, label, ic]) => html`<a href="#/settings/${k}" ${raw(k === id ? 'aria-current="page"' : "")}>${icon(ic)}${label}</a>`)}</nav>
      <div class="cp" aria-label="${sectionName(id)}">${s.render(ctx, data)}</div></div></div>${s.bar ? s.bar(ctx, data) : ""}`;
  },
  bind: (root, ctx, data) => sec(ctx).bind?.(root, ctx, data),
  onState: (root, st, ctx, data) => sec(ctx).onState?.(root, st, ctx, data),
};
