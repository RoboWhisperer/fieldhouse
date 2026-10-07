import { expect, test } from "bun:test";
import { addMacro, addRule, mkView, rig } from "./testkit";
import { maskActions, parseRule, stripSecrets, HIDDEN } from "./model";
import { render } from "./facts";

const everything = [
  { type: "graphic", op: "show", id: "lt", fields: { a: "{{home.abbr}}" } }, { type: "graphic", op: "clear" },
  { type: "custom.set", key: "line", value: "x" }, { type: "custom.clear", key: "line" },
  { type: "engine", op: "cut" }, { type: "engine", op: "replay", secondsBack: 10, speed: 1 },
  { type: "sponsor.fire" }, { type: "event", event: { type: "mark", note: "hi" } },
  { type: "http", method: "POST", url: "https://hooks.example.com/a/{{home.abbr}}", headers: { Authorization: "Bearer s3cret" }, body: '{"s":{{home.score}}}' },
  { type: "wait", seconds: 5 }, { type: "notice", message: "hello" }, { type: "log", message: "log" },
];

test("dry-run has no side effects: nothing is called, stored, logged, cooled down or counted", async () => {
  const r = rig();
  const inner = addMacro(r, { label: "Inner", actions: [{ type: "notice", message: "inner" }] });
  const rule = addRule(r, { name: "everything", cooldownSec: 60, once: "game", trigger: { type: "event", event: "score" }, actions: [...everything, { type: "macro", macroId: inner.id }] });
  const snapshot = () => JSON.stringify([r.store.list("rule"), r.store.list("macro"), r.store.list("custom"), r.auto.custom.all(), r.auto.runner.log(1000)]);
  const before = snapshot();
  const res = r.auto.runner.dryRun(rule, { event: { type: "score", team: "home", points: 3 } });
  expect(r.calls).toEqual([]);
  expect(r.sent).toEqual([]);
  expect(r.notices).toEqual([]);
  expect(snapshot()).toBe(before);
  expect(res.triggerMatches).toBe(true);
  expect(res.wouldRun).toBe(true);
  expect(res.steps.map((s) => s.text)).toEqual([
    'show graphic "Lower third" with a="HOM"', "take every graphic off air", 'set custom field "line" to "x"', 'clear custom field "line"',
    "cut preview to program", "play an instant replay (last 10 s at 1x)", "fire the sponsor that is due", "add game event mark \"hi\"",
    "send POST to hooks.example.com/a/HOM", "wait 5 seconds", 'show notice "hello"', "write to the log: \"log\"", 'run macro "Inner"', 'show notice "inner"',
  ]);
  expect(res.steps.at(-1)!.depth).toBe(1);
  // the cooldown and "only once" were not used up: the rule still fires for real
  r.auto.onEvent({ type: "score", team: "home", points: 3, seq: 1, t: 0 }, mkView(), mkView({ h: 3 }));
  await r.settle();
  expect(r.auto.runner.log().filter((e) => e.matched && e.status === "ok")).toHaveLength(1);
});

test("dry-run reports what would go wrong: unknown variables, missing graphics, refused events, failing conditions", () => {
  const r = rig();
  const rule = parseRule({ name: "w", trigger: { type: "event", event: "score", team: "home" }, when: "nothere > 3", actions: [
    { type: "graphic", op: "show", id: "ghost" }, { type: "notice", message: "{{unknown.var}}" }, { type: "event", event: { type: "score", team: "home", points: 9 } }, { type: "custom.set", key: "n", value: "x" }] }, undefined, 0);
  r.auto.custom.define("n", { type: "number" });
  const res = r.auto.runner.dryRun(rule, { event: { type: "score", team: "away", points: 2 } });
  expect(res.triggerMatches).toBe(false);
  expect(res.wouldRun).toBe(false);
  expect(res.condition).toEqual({ text: "nothere > 3", result: false });
  expect(res.warnings.join("\n")).toContain('Unknown fact "nothere"');
  expect(res.warnings.join("\n")).toContain('There is no graphic called "ghost"');
  expect(res.warnings.join("\n")).toContain("Unknown variable {{unknown.var}}");
  expect(res.warnings.join("\n")).toContain("would be refused");
  expect(res.warnings.join("\n")).toContain("must be a number");
  expect(r.calls).toEqual([]);
});

test("dry-run of a sample can override facts", () => {
  const r = rig();
  const rule = parseRule({ name: "w", trigger: { type: "state", when: "clock < 1" }, when: "lead > 10", actions: [{ type: "log", message: "{{lead}}" }] }, undefined, 0);
  expect(r.auto.runner.dryRun(rule).wouldRun).toBe(false);
  const res = r.auto.runner.dryRun(rule, { facts: { lead: 15 } });
  expect(res.wouldRun).toBe(true);
  expect(res.steps[0].text).toContain("15");
});

test("web request: templated URL is encoded, headers cannot inject lines, status is logged, no redirects, 5 s timeout", async () => {
  const r = rig();
  r.auto.custom.define("who", { value: "a b/../c?x=1" });
  addRule(r, { trigger: { type: "manual", name: "hook" }, actions: [{ type: "http", method: "POST", url: "https://example.com/api/{{custom.who}}?team={{home.abbr}}", headers: { "X-Token": "abc{{trigger.data.v}}", "X-Empty": "" }, body: '{"name":"{{custom.who|json}}"}' }] });
  r.auto.runner.trigger("hook", { v: "\r\nEvil: yes" }); await r.settle();
  expect(r.sent).toHaveLength(1);
  const { url, init } = r.sent[0];
  expect(url).toBe("https://example.com/api/a%20b%2F..%2Fc%3Fx%3D1?team=HOM");
  expect(init.redirect).toBe("manual");
  expect(init.signal).toBeInstanceOf(AbortSignal);
  expect(init.headers["X-Token"]).toBe("abc Evil: yes");
  expect(init.headers["X-Empty"]).toBeUndefined();
  expect(init.headers["content-type"]).toBe("application/json");
  expect(JSON.parse(init.body)).toEqual({ name: "a b/../c?x=1" });
  const entry = r.auto.runner.log()[0];
  expect(entry.steps[0].text).toBe("send POST to example.com/api/a%20b%2F..%2Fc%3Fx%3D1 (POST example.com/api/a%20b%2F..%2Fc%3Fx%3D1 answered 200)");
  expect(JSON.stringify(entry)).not.toContain("abc"); // header values never reach the log
});

test("web request failures are plain sentences without the query, header or body", async () => {
  const bad = rig({ fetch: (async () => new Response("no", { status: 503 })) as any });
  addRule(bad, { trigger: { type: "manual", name: "x" }, actions: [{ type: "http", method: "GET", url: "https://example.com/p?token=SECRET" }] });
  bad.auto.runner.trigger("x"); await bad.settle();
  const e = bad.auto.runner.log()[0];
  expect(e.status).toBe("error");
  expect(e.steps[0].error).toBe("GET example.com/p answered 503");
  expect(JSON.stringify(e)).not.toContain("SECRET");
  const redirected = rig({ fetch: (async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } })) as any });
  addRule(redirected, { trigger: { type: "manual", name: "x" }, actions: [{ type: "http", method: "GET", url: "https://example.com/" }] });
  redirected.auto.runner.trigger("x"); await redirected.settle();
  expect(redirected.auto.runner.log()[0].steps[0].error).toContain("does not follow redirects");
  const down = rig({ fetch: (async () => { throw Object.assign(new Error("boom"), { code: "ECONNREFUSED" }); }) as any });
  addRule(down, { trigger: { type: "manual", name: "x" }, actions: [{ type: "http", method: "GET", url: "http://10.0.0.5:9/" }] });
  down.auto.runner.trigger("x"); await down.settle();
  expect(down.auto.runner.log()[0].steps[0].error).toBe("GET 10.0.0.5:9 could not connect (ECONNREFUSED)");
});

test("web request timeout: a server that never answers is cut off", async () => {
  const { send } = await import("./http");
  const hang = ((_u: any, init: any) => new Promise((_r, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted"))))) as any;
  const t0 = Date.now();
  const res = await send(hang, { method: "GET", url: "https://slow.example/", timeoutMs: 50 });
  expect(res).toEqual({ ok: false, status: 0, message: "GET slow.example did not answer within 0.05 seconds" });
  expect(Date.now() - t0).toBeLessThan(1000);
  const ctl = new AbortController(); const p = send(hang, { method: "GET", url: "https://slow.example/", signal: ctl.signal }); ctl.abort();
  expect((await p).message).toBe("GET slow.example was cancelled");
});

test("header values are write-only: the API shows [hidden], saving it back keeps the secret, exports drop it", () => {
  const rule = parseRule({ name: "h", trigger: { type: "manual", name: "a" }, actions: [{ type: "http", method: "POST", url: "https://x.example/p?k=1", headers: { Authorization: "Bearer topsecret", "X-Plain": "" } }] }, undefined, 0);
  const shown = maskActions(rule.actions);
  expect(JSON.stringify(shown)).not.toContain("topsecret");
  expect(shown[0].headers).toEqual({ Authorization: HIDDEN, "X-Plain": "" });
  const resaved = parseRule({ name: "h", actions: shown }, rule, 1);
  expect(resaved.actions[0].headers.Authorization).toBe("Bearer topsecret");
  const changed = parseRule({ name: "h", actions: [{ ...shown[0], headers: { Authorization: "Bearer new" } }] }, rule, 1);
  expect(changed.actions[0].headers.Authorization).toBe("Bearer new");
  const out = JSON.stringify(stripSecrets(rule.actions));
  expect(out).not.toContain("topsecret");
  expect(out).not.toContain("k=1");
  expect(out).toContain('"headerNames":["Authorization","X-Plain"]');
});

test("templates: filters, unknown names and no code execution", () => {
  const f = { "home.abbr": "wolves", n: 3, quote: 'say "hi"' };
  expect(render("{{home.abbr|upper}} {{ n }} {{quote|json}} {{quote|url}}", f).text).toBe('WOLVES 3 say \\"hi\\" say%20%22hi%22');
  expect(render("{{nope}}!", f)).toEqual({ text: "!", missing: ["nope"] });
  expect(render("{{constructor}} {{__proto__}}", f).text).toBe(" ");
  expect(render("${1+1} {{ 1+1 }}", f).text).toBe("${1+1} {{ 1+1 }}");
});
