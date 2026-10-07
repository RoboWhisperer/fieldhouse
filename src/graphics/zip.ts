// Safe zip reading and plain zip writing with node:zlib only. Reading never touches the disk: it returns validated entries,
// so a hostile archive (zip-slip paths, symlinks, bombs, odd file types) is rejected before anything is written.
import { deflateRawSync, inflateRawSync } from "node:zlib";

export const LIMITS = { totalBytes: 50 * 1024 * 1024, files: 500, fileBytes: 25 * 1024 * 1024 };
export const ALLOWED_EXT = ["html", "css", "js", "json", "svg", "png", "jpg", "jpeg", "gif", "webp", "woff", "woff2", "ttf", "otf", "mp4", "webm"];
export interface Entry { path: string; data: Uint8Array }
export interface Skipped { path: string; why: string }
export class ImportError extends Error {}

const T = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export const crc32 = (b: Uint8Array) => { let c = ~0; for (let i = 0; i < b.length; i++) c = T[(c ^ b[i]) & 0xff] ^ (c >>> 8); return ~c >>> 0; };

/** Returns the clean relative path (forward slashes) or throws ImportError for anything that could escape the folder. */
export function cleanPath(raw: string): string {
  if (!raw || raw.includes("\0")) throw new ImportError("A file in the archive has an empty or invalid name.");
  if (raw.includes("\\")) throw new ImportError(`"${raw}" uses a backslash path. Re-zip it with forward slashes.`);
  if (raw.startsWith("/") || /^[a-zA-Z]:/.test(raw)) throw new ImportError(`"${raw}" is an absolute path. Files must stay inside the graphic's folder.`);
  const parts = raw.split("/");
  if (parts.some((p) => p === ".." || p === "." || p === "")) throw new ImportError(`"${raw}" tries to leave the graphic's folder.`);
  if (raw.length > 200 || parts.some((p) => !/^[\w\-. ()@+]+$/.test(p) || p.startsWith("."))) throw new ImportError(`"${raw}" has a name Fieldhouse cannot use. Use letters, digits, spaces, dots, dashes and underscores.`);
  return raw;
}
export const extOf = (p: string) => (p.split(".").pop() ?? "").toLowerCase();

/** Common rules for every way files arrive (zip, several uploads, a pack). Disallowed types are skipped and reported, never stored. */
export function vet(files: Entry[]): { files: Entry[]; skipped: Skipped[] } {
  const out: Entry[] = [], skipped: Skipped[] = [], seen = new Set<string>();
  let total = 0;
  for (const f of files) {
    if (/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)(\/|$)/.test(f.path)) continue;
    const path = cleanPath(f.path);
    if (seen.has(path.toLowerCase())) throw new ImportError(`The file "${path}" appears twice.`);
    seen.add(path.toLowerCase());
    const ext = extOf(path);
    if (!ALLOWED_EXT.includes(ext)) { skipped.push({ path, why: ext === "ft" || ext === "swf" ? "Flash templates cannot run here." : `The file type .${ext || "(none)"} is not allowed.` }); continue; }
    if (f.data.length > LIMITS.fileBytes) throw new ImportError(`"${path}" is larger than ${LIMITS.fileBytes / 1048576} MB.`);
    total += f.data.length;
    if (total > LIMITS.totalBytes) throw new ImportError(`The files add up to more than ${LIMITS.totalBytes / 1048576} MB.`);
    if (out.length >= LIMITS.files) throw new ImportError(`There are more than ${LIMITS.files} files.`);
    out.push({ path, data: f.data });
  }
  return { files: out, skipped };
}

/** Read a zip (stored or deflate). Throws ImportError on symlinks, encryption, zip64, size mismatches and anything over the limits. */
export function readZip(buf: Uint8Array): Entry[] {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new ImportError("That file is not a zip archive.");
  const count = b.readUInt16LE(eocd + 10), cdOff = b.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOff === 0xffffffff) throw new ImportError("Zip64 archives are not supported. Make a normal zip.");
  if (count > LIMITS.files * 4) throw new ImportError(`There are more than ${LIMITS.files} files.`);
  const out: Entry[] = [];
  let p = cdOff, declared = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== 0x02014b50) throw new ImportError("The zip archive is damaged.");
    const madeBy = b.readUInt16LE(p + 4), flags = b.readUInt16LE(p + 8), method = b.readUInt16LE(p + 10), csize = b.readUInt32LE(p + 20), usize = b.readUInt32LE(p + 24);
    const nlen = b.readUInt16LE(p + 28), elen = b.readUInt16LE(p + 30), clen = b.readUInt16LE(p + 32), ext = b.readUInt32LE(p + 38), lho = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nlen).toString("utf8");
    p += 46 + nlen + elen + clen;
    if (name.endsWith("/")) continue; // directory
    if (madeBy >> 8 === 3) { const mode = (ext >>> 16) & 0o170000; if (mode === 0o120000) throw new ImportError(`"${name}" is a symbolic link. Links are not allowed in graphics.`); if (mode !== 0 && mode !== 0o100000) throw new ImportError(`"${name}" is not an ordinary file.`); }
    if (flags & 1) throw new ImportError("Password-protected zips are not supported.");
    if (usize > LIMITS.fileBytes) throw new ImportError(`"${name}" is larger than ${LIMITS.fileBytes / 1048576} MB.`);
    declared += usize;
    if (declared > LIMITS.totalBytes) throw new ImportError(`The files add up to more than ${LIMITS.totalBytes / 1048576} MB.`);
    if (lho + 30 > b.length || b.readUInt32LE(lho) !== 0x04034b50) throw new ImportError("The zip archive is damaged.");
    const start = lho + 30 + b.readUInt16LE(lho + 26) + b.readUInt16LE(lho + 28);
    if (start + csize > b.length) throw new ImportError("The zip archive is damaged.");
    const raw = b.subarray(start, start + csize);
    let data: Uint8Array;
    if (method === 0) data = raw;
    else if (method === 8) { try { data = inflateRawSync(raw, { maxOutputLength: usize + 1 }); } catch { throw new ImportError(`"${name}" is damaged or larger than it says (possible zip bomb).`); } }
    else throw new ImportError(`"${name}" uses a compression type that is not supported.`);
    if (data.length !== usize) throw new ImportError(`"${name}" does not match its recorded size.`);
    out.push({ path: name, data: new Uint8Array(data) });
  }
  return out;
}

/** Write a plain zip (deflate). Used for .fhgfx exports. */
export function writeZip(files: Entry[]): Uint8Array {
  const parts: Buffer[] = [], central: Buffer[] = [];
  let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.path), raw = Buffer.from(f.data), def = deflateRawSync(raw), useDef = def.length < raw.length, body = useDef ? def : raw, crc = crc32(f.data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(useDef ? 8 : 0, 8); h.writeUInt32LE(0x00210000, 10); // date 1980-01-01
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(name.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(0x031e, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(useDef ? 8 : 0, 10); c.writeUInt32LE(0x00210000, 12);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(0o100644 << 16 >>> 0, 38); c.writeUInt32LE(off, 42);
    parts.push(h, name, body); central.push(c, name); off += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, end]));
}
