// What is on air, as a small state machine with no timers of its own: auto-hide and the "stopping" hold are decided from
// timestamps, so tests drive it with a fake clock and the app only needs one wake-up at `nextDeadline`.
interface Entry { on: boolean; seq: number; nextSeq: number; hideAt?: number; hiddenAt?: number; holdMs: number; fields: Record<string, string> }

export class OnAir {
  private m = new Map<string, Entry>();
  constructor(private now: () => number) {}
  private e(id: string): Entry { let x = this.m.get(id); if (!x) this.m.set(id, x = { on: false, seq: 0, nextSeq: 0, holdMs: 0, fields: {} }); return x; }
  private settle(x: Entry) { const t = this.now(); if (x.on && x.hideAt !== undefined && t >= x.hideAt) { x.on = false; x.hiddenAt = x.hideAt; x.hideAt = undefined; } }

  isOn(id: string) { const x = this.m.get(id); if (!x) return false; this.settle(x); return x.on; }
  /** on: drawn and active. stopping: hidden a moment ago but still drawn so a template can play its own exit. off: not drawn. */
  phase(id: string): "on" | "stopping" | "off" {
    const x = this.m.get(id); if (!x) return "off";
    this.settle(x);
    if (x.on) return "on";
    return x.hiddenAt !== undefined && this.now() < x.hiddenAt + x.holdMs ? "stopping" : "off";
  }
  seq(id: string) { return this.m.get(id)?.seq ?? 0; }
  nextSeq(id: string) { return this.m.get(id)?.nextSeq ?? 0; }
  overrides(id: string) { return this.m.get(id)?.fields ?? {}; }
  /** Show (or keep showing) with optional field values; `seconds` hides it again by itself. */
  show(id: string, o: { fields?: Record<string, string>; seconds?: number; holdMs?: number } = {}) {
    const x = this.e(id); this.settle(x);
    if (!x.on) { x.on = true; x.seq++; x.hiddenAt = undefined; x.fields = {}; }
    if (o.holdMs !== undefined) x.holdMs = o.holdMs;
    if (o.fields) Object.assign(x.fields, o.fields);
    x.hideAt = o.seconds ? this.now() + o.seconds * 1000 : undefined;
  }
  hide(id: string, holdMs?: number) { const x = this.e(id); this.settle(x); if (!x.on) return; x.on = false; x.hideAt = undefined; x.hiddenAt = this.now(); if (holdMs !== undefined) x.holdMs = holdMs; }
  /** When an auto-hide will happen (ms epoch), or null. */
  until(id: string) { const x = this.m.get(id); return x?.on && x.hideAt !== undefined ? x.hideAt : null; }
  update(id: string, fields: Record<string, string>) { Object.assign(this.e(id).fields, fields); }
  next(id: string) { this.e(id).nextSeq++; }
  /** Earliest moment something changes by itself (an auto-hide, or the end of a stopping hold), or null. */
  nextDeadline(): number | null {
    let best: number | null = null; const t = this.now();
    for (const x of this.m.values()) {
      const c = x.on && x.hideAt !== undefined ? x.hideAt : !x.on && x.hiddenAt !== undefined && t < x.hiddenAt + x.holdMs ? x.hiddenAt + x.holdMs : null;
      if (c !== null && (best === null || c < best)) best = c;
    }
    return best;
  }
  ids() { return [...this.m.keys()]; }
}
