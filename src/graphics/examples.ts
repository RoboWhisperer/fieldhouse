// Ready-made graphics to try and to copy from: three small CasparCG-compatible templates and a starter for new HTML graphics.
import lowerThird from "./examples/caspar-lower-third.html" with { type: "text" };
import scoreBug from "./examples/caspar-score-bug.html" with { type: "text" };
import card from "./examples/caspar-fullscreen-card.html" with { type: "text" };
import type { FieldDef } from "./types";

const fd = (name: string, label: string, def: string, binding: FieldDef["binding"]): FieldDef => ({ name, label, type: "text", default: def, binding });
export interface Example { id: string; title: string; description: string; html: string; role: "lowerthird" | "scorebug" | "fullscreen"; dataFormat: "xml" | "json"; fields: FieldDef[]; z: number }
export const EXAMPLES: Example[] = [
  { id: "caspar-lower-third", title: "Lower third (XML data)", description: "A name and title bar that slides in. Takes CasparCG XML data (fields f0 and f1).", html: String(lowerThird), role: "lowerthird", dataFormat: "xml", z: 30,
    fields: [fd("f0", "Name", "Jane Doe", { kind: "manual", value: "" }), fd("f1", "Title", "Point guard", { kind: "manual", value: "" })] },
  { id: "caspar-score-bug", title: "Score bug (JSON data)", description: "Teams, scores and clock at the top left. Takes JSON data and follows the live game.", html: String(scoreBug), role: "scorebug", dataFormat: "json", z: 20,
    fields: [fd("home", "Home", "HOME", { kind: "var", value: "home.abbr" }), fd("away", "Away", "AWAY", { kind: "var", value: "away.abbr" }), fd("homeScore", "Home score", "0", { kind: "var", value: "home.score" }),
      fd("awayScore", "Away score", "0", { kind: "var", value: "away.score" }), fd("clock", "Clock", "00:00", { kind: "var", value: "clock" })] },
  { id: "caspar-fullscreen-card", title: "Full-screen card (two steps)", description: "A full-screen card; Next reveals the second line.", html: String(card), role: "fullscreen", dataFormat: "xml", z: 55,
    fields: [fd("headline", "Headline", "Halftime", { kind: "manual", value: "" }), fd("body", "Second line", "Thanks for watching", { kind: "manual", value: "" })] },
];

export const STARTER_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>My graphic</title>
<style>
  html, body { margin: 0; width: 1920px; height: 1080px; background: transparent; font-family: "DejaVu Sans", "Liberation Sans", Roboto, Arial, sans-serif; overflow: hidden; }
  .bar { position: absolute; left: 64px; bottom: 64px; padding: 14px 28px; background: #0B1018; color: #fff; font-size: 40px; font-weight: bold; border-left: 10px solid var(--team, #F5A524); }
</style></head>
<body>
  <!-- Values come from Fieldhouse: data-fh-bind shows a variable, data-fh-style sets a CSS value. See docs/graphics-authoring.md -->
  <div class="bar" data-fh-style="--team:home.color">
    <span data-fh-bind="home.abbr">HOME</span> <span data-fh-bind="home.score">0</span> - <span data-fh-bind="away.score">0</span> <span data-fh-bind="away.abbr">AWAY</span>
  </div>
</body></html>
`;
