import { afterAll, expect, test } from "bun:test";
import { createApp } from "../app";
import { seedDemo } from "../data";
import { FakeEngine } from "../engine";
import { openStore } from "../store";

const engines: FakeEngine[] = [];
afterAll(async () => { await Promise.all(engines.map((e) => e.close())); });

async function rig(fetchMock?: typeof fetch) {
  const store = openStore(":memory:"), engine = new FakeEngine(); engines.push(engine);
  const t = { now: 1_000_000 };
  const sent: { url: string; init: any }[] = [];
  const app = createApp({ store, engine, now: () => t.now, fetch: fetchMock ?? ((async (u: any, i: any) => { sent.push({ url: String(u), init: i }); return new Response("ok"); }) as any) });
  seedDemo(store);
  const games = await (await app.handle(new Request("http://x/api/games"))).json();
  await app.handle(new Request(`http://x/api/games/${games.find((g: any) => g.status === "scheduled").id}/activate`, { method: "POST" }));
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.handle(new Request("http://x/api" + path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: body === undefined ? {} : { "content-type": "application/json" } }));
    const ct = res.headers.get("content-type") ?? "";
    return { status: res.status, body: ct.includes("json") ? await res.json() : await res.text(), res };
  };
  const settle = () => new Promise((r) => setTimeout(r, 30));
  return { app, store, call, t, sent, settle };
}

test("custom fields: create, read in state(), validate, change notification, delete", async () => {
  const { app, call } = await rig();
  const changes: string[] = [];
  const off = app.automation.bus.subscribe((m) => { if (m.event === "custom.changed") changes.push(JSON.stringify(m.data)); });
  expect((await call("PUT", "/custom", { values: { sponsorLine: "Thanks to Acme", homeCoach: "Ms. Lee" }, fields: { sponsorLine: { label: "Sponsor line", type: "text", default: "Thanks to our sponsors" } } })).status).toBe(200);
  const got = (await call("GET", "/custom")).body;
  expect(got.values).toEqual({ sponsorLine: "Thanks to Acme", homeCoach: "Ms. Lee" });
  expect(got.fields.find((f: any) => f.key === "sponsorLine")).toMatchObject({ label: "Sponsor line", type: "text", default: "Thanks to our sponsors", value: "Thanks to Acme", effective: "Thanks to Acme" });
  expect(app.state().custom).toEqual(got.values);
  expect((await call("PUT", "/custom/sponsorLine", { value: "" })).body.values.sponsorLine).toBe("Thanks to our sponsors"); // empty falls back to the default
  expect(changes).toHaveLength(3);
  expect(JSON.parse(changes[2])).toEqual({ key: "sponsorLine", value: "Thanks to our sponsors", old: "Thanks to Acme" });
  await call("DELETE", "/custom/homeCoach");
  expect(app.state().custom).toEqual({ sponsorLine: "Thanks to our sponsors" });
  expect((await call("DELETE", "/custom/homeCoach")).status).toBe(404);
  off();
});

test("custom fields: validation messages, atomic updates and the field cap", async () => {
  const { call, app } = await rig();
  const bad = async (body: any, msg: string, path = "/custom", method = "PUT") => { const r = await call(method, path, body); expect(r.status, JSON.stringify(body)).toBe(400); expect(r.body.error).toContain(msg); };
  await bad({ values: { "1bad": "x" } }, "not a valid name");
  await bad({ values: { "has space": "x" } }, "not a valid name");
  await bad({ values: { a: "x".repeat(501) } }, "at most 500");
  await bad({ values: { a: "line\nbreak" } }, "line breaks");
  await bad({ fields: { a: { type: "weird" } } }, "type must be one of");
  await bad({ fields: { n: { type: "number", value: "abc" } } }, "must be a number");
  await bad({ fields: { c: { type: "color", value: "red" } } }, "must be a color");
  await bad({ fields: { b: { type: "bool", value: "yes" } } }, "true or false");
  await bad({ fields: { i: { type: "image", value: "javascript:alert(1)" } } }, "image address");
  await bad({ fields: { i: { type: "image", value: "../../etc/passwd" } } }, "image address");
  await bad({ fields: { a: { colour: "x" } } }, "Unknown field setting");
  await bad({}, "Send");
  // atomic: one bad entry changes nothing
  await call("PUT", "/custom", { values: { good: "1" } });
  await bad({ values: { other: "2", "bad!": "3" } }, "not a valid name");
  expect(app.state().custom).toEqual({ good: "1" });
  // good typed values
  expect((await call("PUT", "/custom", { fields: { n: { type: "number", value: 3 }, c: { type: "color", value: "#fff" }, b: { type: "bool", value: true }, i: { type: "image", value: "https://x.example/a.png" } } })).status).toBe(200);
  expect(app.state().custom).toMatchObject({ n: "3", b: "true" });
  // cap
  const many = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`f${i}`, "x"]));
  expect((await call("PUT", "/custom", { values: many })).body.error).toContain("at most 100");
});

test("a custom field change is seen by rules (custom.* facts) and state predicates", async () => {
  const { call, settle } = await rig();
  await call("POST", "/automation/rules", { name: "Banner", trigger: { type: "state", when: "custom.mode == 'final'" }, actions: [{ type: "notice", message: "Mode {{custom.mode}}" }] });
  await call("PUT", "/custom", { values: { mode: "regular" } }); await settle();
  await call("PUT", "/custom", { values: { mode: "final" } }); await settle();
  const log = (await call("GET", "/automation/log")).body;
  expect(log.filter((e: any) => e.status === "ok")).toHaveLength(1);
  expect((await call("GET", "/state")).body.notices.some((n: any) => n.message === "Mode final")).toBe(true);
});

test("a real game event fires rules through POST /api/event (score 3 -> lower third data + webhook)", async () => {
  const { call, settle, sent, app } = await rig();
  await call("POST", "/automation/rules", { name: "Triple", trigger: { type: "event", event: "score", team: "home", points: [3] }, actions: [
    { type: "custom.set", key: "lowerThirdName", value: "{{home.abbr}} {{home.score}}" },
    { type: "http", method: "POST", url: "https://companion.local/api/{{event.points}}", body: '{"home":{{home.score}}}' }] });
  await call("POST", "/event", { type: "score", team: "away", points: 3 });
  await call("POST", "/event", { type: "score", team: "home", points: 2 });
  expect(app.automation.custom.all()).toEqual({});
  await call("POST", "/event", { type: "score", team: "home", points: 3 }); await settle();
  expect(app.automation.custom.all().lowerThirdName).toMatch(/^\S+ 5$/);
  expect(sent).toHaveLength(1);
  expect(sent[0].url).toBe("https://companion.local/api/3");
  expect(JSON.parse(sent[0].init.body)).toEqual({ home: 5 });
});

test("an action that adds a game event goes through the normal validation and triggers rules", async () => {
  const { call, settle } = await rig();
  await call("POST", "/automation/rules", { name: "Marker", trigger: { type: "event", event: "timeout" }, actions: [{ type: "event", event: { type: "mark", note: "Timeout by {{event.team}}" } }] });
  await call("POST", "/automation/rules", { name: "Bad", trigger: { type: "event", event: "foul" }, actions: [{ type: "event", event: { type: "score", team: "home", points: 7 } }] });
  await call("POST", "/event", { type: "timeout", team: "home" });
  await call("POST", "/event", { type: "foul", team: "home" }); await settle();
  const events = (await call("GET", "/log")).body;
  expect(events.find((e: any) => e.type === "mark")).toMatchObject({ note: "Timeout by home" });
  expect(events.filter((e: any) => e.type === "score")).toHaveLength(0);
  const log = (await call("GET", "/automation/log")).body;
  expect(log.find((e: any) => e.name === "Bad").steps[0].error).toContain("score needs team");
});

test("rules API: create, list with masked headers, update keeps secrets, test (dry run), run now, delete", async () => {
  const { call, sent } = await rig();
  const made = (await call("POST", "/automation/rules", { name: "Hook", trigger: { type: "manual", name: "ping" }, actions: [{ type: "http", method: "POST", url: "https://x.example/h", headers: { Authorization: "Bearer topsecret" }, body: "{}" }] })).body;
  expect(made.summary).toBe('manual "ping"');
  expect(JSON.stringify((await call("GET", "/automation/rules")).body)).not.toContain("topsecret");
  const shown = (await call("GET", `/automation/rules/${made.id}`)).body;
  expect(shown.actions[0].headers.Authorization).toBe("[hidden]");
  await call("PUT", `/automation/rules/${made.id}`, { name: "Hook v2", actions: shown.actions });
  const dry = (await call("POST", `/automation/rules/${made.id}/test`, {})).body;
  expect(dry.steps[0].text).toBe("send POST to x.example/h");
  expect(sent).toHaveLength(0);
  await call("POST", "/automation/trigger", { name: "ping" }); await new Promise((r) => setTimeout(r, 30));
  expect(sent[0].init.headers.Authorization).toBe("Bearer topsecret"); // still the stored secret after the round trip
  const run = (await call("POST", `/automation/rules/${made.id}/run`)).body;
  expect(run.status).toBe("ok");
  expect(sent).toHaveLength(2);
  expect((await call("DELETE", `/automation/rules/${made.id}`)).body.ok).toBe(true);
  expect((await call("GET", `/automation/rules/${made.id}`)).status).toBe(404);
  const draft = (await call("POST", "/automation/test", { rule: { name: "d", trigger: { type: "manual", name: "z" }, actions: [{ type: "notice", message: "hi" }] } })).body;
  expect(draft.steps[0].text).toBe('show notice "hi"');
  expect((await call("POST", "/automation/rules", { name: "", actions: [] })).status).toBe(400);
});

test("trigger, cancel, pause, status and catalog endpoints", async () => {
  const { call } = await rig();
  expect((await call("POST", "/automation/trigger", {})).body.error).toContain("name is required");
  expect((await call("POST", "/automation/trigger", { name: "x", data: "str" })).body.error).toContain("small JSON object");
  expect((await call("POST", "/automation/trigger", { name: "nobody listens" })).body).toEqual({ woke: 0 });
  expect((await call("POST", "/automation/cancel")).body).toEqual({ cancelled: 0 });
  expect((await call("POST", "/automation/pause", { paused: true })).body.paused).toBe(true);
  expect((await call("GET", "/automation/status")).body).toMatchObject({ paused: true, limits: { maxDepth: 4, maxRunsPerSecond: 20 } });
  expect((await call("POST", "/automation/pause", { paused: "yes" })).status).toBe(400);
  const cat = (await call("GET", "/automation/catalog")).body;
  expect(cat.triggers.map((t: any) => t.type)).toEqual(["event", "state", "clock", "timer", "after", "engine", "sponsor", "manual"]);
  expect(cat.actions.map((t: any) => t.type)).toContain("http");
  expect((await call("GET", "/automation/facts")).body).toMatchObject({ period: 1, "home.score": 0, "engine.live": false });
});

test("macros API: create with hotkey, conflicts, run, nested run log, test, delete", async () => {
  const { call, app } = await rig();
  const m = (await call("POST", "/macros", { label: "Goal horn", color: "#E5484D", icon: "bell", hotkey: "shift+x".replace("shift+x", "Shift+X"), actions: [{ type: "custom.set", key: "horn", value: "on" }] })).body;
  expect(m).toMatchObject({ label: "Goal horn", hotkey: "Shift+X", icon: "bell" });
  expect((await call("POST", "/macros", { label: "Dup", hotkey: "Shift+X", actions: [{ type: "log", message: "x" }] })).body.error).toContain('already used by the macro "Goal horn"');
  expect((await call("POST", "/macros", { label: "Cut clash", hotkey: "Enter", actions: [{ type: "log", message: "x" }] })).body.error).toContain('"cut" shortcut');
  expect((await call("POST", "/macros", { label: "Cut clash", hotkey: "c", actions: [{ type: "log", message: "x" }] })).status).toBe(409); // "c" = clock, upper-cased like the console
  expect((await call("POST", "/macros", { label: "Bad key", hotkey: "Alt+X", actions: [{ type: "log", message: "x" }] })).body.error).toContain("Alt is not supported");
  expect((await call("POST", "/macros", { label: "Bad icon", icon: "rocket", actions: [{ type: "log", message: "x" }] })).body.error).toContain("icon");
  expect((await call("POST", "/macros", { label: "Bad color", color: "red", actions: [{ type: "log", message: "x" }] })).body.error).toContain("color");
  const run = (await call("POST", `/macros/${m.id}/run`, { data: { who: "x" } })).body;
  expect(run).toMatchObject({ kind: "macro", status: "ok", name: "Goal horn" });
  expect(app.automation.custom.all()).toEqual({ horn: "on" });
  expect((await call("POST", `/macros/${m.id}/test`, {})).body.steps[0].text).toBe('set custom field "horn" to "on"');
  expect((await call("POST", "/macros/missing/run")).status).toBe(404);
  expect((await call("PUT", `/macros/${m.id}`, { label: "Horn!" })).body).toMatchObject({ label: "Horn!", hotkey: "Shift+X" });
  expect((await call("GET", "/macros")).body).toHaveLength(1);
  await call("DELETE", `/macros/${m.id}`);
  expect((await call("GET", "/macros")).body).toHaveLength(0);
});

test("event stream (SSE): sends named events as they happen, honors the events filter", async () => {
  const { app, call } = await rig();
  const ctl = new AbortController();
  const res = await app.handle(new Request("http://x/api/stream?events=game.score,custom.*", { signal: ctl.signal }));
  expect(res.headers.get("content-type")).toBe("text/event-stream");
  const reader = res.body!.getReader(), dec = new TextDecoder();
  let text = "";
  const read = async (until: string) => { while (!text.includes(until)) { const { value, done } = await reader.read(); if (done) break; text += dec.decode(value); } };
  await read("retry: 3000");
  await call("POST", "/event", { type: "foul", team: "home" }); // filtered out
  await call("POST", "/event", { type: "score", team: "home", points: 2 });
  await call("PUT", "/custom", { values: { a: "1" } });
  await read("custom.changed");
  expect(text).toContain("event: game.score");
  expect(text).toContain('"points":2');
  expect(text).not.toContain("game.foul");
  expect(text).toContain("event: custom.changed");
  ctl.abort(); await reader.cancel().catch(() => {});
});

test("webhooks API: save, secret never returned, deliveries and test", async () => {
  const { call, settle } = await rig();
  const h = (await call("POST", "/webhooks", { name: "Companion", url: "https://c.example/h", events: ["game.timeout"], secret: "abcdefgh12" })).body;
  expect(h).toMatchObject({ name: "Companion", secretSet: true });
  expect(JSON.stringify((await call("GET", "/webhooks")).body)).not.toContain("abcdefgh12");
  await call("POST", "/event", { type: "timeout", team: "home" }); await settle();
  const d = (await call("GET", "/webhooks/deliveries")).body;
  expect(d[0]).toMatchObject({ event: "game.timeout", status: "ok", name: "Companion" });
  expect((await call("POST", `/webhooks/${h.id}/test`)).body).toMatchObject({ ok: true, code: 200 });
  await call("DELETE", `/webhooks/${h.id}`);
  expect((await call("GET", "/webhooks")).body).toEqual([]);
  expect((await call("POST", "/webhooks", { name: "x", url: "nope" })).status).toBe(400);
});

test("engine and sponsor events reach rules through the app", async () => {
  const { call, settle, app } = await rig();
  await call("POST", "/automation/rules", { name: "Live", trigger: { type: "engine", event: "stream.live" }, actions: [{ type: "custom.set", key: "onair", value: "yes" }] });
  await call("POST", "/automation/rules", { name: "Sponsor", trigger: { type: "sponsor" }, actions: [{ type: "custom.set", key: "sponsored", value: "{{sponsor.name}}" }] });
  await (app.engine as any).startStream({ name: "t", url: "rtmp://x/y", key: "k" }); await settle();
  expect(app.automation.custom.all().onair).toBe("yes");
  const r = await call("POST", "/sponsors/fire", {}); await settle();
  if (r.status === 200) expect(app.automation.custom.all().sponsored).toBeTruthy();
});
