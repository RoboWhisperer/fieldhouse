// The built-in graphics, as editable documents with stable ids. "Reset to default" rebuilds one from here.
import type { AnimSpec, FieldDef, GraphicDoc, GraphicRole, GraphicStyle, Placement, ShowPolicy } from "./types";
import { BUILTIN_PARTS } from "./types";

export const builtinDocId = (b: string) => `builtin-${b}`;
export const LEGACY = { scorebug: builtinDocId("scorebug"), lower: builtinDocId("lowerthird"), slate: builtinDocId("slate"), sponsor: builtinDocId("sponsor") };

export const defaultStyle = (): GraphicStyle => ({
  colors: { bg: "#0B1018", panel: "#1A2433", text: "#FFFFFF", muted: "#9FB0C5", accent: "#F5A524", score: "#FFFFFF", scoreText: "#0B1018", clock: "#FFB224", clockOff: "#3A2A0C" },
  radius: 6, shadow: true, fontFamily: "", fontWeight: 800, fontSize: 24, scoreSize: 30, parts: {}, speed: 120,
});
export const fade = (ms = 300): AnimSpec => ({ preset: "fade", durationMs: ms, delayMs: 0, easing: "ease" });
const anim = (preset: AnimSpec["preset"], ms = 400): AnimSpec => ({ preset, durationMs: ms, delayMs: 0, easing: "ease-out" });
const f = (name: string, label: string, def: string, kind: "var" | "const" | "manual" = "manual", value = "", type: FieldDef["type"] = "text"): FieldDef => ({ name, label, type, default: def, binding: { kind, value } });

interface Def { b: string; name: string; description: string; role: GraphicRole; placement: Partial<Placement>; show?: ShowPolicy; fields?: FieldDef[]; requiresGame?: boolean; inn?: AnimSpec; out?: AnimSpec; style?: Partial<GraphicStyle> }
const DEFS: Def[] = [
  { b: "scorebug", name: "Score bug", description: "Teams, score and game clock in the corner.", role: "scorebug", requiresGame: true, show: { mode: "manual", startVisible: true }, placement: { anchor: "bottom-left", x: 64, y: 64, z: 20 } },
  { b: "lowerthird", name: "Lower third", description: "Name and subtitle bar. Hides itself after 8 seconds.", role: "lowerthird", show: { mode: "auto-hide", seconds: 8 }, placement: { anchor: "bottom-left", x: 64, y: 140, z: 30 },
    fields: [f("title", "Title", "Name"), f("sub", "Subtitle", "")] },
  { b: "slate", name: "Slate", description: "Full-screen message such as \"We will be right back\".", role: "fullscreen", show: { mode: "manual" }, placement: { anchor: "center", x: 0, y: 0, z: 60 }, fields: [f("text", "Message", "We will be right back")] },
  { b: "sponsor", name: "Sponsor corner", description: "\"Brought to you by\" box. Shown by sponsor breaks.", role: "corner", show: { mode: "auto-hide", seconds: 8 }, placement: { anchor: "top-right", x: 64, y: 64, z: 40 },
    fields: [f("name", "Sponsor", "Your sponsor"), f("color", "Colour", "#1F7A8C", "manual", "", "color")] },
  { b: "scoreboard", name: "Full scoreboard", description: "Big scoreboard panel with fouls and timeouts.", role: "fullscreen", requiresGame: true, show: { mode: "manual" }, placement: { anchor: "center", x: 0, y: 0, z: 50 }, inn: anim("scale"), out: anim("scale"),
    fields: [f("title", "Heading", "", "var", "game.title")] },
  { b: "ticker", name: "Ticker", description: "Scrolling text along the bottom. Edit the text in Custom data (ticker).", role: "ticker", show: { mode: "manual" }, placement: { anchor: "bottom", x: 0, y: 0, z: 25 }, inn: anim("slide-up"), out: anim("slide-up"),
    fields: [f("text", "Text", "Welcome to the game. Thanks for being here.", "var", "custom.ticker")] },
  { b: "clock", name: "Clock only", description: "Just the game clock.", role: "corner", requiresGame: true, show: { mode: "manual" }, placement: { anchor: "top-left", x: 64, y: 64, z: 20 } },
  { b: "lineup", name: "Lineup card", description: "Starting players of both teams from the rosters.", role: "fullscreen", requiresGame: true, show: { mode: "manual" }, placement: { anchor: "center", x: 0, y: 0, z: 55 },
    fields: [f("title", "Heading", "Starting lineups")] },
  { b: "final", name: "Final / halftime card", description: "Score card for halftime or the final.", role: "fullscreen", requiresGame: true, show: { mode: "manual" }, placement: { anchor: "center", x: 0, y: 0, z: 58 }, inn: anim("scale"), out: anim("scale"),
    fields: [f("label", "Label", "Final")] },
];
/** Parts that exist but start hidden, so the original look is unchanged. */
const OFF_BY_DEFAULT: Record<string, string[]> = { scorebug: ["fouls", "timeouts", "bonus"] };
export const BUILTIN_IDS = DEFS.map((d) => d.b);

export function defaultBuiltin(b: string, now = Date.now()): GraphicDoc {
  const d = DEFS.find((x) => x.b === b);
  if (!d) throw new Error(`Unknown built-in graphic: ${b}`);
  const style = { ...defaultStyle(), ...d.style, parts: Object.fromEntries((BUILTIN_PARTS[b] ?? []).map((p) => [p, !(OFF_BY_DEFAULT[b] ?? []).includes(p)])) };
  if (b === "lowerthird") style.colors.accent = "home"; // the bar takes the home team's colour, as it always did
  return {
    id: builtinDocId(b), name: d.name, description: d.description, enabled: true, role: d.role, kind: "builtin", source: {}, builtinId: b, modified: false,
    placement: { anchor: "center", x: 0, y: 0, scale: 1, z: 10, opacity: 1, ...d.placement }, animation: { in: d.inn ?? fade(), out: d.out ?? fade() },
    show: d.show ?? { mode: "manual" }, requiresGame: !!d.requiresGame, fields: structuredClone(d.fields ?? []), style, createdAt: now, updatedAt: now,
  };
}
