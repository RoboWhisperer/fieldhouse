// Pure helpers for the Settings screens (no DOM, no app.js import) so they can be unit-checked with bun.

// ---- WCAG contrast
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export const isHex = (h) => /^#[0-9a-f]{6}$/i.test(h || "");
export const luminance = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
export const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** Readable >= 7 (WCAG AAA), Fair >= 4.5 (AA), otherwise Low. */
export const rate = (ratio) => (ratio >= 7 ? { id: "ready", label: "Readable" } : ratio >= 4.5 ? { id: "check", label: "Fair" } : { id: "err", label: "Low" });

// ---- keyboard shortcuts (normalised exactly like web/app.js `norm`)
export const normKey = (e) => [e.ctrlKey || e.metaKey ? "Ctrl" : "", e.shiftKey ? "Shift" : "", e.key.length === 1 ? e.key.toUpperCase() : e.key].filter(Boolean).join("+");
export const MODIFIER_KEYS = ["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock"];
const same = (k) => k.split("+").map((p) => (p.length === 1 ? p.toUpperCase() : p)).join("+");
/** -> [{key, actions:[...]}] for every key bound to two or more actions. */
export function conflicts(shortcuts) {
  const by = {};
  for (const [a, k] of Object.entries(shortcuts)) (by[same(k)] ||= []).push(a);
  return Object.entries(by).filter(([, v]) => v.length > 1).map(([key, actions]) => ({ key, actions }));
}
// Copied from defaultSettings() in src/data.ts (no reset endpoint exists).
export const DEFAULT_SHORTCUTS = {
  cut: "Enter", fade: "Shift+Enter", preview1: "1", preview2: "2", preview3: "3", preview4: "4",
  clock: "c", replay: "r", replayScore: "Shift+R", mark: "m", fireSponsor: "f",
  homePlus1: "q", homePlus2: "w", homePlus3: "e", awayPlus1: "i", awayPlus2: "o", awayPlus3: "p", undo: "Ctrl+Z",
};
export const SHORTCUT_GROUPS = [
  ["Switching", ["cut", "fade", "preview1", "preview2", "preview3", "preview4"]],
  ["Replay", ["replay", "replayScore", "mark"]],
  ["Game state", ["clock", "homePlus1", "homePlus2", "homePlus3", "awayPlus1", "awayPlus2", "awayPlus3", "undo"]],
  ["Sponsors", ["fireSponsor"]],
];
export const SHORTCUT_LABEL = {
  cut: "Cut Preview to Program", fade: "Fade Preview to Program", preview1: "Preview source 1", preview2: "Preview source 2", preview3: "Preview source 3", preview4: "Preview source 4",
  replay: "Replay last 10 seconds", replayScore: "Replay last score", mark: "Mark moment", clock: "Start or stop clock", fireSponsor: "Fire sponsor", undo: "Undo last change",
  homePlus1: "Home +1", homePlus2: "Home +2", homePlus3: "Home +3", awayPlus1: "Away +1", awayPlus2: "Away +2", awayPlus3: "Away +3",
};

// ---- misc
export const sportSummary = (p) => `${p.periods} periods of ${p.periodMin}:00, counting down. Bonus after ${p.bonusAt} team fouls. ${p.timeouts} timeouts per team, overtime periods of ${p.overtimeMin} min.`;
export function hoursLeft(freeBytes, recs) {
  const done = recs.filter((r) => r.endedAt && r.bytes > 0 && r.endedAt > r.startedAt);
  const hrs = done.reduce((n, r) => n + (r.endedAt - r.startedAt) / 3.6e6, 0);
  const measured = hrs > 0.05;
  const perHour = measured ? done.reduce((n, r) => n + r.bytes, 0) / hrs : (6e6 / 8) * 3600; // fallback: 6 Mbps
  return { hours: freeBytes / perHour, measured };
}
export const newCode = () => { const w = ["WILD", "HOOP", "COURT", "DUNK", "TIP", "SWISH"], n = crypto.getRandomValues(new Uint32Array(2)); return `${w[n[0] % w.length]}-${1000 + (n[1] % 9000)}`; };
