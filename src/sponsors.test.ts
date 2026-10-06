import { expect, test } from "bun:test";
import { openStore } from "./store";
import { conflicts, deleteSponsor, listSponsors, nextBreak, planGame, recordAiring, saveSponsor, seasonUsage } from "./sponsors";
import type { SponsorDoc, Trigger } from "./types";

const sp = (id: string, triggers: Trigger[], priority: number, minGapMinutes = 8, maxPerSeason = 10): SponsorDoc => ({
  id, name: id, abbr: id, color: "#000000", assets: [], displaySeconds: 15, rules: { triggers, minGapMinutes, maxPerSeason, priority } });
const air = (sponsorId: string, at: number, gameId = "g1", outcome: "aired" | "skipped" = "aired") =>
  ({ id: sponsorId + at, gameId, sponsorId, at, period: 1, gameClockMs: 0, trigger: "timeout" as Trigger, outcome, seconds: 15 });

test("nextBreak: trigger, gap, season cap, priority", () => {
  const a = sp("a", ["timeout"], 1), b = sp("b", ["timeout", "halftime"], 2), c = sp("c", ["halftime"], 1, 8, 1);
  const now = 10 * 60_000;
  const ctx = { gameId: "g1", now, trigger: "timeout" as Trigger };
  expect(nextBreak([b, a], [], ctx)?.id).toBe("a");
  expect(nextBreak([a, b], [air("a", now - 60_000)], ctx)?.id).toBe("b"); // a is inside its gap
  expect(nextBreak([a, b], [air("a", now - 60_000, "g0")], ctx)?.id).toBe("a"); // other game's airing doesn't count for gap
  expect(nextBreak([a, b], [air("a", 0, "g1", "skipped")], ctx)?.id).toBe("a"); // skipped doesn't count
  expect(nextBreak([c], [air("c", 0, "g0")], { ...ctx, trigger: "halftime" })).toBeNull(); // season cap of 1 reached
  expect(nextBreak([c], [], ctx)).toBeNull();
});

test("seasonUsage", () => {
  const a = sp("a", ["timeout"], 1, 8, 3);
  expect(seasonUsage(a, [air("a", 1), air("a", 2), air("a", 3, "g2", "skipped")])).toEqual({ aired: 2, left: 1, seconds: 30 });
});

test("conflicts and plan", () => {
  const a = sp("a", ["timeout", "pregame"], 1), b = sp("b", ["timeout"], 1), c = sp("c", ["halftime"], 2);
  expect(conflicts([a, b, c])).toEqual([{ trigger: "timeout", sponsorIds: ["a", "b"] }]);
  const plan = planGame([a, b, c]);
  expect(plan.map((p) => p.slot)).toEqual(["Pregame", "Q1 timeout", "Q2 timeout", "Halftime", "Q3 timeout", "Q4 timeout", "Postgame"]);
  expect(plan.map((p) => p.sponsorId)).toEqual(["a", "a", "b", "c", "a", "b", null]);
  expect(plan[1].conflict).toBe(true);
  expect(plan[3].conflict).toBe(false);
});

test("save/list/delete and recordAiring", () => {
  const s = openStore(":memory:");
  const saved = saveSponsor(s, { name: "Smith Dental", displaySeconds: 15, rules: { triggers: ["timeout"], minGapMinutes: 8, maxPerSeason: 12, priority: 1 } });
  expect(saved.abbr).toBe("SMITH DE");
  expect(() => saveSponsor(s, { name: "", displaySeconds: 15, rules: saved.rules })).toThrow("name");
  expect(() => saveSponsor(s, { name: "x", displaySeconds: 15, rules: { ...saved.rules, triggers: [] } })).toThrow("air");
  expect(() => saveSponsor(s, { name: "x", displaySeconds: 15, rules: { ...saved.rules, priority: 0 } })).toThrow("Priority");
  const a = recordAiring(s, { gameId: "g", sponsorId: saved.id, at: 1, period: 1, gameClockMs: 0, trigger: "timeout", outcome: "aired", seconds: 15 });
  expect(s.get("airing", a.id)).toBeTruthy();
  deleteSponsor(s, saved.id);
  expect(listSponsors(s)).toEqual([]);
});
