// The one place Fieldhouse sends requests to other tools (rule actions and webhooks): 5 s timeout, redirects are NOT followed,
// and the result never contains the address query, headers or body (they may hold secrets).
export const TIMEOUT_MS = 5000;
/** Added to every request Fieldhouse sends on its own (rules, webhooks, connectors); the console API refuses requests that carry it, so a rule cannot drive the console as the operator. */
export const OUTBOUND = "x-fieldhouse-outbound";
export interface Sent { ok: boolean; status: number; message: string }
/** "example.com/path" without scheme, credentials or query. */
export const target = (url: string) => { try { const u = new URL(url); return u.host + (u.pathname === "/" ? "" : u.pathname); } catch { return "the web address"; } };

export async function send(f: typeof fetch, r: { method: string; url: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal; timeoutMs?: number }): Promise<Sent> {
  const timeout = AbortSignal.timeout(r.timeoutMs ?? TIMEOUT_MS);
  const signal = r.signal ? AbortSignal.any([timeout, r.signal]) : timeout;
  const where = target(r.url);
  try {
    const res = await f(r.url, { method: r.method, headers: { ...r.headers, [OUTBOUND]: "1" }, body: r.body, redirect: "manual", signal });
    try { await res.body?.cancel(); } catch {}
    const ok = res.status >= 200 && res.status < 300;
    return { ok, status: res.status, message: `${r.method} ${where} answered ${res.status}${res.status >= 300 && res.status < 400 ? " (a redirect; Fieldhouse does not follow redirects)" : ""}` };
  } catch (e: any) {
    if (r.signal?.aborted) return { ok: false, status: 0, message: `${r.method} ${where} was cancelled` };
    if (timeout.aborted) return { ok: false, status: 0, message: `${r.method} ${where} did not answer within ${(r.timeoutMs ?? TIMEOUT_MS) / 1000} seconds` };
    return { ok: false, status: 0, message: `${r.method} ${where} could not connect${e?.code ? ` (${e.code})` : ""}` };
  }
}
/** Header values come from templates: drop line breaks so a value can never add a header of its own. */
export const cleanHeader = (v: string) => v.replace(/[\r\n\u0000]+/g, " ").trim();
