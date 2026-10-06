// Minimal QR encoder: byte mode, error correction L, versions 1-4 (one block each, so no interleaving).
// ponytail: mask penalty uses rules 1, 2 and 4 only (rule 3 skipped); every mask is still a valid code.
const DATA_EC = { 1: [19, 7], 2: [34, 10], 3: [55, 15], 4: [80, 20] };
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

/** Reed-Solomon remainder (n error-correction codewords). */
export function rsEc(data, n) {
  let g = [1];
  for (let i = 0; i < n; i++) { const ng = new Array(g.length + 1).fill(0); g.forEach((c, j) => { ng[j] ^= c; ng[j + 1] ^= mul(c, EXP[i]); }); g = ng; }
  const r = new Array(n).fill(0);
  for (const b of data) { const f = b ^ r[0]; r.shift(); r.push(0); for (let i = 0; i < n; i++) r[i] ^= mul(g[i + 1], f); }
  return r;
}

export const formatBits = (mask) => { // ECC L = 01
  const d = (1 << 3) | mask; let rem = d;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((d << 10) | rem) ^ 0x5412;
};
const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (((x / 3) | 0) + ((y / 2) | 0)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0, (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0];

function penalty(m) {
  const n = m.length; let p = 0, dark = 0;
  for (let t = 0; t < 2; t++) for (let a = 0; a < n; a++) {
    let run = 1;
    for (let b = 1; b < n; b++) {
      const cur = t ? m[b][a] : m[a][b], prev = t ? m[b - 1][a] : m[a][b - 1];
      if (cur === prev) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1;
    }
  }
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
  for (const r of m) for (const c of r) if (c) dark++;
  return p + Math.floor(Math.abs((dark * 20) / (n * n) - 10)) * 10;
}

/** -> boolean[][] (true = dark) or null when the text does not fit version 4. */
export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(text)];
  const v = [1, 2, 3, 4].find((k) => bytes.length <= DATA_EC[k][0] - 2);
  if (!v) return null;
  const [dcw, ecn] = DATA_EC[v], size = 17 + 4 * v, bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  push(4, 4); push(bytes.length, 8); bytes.forEach((b) => push(b, 8));
  push(0, Math.min(4, dcw * 8 - bits.length)); while (bits.length % 8) bits.push(0);
  for (let pad = 0xec; bits.length < dcw * 8; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  const all = [...data, ...rsEc(data, ecn)];

  const m = Array.from({ length: size }, () => new Array(size).fill(false)), fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, d) => { if (x >= 0 && y >= 0 && x < size && y < size) { m[y][x] = d; fn[y][x] = true; } };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)); set(cx + dx, cy + dy, d !== 2 && d !== 4); }
  if (v > 1) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(size - 7 + dx, size - 7 + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  const drawFormat = (mm, mask) => {
    const f = formatBits(mask), bit = (i) => ((f >>> i) & 1) === 1, put = (x, y, d) => { mm[y][x] = d; };
    for (let i = 0; i <= 5; i++) put(8, i, bit(i));
    put(8, 7, bit(6)); put(8, 8, bit(7)); put(7, 8, bit(8));
    for (let i = 9; i < 15; i++) put(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) put(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) put(8, size - 15 + i, bit(i));
    put(8, size - 8, true);
  };
  // reserve the format cells (bits are drawn per mask below)
  for (let i = 0; i < 9; i++) { fn[8][i] = fn[i][8] = true; }
  for (let i = 0; i < 8; i++) { fn[8][size - 1 - i] = true; fn[size - 1 - i][8] = true; }
  fn[size - 8][8] = true;

  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
      if (!fn[y][x] && i < all.length * 8) { m[y][x] = ((all[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
    }
  }
  let best = null, bestP = Infinity;
  MASKS.forEach((f, mask) => {
    const c = m.map((r) => r.slice());
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && f(x, y)) c[y][x] = !c[y][x];
    drawFormat(c, mask);
    const p = penalty(c); if (p < bestP) { bestP = p; best = c; }
  });
  return best;
}

/** SVG path data (1 unit per module) for the dark modules. */
export const qrPath = (m) => m.flatMap((r, y) => r.map((d, x) => (d ? `M${x} ${y}h1v1h-1z` : ""))).join("");
