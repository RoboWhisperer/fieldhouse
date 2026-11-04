// Portable data export. Everything here is safe to hand to an auditor: write-only secrets are removed.
import { getSettings, listDestinations, listGames, listVenues, settingsView } from "./data";
import { listAudit } from "./audit";
import { stripSecrets, stripUrl } from "./automation/model";
import type { Store } from "./store";

const rows = <T>(store: Store, kind: string) => store.list<T>(kind);

export function exportBundle(store: Store, version = "", at = Date.now()) {
  const settings: any = settingsView(getSettings(store));
  delete settings.remote?.code;

  const games = listGames(store);
  return {
    format: "fieldhouse-export",
    formatVersion: 1,
    appVersion: version,
    exportedAt: new Date(at).toISOString(),
    settings,
    games,
    events: Object.fromEntries(games.map((g) => [g.id, store.load(g.id)])),
    venues: listVenues(store),
    destinations: listDestinations(store),
    sponsors: rows(store, "sponsor"),
    airings: rows(store, "airing"),
    profiles: rows(store, "profile"),
    devices: rows<any>(store, "device").map(({ tokenHash: _hash, ...d }) => d),
    recordings: rows<any>(store, "recording").map(({ file: _file, ...r }) => r),
    custom: rows(store, "custom"),
    graphics: rows(store, "graphic"),
    connectors: rows<any>(store, "connector").map(({ secret: _secret, ...c }) => c),
    rules: rows<any>(store, "rule").map((r) => ({ ...r, actions: stripSecrets(r.actions ?? []) })),
    macros: rows<any>(store, "macro").map((m) => ({ ...m, actions: stripSecrets(m.actions ?? []) })),
    webhooks: rows<any>(store, "webhook").map(({ secret: _secret, ...w }) => ({ ...w, url: stripUrl(w.url ?? "") })),
    audit: listAudit(store, { limit: 1000 }),
  };
}
