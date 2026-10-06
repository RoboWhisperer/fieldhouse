// Update check. The ONLY outbound call Fieldhouse makes on its own, and only when the operator asks.
// Sends a plain GET to the public GitHub releases API: no identifiers, no cookies, no body.
export const DEFAULT_REPO = "RoboWhisperer/fieldhouse";
export type UpdateResult =
  | { status: "current"; current: string; latest: string; checkedAt: number }
  | { status: "available"; current: string; latest: string; url: string; notes: string; checkedAt: number }
  | { status: "unavailable"; current: string; reason: "offline" | "no-release" | "error"; checkedAt: number };

const HOUR = 3_600_000;
export const TTL = 6 * HOUR, TIMEOUT_MS = 4000, MIN_RETRY_MS = 15_000;

/** "v1.2.3-beta.1" or "1.0 beta" -> numbers + prerelease tag. */
export function parseVersion(v: string) {
  const m = /(\d+(?:\.\d+)*)\s*[-. ]?\s*([A-Za-z][\w.]*)?/.exec(v.trim().replace(/^v/i, ""));
  const nums = (m?.[1] ?? "0").split(".").map(Number);
  while (nums.length < 3) nums.push(0);
  return { nums, pre: m?.[2] ?? "" };
}
/** <0 when a is older than b. A prerelease sorts before the same number without one. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a), y = parseVersion(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) { const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0); if (d) return d < 0 ? -1 : 1; }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  // semver precedence: dot-separated parts, numeric parts compared as numbers (beta.2 < beta.10)
  const p = x.pre.split("."), q = y.pre.split(".");
  for (let i = 0; i < Math.max(p.length, q.length); i++) {
    if (p[i] === undefined) return -1; if (q[i] === undefined) return 1;
    const a = /^\d+$/.test(p[i]), b = /^\d+$/.test(q[i]);
    if (a && b) { const d = +p[i] - +q[i]; if (d) return d < 0 ? -1 : 1; } else if (p[i] !== q[i]) return p[i] < q[i] ? -1 : 1;
  }
  return 0;
}

export function createUpdateChecker(opts: { current: string; fetch?: typeof fetch; now?: () => number; repo?: string }) {
  const f = opts.fetch ?? fetch, now = opts.now ?? Date.now;
  const repo = (opts.repo ?? process.env.FIELDHOUSE_UPDATE_REPO ?? DEFAULT_REPO).trim();
  let cached: UpdateResult | null = null, lastTry = 0;
  return async function check(force = false): Promise<UpdateResult> {
    const t = now();
    const fail = (reason: "offline" | "no-release" | "error"): UpdateResult => ({ status: "unavailable", current: opts.current, reason, checkedAt: t });
    if (cached && !force && t - cached.checkedAt < TTL) return cached;
    if (lastTry && t - lastTry < MIN_RETRY_MS) return cached ?? fail("offline"); // button mashing never becomes request spam
    lastTry = t;
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return fail("error");
    try {
      // /releases/latest never returns pre-releases (it 404s while only betas exist), so list recent releases and choose ourselves.
      const r = await f(`https://api.github.com/repos/${repo}/releases?per_page=15`, { headers: { accept: "application/vnd.github+json", "user-agent": "Fieldhouse-update-check" }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" });
      if (r.status === 404) return fail("no-release");
      if (!r.ok) return fail("error");
      const list: any = await r.json();
      if (!Array.isArray(list)) return fail("error");
      const mine = parseVersion(opts.current);
      // Drafts are never offered. Pre-releases are offered only to someone already on a pre-release.
      const usable = list.filter((x: any) => x && !x.draft && typeof x.tag_name === "string" && x.tag_name && (mine.pre || (!x.prerelease && !parseVersion(x.tag_name).pre)));
      if (!usable.length) return fail("no-release");
      const j: any = usable.reduce((a: any, b: any) => (compareVersions(a.tag_name, b.tag_name) >= 0 ? a : b));
      const latest = String(j.tag_name);
      const link = typeof j.html_url === "string" && j.html_url.startsWith("https://github.com/") ? j.html_url : `https://github.com/${repo}/releases`;
      cached = compareVersions(opts.current, latest) < 0
        ? { status: "available", current: opts.current, latest: latest.replace(/^v/i, ""), url: link, notes: String(j.body ?? "").slice(0, 1500), checkedAt: t }
        : { status: "current", current: opts.current, latest: latest.replace(/^v/i, ""), checkedAt: t };
      return cached;
    } catch { return fail("offline"); }
  };
}
