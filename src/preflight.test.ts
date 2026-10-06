import { expect, test } from "bun:test";
import { runChecks } from "./preflight";
import { defaultSettings } from "./data";
import type { DestinationDoc, EngineStatus, GameDoc } from "./types";

const eng = (o: Partial<EngineStatus> = {}): EngineStatus => ({
  engine: "fake", connected: true, program: "cam1", preview: null, replay: { active: false },
  sources: [{ id: "cam1", slot: 1, label: "Center court", kind: "test", detail: "1080p60", status: "ok", audio: 0.4 }],
  mixer: [{ id: "commentary", label: "Commentary", level: 0.4, gainDb: 0, muted: false }, { id: "program", label: "Program", level: 0.5, gainDb: 0, muted: false }],
  stream: { live: false, kbps: 0, droppedFrames: 0, reconnecting: false }, record: { active: false, bytes: 0 }, cpu: 10, diskFreeBytes: 200 * 1024 ** 3, ...o });
const team = (n: number, starters = 5) => ({ name: "T", abbr: "T", color: "#000000", roster: Array.from({ length: n }, (_, i) => ({ number: String(i), name: "p", position: "", starter: i < starters })) });
const game = (home = team(10), away = team(10)): GameDoc => ({ id: "g", title: "g", startsAt: 0, venueId: "", sport: "basketball", home, away, destinationIds: [], status: "scheduled" });
const rec: DestinationDoc = { id: "r", kind: "record", name: "Record only", enabled: true };
const run = (o: Parameters<typeof runChecks>[0]) => runChecks(o);
const get = (cs: Awaited<ReturnType<typeof runChecks>>, id: string) => cs.find((c) => c.id === id)!;
const settings = defaultSettings();

test("all good: everything ok except unmeasured upload", async () => {
  const cs = await run({ engine: eng(), game: game(), destinations: [rec], settings });
  expect(cs.filter((c) => c.status === "err")).toEqual([]);
  expect(cs.filter((c) => c.status === "warn").map((c) => c.id)).toEqual(["network.upload"]);
  expect(get(cs, "network.upload").result).toBe("Not measured until you are live");
  expect(new Set(cs.map((c) => c.group))).toEqual(new Set(["Video", "Audio", "Network", "Storage", "Destination", "Game"]));
  for (const c of cs) if (c.status !== "ok") expect(c.fix).toBeTruthy();
});

test("video, audio, storage", async () => {
  const src = (status: "missing" | "reconnecting") => [{ ...eng().sources[0], status }];
  expect(get(await run({ engine: eng({ sources: src("missing") }), destinations: [rec], settings }), "video.sources").status).toBe("err");
  expect(get(await run({ engine: eng({ sources: src("reconnecting") }), destinations: [rec], settings }), "video.sources").status).toBe("warn");
  const loud = eng({ mixer: [{ id: "program", label: "Program", level: 0.99, gainDb: 0, muted: false }] });
  expect(get(await run({ engine: loud, destinations: [rec], settings }), "audio.clipping").status).toBe("warn");
  const quiet = eng({ mixer: [{ id: "program", label: "Program", level: 0, gainDb: 0, muted: false }] });
  expect(get(await run({ engine: quiet, destinations: [rec], settings }), "audio.levels").status).toBe("warn");
  const gb = (n: number) => n * 1024 ** 3;
  expect(get(await run({ engine: eng({ diskFreeBytes: gb(30) }), destinations: [rec], settings }), "storage.space").status).toBe("warn");
  expect(get(await run({ engine: eng({ diskFreeBytes: gb(5) }), destinations: [rec], settings }), "storage.space").status).toBe("err");
});

test("network, destination, game", async () => {
  const bad: DestinationDoc = { id: "x", kind: "rtmp", name: "Nope", url: "rtmp://no-such-host.invalid/live", enabled: true };
  const cs = await run({ engine: eng({ stream: { live: true, kbps: 5000, droppedFrames: 0, reconnecting: false } }), destinations: [bad], settings });
  expect(get(cs, "network.dns.x").status).toBe("err");
  expect(get(cs, "network.upload").status).toBe("ok");
  expect(get(cs, "destination.x").status).toBe("err"); // no key
  expect((await run({ engine: eng(), destinations: [], settings })).find((c) => c.id === "destination.set")!.status).toBe("err");
  const g = await run({ engine: eng(), game: game(team(0), team(10, 2)), destinations: [rec], settings });
  expect(get(g, "game.roster.home").status).toBe("warn");
  expect(get(g, "game.starters.away").status).toBe("warn");
  expect(get(await run({ engine: eng(), destinations: [rec], settings }), "game.set").status).toBe("err");
});
