// Rules, macros and their actions: the shapes stored in the docs store (kinds "rule" and "macro") and the validators that guard them.
// Every validator throws ModelError with a plain-language sentence; nothing here touches the outside world.
import { newId } from "../data";
import { checkExpr } from "./expr";

export class ModelError extends Error {}
const fail = (m: string): never => { throw new ModelError(m); };
const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === "object" && !Array.isArray(x);

export const GAME_EVENTS = ["game.start", "game.end", "clock.start", "clock.stop", "clock.set", "period.set", "score", "foul", "timeout", "counter", "mark", "undo"] as const;
export const ENGINE_EVENTS = ["stream.live", "stream.reconnecting", "stream.stopped", "record.started", "record.stopped", "source.dropped", "source.back", "replay.finished"] as const;
export const ACTION_TYPES = ["graphic", "custom.set", "custom.clear", "engine", "sponsor.fire", "event", "http", "wait", "notice", "log", "macro"] as const;
export const HIDDEN = "[hidden]"; // what the API shows instead of a header value; sending it back keeps the stored value
export const LIMITS = { actions: 30, name: 60, url: 1000, body: 4000, text: 500, header: 1000, headers: 10, waitMax: 300, rules: 200, macros: 100 };

export type Action = { type: (typeof ACTION_TYPES)[number]; label?: string; continueOnError?: boolean } & Record<string, any>;
export type Trigger =
  | { type: "event"; event: (typeof GAME_EVENTS)[number]; team?: "home" | "away"; points?: number[]; period?: number }
  | { type: "state"; when: string }
  | { type: "clock"; atSec: number; period?: number }
  | { type: "timer"; everySec: number }
  | { type: "after"; ruleId: string; afterSec: number }
  | { type: "engine"; event: (typeof ENGINE_EVENTS)[number]; sourceId?: string }
  | { type: "sponsor"; sponsorId?: string }
  | { type: "manual"; name: string };
export interface RuleDoc { id: string; name: string; enabled: boolean; priority: number; trigger: Trigger; when?: string; cooldownSec: number; once?: "game" | "period"; actions: Action[]; note?: string; updatedAt: number }
export interface MacroDoc { id: string; label: string; color: string; icon: string; hotkey?: string; description?: string; actions: Action[]; updatedAt: number }

// ---------------------------------------------------------------- small checks
const text = (v: unknown, max: number, what: string, opt = false): string => {
  if (v === undefined || v === null || v === "") { if (opt) return ""; fail(`${what} is required.`); }
  if (typeof v !== "string") fail(`${what} must be text.`);
  if ((v as string).length > max) fail(`${what} can be at most ${max} characters.`);
  if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(v as string)) fail(`${what} cannot contain control characters.`);
  return v as string;
};
const oneLine = (v: unknown, max: number, what: string, opt = false) => { const s = text(v, max, what, opt); if (/[\r\n]/.test(s)) fail(`${what} must be on one line.`); return s; };
const num = (v: unknown, lo: number, hi: number, what: string): number => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : fail(`${what} must be a number from ${lo} to ${hi}.`));
const oneOf = <T extends string>(v: unknown, list: readonly T[], what: string): T => (list.includes(v as T) ? (v as T) : fail(`${what} must be one of: ${list.join(", ")}.`));
/** {{name}} and {{name|filter}} only; anything else with braces is a typo worth catching at save time. */
export function checkTemplate(s: string, what: string) {
  if (/\{\{|\}\}/.test(s.replace(/\{\{\s*[A-Za-z_][A-Za-z0-9_.]*\s*(?:\|\s*(?:upper|lower|json|url)\s*)?\}\}/g, ""))) fail(`${what} has a broken {{placeholder}}. Use {{name}} such as {{home.score}}.`);
}
const tpl = (v: unknown, max: number, what: string, opt = false) => { const s = text(v, max, what, opt); checkTemplate(s, what); return s; };

// ---------------------------------------------------------------- triggers
export function parseTrigger(t: unknown): Trigger {
  if (!isObj(t)) return fail("Choose when this should run (a trigger).");
  switch (t.type) {
    case "event": {
      const o: any = { type: "event", event: oneOf(t.event, GAME_EVENTS, "The game event") };
      if (t.team !== undefined) o.team = oneOf(t.team, ["home", "away"] as const, "The team");
      if (t.points !== undefined) { if (!Array.isArray(t.points) || !t.points.length || t.points.some((p: unknown) => ![1, 2, 3].includes(p as number))) fail("Points must be a list of 1, 2 or 3."); o.points = [...new Set<number>(t.points)]; }
      if (t.period !== undefined) o.period = num(t.period, 1, 9, "The period");
      return o;
    }
    case "state": return { type: "state", when: expr(t.when, "The state condition") };
    case "clock": return { type: "clock", atSec: num(t.atSec, 0, 3600, "The clock time (seconds left)"), ...(t.period !== undefined ? { period: num(t.period, 1, 9, "The period") } : {}) };
    case "timer": return { type: "timer", everySec: num(t.everySec, 1, 86400, "The timer interval (seconds)") };
    case "after": return { type: "after", ruleId: oneLine(t.ruleId, 80, "The other rule"), afterSec: num(t.afterSec, 0, 86400, "The delay (seconds)") };
    case "engine": return { type: "engine", event: oneOf(t.event, ENGINE_EVENTS, "The video event"), ...(t.sourceId ? { sourceId: oneLine(t.sourceId, 80, "The source") } : {}) };
    case "sponsor": return { type: "sponsor", ...(t.sponsorId ? { sponsorId: oneLine(t.sponsorId, 80, "The sponsor") } : {}) };
    case "manual": { const name = oneLine(t.name, 60, "The trigger name"); if (!/^[A-Za-z0-9 _.\-]+$/.test(name)) fail("A trigger name can use letters, digits, spaces, dots, dashes and underscores."); return { type: "manual", name }; }
    default: return fail("Unknown trigger type. Use event, state, clock, timer, after, engine, sponsor or manual.");
  }
}
function expr(v: unknown, what: string): string {
  const s = text(v, 300, what);
  const err = checkExpr(s);
  return err ? fail(`${what}: ${err}`) : s;
}

// ---------------------------------------------------------------- actions
const hostOk = (url: string) => { try { const u = new URL(url.replace(/\{\{[^}]*\}\}/g, "x")); return (u.protocol === "http:" || u.protocol === "https:") && !u.username && !u.password; } catch { return false; } };
const headerName = (n: string) => /^[A-Za-z0-9\-_]{1,60}$/.test(n);

export function parseAction(a: unknown, where = "Action"): Action {
  if (!isObj(a)) return fail(`${where} must be an object.`);
  const type = oneOf(a.type, ACTION_TYPES, `${where} type`);
  const base: Action = { type, ...(a.label ? { label: oneLine(a.label, LIMITS.name, "The label") } : {}), ...(a.continueOnError ? { continueOnError: true } : {}) };
  try {
    switch (type) {
      case "graphic": {
        const op = oneOf(a.op, ["show", "hide", "toggle", "update", "next", "clear"] as const, "The graphic operation");
        const o: Action = { ...base, op };
        if (op !== "clear") o.id = oneLine(a.id, 80, "The graphic");
        if (a.fields !== undefined) {
          if (!isObj(a.fields) || Object.keys(a.fields).length > 30) fail("Graphic fields must be an object with at most 30 entries.");
          o.fields = Object.fromEntries(Object.entries(a.fields).map(([k, v]) => [oneLine(k, 40, "A field name"), tpl(v, LIMITS.text, `Field "${k}"`, true)]));
        }
        if ((op === "update") && !o.fields) fail("An update needs the fields to change.");
        return o;
      }
      case "custom.set": return { ...base, key: oneLine(a.key, 40, "The custom field name"), value: tpl(a.value ?? "", LIMITS.text, "The value", true) };
      case "custom.clear": return { ...base, key: oneLine(a.key, 40, "The custom field name") };
      case "engine": {
        const op = oneOf(a.op, ["preview", "cut", "fade", "replay", "replay.stop", "mute"] as const, "The video operation");
        const o: Action = { ...base, op };
        if (op === "preview") o.sourceId = tpl(a.sourceId, 80, "The source");
        if (op === "fade" && a.ms !== undefined) o.ms = num(a.ms, 0, 5000, "The fade length (ms)");
        if (op === "replay") { o.secondsBack = a.secondsBack === undefined ? 10 : num(a.secondsBack, 1, 120, "The replay length (seconds)"); o.speed = a.speed === undefined ? 1 : num(a.speed, 0.1, 2, "The replay speed"); }
        if (op === "mute") { o.id = oneLine(a.id, 80, "The audio channel"); if (typeof a.muted !== "boolean") fail("muted must be true or false."); o.muted = a.muted; }
        return o;
      }
      case "sponsor.fire": return { ...base, ...(a.sponsorId ? { sponsorId: oneLine(a.sponsorId, 80, "The sponsor") } : {}), ...(a.outcome ? { outcome: oneOf(a.outcome, ["aired", "skipped", "delayed"] as const, "The outcome") } : {}) };
      case "event": {
        if (!isObj(a.event)) fail("The game event must be an object such as {\"type\":\"mark\",\"note\":\"Great play\"}.");
        const e = a.event, t = typeof e.type === "string" && /^[a-z][a-z.]{0,30}$/.test(e.type) && e.type !== "game.start" ? e.type : fail("The event type must be a game event such as score, foul, timeout, period.set or mark.");
        const out: Record<string, unknown> = { type: t };
        for (const [k, v] of Object.entries(e)) { if (k === "type") continue; if (typeof v === "string") out[k] = tpl(v, 200, `Event field "${k}"`); else if (typeof v === "number" || typeof v === "boolean") out[k] = v; else fail(`Event field "${k}" must be text, a number or true/false.`); }
        return { ...base, event: out };
      }
      case "http": {
        const method = oneOf(a.method ?? "POST", ["GET", "POST", "PUT", "PATCH", "DELETE"] as const, "The method");
        const url = tpl(a.url, LIMITS.url, "The web address");
        if (!hostOk(url)) fail("The web address must start with http:// or https:// and must not contain a user name or password (put secrets in a header).");
        const o: Action = { ...base, method, url };
        const hs = a.headers ?? (Array.isArray(a.headerNames) ? Object.fromEntries(a.headerNames.map((n: unknown) => [n, ""])) : undefined);
        if (hs !== undefined) {
          if (!isObj(hs) || Object.keys(hs).length > LIMITS.headers) fail(`Headers must be an object with at most ${LIMITS.headers} entries.`);
          o.headers = Object.fromEntries(Object.entries(hs).map(([k, v]) => { if (!headerName(k)) fail(`"${k}" is not a valid header name.`); return [k, tpl(v, LIMITS.header, `Header ${k}`, true)]; }));
        }
        if (a.body !== undefined && a.body !== "") { if (method === "GET") fail("A GET request cannot have a body."); o.body = tpl(a.body, LIMITS.body, "The body", true); }
        return o;
      }
      case "wait": return { ...base, seconds: num(a.seconds, 0.1, LIMITS.waitMax, "The wait (seconds)") };
      case "notice": return { ...base, level: a.level === undefined ? "info" : oneOf(a.level, ["info", "warn"] as const, "The notice level"), message: tpl(a.message, LIMITS.text, "The message") };
      case "log": return { ...base, level: a.level === undefined ? "INFO" : oneOf(a.level, ["INFO", "WARN", "ERROR"] as const, "The log level"), message: tpl(a.message, LIMITS.text, "The message") };
      case "macro": return { ...base, macroId: oneLine(a.macroId, 80, "The macro") };
    }
  } catch (e) { if (e instanceof ModelError) throw new ModelError(`${where} (${type}): ${e.message}`); throw e; }
  return base;
}
export function parseActions(list: unknown, what = "actions"): Action[] {
  if (!Array.isArray(list) || !list.length) return fail(`Add at least one action to run (${what}).`);
  if (list.length > LIMITS.actions) fail(`At most ${LIMITS.actions} actions fit in one list. Move some into a macro.`);
  return list.map((a, i) => parseAction(a, `Action ${i + 1}`));
}

/** Keep header values private: the API shows HIDDEN; saving HIDDEN back keeps what was stored (matched by action position and header name). */
export const maskActions = (actions: Action[]): Action[] => actions.map((a) => (a.type === "http" && a.headers ? { ...a, headers: Object.fromEntries(Object.keys(a.headers).map((k) => [k, a.headers[k] === "" ? "" : HIDDEN])) } : a));
/** For devices other than the console: also no address query and no body (they may hold tokens). */
export const maskForRemote = (actions: Action[]): Action[] => maskActions(actions).map((a) => (a.type === "http" ? { ...a, url: a.url.split("?")[0], body: a.body ? HIDDEN : a.body } : a));
export const mergeSecrets = (next: Action[], prev: Action[] | undefined): Action[] => next.map((a, i) => {
  if (a.type !== "http" || !a.headers) return a;
  const old = prev?.[i]?.type === "http" ? prev[i].headers ?? {} : {};
  return { ...a, headers: Object.fromEntries(Object.entries(a.headers).map(([k, v]) => [k, v === HIDDEN ? old[k] ?? "" : v])) };
});
/** For export: no header values, no query strings or credentials in addresses. */
export const stripSecrets = (actions: Action[]): Action[] => actions.map((a) => {
  if (a.type !== "http") return a;
  const { headers, ...rest } = a;
  return { ...rest, url: stripUrl(a.url), ...(headers ? { headerNames: Object.keys(headers) } : {}) };
});
export const stripUrl = (u: string) => u.replace(/\?.*$/s, "").replace(/\/\/[^\/@]*@/, "//");

// ---------------------------------------------------------------- rules and macros
const clamp = (v: unknown, lo: number, hi: number, dflt: number, what: string) => (v === undefined ? dflt : Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : fail(`${what} must be a whole number from ${lo} to ${hi}.`));

export function parseRule(b: unknown, prev?: RuleDoc, now = Date.now(), forceId?: string): RuleDoc {
  if (!isObj(b)) return fail("A rule must be an object.");
  const trigger = parseTrigger(b.trigger ?? prev?.trigger);
  const r: RuleDoc = {
    id: prev?.id ?? forceId ?? newId("rule"),
    name: oneLine(b.name ?? prev?.name, LIMITS.name, "The rule name"),
    enabled: b.enabled === undefined ? prev?.enabled ?? true : typeof b.enabled === "boolean" ? b.enabled : fail("enabled must be true or false."),
    priority: clamp(b.priority ?? prev?.priority, 1, 99, 50, "Priority"),
    trigger,
    cooldownSec: b.cooldownSec === undefined ? prev?.cooldownSec ?? 0 : num(b.cooldownSec, 0, 86400, "The cooldown (seconds)"),
    actions: mergeSecrets(parseActions(b.actions ?? prev?.actions), prev?.actions),
    updatedAt: now,
  };
  const when = b.when === undefined ? prev?.when : b.when;
  if (when) r.when = expr(when, "The extra condition");
  const once = b.once === undefined ? prev?.once : b.once;
  if (once) r.once = oneOf(once, ["game", "period"] as const, "'Only once' ");
  if (b.note) r.note = text(b.note, 300, "The note", true);
  if (trigger.type === "after" && trigger.ruleId === r.id) fail("A rule cannot wait on itself.");
  return r;
}
export const ruleView = (r: RuleDoc): RuleDoc => ({ ...r, actions: maskActions(r.actions) });

export const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const KEY_NAMED = /^(Enter|Escape|Tab|Backspace|Delete|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|F([1-9]|1[0-2]))$/;
/** Same syntax as keys() in web/app.js: optional Ctrl+ then Shift+ then one key. Letters are stored upper-case. Alt is not handled by the console. */
export function normHotkey(v: unknown): string {
  const s = oneLine(v, 24, "The hotkey");
  const m = /^((?:Ctrl\+)?)((?:Shift\+)?)(.+)$/.exec(s);
  const key = m ? m[3] : "";
  const k = key.length === 1 ? key.toUpperCase() : key;
  if (!m || !(k.length === 1 && /[A-Z0-9,.\/;'\[\]\-=`]/.test(k) || KEY_NAMED.test(k))) fail("A hotkey looks like F, Shift+F, Ctrl+1 or Ctrl+Shift+F5. Alt is not supported.");
  return m![1] + m![2] + k;
}
export const ICONS = ["play", "stop", "replay", "flag", "bolt", "bell", "star", "tv", "mic", "ball", "sponsor", "link", "clock", "eye", "check", "gear"] as const; // names the UI icon sprite is expected to provide

export function parseMacro(b: unknown, prev?: MacroDoc, now = Date.now(), forceId?: string): MacroDoc {
  if (!isObj(b)) return fail("A macro must be an object.");
  const m: MacroDoc = {
    id: prev?.id ?? forceId ?? newId("macro"),
    label: oneLine(b.label ?? prev?.label, 40, "The macro label"),
    color: b.color === undefined ? prev?.color ?? "#3D8BFD" : typeof b.color === "string" && COLOR_RE.test(b.color) ? b.color : fail("The color must look like #3D8BFD."),
    icon: b.icon === undefined ? prev?.icon ?? "bolt" : oneOf(b.icon, ICONS, "The icon"),
    actions: mergeSecrets(parseActions(b.actions ?? prev?.actions), prev?.actions),
    updatedAt: now,
  };
  const hk = b.hotkey === undefined ? prev?.hotkey : b.hotkey;
  if (hk) m.hotkey = normHotkey(hk);
  if (b.description) m.description = text(b.description, 200, "The description", true);
  return m;
}
export const macroView = (m: MacroDoc): MacroDoc => ({ ...m, actions: maskActions(m.actions) });
