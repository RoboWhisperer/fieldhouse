// CasparCG HTML template support: what to send to update() (XML or JSON text), and reading a template to find its fields.
import type { Entry } from "./zip";
import { extOf } from "./zip";
import type { FieldDef } from "./types";

const xmlEsc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const typed = (v: string, t: FieldDef["type"]) => (t === "number" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : t === "bool" ? v === "true" || v === "1" : v);

/** The string handed to the template's update(). XML is what Flash-style templates and CasparCG's CG ADD expect; JSON works with CasparCG 2.1+ templates. */
export function casparData(values: Record<string, string>, format: "xml" | "json", defs: FieldDef[] = []): string {
  if (format === "json") return JSON.stringify(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, typed(v, defs.find((d) => d.name === k)?.type ?? "text")])));
  return "<templateData>" + Object.entries(values).map(([k, v]) => `<componentData id="${xmlEsc(k)}"><data id="text" value="${xmlEsc(v)}"/></componentData>`).join("") + "</templateData>";
}

/** The template definition NoaCG Studio (and SPX) puts in the page: its name, playout layer, data format and operator fields. */
export interface SpxField { field: string; ftype?: string; title?: string; value?: string }
export interface SpxDefinition { description?: string; playlayer?: string | number; steps?: string | number; dataformat?: string; DataFields?: SpxField[] }

export interface AnalyzedField {
  id: string; label: string; type: FieldDef["type"]; default: string; found: string[];
  suggestion?: { kind: "var"; value: string };
}

export interface TemplateAnalysis {
  entry: string; entries: string[];
  functions: { play: boolean; stop: boolean; update: boolean; next: boolean };
  fields: AnalyzedField[];
  dataFormat: "xml" | "json"; needsNetwork: boolean; warnings: string[]; width: number; height: number;
  title?: string; layer?: number;
}

const GUESS: [RegExp, string][] = [
  [/team\s*a.*colou?r|colou?r.*team\s*a|home.*colou?r/i, "home.color"], [/team\s*b.*colou?r|colou?r.*team\s*b|away.*colou?r/i, "away.color"],
  [/score\s*a|home.*(score|pts|points)|(score|pts|points).*home/i, "home.score"], [/score\s*b|away.*(score|pts|points)|(score|pts|points).*away/i, "away.score"],
  [/team\s*a|home.*(abbr|short|code)/i, "home.abbr"], [/team\s*b|away.*(abbr|short|code)/i, "away.abbr"],
  [/home.*(name|team)|team.*home/i, "home.name"], [/away.*(name|team)|team.*away/i, "away.name"],
  [/period|quarter|half/i, "periodLabel"], [/\bclock\b/i, "clock"], [/venue|location/i, "game.venue"],
  [/subtitle|\bsub\b|name2|second line|\bbody\b/i, "lower.sub"], [/title|headline|name1|\bname\b/i, "lower.title"],
];
const text = (e: Entry) => new TextDecoder().decode(e.data);

/** Read `window.SPXGCTemplateDefinition = {...}` from a template page. The object is JSON, so no JS evaluator is needed. */
export function spxDefinition(html: string): SpxDefinition | undefined {
  const marker = html.indexOf("window.SPXGCTemplateDefinition");
  if (marker < 0) return undefined;
  const start = html.indexOf("{", marker);
  if (start < 0) return undefined;
  let depth = 0, quote = false, escape = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quote) { if (escape) escape = false; else if (c === "\\") escape = true; else if (c === '"') quote = false; continue; }
    if (c === '"') quote = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try { return JSON.parse(html.slice(start, i + 1)) as SpxDefinition; } catch { return undefined; }
    }
  }
  return undefined;
}

/** Every HTML page in the upload that carries a template definition. Used to recognise a multi-template production package. */
export function spxTemplates(files: Entry[]): { entry: string; definition: SpxDefinition }[] {
  return files.filter((f) => /\.html?$/i.test(f.path)).map((f) => {
    const definition = spxDefinition(text(f));
    return definition ? { entry: f.path, definition } : undefined;
  }).filter((x): x is { entry: string; definition: SpxDefinition } => !!x);
}

const fieldType = (ftype?: string): FieldDef["type"] => {
  const t = (ftype ?? "").toLowerCase();
  if (t === "number" || t === "slider") return "number";
  if (t === "color" || t === "colour") return "color";
  if (t === "filelist" || t === "image" || t === "file") return "image";
  if (t === "checkbox" || t === "toggle" || t === "bool") return "bool";
  if (t === "textarea" || t === "multiline") return "multiline";
  return "text";
};

const suggest = (id: string, label: string, description: string, fromDefinition: boolean) => {
  const hay = `${id} ${label}`;
  const hit = GUESS.find(([re]) => re.test(hay));
  if (hit) return { kind: "var" as const, value: hit[1] };
  if (!fromDefinition && /^f0$/i.test(id)) return { kind: "var" as const, value: "lower.title" };
  if (!fromDefinition && /^f1$/i.test(id)) return { kind: "var" as const, value: "lower.sub" };
  return undefined;
};

export function analyzeTemplate(files: Entry[], entry?: string): TemplateAnalysis {
  const entries = files.filter((f) => /\.html?$/i.test(f.path)).map((f) => f.path).sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  const pick = entry && entries.includes(entry) ? entry : entries.find((p) => /(^|\/)(index|template)\.html?$/i.test(p)) ?? entries[0];
  const warnings: string[] = [];
  if (!pick) return { entry: "", entries, functions: { play: false, stop: false, update: false, next: false }, fields: [], dataFormat: "xml", needsNetwork: false, warnings: ["There is no .html file in this upload."], width: 1920, height: 1080 };
  const code = files.filter((f) => ["html", "htm", "js"].includes(extOf(f.path))).map(text).join("\n");
  const css = files.filter((f) => ["html", "css"].includes(extOf(f.path))).map(text).join("\n");
  const fn = (n: string) => new RegExp(`function\\s+${n}\\s*\\(|(?:window\\.|\\b)${n}\\s*=\\s*(?:async\\s*)?(?:function|\\([^)]*\\)\\s*=>|\\w+\\s*=>)|\\b${n}\\s*:\\s*function`).test(code);
  const functions = { play: fn("play"), stop: fn("stop"), update: fn("update"), next: fn("next") };
  if (!functions.play) warnings.push("No play() function was found. The graphic will appear without a start animation.");
  if (!functions.update) warnings.push("No update() function was found, so its text cannot be changed from Fieldhouse data.");

  const pickFile = files.find((f) => f.path === pick);
  const definition = pickFile ? spxDefinition(text(pickFile)) : undefined;
  const defFields = Array.isArray(definition?.DataFields) ? definition!.DataFields! : [];
  const defById = new Map(defFields.map((f) => [f.field, f]));
  const description = definition?.description ?? "";

  const found = new Map<string, Set<string>>();
  const add = (id: string, how: string) => { if (id && id.length <= 40 && /^[\w.\-]+$/.test(id)) (found.get(id) ?? found.set(id, new Set()).get(id)!).add(how); };
  const jsonish = /JSON\.parse\s*\(/.test(code), xmlish = /DOMParser|parseFromString|componentData|XMLDocument|getElementsByTagName\(\s*["']data/.test(code);
  if (defFields.length) for (const f of defFields) add(f.field, "template definition"); // the declaration is authoritative: do not mine the bundled runtime for ids
  else {
    for (const m of code.matchAll(/componentData\s+id\s*=\s*\\?["']([\w.\-]+)\\?["']/g)) add(m[1], "componentData");
    for (const m of code.matchAll(/data-(?:caspar-)?field(?:-id)?\s*=\s*["']([\w.\-]+)["']/g)) add(m[1], "data-field");
    for (const m of code.matchAll(/getElementById\(\s*["']([\w.\-]+)["']\s*\)/g)) add(m[1], "getElementById");
    for (const m of code.matchAll(/querySelector\(\s*["']#([\w.\-]+)["']\s*\)/g)) add(m[1], "querySelector");
    const dynamic = /getElementById\(\s*[A-Za-z_]/.test(code); // update() looks elements up by a variable: every element id is a candidate
    for (const m of code.matchAll(/\bid\s*=\s*["']([\w.\-]+)["']/g)) if (dynamic || /^f\d+$/.test(m[1])) add(m[1], "element id");
    if (jsonish) for (const m of code.matchAll(/\b(?:data|d|json|obj|parsed)\s*(?:\.\s*([A-Za-z_]\w*)|\[\s*["']([\w.\-]+)["']\s*\])/g)) add(m[1] ?? m[2], "json key");
    for (const dropped of ["update", "play", "stop", "next", "length", "parse", "hasOwnProperty"]) found.delete(dropped);
  }
  const fields: AnalyzedField[] = [...found].map(([id, how]) => {
    const meta = defById.get(id);
    return { id, label: meta?.title ?? id, type: fieldType(meta?.ftype), default: meta?.value ?? "", found: [...how], suggestion: suggest(id, meta?.title ?? id, description, !!meta) };
  });
  const seenSuggestions = new Set<string>();
  for (const f of fields) {
    const v = f.suggestion?.value;
    if (!v) continue;
    if (!seenSuggestions.has(v)) { seenSuggestions.add(v); continue; }
    f.suggestion = v === "lower.title" ? { kind: "var", value: "lower.sub" } : undefined;
    if (f.suggestion) seenSuggestions.add(f.suggestion.value);
  }

  const declared = definition?.dataformat === "json" ? "json" : definition?.dataformat === "xml" ? "xml" : undefined;
  const dataFormat = declared ?? (jsonish && !xmlish ? "json" : "xml");
  const stripComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const scan = stripComments(code), scanCss = stripComments(css);
  const ext = String.raw`https?:\/\/(?!www\.w3\.org|localhost|127\.0\.0\.1)`;
  const net = new RegExp(String.raw`(?:(?:src|href|poster|action)\s*=\s*["']${ext}|@import\s+(?:url\(\s*)?["']?${ext}|url\(\s*["']?${ext}|\b(?:fetch|import|importScripts|sendBeacon)\(\s*["'` + "`" + String.raw`]${ext}|\bnew\s+(?:WebSocket|EventSource|Worker)\(\s*["'` + "`" + String.raw`](?:https?|wss?):\/\/(?!www\.w3\.org|localhost|127\.0\.0\.1)|\.open\(\s*["'][A-Z]+["']\s*,\s*["']${ext})`, "i").test(scanCss + scan);
  if (net) warnings.push("This template loads something from the internet (a link, script or font). It needs \"Allow network\" and the venue's internet to look right.");
  if (/preserve-3d|translate3d|rotate3d|perspective\s*[:(]|matrix3d|rotateX|rotateY/i.test(scanCss + scan)) warnings.push("This template uses 3D transforms. They may look different in OBS than in CasparCG; check the preview.");
  if (files.some((f) => /\.(ft|swf)$/i.test(f.path))) warnings.push("A Flash template (.ft / .swf) was included. Flash cannot run here; only the HTML template is used.");
  if (!fields.length) warnings.push("No data fields were found. You can still add the field ids by hand.");
  const layer = Number(definition?.playlayer);
  return { entry: pick, entries, functions, fields, dataFormat, needsNetwork: net, warnings, width: 1920, height: 1080, title: definition?.description, layer: Number.isFinite(layer) ? layer : undefined };
}
