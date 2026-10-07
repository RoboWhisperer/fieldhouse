// Theme palettes and the settings -> CSS-variable mapping (documented in docs/dev/customization.md). web/tokens.css is NOT changed:
// the web app applies the variables below on top of it. Colour maths follows WCAG 2.x (relative luminance, contrast ratio).
import type { UiSettings } from "./ui-settings";

export type Palette = Record<string, string>;
const hex = (c: string): [number, number, number] => { const h = c.replace("#", ""), f = h.length === 3 ? h.replace(/./g, "$&$&") : h; return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)) as [number, number, number]; };
const toHex = (c: number[]) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("").toUpperCase();
export const luminance = (c: string) => { const [r, g, b] = hex(c).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
export const mix = (a: string, b: string, t: number) => { const [p, q] = [hex(a), hex(b)]; return toHex(p.map((v, i) => v + (q[i] - v) * t)); };
/** Black or white, whichever reads better on `bg`. */
export const inkOn = (bg: string) => (contrast("#000000", bg) >= contrast("#FFFFFF", bg) ? "#000000" : "#FFFFFF");
/** Move `c` toward black or white until it reaches `min` contrast on `bg` (keeps the hue as far as possible). */
export function ensureContrast(c: string, bg: string, min = 4.5): string {
  const toward = luminance(bg) > 0.4 ? "#000000" : "#FFFFFF";
  for (let t = 0; t <= 1.001; t += 0.05) { const x = mix(c, toward, t); if (contrast(x, bg) >= min) return x; }
  return toward;
}

// Dark mirrors web/tokens.css (the shipped look). Light and high-contrast are new and checked by the test suite.
export const PALETTES: Record<"dark" | "light" | "high-contrast", Palette> = {
  dark: {
    ground: "#0B1018", panel: "#121A26", raised: "#1A2433", inset: "#0E1520", line: "#263246", "line-strong": "#35445C",
    text: "#EAF0F7", "text-2": "#9FB0C5", "text-3": "#8294AC",
    action: "#3D8BFD", "action-hi": "#5B9EFF", "action-ink": "#06101F", "action-wash": "#13294A", "action-fill": "#2E6FD8",
    program: "#E5484D", "program-fill": "#C72D35", "program-wash": "#3A151B", ready: "#2FB67C", "ready-wash": "#10302A", caution: "#FF8A3D", "caution-wash": "#38210F",
    led: "#FFB224", "led-dim": "#3A2A0C", home: "#F5A524", away: "#8B6CFF",
  },
  light: {
    ground: "#F2F5F9", panel: "#FFFFFF", raised: "#EAEFF6", inset: "#E3E9F1", line: "#BAC6D6", "line-strong": "#7F90A8",
    text: "#0E1928", "text-2": "#34445C", "text-3": "#4F5F78",
    action: "#1F5FD0", "action-hi": "#1A53B8", "action-ink": "#FFFFFF", "action-wash": "#DCE8FB", "action-fill": "#1F5FD0",
    program: "#B3202A", "program-fill": "#B3202A", "program-wash": "#F9DDE0", ready: "#0B7048", "ready-wash": "#D8F0E5", caution: "#954300", "caution-wash": "#FBE6D3",
    led: "#8F5A00", "led-dim": "#F3E3C4", home: "#8A5200", away: "#5237C4",
  },
  "high-contrast": {
    ground: "#000000", panel: "#000000", raised: "#121212", inset: "#000000", line: "#9A9A9A", "line-strong": "#FFFFFF",
    text: "#FFFFFF", "text-2": "#F0F0F0", "text-3": "#DADADA",
    action: "#7DBBFF", "action-hi": "#A8D1FF", "action-ink": "#000000", "action-wash": "#0A2342", "action-fill": "#7DBBFF",
    program: "#FF7A7F", "program-fill": "#FF7A7F", "program-wash": "#3D0F14", ready: "#4DE8A6", "ready-wash": "#0B3326", caution: "#FFB27A", "caution-wash": "#3D2200",
    led: "#FFD166", "led-dim": "#3D3000", home: "#FFC857", away: "#C4B5FF",
  },
};
/** Pairs that must read well (WCAG AA): [foreground token, background token, minimum ratio]. Text 4.5, UI parts 3. */
export const CONTRAST_PAIRS: [string, string, number][] = [
  ["text", "ground", 4.5], ["text", "panel", 4.5], ["text", "raised", 4.5], ["text", "inset", 4.5],
  ["text-2", "panel", 4.5], ["text-2", "raised", 4.5], ["text-3", "panel", 4.5], ["text-3", "ground", 4.5],
  ["action-ink", "action", 4.5], ["action-ink", "action-fill", 4.5], ["action-hi", "panel", 4.5], ["action-hi", "raised", 4.5],
  ["program", "panel", 4.5], ["ready", "panel", 4.5], ["caution", "panel", 4.5], ["led", "panel", 4.5],
  ["line-strong", "panel", 3], ["action", "panel", 3],
];

export const DENSITY = {
  compact: { "--ui-gap": "6px", "--ui-pad": "6px", "--ui-row": "28px" },
  comfortable: { "--ui-gap": "10px", "--ui-pad": "10px", "--ui-row": "36px" },
  spacious: { "--ui-gap": "14px", "--ui-pad": "14px", "--ui-row": "44px" },
} as const;

/** One palette with the operator's accent applied. Everything stays AA: the ink and the text-colour accent are recomputed. */
export function themeVars(base: keyof typeof PALETTES, accent?: string): Record<string, string> {
  const p = { ...PALETTES[base] };
  if (accent) {
    const a = accent.toUpperCase();
    p.action = a; p["action-ink"] = inkOn(a);
    p["action-fill"] = a; // the ink above is black or white, whichever reads better on the accent: always at least 4.5:1
    p["action-hi"] = ensureContrast(a, p.raised, 4.5);
    if (contrast(p["action-hi"], p.panel) < 4.5) p["action-hi"] = ensureContrast(a, p.panel, 4.5);
    p["action-wash"] = mix(p.panel, a, base === "light" ? 0.15 : 0.22);
  }
  return Object.fromEntries(Object.entries(p).map(([k, v]) => [`--${k}`, v]));
}

/** Everything the web app needs to restyle itself: one variable map per theme (resolve "auto" with prefers-color-scheme), shared variables and attributes. */
export function buildTokens(ui: UiSettings) {
  const accent = ui.accent || undefined;
  return {
    theme: ui.theme, // dark | light | high-contrast | auto  (auto = light when the system prefers light, else dark; high contrast only when chosen)
    themes: { dark: themeVars("dark", accent), light: themeVars("light", accent), "high-contrast": themeVars("high-contrast", accent) },
    common: { ...DENSITY[ui.density], "--ui-text-scale": String(ui.textScale) },
    attrs: { "data-density": ui.density, "data-motion": ui.reducedMotion === "on" ? "reduce" : ui.reducedMotion === "off" ? "full" : "system" },
    customCss: ui.customCss,
  };
}
