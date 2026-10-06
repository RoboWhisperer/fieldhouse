import type { AiringDoc, SponsorDoc, Trigger } from "./types";
import type { Store } from "./store";
import { newId } from "./data";

const TRIGGERS: Trigger[] = ["pregame", "timeout", "period_end", "halftime", "postgame"];
const MIN = 60_000;

export const seasonUsage = (s: SponsorDoc, airings: AiringDoc[]) => {
  const mine = airings.filter((a) => a.sponsorId === s.id && a.outcome === "aired");
  return { aired: mine.length, left: Math.max(0, s.rules.maxPerSeason - mine.length), seconds: mine.reduce((n, a) => n + a.seconds, 0) };
};

export function nextBreak(sponsors: SponsorDoc[], airings: AiringDoc[], ctx: { gameId: string; now: number; trigger: Trigger }): SponsorDoc | null {
  const eligible = sponsors.filter((s) => {
    if (!s.rules.triggers.includes(ctx.trigger)) return false;
    if (seasonUsage(s, airings).left <= 0) return false;
    const last = Math.max(0, ...airings.filter((a) => a.gameId === ctx.gameId && a.sponsorId === s.id && a.outcome === "aired").map((a) => a.at));
    return !last || ctx.now - last >= s.rules.minGapMinutes * MIN;
  });
  return eligible.sort((a, b) => a.rules.priority - b.rules.priority)[0] ?? null;
}

const byTrigger = (sponsors: SponsorDoc[], t: Trigger) => sponsors.filter((s) => s.rules.triggers.includes(t)).sort((a, b) => a.rules.priority - b.rules.priority);

export function conflicts(sponsors: SponsorDoc[]): { trigger: Trigger; sponsorIds: string[] }[] {
  const out: { trigger: Trigger; sponsorIds: string[] }[] = [];
  for (const trigger of TRIGGERS) {
    const by = new Map<number, string[]>();
    for (const s of byTrigger(sponsors, trigger)) by.set(s.rules.priority, [...(by.get(s.rules.priority) ?? []), s.id]);
    for (const ids of by.values()) if (ids.length > 1) out.push({ trigger, sponsorIds: ids });
  }
  return out;
}

const SLOTS: [string, Trigger][] = [["Pregame", "pregame"], ["Q1 timeout", "timeout"], ["Q2 timeout", "timeout"], ["Halftime", "halftime"], ["Q3 timeout", "timeout"], ["Q4 timeout", "timeout"], ["Postgame", "postgame"]];

// Repeated triggers rotate through eligible sponsors in priority order.
export function planGame(sponsors: SponsorDoc[]) {
  const turn = new Map<Trigger, number>();
  return SLOTS.map(([slot, trigger]) => {
    const c = byTrigger(sponsors, trigger), k = turn.get(trigger) ?? 0;
    turn.set(trigger, k + 1);
    return { slot, trigger, sponsorId: c.length ? c[k % c.length].id : null, conflict: c.length > 1 && c[0].rules.priority === c[1].rules.priority };
  });
}

export const listSponsors = (store: Store) => store.list<SponsorDoc>("sponsor");
export const listAirings = (store: Store) => store.list<AiringDoc>("airing");
export const deleteSponsor = (store: Store, id: string) => store.del("sponsor", id);
export const recordAiring = (store: Store, a: Omit<AiringDoc, "id">): AiringDoc => store.put("airing", { ...a, id: newId("airing") });

export function saveSponsor(store: Store, input: any): SponsorDoc {
  const num = (v: unknown, lo: number, hi: number, what: string) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) throw new Error(`${what} must be between ${lo} and ${hi}`);
    return v;
  };
  if (!input || typeof input !== "object") throw new Error("Sponsor must be an object");
  if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 60) throw new Error("Give the sponsor a name (up to 60 characters)");
  const r = input.rules ?? {};
  if (!Array.isArray(r.triggers) || !r.triggers.length || !r.triggers.every((t: any) => TRIGGERS.includes(t))) throw new Error("Pick at least one place the sponsor can air");
  const assets = input.assets ?? [];
  if (!Array.isArray(assets) || assets.length > 20) throw new Error("A sponsor can have up to 20 assets");
  const s: SponsorDoc = {
    id: typeof input.id === "string" && input.id ? input.id : newId("sponsor"),
    name: input.name.trim(),
    abbr: String(input.abbr || input.name).trim().slice(0, 8).toUpperCase(),
    color: /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : "#888888",
    assets: assets.map((a: any) => {
      if (!["image", "video", "audio"].includes(a?.kind) || typeof a.name !== "string" || !a.name) throw new Error("Each asset needs a kind (image, video, audio) and a name");
      return a.seconds === undefined ? { kind: a.kind, name: a.name } : { kind: a.kind, name: a.name, seconds: num(a.seconds, 0, 600, "Asset length") };
    }),
    displaySeconds: num(input.displaySeconds, 1, 120, "Display length"),
    rules: { triggers: [...new Set<Trigger>(r.triggers)], minGapMinutes: num(r.minGapMinutes, 0, 240, "Minimum gap"), maxPerSeason: num(r.maxPerSeason, 1, 1000, "Season limit"), priority: num(r.priority, 1, 99, "Priority") },
  };
  return store.put("sponsor", s);
}
