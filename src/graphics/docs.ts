// Graphic documents: validation, defaults and storage in the docs table (kind "graphic").
import { newId } from "../data";
import type { Store } from "../store";
import { BUILTIN_IDS, builtinDocId, defaultBuiltin, defaultStyle, fade } from "./builtins";
import { BUILTIN_PARTS, KINDS, ROLES, type AnimSpec, type Anchor, type FieldDef, type GraphicDoc, type GraphicKind } from "./types";

const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === "object" && !Array.isArray(x);
const num = (v: unknown, lo: number, hi: number, what: string, dflt: number) => { if (v === undefined) return dflt; if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) throw new Error(`${what} must be a number from ${lo} to ${hi}.`); return v; };
const txt = (v: unknown, max: number, what: string, dflt = "") => { if (v === undefined) return dflt; if (typeof v !== "string" || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) throw new Error(`${what} must be text of at most ${max} characters.`); return v; };
const oneOf = <T extends string>(v: unknown, list: readonly T[], what: string, dflt: T): T => { if (v === undefined) return dflt; if (!list.includes(v as T)) throw new Error(`${what} must be one of: ${list.join(", ")}.`); return v as T; };
const COLOR = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,30}|(rgb|rgba|hsl|hsla)\([0-9 ,.%/]+\))$/;
export const ANCHORS: Anchor[] = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"];
const PRESETS = ["none", "fade", "slide-left", "slide-right", "slide-up", "slide-down", "wipe", "scale"] as const;
const EASINGS = ["linear", "ease", "ease-in", "ease-out", "ease-in-out"] as const;
export const SAFE_PATH = /^(?!.*(^|\/)\.\.?(\/|$))[\w\-. ]+(\/[\w\-. ]+)*$/;

export function httpUrl(v: unknown, what: string, allowEmpty = false): string {
  const s = txt(v, 2000, what).trim();
  if (!s && allowEmpty) return "";
  let u: URL; try { u = new URL(s); } catch { throw new Error(`${what} must be a web address such as https://example.com/overlay.`); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`${what} must start with http:// or https://.`);
  return u.toString();
}

function anim(v: unknown, cur: AnimSpec, what: string): AnimSpec {
  if (v === undefined) return cur;
  if (!isObj(v)) throw new Error(`${what} animation must be an object.`);
  return { preset: oneOf(v.preset, PRESETS, `${what} animation preset`, cur.preset), durationMs: num(v.durationMs, 0, 5000, `${what} duration`, cur.durationMs), delayMs: num(v.delayMs, 0, 5000, `${what} delay`, cur.delayMs), easing: oneOf(v.easing, EASINGS, `${what} easing`, cur.easing) };
}
function fields(v: unknown, cur: FieldDef[]): FieldDef[] {
  if (v === undefined) return cur;
  if (!Array.isArray(v) || v.length > 40) throw new Error("Fields must be a list of at most 40.");
  const seen = new Set<string>();
  return v.map((x, i) => {
    if (!isObj(x)) throw new Error(`Field ${i + 1} is not valid.`);
    const name = txt(x.name, 40, "A field name");
    if (!/^[A-Za-z_][\w.\-]*$/.test(name)) throw new Error(`Field name "${name}" may only use letters, digits, _ . and -, and must start with a letter.`);
    if (seen.has(name)) throw new Error(`Two fields are called "${name}".`);
    seen.add(name);
    const b = isObj(x.binding) ? x.binding : {};
    return { name, label: txt(x.label, 60, "A field label", name), type: oneOf(x.type, ["text", "number", "color", "image", "bool"] as const, "A field type", "text"), default: txt(x.default, 2000, "A field default"),
      binding: { kind: oneOf(b.kind, ["var", "const", "manual"] as const, "A binding kind", "manual"), value: txt(b.value, 2000, "A binding value") } };
  });
}

/** Merge `input` onto `base`, validating everything. `base` is the current doc (update) or a blank starting point (create). */
export function mergeGraphic(base: GraphicDoc, input: unknown): GraphicDoc {
  if (!isObj(input)) throw new Error("A graphic must be an object.");
  const d: any = structuredClone(base);
  if (input.name !== undefined) { d.name = txt(input.name, 60, "The name").trim(); if (!d.name) throw new Error("Give the graphic a name."); }
  if (input.description !== undefined) d.description = txt(input.description, 300, "The description");
  if (input.enabled !== undefined) { if (typeof input.enabled !== "boolean") throw new Error("enabled must be true or false."); d.enabled = input.enabled; }
  if (input.role !== undefined) d.role = oneOf(input.role, ROLES, "The role", d.role);
  if (input.requiresGame !== undefined) d.requiresGame = !!input.requiresGame;
  if (input.placement !== undefined) {
    const p = input.placement; if (!isObj(p)) throw new Error("placement must be an object.");
    d.placement = { anchor: oneOf(p.anchor, ANCHORS, "The anchor", d.placement.anchor), x: num(p.x, -4000, 4000, "x", d.placement.x), y: num(p.y, -4000, 4000, "y", d.placement.y), scale: num(p.scale, 0.1, 5, "scale", d.placement.scale),
      z: Math.round(num(p.z, -100, 1000, "z", d.placement.z)), opacity: num(p.opacity, 0, 1, "opacity", d.placement.opacity) };
  }
  if (input.animation !== undefined) { if (!isObj(input.animation)) throw new Error("animation must be an object."); d.animation = { in: anim(input.animation.in, d.animation.in, "In"), out: anim(input.animation.out, d.animation.out, "Out") }; }
  if (input.show !== undefined) {
    const s = input.show; if (!isObj(s)) throw new Error("show must be an object.");
    d.show = { mode: oneOf(s.mode, ["manual", "always", "while-live", "auto-hide"] as const, "The show mode", d.show.mode), seconds: s.seconds === undefined ? d.show.seconds : num(s.seconds, 1, 3600, "Auto-hide seconds", 8), startVisible: s.startVisible === undefined ? d.show.startVisible : !!s.startVisible };
    if (d.show.mode === "auto-hide" && !d.show.seconds) d.show.seconds = 8;
  }
  d.fields = fields(input.fields, d.fields);
  if (input.style !== undefined) {
    const s = input.style; if (!isObj(s)) throw new Error("style must be an object.");
    const st = d.style;
    if (s.colors !== undefined) { if (!isObj(s.colors)) throw new Error("colors must be an object."); for (const [k, c] of Object.entries(s.colors)) { if (!(k in st.colors)) throw new Error(`Unknown colour: ${k}.`); if (typeof c !== "string" || !COLOR.test(c)) throw new Error(`The colour ${k} is not valid. Use something like #F5A524.`); st.colors[k] = c; } }
    st.radius = num(s.radius, 0, 100, "radius", st.radius); st.fontWeight = num(s.fontWeight, 100, 900, "font weight", st.fontWeight); st.fontSize = num(s.fontSize, 8, 200, "font size", st.fontSize); st.scoreSize = num(s.scoreSize, 8, 300, "score size", st.scoreSize); st.speed = num(s.speed, 10, 2000, "speed", st.speed);
    if (s.shadow !== undefined) st.shadow = !!s.shadow;
    if (s.fontFamily !== undefined) { st.fontFamily = txt(s.fontFamily, 60, "The font"); if (!/^[\w \-]*$/.test(st.fontFamily)) throw new Error("The font name may only use letters, digits, spaces and dashes."); }
    if (s.parts !== undefined) { if (!isObj(s.parts)) throw new Error("parts must be an object."); for (const [k, on] of Object.entries(s.parts)) { if (d.kind === "builtin" && !(BUILTIN_PARTS[d.builtinId] ?? []).includes(k)) throw new Error(`This graphic has no part called "${k}".`); st.parts[k] = !!on; } }
  }
  const s = input.source;
  if (s !== undefined && !isObj(s)) throw new Error("source must be an object.");
  const so: any = { ...d.source, ...(s ?? {}) };
  const size = () => { so.width = Math.round(num(so.width, 16, 7680, "width", 1920)); so.height = Math.round(num(so.height, 16, 4320, "height", 1080)); };
  switch (d.kind as GraphicKind) {
    case "builtin": d.source = {}; break;
    case "html": case "caspar": {
      so.entry = txt(so.entry, 200, "The entry file", "index.html"); if (!SAFE_PATH.test(so.entry) || !/\.html?$/i.test(so.entry)) throw new Error("The entry file must be an .html file inside the graphic's folder.");
      size(); so.allowNetwork = !!so.allowNetwork;
      if (d.kind === "caspar") { so.dataFormat = oneOf(so.dataFormat, ["xml", "json"] as const, "The data format", "xml"); so.stopHoldMs = Math.round(num(so.stopHoldMs, 0, 30000, "Hold after stop", 1500)); so.nextIsPlay = !!so.nextIsPlay; }
      d.source = so; break;
    }
    case "url": so.url = httpUrl(so.url, "The address"); size(); so.css = txt(so.css, 4000, "The extra CSS"); d.source = { url: so.url, width: so.width, height: so.height, css: so.css }; break;
    case "remote":
      so.connectorId = txt(so.connectorId, 80, "The connector"); if (!isObj(so.target ?? {})) throw new Error("target must be an object."); so.target ??= {};
      if (JSON.stringify(so.target).length > 4000) throw new Error("The target settings are too long.");
      so.outputUrl = httpUrl(so.outputUrl ?? "", "The output address", true); size(); so.css = txt(so.css, 4000, "The extra CSS");
      d.source = { connectorId: so.connectorId, target: so.target, outputUrl: so.outputUrl, width: so.width, height: so.height, css: so.css }; break;
  }
  d.updatedAt = Date.now();
  return d;
}

const blankStart = (kind: GraphicKind, now: number): GraphicDoc => ({
  id: "", name: "", enabled: true, role: "other", kind, source: {} as any, placement: { anchor: "center", x: 0, y: 0, scale: 1, z: 10, opacity: 1 }, animation: { in: fade(), out: fade() },
  show: { mode: "manual" }, requiresGame: false, fields: [], style: defaultStyle(), createdAt: now, updatedAt: now,
} as GraphicDoc);

/** A new user graphic (never a built-in; those come from builtins.ts). */
export function createGraphic(input: any, now = Date.now()): GraphicDoc {
  const kind = oneOf(input?.kind, KINDS.filter((k) => k !== "builtin"), "The kind", "html");
  const d = mergeGraphic(blankStart(kind, now), { ...input, name: input?.name ?? "New graphic" });
  d.id = newId("gfx"); d.createdAt = d.updatedAt = now;
  return d;
}

/** The seeded built-ins (ids builtin-*). Copies of them are ordinary user graphics that look like a built-in. */
export const isSeed = (id: string) => id.startsWith("builtin-");
const strip = (d: GraphicDoc) => { const { id, createdAt, updatedAt, modified, ...rest } = d as any; return JSON.stringify(rest); };
export const isModified = (d: GraphicDoc) => d.kind === "builtin" && strip(d) !== strip(defaultBuiltin(d.builtinId!));

export const listGraphics = (store: Store): GraphicDoc[] => store.list<GraphicDoc>("graphic");
export const getGraphic = (store: Store, id: string) => store.get<GraphicDoc>("graphic", id);
export function ensureBuiltins(store: Store, now = Date.now()) { for (const b of BUILTIN_IDS) if (!getGraphic(store, builtinDocId(b))) store.put("graphic", defaultBuiltin(b, now)); }
export function saveGraphic(store: Store, id: string, input: unknown): GraphicDoc {
  const cur = getGraphic(store, id); if (!cur) throw new Error("Graphic not found.");
  const next = mergeGraphic(cur, input);
  if (isSeed(next.id)) next.modified = isModified(next);
  return store.put("graphic", next);
}
export function resetBuiltin(store: Store, id: string): GraphicDoc {
  const cur = getGraphic(store, id);
  if (!cur || !isSeed(id)) throw new Error("Only the built-in graphics can be reset to default.");
  return store.put("graphic", { ...defaultBuiltin(cur.builtinId!), createdAt: cur.createdAt });
}
export function duplicateGraphic(store: Store, id: string, name?: string, now = Date.now()): GraphicDoc {
  const cur = getGraphic(store, id); if (!cur) throw new Error("Graphic not found.");
  const copy: any = structuredClone(cur);
  Object.assign(copy, { id: newId("gfx"), name: (name ?? `${cur.name} copy`).slice(0, 60), createdAt: now, updatedAt: now });
  delete copy.builtinId; delete copy.modified;
  if (cur.kind === "builtin") copy.kind = "builtin", copy.builtinId = cur.builtinId; // a copy of a built-in stays a built-in look, but is a separate, deletable document
  return store.put("graphic", copy);
}
