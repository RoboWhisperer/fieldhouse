// Run: bun test web/screens/settings.test.js
import { expect, test } from "bun:test";
import { contrast, rate, normKey, conflicts, hoursLeft } from "./settings-lib.js";
import { qrMatrix, rsEc, formatBits } from "./settings-qr.js";

test("contrast follows WCAG", () => {
  expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
  expect(contrast("#F5A524", "#0b1018")).toBeGreaterThan(7);
  expect(rate(9.3).label).toBe("Readable"); expect(rate(4.6).label).toBe("Fair"); expect(rate(2).label).toBe("Low");
});

test("key normalisation matches app.js", () => {
  expect(normKey({ key: "r", shiftKey: true })).toBe("Shift+R");
  expect(normKey({ key: "z", ctrlKey: true })).toBe("Ctrl+Z");
  expect(normKey({ key: "Enter" })).toBe("Enter");
  expect(conflicts({ replay: "r", mark: "R", cut: "Enter" })).toEqual([{ key: "R", actions: ["replay", "mark"] }]);
});

test("hours left falls back to 6 Mbps", () => { const h = hoursLeft(2.7e9, []); expect(h.measured).toBe(false); expect(h.hours).toBeCloseTo(1, 5); });

test("Reed-Solomon and format info match published vectors", () => {
  // "HELLO WORLD" 1-M example: 10 EC codewords
  expect(rsEc([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  expect(formatBits(0).toString(2).padStart(15, "0")).toBe("111011111000100"); // L, mask 0
});

// Independent-ish decoder: format info (both copies) -> unmask -> read codewords -> check RS -> parse byte mode.
function decode(m) {
  const n = m.length, v = (n - 17) / 4, b = (x, y) => (m[y][x] ? 1 : 0);
  const f1 = []; for (let i = 0; i <= 5; i++) f1.push(b(8, i)); f1.push(b(8, 7), b(8, 8), b(7, 8)); for (let i = 9; i < 15; i++) f1.push(b(14 - i, 8));
  const f2 = []; for (let i = 0; i < 8; i++) f2.push(b(n - 1 - i, 8)); for (let i = 8; i < 15; i++) f2.push(b(8, n - 15 + i));
  expect(f1).toEqual(f2);
  const fv = f1.reduce((a, bit, i) => a | (bit << i), 0) ^ 0x5412, mask = (fv >> 10) & 7;
  expect(fv >> 13).toBe(1); // ECC L
  expect(formatBits(mask)).toBe(f1.reduce((a, bit, i) => a | (bit << i), 0));
  const MASK = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0, (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0][mask];
  // function-module map built from the spec, independent of the encoder
  const fn = Array.from({ length: n }, () => new Array(n).fill(false));
  const rect = (x0, y0, w, h) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (x >= 0 && y >= 0 && x < n && y < n) fn[y][x] = true; };
  rect(0, 0, 9, 9); rect(n - 8, 0, 8, 9); rect(0, n - 8, 9, 8); rect(6, 0, 1, n); rect(0, 6, n, 1); if (v > 1) rect(n - 9, n - 9, 5, 5);
  const bits = []; let up = true;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let k = 0; k < n; k++) { const y = up ? n - 1 - k : k; for (const x of [right, right - 1]) if (!fn[y][x]) bits.push(b(x, y) ^ (MASK(x, y) ? 1 : 0)); }
    up = !up;
  }
  const [dcw, ecn] = { 1: [19, 7], 2: [34, 10], 3: [55, 15], 4: [80, 20] }[v];
  const cw = []; for (let i = 0; i < (dcw + ecn); i++) cw.push(parseInt(bits.slice(i * 8, i * 8 + 8).join(""), 2));
  expect(rsEc(cw.slice(0, dcw), ecn)).toEqual(cw.slice(dcw));
  const s = cw.slice(0, dcw).map((c) => c.toString(2).padStart(8, "0")).join("");
  expect(s.slice(0, 4)).toBe("0100");
  const len = parseInt(s.slice(4, 12), 2);
  return new TextDecoder().decode(new Uint8Array(Array.from({ length: len }, (_, i) => parseInt(s.slice(12 + i * 8, 20 + i * 8), 2))));
}

test("QR round-trips for versions 1-4", () => {
  for (const t of ["http://a.b", "http://192.168.1.24:8080/#/remote", "http://192.168.100.200:8080/#/remote?code=WILD-4821", "x".repeat(78)]) {
    const m = qrMatrix(t); expect(m).not.toBeNull(); expect(decode(m)).toBe(t);
  }
  expect(qrMatrix("x".repeat(79))).toBeNull();
});
