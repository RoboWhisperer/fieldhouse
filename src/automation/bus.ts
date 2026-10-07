// A tiny in-process event bus: game events, engine events, sponsor fires, custom-field changes and named triggers go out on it.
// Webhooks and the read-only event stream (SSE) are subscribers. Names: game.<type>, engine.<event>, sponsor.fired, custom.changed, trigger.<name>.
export interface BusMsg { id: number; event: string; at: number; data: unknown }
export function createBus(now: () => number = Date.now) {
  const subs = new Set<(m: BusMsg) => void>();
  let seq = 0;
  return {
    emit(event: string, data: unknown) { const m: BusMsg = { id: ++seq, event, at: now(), data }; for (const f of [...subs]) { try { f(m); } catch {} } return m; },
    subscribe(f: (m: BusMsg) => void) { subs.add(f); return () => { subs.delete(f); }; },
    size: () => subs.size,
  };
}
export type Bus = ReturnType<typeof createBus>;
/** "*" = everything, "game.*" = a prefix, otherwise an exact name. */
export const matches = (filters: string[], event: string) => filters.some((f) => f === "*" || f === event || (f.endsWith(".*") && event.startsWith(f.slice(0, -1))));

const MAX_STREAMS = 10;
/** Server-sent events: `event: <name>` + `data: <json>`, a comment heartbeat every 5 s (keeps idle timeouts away). Honors ?events=game.*,engine.*  */
export function sseResponse(bus: Bus, q: URLSearchParams, signal?: AbortSignal): Response {
  if (bus.size() > MAX_STREAMS + 10) return Response.json({ error: "Too many event streams are open." }, { status: 429 });
  const filters = (q.get("events") ?? "*").split(",").map((s) => s.trim()).filter(Boolean);
  const enc = new TextEncoder();
  let off = () => {}, beat: ReturnType<typeof setInterval>;
  const stream = new ReadableStream({
    start(c) {
      const put = (s: string) => { try { c.enqueue(enc.encode(s)); } catch {} };
      put(": fieldhouse event stream\nretry: 3000\n\n");
      off = bus.subscribe((m) => { if (matches(filters, m.event)) put(`id: ${m.id}\nevent: ${m.event}\ndata: ${JSON.stringify({ at: m.at, data: m.data })}\n\n`); });
      beat = setInterval(() => put(": keepalive\n\n"), 5000);
      signal?.addEventListener("abort", () => { off(); clearInterval(beat); try { c.close(); } catch {} });
    },
    cancel() { off(); clearInterval(beat); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" } });
}
