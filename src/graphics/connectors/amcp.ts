// CasparCG server over AMCP (TCP, default port 5250). Commands end with CRLF; replies start with a 3-digit code:
// 200 = several lines then an empty line, 201 = one data line, 202 = done, 4xx/5xx = error. See docs/dev/graphics-api.md.
import { createConnection, type Socket } from "node:net";
import { casparData } from "../caspar";
import { keyOf, scrub, type ConnDeps, type Driver, type Fields, type TestResult } from "./types";

export interface AmcpConfig { host?: string; port?: number; channel?: number; layer?: number; cgLayer?: number; template?: string; dataFormat?: "xml" | "json"; playOnLoad?: boolean; hideMode?: "stop" | "remove" | "clear"; timeoutMs?: number }
export const amcpString = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r\n|\r|\n/g, "\\n")}"`;

export class AmcpClient {
  private sock?: Socket; private buf = ""; private chain: Promise<unknown> = Promise.resolve();
  private waiter?: (line: string | null) => void; private lines: string[] = [];
  onConnect?: () => void; onDrop?: () => void;
  constructor(private host: string, private port: number, private timeoutMs = 5000) {}
  get connected() { return !!this.sock && !this.sock.destroyed; }

  private connect(): Promise<void> {
    if (this.connected) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = createConnection({ host: this.host, port: this.port });
      const to = setTimeout(() => { s.destroy(); rej(new Error(`CasparCG at ${this.host}:${this.port} did not answer.`)); }, this.timeoutMs);
      s.setEncoding("utf8");
      s.once("connect", () => { clearTimeout(to); this.sock = s; this.buf = ""; this.lines = []; res(); this.onConnect?.(); });
      s.on("data", (d: string) => { this.buf += d; this.pump(); });
      const drop = () => { clearTimeout(to); if (this.sock === s) { this.sock = undefined; this.waiter?.(null); this.waiter = undefined; this.onDrop?.(); } };
      s.on("error", (e) => { clearTimeout(to); if (!this.sock) rej(new Error(`Could not connect to CasparCG at ${this.host}:${this.port} (${(e as any).code ?? e.message}).`)); drop(); });
      s.on("close", drop);
    });
  }
  private pump() { let i: number; while ((i = this.buf.indexOf("\r\n")) >= 0) { this.lines.push(this.buf.slice(0, i)); this.buf = this.buf.slice(i + 2); } this.waiter?.("tick"); }
  private async line(): Promise<string> {
    for (;;) {
      if (this.lines.length) return this.lines.shift()!;
      await new Promise<void>((res, rej) => { const to = setTimeout(() => { this.waiter = undefined; rej(new Error("CasparCG did not answer in time.")); }, this.timeoutMs); this.waiter = (l) => { clearTimeout(to); this.waiter = undefined; l === null ? rej(new Error("The connection to CasparCG was lost.")) : res(); }; });
    }
  }
  /** Send one command and read its whole reply. Commands never overlap. */
  send(cmd: string): Promise<{ code: number; status: string; data: string[] }> {
    const run = async () => {
      await this.connect();
      this.lines = []; this.sock!.write(cmd + "\r\n");
      let first: string; do { first = await this.line(); } while (/^10[01] /.test(first)); // 100/101 are events, not our reply
      const m = /^(\d{3}) ?(.*)$/.exec(first);
      if (!m) throw new Error("CasparCG sent something unexpected.");
      const code = Number(m[1]), data: string[] = [];
      if (code === 201) data.push(await this.line());
      else if (code === 200) for (let l = await this.line(); l !== ""; l = await this.line()) data.push(l);
      return { code, status: m[2], data };
    };
    const p = this.chain.then(run, run); this.chain = p.catch(() => {}); return p;
  }
  close() { this.sock?.destroy(); this.sock = undefined; }
}

export class AmcpDriver implements Driver {
  private c: AmcpClient; private shown = new Map<string, { target: Record<string, any>; fields: Fields }>(); private retry?: ReturnType<typeof setTimeout>; private closed = false; private tries = 0;
  constructor(private cfg: AmcpConfig, private d: ConnDeps) {
    this.c = new AmcpClient(cfg.host || "127.0.0.1", cfg.port || 5250, cfg.timeoutMs ?? 5000);
    this.c.onDrop = () => { d.status(false, "The connection to CasparCG was lost. Fieldhouse is reconnecting."); this.reconnectSoon(); };
  }
  private p(t: Record<string, any>) {
    const ch = Number(t.channel ?? this.cfg.channel ?? 1), layer = Number(t.layer ?? this.cfg.layer ?? 10), cg = Number(t.cgLayer ?? this.cfg.cgLayer ?? 1);
    return { at: `${ch}-${layer}`, cg, template: String(t.template ?? this.cfg.template ?? ""), format: (t.dataFormat ?? this.cfg.dataFormat ?? "xml") as "xml" | "json", play: (t.playOnLoad ?? this.cfg.playOnLoad ?? true) !== false };
  }
  private async cmd(c: string) {
    const r = await this.c.send(c);
    if (r.code >= 400) throw new Error(`CasparCG said no (${r.code} ${r.status}). ${r.code === 404 ? "Check the template path." : r.code === 401 ? "Check the channel number." : ""}`.trim());
    this.d.status(true, "CasparCG accepted the last command."); this.tries = 0;
    return r;
  }
  async show(t: Record<string, any>, fields: Fields) {
    const p = this.p(t); if (!p.template) throw new Error("Enter the CasparCG template path (for example \"fieldhouse/lower-third\").");
    this.shown.set(keyOf(t), { target: t, fields });
    await this.cmd(`CG ${p.at} ADD ${p.cg} ${amcpString(p.template)} ${p.play ? 1 : 0} ${amcpString(casparData(fields, p.format))}`);
    if (!p.play) await this.cmd(`CG ${p.at} PLAY ${p.cg}`);
  }
  async update(t: Record<string, any>, fields: Fields) {
    const p = this.p(t), k = keyOf(t), cur = this.shown.get(k);
    if (!cur) return;
    const changed = Object.fromEntries(Object.entries(fields).filter(([n, v]) => cur.fields[n] !== v));
    if (!Object.keys(changed).length) return;
    cur.fields = { ...cur.fields, ...changed };
    await this.cmd(`CG ${p.at} UPDATE ${p.cg} ${amcpString(casparData(changed, p.format))}`);
  }
  async hide(t: Record<string, any>) {
    const p = this.p(t); this.shown.delete(keyOf(t));
    const mode = this.cfg.hideMode ?? "stop";
    await this.cmd(mode === "clear" ? `CG ${p.at} CLEAR` : `CG ${p.at} ${mode === "remove" ? "REMOVE" : "STOP"} ${p.cg}`);
  }
  async next(t: Record<string, any>) { const p = this.p(t); await this.cmd(`CG ${p.at} NEXT ${p.cg}`); }
  async idle() {}
  /** After a dropped connection: try again with backoff while something is on air, and put it back when the server returns. */
  private reconnectSoon() {
    if (this.closed || this.retry || !this.shown.size) return;
    this.retry = setTimeout(async () => {
      this.retry = undefined; if (this.closed || !this.shown.size) return;
      try { for (const { target, fields } of [...this.shown.values()]) { const p = this.p(target); await this.cmd(`CG ${p.at} ADD ${p.cg} ${amcpString(p.template)} 1 ${amcpString(casparData(fields, p.format))}`); } this.d.log("INFO", "CasparCG connection restored; graphics put back on air."); }
      catch { this.tries++; this.reconnectSoon(); }
    }, Math.min(10000, 1000 * 2 ** Math.min(this.tries, 4)));
    (this.retry as any).unref?.();
  }
  async test(): Promise<TestResult> {
    try { const r = await this.c.send("VERSION"); return r.code < 400 ? { ok: true, message: `Connected to CasparCG ${r.data[0] ?? ""}`.trim() + "." } : { ok: false, message: `CasparCG answered ${r.code}.` }; }
    catch (e: any) { return { ok: false, message: scrub(e?.message ?? String(e)) }; }
  }
  close() { this.closed = true; clearTimeout(this.retry); this.c.close(); }
}
