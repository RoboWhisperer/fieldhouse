// Serves recordings and highlight exports to the browser's <video>, with HTTP Range support (seeking needs it).
import { realpathSync, statSync } from "node:fs";
import { extname, join, sep } from "node:path";

const TYPES: Record<string, string> = { ".mp4": "video/mp4", ".m4v": "video/mp4", ".mkv": "video/x-matroska", ".webm": "video/webm", ".mov": "video/quicktime", ".ts": "video/mp2t" };
export const contentType = (file: string) => TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";

/** "bytes=a-b" | "bytes=a-" | "bytes=-n" -> inclusive [start, end]; "full" when absent/multi-range; null when unsatisfiable. */
export function parseRange(h: string | null, size: number): [number, number] | "full" | null {
  if (!h) return "full";
  const m = /^bytes=(\d*)-(\d*)$/.exec(h.trim());
  if (!m || (m[1] === "" && m[2] === "")) return h.includes(",") ? "full" : null;
  let start: number, end: number;
  if (m[1] === "") { const n = Number(m[2]); if (n === 0) return null; start = Math.max(0, size - n); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1); }
  return start >= size || start > end ? null : [start, end];
}

/** Resolves `file` only if it is a regular file whose real path stays inside `root` (when given). */
export function safeFile(file: string, root?: string): string | null {
  try {
    const real = realpathSync(file);
    if (root) { const r = realpathSync(root); if (real !== r && !real.startsWith(r + sep)) return null; }
    return statSync(real).isFile() ? real : null;
  } catch { return null; }
}

export function serveFile(req: Request, file: string, download = false): Response {
  const size = statSync(file).size, type = contentType(file);
  const base: Record<string, string> = { "accept-ranges": "bytes", "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" };
  if (download) base["content-disposition"] = `attachment; filename="${file.split(sep).pop()!.replace(/["\\\r\n]/g, "_")}"`;
  const r = parseRange(req.headers.get("range"), size);
  if (r === null) return new Response(null, { status: 416, headers: { ...base, "content-range": `bytes */${size}` } });
  const head = req.method === "HEAD";
  if (r === "full") return new Response(head ? null : Bun.file(file), { headers: { ...base, "content-length": String(size) } });
  const [a, b] = r;
  return new Response(head ? null : Bun.file(file).slice(a, b + 1), { status: 206, headers: { ...base, "content-range": `bytes ${a}-${b}/${size}`, "content-length": String(b - a + 1) } });
}

/** id = a recording id, or "highlights-<gameId>" for that game's export inside <storageDir>/highlights. */
export function resolveMedia(id: string, recordings: { id: string; file: string }[], storageDir: string): string | null {
  if (id.startsWith("highlights-")) {
    const gid = id.slice(11);
    if (!/^[\w-]+$/.test(gid)) return null;
    const dir = join(storageDir, "highlights");
    return safeFile(join(dir, `${gid}-highlights.mp4`), dir);
  }
  const rec = recordings.find((r) => r.id === id);
  return rec ? safeFile(rec.file) : null;
}
