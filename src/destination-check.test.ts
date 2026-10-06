import { expect, test } from "bun:test";
import { createServer } from "node:net";
import { checkDestination, parseDestination, tcpConnect } from "./destination-check";

const listen = () => new Promise<{ port: number; close: () => void }>((ok) => { const s = createServer((c) => c.end()); s.listen(0, "127.0.0.1", () => ok({ port: (s.address() as any).port, close: () => s.close() })); });
const closedPort = async () => { const s = await listen(); s.close(); await Bun.sleep(30); return s.port; };

test("format checks: scheme, host, port", () => {
  expect(parseDestination("rtmp://a.rtmp.youtube.com/live2")).toMatchObject({ ok: true, scheme: "rtmp", host: "a.rtmp.youtube.com", port: 1935, udp: false });
  expect(parseDestination("rtmps://live-api-s.facebook.com:443/rtmp/")).toMatchObject({ ok: true, scheme: "rtmps", port: 443 });
  expect(parseDestination("rtmps://example.com/live")).toMatchObject({ port: 443 });
  expect(parseDestination("srt://example.com:9000")).toMatchObject({ ok: true, udp: true, port: 9000 });
  expect(parseDestination("rtmp://[::1]:1936/live")).toMatchObject({ host: "::1", port: 1936 });
  for (const bad of ["", "   ", "not a url", "http://example.com/live", "ftp://x/y", "file:///etc/passwd", "srt://example.com", "rtmp://example.com:99999/x", "rtmp://:1935/x"]) expect(parseDestination(bad).ok).toBe(false);
  expect((parseDestination("srt://example.com") as any).message).toContain("port");
});

test("a server that accepts a connection passes", async () => {
  const s = await listen();
  const r = await checkDestination(`rtmp://127.0.0.1:${s.port}/live`);
  s.close();
  expect(r).toMatchObject({ ok: true, host: "127.0.0.1", port: s.port });
  expect(r.message).toContain("answered");
});

test("a closed port is refused with a plain message", async () => {
  const port = await closedPort();
  const r = await checkDestination(`rtmp://127.0.0.1:${port}/live`, { timeoutMs: 1000 });
  expect(r.ok).toBe(false);
  expect(r.message).toContain(`did not answer on port ${port}`);
  expect(r.message).not.toMatch(/ECONNREFUSED|errno/i);
});

test("an unresolvable host and a slow resolver are refused", async () => {
  expect((await checkDestination("rtmp://no-such-host.invalid/live", { timeoutMs: 1500 })).message).toContain("Could not find no-such-host.invalid");
  const slow = await checkDestination("rtmp://slow.example/live", { timeoutMs: 100, resolve: () => new Promise(() => {}) });
  expect(slow.ok).toBe(false); expect(slow.message).toContain("Could not find");
});

test("injected network: TCP result decides, resolve is tried first, SRT is format-only", async () => {
  const calls: string[] = [];
  const ok = await checkDestination("rtmps://example.com/live", { resolve: async (h) => { calls.push("dns " + h); }, tcp: async (h, p) => { calls.push(`tcp ${h}:${p}`); return true; } });
  expect(ok.ok).toBe(true); expect(calls).toEqual(["dns example.com", "tcp example.com:443"]);
  const srt = await checkDestination("srt://example.com:9000", { resolve: async () => { throw new Error("must not be called"); }, tcp: async () => { throw new Error("must not be called"); } });
  expect(srt.ok).toBe(true); expect(srt.message).toContain("SRT");
  expect((await checkDestination("rtmp://example.com/live", { resolve: async () => {}, tcp: async () => false })).ok).toBe(false);
});

test("tcpConnect times out on a black hole instead of hanging", async () => {
  const t = Date.now();
  expect(await tcpConnect("10.255.255.1", 1935, 300)).toBe(false);
  expect(Date.now() - t).toBeLessThan(1500);
});
