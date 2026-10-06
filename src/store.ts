import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Ev, Logged } from "./game";

// Two tables: an append-only event log per game, and a generic document table for everything
// else (games, venues, sponsors, airings, settings). ponytail: JSON docs, listed and filtered in memory;
// move to real columns if a list ever passes a few thousand rows.
export type Store = ReturnType<typeof openStore>;

// Ordered, append-only. Index + 1 is the schema version stored in PRAGMA user_version.
// Never edit a shipped migration; add a new one. Each runs once, inside a transaction.
export const MIGRATIONS: ((db: Database) => void)[] = [
  // v1: the original schema (idempotent, so a pre-versioning database at user_version 0 adopts it unchanged)
  (db) => {
    db.run("CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, game TEXT NOT NULL, t INTEGER NOT NULL, body TEXT NOT NULL)");
    db.run("CREATE INDEX IF NOT EXISTS events_game ON events (game, seq)");
    db.run("CREATE TABLE IF NOT EXISTS docs (kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (kind, id))");
  },
];

export function migrate(db: Database, migrations = MIGRATIONS) {
  const cur = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (cur > migrations.length) throw new Error(`This data was made by a newer version of Fieldhouse (schema ${cur}). Update Fieldhouse, or the data may be damaged.`);
  for (let v = cur; v < migrations.length; v++) {
    db.transaction(() => { migrations[v](db); db.run(`PRAGMA user_version = ${v + 1}`); })();
  }
  return migrations.length;
}

export function openStore(path = "data/fieldhouse.db") {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.run("PRAGMA journal_mode = WAL"); // survives a killed process (crash recovery)
  migrate(db);

  const ins = db.query("INSERT INTO events (game, t, body) VALUES (?, ?, ?) RETURNING seq");
  const sel = db.query("SELECT seq, t, body FROM events WHERE game = ? ORDER BY seq");
  const put = db.query("INSERT INTO docs (kind, id, body) VALUES (?, ?, ?) ON CONFLICT (kind, id) DO UPDATE SET body = excluded.body");
  const get = db.query("SELECT body FROM docs WHERE kind = ? AND id = ?");
  const list = db.query("SELECT body FROM docs WHERE kind = ? ORDER BY rowid");
  const del = db.query("DELETE FROM docs WHERE kind = ? AND id = ?");

  return {
    append(game: string, e: Ev, t = Date.now()): Logged {
      const { seq } = ins.get(game, t, JSON.stringify(e)) as { seq: number };
      return { ...e, seq, t } as Logged;
    },
    load(game: string): Logged[] {
      return (sel.all(game) as { seq: number; t: number; body: string }[]).map((r) => ({ ...JSON.parse(r.body), seq: r.seq, t: r.t }));
    },
    put<T extends { id: string }>(kind: string, doc: T): T { put.run(kind, doc.id, JSON.stringify(doc)); return doc; },
    get<T>(kind: string, id: string): T | undefined { const r = get.get(kind, id) as { body: string } | null; return r ? JSON.parse(r.body) : undefined; },
    list<T>(kind: string): T[] { return (list.all(kind) as { body: string }[]).map((r) => JSON.parse(r.body)); },
    del(kind: string, id: string) { del.run(kind, id); },
    version: () => (db.query("PRAGMA user_version").get() as { user_version: number }).user_version,
    /** Consistent copy of the live database (safe under WAL). The target must not exist. */
    backupTo(file: string) { mkdirSync(dirname(file), { recursive: true }); db.run(`VACUUM INTO '${file.replace(/'/g, "''")}'`); },
    close: () => db.close(),
  };
}

/** One backup per calendar day (fieldhouse-YYYY-MM-DD.db), newest `keep` retained. Returns the file written, or null if today's exists. */
export function dailyBackup(store: Store, dir: string, now = Date.now(), keep = 7): string | null {
  const day = new Date(now).toISOString().slice(0, 10);
  const file = join(dir, `fieldhouse-${day}.db`);
  let wrote: string | null = null;
  if (!existsSync(file)) { store.backupTo(file); wrote = file; }
  const all = readdirSync(dir).filter((f) => /^fieldhouse-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
  for (const f of all.slice(0, Math.max(0, all.length - keep))) rmSync(join(dir, f), { force: true });
  return wrote;
}
