// Generic HTTP connector: one request template per action. Templates may use {{variables}}, {{field.<name>}}, {{target.<key>}} and {{secret}}.
// URL parts are URL-encoded, JSON bodies are JSON-escaped, header values lose line breaks. The secret is only ever put into the outgoing request.
import { substitute } from "../vars";
import { scrub, type ConnDeps, type Driver, type Fields, type TestResult } from "./types";

export interface HttpRequestTpl { method?: string; url: string; headers?: Record<string, string>; body?: string; bodyFormat?: "json" | "text" }
export interface HttpConfig { show?: HttpRequestTpl; update?: HttpRequestTpl; hide?: HttpRequestTpl; next?: HttpRequestTpl; testUrl?: string }
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export function validateHttpConfig(c: any): HttpConfig {
  const out: HttpConfig = {};
  for (const a of ["show", "update", "hide", "next"] as const) {
    const r = c?.[a]; if (!r) continue;
    if (typeof r.url !== "string" || !/^https?:\/\//i.test(r.url.trim())) throw new Error(`The ${a} request needs an address starting with http:// or https://.`);
    const method = String(r.method ?? "POST").toUpperCase(); if (!METHODS.includes(method)) throw new Error(`The ${a} method must be one of ${METHODS.join(", ")}.`);
    const headers = Object.fromEntries(Object.entries(r.headers ?? {}).map(([k, v]) => { if (!/^[\w-]{1,60}$/.test(k)) throw new Error(`"${k}" is not a valid header name.`); return [k, String(v).slice(0, 2000)]; }));
    out[a] = { method, url: r.url.trim().slice(0, 2000), headers, body: typeof r.body === "string" ? r.body.slice(0, 20000) : undefined, bodyFormat: r.bodyFormat === "text" ? "text" : "json" };
  }
  if (c?.testUrl) { if (!/^https?:\/\//i.test(String(c.testUrl))) throw new Error("The test address must start with http:// or https://."); out.testUrl = String(c.testUrl).slice(0, 2000); }
  return out;
}

export class HttpDriver implements Driver {
  private fields = new Map<string, Fields>();
  constructor(private cfg: HttpConfig, private secret: string | undefined, private d: ConnDeps) {}
  private async fire(a: "show" | "update" | "hide" | "next", target: Record<string, any>, fields: Fields) {
    const r = this.cfg[a]; if (!r) return; // an action without a request is simply skipped
    const vars: Record<string, string | number | boolean> = { ...this.d.vars(), secret: this.secret ?? "" };
    for (const [k, v] of Object.entries(fields)) vars[`field.${k}`] = v;
    for (const [k, v] of Object.entries(target)) vars[`target.${k}`] = typeof v === "object" ? JSON.stringify(v) : (v as any);
    const headers: Record<string, string> = { "x-fieldhouse-outbound": "1" };
    for (const [k, v] of Object.entries(r.headers ?? {})) headers[k] = substitute(v, vars, "raw").replace(/[\r\n]+/g, " ");
    const body = r.body === undefined || r.method === "GET" ? undefined : substitute(r.body, vars, r.bodyFormat === "text" ? "raw" : "json");
    if (body !== undefined && !Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) headers["content-type"] = r.bodyFormat === "text" ? "text/plain" : "application/json";
    const url = substitute(r.url, vars, "url");
    try {
      const res = await this.d.fetch(url, { method: r.method ?? "POST", headers, body, redirect: "manual", signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`The server answered ${res.status}.`);
      this.d.status(true, `The last ${a} request worked.`);
    } catch (e: any) { const m = scrub(`The ${a} request failed: ${e?.message ?? e}`, this.secret); this.d.status(false, m); throw new Error(m); }
  }
  async show(t: Record<string, any>, f: Fields) { this.fields.set(JSON.stringify(t), { ...f }); await this.fire("show", t, f); }
  async update(t: Record<string, any>, f: Fields) {
    const k = JSON.stringify(t), was = this.fields.get(k) ?? {};
    const changed = Object.fromEntries(Object.entries(f).filter(([n, v]) => was[n] !== v)); if (!Object.keys(changed).length) return;
    this.fields.set(k, { ...was, ...changed }); await this.fire("update", t, f);
  }
  async hide(t: Record<string, any>) { this.fields.delete(JSON.stringify(t)); await this.fire("hide", t, {}); }
  async next(t: Record<string, any>) { await this.fire("next", t, {}); }
  async idle() {}
  /** Only requests the operator listed as the test address (a GET); nothing else is sent. */
  async test(): Promise<TestResult> {
    if (!this.cfg.testUrl) return { ok: true, message: "Nothing to test: add a test address to check the connection without changing anything on air." };
    try { const r = await this.d.fetch(substitute(this.cfg.testUrl, { secret: this.secret ?? "" }, "url"), { method: "GET", headers: { "x-fieldhouse-outbound": "1" }, redirect: "manual", signal: AbortSignal.timeout(8000) }); return { ok: r.ok, message: r.ok ? "The server answered." : `The server answered ${r.status}.` }; }
    catch (e: any) { return { ok: false, message: scrub(`Could not reach the server: ${e?.message ?? e}`, this.secret) }; }
  }
  close() {}
}
