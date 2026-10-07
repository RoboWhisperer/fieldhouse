// Workspace sections "graphics" (graphic documents, their files, connectors WITHOUT their secrets) and "profiles" (sport profiles).
// Ids are kept so rules and games that point at them keep working; an id that is invalid or used twice in the file gets a fresh one.
// import() runs only after plan() has validated everything, and plan() changes nothing.
import { newId } from "../data";
import type { Store } from "../store";
import type { Mode, Plan, WorkspaceSection } from "../automation/workspace";
import { builtin } from "../profiles/builtins";
import { validateProfile } from "../profiles/validate";
import type { ProfileDoc } from "../profiles/types";
import { BUILTIN_IDS, builtinDocId, defaultBuiltin } from "./builtins";
import { Connectors, validateConfig } from "./connectors";
import { createGraphic, isModified, isSeed, mergeGraphic } from "./docs";
import type { GraphicFiles } from "./files";
import type { ConnectorDoc, GraphicDoc } from "./types";
import { tame } from "./pack";
import { vet } from "./zip";

const ID = /^[\w-]{1,60}$/;
const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === "object" && !Array.isArray(x);
const list = (x: unknown, what: string, max: number): any[] => { if (!Array.isArray(x)) throw new Error(`The ${what} must be a list.`); if (x.length > max) throw new Error(`The ${what} has too many entries.`); return x; };
const tally = (have: Set<string>, ids: string[], mode: Mode, removable: Set<string>): Plan => ({ add: ids.filter((i) => !have.has(i)).length, update: ids.filter((i) => have.has(i)).length, remove: mode === "replace" ? [...removable].filter((i) => !ids.includes(i)).length : 0 });

const SECRETISH = /token|key|secret|pass|auth|cookie|credential/i;
const PLACEHOLDER = /^(\s*\{\{[^}]*\}\}\s*)*$/; // a header made only of {{...}} templates holds no secret
const scrubUrl = (u: string) => { try { const x = new URL(u); for (const k of [...x.searchParams.keys()]) if (SECRETISH.test(k)) x.searchParams.set(k, ""); return x.toString(); } catch { return u; } };
const scrubReq = (r: any) => (isObj(r) ? { ...r, url: typeof r.url === "string" ? scrubUrl(r.url) : r.url, headers: Object.fromEntries(Object.entries(r.headers ?? {}).map(([k, v]) => [k, SECRETISH.test(k) || /authori[sz]ation/i.test(k) ? (PLACEHOLDER.test(String(v)) ? v : "") : v])) } : r);
/** A connector's settings without anything that could be a secret (the app token is never written). */
export const scrubConfig = (kind: string, c: Record<string, any>) => (kind === "http" ? { ...Object.fromEntries(Object.entries(c).map(([k, v]) => [k, ["show", "update", "hide", "next"].includes(k) ? scrubReq(v) : v])), ...(c.testUrl ? { testUrl: scrubUrl(c.testUrl) } : {}) } : c);

const b64 = (s: unknown, what: string) => { if (typeof s !== "string" || s.length > 40_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new Error(`${what} is not valid base64.`); return new Uint8Array(Buffer.from(s, "base64")); };

export function graphicsSection(d: { store: Store; files: GraphicFiles; conns: Connectors; now: () => number; reloaded: (ids: string[]) => void }): WorkspaceSection {
  const { store, files, conns } = d;
  const allDocs = () => store.list<GraphicDoc>("graphic");

  const prepare = (raw: unknown) => {
    if (!isObj(raw)) throw new Error("The graphics section must be an object.");
    const now = d.now(), seen = new Set<string>();
    const conIn = list(raw.connectors ?? [], "connectors list", 50).map((c, i) => {
      if (!isObj(c)) throw new Error(`Connector ${i + 1} is not valid.`);
      const id = String(c.id ?? ""); if (!ID.test(id) || seen.has(id)) throw new Error(`Connector ${i + 1} needs its own id.`); seen.add(id);
      const kind = c.kind; if (!["singular", "caspar", "http"].includes(kind)) throw new Error(`Connector "${c.name}" has an unknown type.`);
      const name = String(c.name ?? "").trim(); if (!name || name.length > 60) throw new Error(`Connector ${i + 1} needs a name of up to 60 characters.`);
      return { id, name, kind, enabled: c.enabled !== false, config: validateConfig(kind, c.config) } as Omit<ConnectorDoc, "secret" | "createdAt" | "updatedAt">;
    });
    const used = new Set<string>(), gIn: { doc: GraphicDoc; files: { path: string; data: Uint8Array }[] }[] = [];
    list(raw.graphics ?? [], "graphics list", 300).forEach((g, i) => {
      if (!isObj(g) || !isObj(g.graphic)) throw new Error(`Graphic ${i + 1} is not valid.`);
      const gd = g.graphic, label = `Graphic "${String(gd.name ?? i + 1)}"`;
      let id = String(g.id ?? ""), doc: GraphicDoc;
      try {
        if (isSeed(id)) { // a built-in graphic someone changed: same id, same built-in
          if (gd.kind !== "builtin" || builtinDocId(gd.builtinId) !== id) throw new Error("It does not match a built-in graphic of this version.");
          doc = mergeGraphic(defaultBuiltin(gd.builtinId, now), gd); doc.modified = isModified(doc);
        } else {
          if (!ID.test(id) || used.has(id)) id = newId("gfx"); // invalid or twice in the file: a fresh id
          if (gd.kind === "builtin") { if (!BUILTIN_IDS.includes(gd.builtinId)) throw new Error("It is based on a built-in graphic this version does not have."); doc = mergeGraphic(defaultBuiltin(gd.builtinId, now), gd); delete doc.modified; }
          else doc = createGraphic(gd, now);
        }
        doc.id = id; tame(doc);
        const fs = vet(list(g.files ?? [], "files list", 500).map((f, j) => ({ path: String(f?.path ?? ""), data: b64(f?.base64, `File ${j + 1}`) })));
        if ((doc.kind === "html" || doc.kind === "caspar") && !fs.files.some((f) => f.path === (doc.source as any).entry)) throw new Error(`The entry file "${(doc.source as any).entry}" is missing.`);
        used.add(id); gIn.push({ doc, files: doc.kind === "html" || doc.kind === "caspar" ? fs.files : [] });
      } catch (e: any) { throw new Error(`${label}: ${e.message}`); }
    });
    return { conIn, gIn };
  };
  const userIds = () => new Set(allDocs().filter((x) => !isSeed(x.id)).map((x) => x.id));

  return {
    export: () => ({
      graphics: allDocs().filter((g) => !isSeed(g.id) || g.modified).map((g) => {
        const { createdAt, updatedAt, ...doc } = structuredClone(g) as any; delete doc.id;
        if (doc.kind === "remote") doc.source.target = Object.fromEntries(Object.entries(doc.source.target ?? {}).filter(([k]) => !SECRETISH.test(k)));
        const fs = g.kind === "html" || g.kind === "caspar" ? files.list(g.id).map((f) => ({ path: f.path, base64: Buffer.from(files.read(g.id, f.path)!).toString("base64") })) : [];
        return { id: g.id, graphic: doc, files: fs };
      }),
      connectors: conns.all().map((c) => ({ id: c.id, name: c.name, kind: c.kind, enabled: c.enabled, config: scrubConfig(c.kind, c.config) })),
    }),
    plan(raw, mode) {
      const { conIn, gIn } = prepare(raw);
      const g = tally(new Set(allDocs().map((x) => x.id)), gIn.map((x) => x.doc.id), mode, userIds());
      const c = tally(new Set(conns.all().map((x) => x.id)), conIn.map((x) => x.id), mode, new Set(conns.all().map((x) => x.id)));
      return { add: g.add + c.add, update: g.update + c.update, remove: g.remove + c.remove, note: `${gIn.length} graphics, ${conIn.length} connectors` };
    },
    async import(raw, mode) {
      const { conIn, gIn } = prepare(raw), now = d.now(), touched: string[] = [];
      if (mode === "replace") {
        for (const x of allDocs()) if (!gIn.some((g) => g.doc.id === x.id)) {
          if (isSeed(x.id)) { if (x.modified) { store.put("graphic", defaultBuiltin(x.builtinId!, now)); touched.push(x.id); } }
          else { store.del("graphic", x.id); files.remove(x.id); touched.push(x.id); }
        }
        for (const c of conns.all()) if (!conIn.some((x) => x.id === c.id)) conns.remove(c.id);
      }
      for (const c of conIn) { const cur = conns.get(c.id); const keep = !!cur && cur.kind === c.kind && (c.kind !== "http" || JSON.stringify(cur.config) === JSON.stringify(c.config)); store.put("connector", { ...c, secret: keep ? cur!.secret : undefined, createdAt: cur?.createdAt ?? now, updatedAt: now }); } // an existing connector keeps its token only if its type (and, for web requests, its addresses) did not change; otherwise the token is dropped and must be typed in again
      for (const { doc, files: fs } of gIn) {
        const cur = store.get<GraphicDoc>("graphic", doc.id); doc.createdAt = cur?.createdAt ?? now; doc.updatedAt = now;
        store.put("graphic", doc); if (fs.length || cur) files.write(doc.id, fs); touched.push(doc.id);
      }
      d.reloaded(touched);
    },
  };
}

/** Sport profiles: your own and the edited built-ins. Games keep their own frozen copy, so nothing that has started changes. */
export function profilesSection(d: { store: Store; defaultId: () => string; changed: () => void }): WorkspaceSection {
  const { store } = d;
  const prepare = (raw: unknown) => {
    const seen = new Set<string>();
    return list(raw, "profiles section", 100).map((p, i) => {
      if (!isObj(p)) throw new Error(`Sport profile ${i + 1} is not valid.`);
      const { id: given, builtin: _b, ...rest } = p;
      let id = String(given ?? "");
      const isB = !!builtin(id);
      if (!isB && (!/^[\w-]{1,40}$/.test(id) || seen.has(id))) id = `profile_${crypto.randomUUID().slice(0, 8)}`;
      if (seen.has(id)) throw new Error(`Two entries are for the built-in sport "${id}".`);
      seen.add(id);
      try { return validateProfile(rest, id, isB); } catch (e: any) { throw new Error(`Sport profile "${p.name ?? i + 1}": ${e.message}`); }
    });
  };
  const userIds = () => new Set(store.list<ProfileDoc>("profile").filter((x) => !builtin(x.id)).map((x) => x.id));
  return {
    export: () => store.list<ProfileDoc>("profile").map(({ builtin: _b, ...p }) => p),
    plan(raw, mode) {
      const p = prepare(raw), ids = p.map((x) => x.id);
      if (mode === "replace" && userIds().has(d.defaultId()) && !ids.includes(d.defaultId())) throw new Error("The file would remove your default sport. Choose another default sport first.");
      const have = new Set(store.list<ProfileDoc>("profile").map((x) => x.id));
      return tally(have, ids, mode, new Set([...have]));
    },
    async import(raw, mode) {
      const p = prepare(raw);
      if (mode === "replace") for (const x of store.list<ProfileDoc>("profile")) if (!p.some((y) => y.id === x.id)) store.del("profile", x.id); // built-in overrides go back to the original rules
      for (const x of p) store.put("profile", x);
      d.changed();
    },
  };
}
