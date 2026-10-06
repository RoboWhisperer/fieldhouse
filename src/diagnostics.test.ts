import { expect, test } from "bun:test";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { readFileSync, rmSync } from "node:fs";
import { buildBundle, log, previewBundle, recentLogs, redact } from "./diagnostics";
import { defaultSettings } from "./data";
import type { EngineStatus } from "./types";

test("ring buffer keeps 500 and filters", () => {
  for (let i = 0; i < 520; i++) log(i % 100 === 0 ? "ERROR" : "INFO", `m${i}`);
  expect(recentLogs(1000).length).toBe(500);
  expect(recentLogs(1)[0].msg).toBe("m519");
  expect(recentLogs(50, "ERROR").every((e) => e.level === "ERROR")).toBe(true);
});

test("redact strips secrets recursively", () => {
  expect(redact({ a: 1, key: "k", n: { Password: "p", token: "t", ok: [{ code: "WILD-1", v: 2 }] } })).toEqual({ a: 1, n: { ok: [{ v: 2 }] } });
});

test("bundle has no keys, codes, rosters or key-bearing urls", () => {
  const settings = defaultSettings();
  const engine = { engine: "fake", connected: true, stream: { live: false } } as unknown as EngineStatus;
  const destinations = [{ id: "d", kind: "youtube" as const, name: "YT", url: "rtmp://a.rtmp.youtube.com/live2/SECRETKEY", key: "SECRETKEY", enabled: true }];
  const ctx = { settings, engine, destinations, gameId: "g1" };
  const text = JSON.stringify(previewBundle(ctx));
  expect(text).not.toContain("SECRETKEY");
  expect(text).not.toContain(settings.remote.code);
  expect(text).toContain("a.rtmp.youtube.com");
  expect(text).toContain("bun");
  const dir = __join(__tmpdir(), "fieldhouse-tests", "diag-test");
  const b = buildBundle(ctx, dir);
  expect(b.path).toMatch(/diagnostics-\d+\.json$/);
  expect(readFileSync(b.path, "utf8")).not.toContain("SECRETKEY");
  expect(b.bytes).toBeGreaterThan(100);
  expect(b.excludes).toContain("stream keys");
  rmSync(dir, { recursive: true, force: true });
});
