// Actions: each one is first PLANNED (templates filled, arguments checked, a plain sentence written) and only then, if this is a real run, PERFORMED.
// Dry-run uses plan() alone, so it cannot have side effects: nothing in plan() calls anything that changes state.
import type { ActionContext, VarMap } from "../custom-types";
import { parseEv } from "../game";
import { cleanHeader, send } from "./http";
import { render } from "./facts";
import type { Action, MacroDoc } from "./model";
import { LIMITS } from "./model";

export interface Env {
  ctx: ActionContext & { custom: ActionContext["custom"] & { check?(k: string, v: string): string | null } };
  facts: VarMap;
  fetch: () => typeof fetch;
  notify: (level: "info" | "warn", message: string) => void;
  macro: (id: string) => MacroDoc | undefined;
  signal?: AbortSignal;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  warnings: string[]; // dry-run: unknown {{variables}}, missing graphics...
}
export interface Planned { text: string; run?: () => Promise<string | void>; sub?: Action[]; subLabel?: string }

const NUMERIC = ["points", "ms", "period", "player", "target", "seq"];
const clip = (s: string, n = 120) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export function plan(a: Action, env: Env): Planned {
  const r = (t: string, all?: string) => { const x = render(t, env.facts, all); for (const m of x.missing) if (!env.warnings.includes(`Unknown variable {{${m}}}`)) env.warnings.push(`Unknown variable {{${m}}} (it will be empty)`); return x.text; };
  const { ctx } = env;
  switch (a.type) {
    case "graphic": {
      if (a.op === "clear") return { text: "take every graphic off air", run: () => ctx.graphics.clear() };
      const id = a.id as string;
      const known = ctx.graphics.list().find((g) => g.id === id || g.name === id);
      if (!known) env.warnings.push(`There is no graphic called "${id}".`);
      const gid = known?.id ?? id, name = known?.name ?? id;
      const fields = a.fields ? Object.fromEntries(Object.entries(a.fields as Record<string, string>).map(([k, v]) => [k, r(v)])) : undefined;
      const g = ctx.graphics;
      const verb = { show: "show", hide: "hide", toggle: "toggle", update: "update", next: "step to the next part of" }[a.op as string];
      const text = `${verb} graphic "${name}"${fields ? ` with ${Object.entries(fields).map(([k, v]) => `${k}="${clip(v, 40)}"`).join(", ")}` : ""}`;
      const run = a.op === "show" ? () => g.show(gid, fields) : a.op === "hide" ? () => g.hide(gid) : a.op === "toggle" ? () => g.toggle(gid) : a.op === "update" ? () => g.update(gid, fields ?? {}) : () => g.next(gid);
      return { text, run };
    }
    case "custom.set": {
      const v = r(a.value ?? "");
      const bad = ctx.custom.check?.(a.key, v);
      if (bad) env.warnings.push(bad);
      return { text: `set custom field "${a.key}" to "${clip(v, 60)}"`, run: async () => ctx.custom.set(a.key, v) };
    }
    case "custom.clear": return { text: `clear custom field "${a.key}"`, run: async () => ctx.custom.set(a.key, "") };
    case "engine": {
      const e = ctx.engine;
      switch (a.op) {
        case "preview": { const s = r(a.sourceId); return { text: `put camera "${s}" in preview`, run: () => e.setPreview(s) }; }
        case "cut": return { text: "cut preview to program", run: () => e.cut() };
        case "fade": { const ms = a.ms ?? 500; return { text: `fade preview to program over ${ms} ms`, run: () => e.fade(ms) }; }
        case "replay": return { text: `play an instant replay (last ${a.secondsBack} s at ${a.speed}x)`, run: () => e.replay({ secondsBack: a.secondsBack, speed: a.speed }) };
        case "replay.stop": return { text: "stop the replay", run: () => e.stopReplay() };
        default: return { text: `${a.muted ? "mute" : "unmute"} audio channel "${a.id}"`, run: () => e.setMute(a.id, a.muted) };
      }
    }
    case "sponsor.fire": return { text: a.sponsorId ? `fire sponsor "${a.sponsorId}"${a.outcome ? ` (${a.outcome})` : ""}` : `fire the sponsor that is due${a.outcome ? ` (${a.outcome})` : ""}`, run: async () => { await ctx.fireSponsor({ sponsorId: a.sponsorId, outcome: a.outcome }); } };
    case "event": {
      const body: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(a.event as Record<string, unknown>)) body[k] = typeof v === "string" ? (NUMERIC.includes(k) && /^-?\d+(\.\d+)?$/.test(r(v)) ? Number(r(v)) : r(v)) : v;
      const bad = body.type === "undo" && body.target === undefined ? null : parseEv(body);
      const err = typeof bad === "string" ? bad : null;
      if (err) env.warnings.push(`The game event would be refused: ${err}`);
      return { text: `add game event ${body.type}${body.team ? " " + body.team : ""}${body.points ? " +" + body.points : ""}${body.note ? ` "${clip(String(body.note), 40)}"` : ""}`, run: async () => { await ctx.event(body); } };
    }
    case "http": {
      const url = r(a.url, "url"), body = a.body ? r(a.body) : undefined;
      const headers = Object.fromEntries(Object.entries((a.headers ?? {}) as Record<string, string>).filter(([, v]) => v !== "").map(([k, v]) => [k, cleanHeader(r(v))]));
      if (body !== undefined && !Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) headers["content-type"] = /^\s*[\[{]/.test(body) ? "application/json" : "text/plain";
      let shown = "the web address";
      try { const u = new URL(url); shown = u.host + (u.pathname === "/" ? "" : u.pathname); } catch { env.warnings.push("The web address is not valid after filling in the variables."); }
      return { text: `send ${a.method} to ${shown}`, run: async () => { const x = await send(env.fetch(), { method: a.method, url, headers, body, signal: env.signal }); if (!x.ok) throw new Error(x.message); return x.message; } };
    }
    case "wait": return { text: `wait ${a.seconds} second${a.seconds === 1 ? "" : "s"}`, run: () => env.sleep(a.seconds * 1000, env.signal) };
    case "notice": { const m = r(a.message).replace(/[\u0000-\u001f]/g, " ").slice(0, LIMITS.text); return { text: `show notice "${clip(m, 60)}"`, run: async () => env.notify(a.level, m) }; }
    case "log": { const m = r(a.message).replace(/[\u0000-\u001f]/g, " ").slice(0, LIMITS.text); return { text: `write to the log: "${clip(m, 60)}"`, run: async () => ctx.log(a.level, "Automation: " + m) }; }
    case "macro": {
      const m = env.macro(a.macroId);
      if (!m) { env.warnings.push(`There is no macro "${a.macroId}".`); return { text: `run macro "${a.macroId}" (not found)`, run: async () => { throw new Error(`Macro "${a.macroId}" does not exist.`); } }; }
      return { text: `run macro "${m.label}"`, sub: m.actions, subLabel: m.label };
    }
  }
  return { text: `unknown action ${(a as any).type}`, run: async () => { throw new Error("Unknown action."); } };
}
