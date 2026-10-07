// settings.ui: how the console looks and which panels it shows. Data model, validation and the layout-preset operations only;
// the screens that edit it live in web/. Saved through the normal PUT /api/settings ({"ui": {...}}) or the /api/ui routes.
export const THEMES = ["dark", "light", "high-contrast", "auto"] as const;
export const DENSITIES = ["compact", "comfortable", "spacious"] as const;
export const MOTION = ["system", "on", "off"] as const; // "on" = always reduce motion, "off" = always allow it
export const PANELS = ["graphics", "audio", "events", "sponsor", "game", "replay", "custom", "macros"] as const;
export const COLUMNS = ["left", "center", "right"] as const;
export type Panel = (typeof PANELS)[number];
export interface LayoutPreset { id: string; name: string; builtin?: boolean; columns: Record<(typeof COLUMNS)[number], Panel[]>; hidden: Panel[] }
export interface MacroButton { macroId: string; color?: string; size?: "normal" | "large" }
export interface UiSettings {
  theme: (typeof THEMES)[number]; accent: string; density: (typeof DENSITIES)[number]; textScale: number;
  reducedMotion: (typeof MOTION)[number]; customCss: string;
  layouts: { active: string; presets: LayoutPreset[] };
  macroButtons: MacroButton[];
}
export const LIMITS = { css: 8000, presets: 12, name: 40, macroButtons: 24 };
const DEFAULT_COLUMNS: LayoutPreset["columns"] = { left: ["game", "events"], center: ["graphics", "macros", "replay"], right: ["audio", "sponsor", "custom"] };
export const defaultPreset = (): LayoutPreset => ({ id: "default", name: "Default", builtin: true, columns: structuredClone(DEFAULT_COLUMNS), hidden: [] });
export const DEFAULT_UI = (): UiSettings => ({ theme: "dark", accent: "", density: "comfortable", textScale: 1, reducedMotion: "system", customCss: "", layouts: { active: "default", presets: [defaultPreset()] }, macroButtons: [] });

const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === "object" && !Array.isArray(x);

// ---------------------------------------------------------------- custom CSS
/**
 * Custom CSS is applied only in the local console (never on phones, never in the OBS overlay). It is checked, not rewritten: a style that
 * could load something from the network, run script or break out of the <style> element is refused with a plain explanation.
 *   Allowed: ordinary rules, custom properties, @media, @keyframes, url(data:image/png|jpeg|gif|webp;base64,...).
 *   Refused: @import, @charset, @namespace, url() of anything else, image-set(), src(), expression(), javascript:, vbscript:, behavior,
 *            -moz-binding, any "scheme://" text, backslash escapes, angle brackets, more than 8000 characters.
 */
export function checkCss(css: unknown): string {
  if (typeof css !== "string") throw new Error("Custom CSS must be text.");
  if (css.length > LIMITS.css) throw new Error(`Custom CSS can be at most ${LIMITS.css} characters.`);
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/url\(\s*(["']?)data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+\/=]+\1\s*\)/gi, "url(data)");
  const bad: [RegExp, string][] = [
    [/@(import|charset|namespace|font-face)\b/i, "@import, @charset, @namespace and @font-face are not allowed"],
    [/url\s*\((?!data\))/i, "url() may only hold a small embedded image (data:image/png, jpeg, gif or webp)"],
    [/image-set\s*\(|\bsrc\s*\(|element\s*\(|cross-fade\s*\(/i, "image-set(), src(), element() and cross-fade() are not allowed"],
    [/expression\s*\(|javascript:|vbscript:|behaviou?r\s*:|-moz-binding/i, "scripting in CSS is not allowed"],
    [/[a-z][a-z0-9+.\-]*:\/\//i, "web addresses are not allowed in custom CSS"],
    [/\\/, "backslash escapes are not allowed"],
    [/[<>]/, "angle brackets are not allowed"],
  ];
  for (const [re, why] of bad) if (re.test(bare)) throw new Error(`Custom CSS was not saved: ${why}.`);
  let depth = 0; for (const ch of bare) { depth += ch === "{" ? 1 : ch === "}" ? -1 : 0; if (depth < 0) break; }
  if (depth !== 0) throw new Error("Custom CSS was not saved: the curly brackets { } do not match.");
  return css;
}

// ---------------------------------------------------------------- layouts
const panelList = (v: unknown, what: string): Panel[] => {
  if (!Array.isArray(v)) throw new Error(`${what} must be a list of panels.`);
  for (const p of v) if (!PANELS.includes(p)) throw new Error(`"${String(p).slice(0, 30)}" is not a console panel. Panels: ${PANELS.join(", ")}.`);
  return v as Panel[];
};
/** Every panel ends up in exactly one place; panels you did not place are hidden. */
export function parsePreset(b: unknown, prev?: LayoutPreset): LayoutPreset {
  if (!isObj(b)) throw new Error("A layout must be an object.");
  const id = String(b.id ?? prev?.id ?? "");
  if (!/^[a-z0-9_-]{1,40}$/.test(id)) throw new Error("A layout id can use lowercase letters, digits, dashes and underscores.");
  const name = String(b.name ?? prev?.name ?? "").trim();
  if (!name || name.length > LIMITS.name || /[\u0000-\u001f<>]/.test(name)) throw new Error(`A layout name is required (up to ${LIMITS.name} characters, no < or >).`);
  const cols = isObj(b.columns) ? b.columns : prev?.columns ?? DEFAULT_COLUMNS;
  for (const k of Object.keys(cols)) if (!COLUMNS.includes(k as any)) throw new Error(`Unknown column "${k}". Columns: ${COLUMNS.join(", ")}.`);
  const seen = new Set<string>(), out: any = {};
  for (const c of COLUMNS) { out[c] = panelList(cols[c] ?? [], `Column ${c}`).filter((p) => !seen.has(p) && seen.add(p)); }
  const hidden = panelList(b.hidden ?? prev?.hidden ?? [], "hidden").filter((p) => !seen.has(p) && seen.add(p));
  for (const p of PANELS) if (!seen.has(p)) hidden.push(p);
  return { id, name, ...(id === "default" || prev?.builtin ? { builtin: true } : {}), columns: out, hidden };
}

export function validateUi(patch: unknown, cur: UiSettings): UiSettings {
  if (!isObj(patch)) throw new Error("ui must be an object.");
  const next: UiSettings = structuredClone(cur);
  for (const [k, v] of Object.entries(patch)) {
    switch (k) {
      case "theme": if (!THEMES.includes(v)) throw new Error(`Theme must be one of: ${THEMES.join(", ")}.`); next.theme = v; break;
      case "accent": if (v !== "" && !(typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v))) throw new Error('The accent color must look like #3D8BFD (or "" for the default).'); next.accent = v.toUpperCase(); break;
      case "density": if (!DENSITIES.includes(v)) throw new Error(`Density must be one of: ${DENSITIES.join(", ")}.`); next.density = v; break;
      case "textScale": if (typeof v !== "number" || !(v >= 0.9 && v <= 1.3)) throw new Error("Text size must be a number from 0.9 to 1.3."); next.textScale = Math.round(v * 100) / 100; break;
      case "reducedMotion": if (!MOTION.includes(v)) throw new Error(`Reduced motion must be one of: ${MOTION.join(", ")}.`); next.reducedMotion = v; break;
      case "customCss": next.customCss = checkCss(v); break;
      case "macroButtons": {
        if (!Array.isArray(v) || v.length > LIMITS.macroButtons) throw new Error(`Macro buttons must be a list of at most ${LIMITS.macroButtons}.`);
        const ids = new Set<string>();
        next.macroButtons = v.map((b: any) => {
          if (!isObj(b) || typeof b.macroId !== "string" || !b.macroId || b.macroId.length > 80) throw new Error("Each macro button needs a macroId.");
          if (ids.has(b.macroId)) throw new Error("A macro can only appear once in the macro buttons.");
          ids.add(b.macroId);
          if (b.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(b.color)) throw new Error("A macro button color must look like #3D8BFD.");
          if (b.size !== undefined && !["normal", "large"].includes(b.size)) throw new Error("A macro button size is normal or large.");
          return { macroId: b.macroId, ...(b.color ? { color: b.color.toUpperCase() } : {}), ...(b.size ? { size: b.size } : {}) };
        });
        break;
      }
      case "layouts": {
        if (!isObj(v)) throw new Error("layouts must be an object with active and presets.");
        const list = Array.isArray(v.presets) ? v.presets : cur.layouts.presets;
        if (!list.length || list.length > LIMITS.presets) throw new Error(`There can be 1 to ${LIMITS.presets} layouts.`);
        const presets = list.map((p: any) => parsePreset(p, cur.layouts.presets.find((x) => x.id === p?.id)));
        if (new Set(presets.map((p: LayoutPreset) => p.id)).size !== presets.length) throw new Error("Two layouts have the same id.");
        if (!presets.some((p: LayoutPreset) => p.id === "default")) presets.unshift(defaultPreset());
        const active = v.active ?? cur.layouts.active;
        if (!presets.some((p: LayoutPreset) => p.id === active)) throw new Error("The active layout does not exist.");
        next.layouts = { active, presets: presets.slice(0, LIMITS.presets) };
        break;
      }
      default: throw new Error(`Unknown display setting: ${k}`);
    }
  }
  return next;
}

/** Merge saved data over the defaults so old databases get every new key. */
export const withUiDefaults = (saved: Partial<UiSettings> | undefined): UiSettings => { const d = DEFAULT_UI(); return { ...d, ...saved, layouts: saved?.layouts?.presets?.length ? saved.layouts : d.layouts, macroButtons: saved?.macroButtons ?? [] }; };

// ---------------------------------------------------------------- preset operations (each returns a `layouts` value to save)
type Layouts = UiSettings["layouts"];
const slugId = (name: string, taken: Set<string>) => { let base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "layout", id = base, n = 2; while (taken.has(id)) id = `${base}-${n++}`; return id; };
export function createLayout(l: Layouts, name: string, fromId?: string): { layouts: Layouts; id: string } {
  const src = l.presets.find((p) => p.id === fromId) ?? defaultPreset();
  const id = slugId(name, new Set(l.presets.map((p) => p.id)));
  return { layouts: { ...l, presets: [...l.presets, { ...structuredClone(src), id, name, builtin: undefined }] }, id };
}
export function deleteLayout(l: Layouts, id: string): Layouts {
  const p = l.presets.find((x) => x.id === id);
  if (!p) throw new Error("That layout does not exist.");
  if (p.builtin) throw new Error("The default layout cannot be deleted. Use Reset to default instead.");
  return { active: l.active === id ? "default" : l.active, presets: l.presets.filter((x) => x.id !== id) };
}
export const resetLayout = (l: Layouts, id: string): Layouts => {
  if (!l.presets.some((x) => x.id === id)) throw new Error("That layout does not exist.");
  return { ...l, presets: l.presets.map((p) => (p.id === id ? { ...defaultPreset(), id: p.id, name: p.name, builtin: p.builtin } : p)) };
};
