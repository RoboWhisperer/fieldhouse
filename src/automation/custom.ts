// Custom data: operator-defined text fields ("sponsorLine", "homeCoach", "tickerText") that templates and rules read as custom.<key>.
// Stored one doc per field (kind "custom", id = key) in the docs store; the whole set is cached in memory and shown in state().custom.
import type { Store } from "../store";
import type { CustomData } from "../custom-types";

export const FIELD_TYPES = ["text", "number", "color", "image", "bool"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export interface CustomField { id: string; label: string; type: FieldType; default: string; value: string }
export const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
export const MAX_FIELDS = 100, MAX_VALUE = 500, MAX_LABEL = 60;
export class CustomError extends Error {}

const CONTROL = /[\u0000-\u001f\u007f]/;
/** Check one value against a field type. Returns an error sentence or null. */
export function checkValue(type: FieldType, v: string, what = "The value"): string | null {
  if (v.length > MAX_VALUE) return `${what} can be at most ${MAX_VALUE} characters.`;
  if (CONTROL.test(v)) return `${what} cannot contain line breaks or control characters.`;
  if (v === "") return null;
  switch (type) {
    case "number": return Number.isFinite(Number(v)) ? null : `${what} must be a number.`;
    case "color": return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? null : `${what} must be a color like #1a2b3c.`;
    case "bool": return v === "true" || v === "false" ? null : `${what} must be true or false.`;
    case "image": return /^(https?:\/\/[^\s]+|\/[^\s]*|data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+\/=]+|[\w\-. ]+\/?[\w\-. \/]*)$/.test(v) && !v.includes("..") ? null : `${what} must be an image address (https://..., a file name or a path).`;
    default: return null;
  }
}

export function createCustom(store: Store, onChange: (key: string, value: string | null, old: string | null) => void = () => {}) {
  const fields = new Map<string, CustomField>();
  for (const f of store.list<CustomField>("custom")) fields.set(f.id, f);
  const valueOf = (f: CustomField) => (f.value !== "" ? f.value : f.default);

  /** Validate a patch for one key against what exists; returns the field it would become. */
  function plan(key: string, p: Record<string, unknown>): CustomField {
    if (typeof key !== "string" || !KEY_RE.test(key)) throw new CustomError(`"${String(key).slice(0, 40)}" is not a valid name. Use letters, digits and underscores, starting with a letter (up to 40).`);
    if (!p || typeof p !== "object" || Array.isArray(p)) throw new CustomError(`The settings for "${key}" must be an object.`);
    for (const k of Object.keys(p)) if (!["value", "label", "type", "default"].includes(k)) throw new CustomError(`Unknown field setting "${k}" for "${key}".`);
    const cur = fields.get(key);
    const f: CustomField = cur ? { ...cur } : { id: key, label: key, type: "text", default: "", value: "" };
    if ("type" in p) { if (!FIELD_TYPES.includes(p.type as FieldType)) throw new CustomError(`"${key}": type must be one of ${FIELD_TYPES.join(", ")}.`); f.type = p.type as FieldType; }
    if ("label" in p) { if (typeof p.label !== "string" || p.label.length > MAX_LABEL || CONTROL.test(p.label)) throw new CustomError(`"${key}": the label must be plain text up to ${MAX_LABEL} characters.`); f.label = p.label.trim() || key; }
    for (const k of ["value", "default"] as const) if (k in p) {
      const v = p[k] === null ? "" : typeof p[k] === "number" || typeof p[k] === "boolean" ? String(p[k]) : p[k];
      if (typeof v !== "string") throw new CustomError(`"${key}": ${k} must be text.`);
      f[k] = v;
    }
    for (const k of ["value", "default"] as const) { const err = checkValue(f.type, f[k], `"${key}" ${k}`); if (err) throw new CustomError(err); }
    return f;
  }

  /** Apply many changes at once: all are validated first, so a bad one changes nothing. */
  function apply(changes: Record<string, Record<string, unknown>>) {
    const next = Object.entries(changes).map(([k, p]) => plan(k, p));
    const fresh = next.filter((f) => !fields.has(f.id)).length;
    if (fields.size + fresh > MAX_FIELDS) throw new CustomError(`You can have at most ${MAX_FIELDS} custom fields.`);
    for (const f of next) {
      const old = fields.has(f.id) ? valueOf(fields.get(f.id)!) : null;
      fields.set(f.id, f); store.put("custom", f);
      const now = valueOf(f);
      if (old !== now) onChange(f.id, now, old);
    }
  }

  const api: CustomData & { fields(): CustomField[]; check(key: string, value: string): string | null; apply: typeof apply; define(key: string, p: Record<string, unknown>): void; has(key: string): boolean } = {
    all: () => Object.fromEntries([...fields.values()].map((f) => [f.id, valueOf(f)])),
    set: (key, value) => apply({ [key]: { value } }),
    remove(key) { const f = fields.get(key); if (!f) return; fields.delete(key); store.del("custom", key); onChange(key, null, valueOf(f)); },
    fields: () => [...fields.values()].map((f) => ({ ...f })),
    /** Would this value be accepted? Returns the plain-language problem, or null. Changes nothing. */
    check(key: string, value: string): string | null { try { plan(key, { value }); return null; } catch (e: any) { return e.message; } },
    apply, define: (key, p) => apply({ [key]: p }), has: (k) => fields.has(k),
  };
  return api;
}
export type Custom = ReturnType<typeof createCustom>;
