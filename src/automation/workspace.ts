// Workspace export / import: everything the operator built (rules, macros, custom fields, webhooks, looks, layouts, graphics, sport profiles)
// as ONE versioned JSON file, so a setup can be backed up, moved to another computer or shared.
// Sections plug in through registerWorkspaceSection(); the graphics and sport-profile code register theirs while createApp() runs.
// Secrets (stream keys, tokens, passwords, API keys, webhook secrets, pairing codes, header values) are never written and a file that contains them is refused.
export const WORKSPACE_FORMAT = "fieldhouse-workspace";
export const WORKSPACE_VERSION = 1;
export type Mode = "merge" | "replace";
export interface Plan { add: number; update: number; remove: number; note?: string }
export interface WorkspaceSection {
  export(): unknown | Promise<unknown>;
  /** Apply the section's data. Must validate EVERYTHING before changing anything. */
  import(data: unknown, mode: Mode): Promise<void>;
  /** Dry run: what import() would change. Optional: sections without it are reported as "would be imported". */
  plan?(data: unknown, mode: Mode): Plan | Promise<Plan>;
}
export type Registry = ReturnType<typeof createWorkspace>;

const SECRET_KEY = /(secret|password|passwd|token|api[-_]?key|stream[-_]?key|private[-_]?key|pairing|credential)/i;
/** Throws with the path of the first key that looks like a secret. */
export function assertNoSecrets(x: unknown, path = "workspace", depth = 0): void {
  if (depth > 12 || !x || typeof x !== "object") return;
  for (const [k, v] of Object.entries(x)) {
    if (!Array.isArray(x) && SECRET_KEY.test(k)) throw new Error(`The file contains "${path}.${k}", which looks like a secret. Fieldhouse never imports secrets. Remove it from the file and enter secrets by hand.`);
    assertNoSecrets(v, `${path}.${k}`, depth + 1);
  }
}

export function createWorkspace(app = "Fieldhouse") {
  const sections = new Map<string, WorkspaceSection>();
  return {
    register(name: string, s: WorkspaceSection) { if (!/^[a-z][a-zA-Z0-9]{0,30}$/.test(name)) throw new Error("A workspace section name is letters and digits."); sections.set(name, s); },
    names: () => [...sections.keys()],
    async export(only?: string[]) {
      const out: Record<string, unknown> = {};
      for (const [name, s] of sections) if (!only?.length || only.includes(name)) out[name] = await s.export();
      const doc = { format: WORKSPACE_FORMAT, version: WORKSPACE_VERSION, app, exportedAt: new Date().toISOString(), sections: out };
      assertNoSecrets(doc); // a section that leaks a secret is a bug: fail loudly instead of writing it
      return doc;
    },
    async import(doc: any, o: { mode?: string; dryRun?: boolean; only?: string[] } = {}) {
      const mode = o.mode ?? "merge";
      if (mode !== "merge" && mode !== "replace") throw new Error('mode must be "merge" or "replace".');
      if (!doc || typeof doc !== "object" || doc.format !== WORKSPACE_FORMAT) throw new Error("That is not a Fieldhouse workspace file.");
      if (!Number.isInteger(doc.version) || doc.version < 1) throw new Error("The workspace file has no version.");
      if (doc.version > WORKSPACE_VERSION) throw new Error(`This workspace file is from a newer Fieldhouse (format ${doc.version}). Update Fieldhouse to open it.`);
      if (!doc.sections || typeof doc.sections !== "object" || Array.isArray(doc.sections)) throw new Error("The workspace file has no sections.");
      assertNoSecrets(doc);
      const report: { name: string; status: "would import" | "imported" | "unknown section" | "not selected" | "error"; plan?: Plan; message?: string }[] = [];
      const todo: [string, WorkspaceSection, unknown][] = [];
      for (const [name, data] of Object.entries(doc.sections)) {
        const s = sections.get(name);
        if (!s) { report.push({ name, status: "unknown section", message: "This version of Fieldhouse does not know that section, so it was skipped." }); continue; }
        if (o.only?.length && !o.only.includes(name)) { report.push({ name, status: "not selected" }); continue; }
        todo.push([name, s, data]);
      }
      // Pass 1: check every section (the plan step validates). Nothing changes if any section is invalid.
      for (const [name, s, data] of todo) {
        try { const plan = await s.plan?.(data, mode as Mode); report.push({ name, status: "would import", plan }); }
        catch (e: any) { report.push({ name, status: "error", message: e.message }); }
      }
      const errors = report.filter((r) => r.status === "error");
      if (errors.length || o.dryRun) return { ok: !errors.length, dryRun: !!o.dryRun, mode, applied: false, sections: report };
      // Pass 2: apply.
      for (const [name, s, data] of todo) {
        const r = report.find((x) => x.name === name)!;
        try { await s.import(data, mode as Mode); r.status = "imported"; } catch (e: any) { r.status = "error"; r.message = e.message; }
      }
      return { ok: !report.some((r) => r.status === "error"), dryRun: false, mode, applied: true, sections: report };
    },
  };
}

// The registry the running app uses. createApp() calls useWorkspace(its registry) first, so code that runs later in createApp
// (graphics routes, sport profiles) can simply call registerWorkspaceSection(...).
let current = createWorkspace();
export const useWorkspace = (r: Registry) => { current = r; };
export const registerWorkspaceSection = (name: string, s: WorkspaceSection) => current.register(name, s);
