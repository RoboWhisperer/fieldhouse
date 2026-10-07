// Run: bun test web/screens/graphics.test.js
import { expect, test } from "bun:test";
import { resolveFields, casparData, dragTo, parsePairs, varGroups, renderItem } from "./graphics-lib.js";

const vars = { "home.score": 42, "home.name": "Lions", clock: "04:31" };
const doc = { id: "g1", kind: "caspar", name: "x", role: "other", placement: { anchor: "top-left", x: 0, y: 0, scale: 1, z: 1, opacity: 1 }, animation: {}, style: {}, updatedAt: 5,
  source: { entry: "index.html", width: 1920, height: 1080, dataFormat: "json" },
  fields: [{ name: "s", type: "number", default: "0", binding: { kind: "var", value: "home.score" } }, { name: "t", type: "text", default: "d", binding: { kind: "const", value: "{{home.name}} {{nope|Away}}" } }, { name: "m", type: "text", default: "typed", binding: { kind: "manual", value: "" } }] };

test("fields resolve like the server", () => {
  expect(resolveFields(doc, vars)).toEqual({ s: "42", t: "Lions Away", m: "typed" });
  expect(resolveFields(doc, vars, { m: "hi" }).m).toBe("hi");
});
test("caspar data", () => {
  expect(casparData({ s: "42", a: "<&>" }, "json", doc.fields)).toBe('{"s":42,"a":"<&>"}');
  expect(casparData({ a: "<&>" }, "xml")).toContain('value="&lt;&amp;&gt;"');
});
test("dragging moves away from the anchored edge", () => {
  expect(dragTo({ anchor: "bottom-right", x: 50, y: 50 }, 10, -20)).toEqual({ x: 40, y: 70 });
  expect(dragTo({ anchor: "top-left", x: 50, y: 50 }, 10, -20)).toEqual({ x: 60, y: 30 });
});
test("pairs and variable groups", () => {
  expect(parsePairs("id: lower3\nbad line\nk=v")).toEqual({ id: "lower3", k: "v" });
  expect(varGroups({ "home.name": "a", "home.starters.2.name": "b", "home.starters.1.name": "c", clock: "1" }).flatMap(([, k]) => k)).toEqual(["home.name", "home.starters.1.name", "clock"]);
  expect(renderItem(doc, vars).source.src).toBe("/gfx/g1/index.html?v=5-0");
});
