// The workspace sections this module owns: rules, macros, customFields, webhooks, looks (ui preferences) and layouts (console panels + macro buttons).
import * as data from "../data";
import type { Store } from "../store";
import type { Custom } from "./custom";
import { parseMacro, parseRule, stripSecrets, type MacroDoc, type RuleDoc } from "./model";
import type { Webhooks, WebhookDoc } from "./webhooks";
import { parseWebhook } from "./webhooks";
import type { Mode, Plan, Registry } from "./workspace";
import { DEFAULT_UI, validateUi } from "./ui-settings";

const list = (x: unknown, what: string, max = 500): any[] => { if (!Array.isArray(x)) throw new Error(`The ${what} section must be a list.`); if (x.length > max) throw new Error(`The ${what} section has too many entries.`); return x; };
const ID = /^[\w-]{1,60}$/;
const tally = (existing: Set<string>, incoming: string[], mode: Mode): Plan => ({ add: incoming.filter((i) => !existing.has(i)).length, update: incoming.filter((i) => existing.has(i)).length, remove: mode === "replace" ? [...existing].filter((i) => !incoming.includes(i)).length : 0 });

export function registerOwnSections(ws: Registry, d: { store: Store; custom: Custom; webhooks: Webhooks; now: () => number; changed: () => void; forget?: (id: string) => void }) {
  const { store } = d;

  /** rules and macros share one shape: documents with ids and action lists. */
  const docs = <T extends { id: string }>(kind: "rule" | "macro", parse: (b: any, prev: T | undefined, now: number, id: string) => T) => {
    const prepare = (raw: unknown) => {
      const items = list(raw, kind === "rule" ? "rules" : "macros", 300);
      const seen = new Set<string>();
      return items.map((b, i) => {
        const id = String(b?.id ?? "");
        if (!ID.test(id)) throw new Error(`${kind === "rule" ? "Rule" : "Macro"} ${i + 1} needs an id.`);
        if (seen.has(id)) throw new Error(`Two ${kind}s share the id "${id}".`);
        seen.add(id);
        const { id: _i, updatedAt: _u, ...rest } = b;
        try { return parse({ ...rest, actions: stripSecrets(b.actions ?? []) }, store.get<T>(kind, id), d.now(), id); } catch (e: any) { throw new Error(`${kind === "rule" ? "Rule" : "Macro"} "${b?.name ?? b?.label ?? id}": ${e.message}`); }
      });
    };
    return {
      export: () => store.list<any>(kind).map(({ updatedAt: _u, ...x }) => ({ ...x, actions: stripSecrets(x.actions) })),
      plan: (raw: unknown, mode: Mode) => { const p = prepare(raw); return tally(new Set(store.list<T>(kind).map((x) => x.id)), p.map((x) => x.id), mode); },
      async import(raw: unknown, mode: Mode) {
        const p = prepare(raw);
        if (mode === "replace") for (const x of store.list<T>(kind)) if (!p.some((y) => y.id === x.id)) { store.del(kind, x.id); d.forget?.(x.id); }
        for (const x of p) store.put(kind, x);
        d.changed();
      },
    };
  };
  ws.register("rules", docs<RuleDoc>("rule", parseRule));
  ws.register("macros", docs<MacroDoc>("macro", parseMacro));

  ws.register("customFields", {
    export: () => d.custom.fields(),
    plan(raw, mode) {
      const items = list(raw, "customFields", 100);
      const ch: Record<string, Record<string, unknown>> = {};
      for (const f of items) { if (!f || typeof f.id !== "string") throw new Error("Each custom field needs an id."); const { id, ...rest } = f; ch[id] = rest; }
      for (const [k, p] of Object.entries(ch)) { const bad = d.custom.check(k, String(p.value ?? "")); if (bad) throw new Error(bad); }
      const have = new Set(d.custom.fields().map((f) => f.id));
      return tally(have, Object.keys(ch), mode);
    },
    async import(raw, mode) {
      const items = list(raw, "customFields", 100), ch: Record<string, Record<string, unknown>> = {};
      for (const f of items) { const { id, ...rest } = f; ch[id] = rest; }
      d.custom.apply(ch);
      if (mode === "replace") for (const f of d.custom.fields()) if (!(f.id in ch)) d.custom.remove(f.id);
    },
  });

  const hookItems = (raw: unknown) => list(raw, "webhooks", 20).map((b) => { const { id: _i, createdAt: _c, ...rest } = b ?? {}; return rest; });
  ws.register("webhooks", {
    export: () => d.webhooks.exportable(),
    plan(raw, mode) { const items = hookItems(raw); for (const b of items) parseWebhook(b, undefined, d.now()); return tally(new Set(store.list<WebhookDoc>("webhook").map((w) => w.name)), items.map((b) => b.name), mode); },
    async import(raw, mode) {
      const items = hookItems(raw), have = store.list<WebhookDoc>("webhook");
      const parsed = items.map((b) => { const prev = have.find((w) => w.name === b.name); return parseWebhook({ ...b, secret: undefined }, prev, d.now()); }); // an existing webhook keeps its secret; new ones start without
      if (mode === "replace") for (const w of have) if (!parsed.some((p) => p.name === w.name)) store.del("webhook", w.id);
      for (const p of parsed) store.put("webhook", p);
      d.changed();
    },
  });

  const ui = () => data.getSettings(store).ui;
  const LOOKS = ["theme", "accent", "density", "textScale", "reducedMotion", "customCss"] as const;
  const pick = (o: any, keys: readonly string[]) => Object.fromEntries(keys.filter((k) => o && k in o).map((k) => [k, o[k]]));
  const looksPatch = (raw: any, mode: Mode) => { if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("The looks section must be an object."); const p = pick(raw, LOOKS); const d0 = DEFAULT_UI(); return mode === "replace" ? { ...pick(d0, LOOKS), ...p } : p; };
  ws.register("looks", {
    export: () => pick(ui(), LOOKS),
    plan(raw, mode) { validateUi(looksPatch(raw, mode), ui()); return { add: 0, update: 1, remove: 0 }; },
    async import(raw, mode) { data.saveSettings(store, { ui: looksPatch(raw, mode) }); d.changed(); },
  });
  const layoutsPatch = (raw: any, mode: Mode) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("The layouts section must be an object.");
    const cur = ui(), patch: Record<string, unknown> = {};
    if (raw.layouts) {
      const incoming: any[] = raw.layouts.presets ?? [];
      const presets = mode === "replace" ? incoming : [...cur.layouts.presets.filter((p) => !incoming.some((q) => q?.id === p.id)), ...incoming];
      patch.layouts = { active: raw.layouts.active ?? cur.layouts.active, presets };
    }
    if (raw.macroButtons) patch.macroButtons = raw.macroButtons;
    return patch;
  };
  ws.register("layouts", {
    export: () => { const u = ui(); return { layouts: u.layouts, macroButtons: u.macroButtons }; },
    plan(raw, mode) { const patch = layoutsPatch(raw, mode); validateUi(patch, ui()); const n = (patch.layouts as any)?.presets?.length ?? 0; return { add: Math.max(0, n - ui().layouts.presets.length), update: Math.min(n, ui().layouts.presets.length), remove: 0, note: patch.macroButtons ? "macro buttons included" : undefined }; },
    async import(raw, mode) { data.saveSettings(store, { ui: layoutsPatch(raw, mode) }); d.changed(); },
  });
}
