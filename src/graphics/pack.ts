// Fieldhouse graphic pack (.fhgfx): a zip with manifest.json { schema: 1, graphic, files } and the graphic's files under files/.
// Packs carry no ids, no timestamps and no secrets; importing makes a new graphic with a fresh id.
import { BUILTIN_IDS, defaultBuiltin } from "./builtins";
import { createGraphic, mergeGraphic } from "./docs";
import type { GraphicDoc } from "./types";
import { ImportError, vet, writeZip, type Entry } from "./zip";

const SECRETISH = /token|key|secret|password|auth/i;
const scrubTarget = (t: Record<string, unknown>) => Object.fromEntries(Object.entries(t).filter(([k]) => !SECRETISH.test(k)));

export function exportPack(doc: GraphicDoc, files: Entry[]): Uint8Array {
  const { id, createdAt, updatedAt, modified, ...rest } = structuredClone(doc) as any;
  if (rest.kind === "remote") { rest.source.connectorId = ""; rest.source.target = scrubTarget(rest.source.target ?? {}); }
  const manifest = { schema: 1, app: "fieldhouse", graphic: rest, files: files.map((f) => f.path) };
  return writeZip([{ path: "manifest.json", data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) }, ...files.map((f) => ({ path: "files/" + f.path, data: f.data }))]);
}

/** Anything imported from a file starts with no network access and is shown by hand: the owner turns those on in the editor. */
export function tame(doc: GraphicDoc) {
  if (doc.kind === "html" || doc.kind === "caspar") doc.source.allowNetwork = false;
  if (doc.show.mode === "always") doc.show = { ...doc.show, mode: "manual" };
  return doc;
}

export const isPack = (entries: Entry[]) => entries.some((e) => e.path === "manifest.json");

/** Validate a pack (already unzipped) and return the new graphic (id regenerated) and its files. */
export function readPack(entries: Entry[], now = Date.now()): { doc: GraphicDoc; files: Entry[]; skipped: { path: string; why: string }[] } {
  const m = entries.find((e) => e.path === "manifest.json");
  let man: any; try { man = JSON.parse(new TextDecoder().decode(m!.data)); } catch { throw new ImportError("This pack's manifest.json is not valid."); }
  if (man?.schema !== 1) throw new ImportError("This pack was made by a newer version of Fieldhouse (or is not a pack). Update Fieldhouse and try again.");
  const g = man.graphic; if (!g || typeof g !== "object") throw new ImportError("This pack has no graphic in it.");
  const v = vet(entries.filter((e) => e.path.startsWith("files/")).map((e) => ({ path: e.path.slice(6), data: e.data })));
  let doc: GraphicDoc;
  try {
    if (g.kind === "builtin") {
      if (!BUILTIN_IDS.includes(g.builtinId)) throw new Error("This pack is based on a built-in graphic this version does not have.");
      doc = mergeGraphic(defaultBuiltin(g.builtinId, now), g);
      doc.id = "gfx_" + crypto.randomUUID().slice(0, 8); delete doc.modified;
    } else doc = createGraphic({ ...g, kind: g.kind }, now);
  } catch (e: any) { throw new ImportError(e.message); }
  if (g.kind !== "builtin" && (g.kind === "html" || g.kind === "caspar") && !v.files.some((f) => f.path === (doc.source as any).entry)) throw new ImportError(`The pack is missing its entry file "${(doc.source as any).entry}".`);
  return { doc: tame(doc), files: v.files, skipped: v.skipped };
}
