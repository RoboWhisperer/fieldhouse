// HTTP routes of the graphics system (all under /api). Registered with one call from createApp(); documented in docs/dev/graphics-api.md.
// Fixed paths are registered before the ":id" ones because the first matching route wins.
import type { Graphics } from "./graphics";
import { GfxError } from "./graphics/error";
import { MAX_UPLOAD } from "./graphics/importer";
import { sampleVars } from "./graphics/vars";

type On = (method: string, pattern: string, h: (a: { body: any; params: string[]; q: URLSearchParams; req: Request }) => unknown | Promise<unknown>) => void;
const b64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

export function registerGraphicsRoutes(on0: On, { gfx, bad }: { gfx: Graphics; bad: (msg: string, status?: number) => never }) {
  // GfxError -> the app's plain error response with the right status
  const on: On = (m, p, h) => on0(m, p, async (a) => { try { return await h(a); } catch (e: any) { if (e instanceof GfxError) bad(e.message, e.status); throw e; } });
  const withState = (d: any) => ({ ...d, visible: !!gfx.control.list().find((x) => x.id === d.id)?.visible });
  const fieldsOf = (b: any) => (b && typeof b === "object" ? b.fields : undefined);
  const need = (v: unknown, what: string) => (typeof v === "string" && v ? v : bad(`${what} is required.`));

  // ---- fixed paths
  on("GET", "/graphics", () => { const on = new Map(gfx.control.list().map((x) => [x.id, x.visible])); return gfx.list().map((d) => ({ ...d, visible: !!on.get(d.id) })); });
  on("GET", "/graphics/state", () => gfx.state());
  on("GET", "/graphics/sample-vars", ({ q }) => (q.get("live") === "1" ? gfx.sample() : sampleVars()));
  on("POST", "/graphics/create", ({ body }) => gfx.create(body));
  on("POST", "/graphics/clear", async () => { await gfx.control.clear(); return { ok: true }; });
  on("GET", "/graphics/fonts", () => gfx.fonts.view());
  on("POST", "/graphics/fonts/report", ({ body }) => { gfx.fonts.report(body); return { ok: true }; });
  on("GET", "/graphics/examples", () => gfx.examples());
  on("POST", "/graphics/examples/:id/install", ({ params }) => gfx.installExample(params[0]));
  on("POST", "/graphics/import", async ({ req }) => {
    if (!(req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) bad("Send the file as multipart/form-data (field name \"file\").", 415);
    if (Number(req.headers.get("content-length") ?? 0) > MAX_UPLOAD) bad("That upload is too large.", 413); // before the body is read into memory
    return gfx.stageUpload(await req.formData());
  });
  on("POST", "/graphics/import/commit", ({ body }) => gfx.commit(body));

  // ---- connectors
  on("GET", "/graphics/connectors", () => gfx.conns.list());
  on("POST", "/graphics/connectors", ({ body }) => gfx.conns.save(body));
  on("PUT", "/graphics/connectors/:id", ({ body, params }) => { const v = gfx.conns.save(body, params[0]); gfx.sync(); return v; });
  on("DELETE", "/graphics/connectors/:id", ({ params }) => { gfx.conns.remove(params[0]); return { ok: true }; });
  on("POST", "/graphics/connectors/:id/test", ({ params }) => gfx.conns.test(params[0]));
  on("GET", "/graphics/connectors/:id/model", ({ params }) => gfx.conns.model(params[0]));

  // ---- one graphic
  on("GET", "/graphics/:id", ({ params }) => withState(gfx.get(params[0])));
  on("PUT", "/graphics/:id", ({ body, params }) => gfx.save(params[0], body));
  on("DELETE", "/graphics/:id", ({ params }) => { gfx.remove(params[0]); return { ok: true }; });
  on("POST", "/graphics/:id/duplicate", ({ body, params }) => gfx.duplicate(params[0], body?.name));
  on("POST", "/graphics/:id/reset", ({ params }) => gfx.reset(params[0]));
  on("POST", "/graphics/:id/show", async ({ body, params }) => { await gfx.control.show(params[0], fieldsOf(body)); return { ok: true, visible: true }; });
  on("POST", "/graphics/:id/hide", async ({ params }) => { await gfx.control.hide(params[0]); return { ok: true, visible: false }; });
  on("POST", "/graphics/:id/toggle", async ({ params }) => { await gfx.control.toggle(params[0]); return { ok: true, visible: gfx.control.list().find((x) => x.id === params[0])?.visible ?? false }; });
  on("POST", "/graphics/:id/update", async ({ body, params }) => { await gfx.control.update(params[0], fieldsOf(body) ?? bad("Send {\"fields\": {...}}.")); return { ok: true }; });
  on("POST", "/graphics/:id/next", async ({ params }) => { await gfx.control.next(params[0]); return { ok: true }; });
  on("GET", "/graphics/:id/export", ({ params }) => {
    const { name, bytes } = gfx.exportPack(params[0]);
    return new Response(bytes as BodyInit, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${name}.fhgfx"` } });
  });
  on("GET", "/graphics/:id/files", ({ params }) => gfx.files.list(params[0]));
  on("GET", "/graphics/:id/file", ({ params, q }) => {
    const data = gfx.files.read(params[0], need(q.get("path"), "path")); if (!data) bad("File not found.", 404);
    const text = !/\.(png|jpe?g|gif|webp|woff2?|ttf|otf|mp4|webm)$/i.test(q.get("path")!);
    return text ? { path: q.get("path"), content: new TextDecoder().decode(data!) } : { path: q.get("path"), contentBase64: Buffer.from(data!).toString("base64") };
  });
  on("PUT", "/graphics/:id/file", ({ params, body }) => {
    const path = need(body?.path, "path");
    if (typeof body.content === "string") gfx.files.write(params[0], path, new TextEncoder().encode(body.content));
    else if (typeof body.contentBase64 === "string") gfx.files.write(params[0], path, b64(body.contentBase64));
    else bad("Send content (text) or contentBase64.");
    return gfx.files.list(params[0]);
  });
  on("DELETE", "/graphics/:id/file", ({ params, q }) => { gfx.files.remove(params[0], need(q.get("path"), "path")); return gfx.files.list(params[0]); });
}
