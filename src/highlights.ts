import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Logged } from "./game";
import { BASKETBALL } from "./profiles/builtins";
import type { ProfileDoc } from "./profiles/types";
import type { Clip } from "./types";

export function clipsFromLog(log: Logged[], rec: { startedAt: number }, opts: { preMs?: number; postMs?: number; includeMarks?: boolean; profile?: ProfileDoc } = {}): Clip[] {
  const { preMs = 5000, postMs = 3000, includeMarks = false, profile = BASKETBALL } = opts;
  const undone = new Set(log.filter((e) => e.type === "undo").map((e) => (e as { target: number }).target));
  const start = [...log].reverse().find((e) => e.type === "game.start");
  const names = start?.type === "game.start" ? { home: start.homeName ?? start.home, away: start.awayName ?? start.away } : undefined;

  const raw: Clip[] = [];
  for (const e of log) {
    if (undone.has(e.seq) || !(e.type === "score" || (includeMarks && e.type === "mark"))) continue;
    const at = Math.max(0, e.t - rec.startedAt);
    let label = "Score";
    if (e.type === "score") {
      // "Wildcats touchdown #12": the profile's own word for this score (lower-case so basketball keeps "3-pointer", "basket", "free throw")
      const opt = profile.scoring.find((o) => o.id === e.kind && o.points === e.points) ?? profile.scoring.find((o) => o.points === e.points);
      const shot = opt ? opt.label.toLowerCase() : `${e.points}-point score`;
      label = names ? `${names[e.team]} ${shot}${e.player !== undefined ? ` #${e.player}` : ""}` : "Score";
    } else label = e.note || "Marked moment";
    raw.push({ startMs: Math.max(0, at - preMs), endMs: at + postMs, label, eventSeq: [e.seq] });
  }
  raw.sort((a, b) => a.startMs - b.startMs);
  const out: Clip[] = [];
  for (const c of raw) {
    const last = out[out.length - 1];
    if (last && c.startMs <= last.endMs) { // overlapping or adjacent: one continuous clip
      last.endMs = Math.max(last.endMs, c.endMs);
      last.eventSeq.push(...c.eventSeq);
      if (!/ \(\+\d+\)$/.test(last.label)) last.label += " (+1)";
      else last.label = last.label.replace(/\(\+(\d+)\)$/, (_, n) => `(+${+n + 1})`);
    } else out.push({ ...c });
  }
  return out;
}

async function ffmpeg(args: string[]) {
  const p = Bun.spawn(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", ...args], { stdout: "ignore", stderr: "pipe" });
  const [err, code] = await Promise.all([new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`ffmpeg failed: ${err.trim().split("\n").pop() || "unknown error"}`);
}

export async function exportHighlights(file: string, clips: Clip[], out: string): Promise<{ out: string; seconds: number; bytes: number }> {
  if (!Bun.which("ffmpeg")) throw new Error("ffmpeg is not installed, so highlights can't be exported. Install ffmpeg and try again.");
  if (!existsSync(file)) throw new Error("The recording can't be read. Check that the file still exists.");
  if (!clips.length) throw new Error("There are no clips to export.");
  mkdirSync(dirname(out), { recursive: true }); // <storageDir>/highlights/ does not exist until the first export
  const tmp = mkdtempSync(join(tmpdir(), "fieldhouse-hl-"));
  try {
    const parts: string[] = [];
    for (const [i, c] of clips.entries()) {
      const part = join(tmp, `part${i}.mp4`);
      await ffmpeg(["-ss", String(c.startMs / 1000), "-t", String((c.endMs - c.startMs) / 1000), "-i", file, "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", part]);
      parts.push(part);
    }
    const list = join(tmp, "list.txt");
    writeFileSync(list, parts.map((p) => `file '${p}'`).join("\n"));
    await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", resolve(out)]);
    return { out, seconds: clips.reduce((n, c) => n + (c.endMs - c.startMs) / 1000, 0), bytes: statSync(resolve(out)).size };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
