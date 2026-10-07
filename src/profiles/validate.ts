// Checks a sport profile that came from the API or an imported file. Builds a clean ProfileDoc from the known fields only
// (unknown fields are dropped, so files from a newer Fieldhouse still import). Every error says what to change.
import type { CounterDef, ProfileDoc, ScoreOption, WinRules } from "./types";

export const LIMITS = { counters: 12, scoring: 8, periods: 12, nameLen: 24, profileNameLen: 40, thresholds: 4 };

const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === "object" && !Array.isArray(x);
const fail = (msg: string): never => { throw new Error(msg); };
const int = (v: unknown, lo: number, hi: number, what: string) =>
  Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : fail(`${what} must be a whole number from ${lo} to ${hi}.`);
const text = (v: unknown, max: number, what: string) => {
  const s = typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim() : "";
  return s && s.length <= max ? s : fail(`${what} must be 1 to ${max} characters.`);
};
const ID = /^[a-z][a-z0-9_]{0,23}$/;
const idOf = (v: unknown, what: string) => (typeof v === "string" && ID.test(v) ? v : fail(`${what} needs an id of lowercase letters, digits or _ (like "red_card"), up to 24 characters.`));
const bool = (v: unknown, dflt: boolean, what: string) => (v === undefined ? dflt : typeof v === "boolean" ? v : fail(`${what} must be true or false.`));

export function validateProfile(input: unknown, id: string, builtin: boolean): ProfileDoc {
  if (!isObj(input)) return fail("A sport profile must be an object.");
  const p = input.periods, c = input.clock;
  if (!isObj(p)) fail("Say how many periods the game has (periods.count).");
  if (!isObj(c)) fail("Say how the clock works (clock.mode: down, up or none).");
  const mode = c.mode;
  if (mode !== "down" && mode !== "up" && mode !== "none") fail('The clock mode must be "down", "up" or "none".');

  const count = int(p.count, 1, LIMITS.periods, "The number of periods");
  const names = p.names === undefined ? undefined : (Array.isArray(p.names) && p.names.length <= count ? p.names.map((n: unknown, i: number) => text(n, LIMITS.nameLen, `Period name ${i + 1}`)) : fail(`Period names must be a list of at most ${count} names.`));
  const lengthMin = p.lengthMin == null ? undefined : int(p.lengthMin, 1, 180, "Minutes per period");
  if (mode !== "none" && lengthMin === undefined) fail("A sport with a clock needs minutes per period (periods.lengthMin).");
  const ot = isObj(p.overtime) ? p.overtime : {};
  const otOn = bool(ot.enabled, false, "overtime.enabled");
  const overtime = { enabled: otOn, lengthMin: ot.lengthMin === undefined && !otOn ? 1 : int(ot.lengthMin, 1, 180, "Overtime length"), namePrefix: ot.namePrefix === undefined ? "OT" : text(ot.namePrefix, 8, "The overtime name") };

  const format = typeof input.periodLabelFormat === "string" ? input.periodLabelFormat : "Period {n}";
  if (!format.includes("{n}") || format.length > LIMITS.nameLen) fail('The period label format must include {n} (like "Q{n}") and be at most 24 characters.');

  if (!Array.isArray(input.scoring) || !input.scoring.length || input.scoring.length > LIMITS.scoring) fail(`List 1 to ${LIMITS.scoring} ways to score.`);
  const seenS = new Set<string>(), seenKey = new Set<string>();
  const scoring: ScoreOption[] = input.scoring.map((s: any, i: number) => {
    if (!isObj(s)) return fail(`Scoring option ${i + 1} must be an object.`);
    const o: ScoreOption = { id: idOf(s.id, `Scoring option ${i + 1}`), label: text(s.label, LIMITS.nameLen, `Scoring option ${i + 1} label`), points: int(s.points, 1, 99, `Points for "${s.label ?? i + 1}"`) };
    if (seenS.has(o.id)) fail(`Two scoring options share the id "${o.id}". Each needs its own.`);
    seenS.add(o.id);
    if (s.hotkey !== undefined) { o.hotkey = text(s.hotkey, 12, `The key for "${o.label}"`); if (seenKey.has(o.hotkey)) fail(`The key "${o.hotkey}" is used twice.`); seenKey.add(o.hotkey); }
    return o;
  });

  const rawCounters = input.counters ?? [];
  if (!Array.isArray(rawCounters) || rawCounters.length > LIMITS.counters) fail(`A sport can have at most ${LIMITS.counters} counters.`);
  const seenC = new Set<string>();
  const counters: CounterDef[] = rawCounters.map((k: any, i: number) => {
    if (!isObj(k)) return fail(`Counter ${i + 1} must be an object.`);
    const label = text(k.label, LIMITS.nameLen, `Counter ${i + 1} label`);
    const d: CounterDef = { id: idOf(k.id, `Counter "${label}"`), label, perTeam: true, resetEachPeriod: bool(k.resetEachPeriod, false, `"${label}" resetEachPeriod`), showAs: k.showAs === "pips" || k.showAs === "number" ? k.showAs : fail(`"${label}" must be shown as "pips" or "number".`) };
    if (seenC.has(d.id)) fail(`Two counters share the id "${d.id}". Each needs its own.`);
    seenC.add(d.id);
    d.startValue = k.startValue === undefined ? 0 : int(k.startValue, 0, 99, `The starting value of "${label}"`);
    if (k.limit !== undefined) { d.limit = int(k.limit, 1, 99, `The limit of "${label}"`); if (d.limit < d.startValue) fail(`The limit of "${label}" cannot be lower than its starting value.`); }
    if (k.resetAtPeriods !== undefined) {
      if (!Array.isArray(k.resetAtPeriods) || k.resetAtPeriods.length > LIMITS.periods) fail(`"${label}" resetAtPeriods must be a list of period numbers.`);
      d.resetAtPeriods = k.resetAtPeriods.map((n: unknown) => int(n, 1, 99, `A reset period for "${label}"`));
    }
    if (k.thresholds !== undefined) {
      if (!Array.isArray(k.thresholds) || k.thresholds.length > LIMITS.thresholds) fail(`"${label}" can have at most ${LIMITS.thresholds} thresholds.`);
      d.thresholds = k.thresholds.map((t: any) => ({ at: int(t?.at, 1, 99, `A threshold for "${label}"`), label: text(t?.label, LIMITS.nameLen, `A threshold label for "${label}"`) })).sort((a: any, b: any) => a.at - b.at);
    }
    if (k.thresholdsApplyTo !== undefined) d.thresholdsApplyTo = k.thresholdsApplyTo === "self" || k.thresholdsApplyTo === "opponent" ? k.thresholdsApplyTo : fail(`thresholdsApplyTo for "${label}" must be "self" or "opponent".`);
    if (d.showAs === "pips" && !(d.limit || d.startValue || d.thresholds?.length)) fail(`"${label}" is shown as pips, so it needs a starting value, a limit or a threshold above 0 to know how many pips to draw.`);
    return d;
  });

  let win: WinRules | undefined;
  if (input.win !== undefined && input.win !== null) {
    const w = input.win;
    if (!isObj(w)) fail("The win rules must be an object.");
    win = { points: int(w.points, 1, 99, "Points to win a set"), winBy: int(w.winBy, 1, 10, "The winning margin"), setsToWin: int(w.setsToWin, 1, 10, "Sets needed to win") };
    if (w.cap !== undefined) { win.cap = int(w.cap, 1, 200, "The point cap"); if (win.cap < win.points) fail("The point cap cannot be lower than the points needed to win a set."); }
    if (w.decidingPoints !== undefined) win.decidingPoints = int(w.decidingPoints, 1, 99, "Points to win the deciding set");
    if (count < 2 * win.setsToWin - 1) fail(`Winning ${win.setsToWin} sets can take ${2 * win.setsToWin - 1} sets, so the game needs at least that many periods.`);
  }

  const bc = input.sponsorBreakCounter;
  if (bc !== undefined && bc !== null && !seenC.has(bc)) fail(`The sponsor-break counter "${bc}" is not one of this sport's counters.`);
  const dsp = isObj(input.display) ? input.display : {};

  const out: ProfileDoc = {
    id, name: text(input.name, LIMITS.profileNameLen, "The profile name"), builtin,
    sport: text(input.sport ?? input.name, LIMITS.nameLen, "The sport name"),
    starters: input.starters === undefined ? 0 : int(input.starters, 0, 30, "Starters per side"),
    periods: { count, ...(names && { names }), ...(lengthMin !== undefined && { lengthMin }), overtime },
    clock: { mode, displayFormat: c.displayFormat === undefined ? "mm:ss" : ["mm:ss", "m:ss", "tenths"].includes(c.displayFormat) ? c.displayFormat : fail('The clock format must be "mm:ss", "m:ss" or "tenths".') },
    scoring, counters, periodLabelFormat: format,
    display: { clock: bool(dsp.clock, mode !== "none", "display.clock"), period: bool(dsp.period, true, "display.period"), counters: bool(dsp.counters, counters.length > 0, "display.counters") },
  };
  if (mode === "up") {
    out.clock.carryOver = bool(c.carryOver, true, "clock.carryOver");
    if (c.maxMin !== undefined) out.clock.maxMin = int(c.maxMin, 1, 600, "The clock cap");
  }
  if (Array.isArray(c.stopsOn)) out.clock.stopsOn = c.stopsOn.slice(0, 12).map((s: unknown) => text(s, 40, "A clock-stop reason"));
  if (win) out.win = win;
  if (typeof bc === "string") out.sponsorBreakCounter = bc;
  return out;
}
