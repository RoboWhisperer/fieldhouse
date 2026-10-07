// Connector documents (docs kind "connector") and their drivers. The secret (Singular app token, API key) is write-only:
// it is stored, used for requests, and never returned by the API, written to a log or included in an error message.
import { newId } from "../../data";
import type { Store } from "../../store";
import { GfxError } from "../error";
import type { ConnectorDoc, ConnectorKind, ConnectorView } from "../types";
import { AmcpDriver, type AmcpConfig } from "./amcp";
import { HttpDriver, validateHttpConfig } from "./http";
import { SingularDriver, type SingularConfig } from "./singular";
import { scrub, type ConnDeps, type Driver } from "./types";

const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === "object" && !Array.isArray(x);
const rng = (v: unknown, lo: number, hi: number, what: string, dflt: number) => { if (v === undefined) return dflt; if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) throw new GfxError(400, `${what} must be a number from ${lo} to ${hi}.`); return v; };
const KINDS: ConnectorKind[] = ["singular", "caspar", "http"];

export function validateConfig(kind: ConnectorKind, c: any): Record<string, unknown> {
  c = isObj(c) ? c : {};
  try {
    if (kind === "singular") return { ratePerSecond: rng(c.ratePerSecond, 0.2, 50, "Updates per second", 5), retries: Math.round(rng(c.retries, 0, 10, "Retries", 5)) } satisfies SingularConfig;
    if (kind === "http") return validateHttpConfig(c) as Record<string, unknown>;
    const host = String(c.host ?? "127.0.0.1").trim();
    if (!/^[\w.\-]{1,100}$/.test(host)) throw new GfxError(400, "The CasparCG host must be a name or IP address.");
    const tpl = String(c.template ?? "").trim();
    if (tpl.length > 200 || /["\r\n]/.test(tpl)) throw new GfxError(400, "The template path is not valid.");
    if (!["xml", "json", undefined].includes(c.dataFormat)) throw new GfxError(400, "The data format must be xml or json.");
    if (!["stop", "remove", "clear", undefined].includes(c.hideMode)) throw new GfxError(400, "Hide must be stop, remove or clear.");
    return { host, port: Math.round(rng(c.port, 1, 65535, "The port", 5250)), channel: Math.round(rng(c.channel, 1, 999, "The channel", 1)), layer: Math.round(rng(c.layer, 0, 9999, "The video layer", 10)),
      cgLayer: Math.round(rng(c.cgLayer, 0, 999, "The CG layer", 1)), template: tpl, dataFormat: c.dataFormat ?? "xml", playOnLoad: c.playOnLoad !== false, hideMode: c.hideMode ?? "stop" } satisfies AmcpConfig;
  } catch (e: any) { throw e instanceof GfxError ? e : new GfxError(400, e.message); }
}

export class Connectors {
  private drivers = new Map<string, { at: number; d: Driver }>();
  private status = new Map<string, { ok: boolean | null; message: string; at: number }>();
  constructor(private store: Store, private deps: Omit<ConnDeps, "status" | "problem"> & { notify: (m: string) => void }, private now = Date.now) {}

  view(c: ConnectorDoc): ConnectorView { const { secret, ...rest } = c; return { ...rest, secretSet: !!secret, status: this.status.get(c.id) ?? { ok: null, message: "Not used yet.", at: 0 } }; }
  all() { return this.store.list<ConnectorDoc>("connector"); }
  list() { return this.all().map((c) => this.view(c)); }
  get(id: string) { return this.store.get<ConnectorDoc>("connector", id); }

  save(input: any, id?: string): ConnectorView {
    if (!isObj(input)) throw new GfxError(400, "A connector must be an object.");
    const cur = id ? this.get(id) : undefined; if (id && !cur) throw new GfxError(404, "Connector not found.");
    const kind = cur?.kind ?? input.kind; if (!KINDS.includes(kind)) throw new GfxError(400, `The connector type must be one of: ${KINDS.join(", ")}.`);
    const name = String(input.name ?? cur?.name ?? "").trim(); if (!name || name.length > 60) throw new GfxError(400, "Give the connector a name (up to 60 characters).");
    let secret = cur?.secret;
    if (input.clearSecret === true) secret = undefined;
    if (typeof input.secret === "string" && input.secret.trim()) { secret = input.secret.trim(); if (secret.length > 500 || /[\r\n]/.test(secret)) throw new GfxError(400, "That secret is not valid."); }
    const now = this.now();
    const doc: ConnectorDoc = { id: cur?.id ?? newId("conn"), name, kind, enabled: input.enabled !== undefined ? input.enabled !== false : cur?.enabled ?? true, config: validateConfig(kind, input.config ?? cur?.config), secret, createdAt: cur?.createdAt ?? now, updatedAt: now };
    this.drivers.get(doc.id)?.d.close(); this.drivers.delete(doc.id);
    this.store.put("connector", doc);
    return this.view(doc);
  }
  remove(id: string) { this.drivers.get(id)?.d.close(); this.drivers.delete(id); this.store.del("connector", id); this.status.delete(id); }

  driver(id: string): Driver {
    const c = this.get(id); if (!c) throw new GfxError(404, "That connector no longer exists. Pick another one for this graphic.");
    if (!c.enabled) throw new GfxError(409, `The connector "${c.name}" is turned off.`);
    const hit = this.drivers.get(id); if (hit && hit.at === c.updatedAt) return hit.d;
    hit?.d.close();
    const d: ConnDeps = { ...this.deps, status: (ok, message) => this.status.set(id, { ok, message: scrub(message, c.secret), at: this.now() }),
      problem: (m) => this.deps.notify(`${c.name}: ${scrub(m, c.secret)}`), log: (l, m) => this.deps.log(l, `${c.name}: ${scrub(m, c.secret)}`) };
    if (c.kind !== "http" && c.kind !== "caspar" && !c.secret) throw new GfxError(409, `The connector "${c.name}" needs its app token.`);
    const drv = c.kind === "singular" ? new SingularDriver(c.secret!, c.config as SingularConfig, d) : c.kind === "caspar" ? new AmcpDriver(c.config as AmcpConfig, d) : new HttpDriver(c.config, c.secret, d);
    this.drivers.set(id, { at: c.updatedAt, d: drv });
    return drv;
  }
  async test(id: string) {
    const c = this.get(id); if (!c) throw new GfxError(404, "Connector not found.");
    let r; try { r = await this.driver(id).test(); } catch (e: any) { r = { ok: false, message: scrub(e.message, c.secret) }; }
    this.status.set(id, { ok: r.ok, message: r.message, at: this.now() });
    return r;
  }
  async model(id: string) {
    const c = this.get(id); if (!c) throw new GfxError(404, "Connector not found.");
    const d = this.driver(id); if (!d.model) throw new GfxError(400, "This connector type cannot list its graphics. Type the names in by hand.");
    try { return await d.model(); } catch (e: any) { throw new GfxError(502, scrub(e.message, c.secret)); }
  }
  close() { for (const { d } of this.drivers.values()) d.close(); this.drivers.clear(); }
}
