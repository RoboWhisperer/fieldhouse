// The rules engine: finds the rules a trigger wakes up, checks conditions / cooldowns, and runs action lists through a per-rule queue.
// Safety: errors stay inside their run, nesting is capped (MAX_DEPTH), runs per second are capped (MAX_RPS), Cancel all stops everything.
import { AsyncLocalStorage } from "node:async_hooks";
import type { ActionContext, GameView, VarMap } from "../custom-types";
import type { EngineStatus } from "../types";
import { newId } from "../data";
import type { Store } from "../store";
import { testExpr } from "./expr";
import { buildFacts, flatten } from "./facts";
import { plan, type Env } from "./actions";
import type { Action, MacroDoc, RuleDoc, Trigger } from "./model";
import { ENGINE_EVENTS } from "./model";
import type { Bus } from "./bus";
import type { Custom } from "./custom";

export const MAX_DEPTH = 4, MAX_RPS = 20, PAUSE_MS = 5000, MAX_QUEUE = 5, LOG_SIZE = 500;
type Level = "INFO" | "WARN" | "ERROR";
export interface Step { type: string; text: string; ok: boolean; error?: string; depth?: number }
export interface RunEntry { id: string; at: number; kind: "rule" | "macro"; ref: string; name: string; trigger: string; matched: boolean; status: "queued" | "running" | "ok" | "error" | "skipped" | "cancelled"; reason?: string; ms?: number; steps: Step[] }

export interface RunnerDeps extends Omit<ActionContext, "custom"> {
  custom: Custom;
  store: Store; bus: Bus; now: () => number;
  notify: (level: "info" | "warn", message: string) => void;
  view: () => GameView | null; gameId: () => string | null;
  fetch: () => typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  mirror?: (level: Level, message: string) => void; // diagnostics
}
const realSleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res, rej) => {
  if (signal?.aborted) return rej(new Error("Cancelled."));
  const t = setTimeout(res, ms); t.unref?.();
  signal?.addEventListener("abort", () => { clearTimeout(t); rej(new Error("Cancelled.")); }, { once: true });
});
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Plain-language sentence for a trigger (used in the run log and the editor). */
export function describeTrigger(t: Trigger): string {
  switch (t.type) {
    case "event": return `${t.event}${t.team ? ` by ${t.team}` : ""}${t.points ? ` for ${t.points.join("/")}` : ""}${t.period ? ` in period ${t.period}` : ""}`;
    case "state": return `when ${t.when}`;
    case "clock": return `clock reaches ${Math.floor(t.atSec / 60)}:${String(t.atSec % 60).padStart(2, "0")}${t.period ? ` in period ${t.period}` : " each period"}`;
    case "timer": return `every ${t.everySec} s`;
    case "after": return `${t.afterSec} s after another rule`;
    case "engine": return `video: ${t.event}`;
    case "sponsor": return "sponsor fired";
    case "manual": return `manual "${t.name}"`;
  }
}

export function createRunner(d: RunnerDeps) {
  const als = new AsyncLocalStorage<{ depth: number }>();
  const sleep = d.sleep ?? realSleep;
  const ring: RunEntry[] = [];
  const active = new Map<string, AbortController>();
  const chains = new Map<string, { tail: Promise<unknown>; n: number }>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const lastRun = new Map<string, number>(), onceKeys = new Set<string>(), edge = new Map<string, boolean>(), clockPrev = new Map<string, number>(), timerAt = new Map<string, number>();
  let stamps: number[] = [], pausedUntil = 0, lastNote = 0, curGame: string | null = null, prevEngine: EngineStatus | undefined;
  let paused = d.store.get<{ id: string; paused: boolean }>("automation", "main")?.paused ?? false;

  const rules = () => d.store.list<RuleDoc>("rule").filter((r) => r.enabled).sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  const macro = (id: string) => d.store.get<MacroDoc>("macro", id);
  const push = (e: RunEntry) => { ring.push(e); if (ring.length > LOG_SIZE) ring.shift(); return e; };
  const mirror = (e: RunEntry) => {
    const bad = e.steps.find((s) => !s.ok);
    d.mirror?.(e.status === "error" ? "WARN" : "INFO", `Automation: ${e.kind} "${e.name}" ${e.status}${e.matched ? ` (${e.steps.length} step${e.steps.length === 1 ? "" : "s"}${e.ms !== undefined ? `, ${e.ms} ms` : ""})` : ""}${e.reason ? `: ${e.reason}` : ""}${bad ? `; ${bad.text}: ${bad.error}` : ""}`);
  };

  const facts = (extra?: VarMap, before?: GameView | null, game?: GameView | null): VarMap =>
    buildFacts({ game: game === undefined ? d.view() : game, before, custom: d.custom.all(), engine: d.engine.status(), extra, now: d.now(), gameId: d.gameId() });

  const env = (f: VarMap, signal?: AbortSignal, warnings: string[] = []): Env => ({ ctx: d as any, facts: f, fetch: d.fetch, notify: d.notify, macro, signal, sleep, warnings });

  /** Runaway protection: false (and one notice) while more than MAX_RPS runs per second were asked for. */
  function allowed(): boolean {
    const t = d.now();
    if (t < pausedUntil) return false;
    stamps = stamps.filter((s) => t - s < 1000);
    if (stamps.length >= MAX_RPS) {
      pausedUntil = t + PAUSE_MS;
      if (t - lastNote > 1000) { lastNote = t; d.notify("warn", `Automation paused for ${PAUSE_MS / 1000} seconds: more than ${MAX_RPS} rules ran in one second. A rule may be triggering itself. Check Automation > Run log.`); }
      return false;
    }
    stamps.push(t); return true;
  }

  // ---------------------------------------------------------------- running action lists
  async function execList(actions: Action[], e: Env, entry: RunEntry, depth: number): Promise<boolean> {
    for (const a of actions) {
      if (e.signal?.aborted) { entry.status = "cancelled"; return false; }
      const step: Step = { type: a.type, text: "", ok: true, ...(depth ? { depth } : {}) };
      entry.steps.push(step);
      try {
        const p = plan(a, e);
        step.text = p.text;
        if (p.sub) {
          if (depth + 1 > MAX_DEPTH) throw new Error(`Macros call each other more than ${MAX_DEPTH} levels deep. Stopped.`);
          if (!(await execList(p.sub, e, entry, depth + 1))) return false;
        } else {
          const msg = await p.run?.();
          if (typeof msg === "string") step.text = `${p.text} (${msg})`;
        }
      } catch (err: any) {
        step.ok = false; step.error = e.signal?.aborted ? "Cancelled." : String(err?.message ?? err).slice(0, 300);
        if (e.signal?.aborted) { entry.status = "cancelled"; return false; }
        if (!a.continueOnError) { entry.status = "error"; return false; }
        entry.status = "error"; // keep going, but remember something failed
      }
    }
    return true;
  }

  /** Queue one run behind earlier runs of the same rule/macro. Resolves when it finished. */
  function start(kind: "rule" | "macro", doc: RuleDoc | MacroDoc, trigger: string, f: VarMap): { entry: RunEntry; done: Promise<RunEntry> } {
    const name = "label" in doc ? doc.label : doc.name;
    const depth = als.getStore()?.depth ?? 0;
    const entry: RunEntry = { id: newId("run"), at: d.now(), kind, ref: doc.id, name, trigger, matched: true, status: "queued", steps: [] };
    const skip = (reason: string, note = false) => { entry.status = "skipped"; entry.matched = false; entry.reason = reason; push(entry); mirror(entry); if (note) d.notify("warn", reason); return { entry, done: Promise.resolve(entry) }; };
    if (depth >= MAX_DEPTH) return skip(`Stopped: automation started more automation ${MAX_DEPTH} levels deep (a rule may be triggering itself).`, d.now() - lastNote > 5000 && !!(lastNote = d.now()));
    if (!allowed()) return skip(`Skipped: automation is paused for a few seconds because too many rules ran at once.`);
    const key = `${kind}:${doc.id}`, c = chains.get(key) ?? { tail: Promise.resolve(), n: 0 };
    if (c.n >= MAX_QUEUE) return skip(`Skipped: "${name}" already has ${MAX_QUEUE} runs waiting.`);
    push(entry); c.n++; chains.set(key, c);
    const ctl = new AbortController(); active.set(entry.id, ctl);
    const run = async () => {
      if (ctl.signal.aborted) { entry.status = "cancelled"; return; }
      entry.status = "running";
      const t0 = Date.now();
      try { await als.run({ depth: depth + 1 }, () => execList(doc.actions, env(f, ctl.signal), entry, 0)); if (entry.status === "running") entry.status = "ok"; }
      catch (err: any) { entry.status = "error"; entry.reason = String(err?.message ?? err); }
      entry.ms = Date.now() - t0;
    };
    const done = (c.tail = c.tail.then(run, run).finally(() => { c.n--; active.delete(entry.id); mirror(entry); })).then(() => entry);
    if (kind === "rule") afterRules(doc as RuleDoc, f);
    return { entry, done };
  }

  /** "N seconds after rule X" triggers. */
  function afterRules(from: RuleDoc, f: VarMap) {
    for (const r of rules()) if (r.trigger.type === "after" && r.trigger.ruleId === from.id) {
      const t = setTimeout(() => { timers.delete(t); void consider(r, f, `${r.trigger.type === "after" ? r.trigger.afterSec : 0} s after "${from.name}"`); }, (r.trigger as any).afterSec * 1000);
      t.unref?.(); timers.add(t);
    }
  }

  /** Condition, cooldown and only-once checks, then queue the run. Unmatched checks are logged so "why didn't it fire?" has an answer. */
  function consider(r: RuleDoc, f: VarMap, trigger: string): { entry: RunEntry; done: Promise<RunEntry> } | null {
    const miss = (reason: string) => { const e = push({ id: newId("run"), at: d.now(), kind: "rule", ref: r.id, name: r.name, trigger, matched: false, status: "skipped", reason, steps: [] }); mirror(e); return null; };
    if (r.when) { try { if (!testExpr(r.when, f).result) return miss(`The condition "${r.when}" was not true.`); } catch (e: any) { return miss(`The condition could not be checked: ${e.message}`); } }
    const t = d.now(), last = lastRun.get(r.id);
    if (r.cooldownSec && last !== undefined && t - last < r.cooldownSec * 1000) return miss(`Cooling down: ${Math.ceil((r.cooldownSec * 1000 - (t - last)) / 1000)} s left.`);
    if (r.once) {
      const k = `${r.id}|${r.once === "game" ? d.gameId() : `${d.gameId()}|${f.period}`}`;
      if (onceKeys.has(k)) return miss(`Already ran once this ${r.once}.`);
      onceKeys.add(k);
    }
    lastRun.set(r.id, t);
    return start("rule", r, trigger, f);
  }

  const dispatch = (match: (t: Trigger) => boolean, f: VarMap, label: string) => { for (const r of rules()) if (match(r.trigger)) void consider(r, f, label); };

  // ---------------------------------------------------------------- state-style triggers (checked after every change and once a second)
  function evaluate(f: VarMap) {
    if (paused) return;
    const g = d.gameId();
    if (g !== curGame) { curGame = g; edge.clear(); clockPrev.clear(); timerAt.clear(); }
    if (!g) return;
    for (const r of rules()) {
      const t = r.trigger;
      if (t.type === "state") {
        let now = false; try { now = testExpr(t.when, f).result; } catch {}
        const was = edge.get(r.id); edge.set(r.id, now);
        if (now && was === false) void consider(r, f, describeTrigger(t)); // fires when it turns true; the first look only records the starting point
      } else if (t.type === "clock") {
        const cur = Number(f.clock), prev = clockPrev.get(r.id); clockPrev.set(r.id, cur);
        if (prev === undefined || !Number.isFinite(cur) || (t.period && f.period !== t.period)) continue;
        if (prev > t.atSec * 1000 && cur <= t.atSec * 1000) {
          const k = `${r.id}|clock|${g}|${f.period}`;
          if (!onceKeys.has(k)) { onceKeys.add(k); void consider(r, f, describeTrigger(t)); }
        }
      } else if (t.type === "timer") {
        const at = timerAt.get(r.id) ?? (timerAt.set(r.id, d.now()), d.now());
        if (d.now() - at >= t.everySec * 1000) { timerAt.set(r.id, d.now()); void consider(r, f, describeTrigger(t)); }
      }
    }
  }

  // ---------------------------------------------------------------- what the app calls
  const evMatch = (ev: any) => (t: Trigger) => t.type === "event" && t.event === ev.type && (!t.team || ev.team === t.team) && (!t.points || t.points.includes(ev.points)) && (!t.period || ev.period === t.period);
  const api = {
    /** After every appended game event. `before` and `after` are the game views either side of it. */
    onEvent(ev: any, before: GameView | null, after: GameView | null) {
      try {
        const { seq, t: _t, ...fields } = ev;
        d.bus.emit(String(ev.type).startsWith("game.") ? ev.type : `game.${ev.type}`, { event: ev, game: after });
        if (ev.type === "game.start") { curGame = null; }
        if (paused) return;
        const f = facts({ ...flatten("event", { ...fields, seq }) }, before, after);
        dispatch(evMatch(ev), f, `${ev.type}${ev.team ? " " + ev.team : ""}${ev.points ? " +" + ev.points : ""}`);
        evaluate(f);
      } catch (e: any) { d.mirror?.("ERROR", `Automation: ${e?.message ?? e}`); }
    },
    onGameEnd() { try { d.bus.emit("game.end", { game: d.view() }); if (!paused) dispatch(evMatch({ type: "game.end" }), facts(), "game ended"); } catch (e: any) { d.mirror?.("ERROR", `Automation: ${e?.message ?? e}`); } },
    /** Called on every engine change: finds what changed since last time. */
    onEngine(s: EngineStatus) {
      try {
        const p = prevEngine; prevEngine = s;
        if (!p) return;
        const found: { event: (typeof ENGINE_EVENTS)[number]; source?: { id: string; label: string } }[] = [];
        if (!p.stream.live && s.stream.live) found.push({ event: "stream.live" });
        if (p.stream.live && !s.stream.live) found.push({ event: "stream.stopped" });
        if (!p.stream.reconnecting && s.stream.reconnecting) found.push({ event: "stream.reconnecting" });
        if (!p.record.active && s.record.active) found.push({ event: "record.started" });
        if (p.record.active && !s.record.active) found.push({ event: "record.stopped" });
        if (p.replay?.active && !s.replay?.active) found.push({ event: "replay.finished" });
        for (const src of s.sources) { const o = p.sources.find((x) => x.id === src.id); if (o && o.status === "ok" && src.status !== "ok") found.push({ event: "source.dropped", source: src }); if (o && o.status !== "ok" && src.status === "ok") found.push({ event: "source.back", source: src }); }
        for (const x of found) {
          d.bus.emit(`engine.${x.event}`, { source: x.source ?? null });
          if (paused) continue;
          const f = facts({ "engine.event": x.event, ...(x.source ? { "source.id": x.source.id, "source.label": x.source.label } : {}) });
          dispatch((t) => t.type === "engine" && t.event === x.event && (!t.sourceId || t.sourceId === x.source?.id), f, `video: ${x.event}${x.source ? ` (${x.source.label})` : ""}`);
        }
        if (found.length && !paused) evaluate(facts());
      } catch (e: any) { d.mirror?.("ERROR", `Automation: ${e?.message ?? e}`); }
    },
    onSponsor(info: { sponsorId: string; name?: string; outcome?: string }) {
      try { d.bus.emit("sponsor.fired", info); if (!paused) dispatch((t) => t.type === "sponsor" && (!t.sponsorId || t.sponsorId === info.sponsorId), facts(flatten("sponsor", info)), `sponsor fired${info.name ? ` (${info.name})` : ""}`); } catch {}
    },
    onCustom(key: string, value: string | null, old: string | null) { try { d.bus.emit("custom.changed", { key, value, old }); if (!paused) evaluate(facts()); } catch {} },
    /** Once a second. */
    tick() { try { if (!paused && rules().some((r) => ["state", "clock", "timer"].includes(r.trigger.type))) evaluate(facts()); } catch {} },
    /** A named manual trigger (button, hotkey, API). Returns how many rules it woke. */
    trigger(name: string, data?: unknown): number {
      const f = facts({ "trigger.name": name, ...flatten("trigger.data", data) });
      d.bus.emit(`trigger.${slug(name)}`, { name, data: data ?? null });
      const hit = rules().filter((r) => r.trigger.type === "manual" && r.trigger.name.toLowerCase() === name.toLowerCase());
      for (const r of hit) void consider(r, f, `manual "${name}"`);
      return hit.length;
    },
    /** Run a macro now (button, hotkey, API, Companion). Waits up to 2 s so quick macros return their result. */
    async runMacro(id: string, data?: unknown): Promise<RunEntry> {
      const m = macro(id); if (!m) throw new Error("Macro not found.");
      const { entry, done } = start("macro", m, `button "${m.label}"`, facts({ "trigger.name": m.label, ...flatten("trigger.data", data) }));
      let t: ReturnType<typeof setTimeout>;
      return Promise.race([done, new Promise<RunEntry>((r) => { t = setTimeout(() => r(entry), 2000); t.unref?.(); })]).finally(() => clearTimeout(t));
    },
    /** Run a rule's actions right now, ignoring its trigger, condition and cooldown (the "Run now" button). */
    async runRule(id: string) { const r = d.store.get<RuleDoc>("rule", id); if (!r) throw new Error("Rule not found."); const { entry, done } = start("rule", r, "run now (by hand)", facts()); let t: ReturnType<typeof setTimeout>; return Promise.race([done, new Promise<RunEntry>((res) => { t = setTimeout(() => res(entry), 2000); t.unref?.(); })]).finally(() => clearTimeout(t)); },
    /** Dry run: what WOULD happen. No action is performed, no cooldown is used up, nothing is logged. */
    dryRun(doc: RuleDoc | MacroDoc, sample: { facts?: VarMap; event?: Record<string, unknown> } = {}) {
      const warnings: string[] = [];
      const f: VarMap = { ...facts(sample.event ? flatten("event", sample.event) : undefined), ...(sample.facts ?? {}) };
      const isRule = "trigger" in doc;
      let condition: null | { text: string; result: boolean } = null;
      if (isRule && doc.when) { try { const r = testExpr(doc.when, f); condition = { text: doc.when, result: r.result }; for (const u of r.unknown) warnings.push(`Unknown fact "${u}" in the condition (it counts as empty).`); } catch (e: any) { warnings.push(e.message); } }
      const triggerMatches = isRule && doc.trigger.type === "event" && sample.event ? evMatch(sample.event)(doc.trigger) : null;
      const steps: Step[] = [];
      const e = env(f, undefined, warnings);
      const walk = (list: Action[], depth: number) => {
        for (const a of list) {
          const p = plan(a, e);
          steps.push({ type: a.type, text: p.text, ok: true, ...(depth ? { depth } : {}) });
          if (p.sub) { if (depth + 1 > MAX_DEPTH) { warnings.push("Macros call each other too deeply."); continue; } walk(p.sub, depth + 1); }
        }
      };
      walk(doc.actions, 0);
      const wouldRun = isRule ? (triggerMatches !== false) && (condition ? condition.result : true) : true;
      return { name: "label" in doc ? doc.label : doc.name, trigger: isRule ? describeTrigger(doc.trigger) : "button", triggerMatches, condition, wouldRun, steps, warnings };
    },
    cancelAll(): number {
      const n = active.size;
      for (const c of active.values()) c.abort();
      for (const t of timers) clearTimeout(t);
      timers.clear();
      return n;
    },
    setPaused(v: boolean) { paused = v; d.store.put("automation", { id: "main", paused: v }); if (v) api.cancelAll(); },
    status: () => ({ paused, running: active.size, pausedUntil: pausedUntil > d.now() ? pausedUntil : null, rules: rules().length, limits: { maxDepth: MAX_DEPTH, maxRunsPerSecond: MAX_RPS, maxQueuedPerRule: MAX_QUEUE, logSize: LOG_SIZE } }),
    log: (n = 100) => ring.slice(-n).reverse(),
    facts, describeTrigger,
    forget(id: string) { for (const m of [lastRun, edge, clockPrev, timerAt]) m.delete(id); },
    resetPause() { pausedUntil = 0; stamps = []; },
  };
  return api;
}
export type Runner = ReturnType<typeof createRunner>;
