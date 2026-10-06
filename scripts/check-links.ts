// Checks relative links and #anchors in the repo's Markdown files. Run: bun scripts/check-links.ts
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const skip = new Set(["node_modules", ".git", "data", ".impeccable"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (skip.has(n)) return [];
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".md") ? [p] : [];
  });
}

const slug = (h: string) =>
  h.trim().toLowerCase().replace(/[`*_]/g, "").replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s/g, "-");

const anchors = (file: string) => {
  const out = new Set<string>();
  let fence = false;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.startsWith("```")) fence = !fence;
    const m = !fence && line.match(/^#{1,6}\s+(.*)$/);
    if (m) out.add(slug(m[1]));
  }
  return out;
};

let bad = 0;
for (const file of walk(root)) {
  let fence = false;
  readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    if (line.startsWith("```")) fence = !fence;
    if (fence) return;
    for (const m of line.replace(/`[^`]*`/g, "").matchAll(/\]\(([^)\s]+)\)/g)) {
      const href = m[1];
      if (/^[a-z]+:/i.test(href)) continue; // http:, mailto:
      const [path, frag] = href.split("#");
      const target = path ? resolve(dirname(file), path) : file;
      const ok = existsSync(target) && (!frag || (target.endsWith(".md") && anchors(target).has(frag.toLowerCase())));
      if (!ok) { bad++; console.log(`${relative(root, file)}:${i + 1}  broken link: ${href}`); }
    }
  });
}
console.log(bad ? `${bad} broken link(s)` : "all links ok");
process.exit(bad ? 1 : 0);
