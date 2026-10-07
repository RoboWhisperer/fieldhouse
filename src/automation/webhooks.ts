// Outbound webhook subscriptions (docs kind "webhook"): every matching bus event is POSTed as JSON, optionally signed, with retries.
//   Headers: X-Fieldhouse-Event, X-Fieldhouse-Delivery, and when a secret is set X-Fieldhouse-Timestamp + X-Fieldhouse-Signature: sha256=<hex of HMAC-SHA256(secret, "<timestamp>.<body>")>
import { createHmac } from "node:crypto";
import { newId } from "../data";
import type { Store } from "../store";
import { send, target } from "./http";
import { matches, type Bus, type BusMsg } from "./bus";
import { stripUrl } from "./model";

export interface WebhookDoc { id: string; name: string; url: string; events: string[]; secret?: string; enabled: boolean; createdAt: number }
export interface Delivery { id: string; webhookId: string; name: string; event: string; at: number; attempts: number; status: "ok" | "retrying" | "failed"; code?: number; message: string }
export class WebhookError extends Error {}
export const BACKOFF_MS = [1000, 5000, 30000]; // retries after the first failed try
const MAX_HOOKS = 20, MAX_QUEUE = 100;

export const sign = (secret: string, ts: number, body: string) => "sha256=" + createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
export const webhookView = ({ secret, ...w }: WebhookDoc) => ({ ...w, secretSet: !!secret });
export function parseWebhook(b: any, prev?: WebhookDoc, now = Date.now()): WebhookDoc {
  if (!b || typeof b !== "object" || Array.isArray(b)) throw new WebhookError("A webhook must be an object.");
  const s = (v: unknown, max: number, what: string) => { if (typeof v !== "string" || !v.trim() || v.length > max || /[\u0000-\u001f]/.test(v)) throw new WebhookError(`${what} is required (up to ${max} characters).`); return v.trim(); };
  const url = s(b.url ?? prev?.url, 1000, "The web address");
  try { const u = new URL(url); if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) throw 0; } catch { throw new WebhookError("The web address must start with http:// or https:// and must not contain a user name or password."); }
  const events = b.events ?? prev?.events ?? ["*"];
  if (!Array.isArray(events) || !events.length || events.length > 20 || events.some((e: unknown) => typeof e !== "string" || !/^(\*|[a-z][a-z0-9_.\-]*(\.\*)?)$/i.test(e) || e.length > 60)) throw new WebhookError('Events must be a list such as ["game.score","engine.*"] or ["*"].');
  const w: WebhookDoc = { id: prev?.id ?? newId("hook"), name: s(b.name ?? prev?.name, 60, "The name"), url, events, enabled: b.enabled === undefined ? prev?.enabled ?? true : b.enabled === true, createdAt: prev?.createdAt ?? now };
  const secret = b.secret === undefined ? prev?.secret : b.secret; // write-only: "" removes it
  if (secret) { if (typeof secret !== "string" || secret.length < 8 || secret.length > 200) throw new WebhookError("The signing secret must be 8 to 200 characters."); w.secret = secret; }
  return w;
}

export function createWebhooks(d: { store: Store; bus: Bus; now: () => number; fetch: () => typeof fetch; sleep?: (ms: number) => Promise<void>; log: (level: "INFO" | "WARN" | "ERROR", m: string) => void }) {
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref?.()));
  const deliveries: Delivery[] = [];
  const chains = new Map<string, { p: Promise<void>; n: number }>();
  const list = () => d.store.list<WebhookDoc>("webhook");
  const note = (x: Delivery) => { const i = deliveries.findIndex((y) => y.id === x.id); if (i < 0) { deliveries.push(x); if (deliveries.length > 200) deliveries.shift(); } };

  async function deliver(w: WebhookDoc, m: BusMsg, retries = BACKOFF_MS): Promise<Delivery> {
    const id = newId("dlv"), body = JSON.stringify({ id, version: 1, event: m.event, at: m.at, data: m.data });
    const rec: Delivery = { id, webhookId: w.id, name: w.name, event: m.event, at: m.at, attempts: 0, status: "retrying", message: "Waiting to send" };
    note(rec);
    for (let i = 0; ; i++) {
      const ts = Math.floor(d.now() / 1000);
      const headers: Record<string, string> = { "content-type": "application/json", "x-fieldhouse-event": m.event, "x-fieldhouse-delivery": id };
      if (w.secret) { headers["x-fieldhouse-timestamp"] = String(ts); headers["x-fieldhouse-signature"] = sign(w.secret, ts, body); }
      const r = await send(d.fetch(), { method: "POST", url: w.url, headers, body });
      rec.attempts = i + 1; rec.code = r.status || undefined; rec.message = r.message;
      if (r.ok) { rec.status = "ok"; return rec; }
      const retryable = r.status === 0 || r.status >= 500 || r.status === 429 || r.status === 408;
      const still = d.store.get<WebhookDoc>("webhook", w.id);
      if (!retryable || i >= retries.length || !still?.enabled) { rec.status = "failed"; d.log("WARN", `Webhook "${w.name}": ${r.message}; gave up after ${rec.attempts} ${rec.attempts === 1 ? "try" : "tries"}`); return rec; }
      rec.status = "retrying"; await sleep(retries[i]);
    }
  }

  const off = d.bus.subscribe((m) => {
    for (const w of list()) {
      if (!w.enabled || !matches(w.events, m.event)) continue;
      const c = chains.get(w.id) ?? { p: Promise.resolve(), n: 0 };
      if (c.n >= MAX_QUEUE) { d.log("WARN", `Webhook "${w.name}" is too far behind; dropped an event`); continue; }
      c.n++; c.p = c.p.then(() => deliver(w, m)).then(() => {}, () => {}).finally(() => { c.n--; });
      chains.set(w.id, c);
    }
  });

  return {
    list: () => list().map(webhookView),
    save(body: unknown, id?: string) {
      const prev = id ? d.store.get<WebhookDoc>("webhook", id) : undefined;
      if (id && !prev) throw new WebhookError("Webhook not found.");
      if (!prev && list().length >= MAX_HOOKS) throw new WebhookError(`You can have at most ${MAX_HOOKS} webhooks.`);
      const w = parseWebhook(body, prev, d.now());
      d.store.put("webhook", w); return webhookView(w);
    },
    remove: (id: string) => d.store.del("webhook", id),
    /** Send one test.ping right now, single try, and say how it went. */
    async test(id: string) {
      const w = d.store.get<WebhookDoc>("webhook", id); if (!w) throw new WebhookError("Webhook not found.");
      const r = await deliver(w, { id: 0, event: "test.ping", at: d.now(), data: { message: "Hello from Fieldhouse" } }, []);
      return { ok: r.status === "ok", code: r.code ?? null, message: r.message };
    },
    deliveries: (n = 50) => deliveries.slice(-n).reverse(),
    idle: () => Promise.all([...chains.values()].map((c) => c.p)).then(() => {}),
    deliver, stop: off,
    /** Export shape: no secret, no query string in the address. */
    exportable: () => list().map(({ secret: _s, id: _i, createdAt: _c, ...w }) => ({ ...w, url: stripUrl(w.url) })),
    target,
  };
}
export type Webhooks = ReturnType<typeof createWebhooks>;
