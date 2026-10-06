// Engine health history: one sample every 5 s while live or recording, kept per game and capped.
import type { EngineStatus } from "./types";
import type { Store } from "./store";

export interface Sample { t: number; kbps: number; dropped: number; cpu: number; diskFree: number }
export interface HealthDoc { id: string; gameId: string; every: number; ticks: number; samples: Sample[]; pend?: Sample } // every = ticks per stored sample (doubles on each downsample)
export const CAP = 720; // 1 hour at 5 s; longer games are thinned, never truncated

const pair = (a: Sample, b: Sample): Sample => ({ t: a.t, kbps: Math.min(a.kbps, b.kbps), dropped: Math.max(a.dropped, b.dropped), cpu: Math.round((a.cpu + b.cpu) / 2), diskFree: Math.min(a.diskFree, b.diskFree) }); // min bitrate so a dip survives thinning; dropped is a running total

/** Pure: add a sample, thinning the whole series to half the points when over the cap. */
export function addSample(doc: HealthDoc, s: Sample, cap = CAP): HealthDoc {
  doc.ticks++;
  doc.pend = doc.pend ? pair(doc.pend, s) : s; // between stored points, fold ticks together so a dip is never skipped
  if (doc.ticks % doc.every !== 0) return doc;
  doc.samples.push({ ...doc.pend, t: s.t }); doc.pend = undefined;
  if (doc.samples.length > cap) {
    const out: Sample[] = [];
    for (let i = 0; i < doc.samples.length; i += 2) out.push(doc.samples[i + 1] ? pair(doc.samples[i], doc.samples[i + 1]) : doc.samples[i]);
    doc.samples = out; doc.every *= 2;
  }
  return doc;
}

export const isActive = (e: EngineStatus) => e.stream.live || e.record.active;

export function sampleEngine(store: Store, gameId: string, e: EngineStatus, t: number, cap = CAP): boolean {
  if (!gameId || !isActive(e)) return false;
  const doc = store.get<HealthDoc>("health", gameId) ?? { id: gameId, gameId, every: 1, ticks: 0, samples: [] };
  addSample(doc, { t, kbps: e.stream.kbps, dropped: e.stream.droppedFrames, cpu: Math.round(e.cpu), diskFree: e.diskFreeBytes }, cap);
  store.put("health", doc);
  return true;
}

/** The most recently sampled game, for Settings > Diagnostics. */
export function lastSeries(store: Store, titleOf: (gameId: string) => string | undefined) {
  const docs = store.list<HealthDoc>("health").filter((h) => h.samples.length);
  const h = docs.sort((a, b) => a.samples.at(-1)!.t - b.samples.at(-1)!.t).at(-1);
  if (!h) return null;
  return { gameId: h.gameId, title: titleOf(h.gameId) ?? null, startedAt: h.samples[0].t, intervalSec: 5 * h.every, droppedFrames: h.samples.at(-1)!.dropped, samples: h.samples };
}
