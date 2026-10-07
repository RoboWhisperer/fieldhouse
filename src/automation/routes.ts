// HTTP routes for custom fields, rules, macros, webhooks, the event stream, workspace export/import and the display (ui) settings.
// Registered once from createApp(); every route is documented in docs/dev/automation-api.md.
import * as data from "../data";
import type { Store } from "../store";
import { sseResponse } from "./bus";
import { CATALOG } from "./catalog";
import { KEY_RE } from "./custom";
import type { Automation } from "./index";
import { macroView, maskForRemote, normHotkey, parseMacro, parseRule, ruleView, type MacroDoc, type RuleDoc } from "./model";
import { buildTokens } from "./ui-theme";
import { createLayout, deleteLayout, resetLayout, checkCss } from "./ui-settings";

type On = (method: string, pattern: string, h: (a: { body: any; params: string[]; q: URLSearchParams; req: Request }) => unknown | Promise<unknown>) => void;
const MAX_NAME = /^[A-Za-z0-9 _.\-]{1,60}$/;

export function registerAutomationRoutes(on: On, a: Automation, c: { store: Store; bad: (msg: string, status?: number) => never; changed: () => void }) {
  const { store, bad, changed } = c;
  const { custom, runner, webhooks } = a;
  const found = <T>(x: T | undefined, what: string): T => x ?? bad(`${what} not found.`, 404);
  const obj = (b: unknown, what = "The request"): Record<string, any> => (b && typeof b === "object" && !Array.isArray(b) ? (b as any) : bad(`${what} must be a JSON object.`));

  // ---------------------------------------------------------------- custom fields
  const customView = () => ({ fields: custom.fields().map((f) => ({ key: f.id, label: f.label, type: f.type, default: f.default, value: f.value, effective: f.value !== "" ? f.value : f.default })), values: custom.all() });
  on("GET", "/custom", () => customView());
  on("PUT", "/custom", ({ body }) => { // {values: {key: "text"}, fields: {key: {label?, type?, default?, value?}}}
    const b = obj(body), ch: Record<string, Record<string, unknown>> = {};
    for (const [k, v] of Object.entries(b.values ?? {})) ch[k] = { ...ch[k], value: v };
    for (const [k, v] of Object.entries(b.fields ?? {})) ch[k] = { ...ch[k], ...obj(v, `The settings for "${k}"`) };
    if (!Object.keys(ch).length) bad('Send {"values": {"name": "text"}} and/or {"fields": {"name": {"label": "...", "type": "text"}}}.');
    custom.apply(ch); changed(); return customView();
  });
  on("PUT", "/custom/:key", ({ params, body }) => { custom.apply({ [params[0]]: obj(body) }); changed(); return customView(); });
  on("DELETE", "/custom/:key", ({ params }) => { if (!KEY_RE.test(params[0]) || !custom.has(params[0])) bad("That custom field does not exist.", 404); custom.remove(params[0]); changed(); return customView(); });

  // ---------------------------------------------------------------- rules
  const rules = () => store.list<RuleDoc>("rule");
  const rview = (r: RuleDoc) => ({ ...ruleView(r), summary: runner.describeTrigger(r.trigger) });
  on("GET", "/automation/rules", () => rules().map(rview));
  on("GET", "/automation/rules/:id", ({ params }) => rview(found(store.get<RuleDoc>("rule", params[0]), "Rule")));
  on("POST", "/automation/rules", ({ body }) => { if (rules().length >= 200) bad("You can have at most 200 rules."); const r = parseRule(body, undefined, a.now()); store.put("rule", r); changed(); return rview(r); });
  on("PUT", "/automation/rules/:id", ({ params, body }) => { const prev = found(store.get<RuleDoc>("rule", params[0]), "Rule"); const r = parseRule(body, prev, a.now()); store.put("rule", r); runner.forget(r.id); changed(); return rview(r); });
  on("DELETE", "/automation/rules/:id", ({ params }) => { found(store.get<RuleDoc>("rule", params[0]), "Rule"); store.del("rule", params[0]); runner.forget(params[0]); changed(); return { ok: true }; });
  on("POST", "/automation/rules/:id/test", ({ params, body }) => runner.dryRun(found(store.get<RuleDoc>("rule", params[0]), "Rule"), sample(body)));
  on("POST", "/automation/rules/:id/run", async ({ params }) => { found(store.get<RuleDoc>("rule", params[0]), "Rule"); return runner.runRule(params[0]); });
  const sample = (b: any) => ({ facts: b?.facts && typeof b.facts === "object" ? b.facts : undefined, event: b?.event && typeof b.event === "object" ? b.event : undefined });

  // ---------------------------------------------------------------- macros
  const macros = () => store.list<MacroDoc>("macro");
  /** Hotkeys must not collide with the built-in shortcuts or another macro (compared the way the console compares keys). */
  const k = (s: string) => normHotkey(s);
  function checkHotkey(m: MacroDoc) {
    if (!m.hotkey) return;
    const sc = Object.entries(data.getSettings(store).shortcuts).find(([, v]) => { try { return k(v) === m.hotkey; } catch { return false; } });
    if (sc) bad(`The key ${m.hotkey} is already used by the "${sc[0]}" shortcut. Pick another key.`, 409);
    const other = macros().find((x) => x.id !== m.id && x.hotkey === m.hotkey);
    if (other) bad(`The key ${m.hotkey} is already used by the macro "${other.label}". Pick another key.`, 409);
  }
  const macroFor = (req: Request, m: MacroDoc) => (req.headers.has("x-fieldhouse-remote") ? { ...m, actions: maskForRemote(m.actions) } : macroView(m)); // phones and API keys never see addresses' queries or bodies
  on("GET", "/macros", ({ req }) => macros().map((m) => macroFor(req, m)));
  on("GET", "/macros/:id", ({ params, req }) => macroFor(req, found(store.get<MacroDoc>("macro", params[0]), "Macro")));
  on("POST", "/macros", ({ body }) => { if (macros().length >= 100) bad("You can have at most 100 macros."); const m = parseMacro(body, undefined, a.now()); checkHotkey(m); store.put("macro", m); changed(); return macroView(m); });
  on("PUT", "/macros/:id", ({ params, body }) => { const prev = found(store.get<MacroDoc>("macro", params[0]), "Macro"); const m = parseMacro(body, prev, a.now()); if (body && "hotkey" in body && !body.hotkey) delete m.hotkey; checkHotkey(m); store.put("macro", m); changed(); return macroView(m); });
  on("DELETE", "/macros/:id", ({ params }) => { found(store.get<MacroDoc>("macro", params[0]), "Macro"); store.del("macro", params[0]); changed(); return { ok: true }; });
  on("POST", "/macros/:id/run", async ({ params, body }) => { found(store.get<MacroDoc>("macro", params[0]), "Macro"); return runner.runMacro(params[0], body?.data); });
  on("POST", "/macros/:id/test", ({ params, body }) => runner.dryRun(found(store.get<MacroDoc>("macro", params[0]), "Macro"), sample(body)));

  // ---------------------------------------------------------------- automation: status, log, triggers, dry-run of a draft
  on("GET", "/automation/status", () => runner.status());
  on("GET", "/automation/log", ({ q }) => runner.log(Math.min(500, Math.max(1, Number(q.get("n") ?? 100) || 100))));
  on("POST", "/automation/cancel", () => ({ cancelled: runner.cancelAll() }));
  on("POST", "/automation/pause", ({ body }) => { if (typeof body?.paused !== "boolean") bad("paused must be true or false."); runner.setPaused(body.paused); changed(); return runner.status(); });
  on("POST", "/automation/trigger", ({ body }) => {
    const b = obj(body);
    if (typeof b.name !== "string" || !MAX_NAME.test(b.name)) bad("name is required: letters, digits, spaces, dots, dashes and underscores (up to 60).");
    if (b.data !== undefined && (typeof b.data !== "object" || b.data === null || JSON.stringify(b.data).length > 2000)) bad("data must be a small JSON object.");
    return { woke: runner.trigger(b.name, b.data) };
  });
  on("POST", "/automation/test", ({ body }) => { // dry-run a draft that is not saved yet: {rule} or {macro}, plus optional {sample}
    const b = obj(body);
    if (b.rule) return runner.dryRun(parseRule(b.rule, undefined, a.now()), sample(b.sample));
    if (b.macro) return runner.dryRun(parseMacro(b.macro, undefined, a.now()), sample(b.sample));
    return bad('Send {"rule": {...}} or {"macro": {...}}.');
  });
  on("GET", "/automation/catalog", () => CATALOG);
  on("GET", "/automation/facts", () => runner.facts());

  // ---------------------------------------------------------------- webhooks and the event stream
  on("GET", "/webhooks", () => webhooks.list());
  on("POST", "/webhooks", ({ body }) => { const w = webhooks.save(body); changed(); return w; });
  on("GET", "/webhooks/deliveries", ({ q }) => webhooks.deliveries(Math.min(200, Number(q.get("n") ?? 50) || 50)));
  on("PUT", "/webhooks/:id", ({ params, body }) => { const w = webhooks.save(body, params[0]); changed(); return w; });
  on("DELETE", "/webhooks/:id", ({ params }) => { webhooks.remove(params[0]); changed(); return { ok: true }; });
  on("POST", "/webhooks/:id/test", ({ params }) => webhooks.test(params[0]));
  on("GET", "/stream", ({ q, req }) => sseResponse(a.bus, q, req.signal));

  // ---------------------------------------------------------------- workspace
  on("GET", "/workspace/export", async ({ q }) => {
    const only = q.get("sections")?.split(",").map((s) => s.trim()).filter(Boolean);
    const doc = await a.workspace.export(only);
    return new Response(JSON.stringify(doc, null, 2), { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="fieldhouse-workspace-${doc.exportedAt.slice(0, 10)}.json"` } });
  });
  on("POST", "/workspace/import", async ({ body }) => {
    const b = obj(body);
    const r = await a.workspace.import(b.workspace, { mode: b.mode, dryRun: b.dryRun === true, only: Array.isArray(b.sections) ? b.sections : undefined });
    if (r.applied) changed();
    return r;
  });
  on("GET", "/workspace/sections", () => a.workspace.names());

  // ---------------------------------------------------------------- display settings: tokens and layout presets (the values themselves live in settings.ui)
  const ui = () => data.getSettings(store).ui;
  const view = () => { const u = ui(); return { ui: u, ...buildTokens(u) }; };
  const save = (patch: Record<string, unknown>) => { data.saveSettings(store, { ui: patch }); changed(); return view(); };
  on("GET", "/ui", () => view());
  on("PUT", "/ui", ({ body }) => save(obj(body)));
  on("POST", "/ui/check-css", ({ body }) => { try { checkCss(body?.css); return { ok: true }; } catch (e: any) { return { ok: false, message: e.message }; } });
  on("POST", "/ui/layouts", ({ body }) => { const n = String(body?.name ?? "").trim(); const r = createLayout(ui().layouts, n, body?.from); const out = save({ layouts: r.layouts }); return { ...out, id: r.id }; });
  on("PUT", "/ui/layouts/:id", ({ params, body }) => { const l = ui().layouts; if (!l.presets.some((p) => p.id === params[0])) bad("That layout does not exist.", 404); return save({ layouts: { ...l, presets: l.presets.map((p) => (p.id === params[0] ? { ...p, ...obj(body), id: p.id } : p)) } }); });
  on("DELETE", "/ui/layouts/:id", ({ params }) => save({ layouts: deleteLayout(ui().layouts, params[0]) }));
  on("POST", "/ui/layouts/:id/reset", ({ params }) => save({ layouts: resetLayout(ui().layouts, params[0]) }));
  on("POST", "/ui/layouts/:id/activate", ({ params }) => { const l = ui().layouts; if (!l.presets.some((p) => p.id === params[0])) bad("That layout does not exist.", 404); return save({ layouts: { ...l, active: params[0] } }); });
}
