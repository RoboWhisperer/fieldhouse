// A tiny, safe expression language for rule conditions, e.g. `clock <= 60000 and period == 4`. There are no functions.
// Hand-written parser, no eval and no Function: the text is turned into a small tree and walked.
//   values:    numbers, 'text' or "text", true, false, fact names such as home.score or custom.sponsorLine
//   operators: == != < <= > >= contains   + - * / %   and or not (also && || !)   ( )
import type { VarMap } from "../custom-types";

export type Val = string | number | boolean | undefined;
type Node =
  | { k: "lit"; v: string | number | boolean }
  | { k: "var"; name: string }
  | { k: "not"; a: Node }
  | { k: "neg"; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node };

export class ExprError extends Error {}
export const MAX_EXPR = 300, MAX_NODES = 120, MAX_DEPTH = 24;
const WORDS = new Set(["and", "or", "not", "contains", "true", "false"]);

type Tok = { t: "num" | "str" | "id" | "op" | "end"; v: string; at: number };
function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const rest = src.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^\d+(\.\d+)?/.exec(rest))) { out.push({ t: "num", v: m[0], at: i }); i += m[0].length; }
    else if ((m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(rest))) { out.push({ t: "id", v: m[0], at: i }); i += m[0].length; }
    else if (c === "'" || c === '"') {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new ExprError(`The text starting at character ${i + 1} is missing its closing quote.`);
      out.push({ t: "str", v: src.slice(i + 1, end), at: i }); i = end + 1;
    } else if ((m = /^(==|!=|<=|>=|&&|\|\||[<>+\-*\/%()!])/.exec(rest))) { out.push({ t: "op", v: m[0], at: i }); i += m[0].length; }
    else throw new ExprError(`Character ${i + 1} ("${c}") is not allowed in a condition.`);
  }
  out.push({ t: "end", v: "", at: src.length });
  return out;
}

export function parseExpr(src: string): { ast: Node; names: string[] } {
  if (typeof src !== "string") throw new ExprError("A condition must be text.");
  if (src.length > MAX_EXPR) throw new ExprError(`A condition can be at most ${MAX_EXPR} characters.`);
  if (!src.trim()) throw new ExprError("The condition is empty.");
  const toks = lex(src);
  let p = 0, nodes = 0;
  const names = new Set<string>();
  const peek = () => toks[p];
  const isOp = (v: string) => peek().t === "op" && peek().v === v;
  const isWord = (v: string) => peek().t === "id" && peek().v.toLowerCase() === v;
  let nest = 0;
  const mk = <T extends Node>(n: T, _d = 0): T => { if (++nodes > MAX_NODES) throw new ExprError("That condition is too long. Split it into two rules."); return n; };
  const deeper = <T>(f: () => T): T => { if (++nest > MAX_DEPTH) throw new ExprError("That condition has too many brackets or nots inside each other."); try { return f(); } finally { nest--; } };
  const or = (d: number): Node => { let a = and(d + 1); while (isWord("or") || isOp("||")) { p++; a = mk({ k: "bin", op: "or", a, b: and(d + 1) }, d); } return a; };
  const and = (d: number): Node => { let a = not(d + 1); while (isWord("and") || isOp("&&")) { p++; a = mk({ k: "bin", op: "and", a, b: not(d + 1) }, d); } return a; };
  const not = (d: number): Node => { if (isWord("not") || isOp("!")) { p++; return mk({ k: "not", a: deeper(() => not(d + 1)) }, d); } return cmp(d + 1); };
  const cmp = (d: number): Node => {
    const a = add(d + 1);
    const t = peek();
    const op = t.t === "op" && ["==", "!=", "<", "<=", ">", ">="].includes(t.v) ? t.v : isWord("contains") ? "contains" : "";
    if (!op) return a;
    p++;
    return mk({ k: "bin", op, a, b: add(d + 1) }, d);
  };
  const add = (d: number): Node => { let a = mul(d + 1); while (isOp("+") || isOp("-")) { const op = toks[p++].v; a = mk({ k: "bin", op, a, b: mul(d + 1) }, d); } return a; };
  const mul = (d: number): Node => { let a = unary(d + 1); while (isOp("*") || isOp("/") || isOp("%")) { const op = toks[p++].v; a = mk({ k: "bin", op, a, b: unary(d + 1) }, d); } return a; };
  const unary = (d: number): Node => { if (isOp("-")) { p++; return mk({ k: "neg", a: deeper(() => unary(d + 1)) }, d); } return primary(d + 1); };
  const primary = (d: number): Node => {
    const t = toks[p++];
    if (t.t === "num") return mk({ k: "lit", v: Number(t.v) }, d);
    if (t.t === "str") return mk({ k: "lit", v: t.v }, d);
    if (t.t === "id") {
      const w = t.v.toLowerCase();
      if (w === "true" || w === "false") return mk({ k: "lit", v: w === "true" }, d);
      if (WORDS.has(w)) throw new ExprError(`"${t.v}" is in the wrong place (character ${t.at + 1}).`);
      names.add(t.v); return mk({ k: "var", name: t.v }, d);
    }
    if (t.t === "op" && t.v === "(") { const e = deeper(() => or(d + 1)); if (!isOp(")")) throw new ExprError("A bracket is not closed."); p++; return e; }
    throw new ExprError(t.t === "end" ? "The condition ends too early." : `Unexpected "${t.v}" at character ${t.at + 1}.`);
  };
  const ast = or(0);
  if (peek().t !== "end") throw new ExprError(`Unexpected "${peek().v}" at character ${peek().at + 1}. Join comparisons with "and" or "or".`);
  return { ast, names: [...names] };
}

const truthy = (v: Val) => v !== undefined && v !== "" && v !== 0 && v !== false;
const numeric = (v: Val): number | undefined => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);

export function evalAst(n: Node, facts: VarMap, unknown?: Set<string>): Val {
  switch (n.k) {
    case "lit": return n.v;
    case "var": { if (Object.hasOwn(facts, n.name)) return facts[n.name]; unknown?.add(n.name); return undefined; }
    case "not": return !truthy(evalAst(n.a, facts, unknown));
    case "neg": { const x = numeric(evalAst(n.a, facts, unknown)); return x === undefined ? undefined : -x; }
    case "bin": {
      if (n.op === "and") return truthy(evalAst(n.a, facts, unknown)) && truthy(evalAst(n.b, facts, unknown));
      if (n.op === "or") return truthy(evalAst(n.a, facts, unknown)) || truthy(evalAst(n.b, facts, unknown));
      const a = evalAst(n.a, facts, unknown), b = evalAst(n.b, facts, unknown);
      if (["+", "-", "*", "/", "%"].includes(n.op)) {
        if (n.op === "+" && (typeof a === "string" && numeric(a) === undefined || typeof b === "string" && numeric(b) === undefined)) return `${a ?? ""}${b ?? ""}`;
        const x = numeric(a), y = numeric(b);
        if (x === undefined || y === undefined) return undefined;
        switch (n.op) { case "+": return x + y; case "-": return x - y; case "*": return x * y; case "/": return y === 0 ? undefined : x / y; default: return y === 0 ? undefined : x % y; }
      }
      if (n.op === "contains") return a !== undefined && b !== undefined && String(a).toLowerCase().includes(String(b).toLowerCase());
      if (a === undefined || b === undefined) return n.op === "!=";
      const x = numeric(a), y = numeric(b);
      const same = typeof a === "boolean" || typeof b === "boolean" ? String(a) === String(b) : x !== undefined && y !== undefined ? x === y : String(a) === String(b);
      if (n.op === "==") return same;
      if (n.op === "!=") return !same;
      const [l, r] = x !== undefined && y !== undefined ? [x, y] : [String(a), String(b)];
      return n.op === "<" ? l < r : n.op === "<=" ? l <= r : n.op === ">" ? l > r : l >= r;
    }
  }
}

/** Parse + evaluate in one go. Returns the truth of the condition plus any fact names that do not exist. */
export function testExpr(src: string, facts: VarMap): { result: boolean; value: Val; unknown: string[] } {
  const { ast } = parseExpr(src);
  const unknown = new Set<string>();
  const value = evalAst(ast, facts, unknown);
  return { result: truthy(value), value, unknown: [...unknown] };
}
export const checkExpr = (src: string): string | null => { try { parseExpr(src); return null; } catch (e) { return e instanceof ExprError ? e.message : "That condition is not valid."; } };
