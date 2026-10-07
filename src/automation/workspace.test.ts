import { afterAll, expect, test } from "bun:test";
import { createApp } from "../app";
import { FakeEngine } from "../engine";
import { openStore } from "../store";
import { assertNoSecrets, createWorkspace, registerWorkspaceSection } from "./workspace";

const engines: FakeEngine[] = [];
afterAll(async () => { await Promise.all(engines.map((e) => e.close())); });
function mk() {
  const store = openStore(":memory:"), engine = new FakeEngine(); engines.push(engine);
  const app = createApp({ store, engine });
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await app.handle(new Request("http://x/api" + path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: body === undefined ? {} : { "content-type": "application/json" } }));
    return { status: r.status, body: (r.headers.get("content-type") ?? "").includes("json") ? await r.json() : await r.text(), res: r };
  };
  return { app, store, call };
}

async function seeded() {
  const a = mk();
  await a.call("PUT", "/custom", { fields: { sponsorLine: { label: "Sponsor", default: "Thanks!", value: "Acme" }, accent: { type: "color", value: "#aa00ff" } } });
  const macro = (await a.call("POST", "/macros", { label: "Horn", hotkey: "Shift+H", actions: [{ type: "custom.set", key: "horn", value: "1" }] })).body;
  await a.call("POST", "/automation/rules", { name: "Triple", trigger: { type: "event", event: "score", points: [3] }, cooldownSec: 5, actions: [
    { type: "macro", macroId: macro.id }, { type: "http", method: "POST", url: "https://c.example/x?token=SECRET", headers: { Authorization: "Bearer topsecret" }, body: "{}" }] });
  await a.call("POST", "/webhooks", { name: "Companion", url: "https://c.example/h?key=zzz", events: ["game.*"], secret: "hmacsecret1" });
  await a.call("PUT", "/ui", { theme: "light", accent: "#aa3300", density: "compact", textScale: 1.1, customCss: ".x{color:red}", macroButtons: [{ macroId: macro.id, color: "#112233" }] });
  const lay = (await a.call("POST", "/ui/layouts", { name: "Streaming night" })).body;
  return { ...a, macro, lay };
}

test("export never contains secrets, header values or query strings, and has a versioned header", async () => {
  const a = await seeded();
  const r = await a.call("GET", "/workspace/export");
  expect(r.res.headers.get("content-disposition")).toContain("fieldhouse-workspace-");
  const text = JSON.stringify(r.body);
  for (const s of ["topsecret", "SECRET", "hmacsecret1", "zzz", "token=", "key="]) expect(text, s).not.toContain(s);
  expect(r.body).toMatchObject({ format: "fieldhouse-workspace", version: 1 });
  expect(Object.keys(r.body.sections).sort()).toEqual(expect.arrayContaining(["customFields", "layouts", "looks", "macros", "rules", "webhooks"]));
  expect(r.body.sections.rules[0].actions[1].headerNames).toEqual(["Authorization"]);
  expect((await a.call("GET", "/workspace/export?sections=rules")).body.sections).toEqual({ rules: r.body.sections.rules });
  assertNoSecrets(r.body); // does not throw
});

test("round trip: import into a fresh install gives the same rules, macros, fields, webhooks, looks and layouts", async () => {
  const a = await seeded();
  const doc = (await a.call("GET", "/workspace/export")).body;
  const b = mk();
  const dry = (await b.call("POST", "/workspace/import", { workspace: doc, mode: "merge", dryRun: true })).body;
  expect(dry).toMatchObject({ ok: true, dryRun: true, applied: false });
  expect(dry.sections.find((s: any) => s.name === "rules")).toMatchObject({ status: "would import", plan: { add: 1, update: 0, remove: 0 } });
  expect((await b.call("GET", "/automation/rules")).body).toEqual([]); // the dry run changed nothing
  expect((await b.call("GET", "/macros")).body).toEqual([]);
  const done = (await b.call("POST", "/workspace/import", { workspace: doc, mode: "merge" })).body;
  expect(done).toMatchObject({ ok: true, applied: true });
  expect(done.sections.every((s: any) => s.status === "imported")).toBe(true);
  const again = (await b.call("GET", "/workspace/export")).body;
  expect({ ...again, exportedAt: 0 }).toEqual({ ...doc, exportedAt: 0 });
  expect(b.app.automation.custom.all()).toEqual({ sponsorLine: "Acme", accent: "#aa00ff" });
  // header values did not travel: the rule is there but its secret header is empty
  const rule = b.store.list<any>("rule")[0];
  expect(rule.actions[1].headers).toEqual({ Authorization: "" });
  expect(b.store.list<any>("webhook")[0].secret).toBeUndefined();
  const ui = (await b.call("GET", "/ui")).body.ui;
  expect(ui).toMatchObject({ theme: "light", accent: "#AA3300", density: "compact", textScale: 1.1 });
  expect(ui.layouts.presets.map((p: any) => p.id)).toEqual(["default", "streaming-night"]);
  expect(ui.macroButtons).toEqual([{ macroId: a.macro.id, color: "#112233" }]);
});

test("merge keeps what is there; replace removes what the file does not have", async () => {
  const a = await seeded();
  const doc = (await a.call("GET", "/workspace/export")).body;
  const b = mk();
  await b.call("POST", "/automation/rules", { name: "Mine", trigger: { type: "manual", name: "m" }, actions: [{ type: "log", message: "x" }] });
  await b.call("PUT", "/custom", { values: { keep: "me" } });
  await b.call("POST", "/workspace/import", { workspace: doc, mode: "merge" });
  expect((await b.call("GET", "/automation/rules")).body.map((r: any) => r.name).sort()).toEqual(["Mine", "Triple"]);
  expect(b.app.automation.custom.all().keep).toBe("me");
  const plan = (await b.call("POST", "/workspace/import", { workspace: doc, mode: "replace", dryRun: true })).body;
  expect(plan.sections.find((s: any) => s.name === "rules").plan).toEqual({ add: 0, update: 1, remove: 1 });
  await b.call("POST", "/workspace/import", { workspace: doc, mode: "replace" });
  expect((await b.call("GET", "/automation/rules")).body.map((r: any) => r.name)).toEqual(["Triple"]);
  expect(b.app.automation.custom.all()).toEqual({ sponsorLine: "Acme", accent: "#aa00ff" });
});

test("importing again updates by id instead of duplicating, and an existing webhook keeps its secret", async () => {
  const a = await seeded();
  const doc = (await a.call("GET", "/workspace/export")).body;
  await a.call("POST", "/workspace/import", { workspace: doc, mode: "merge" });
  expect((await a.call("GET", "/automation/rules")).body).toHaveLength(1);
  expect((await a.call("GET", "/macros")).body).toHaveLength(1);
  expect(a.store.list<any>("webhook")).toHaveLength(1);
  expect(a.store.list<any>("webhook")[0].secret).toBe("hmacsecret1");
  expect(a.store.list<any>("rule")[0].actions[1].headers.Authorization).toBe(""); // the file never had the value, so the import cannot restore it
});

test("a file with secrets, a wrong format, a newer version or an invalid section is refused and changes nothing", async () => {
  const a = await seeded();
  const doc = (await a.call("GET", "/workspace/export")).body;
  const b = mk();
  const refuse = async (workspace: any, msg: string) => { const r = await b.call("POST", "/workspace/import", { workspace, mode: "merge" }); expect(r.body.error ?? JSON.stringify(r.body)).toContain(msg); };
  await refuse({ ...doc, sections: { ...doc.sections, webhooks: [{ name: "x", url: "https://a.example", secret: "abc12345678" }] } }, "looks like a secret");
  await refuse({ ...doc, sections: { rules: [{ id: "r1", name: "x", apiKey: "k", trigger: { type: "manual", name: "a" }, actions: [] }] } }, "looks like a secret");
  await refuse({ ...doc, sections: { macros: [{ id: "m1", label: "x", tokenHash: "abc", actions: [] }] } }, "looks like a secret");
  await refuse({ format: "other" }, "not a Fieldhouse workspace");
  await refuse({ ...doc, version: 99 }, "newer Fieldhouse");
  await refuse({ ...doc, version: 0 }, "no version");
  await refuse(null, "not a Fieldhouse workspace");
  // one bad section: the good sections in the same file are NOT applied either
  const bad = { ...doc, sections: { ...doc.sections, rules: [{ ...doc.sections.rules[0], when: "period ==" }] } };
  const r = (await b.call("POST", "/workspace/import", { workspace: bad, mode: "merge" })).body;
  expect(r.ok).toBe(false); expect(r.applied).toBe(false);
  expect(r.sections.find((s: any) => s.name === "rules")).toMatchObject({ status: "error" });
  expect(r.sections.find((s: any) => s.name === "rules").message).toContain("extra condition");
  expect((await b.call("GET", "/macros")).body).toEqual([]);
  expect((await b.call("POST", "/workspace/import", { workspace: doc, mode: "sideways" })).body.error).toContain("merge");
  // unknown sections are skipped politely
  const odd = (await b.call("POST", "/workspace/import", { workspace: { ...doc, sections: { future: [] } }, dryRun: true })).body;
  expect(odd.sections[0].status).toBe("unknown section");
});

test("sections registered by other modules (graphics, sport profiles) take part, in dry run and for real", async () => {
  const ws = createWorkspace();
  let held: unknown = ["a"], imported: unknown;
  ws.register("graphics", { export: () => held, async import(d, mode) { imported = [d, mode]; }, plan: (d: any) => ({ add: d.length, update: 0, remove: 0 }) });
  ws.register("noPlan", { export: () => 1, async import() {} });
  const doc = await ws.export();
  expect(doc.sections).toEqual({ graphics: ["a"], noPlan: 1 });
  const dry = await ws.import(doc, { dryRun: true });
  expect(dry.sections.find((s) => s.name === "graphics")!.plan).toEqual({ add: 1, update: 0, remove: 0 });
  expect(imported).toBeUndefined();
  await ws.import(doc, { mode: "replace", only: ["graphics"] });
  expect(imported).toEqual([["a"], "replace"]);
  // a section that leaks a secret makes the export fail loudly
  held = { streamKey: "abc" };
  await expect(ws.export()).rejects.toThrow("looks like a secret");
  expect(() => ws.register("Bad Name", { export: () => 1, import: async () => {} })).toThrow();
  // the module-level hook lands in the registry the running app uses
  const { app } = mk();
  registerWorkspaceSection("extra", { export: () => ({ ok: 1 }), import: async () => {} });
  expect(app.automation.workspace.names()).toContain("extra");
});
