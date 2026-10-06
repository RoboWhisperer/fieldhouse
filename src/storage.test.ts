import { expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { openStore } from "./store";
import { deleteRecording, listRecordings, markExported, saveRecording, storageUsage } from "./storage";

const dir = "/tmp/claude-1000/-home-noah-Projects-Fieldhouse/storage-test";

test("usage, list, export, delete", () => {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(`${dir}/highlights`, { recursive: true });
  writeFileSync(`${dir}/a.mp4`, "x".repeat(1000));
  writeFileSync(`${dir}/highlights/h.mp4`, "y".repeat(300));
  const u = storageUsage(dir, openStore(":memory:"));
  expect(u).toMatchObject({ dir, recordingsBytes: 1000, highlightsBytes: 300 });
  expect(u.freeBytes).toBeGreaterThan(0);
  expect(u.totalBytes).toBeGreaterThanOrEqual(u.freeBytes);
  expect(storageUsage(`${dir}/not/yet`).freeBytes).toBeGreaterThan(0);

  const s = openStore(":memory:");
  const r = saveRecording(s, { gameId: "g", file: `${dir}/a.mp4`, startedAt: 1, bytes: 0, exported: false });
  expect(listRecordings(s)[0].bytes).toBe(1000);
  expect(markExported(s, r.id).exported).toBe(true);
  deleteRecording(s, r.id);
  expect(existsSync(`${dir}/a.mp4`)).toBe(false);
  expect(listRecordings(s)).toEqual([]);
  deleteRecording(s, r.id); // already gone: no throw
  expect(() => markExported(s, r.id)).toThrow("no longer exists");
});
