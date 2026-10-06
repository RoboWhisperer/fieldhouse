import { expect, test } from "bun:test";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { clipsFromLog, exportHighlights } from "./highlights";
import type { Logged } from "./game";

const T0 = 1_000_000;
let seq = 0;
const ev = (e: any, secs: number): Logged => ({ ...e, seq: ++seq, t: T0 + secs * 1000 });
const log: Logged[] = [
  ev({ type: "game.start", home: "WILD", away: "LIONS", homeName: "Wildcats", awayName: "Lions" }, 0),
  ev({ type: "score", team: "home", points: 3, player: 12 }, 10),
  ev({ type: "score", team: "away", points: 2 }, 14), // overlaps the previous clip
  ev({ type: "score", team: "home", points: 1 }, 60),
  ev({ type: "undo", target: 4 }, 61), // undoes the free throw
  ev({ type: "mark", note: "Big block" }, 100),
];

test("clips: undo respected, merged, labelled, clamped", () => {
  const c = clipsFromLog(log, { startedAt: T0 });
  expect(c.length).toBe(1);
  expect(c[0]).toMatchObject({ startMs: 5000, endMs: 17000, label: "Wildcats 3-pointer #12 (+1)", eventSeq: [2, 3] });
  const m = clipsFromLog(log, { startedAt: T0 }, { includeMarks: true });
  expect(m.map((x) => x.label)).toEqual(["Wildcats 3-pointer #12 (+1)", "Big block"]);
  const early = clipsFromLog([ev({ type: "score", team: "home", points: 2 }, -5)], { startedAt: T0 });
  expect(early[0]).toMatchObject({ startMs: 0, endMs: 3000, label: "Score" });
});

const dir = __join(__tmpdir(), "fieldhouse-tests", "hl-test");
test.skipIf(!Bun.which("ffmpeg") || !Bun.which("ffprobe"))("export joins clips into one file of the right length", async () => {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const src = `${dir}/game.mp4`;
  const mk = Bun.spawnSync(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=20", "-f", "lavfi", "-i", "sine=duration=20", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", src]);
  expect(mk.exitCode).toBe(0);
  const clips = [{ startMs: 2000, endMs: 6000, label: "a", eventSeq: [1] }, { startMs: 10000, endMs: 13000, label: "b", eventSeq: [2] }];
  const out = `${dir}/highlights.mp4`;
  const r = await exportHighlights(src, clips, out);
  expect(r.seconds).toBe(7);
  const dur = parseFloat(Bun.spawnSync(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).stdout.toString());
  expect(Math.abs(dur - 7)).toBeLessThan(0.6);
  await expect(exportHighlights(`${dir}/nope.mp4`, clips, out)).rejects.toThrow("can't be read");
  await expect(exportHighlights(src, [], out)).rejects.toThrow("no clips");
  expect(existsSync(out)).toBe(true);
  rmSync(dir, { recursive: true, force: true });
});
