// Which font families really render in the browser that draws the overlay (OBS's embedded Chromium). The overlay page measures
// text widths for a list of candidates and reports the hits; we keep the latest report from OBS and from any other browser.
import type { Store } from "../store";

export interface FontReport { families: string[]; generics?: Record<string, boolean>; at: number; source: "obs" | "browser"; userAgent: string; webFonts?: { supported: boolean | null; detail: string } }
const NOTE = "Built-in designs can use the families listed here. A custom graphic can also bring its own font file (.woff2, .ttf or .otf inside its folder, loaded with @font-face): that works in OBS. Do not rely on generic names such as serif or sans-serif, or on fonts from the internet: on some computers OBS draws nothing for them. Fieldhouse adds Arial, Helvetica and similar names that map to the families below."
const clean = (a: unknown) => (Array.isArray(a) ? [...new Set(a.filter((x): x is string => typeof x === "string" && /^[\w \-]{1,60}$/.test(x)))].slice(0, 300).sort() : []);

export function reportFonts(store: Store, body: any, now = Date.now()): FontReport {
  const r: FontReport = { families: clean(body?.families), generics: body?.generics && typeof body.generics === "object" ? Object.fromEntries(Object.entries(body.generics).filter(([k]) => /^[\w-]{1,20}$/.test(k)).map(([k, v]) => [k, v === true])) : undefined, at: now, source: body?.obs === true ? "obs" : "browser", userAgent: String(body?.userAgent ?? "").slice(0, 300),
    webFonts: body?.webFonts && typeof body.webFonts === "object" ? { supported: typeof body.webFonts.supported === "boolean" ? body.webFonts.supported : null, detail: String(body.webFonts.detail ?? "").slice(0, 300) } : undefined };
  store.put("fontprobe", { id: r.source, ...r });
  return r;
}
export function fontsView(store: Store) {
  const obs = store.get<FontReport>("fontprobe", "obs"), browser = store.get<FontReport>("fontprobe", "browser"), use = obs ?? browser;
  return { families: use?.families ?? [], source: use ? use.source : "none", probedAt: use?.at ?? null, webFonts: use?.webFonts ?? null, generics: use?.generics ?? null,
    note: !use ? "No font check has run yet. It runs by itself the first time the overlay is loaded (in OBS or in a browser). " + NOTE : (use.source === "browser" ? "Measured in a normal browser, not in OBS, so the list may differ in the program. " : "Measured inside OBS's browser source. ") + NOTE };
}
