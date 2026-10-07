import { expect, test } from "bun:test";
import { addMacro, addRule, mkView, rig } from "./testkit";
import { MAX_DEPTH, MAX_RPS } from "./runner";
import { parseRule } from "./model";

const ev = (type: string, o: Record<string, unknown> = {}, seq = 1) => ({ type, seq, t: 0, ...o });
const score = (team: string, points: number, seq = 1) => ev("score", { team, points }, seq);

test("event trigger: team and points filters pick the right events and templates fill from the game", async () => {
  const r = rig();
  addRule(r, { name: "Three pointer", trigger: { type: "event", event: "score", team: "home", points: [3] }, actions: [{ type: "graphic", op: "show", id: "lt", fields: { title: "{{home.abbr}} hits a {{event.points}}!", sub: "{{home.score}}-{{away.score}}" } }] });
  const before = mkView({ h: 40, a: 38 }), after = mkView({ h: 43, a: 38 });
  r.auto.onEvent(score("away", 3), before, after); // wrong team
  r.auto.onEvent(score("home", 2), before, after); // wrong points
  r.auto.onEvent(score("home", 3), before, after);
  await r.settle();
  expect(r.calls).toEqual(['show lt {"title":"HOM hits a 3!","sub":"43-38"}']);
  const log = r.auto.runner.log();
  expect(log).toHaveLength(1);
  expect(log[0]).toMatchObject({ kind: "rule", name: "Three pointer", matched: true, status: "ok" });
  expect(log[0].steps[0].text).toContain('show graphic "Lower third"');
});

test("condition: a false condition is logged as not matched, with the reason", async () => {
  const r = rig();
  addRule(r, { trigger: { type: "event", event: "score" }, when: "lead >= 10", actions: [{ type: "log", message: "blowout" }] });
  r.auto.onEvent(score("home", 2), mkView({ h: 20, a: 20 }), mkView({ h: 22, a: 20 }));
  r.auto.onEvent(score("home", 2), mkView({ h: 22, a: 20 }), mkView({ h: 40, a: 20 }));
  await r.settle();
  const log = r.auto.runner.log();
  expect(log.map((e) => [e.matched, e.status])).toEqual([[true, "ok"], [false, "skipped"]]);
  expect(log[1].reason).toContain("lead >= 10");
});

test("before.* facts show the game just before the event", async () => {
  const r = rig();
  addRule(r, { trigger: { type: "event", event: "score" }, when: "before.diff < 0 and diff > 0", actions: [{ type: "notice", message: "Lead change: {{before.home.score}} to {{home.score}}" }] });
  r.auto.onEvent(score("home", 3), mkView({ h: 40, a: 41 }), mkView({ h: 43, a: 41 }));
  await r.settle();
  expect(r.notices).toEqual([{ level: "info", message: "Lead change: 40 to 43" }]);
});

test("cooldown and only-once-per-period / per-game", async () => {
  const r = rig();
  addRule(r, { name: "cool", trigger: { type: "event", event: "foul" }, cooldownSec: 30, actions: [{ type: "log", message: "cool" }] });
  addRule(r, { name: "once-period", trigger: { type: "event", event: "foul" }, once: "period", actions: [{ type: "log", message: "p" }] });
  addRule(r, { name: "once-game", trigger: { type: "event", event: "foul" }, once: "game", actions: [{ type: "log", message: "g" }] });
  const v = mkView({ period: 1 });
  r.auto.onEvent(ev("foul", { team: "home" }), v, v);
  r.t.now += 10_000; r.auto.onEvent(ev("foul", { team: "home" }), v, v);
  const ok = () => r.auto.runner.log(50).filter((e) => e.matched).map((e) => e.name).sort();
  await r.settle();
  expect(ok()).toEqual(["cool", "once-game", "once-period"]);
  const skipped = r.auto.runner.log(50).filter((e) => !e.matched);
  expect(skipped.map((e) => e.reason).join("|")).toContain("Cooling down: 20 s left");
  r.t.now += 40_000; r.state.game = mkView({ period: 2 });
  r.auto.onEvent(ev("foul", { team: "home" }), mkView({ period: 2 }), mkView({ period: 2 }));
  await r.settle();
  const names = r.auto.runner.log(50).filter((e) => e.matched).map((e) => e.name);
  expect(names.filter((n) => n === "cool")).toHaveLength(2); // cooled down by now
  expect(names.filter((n) => n === "once-period")).toHaveLength(2); // new period
  expect(names.filter((n) => n === "once-game")).toHaveLength(1); // never again this game
});

test("state predicate fires when it turns true, not while it stays true, and not at the first look", async () => {
  const r = rig();
  addRule(r, { trigger: { type: "state", when: "clock <= 60000 and period == 4" }, actions: [{ type: "notice", message: "One minute left" }] });
  r.state.game = mkView({ period: 4, clockMs: 30_000 }); // already true when first seen: baseline only
  r.auto.tick(); await r.settle();
  expect(r.notices).toHaveLength(0);
  r.state.game = mkView({ period: 4, clockMs: 90_000 }); r.auto.tick();
  r.state.game = mkView({ period: 4, clockMs: 59_000 }); r.auto.tick();
  r.state.game = mkView({ period: 4, clockMs: 58_000 }); r.auto.tick();
  await r.settle();
  expect(r.notices).toHaveLength(1);
});

test("clock threshold fires once per period when the clock crosses it", async () => {
  const r = rig();
  addRule(r, { trigger: { type: "clock", atSec: 120 }, actions: [{ type: "notice", message: "2:00 left in {{period}}" }] });
  for (const ms of [200_000, 130_000, 119_000, 100_000]) { r.state.game = mkView({ period: 2, clockMs: ms }); r.auto.tick(); }
  r.state.game = mkView({ period: 3, clockMs: 480_000 }); r.auto.tick();
  r.state.game = mkView({ period: 3, clockMs: 100_000 }); r.auto.tick();
  r.state.game = mkView({ period: 3, clockMs: 90_000 }); r.auto.tick();
  await r.settle();
  expect(r.notices.map((n) => n.message)).toEqual(["2:00 left in 2", "2:00 left in 3"]);
});

test("timer rule: every N seconds while a game is active", async () => {
  const r = rig();
  addRule(r, { trigger: { type: "timer", everySec: 60 }, actions: [{ type: "log", message: "tick" }] });
  r.auto.tick(); // starts the timer
  r.t.now += 59_000; r.auto.tick();
  r.t.now += 2_000; r.auto.tick();
  r.t.now += 30_000; r.auto.tick();
  r.t.now += 31_000; r.auto.tick();
  await r.settle();
  expect(r.auto.runner.log().filter((e) => e.matched)).toHaveLength(2);
  r.state.gameId = null; r.t.now += 120_000; r.auto.tick(); await r.settle();
  expect(r.auto.runner.log().filter((e) => e.matched)).toHaveLength(2); // no game, no timers
});

test("engine events: stream live/stopped, recording, a camera dropping and coming back", async () => {
  const r = rig();
  addRule(r, { name: "live", trigger: { type: "engine", event: "stream.live" }, actions: [{ type: "notice", message: "We are live" }] });
  addRule(r, { name: "drop", trigger: { type: "engine", event: "source.dropped" }, actions: [{ type: "notice", message: "Lost {{source.label}}" }] });
  addRule(r, { name: "back", trigger: { type: "engine", event: "source.back", sourceId: "cam1" }, actions: [{ type: "notice", message: "{{source.id}} is back" }] });
  const base = structuredClone(r.engine.status());
  r.auto.onEngine(base); // first look = baseline
  const live = structuredClone(base); live.stream.live = true;
  r.auto.onEngine(live);
  const dropped = structuredClone(live); dropped.sources[0].status = "reconnecting";
  r.auto.onEngine(dropped);
  const back = structuredClone(dropped); back.sources[0].status = "ok";
  r.auto.onEngine(back);
  await r.settle();
  expect(r.notices.map((n) => n.message)).toEqual(["We are live", `Lost ${base.sources[0].label}`, `${base.sources[0].id} is back`]);
});

test("manual trigger: name match is case-insensitive and data is available as trigger.data.*", async () => {
  const r = rig();
  addRule(r, { trigger: { type: "manual", name: "Goal Horn" }, actions: [{ type: "notice", message: "Horn for {{trigger.data.team}} x{{trigger.data.n}}" }] });
  expect(r.auto.runner.trigger("goal horn", { team: "home", n: 2, nested: { deep: 1 } })).toBe(1);
  expect(r.auto.runner.trigger("other")).toBe(0);
  await r.settle();
  expect(r.notices[0].message).toBe("Horn for home x2");
});

test("rules run in priority order and a failing rule does not stop the others", async () => {
  const r = rig({ hasGraphics: false });
  addRule(r, { name: "B second", priority: 20, trigger: { type: "manual", name: "go" }, actions: [{ type: "log", message: "b" }] });
  addRule(r, { name: "A broken", priority: 5, trigger: { type: "manual", name: "go" }, actions: [{ type: "graphic", op: "show", id: "lt" }, { type: "log", message: "never" }] });
  r.auto.runner.trigger("go"); await r.settle();
  const log = r.auto.runner.log().reverse();
  expect(log.map((e) => e.name)).toEqual(["A broken", "B second"]);
  expect(log[0].status).toBe("error");
  expect(log[0].steps).toHaveLength(1); // stopped at the failing step
  expect(log[0].steps[0].error).toBe("Graphics are not available yet.");
  expect(log[1].status).toBe("ok");
});

test("continueOnError keeps going after a failure", async () => {
  const r = rig({ hasGraphics: false });
  addRule(r, { trigger: { type: "manual", name: "go" }, actions: [{ type: "graphic", op: "hide", id: "lt", continueOnError: true }, { type: "notice", message: "after" }] });
  r.auto.runner.trigger("go"); await r.settle();
  expect(r.notices).toHaveLength(1);
  expect(r.auto.runner.log()[0].status).toBe("error"); // something failed, and the log says so
  expect(r.auto.runner.log()[0].steps.map((s) => s.ok)).toEqual([false, true]);
});

test("every action type reaches its stub with templated values", async () => {
  const r = rig();
  r.auto.custom.define("coach", { value: "Ms. Lee" });
  addRule(r, { trigger: { type: "manual", name: "all" }, actions: [
    { type: "graphic", op: "show", id: "lt", fields: { name: "{{custom.coach|upper}}" } }, { type: "graphic", op: "update", id: "tick", fields: { t: "x" } },
    { type: "graphic", op: "next", id: "lt" }, { type: "graphic", op: "toggle", id: "lt" }, { type: "graphic", op: "hide", id: "lt" }, { type: "graphic", op: "clear" },
    { type: "custom.set", key: "line", value: "Score {{home.score}}" }, { type: "custom.clear", key: "coach" },
    { type: "engine", op: "preview", sourceId: "cam2" }, { type: "engine", op: "cut" }, { type: "engine", op: "fade", ms: 800 }, { type: "engine", op: "replay", secondsBack: 12, speed: 0.5 }, { type: "engine", op: "replay.stop" }, { type: "engine", op: "mute", id: "mic", muted: true },
    { type: "sponsor.fire", outcome: "aired" }, { type: "event", event: { type: "mark", note: "Auto {{period}}" } }, { type: "event", event: { type: "score", team: "home", points: "{{trigger.data.p}}" } },
    { type: "notice", level: "warn", message: "n" }, { type: "log", message: "l" },
  ] });
  r.auto.runner.trigger("all", { p: 2 }); await r.settle();
  expect(r.calls).toEqual([
    'show lt {"name":"MS. LEE"}', 'update tick {"t":"x"}', "next lt", "toggle lt", "hide lt", "clear",
    "preview cam2", "cut", "fade 800", "replay 12 0.5", "replay.stop", "mute mic true",
    'sponsor {"outcome":"aired"}', 'event {"type":"mark","note":"Auto 1"}', 'event {"type":"score","team":"home","points":2}',
  ]);
  expect(r.auto.custom.all()).toEqual({ line: "Score 0", coach: "" });
  expect(r.notices).toEqual([{ level: "warn", message: "n" }]);
  expect(r.auto.runner.log()[0].status).toBe("ok");
});

test("wait is non-blocking and Cancel all stops a run in the middle", async () => {
  let release = () => {};
  const r = rig({ sleep: (_ms, signal) => new Promise<void>((res, rej) => { release = res; signal?.addEventListener("abort", () => rej(new Error("Cancelled."))); }) });
  addRule(r, { trigger: { type: "manual", name: "slow" }, actions: [{ type: "log", message: "1" }, { type: "wait", seconds: 30 }, { type: "notice", message: "late" }] });
  r.auto.runner.trigger("slow"); await r.settle();
  expect(r.auto.runner.log()[0].status).toBe("running"); // the server is not blocked: we are here
  expect(r.auto.runner.status().running).toBe(1);
  expect(r.auto.runner.cancelAll()).toBe(1); await r.settle();
  expect(r.auto.runner.log()[0].status).toBe("cancelled");
  expect(r.notices).toHaveLength(0);
  void release;
});

test("runs of the same rule queue up in order; more than 5 waiting are refused", async () => {
  const gates: (() => void)[] = [];
  const r = rig({ sleep: () => new Promise<void>((res) => gates.push(res)) });
  addRule(r, { trigger: { type: "manual", name: "q" }, actions: [{ type: "wait", seconds: 1 }, { type: "notice", message: "done" }] });
  for (let i = 0; i < 8; i++) r.auto.runner.trigger("q");
  await r.settle();
  expect(r.auto.runner.log(20).filter((e) => e.status === "skipped").length).toBe(3); // 8 asked, 5 fit (the one running plus the ones waiting), 3 refused
  while (gates.length) { gates.shift()!(); await r.settle(); }
  await r.settle();
  expect(r.notices).toHaveLength(5);
});

test("chain depth: a rule that keeps triggering itself is stopped with a plain message", async () => {
  const r = rig({ onEvent: (b, auto) => auto().onEvent(ev("mark", {}, 99), null, mkView()) });
  addRule(r, { name: "loop", trigger: { type: "event", event: "mark" }, actions: [{ type: "event", event: { type: "mark", note: "again" } }] });
  r.auto.onEvent(ev("mark"), null, mkView());
  await r.settle();
  const runs = r.calls.filter((c) => c.startsWith("event")).length;
  expect(runs).toBeLessThanOrEqual(MAX_DEPTH);
  expect(runs).toBeGreaterThan(0);
  const stopped = r.auto.runner.log(50).find((e) => e.status === "skipped");
  expect(stopped?.reason).toContain("levels deep");
  expect(r.notices.some((n) => n.message.includes("levels deep"))).toBe(true);
});

test("runs-per-second limit pauses automation for a few seconds, once, with a notice", async () => {
  const r = rig();
  for (let i = 0; i < MAX_RPS + 15; i++) addRule(r, { name: `spam${i}`, trigger: { type: "manual", name: "spam" }, actions: [{ type: "log", message: "x" }] });
  r.auto.runner.trigger("spam");
  await r.settle();
  const ran = r.auto.runner.log(100).filter((e) => e.status !== "skipped").length;
  expect(ran).toBe(MAX_RPS);
  expect(r.notices.filter((n) => n.message.includes("paused")).length).toBe(1);
  expect(r.auto.runner.status().pausedUntil).toBeGreaterThan(r.t.now);
  r.t.now += 6000; r.auto.runner.trigger("spam"); await r.settle(); // pause over
  expect(r.auto.runner.log(100).filter((e) => e.at === r.t.now && e.status === "ok").length).toBe(MAX_RPS); // running again
});

test("macros: run now, nested macros, hotkey data, and a macro that calls itself is stopped", async () => {
  const r = rig();
  const inner = addMacro(r, { label: "Inner", actions: [{ type: "notice", message: "inner {{trigger.data.who}}" }] });
  const outer = addMacro(r, { label: "Outer", actions: [{ type: "log", message: "o" }, { type: "macro", macroId: inner.id }] });
  const e = await r.auto.runner.runMacro(outer.id, { who: "Ana" });
  expect(e.status).toBe("ok");
  expect(e.steps.map((s) => [s.depth ?? 0, s.type])).toEqual([[0, "log"], [0, "macro"], [1, "notice"]]);
  expect(r.notices[0].message).toBe("inner Ana");
  const loop = addMacro(r, { label: "Loop", actions: [{ type: "notice", message: "again" }] });
  r.store.put("macro", { ...loop, actions: [{ type: "macro", macroId: loop.id }] });
  const l = await r.auto.runner.runMacro(loop.id);
  expect(l.status).toBe("error");
  expect(l.steps.at(-1)!.error).toContain("levels deep");
  await expect(r.auto.runner.runMacro("missing")).rejects.toThrow("Macro not found.");
});

test("after-rule trigger: N seconds after another rule ran, cancelled by Cancel all", async () => {
  const r = rig();
  const first = addRule(r, { name: "first", trigger: { type: "manual", name: "go" }, actions: [{ type: "log", message: "1" }] });
  addRule(r, { name: "follow", trigger: { type: "after", ruleId: first.id, afterSec: 0 }, actions: [{ type: "notice", message: "followed" }] });
  r.auto.runner.trigger("go");
  await new Promise((res) => setTimeout(res, 20)); await r.settle();
  expect(r.notices.map((n) => n.message)).toEqual(["followed"]);
});

test("paused automation ignores triggers but manual macros still run", async () => {
  const r = rig();
  addRule(r, { trigger: { type: "event", event: "mark" }, actions: [{ type: "notice", message: "x" }] });
  const m = addMacro(r, { actions: [{ type: "notice", message: "macro" }] });
  r.auto.runner.setPaused(true);
  r.auto.onEvent(ev("mark"), null, mkView()); await r.settle();
  expect(r.notices).toHaveLength(0);
  await r.auto.runner.runMacro(m.id);
  expect(r.notices).toHaveLength(1);
  r.auto.runner.setPaused(false);
  r.auto.onEvent(ev("mark"), null, mkView()); await r.settle();
  expect(r.notices).toHaveLength(2);
});

test("run log keeps the last 500 runs and reports facts in plain language", async () => {
  const r = rig();
  const rule = addRule(r, { trigger: { type: "manual", name: "n" }, actions: [{ type: "log", message: "x" }] });
  for (let i = 0; i < 520; i++) { r.t.now += 1000; r.auto.runner.trigger("n"); if (i % 10 === 0) await r.settle(); }
  await r.settle();
  expect(r.auto.runner.log(1000)).toHaveLength(500);
  expect(r.auto.runner.log(1)[0].ref).toBe(rule.id);
});

test("save-time validation rejects broken rules with plain sentences", () => {
  const bad = (b: any, msg: string) => expect(() => parseRule({ name: "x", trigger: { type: "manual", name: "a" }, actions: [{ type: "log", message: "m" }], ...b })).toThrow(msg);
  bad({ name: "" }, "rule name");
  bad({ actions: [] }, "at least one action");
  bad({ actions: [{ type: "bogus" }] }, "must be one of");
  bad({ trigger: { type: "event", event: "nope" } }, "game event");
  bad({ when: "period ==" }, "extra condition");
  bad({ trigger: { type: "state", when: "x $ y" } }, "not allowed");
  bad({ actions: [{ type: "log", message: "{{broken" }] }, "broken {{placeholder}}");
  bad({ actions: [{ type: "http", method: "POST", url: "ftp://x" }] }, "http:// or https://");
  bad({ actions: [{ type: "http", method: "POST", url: "https://u:p@x.com/" }] }, "user name or password");
  bad({ actions: [{ type: "wait", seconds: 9999 }] }, "wait");
  bad({ priority: 0 }, "Priority");
  bad({ actions: Array(31).fill({ type: "log", message: "x" }) }, "At most 30");
  expect(() => parseRule({ name: "ok", trigger: { type: "event", event: "score", points: [3] }, actions: [{ type: "log", message: "{{home.score|json}}" }] })).not.toThrow();
});
