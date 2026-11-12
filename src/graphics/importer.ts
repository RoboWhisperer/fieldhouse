// Getting files in: one .html, a .zip, several files at once, a .fhgfx pack, or a production package with several templates.
// Everything is vetted (zip.ts) and held in memory as a "staged import" until the operator confirms the mapping; nothing touches
// the graphics folder before that.
import { analyzeTemplate, spxTemplates, type TemplateAnalysis } from "./caspar";
import { isPack, readPack } from "./pack";
import type { GraphicDoc, GraphicRole } from "./types";
import { ImportError, LIMITS, cleanPath, extOf, readZip, vet, type Entry, type Skipped } from "./zip";

export interface PackageTemplate {
  key: string; entry: string; name: string; role: GraphicRole; layer?: number;
  files: Entry[]; skipped: Skipped[]; analysis: TemplateAnalysis;
}
export interface Staged {
  token: string; at: number; kind: "template" | "pack" | "package"; files: Entry[]; skipped: Skipped[];
  analysis?: TemplateAnalysis; pack?: GraphicDoc; package?: PackageTemplate[]; name: string;
}
export const MAX_UPLOAD = LIMITS.totalBytes + 1024 * 1024;
const IGNORE = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)(\/|$)/;
const cleanName = (name: string) => name.replace(/[_-]+/g, " ").replace(/[^\w \-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);

/** If every file sits inside one folder (a typical "zip the folder" archive), move them up so the entry file is at the top. */
export function stripCommonDir(files: Entry[]): Entry[] {
  if (!files.length || files.some((f) => !f.path.includes("/"))) return files;
  const top = files[0].path.split("/")[0];
  return files.every((f) => f.path.startsWith(top + "/")) ? stripCommonDir(files.map((f) => ({ ...f, path: f.path.slice(top.length + 1) }))) : files;
}

/** Turn a multipart upload into raw entries: zip/pack files are opened, other files are taken as they are (name may be a relative path). */
export async function entriesFromForm(form: FormData): Promise<{ entries: Entry[]; name: string }> {
  const files = [...form.entries()].filter(([, v]) => typeof v !== "string") as unknown as [string, File][];
  if (!files.length) throw new ImportError("Choose a file to import (.html, .zip or .fhgfx).");
  let total = 0; for (const [, f] of files) total += f.size;
  if (total > MAX_UPLOAD) throw new ImportError(`That upload is larger than ${LIMITS.totalBytes / 1048576} MB.`);
  const first = files[0][1].name || "graphic";
  if (files.length === 1 && /\.(zip|fhgfx)$/i.test(first)) return { entries: readZip(new Uint8Array(await files[0][1].arrayBuffer())), name: first.replace(/\.[^.]+$/, "") };
  const entries: Entry[] = [];
  for (const [, f] of files) entries.push({ path: (f.name || "file").replace(/^\.?\//, ""), data: new Uint8Array(await f.arrayBuffer()) });
  return { entries, name: files.length === 1 ? first.replace(/\.[^.]+$/, "") : first.split("/")[0] };
}

const roleFor = (name: string, entry: string): GraphicRole => {
  const s = `${name} ${entry}`.toLowerCase();
  if (/score.?bug|scorebug/.test(s)) return "scorebug";
  if (/lower|angle.?slab/.test(s)) return "lowerthird";
  if (/sponsor/.test(s)) return "ticker";
  if (/\b(bug|clock|timer)\b/.test(s)) return "corner";
  return "fullscreen";
};

/** A NoaCG/SPX production export: several folders, each with its own template definition. One graphic is made per folder. */
function productionPackage(entries: Entry[], name: string, token: string, now: number): Staged | undefined {
  const groups = new Map<string, { entry: string; definition: { description?: string; playlayer?: string | number } }[]>();
  for (const t of spxTemplates(entries)) {
    const slash = t.entry.lastIndexOf("/");
    if (slash < 1) continue; // a definition at the archive root is a single template, not a package
    const dir = t.entry.slice(0, slash);
    (groups.get(dir) ?? groups.set(dir, []).get(dir)!).push(t);
  }
  if (groups.size < 2) return undefined;
  const templates: PackageTemplate[] = [];
  const skipped: Skipped[] = [];
  for (const dir of [...groups.keys()].sort()) {
    const defs = groups.get(dir)!;
    const folder = dir.split("/").pop()!;
    const chosen = defs.find((d) => d.entry.slice(dir.length + 1).replace(/\.html?$/i, "") === folder) ?? defs[0];
    const prefix = dir + "/";
    const raw = entries.filter((e) => e.path.startsWith(prefix)).map((e) => ({ path: e.path.slice(prefix.length), data: e.data }));
    const v = vet(raw);
    const entry = chosen.entry.slice(prefix.length);
    if (!v.files.some((f) => f.path === entry)) throw new ImportError(`The package's "${folder}" template is missing its entry file.`);
    const analysis = analyzeTemplate(v.files, entry);
    const templateName = cleanName(analysis.title ?? folder) || "Imported graphic";
    templates.push({ key: folder, entry, name: templateName, role: roleFor(templateName, entry), layer: analysis.layer, files: v.files, skipped: v.skipped, analysis });
    skipped.push(...v.skipped);
  }
  return { token, at: now, kind: "package", files: [], skipped, package: templates, name: cleanName(name) || "Production package" };
}

/** Vet and analyse. Throws ImportError (plain message) for anything unsafe or unusable. */
export function stage(entries: Entry[], name: string, token: string, now: number): Staged {
  if (isPack(entries)) {
    const p = readPack(entries, now);
    return { token, at: now, kind: "pack", files: p.files, skipped: p.skipped, pack: p.doc, name: p.doc.name };
  }
  const usable = entries.filter((e) => !IGNORE.test(e.path));
  for (const e of usable) cleanPath(e.path); // refuse hostile paths BEFORE any folder is stripped or grouped
  const pkg = productionPackage(usable, name, token, now);
  if (pkg) return pkg;
  const v = vet(stripCommonDir(usable));
  if (!v.files.some((f) => /\.html?$/i.test(f.path))) throw new ImportError("There is no .html file in this upload. A graphic needs one HTML page as its entry.");
  if (!v.files.length) throw new ImportError("Nothing usable was found in this upload.");
  return { token, at: now, kind: "template", files: v.files, skipped: v.skipped, analysis: analyzeTemplate(v.files), name: cleanName(name) || "Imported graphic" };
}

export const publicStage = (s: Staged) => ({
  token: s.token, kind: s.kind, name: s.name, files: s.files.map((f) => ({ path: f.path, bytes: f.data.length, type: extOf(f.path) })),
  skipped: s.skipped, analysis: s.analysis ?? null, graphic: s.pack ?? null,
  templates: s.package?.map((t) => ({
    key: t.key, entry: t.entry, name: t.name, role: t.role, layer: t.layer, dataFormat: t.analysis.dataFormat,
    width: t.analysis.width, height: t.analysis.height, needsNetwork: t.analysis.needsNetwork, warnings: t.analysis.warnings,
    functions: t.analysis.functions, fields: t.analysis.fields, files: t.files.map((f) => ({ path: f.path, bytes: f.data.length, type: extOf(f.path) })),
  })) ?? null,
});

/** At most a few staged imports live in memory, for an hour at most. */
export class StageBox {
  private m = new Map<string, Staged>();
  constructor(private now: () => number = Date.now) {}
  put(s: Staged) { this.sweep(); this.m.set(s.token, s); while (this.m.size > 4) this.m.delete(this.m.keys().next().value!); }
  get(token: string) { this.sweep(); const s = this.m.get(token); if (!s) throw new ImportError("That import expired. Choose the file again."); return s; }
  drop(token: string) { this.m.delete(token); }
  private sweep() { for (const [k, s] of this.m) if (this.now() - s.at > 3_600_000) this.m.delete(k); }
}
