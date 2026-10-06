// Retention (automatic cleanup of old recordings) and the low-disk watchdog.
import type { GameDoc, RecordingDoc, SettingsDoc } from "./types";
import type { Store } from "./store";
import { deleteRecording } from "./storage";
import { safeFile } from "./media";

const DAY = 86_400_000;
export const POLICY_MS: Record<SettingsDoc["retention"], number | null> = { never: null, "90d": 90 * DAY, season: 365 * DAY };

export interface Candidate { id: string; gameId: string; file: string; bytes: number; ageDays: number; why: string }

/** Dry run: what the policy would delete right now. Nothing here touches disk. */
export function retentionPlan(store: Store, settings: Pick<SettingsDoc, "retention" | "storageDir" | "activeGameId">, now: number): Candidate[] {
  const ms = POLICY_MS[settings.retention];
  if (!ms) return [];
  const out: Candidate[] = [];
  for (const r of store.list<RecordingDoc>("recording")) {
    if (!r.endedAt) continue; // still recording
    if (r.gameId === settings.activeGameId) continue; // the game on screen is never touched
    const game = store.get<GameDoc>("game", r.gameId);
    if (game?.status !== "final") continue; // unknown or unfinished game: keep
    const age = now - r.endedAt;
    if (age <= ms) continue;
    if (!r.exported && age <= 2 * ms) continue; // unexported footage gets twice as long
    if (!safeFile(r.file, settings.storageDir)) continue; // gone already, or outside the storage folder: not ours to delete
    out.push({ id: r.id, gameId: r.gameId, file: r.file, bytes: r.bytes, ageDays: Math.floor(age / DAY), why: r.exported ? "exported" : "older than twice the limit" });
  }
  return out;
}

export function runRetention(store: Store, settings: Parameters<typeof retentionPlan>[1], now: number): Candidate[] {
  const done: Candidate[] = [];
  for (const c of retentionPlan(store, settings, now)) {
    try { deleteRecording(store, c.id); done.push(c); } catch {}
  }
  return done;
}

/** Fires once when free space drops under the limit while live, and once when it recovers. */
export function createDiskWatch() {
  let low = false;
  return (freeBytes: number, limitGb: number, live: boolean): "low" | "recovered" | null => {
    if (!live || freeBytes <= 0) { return null; } // not broadcasting, or the engine does not know yet
    const isLow = freeBytes < limitGb * 1e9;
    if (isLow === low) return null;
    low = isLow;
    return isLow ? "low" : "recovered";
  };
}
