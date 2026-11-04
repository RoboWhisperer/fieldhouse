// Append-only operator audit trail: who changed what and when. Never store secrets in here.
import { scrub } from "./diagnostics";
import type { Store } from "./store";

export interface AuditDoc {
  id: string;
  at: number;
  actor: string; // "console", "remote", "producer", "system" or a device name
  action: string; // e.g. "game.deleted"
  target?: string;
  detail?: Record<string, unknown>;
}

export const AUDIT_CAP = 10_000;
const DROP = /^(key|password|token|code|secret|headers|obsPassword|tokenHash)$/i;

/** Plain data only, depth-limited, secret-looking keys and text removed. */
export function auditSafe(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return scrub(v).slice(0, 500);
  if (typeof v === "number" || typeof v === "boolean" || v === null || v === undefined) return v;
  if (depth >= 6) return "[deep]";
  if (Array.isArray(v)) return v.slice(0, 100).map((x) => auditSafe(x, depth + 1));
  if (typeof v === "object") {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !DROP.test(k)).slice(0, 50).map(([k, x]) => [k, auditSafe(x, depth + 1)]));
  }
  return String(v);
}

export interface AuditInput {
  action: string;
  actor?: string;
  target?: string;
  detail?: Record<string, unknown>;
}

export function addAudit(store: Store, input: AuditInput, at = Date.now()): AuditDoc {
  const doc: AuditDoc = {
    id: `aud_${crypto.randomUUID().slice(0, 13)}`,
    at,
    actor: input.actor?.slice(0, 80) || "console",
    action: input.action.slice(0, 80),
    ...(input.target ? { target: input.target.slice(0, 120) } : {}),
    ...(input.detail ? { detail: auditSafe(input.detail) as Record<string, unknown> } : {}),
  };
  store.put("audit", doc);
  const rows = store.list<AuditDoc>("audit");
  for (const old of rows.slice(0, Math.max(0, rows.length - AUDIT_CAP))) store.del("audit", old.id);
  return doc;
}

export interface AuditQuery {
  limit?: number;
  action?: string;
  target?: string;
  since?: number;
  before?: number;
}

/** Newest first. At most 1000 rows per request. */
export function listAudit(store: Store, q: AuditQuery = {}): AuditDoc[] {
  let rows = store.list<AuditDoc>("audit").sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
  if (q.action) rows = rows.filter((r) => r.action === q.action);
  if (q.target) rows = rows.filter((r) => r.target === q.target);
  if (Number.isFinite(q.since)) rows = rows.filter((r) => r.at >= q.since!);
  if (Number.isFinite(q.before)) rows = rows.filter((r) => r.at < q.before!);
  return rows.slice(0, Math.min(Math.max(Math.trunc(q.limit ?? 100), 1), 1000));
}
