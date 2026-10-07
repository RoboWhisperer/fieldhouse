// Singular.live / UNO control API. https://developer.singular.live/rest-api
//   PATCH /apiv2/controlapps/<token>/control   body: [{ subCompositionName|subCompositionId, payload?, state? }]  -> 200 {"success":true}
//   GET   /apiv2/controlapps/<token>/control   current states (used by "Test connection": read only)
//   GET   /apiv2/controlapps/<token>/model     sub-compositions and their control nodes (used by the import wizard)
// Sends are queued, merged per sub-composition (only changed fields), rate limited and retried with backoff.
import { keyOf, scrub, type ConnDeps, type Driver, type Fields, type TestResult } from "./types";

export interface SingularConfig { ratePerSecond?: number; retries?: number; backoffMs?: number }
type Ref = { subCompositionName?: string; subCompositionId?: string };
interface Pending { ref: Ref; payload: Record<string, unknown>; state?: string }

/** Field text -> what Singular expects: numbers and checkboxes typed, JSON objects (time control, button) parsed. */
export function singularValue(v: string, type?: string): unknown {
  if (type === "number" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  if (type === "bool") return v === "true" || v === "1";
  if (/^\s*[{[]/.test(v)) { try { return JSON.parse(v); } catch { /* plain text */ } }
  return v;
}

export class SingularDriver implements Driver {
  private q = new Map<string, Pending>();
  private last = new Map<string, Record<string, string>>();
  private timer?: ReturnType<typeof setTimeout>;
  private lastSend = 0; private attempts = 0; private inflight = false; private waiters: (() => void)[] = [];
  private types = new Map<string, string>();
  constructor(private token: string, private cfg: SingularConfig, private d: ConnDeps) {}
  setTypes(t: Record<string, string>) { for (const [k, v] of Object.entries(t)) this.types.set(k, v); }

  private url(tail: string) { return `${this.d.singularBase ?? "https://app.singular.live"}/apiv2/controlapps/${encodeURIComponent(this.token)}/${tail}`; }
  private ref(t: Record<string, any>): Ref {
    if (t.subCompositionId) return { subCompositionId: String(t.subCompositionId) };
    if (t.subCompositionName) return { subCompositionName: String(t.subCompositionName) };
    throw new Error("Pick a sub-composition (by name or id) for this graphic.");
  }
  private enqueue(t: Record<string, any>, payload: Record<string, unknown>, state?: string) {
    const ref = this.ref(t), k = keyOf(ref), cur = this.q.get(k) ?? { ref, payload: {} };
    Object.assign(cur.payload, payload); if (state) cur.state = state; this.q.set(k, cur);
    this.schedule();
  }
  private typed(f: Fields) { return Object.fromEntries(Object.entries(f).map(([k, v]) => [k, singularValue(v, this.types.get(k))])); }
  async show(t: Record<string, any>, fields: Fields) {
    this.ref(t); this.last.set(keyOf(this.ref(t)), { ...fields });
    this.enqueue(t, this.typed(fields), "In");
  }
  async update(t: Record<string, any>, fields: Fields) {
    const k = keyOf(this.ref(t)), was = this.last.get(k) ?? {};
    const changed = Object.fromEntries(Object.entries(fields).filter(([n, v]) => was[n] !== v));
    if (!Object.keys(changed).length) return;
    this.last.set(k, { ...was, ...changed });
    this.enqueue(t, this.typed(changed));
  }
  async hide(t: Record<string, any>) { const out = ["Out", "Out1", "Out2"].includes(t.outState) ? t.outState : "Out"; this.enqueue(t, {}, out); }
  async next() { throw new Error("Singular has no \"next\" step. Use a second sub-composition instead."); }

  private schedule(delay?: number) {
    if (this.timer || this.inflight) return;
    const gap = 1000 / Math.max(0.1, this.cfg.ratePerSecond ?? 5);
    const wait = delay ?? Math.max(0, this.lastSend + gap - Date.now());
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, wait);
    (this.timer as any).unref?.();
  }
  private async flush() {
    if (!this.q.size) return this.settle();
    const batch = [...this.q.values()]; this.q.clear(); this.inflight = true; this.lastSend = Date.now();
    const body = batch.map((p) => ({ ...p.ref, ...(Object.keys(p.payload).length ? { payload: p.payload } : {}), ...(p.state ? { state: p.state } : {}) }));
    let retry = false, msg = "";
    try {
      const r = await this.d.fetch(this.url("control"), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(8000) });
      if (r.ok) { this.attempts = 0; this.d.status(true, "Singular accepted the last update."); }
      else { msg = this.httpMessage(r.status); retry = r.status === 429 || r.status >= 500; }
    } catch (e: any) { msg = "Could not reach Singular. Check the internet connection."; retry = true; this.d.log("WARN", scrub(`Singular request failed: ${e?.message ?? e}`, this.token)); }
    this.inflight = false;
    if (msg) {
      this.d.status(false, msg);
      if (retry && this.attempts < (this.cfg.retries ?? 5)) {
        this.attempts++;
        for (const p of batch) { const cur = this.q.get(keyOf(p.ref)); this.q.set(keyOf(p.ref), cur ? { ref: p.ref, payload: { ...p.payload, ...cur.payload }, state: cur.state ?? p.state } : p); } // newer values win
        this.schedule(Math.min(15000, (this.cfg.backoffMs ?? 500) * 2 ** (this.attempts - 1)));
        return;
      }
      this.attempts = 0; this.last.clear();
      this.d.problem(`${msg} The last change was not sent.`);
    }
    if (this.q.size) this.schedule(); else this.settle();
  }
  private httpMessage(s: number) {
    if (s === 401 || s === 403) return "Singular did not accept the app token. Check it in the connector settings.";
    if (s === 404) return "Singular could not find that control app. Check the app token.";
    if (s === 429) return "Singular is limiting how often this app can be updated (the free plan allows about 25 calls a minute).";
    return `Singular answered with an error (${s}).`;
  }
  private settle() { const w = this.waiters; this.waiters = []; for (const f of w) f(); }
  idle() { return !this.q.size && !this.inflight && !this.timer ? Promise.resolve() : new Promise<void>((r) => this.waiters.push(r)); }
  close() { clearTimeout(this.timer); this.timer = undefined; this.q.clear(); this.settle(); }

  /** Harmless: reads the control state, changes nothing on air. */
  async test(): Promise<TestResult> {
    try {
      const r = await this.d.fetch(this.url("control"), { method: "GET", redirect: "manual", signal: AbortSignal.timeout(8000) });
      if (!r.ok) return { ok: false, message: this.httpMessage(r.status) };
      const j = (await r.json().catch(() => [])) as unknown[];
      return { ok: true, message: `Connected to Singular. The control app has ${Array.isArray(j) ? j.length : 0} sub-composition${j.length === 1 ? "" : "s"}.` };
    } catch (e: any) { return { ok: false, message: scrub(`Could not reach Singular: ${e?.message ?? e}`, this.token) }; }
  }
  /** Sub-compositions with their control nodes, flattened, for the import wizard. */
  async model() {
    const r = await this.d.fetch(this.url("model"), { method: "GET", redirect: "manual", signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(this.httpMessage(r.status));
    const out: { id: string; name: string; state?: string; fields: { id: string; type: string; title: string; defaultValue: unknown }[] }[] = [];
    const walk = (list: any[]) => { for (const c of Array.isArray(list) ? list : []) { out.push({ id: String(c.id), name: String(c.name ?? ""), state: c.state, fields: (c.model ?? []).map((m: any) => ({ id: String(m.id), type: String(m.type ?? "text"), title: String(m.title ?? m.id), defaultValue: m.defaultValue })) }); walk(c.subcompositions); } };
    walk((await r.json()) as any[]);
    return { compositions: out.filter((c) => c.fields.length || c.state) };
  }
}
