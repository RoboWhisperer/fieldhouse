import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { maskForRemote } from "./automation/model";
import { amcpString } from "./graphics/connectors/amcp";
import { GraphicFiles, serveGfx } from "./graphics/files";
import { tame } from "./graphics/pack";

test("every /gfx file is sandboxed, not only HTML (a script in an SVG must not run as the console)", async () => {
  const root = mkdtempSync(join(tmpdir(), "fh-hard-")); mkdirSync(join(root, "g1"));
  writeFileSync(join(root, "g1", "e.svg"), "<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>");
  const res = serveGfx(new Request("http://127.0.0.1:8080/gfx/g1/e.svg"), new GraphicFiles(root), () => undefined);
  expect(res.headers.get("content-security-policy")).toContain("sandbox");
});

test("a graphic file cannot exceed the size limit", () => {
  const root = mkdtempSync(join(tmpdir(), "fh-hard-")); const f = new GraphicFiles(root);
  expect(() => f.put("g1", "big.json", new Uint8Array(26 * 1024 * 1024))).toThrow("at most");
});

test("a bare carriage return cannot end an AMCP line", () => {
  expect(amcpString("a\rCG 1 CLEAR")).not.toMatch(/[\r\n]/);
});

test("imported graphics start offline and are not put on air by themselves", () => {
  const g: any = { kind: "html", source: { allowNetwork: true }, show: { mode: "always" } };
  tame(g); expect(g.source.allowNetwork).toBe(false); expect(g.show.mode).toBe("manual");
});

test("remote views of macros hide address queries and bodies", () => {
  const [a]: any = maskForRemote([{ type: "http", method: "POST", url: "https://x/hook?token=S", body: "{\"k\":1}", headers: {} } as any]);
  expect(JSON.stringify(a)).not.toContain("token=S"); expect(a.body).not.toContain("k");
});
