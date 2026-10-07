import { createHmac } from "node:crypto";
import { expect, test } from "bun:test";
import { createBus } from "./bus";
import { openStore } from "../store";
import { createWebhooks, parseWebhook, sign, BACKOFF_MS } from "./webhooks";

function setup(replies: (number | Error)[]) {
  const store = openStore(":memory:"), bus = createBus(() => 5_000_000), t = { now: 5_000_000 };
  const sent: { url: string; init: any }[] = [], waits: number[] = [], logs: string[] = [];
  const fetchMock = (async (url: any, init: any) => { sent.push({ url: String(url), init }); const r = replies.shift() ?? 200; if (r instanceof Error) throw r; return new Response("x", { status: r }); }) as any;
  const w = createWebhooks({ store, bus, now: () => t.now, fetch: () => fetchMock, sleep: async (ms) => { waits.push(ms); }, log: (_l, m) => logs.push(m) });
  return { store, bus, w, sent, waits, logs, t };
}

test("signature: HMAC-SHA256 over '<timestamp>.<body>' with the secret, in X-Fieldhouse-Signature", async () => {
  const s = setup([200]);
  const hook = s.w.save({ name: "Companion", url: "https://c.example/hook", events: ["game.*"], secret: "supersecret1" });
  expect(hook).not.toHaveProperty("secret");
  expect(hook.secretSet).toBe(true);
  s.bus.emit("game.score", { points: 3 }); await s.w.idle();
  expect(s.sent).toHaveLength(1);
  const { init } = s.sent[0];
  const ts = init.headers["x-fieldhouse-timestamp"];
  expect(ts).toBe("5000");
  expect(init.headers["x-fieldhouse-signature"]).toBe("sha256=" + createHmac("sha256", "supersecret1").update(`${ts}.${init.body}`).digest("hex"));
  expect(init.headers["x-fieldhouse-signature"]).toBe(sign("supersecret1", 5000, init.body));
  expect(init.headers["x-fieldhouse-event"]).toBe("game.score");
  expect(init.redirect).toBe("manual");
  expect(JSON.parse(init.body)).toMatchObject({ version: 1, event: "game.score", data: { points: 3 } });
  expect(s.w.deliveries()[0]).toMatchObject({ status: "ok", attempts: 1, code: 200, name: "Companion" });
  // tampering with the body breaks the signature
  expect(sign("supersecret1", 5000, init.body + " ")).not.toBe(init.headers["x-fieldhouse-signature"]);
});

test("no secret: no signature headers. Event filter: only matching events are sent", async () => {
  const s = setup([]);
  s.w.save({ name: "a", url: "http://10.0.0.2/x", events: ["engine.*", "sponsor.fired"] });
  s.bus.emit("game.score", {}); s.bus.emit("engine.stream.live", {}); s.bus.emit("sponsor.fired", {}); s.bus.emit("custom.changed", {});
  await s.w.idle();
  expect(s.sent.map((x) => x.init.headers["x-fieldhouse-event"])).toEqual(["engine.stream.live", "sponsor.fired"]);
  expect(s.sent[0].init.headers["x-fieldhouse-signature"]).toBeUndefined();
});

test("retries with backoff on network errors and 5xx, then succeeds; gives up after the last retry", async () => {
  const s = setup([new Error("down"), 503, 200]);
  s.w.save({ name: "r", url: "https://x.example/h" });
  s.bus.emit("game.mark", {}); await s.w.idle();
  expect(s.sent).toHaveLength(3);
  expect(s.waits).toEqual(BACKOFF_MS.slice(0, 2));
  expect(s.w.deliveries()[0]).toMatchObject({ status: "ok", attempts: 3 });

  const f = setup([500, 500, 500, 500, 500]);
  f.w.save({ name: "f", url: "https://x.example/h" });
  f.bus.emit("game.mark", {}); await f.w.idle();
  expect(f.sent).toHaveLength(1 + BACKOFF_MS.length);
  expect(f.waits).toEqual(BACKOFF_MS);
  expect(f.w.deliveries()[0]).toMatchObject({ status: "failed", attempts: 4, code: 500 });
  expect(f.logs.at(-1)).toContain("gave up after 4 tries");
});

test("a 4xx answer is not retried; a disabled webhook sends nothing; deliveries keep order", async () => {
  const s = setup([404]);
  const h = s.w.save({ name: "x", url: "https://x.example/h" });
  s.bus.emit("game.mark", {}); await s.w.idle();
  expect(s.sent).toHaveLength(1);
  expect(s.w.deliveries()[0]).toMatchObject({ status: "failed", attempts: 1, code: 404 });
  s.w.save({ enabled: false }, h.id);
  s.bus.emit("game.mark", {}); await s.w.idle();
  expect(s.sent).toHaveLength(1);
  s.w.save({ enabled: true }, h.id);
  for (let i = 0; i < 3; i++) s.bus.emit("game.mark", { i });
  await s.w.idle();
  expect(s.sent.slice(1).map((x) => JSON.parse(x.init.body).data.i)).toEqual([0, 1, 2]);
});

test("the test button sends one test.ping with a single try and reports the outcome", async () => {
  const s = setup([500]);
  const h = s.w.save({ name: "t", url: "https://x.example/h" });
  expect(await s.w.test(h.id)).toEqual({ ok: false, code: 500, message: "POST x.example/h answered 500" });
  expect(s.sent).toHaveLength(1);
  expect(JSON.parse(s.sent[0].init.body).event).toBe("test.ping");
});

test("validation and secrecy: bad addresses and events are refused, the secret is write-only and removable", () => {
  const s = setup([]);
  const bad = (b: any, m: string) => expect(() => s.w.save({ name: "n", url: "https://x.example/", ...b })).toThrow(m);
  bad({ url: "ftp://x" }, "http:// or https://");
  bad({ url: "https://u:p@x.example/" }, "user name or password");
  bad({ events: [] }, "Events must be a list");
  bad({ events: ["Bad Name!"] }, "Events must be a list");
  bad({ secret: "short" }, "8 to 200");
  bad({ name: "" }, "name is required");
  const h = s.w.save({ name: "n", url: "https://x.example/", secret: "longenough1" });
  expect(JSON.stringify(s.w.list())).not.toContain("longenough1");
  expect(s.store.list<any>("webhook")[0].secret).toBe("longenough1"); // kept so it can sign
  expect(s.w.save({ name: "renamed" }, h.id).secretSet).toBe(true); // an update without a secret keeps it
  expect(s.w.save({ secret: "" }, h.id).secretSet).toBe(false); // empty removes it
  expect(parseWebhook({ name: "n", url: "https://x.example/" }).events).toEqual(["*"]);
  const exp = JSON.stringify(s.w.exportable());
  expect(exp).not.toContain("secret");
});
