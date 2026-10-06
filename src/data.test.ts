import { expect, test } from "bun:test";
import { openStore } from "./store";
import { defaultSettings, destinationView, getDestinationWithKey, getSettings, listDestinations, listGames, parseRosterCsv, saveDestination, saveGame, saveSettings, seedDemo } from "./data";

test("settings: defaults persist, code stable, patches validated", () => {
  const s = openStore(":memory:");
  const a = getSettings(s), b = getSettings(s);
  expect(a.remote.code).toMatch(/^[A-Z]+-\d{4}$/);
  expect(b.remote.code).toBe(a.remote.code);
  expect(a.shortcuts.cut).toBe("Enter");
  const n = saveSettings(s, { theme: "midnight", profile: { periodMin: 10 } });
  expect(n.profile).toEqual({ ...defaultSettings().profile, periodMin: 10 });
  expect(getSettings(s).theme).toBe("midnight");
  expect(() => saveSettings(s, { theme: "neon" })).toThrow("theme");
  expect(() => saveSettings(s, { profile: { periods: 99 } })).toThrow("periods");
  expect(() => saveSettings(s, { lowSpaceGb: "lots" })).toThrow("GB");
  expect(() => saveSettings(s, { bogus: 1 })).toThrow("Unknown");
});

test("destinations never expose the key and keep it on edit", () => {
  const s = openStore(":memory:");
  const v = saveDestination(s, { kind: "youtube", name: "YT", key: "secret-1" });
  expect(JSON.stringify(listDestinations(s))).not.toContain("secret-1");
  expect(v.keySet).toBe(true);
  saveDestination(s, { id: v.id, kind: "youtube", name: "YT renamed" });
  expect(getDestinationWithKey(s, v.id)!.key).toBe("secret-1");
  expect(getDestinationWithKey(s, v.id)!.name).toBe("YT renamed");
  expect(() => saveDestination(s, { kind: "rtmp", name: "x", url: "http://nope" })).toThrow("rtmp://");
  expect("key" in destinationView(getDestinationWithKey(s, v.id)!)).toBe(false);
});

test("roster csv: headers, quotes, CRLF, BOM, semicolons", () => {
  const r = parseRosterCsv('﻿jersey_no;last_name;first_name;pos\r\n12;"Reyes, Jr.";Jordan;PG\r\n00;Chen;Mia;C\r\n');
  expect(r.mapping.number).toBe("jersey_no");
  expect(r.players).toEqual([{ number: "12", name: "Jordan Reyes, Jr.", position: "PG", starter: false }, { number: "00", name: "Mia Chen", position: "C", starter: false }]);
  expect(r.warnings).toEqual([]);
});

test("roster csv: tabs, warnings, mapping override, headerless, cap", () => {
  const r = parseRosterCsv("#\tName\tPosition\n5\tAnn\tPG\n5\tBob\tSG\n7\t\tC\nx9\tCy\tC");
  expect(r.players.length).toBe(4);
  const msgs = r.warnings.map((w) => `${w.row}:${w.message}`);
  expect(msgs).toContain("2:Jersey number 5 is used more than once");
  expect(msgs).toContain("3:Jersey number 5 is used more than once");
  expect(msgs).toContain("4:This row has no player name");
  expect(msgs.some((m) => m.startsWith("5:") && m.includes("not a jersey number"))).toBe(true);

  const o = parseRosterCsv("n,who\n1,A", { number: "n", name: "who" });
  expect(o.players[0]).toMatchObject({ number: "1", name: "A" });

  const h = parseRosterCsv("4,Dee,PG\n9,Eve,C");
  expect(h.players.map((p) => p.name)).toEqual(["Dee", "Eve"]);

  const big = parseRosterCsv("number,name\n" + Array.from({ length: 50 }, (_, i) => `${i},P${i}`).join("\n"));
  expect(big.players.length).toBe(40);
  expect(big.warnings.some((w) => w.message.includes("first 40"))).toBe(true);
  expect(parseRosterCsv("").warnings.length).toBe(1);
});

test("saveGame validates", () => {
  const s = openStore(":memory:");
  const t = { name: "A", abbr: "a", roster: [] };
  const g = saveGame(s, { startsAt: Date.now(), home: t, away: { ...t, name: "B", abbr: "b" } });
  expect(g.id).toBeTruthy();
  expect(g.title).toBe("A vs B");
  expect(() => saveGame(s, { startsAt: 1, home: { name: "", abbr: "x" }, away: t })).toThrow("name");
  expect(() => saveGame(s, { home: t, away: t })).toThrow("date");
});

test("seedDemo: explicit, idempotent, dated from now", () => {
  const s = openStore(":memory:");
  expect(listGames(s).length).toBe(0);
  seedDemo(s);
  seedDemo(s);
  const games = listGames(s);
  expect(games.length).toBe(5);
  expect(games.filter((g) => g.status === "final").every((g) => g.finalScore && g.startsAt < Date.now())).toBe(true);
  const tonight = games.find((g) => g.status === "scheduled")!;
  expect(tonight.home.roster.length).toBe(12);
  expect(tonight.away.roster.length).toBe(11);
  expect(tonight.startsAt).toBeGreaterThan(Date.now());
  expect(s.list<{ name: string }>("sponsor").map((x) => x.name)).toEqual(["Smith Dental", "Harbor Pizza", "Eastside Credit Union"]);
  expect(s.list("airing").length).toBeGreaterThan(5);
  expect(getDestinationWithKey(s, "dest_demo_yt")!.key).toBe("demo-key");
});
