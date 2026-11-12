// Run: bun test web/resize.test.js
import { expect, test } from "bun:test";
import { clampPanelWidth, clampPanelHeight } from "./resize.js";

test("a resized panel is clamped to its parent column", () => {
  // The parent column ends at 700 and the panel starts at 100, so it may grow to 600px.
  expect(clampPanelWidth(900, 100, 700)).toBe(600);
  // Smaller sizes stay as asked.
  expect(clampPanelWidth(400, 100, 700)).toBe(400);
  // A very narrow column still leaves the panel usable instead of collapsing it.
  expect(clampPanelWidth(900, 100, 250)).toBe(220);
});

test("a resized panel is clamped above the panel below", () => {
  // The next panel starts at 500 and this one starts at 100, so it may grow to 400px.
  expect(clampPanelHeight(900, 100, 500)).toBe(400);
  // Smaller heights stay as asked, with a usable minimum when there is room for it.
  expect(clampPanelHeight(300, 100, 500)).toBe(300);
  expect(clampPanelHeight(50, 100, 500)).toBe(120);
  // A short gap is used completely: the panel below must never be covered.
  expect(clampPanelHeight(900, 100, 200)).toBe(100);
});
