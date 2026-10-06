import { expect, test } from "bun:test";
import { openStore } from "./store";
import { airingRows, summary, toCsv } from "./reports";

test("rows join, filter, sort; summary; csv quoting", () => {
  const s = openStore(":memory:");
  s.put("game", { id: "g1", title: 'Cats, "the" Lions' });
  s.put("sponsor", { id: "s1", name: "Smith Dental" });
  const a = (id: string, at: number, outcome: string, sponsorId = "s1", gameId = "g1") =>
    s.put("airing", { id, gameId, sponsorId, at, period: 2, gameClockMs: 125_000, trigger: "timeout", outcome, seconds: 15 });
  a("a1", 100, "aired"); a("a2", 300, "skipped"); a("a3", 200, "delayed"); a("a4", 400, "aired", "gone", "g2");
  const rows = airingRows(s, {});
  expect(rows.map((r) => r.id)).toEqual(["a4", "a2", "a3", "a1"]);
  expect(rows[0]).toMatchObject({ gameTitle: "(deleted game)", sponsorName: "(deleted sponsor)" });
  expect(airingRows(s, { sponsorId: "s1", from: 150, to: 350 }).map((r) => r.id)).toEqual(["a2", "a3"]);
  expect(summary(rows)).toEqual({ airings: 4, seconds: 30, games: 2, aired: 2, skipped: 1, delayed: 1 });
  const csv = toCsv(airingRows(s, { gameId: "g1" }));
  expect(csv.split("\r\n")[0]).toBe("Game,Time,Sponsor,Trigger,Period,Game clock,Seconds,Outcome");
  expect(csv).toContain('"Cats, ""the"" Lions"');
  expect(csv).toContain(",2:05,");
});
