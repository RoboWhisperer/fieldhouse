// Pure helpers over a profile: labels, the summary UIs draw from, and the old five-field "Sport profile" settings view.
import type { Trigger } from "../types";
import type { ProfileDoc, ProfileSummary } from "./types";

export const periodMs = (p: ProfileDoc, period: number) => (period > p.periods.count ? p.periods.overtime.lengthMin : p.periods.lengthMin ?? 0) * 60_000;

/** Where the clock stands when a period begins. Up clocks carry on from the previous period (2nd half starts at 45:00). */
export function clockStart(p: ProfileDoc, period: number): number {
  if (p.clock.mode === "none") return 0;
  if (p.clock.mode === "down") return periodMs(p, period);
  if (p.clock.carryOver === false) return 0;
  let ms = 0;
  for (let q = 1; q < period; q++) ms += periodMs(p, q);
  return ms;
}

/** "Q3", "2nd half", "Set 2"; past the last period it is "OT", "OT2"... */
export function periodLabel(p: ProfileDoc, period: number): string {
  if (period > p.periods.count) { const n = period - p.periods.count; return p.periods.overtime.namePrefix + (n > 1 ? n : ""); }
  return p.periods.names?.[period - 1] ?? p.periodLabelFormat.replace("{n}", String(period));
}

/** The highest period number an event may set: regulation plus up to 5 overtimes (basketball keeps its old limit of 9). */
export const maxPeriod = (p: ProfileDoc) => p.periods.count + (p.periods.overtime.enabled ? 5 : 0);

export function summary(p: ProfileDoc): ProfileSummary {
  const labels = Array.from({ length: p.periods.count + (p.periods.overtime.enabled ? 1 : 0) }, (_, i) => periodLabel(p, i + 1));
  const bc = p.sponsorBreakCounter ?? (p.counters.some((c) => c.id === "timeouts") ? "timeouts" : null);
  return {
    id: p.id, name: p.name, sport: p.sport, scoring: p.scoring, counters: p.counters, periodLabels: labels, periodCount: p.periods.count, overtime: p.periods.overtime.enabled,
    clockMode: p.clock.mode, displayFormat: p.clock.displayFormat, win: p.win ?? null, display: p.display, sponsorBreakCounter: bc,
  };
}

/** The five numbers the original Settings > Sport profile screen edits, read from a (basketball-shaped) profile. */
export interface LegacyProfile { periods: number; periodMin: number; overtimeMin: number; bonusAt: number; timeouts: number }
export const legacyView = (p: ProfileDoc): LegacyProfile => ({
  periods: p.periods.count, periodMin: p.periods.lengthMin ?? 8, overtimeMin: p.periods.overtime.lengthMin,
  bonusAt: p.counters.find((c) => c.id === "fouls")?.thresholds?.[0]?.at ?? 5, timeouts: p.counters.find((c) => c.id === "timeouts")?.startValue ?? 3,
});

/** Write old-style fields onto a profile (returns a changed copy). Period names beyond the new count are trimmed. */
export function applyLegacy(p: ProfileDoc, l: Partial<LegacyProfile>): ProfileDoc {
  const q: ProfileDoc = structuredClone(p);
  if (l.periods !== undefined) { q.periods.count = l.periods; if (q.periods.names) q.periods.names = q.periods.names.slice(0, l.periods); }
  if (l.periodMin !== undefined) q.periods.lengthMin = l.periodMin;
  if (l.overtimeMin !== undefined) q.periods.overtime.lengthMin = l.overtimeMin;
  const fouls = q.counters.find((c) => c.id === "fouls"), to = q.counters.find((c) => c.id === "timeouts");
  if (l.bonusAt !== undefined && fouls) fouls.thresholds = [{ at: l.bonusAt, label: fouls.thresholds?.[0]?.label ?? "Bonus" }];
  if (l.timeouts !== undefined && to) to.startValue = l.timeouts;
  return q;
}

/** Which sponsor slot the game is in right now (see sponsors.ts): play is on, or the period/half/game just ended. */
export function breakTrigger(p: ProfileDoc, v: { clockMs: number; period: number }): Trigger {
  const upEnd = p.clock.carryOver === false ? periodMs(p, v.period) : clockStart(p, v.period + 1); // up clocks: the period is over once the clock passes its end
  const live = p.clock.mode === "none" || (p.clock.mode === "down" ? v.clockMs > 0 : v.clockMs < upEnd);
  if (live) return "timeout";
  return v.period === (p.periods.count % 2 === 0 ? p.periods.count / 2 : -1) ? "halftime" : v.period >= p.periods.count ? "postgame" : "period_end";
}
