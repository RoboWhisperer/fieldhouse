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

export interface TemplateAnalysis {
  entry: string; entries: string[];
  functions: { play: boolean; stop: boolean; update: boolean; next: boolean };
  fields: { id: string; found: string[]; suggestion?: { kind: "var"; value: string } }[];
  dataFormat: "xml" | "json"; needsNetwork: boolean; warnings: string[]; width: number; height: number;
}

const GUESS: [RegExp, string][] = [
  [/home.*(score|pts|points)|(score|pts|points).*home/i, "home.score"], [/away.*(score|pts|points)|(score|pts|points).*away/i, "away.score"],
  [/home.*(abbr|short|code)/i, "home.abbr"], [/away.*(abbr|short|code)/i, "away.abbr"], [/home.*(name|team)|team.*home/i, "home.name"], [/away.*(name|team)|team.*away/i, "away.name"],
  [/clock|time/i, "clock"], [/period|quarter|half/i, "periodLabel"], [/venue|location/i, "game.venue"], [/title|headline|name1|^f0$/i, "lower.title"], [/sub|name2|^f1$/i, "lower.sub"],
];
const text = (e: Entry) => new TextDecoder().decode(e.data);

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

  const found = new Map<string, Set<string>>();
  const add = (id: string, how: string) => { if (id && id.length <= 40 && /^[\w.\-]+$/.test(id)) (found.get(id) ?? found.set(id, new Set()).get(id)!).add(how); };
  for (const m of code.matchAll(/componentData\s+id\s*=\s*\\?["']([\w.\-]+)\\?["']/g)) add(m[1], "componentData");
  for (const m of code.matchAll(/data-(?:caspar-)?field(?:-id)?\s*=\s*["']([\w.\-]+)["']/g)) add(m[1], "data-field");
  for (const m of code.matchAll(/getElementById\(\s*["']([\w.\-]+)["']\s*\)/g)) add(m[1], "getElementById");
  for (const m of code.matchAll(/querySelector\(\s*["']#([\w.\-]+)["']\s*\)/g)) add(m[1], "querySelector");
  const dynamic = /getElementById\(\s*[A-Za-z_]/.test(code); // update() looks elements up by a variable: every element id is a candidate
  for (const m of code.matchAll(/\bid\s*=\s*["']([\w.\-]+)["']/g)) if (dynamic || /^f\d+$/.test(m[1])) add(m[1], "element id");
  const jsonish = /JSON\.parse\s*\(/.test(code), xmlish = /DOMParser|parseFromString|componentData|XMLDocument|getElementsByTagName\(\s*["']data/.test(code);
  if (jsonish) for (const m of code.matchAll(/\b(?:data|d|json|obj|parsed)\s*(?:\.\s*([A-Za-z_]\w*)|\[\s*["']([\w.\-]+)["']\s*\])/g)) add(m[1] ?? m[2], "json key");
  for (const dropped of ["update", "play", "stop", "next", "length", "parse", "hasOwnProperty"]) found.delete(dropped);
  const fields = [...found].map(([id, how]) => ({ id, found: [...how], suggestion: ((g) => (g ? { kind: "var" as const, value: g[1] } : undefined))(GUESS.find(([re]) => re.test(id))) }));

  const dataFormat = jsonish && !xmlish ? "json" : "xml";
  const net = [...code.matchAll(/https?:\/\/(?!www\.w3\.org|localhost|127\.0\.0\.1)[^\s"'<>)]+/g), ...css.matchAll(/url\(\s*["']?(https?:\/\/[^)"']+)/g)].length > 0;
  if (net) warnings.push("This template loads something from the internet (a link, script or font). It needs \"Allow network\" and the venue's internet to look right.");
  if (/preserve-3d|translate3d|rotate3d|perspective\s*[:(]|matrix3d|rotateX|rotateY/i.test(css + code)) warnings.push("This template uses 3D transforms. They may look different in OBS than in CasparCG; check the preview.");
  if (files.some((f) => /\.(ft|swf)$/i.test(f.path))) warnings.push("A Flash template (.ft / .swf) was included. Flash cannot run here; only the HTML template is used.");
  if (!fields.length) warnings.push("No data fields were found. You can still add the field ids by hand.");
  return { entry: pick, entries, functions, fields, dataFormat, needsNetwork: net, warnings, width: 1920, height: 1080 };
}
