// Checks a stream destination from Fieldhouse itself BEFORE OBS is asked to stream. OBS answers a failed connect with its own
// modal "Failed to connect to server" window on the desktop, so StartStream must only ever be called for an address that
// already accepted a TCP connection. Used by the go-live flow, ObsEngine.startStream, the destination Test button and Preflight.
import { lookup } from "node:dns/promises";
import { connect } from "node:net";

export interface DestCheck { ok: boolean; message: string; host?: string; port?: number }
export interface DestDeps { resolve?: (host: string) => Promise<unknown>; tcp?: (host: string, port: number, ms: number) => Promise<boolean> }

const DEFAULT_PORT: Record<string, number> = { "rtmp:": 1935, "rtmps:": 443 };

/** Parse and format-check; no network. SRT is UDP, so a format check is all that can be done honestly. */
export function parseDestination(url: string): { ok: true; scheme: string; host: string; port: number; udp: boolean } | { ok: false; message: string } {
  const text = String(url ?? "").trim();
  if (!text) return { ok: false, message: "Add a server address first." };
  let u: URL;
  try { u = new URL(text); } catch { return { ok: false, message: "That server address is not valid. It should look like rtmp://a.rtmp.youtube.com/live2." }; }
  if (!["rtmp:", "rtmps:", "srt:"].includes(u.protocol)) return { ok: false, message: `Fieldhouse can stream to rtmp://, rtmps:// or srt:// addresses, not ${u.protocol}//.` };
  if (!u.hostname) return { ok: false, message: "The server address has no host name." };
  const udp = u.protocol === "srt:";
  const port = u.port ? Number(u.port) : DEFAULT_PORT[u.protocol];
  if (!port) return { ok: false, message: "An srt:// address needs a port, for example srt://example.com:9000." };
  if (!(port >= 1 && port <= 65535)) return { ok: false, message: "The port in the server address must be between 1 and 65535." };
  return { ok: true, scheme: u.protocol.slice(0, -1), host: u.hostname.replace(/^\[|\]$/g, ""), port, udp };
}

export const tcpConnect = (host: string, port: number, ms: number) => new Promise<boolean>((done) => {
  const s = connect({ host, port });
  const end = (ok: boolean) => { clearTimeout(t); s.destroy(); done(ok); };
  const t = setTimeout(() => end(false), ms);
  s.once("connect", () => end(true));
  s.once("error", () => end(false));
});

const withTimeout = <T>(p: Promise<T>, ms: number) => new Promise<T>((ok, no) => { const t = setTimeout(() => no(new Error("timeout")), ms); p.then((v) => { clearTimeout(t); ok(v); }, (e) => { clearTimeout(t); no(e); }); });

export async function checkDestination(url: string, o: { timeoutMs?: number } & DestDeps = {}): Promise<DestCheck> {
  const p = parseDestination(url);
  if (!p.ok) return { ok: false, message: p.message };
  const ms = o.timeoutMs ?? 3000;
  const where = { host: p.host, port: p.port };
  if (p.udp) return { ok: true, ...where, message: "The SRT address looks right. SRT can only be tried when you go live." };
  try { await withTimeout((o.resolve ?? ((h) => lookup(h)))(p.host), ms); }
  catch { return { ok: false, ...where, message: `Could not find ${p.host}. Check the address and the internet connection.` }; }
  const reached = await (o.tcp ?? tcpConnect)(p.host, p.port, ms);
  return reached ? { ok: true, ...where, message: `${p.host} answered. The stream key is checked when you go live.` }
    : { ok: false, ...where, message: `${p.host} did not answer on port ${p.port}. Check the address, the Wi-Fi, and that the receiving service is running.` };
}
