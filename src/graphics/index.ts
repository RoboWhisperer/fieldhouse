// The graphics runtime: owns the graphic documents, what is on air, the variables, remote connectors and the OBS layers.
// `createGraphics()` is called once by createApp(); `app.graphics` is this object.
import type { GraphicsControl, VarMap } from "../custom-types";
import { log as diag } from "../diagnostics";
import type { Engine } from "../types";
import { LEGACY } from "./builtins";
import { casparData } from "./caspar";
import { Connectors } from "./connectors";
import { createGraphic, duplicateGraphic, ensureBuiltins, getGraphic, listGraphics, resetBuiltin, saveGraphic, isSeed } from "./docs";
import { GfxError } from "./error";
import { EXAMPLES, STARTER_HTML } from "./examples";
import { GraphicFiles, serveGfx } from "./files";
import { fontsView, reportFonts } from "./fonts";
import { StageBox, entriesFromForm, publicStage, stage } from "./importer";
import { OnAir } from "./onair";
import { exportPack } from "./pack";
import type { ExternalLayer, FieldDef, GraphicDoc, GraphicsState, RenderItem } from "./types";
import { buildVars, substitute, type VarsCtx } from "./vars";
import { ImportError, type Entry } from "./zip";
import type { Store } from "../store";

export interface GraphicsDeps {
  store: Store; engine: Engine; dir: string; changed: () => void;
  /** Game, game document, venue name and custom data right now. */
  context: () => Omit<VarsCtx, "lower" | "sponsor">;
  now?: () => number; fetch?: typeof fetch; notify?: (level: "info" | "warn", message: string) => void; singularBase?: string; syncMs?: number;
}

/** Resolve one graphic's field values: show/update overrides win, then the binding, then the default. */
export function resolveFields(defs: FieldDef[], vars: VarMap, overrides: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of defs) {
    let v: string | undefined = overrides[f.name];
    if (v === undefined) {
      const b = f.binding;
      if (b.kind === "var") { const x = vars[b.value]; v = x === undefined || x === "" ? f.default : String(x); }
      else if (b.kind === "const") v = b.value ? substitute(b.value, vars, "raw") : f.default;
      else v = f.default;
    }
    out[f.name] = v;
  }
  for (const [k, v] of Object.entries(overrides)) if (!(k in out)) out[k] = v;
  return out;
}

const cleanFields = (f: unknown): Record<string, string> | undefined => {
  if (f === undefined || f === null) return undefined;
  if (typeof f !== "object" || Array.isArray(f)) throw new GfxError(400, "fields must be an object of text values.");
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) { if (!/^[\w.\-]{1,40}$/.test(k) || (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") || String(v).length > 2000) throw new GfxError(400, `The field "${k}" is not valid.`); out[k] = String(v); }
  if (Object.keys(out).length > 60) throw new GfxError(400, "Too many fields.");
  return out;
};

export function createGraphics(deps: GraphicsDeps) {
  const { store, engine } = deps;
  const now = deps.now ?? Date.now;
  const oa = new OnAir(now);
  const files = new GraphicFiles(deps.dir);
  const stages = new StageBox(now);
  const notify = deps.notify ?? (() => {});
  const conns = new Connectors(store, { fetch: deps.fetch ?? fetch, vars: () => vars(), log: (l, m) => diag(l, `graphics: ${m}`), notify: (m) => notify("warn", m), singularBase: deps.singularBase }, now);
  ensureBuiltins(store, now());

  const fileRev = new Map<string, number>(); // bumped whenever a graphic's files change
  const bump = (id: string) => fileRev.set(id, (fileRev.get(id) ?? 0) + 1);
  const docs = () => listGraphics(store);
  const need = (id: string) => getGraphic(store, id) ?? (() => { throw new GfxError(404, "Graphic not found."); })();
  const live = () => { try { const s = engine.status(); return !!(s.stream.live || s.record.active); } catch { return false; } };

  // ------------------------------------------------------------ variables
  const sponsorNow = () => { const f = oa.overrides(LEGACY.sponsor); return oa.isOn(LEGACY.sponsor) ? { name: f.name ?? "", color: f.color ?? "#1F7A8C", seconds: Number(f.seconds ?? 0) } : null; };
  const lowerNow = () => { const f = oa.overrides(LEGACY.lower); return oa.isOn(LEGACY.lower) ? { title: f.title ?? "", sub: f.sub ?? "" } : null; };
  function vars(): VarMap { return buildVars({ ...deps.context(), lower: lowerNow(), sponsor: sponsorNow() }); }

  // ------------------------------------------------------------ visibility
  const hold = (d: GraphicDoc) => (d.kind === "caspar" ? d.source.stopHoldMs : 0);
  const derived = (d: GraphicDoc) => d.show.mode === "always" || d.show.mode === "while-live";
  function visible(d: GraphicDoc, hasGame: boolean): boolean {
    if (!d.enabled || (d.requiresGame && !hasGame)) return false;
    return d.show.mode === "always" ? true : d.show.mode === "while-live" ? live() : oa.isOn(d.id);
  }
  const phaseOf = (d: GraphicDoc, vis: boolean) => (vis ? "on" : derived(d) ? "off" : oa.phase(d.id));

  // ------------------------------------------------------------ remote drivers
  const driven = new Map<string, { vis: boolean; fields: string }>();
  const lastErr = new Map<string, string>();
  async function reconcile(d: GraphicDoc, vis: boolean, fields: Record<string, string>) {
    if (d.kind !== "remote") return;
    const cur = driven.get(d.id) ?? { vis: false, fields: "" }, json = JSON.stringify(fields);
    if (!d.source.connectorId) { if (vis) throw new GfxError(409, `"${d.name}" has no connector yet. Pick one in the graphic's settings.`); return; }
    const drv = conns.driver(d.source.connectorId);
    drv.setTypes?.(Object.fromEntries(d.fields.map((f) => [f.name, f.type])));
    if (vis && !cur.vis) { driven.set(d.id, { vis: true, fields: json }); try { await drv.show(d.source.target, fields, d.name); } catch (e) { driven.set(d.id, cur); throw e; } }
    else if (!vis && cur.vis) { driven.set(d.id, { vis: false, fields: json }); await drv.hide(d.source.target); }
    else if (vis && cur.fields !== json) { driven.set(d.id, { vis: true, fields: json }); await drv.update(d.source.target, fields); }
  }

  // ------------------------------------------------------------ one pass over everything
  function rows() {
    const ctx = deps.context(), hasGame = !!ctx.game, v = buildVars({ ...ctx, lower: lowerNow(), sponsor: sponsorNow() });
    return { v, hasGame, rows: docs().filter((d) => d.enabled).map((d) => { const vis = visible(d, hasGame); return { d, vis, phase: phaseOf(d, vis), fields: resolveFields(d.fields, v, oa.overrides(d.id)) }; }) };
  }
  const externalOf = (d: GraphicDoc) => (d.kind === "url" ? { url: d.source.url, width: d.source.width, height: d.source.height, css: d.source.css } : d.kind === "remote" && d.source.outputUrl ? { url: d.source.outputUrl, width: d.source.width, height: d.source.height, css: d.source.css } : undefined);
  const supportsLayers = () => typeof engine.setExternalLayers === "function" && engine.status().engine === "obs";

  function state(): GraphicsState {
    const { v, rows: rs } = rows();
    const items: RenderItem[] = [];
    for (const { d, vis, phase, fields } of rs) {
      const external = externalOf(d);
      if (d.kind === "remote" && !external) continue; // drawn by another system with no page to show: nothing for us to draw
      const it: RenderItem = { id: d.id, name: d.name, kind: d.kind, role: d.role, builtin: d.builtinId, z: d.placement.z, visible: vis, phase, seq: oa.seq(d.id), nextSeq: oa.nextSeq(d.id), placement: d.placement, animation: d.animation, style: d.style, fields, external };
      if (d.kind === "html" || d.kind === "caspar") it.source = { ...d.source, src: `/gfx/${d.id}/${d.source.entry}?v=${d.updatedAt}.${fileRev.get(d.id) ?? 0}` }; // the ?v= part makes the overlay reload the frame after its files change
      if (d.kind === "caspar") it.data = casparData(fields, d.source.dataFormat, d.fields);
      items.push(it);
    }
    items.sort((a, b) => a.z - b.z);
    const sp = sponsorNow(), lw = lowerNow(), sl = oa.isOn(LEGACY.slate) ? oa.overrides(LEGACY.slate).text ?? "" : null;
    return { scorebug: oa.isOn(LEGACY.scorebug), lower: lw, slate: sl, sponsor: sp && { name: sp.name, color: sp.color, seconds: sp.seconds, until: oa.until(LEGACY.sponsor) ?? 0 }, items, vars: v, engineLayers: supportsLayers() };
  }

  // ------------------------------------------------------------ keeping the outside world in step (remote systems, OBS layers, wake-ups)
  let wake: ReturnType<typeof setTimeout> | undefined, lastLayers = "", lastEngine = "", ticker: ReturnType<typeof setInterval> | undefined;
  const layers = (): ExternalLayer[] => rows().rows.filter(({ d }) => externalOf(d)).map(({ d, vis }) => ({ id: d.id.replace(/[^\w-]/g, "_"), ...externalOf(d)!, z: d.placement.z, visible: vis }));
  function sync() {
    const { rows: rs } = rows();
    for (const { d, vis, fields } of rs) if (d.kind === "remote") reconcile(d, vis, fields).then(() => lastErr.delete(d.id), (e) => { if (lastErr.get(d.id) !== e.message) { lastErr.set(d.id, e.message); notify("warn", `${d.name}: ${e.message}`); } });
    for (const d of docs()) if (d.kind === "remote" && !d.enabled && driven.get(d.id)?.vis) reconcile(d, false, {}).catch(() => {});
    if (typeof engine.setExternalLayers === "function") {
      const ls = layers(), key = engine.status().engine + JSON.stringify(ls);
      if (key !== lastLayers) { lastLayers = key; engine.setExternalLayers(ls).catch((e) => diag("WARN", `graphics: could not update the video engine's layers: ${e?.message ?? e}`)); }
    }
    clearTimeout(wake);
    const at = oa.nextDeadline();
    if (at !== null) { wake = setTimeout(() => { sync(); deps.changed(); }, Math.max(20, at - now() + 20)); (wake as any).unref?.(); }
    const anyRemoteOn = docs().some((d) => d.kind === "remote" && driven.get(d.id)?.vis);
    if (anyRemoteOn && !ticker) { ticker = setInterval(sync, deps.syncMs ?? 1000); (ticker as any).unref?.(); } else if (!anyRemoteOn && ticker) { clearInterval(ticker); ticker = undefined; }
  }
  const touch = () => { sync(); deps.changed(); };

  // ------------------------------------------------------------ control (what the console, remotes and automation call)
  const policyLock = (d: GraphicDoc) => { if (derived(d)) throw new GfxError(409, `"${d.name}" follows its show policy (${d.show.mode === "always" ? "always on" : "on while live"}). Change the policy to control it by hand.`); };
  const usable = (d: GraphicDoc) => { if (!d.enabled) throw new GfxError(409, `"${d.name}" is turned off. Turn it on in its settings first.`); };
  async function show(id: string, fields?: Record<string, string>, o: { seconds?: number } = {}) {
    const d = need(id); usable(d); policyLock(d);
    const f = cleanFields(fields), was = oa.isOn(id);
    oa.show(id, { fields: f, seconds: o.seconds ?? (d.show.mode === "auto-hide" ? d.show.seconds : undefined), holdMs: hold(d) });
    if (d.kind === "remote") { const { v, hasGame } = rows(); try { await reconcile(d, visible(d, hasGame), resolveFields(d.fields, v, oa.overrides(id))); } catch (e) { if (!was) oa.hide(id, 0); throw e; } }
    touch();
  }
  async function hide(id: string) {
    const d = need(id); policyLock(d);
    oa.hide(id, hold(d)); await syncOne(d); touch();
  }
  async function syncOne(d: GraphicDoc) { if (d.kind === "remote") { const { v, hasGame } = rows(); await reconcile(d, visible(d, hasGame), resolveFields(d.fields, v, oa.overrides(d.id))); } }
  async function toggle(id: string) { const d = need(id); policyLock(d); return oa.isOn(id) ? hide(id) : show(id); }
  async function update(id: string, fields: Record<string, string>) {
    const d = need(id), f = cleanFields(fields) ?? {};
    if (!visible(d, !!deps.context().game)) throw new GfxError(409, `"${d.name}" is not on air. Show it with the new values instead.`);
    oa.update(id, f); await syncOne(d); touch();
  }
  async function next(id: string) {
    const d = need(id);
    if (!visible(d, !!deps.context().game)) throw new GfxError(409, `"${d.name}" is not on air. Show it first.`);
    if (d.kind === "remote") await conns.driver(d.source.connectorId).next(d.source.target);
    else if (d.kind === "html" || d.kind === "caspar") oa.next(id);
    else throw new GfxError(400, `"${d.name}" has no next step. Only HTML and CasparCG templates and remote graphics do.`);
    touch();
  }
  async function clear() {
    for (const d of docs()) if (!derived(d) && oa.isOn(d.id)) oa.hide(d.id, hold(d));
    for (const d of docs()) await syncOne(d).catch(() => {});
    touch();
  }
  const control: GraphicsControl = {
    list: () => { const { rows: rs } = rows(); const on = new Map(rs.map((r) => [r.d.id, r.vis])); return docs().map((d) => ({ id: d.id, name: d.name, kind: d.kind, role: d.role, visible: !!on.get(d.id), enabled: d.enabled })); },
    show: (id, fields) => show(id, fields), hide, toggle, update, next, clear,
  };

  // ------------------------------------------------------------ legacy API (POST /api/graphics, sponsor fire, new game)
  /** Start of a game: everything manual goes off air and graphics that start visible (the score bug) come on. */
  function newGame() {
    for (const d of docs()) if (!derived(d)) oa.hide(d.id, 0);
    for (const d of docs()) if (d.show.startVisible && d.show.mode === "manual" && d.enabled) oa.show(d.id, { holdMs: hold(d) });
    sync();
  }
  function legacy(b: any) {
    const secs = (id: string) => { const d = getGraphic(store, id); return d?.show.mode === "auto-hide" ? d.show.seconds : undefined; };
    if ("scorebug" in b) { b.scorebug ? oa.show(LEGACY.scorebug) : oa.hide(LEGACY.scorebug, 0); }
    if ("slate" in b) { b.slate ? oa.show(LEGACY.slate, { fields: { text: String(b.slate).slice(0, 120) } }) : oa.hide(LEGACY.slate, 0); }
    if ("lower" in b) { b.lower ? oa.show(LEGACY.lower, { fields: { title: String(b.lower.title).slice(0, 60), sub: String(b.lower.sub ?? "").slice(0, 80) }, seconds: secs(LEGACY.lower) }) : oa.hide(LEGACY.lower, 0); }
    touch();
    const s = state(); return { scorebug: s.scorebug, lower: s.lower, slate: s.slate, sponsor: s.sponsor };
  }
  function sponsor(s: { name: string; color: string; seconds: number }) { oa.show(LEGACY.sponsor, { fields: { name: s.name, color: s.color, seconds: String(s.seconds) }, seconds: s.seconds }); touch(); }

  // ------------------------------------------------------------ documents
  function sample() { const ctx = deps.context(); return buildVars({ ...ctx, lower: lowerNow(), sponsor: sponsorNow() }); }
  const ensureFolder = (d: GraphicDoc) => { if ((d.kind === "html" || d.kind === "caspar") && !files.list(d.id).length) files.put(d.id, d.source.entry, new TextEncoder().encode(STARTER_HTML)); };
  const api = {
    list: () => docs(), get: need,
    create(input: any) {
      const d = createGraphic(input, now()); store.put("graphic", d); ensureFolder(d); touch(); return d;
    },
    save(id: string, input: any) { need(id); const d = saveGraphic(store, id, input); driven.delete(id); touch(); return d; },
    remove(id: string) {
      const d = need(id); if (isSeed(id)) throw new GfxError(409, "Built-in graphics cannot be deleted. Turn them off instead, or reset them to default.");
      oa.hide(id, 0); syncOne({ ...d, enabled: false }).catch(() => {}); store.del("graphic", id); files.remove(id); touch();
    },
    duplicate(id: string, name?: string) { need(id); const d = duplicateGraphic(store, id, name, now()); if (d.kind === "html" || d.kind === "caspar") for (const f of files.list(id)) files.put(d.id, f.path, files.read(id, f.path)!); touch(); return d; },
    reset(id: string) { oa.hide(id, 0); const d = resetBuiltin(store, id); touch(); return d; },
    files: { list: (id: string) => (need(id), files.list(id)), read: (id: string, p: string) => (need(id), files.read(id, p)),
      write(id: string, p: string, data: Uint8Array) { const d = need(id); if (d.kind !== "html" && d.kind !== "caspar") throw new GfxError(400, "Only HTML and CasparCG graphics have files."); try { files.put(id, p, data); } catch (e: any) { throw new GfxError(400, e.message); } bump(id); touch(); },
      remove(id: string, p: string) { need(id); try { files.remove(id, p); } catch (e: any) { throw new GfxError(400, e.message); } bump(id); touch(); } },
    sample,
    examples: () => EXAMPLES.map(({ html, fields, ...e }) => ({ ...e, fields })),
    installExample(eid: string) {
      const e = EXAMPLES.find((x) => x.id === eid); if (!e) throw new GfxError(404, "Unknown example.");
      const d = createGraphic({ kind: "caspar", name: e.title.replace(/ \(.*/, "") + " (example)", role: e.role, fields: e.fields, placement: { anchor: "top-left", x: 0, y: 0, scale: 1, z: e.z, opacity: 1 }, source: { entry: "index.html", width: 1920, height: 1080, dataFormat: e.dataFormat, stopHoldMs: 1200 } }, now());
      d.show = { mode: "manual" };
      store.put("graphic", d); files.write(d.id, [{ path: "index.html", data: new TextEncoder().encode(e.html) }]); touch(); return d;
    },
    async stageUpload(form: FormData) {
      try { const { entries, name } = await entriesFromForm(form); const s = stage(entries, name, crypto.randomUUID(), now()); stages.put(s); return publicStage(s); }
      catch (e: any) { if (e instanceof ImportError) throw new GfxError(400, e.message); throw e; }
    },
    commit(body: any) {
      let s; try { s = stages.get(String(body?.token ?? "")); } catch (e: any) { throw new GfxError(410, e.message); }
      let d: GraphicDoc;
      try {
        if (s.kind === "pack") { d = { ...s.pack!, ...(body?.name ? { name: String(body.name).slice(0, 60) } : {}) } as GraphicDoc; d.createdAt = d.updatedAt = now(); }
        else {
          const a = s.analysis!, kind = body?.kind === "html" ? "html" : "caspar", entry = String(body?.entry ?? a.entry);
          if (!s.files.some((f) => f.path === entry)) throw new ImportError(`The entry file "${entry}" is not in the upload.`);
          d = createGraphic({ kind, name: body?.name ?? s.name, role: body?.role ?? "other", fields: body?.fields ?? a.fields.map((f) => ({ name: f.id, label: f.id, type: "text", default: "", binding: f.suggestion ?? { kind: "manual", value: "" } })),
            placement: body?.placement ?? { anchor: "top-left", x: 0, y: 0, scale: 1, z: 30, opacity: 1 }, animation: body?.animation, show: body?.show, requiresGame: body?.requiresGame,
            source: { entry, width: body?.width ?? a.width, height: body?.height ?? a.height, allowNetwork: body?.allowNetwork ?? a.needsNetwork, dataFormat: body?.dataFormat ?? a.dataFormat, stopHoldMs: body?.stopHoldMs ?? 1500 } }, now());
        }
      } catch (e: any) { if (e instanceof GfxError || e instanceof ImportError) throw new GfxError(400, e.message); throw new GfxError(400, e.message); }
      store.put("graphic", d); files.write(d.id, s.files); stages.drop(s.token); touch(); return d;
    },
    exportPack(id: string) {
      const d = need(id), fs: Entry[] = (d.kind === "html" || d.kind === "caspar") ? files.list(id).map((f) => ({ path: f.path, data: files.read(id, f.path)! })) : [];
      return { name: d.name.replace(/[^\w\- ]/g, "").trim() || "graphic", bytes: exportPack(d, fs) };
    },
  };

  /** After a workspace import changed or removed these graphics: take them off air and refresh their files. */
  const reloaded = (ids: string[]) => { for (const id of ids) { oa.hide(id, 0); driven.delete(id); bump(id); } touch(); };

  // ------------------------------------------------------------ misc
  let lastKey = "";
  engine.onChange?.(() => { const k = engine.status().engine + "|" + live(); if (k !== lastKey) { lastKey = k; sync(); deps.changed(); } });
  newGame();

  return {
    ...api, reloaded, control, state, legacy, sponsor, newGame, sync, conns, fonts: { report: (b: any) => reportFonts(store, b, now()), view: () => fontsView(store) },
    legacyView: () => { const s = state(); return { scorebug: s.scorebug, lower: s.lower, slate: s.slate, sponsor: s.sponsor }; },
    serve: (req: Request) => serveGfx(req, files, (id) => getGraphic(store, id)), filesRoot: files,
    close() { clearTimeout(wake); clearInterval(ticker); conns.close(); },
  };
}
export type Graphics = ReturnType<typeof createGraphics>;
