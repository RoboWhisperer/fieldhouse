// Files of custom graphics live in <dataDir>/graphics/<id>/. Everything here is path-traversal safe by construction:
// every path is cleaned by zip.cleanPath first, then checked to stay inside the folder (also after resolving links).
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import type { GraphicDoc } from "./types";
import { ALLOWED_EXT, cleanPath, extOf, ImportError, LIMITS, type Entry } from "./zip";
import RUNTIME_JS from "./runtime.js" with { type: "text" };

export const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", json: "application/json; charset=utf-8", svg: "image/svg+xml",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", mp4: "video/mp4", webm: "video/webm",
};
export const ID_RE = /^[\w\-]{1,60}$/;

export class GraphicFiles {
  constructor(public root: string) {}
  dir(id: string) { if (!ID_RE.test(id)) throw new ImportError("That graphic id is not valid."); return join(this.root, id); }
  /** Absolute path of a file inside a graphic's folder, or throws. */
  resolveIn(id: string, rel: string) {
    const base = resolve(this.dir(id)), p = resolve(base, cleanPath(rel));
    if (!p.startsWith(base + sep)) throw new ImportError("That path is outside the graphic's folder.");
    return p;
  }
  write(id: string, files: Entry[], replace = true) {
    const base = this.dir(id);
    if (replace) rmSync(base, { recursive: true, force: true });
    for (const f of files) { const p = this.resolveIn(id, f.path); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, f.data); }
    mkdirSync(base, { recursive: true });
  }
  list(id: string): { path: string; bytes: number }[] {
    const base = this.dir(id), out: { path: string; bytes: number }[] = [];
    const walk = (d: string, pre: string) => { for (const n of existsSync(d) ? readdirSync(d) : []) { const full = join(d, n), st = statSync(full); st.isDirectory() ? walk(full, pre + n + "/") : out.push({ path: pre + n, bytes: st.size }); } };
    walk(base, ""); return out.sort((a, b) => a.path.localeCompare(b.path));
  }
  read(id: string, rel: string): Uint8Array | null {
    try { const p = this.resolveIn(id, rel); if (!existsSync(p) || !statSync(p).isFile()) return null; if (!realpathSync(p).startsWith(realpathSync(this.dir(id)) + sep)) return null; return readFileSync(p); } catch { return null; }
  }
  put(id: string, rel: string, data: Uint8Array) {
    if (!ALLOWED_EXT.includes(extOf(rel))) throw new ImportError(`The file type .${extOf(rel)} is not allowed.`);
    if (data.length > LIMITS.fileBytes) throw new ImportError(`A file can be at most ${LIMITS.fileBytes / 1048576} MB.`);
    const p = this.resolveIn(id, rel), others = this.list(id).filter((f) => resolve(this.dir(id), f.path) !== p);
    if (others.length >= LIMITS.files) throw new ImportError(`A graphic can have at most ${LIMITS.files} files.`);
    if (others.reduce((n, f) => n + f.bytes, data.length) > LIMITS.totalBytes) throw new ImportError(`A graphic can be at most ${LIMITS.totalBytes / 1048576} MB in total.`);
    mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, data);
  }
  remove(id: string, rel?: string) { rmSync(rel ? this.resolveIn(id, rel) : this.dir(id), { recursive: true, force: true }); }
  /** Move a staged folder into place as the graphic's folder. */
  adopt(from: string, id: string) { rmSync(this.dir(id), { recursive: true, force: true }); mkdirSync(this.root, { recursive: true }); renameSync(from, this.dir(id)); }
}

const sandboxCsp = (doc: GraphicDoc | undefined, host: string) => {
  const net = doc && "allowNetwork" in doc.source && doc.source.allowNetwork;
  const origin = `http://${host}`;
  return ["default-src 'none'", `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:${net ? " https: http:" : ""}`, `style-src 'self' 'unsafe-inline'${net ? " https: http:" : ""}`,
    `img-src 'self' data: blob:${net ? " https: http:" : ""}`, `media-src 'self' data: blob:${net ? " https: http:" : ""}`, `font-src 'self' data:${net ? " https: http:" : ""}`,
    net ? "connect-src https: http: wss: ws:" : `connect-src ${origin}/gfx/`, "base-uri 'self'", "form-action 'none'", "frame-src 'none'", "sandbox allow-scripts"].join("; ");
};
const BASE_HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff", "access-control-allow-origin": "*", "cross-origin-resource-policy": "cross-origin" };

/** OBS's browser on Linux can have NO font behind the generic names (serif, sans-serif...) or behind Arial/Helvetica, and then text is invisible.
 *  Every served page therefore starts with a default font stack and with aliases that map the common names onto fonts that exist (a template's own CSS still wins). */
export const FONT_STACK = 'system-ui,"Segoe UI",Roboto,"Noto Sans","DejaVu Sans","Liberation Sans",Arial,Helvetica,sans-serif';
const ALIAS: Record<string, string[]> = {
  Arial: ["Liberation Sans", "Arimo", "Nimbus Sans", "Roboto", "Noto Sans", "DejaVu Sans"], Helvetica: ["Liberation Sans", "Arimo", "Nimbus Sans", "Roboto", "Noto Sans", "DejaVu Sans"], "Helvetica Neue": ["Liberation Sans", "Roboto", "Noto Sans", "DejaVu Sans"],
  Verdana: ["DejaVu Sans", "Noto Sans"], Tahoma: ["DejaVu Sans Condensed", "Noto Sans", "DejaVu Sans"], "Segoe UI": ["Noto Sans", "Roboto", "DejaVu Sans"], "Trebuchet MS": ["Noto Sans", "DejaVu Sans"],
  "Times New Roman": ["Liberation Serif", "Tinos", "Nimbus Roman", "Noto Serif", "DejaVu Serif"], Georgia: ["DejaVu Serif", "Noto Serif", "Liberation Serif"], "Courier New": ["Liberation Mono", "Cousine", "Noto Mono", "DejaVu Sans Mono"], Impact: ["Oswald", "Roboto Condensed", "DejaVu Sans"],
};
const BASE_STYLE = `<style data-fh-base>${Object.entries(ALIAS).map(([n, alts]) => [400, 700].map((w) => `@font-face{font-family:"${n}";font-weight:${w};src:${[n, ...alts].map((a) => `local("${a}${w === 700 ? " Bold" : ""}")`).join(",")}}`).join("")).join("")}html,body{font-family:${FONT_STACK}}</style>`;

/** Add the base style and the Fieldhouse runtime to a page. */
export function injectRuntime(html: string) {
  const withStyle = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + BASE_STYLE) : BASE_STYLE + html;
  return /<\/body\s*>/i.test(withStyle) ? withStyle.replace(/<\/body\s*>/i, '<script src="/gfx/_runtime.js"></script></body>') : withStyle + '<script src="/gfx/_runtime.js"></script>';
}

/** GET /gfx/_runtime.js and GET /gfx/<id>/<path>. Loopback only (the remote gate never lets /gfx through). */
export function serveGfx(req: Request, files: GraphicFiles, docOf: (id: string) => GraphicDoc | undefined): Response {
  const u = new URL(req.url);
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("method not allowed", { status: 405 });
  if (u.pathname === "/gfx/_runtime.js") return new Response(RUNTIME_JS, { headers: { ...BASE_HEADERS, "content-type": TYPES.js } });
  let rest: string; try { rest = decodeURIComponent(u.pathname.slice("/gfx/".length)); } catch { return new Response("bad path", { status: 400 }); }
  const i = rest.indexOf("/"), id = i < 0 ? rest : rest.slice(0, i), rel = i < 0 ? "" : rest.slice(i + 1);
  if (!rel || !ID_RE.test(id)) return new Response("not found", { status: 404 });
  let data: Uint8Array | null;
  try { data = files.read(id, rel); } catch { return new Response("not found", { status: 404 }); }
  if (!data) return new Response("not found", { status: 404 });
  const ext = extOf(rel);
  const headers: Record<string, string> = { ...BASE_HEADERS, "content-type": TYPES[ext] ?? "application/octet-stream" };
  if (ext === "html") {
    headers["content-security-policy"] = sandboxCsp(docOf(id), u.host);
    const text = new TextDecoder().decode(data);
    return new Response(req.method === "HEAD" ? null : injectRuntime(text), { headers });
  }
  headers["content-security-policy"] = "sandbox allow-scripts"; // an SVG (or anything else) must never run as the console
  return new Response(req.method === "HEAD" ? null : (data as BodyInit), { headers });
}
