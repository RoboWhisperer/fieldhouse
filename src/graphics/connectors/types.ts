import type { VarMap } from "../types";
export type Fields = Record<string, string>;
export interface TestResult { ok: boolean; message: string }
/** What every remote system adapter offers. `target` is the graphic's own address of the thing to drive (a sub-composition, a template...). */
export interface Driver {
  show(target: Record<string, any>, fields: Fields, graphicName: string): Promise<void>;
  update(target: Record<string, any>, fields: Fields): Promise<void>;
  hide(target: Record<string, any>): Promise<void>;
  next(target: Record<string, any>): Promise<void>;
  test(): Promise<TestResult>;
  /** Resolves when everything queued has been sent (or given up). */
  idle(): Promise<void>;
  close(): void;
  model?(): Promise<unknown>;
  /** Field name -> type, so numbers and checkboxes are sent as such. */
  setTypes?(t: Record<string, string>): void;
}
export interface ConnDeps {
  fetch: typeof fetch;
  vars: () => VarMap;
  log: (level: "INFO" | "WARN" | "ERROR", message: string) => void;
  /** Called when a queued send fails for good, so the operator hears about it. */
  problem: (message: string) => void;
  status: (ok: boolean, message: string) => void;
  /** Singular base address; tests point it at a mock. */
  singularBase?: string;
}
export const keyOf = (t: Record<string, any>) => JSON.stringify(Object.entries(t).sort(([a], [b]) => (a < b ? -1 : 1)));
/** Remove a secret from any text before it is logged or shown. */
export const scrub = (s: string, secret?: string) => { let out = s; if (secret) out = out.split(secret).join("***"); return out.replace(/\/controlapps\/[^/\s"]+/g, "/controlapps/***"); };
