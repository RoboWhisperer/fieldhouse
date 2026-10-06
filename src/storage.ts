import { existsSync, readdirSync, rmSync, statfsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RecordingDoc } from "./types";
import type { Store } from "./store";
import { newId } from "./data";

const filesSize = (dir: string) => {
  try { return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).reduce((n, e) => n + statSync(join(dir, e.name)).size, 0); } catch { return 0; }
};

export function storageUsage(dir: string, _store?: Store) {
  let probe = dir; // the folder may not exist yet; the disk it will live on does
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
  const fs = statfsSync(probe);
  return { dir, freeBytes: fs.bavail * fs.bsize, totalBytes: fs.blocks * fs.bsize, recordingsBytes: filesSize(dir), highlightsBytes: filesSize(join(dir, "highlights")) };
}

export const listRecordings = (store: Store): RecordingDoc[] =>
  store.list<RecordingDoc>("recording").map((r) => { try { return { ...r, bytes: statSync(r.file).size }; } catch { return r; } });

export const saveRecording = (store: Store, r: Omit<RecordingDoc, "id"> & { id?: string }): RecordingDoc => store.put("recording", { ...r, id: r.id ?? newId("rec") });

export function deleteRecording(store: Store, id: string) {
  const r = store.get<RecordingDoc>("recording", id);
  if (r) rmSync(r.file, { force: true });
  store.del("recording", id);
}

export function markExported(store: Store, id: string): RecordingDoc {
  const r = store.get<RecordingDoc>("recording", id);
  if (!r) throw new Error("That recording no longer exists");
  return store.put("recording", { ...r, exported: true });
}
