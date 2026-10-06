// Smoke test for the compiled sidecar: start it standalone, hit the API and the UI, SIGTERM, expect exit 0.
// Usage: bun scripts/smoke-sidecar.ts   (after scripts/build-sidecar.ts, for the host platform)
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = join(import.meta.dir, "..", "desktop", "build", `server-${process.arch === "arm64" ? "arm64" : "x64"}`);
const home = mkdtempSync(join(tmpdir(), "fh-smoke-"));
const p = Bun.spawn([join(dir, process.platform === "win32" ? "fieldhouse-server.exe" : "fieldhouse-server")], {
  cwd: home, stdout: "pipe", stderr: "inherit",
  env: { ...process.env, FIELDHOUSE_PACKAGED: "1", ENGINE: "fake", FIELDHOUSE_HOME: home, PORT: "0", HOST: "127.0.0.1",
    FIELDHOUSE_WEB: join(dir, "web"), FIELDHOUSE_ASSETS: join(dir, "assets"), FIELDHOUSE_OVERLAY: join(dir, "overlay.html") },
});
const fail = (m: string) => { p.kill(); console.error("SMOKE FAIL:", m); process.exit(1); };

let buf = "", port = 0;
const reader = p.stdout.getReader();
const deadline = Date.now() + 20000;
while (!port && Date.now() < deadline) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += new TextDecoder().decode(value);
  const m = /FIELDHOUSE_READY (\{.*\})/.exec(buf);
  if (m) port = JSON.parse(m[1]).port;
}
if (!port) fail("no FIELDHOUSE_READY line");
const get = async (path: string) => { const r = await fetch(`http://127.0.0.1:${port}${path}`); if (!r.ok) fail(`${path} -> ${r.status}`); return r; };
const state = await (await get("/api/state")).json();
if (state.engine?.engine !== "fake") fail("unexpected engine state: " + JSON.stringify(state).slice(0, 300));
if (!(await (await get("/")).text()).includes("<html")) fail("UI not served");
if (!(await (await get("/snap/cam1")).text()).startsWith("<svg")) fail("embedded feed missing");
if (!(await (await get("/overlay")).text()).toLowerCase().includes("seven-segment")) fail("overlay missing");
await get("/overlay");

p.kill("SIGTERM"); // Windows has no signals: this is a hard kill there, so only POSIX checks the exit code
const code = await p.exited;
if (process.platform !== "win32" && code !== 0) fail(`exit code ${code}`);
console.log(`smoke ok (port ${port}, exit ${code})`);
