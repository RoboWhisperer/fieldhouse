// Getting files in: one .html, a .zip, several files at once, or a .fhgfx pack. Everything is vetted (zip.ts) and held in memory
// as a "staged import" until the operator confirms the mapping; nothing touches the graphics folder before that.
import { analyzeTemplate, type TemplateAnalysis } from "./caspar";
import { isPack, readPack } from "./pack";
import type { GraphicDoc } from "./types";
import { ImportError, LIMITS, cleanPath, extOf, readZip, vet, type Entry, type Skipped } from "./zip";

export interface Staged { token: string; at: number; kind: "template" | "pack"; files: Entry[]; skipped: Skipped[]; analysis?: TemplateAnalysis; pack?: GraphicDoc; name: string }
export const MAX_UPLOAD = LIMITS.totalBytes + 1024 * 1024;

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

/** Vet and analyse. Throws ImportError (plain message) for anything unsafe or unusable. */
export function stage(entries: Entry[], name: string, token: string, now: number): Staged {
  if (isPack(entries)) {
    const p = readPack(entries, now);
    return { token, at: now, kind: "pack", files: p.files, skipped: p.skipped, pack: p.doc, name: p.doc.name };
  }
  for (const e of entries) if (!/(^|\/)(__MACOSX|\.DS_Store)(\/|$)/.test(e.path)) cleanPath(e.path); // refuse hostile paths BEFORE any folder is stripped
  const v = vet(stripCommonDir(entries.filter((e) => !/(^|\/)(__MACOSX|\.DS_Store)(\/|$)/.test(e.path))));
  if (!v.files.some((f) => /\.html?$/i.test(f.path))) throw new ImportError("There is no .html file in this upload. A graphic needs one HTML page as its entry.");
  if (!v.files.length) throw new ImportError("Nothing usable was found in this upload.");
  const base = name.replace(/[^\w \-]/g, " ").trim().slice(0, 60) || "Imported graphic";
  return { token, at: now, kind: "template", files: v.files, skipped: v.skipped, analysis: analyzeTemplate(v.files), name: base };
}
export const publicStage = (s: Staged) => ({ token: s.token, kind: s.kind, name: s.name, files: s.files.map((f) => ({ path: f.path, bytes: f.data.length, type: extOf(f.path) })), skipped: s.skipped, analysis: s.analysis ?? null, graphic: s.pack ?? null });

/** At most a few staged imports live in memory, for an hour at most. */
export class StageBox {
  private m = new Map<string, Staged>();
  constructor(private now: () => number = Date.now) {}
  put(s: Staged) { this.sweep(); this.m.set(s.token, s); while (this.m.size > 4) this.m.delete(this.m.keys().next().value!); }
  get(token: string) { this.sweep(); const s = this.m.get(token); if (!s) throw new ImportError("That import expired. Choose the file again."); return s; }
  drop(token: string) { this.m.delete(token); }
  private sweep() { for (const [k, s] of this.m) if (this.now() - s.at > 3_600_000) this.m.delete(k); }
}
