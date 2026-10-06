// Compile src/server.ts into a standalone binary and stage the files it reads at runtime next to it.
// Usage: bun scripts/build-sidecar.ts [bun-linux-x64|bun-windows-x64|bun-darwin-arm64|bun-darwin-x64]   (default: this machine)
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const host = `bun-${process.platform === "win32" ? "windows" : process.platform}-${process.arch === "arm64" ? "arm64" : "x64"}`;
const target = process.argv[2] ?? host;
if (!["bun-linux-x64", "bun-windows-x64", "bun-darwin-arm64", "bun-darwin-x64"].includes(target)) throw new Error(`unsupported target ${target}`);

const root = join(import.meta.dir, "..");
const out = join(root, "desktop", "build", `server-${target.endsWith("arm64") ? "arm64" : "x64"}`); // electron-builder picks server-${arch}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const exe = join(out, target.includes("windows") ? "fieldhouse-server.exe" : "fieldhouse-server");
const r = Bun.spawnSync(["bun", "build", "--compile", "--minify", `--target=${target}`, "--outfile", exe, join(root, "src", "server.ts")], { cwd: root, stdout: "inherit", stderr: "inherit" });
if (r.exitCode !== 0) process.exit(r.exitCode ?? 1);

// Resolved at runtime via FIELDHOUSE_WEB / FIELDHOUSE_ASSETS / FIELDHOUSE_OVERLAY (see src/config.ts)
cpSync(join(root, "web"), join(out, "web"), { recursive: true });
cpSync(join(root, "src", "assets"), join(out, "assets"), { recursive: true, filter: (p) => !p.endsWith(".svg") }); // feeds are embedded
cpSync(join(root, "src", "overlay.html"), join(out, "overlay.html"));
console.log(`sidecar (${target}) staged in ${out}`);
