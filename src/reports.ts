// Proof-of-play. Only what happened on air; no audience numbers are ever invented.
import type { AiringDoc, GameDoc, SponsorDoc } from "./types";
import type { Store } from "./store";

export type AiringRow = AiringDoc & { gameTitle: string; sponsorName: string };

export function airingRows(store: Store, f: { sponsorId?: string; gameId?: string; from?: number; to?: number } = {}): AiringRow[] {
  const games = new Map(store.list<GameDoc>("game").map((g) => [g.id, g.title]));
  const sponsors = new Map(store.list<SponsorDoc>("sponsor").map((s) => [s.id, s.name]));
  return store.list<AiringDoc>("airing")
    .filter((a) => (!f.sponsorId || a.sponsorId === f.sponsorId) && (!f.gameId || a.gameId === f.gameId) && (f.from === undefined || a.at >= f.from) && (f.to === undefined || a.at <= f.to))
    .map((a) => ({ ...a, gameTitle: games.get(a.gameId) ?? "(deleted game)", sponsorName: sponsors.get(a.sponsorId) ?? "(deleted sponsor)" }))
    .sort((a, b) => b.at - a.at);
}

export function summary(rows: AiringRow[]) {
  const n = (o: AiringDoc["outcome"]) => rows.filter((r) => r.outcome === o).length;
  return {
    airings: rows.length,
    seconds: rows.filter((r) => r.outcome === "aired").reduce((t, r) => t + r.seconds, 0), // only time actually on air
    games: new Set(rows.map((r) => r.gameId)).size,
    aired: n("aired"), skipped: n("skipped"), delayed: n("delayed"),
  };
}

const q = (v: unknown) => (/[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

export function toCsv(rows: AiringRow[]): string {
  const head = ["Game", "Time", "Sponsor", "Trigger", "Period", "Game clock", "Seconds", "Outcome"];
  const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
  const lines = rows.map((r) => [r.gameTitle, new Date(r.at).toISOString(), r.sponsorName, r.trigger, r.period, clock(r.gameClockMs), r.seconds, r.outcome].map(q).join(","));
  return [head.join(","), ...lines].join("\r\n") + "\r\n";
}
