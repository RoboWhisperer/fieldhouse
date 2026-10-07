// A machine-readable description of every trigger, action, fact and template filter, so the editor screens can be built from data
// (GET /api/automation/catalog). Keep it in step with model.ts.
import { ACTION_TYPES, ENGINE_EVENTS, GAME_EVENTS, ICONS, LIMITS } from "./model";
import { FILTER_NAMES } from "./facts";
import { PANELS } from "./ui-settings";

type Param = { name: string; label: string; kind: "text" | "number" | "bool" | "select" | "fields" | "headers" | "list" | "expression" | "event"; required?: boolean; options?: readonly (string | number)[]; hint?: string; templated?: boolean };
const p = (name: string, label: string, kind: Param["kind"], extra: Partial<Param> = {}): Param => ({ name, label, kind, ...extra });

export const CATALOG = {
  triggers: [
    { type: "event", label: "A game event happens", params: [p("event", "Event", "select", { required: true, options: GAME_EVENTS }), p("team", "Team", "select", { options: ["home", "away"], hint: "Leave empty for either team" }), p("points", "Points", "list", { options: [1, 2, 3], hint: "score events only" }), p("period", "Period", "number", { hint: "period.set only" })] },
    { type: "state", label: "A situation becomes true", params: [p("when", "Condition", "expression", { required: true, hint: "e.g. clock <= 60000 and period == 4. Fires when it turns from false to true." })] },
    { type: "clock", label: "The game clock reaches a time", params: [p("atSec", "Seconds left", "number", { required: true }), p("period", "Only in period", "number", { hint: "Empty = every period, once each" })] },
    { type: "timer", label: "Every N seconds", params: [p("everySec", "Seconds", "number", { required: true })] },
    { type: "after", label: "N seconds after another rule ran", params: [p("ruleId", "Other rule", "text", { required: true }), p("afterSec", "Seconds", "number", { required: true })] },
    { type: "engine", label: "Something happens to the video", params: [p("event", "Event", "select", { required: true, options: ENGINE_EVENTS }), p("sourceId", "Camera", "text", { hint: "source.dropped / source.back only" })] },
    { type: "sponsor", label: "A sponsor break is fired", params: [p("sponsorId", "Sponsor", "text", { hint: "Empty = any sponsor" })] },
    { type: "manual", label: "A button, hotkey or outside tool asks for it", params: [p("name", "Trigger name", "text", { required: true })] },
  ],
  ruleFields: [p("name", "Name", "text", { required: true }), p("enabled", "On", "bool"), p("priority", "Priority (1 runs first)", "number"), p("when", "Only if", "expression"), p("cooldownSec", "Wait at least (seconds) between runs", "number"), p("once", "Only once per", "select", { options: ["game", "period"] })],
  actions: [
    { type: "graphic", label: "Graphics", params: [p("op", "Do", "select", { required: true, options: ["show", "hide", "toggle", "update", "next", "clear"] }), p("id", "Graphic", "text"), p("fields", "Field values", "fields", { templated: true })] },
    { type: "custom.set", label: "Set a custom field", params: [p("key", "Field", "text", { required: true }), p("value", "Value", "text", { templated: true })] },
    { type: "custom.clear", label: "Reset a custom field", params: [p("key", "Field", "text", { required: true })] },
    { type: "engine", label: "Video", params: [p("op", "Do", "select", { required: true, options: ["preview", "cut", "fade", "replay", "replay.stop", "mute"] }), p("sourceId", "Camera", "text", { templated: true }), p("ms", "Fade ms", "number"), p("secondsBack", "Replay seconds", "number"), p("speed", "Replay speed", "number"), p("id", "Audio channel", "text"), p("muted", "Muted", "bool")] },
    { type: "sponsor.fire", label: "Fire a sponsor", params: [p("sponsorId", "Sponsor", "text"), p("outcome", "Outcome", "select", { options: ["aired", "skipped", "delayed"] })] },
    { type: "event", label: "Add a game event", params: [p("event", "Event", "event", { required: true, templated: true })] },
    { type: "http", label: "Send a web request", params: [p("method", "Method", "select", { options: ["GET", "POST", "PUT", "PATCH", "DELETE"] }), p("url", "Address", "text", { required: true, templated: true, hint: "Values are URL-encoded automatically. 5 second timeout, redirects are not followed." }), p("headers", "Headers", "headers", { hint: "Values are write-only: after saving they show as [hidden]." }), p("body", "Body", "text", { templated: true, hint: "Use {{name|json}} inside JSON text." })] },
    { type: "wait", label: "Wait", params: [p("seconds", "Seconds", "number", { required: true })] },
    { type: "notice", label: "Show a notice to the operator", params: [p("level", "Level", "select", { options: ["info", "warn"] }), p("message", "Message", "text", { required: true, templated: true })] },
    { type: "log", label: "Write a log line", params: [p("level", "Level", "select", { options: ["INFO", "WARN", "ERROR"] }), p("message", "Message", "text", { required: true, templated: true })] },
    { type: "macro", label: "Run another macro", params: [p("macroId", "Macro", "text", { required: true })] },
  ],
  actionCommon: [p("label", "Note", "text"), p("continueOnError", "Keep going if this fails", "bool")],
  actionTypes: ACTION_TYPES,
  macroFields: { icons: ICONS, hotkeyHelp: "Optional Ctrl+ and Shift+ followed by one key: F, Shift+F, Ctrl+1, F5, Enter." },
  templateFilters: FILTER_NAMES,
  limits: LIMITS,
  panels: PANELS,
  factGroups: [
    { prefix: "", examples: ["period", "clock (ms)", "clockSec", "clockText", "running", "diff", "lead", "home.score", "away.score", "home.abbr", "home.name", "home.fouls", "home.timeouts", "home.bonus", "counter.<name>.home"] },
    { prefix: "before.", examples: ["before.home.score", "before.period"], hint: "The game just before the event that fired the rule" },
    { prefix: "event.", examples: ["event.type", "event.team", "event.points", "event.player", "event.note", "event.seq"], hint: "Event rules only" },
    { prefix: "custom.", examples: ["custom.<your field>"] },
    { prefix: "engine.", examples: ["engine.live", "engine.recording", "engine.reconnecting", "engine.replaying", "engine.program", "engine.preview", "engine.cpu", "engine.kbps", "engine.event"] },
    { prefix: "source.", examples: ["source.id", "source.label"], hint: "Camera dropped / back rules" },
    { prefix: "trigger.", examples: ["trigger.name", "trigger.data.<field>"], hint: "Manual triggers and macro buttons" },
  ],
  webhookEvents: ["*", "game.*", ...GAME_EVENTS.filter((e) => e !== "game.start" && e !== "game.end").map((e) => `game.${e}`), "game.start", "game.end", "engine.*", ...ENGINE_EVENTS.map((e) => `engine.${e}`), "sponsor.fired", "custom.changed", "trigger.<name>"],
};
