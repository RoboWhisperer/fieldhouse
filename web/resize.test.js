// Run: bun test web/resize.test.js
import { expect, test } from "bun:test";
import { clampPanelWidth } from "./resize.js";

test("a resized panel is clamped to its parent column", () => {
  // The parent column ends at 700 and the panel starts at 100, so it may grow to 600px.
  expect(clampPanelWidth(900, 100, 700)).toBe(600);
  // Smaller sizes stay as asked.
  expect(clampPanelWidth(400, 100, 700)).toBe(400);
  // A very narrow column still leaves the panel usable instead of collapsing it.
  expect(clampPanelWidth(900, 100, 250)).toBe(220);
});
