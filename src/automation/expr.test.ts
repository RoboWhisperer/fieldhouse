import { expect, test } from "bun:test";
import { checkExpr, parseExpr, testExpr } from "./expr";

const facts = { clock: 45_000, period: 4, "home.score": 70, "away.score": 62, "custom.mode": "Playoffs", running: true, diff: 8 };
const t = (src: string) => testExpr(src, facts).result;

test("expressions: comparisons, boolean logic, arithmetic and text", () => {
  expect(t("clock <= 60000 and period == 4")).toBe(true);
  expect(t("clock <= 60000 && period == 3")).toBe(false);
  expect(t("period == 3 or home.score > 60")).toBe(true);
  expect(t("not (period == 3)")).toBe(true);
  expect(t("!running")).toBe(false);
  expect(t("home.score - away.score >= 8")).toBe(true);
  expect(t("(home.score + away.score) / 2 == 66")).toBe(true);
  expect(t("-diff < 0")).toBe(true);
  expect(t("custom.mode == 'Playoffs'")).toBe(true);
  expect(t('custom.mode contains "off"')).toBe(true);
  expect(t("running == true")).toBe(true);
  expect(t("1 + 2 * 3 == 7")).toBe(true);
  expect(testExpr("10 / 0", facts).value).toBeUndefined();
});

test("unknown facts are reported, never crash, and compare as false", () => {
  const r = testExpr("nope.value > 3 or period == 4", facts);
  expect(r.result).toBe(true);
  expect(r.unknown).toEqual(["nope.value"]);
  expect(testExpr("nope == 1", facts).result).toBe(false);
  expect(testExpr("nope != 1", facts).result).toBe(true);
});

test("invalid expressions give a plain sentence", () => {
  for (const bad of ["", "   ", "period ==", "clock <= <= 3", "(period == 4", "period == 4)", "period = 4", "'open", "and", "period == 4 clock", "3 +"]) {
    const msg = checkExpr(bad);
    expect(msg, bad).toBeTruthy();
    expect(msg!.length).toBeLessThan(160);
  }
});

test("injection attempts are rejected as text, never run", () => {
  (globalThis as any).__pwned = false;
  for (const evil of ["process.exit()", "constructor.constructor('return 1')()", "__proto__.x == 1", "a['b']", "(()=>{globalThis.__pwned=true})()", "`${1}`", "1; 2", "eval('1')", "import('fs')", "x => x", "$(whoami)", "\\u0061"]) {
    // must either be refused or evaluate harmlessly to a boolean/undefined without touching anything
    try { testExpr(evil, facts); } catch (e: any) { expect(e.message).toBeTruthy(); }
  }
  expect((globalThis as any).__pwned).toBe(false);
  // lookups never reach the prototype chain
  expect(testExpr("constructor == 1", facts).unknown).toEqual(["constructor"]);
  expect(testExpr("toString == 1", {}).unknown).toEqual(["toString"]);
});

test("size limits: long text, many nodes, deep nesting", () => {
  expect(checkExpr("a".repeat(301))).toContain("at most");
  expect(checkExpr(Array(149).fill("1").join("+"))).toContain("too long");
  expect(checkExpr("(".repeat(40) + "1" + ")".repeat(40))).toContain("too many brackets");
  expect(checkExpr("not ".repeat(40) + "true")).toContain("too many");
  expect(() => parseExpr("period == 4")).not.toThrow();
});
