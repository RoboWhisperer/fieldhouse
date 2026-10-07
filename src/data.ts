// Domain documents on top of the generic docs table: settings, destinations, games, venues, roster import, demo data.
import { paths } from "./config";
import type { DestinationDoc, DestinationView, GameDoc, Player, SettingsDoc, VenueDoc } from "./types";
import type { Store } from "./store";
import { DEFAULT_VIDEO, validateVideo } from "./video-settings";
import { DEFAULT_UI, validateUi, withUiDefaults } from "./automation/ui-settings";
import { BASKETBALL } from "./profiles/builtins";
import { applyLegacy, legacyView } from "./profiles/lib";
import { DEFAULT_PROFILE_ID, getProfile, saveProfile } from "./profiles/store";

export const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === "object" && !Array.isArray(x);
const intIn = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

// ---------------------------------------------------------------- settings
export function newCode() {
  const words = ["WILD", "HOOP", "COURT", "DUNK", "TIP", "SWISH"];
  const n = crypto.getRandomValues(new Uint32Array(2));
  return `${words[n[0] % words.length]}-${1000 + (n[1] % 9000)}`;
}

export function defaultSettings(): SettingsDoc {
  return {
    theme: "hardwood", showLogos: true, showSponsorCorner: true,
    profile: { periods: 4, periodMin: 8, overtimeMin: 4, bonusAt: 5, timeouts: 3 },
    shortcuts: {
      cut: "Enter", fade: "Shift+Enter", preview1: "1", preview2: "2", preview3: "3", preview4: "4",
      clock: "c", replay: "r", replayScore: "Shift+R", mark: "m", fireSponsor: "f",
      homePlus1: "q", homePlus2: "w", homePlus3: "e", awayPlus1: "i", awayPlus2: "o", awayPlus3: "p", undo: "Ctrl+Z",
    },
    storageDir: paths().recordings, retention: "never", lowSpaceGb: 40,
    remote: { requireCode: true, code: newCode(), lockedToLan: true, enabled: false, port: 8081, producerCanBroadcast: false },
    telemetry: false, autoFireSponsors: false,
    video: { ...DEFAULT_VIDEO },
    ui: DEFAULT_UI(),
    engine: { kind: paths().packaged && process.env.DEMO !== "1" && process.env.ENGINE !== "fake" ? "obs" : "fake", obsUrl: "ws://127.0.0.1:4455" },
  };
}

export function getSettings(store: Store): SettingsDoc {
  const saved = store.get<SettingsDoc & { id: string }>("settings", "main");
  const d = defaultSettings();
  // The old five-field "profile" is now a view of the built-in basketball profile, so old screens and new profile docs never disagree.
  const merged = { ...d, ...saved, defaultProfileId: saved?.defaultProfileId ?? DEFAULT_PROFILE_ID, profile: legacyView(getProfile(store, "basketball") ?? BASKETBALL), remote: { ...d.remote, ...saved?.remote }, engine: { ...d.engine, ...saved?.engine }, video: { ...d.video, ...saved?.video }, ui: withUiDefaults(saved?.ui), shortcuts: { ...d.shortcuts, ...saved?.shortcuts } };
  if (!saved) store.put("settings", { id: "main", ...merged });
  const { id: _id, ...out } = merged as any;
  return out;
}

/** What the API and WebSocket may show: the OBS password is write-only, only whether one is set goes out. */
export function settingsView(s: SettingsDoc): SettingsDoc {
  const { obsPassword, ...engine } = s.engine;
  return { ...s, engine: { ...engine, obsPasswordSet: !!obsPassword } };
}

const bool = (v: unknown, name: string) => { if (typeof v !== "boolean") throw new Error(`${name} must be true or false`); };

export function saveSettings(store: Store, patch: unknown): SettingsDoc {
  if (!isObj(patch)) throw new Error("Settings must be an object");
  const cur = getSettings(store);
  const next: any = { ...cur };
  let legacy: Partial<SettingsDoc["profile"]> | undefined;
  for (const [k, v] of Object.entries(patch)) {
    switch (k) {
      case "theme": if (!["hardwood", "midnight", "clean", "contrast"].includes(v)) throw new Error("Unknown theme"); next.theme = v; break;
      case "showLogos": case "showSponsorCorner": case "telemetry": case "autoFireSponsors": bool(v, k); next[k] = v; break;
      case "retention": if (!["never", "90d", "season"].includes(v)) throw new Error("Retention must be never, 90d or season"); next.retention = v; break;
      case "lowSpaceGb": if (typeof v !== "number" || !(v >= 1 && v <= 10_000)) throw new Error("Low-space warning must be between 1 and 10000 GB"); next.lowSpaceGb = v; break;
      case "storageDir": if (typeof v !== "string" || !v.trim() || v.length > 300) throw new Error("Recording folder must be a path"); next.storageDir = v.trim(); break;
      case "activeGameId": if (v !== undefined && typeof v !== "string") throw new Error("activeGameId must be text"); next.activeGameId = v; break;
      case "profile": {
        if (!isObj(v)) throw new Error("profile must be an object");
        const ranges: Record<string, [number, number]> = { periods: [1, 8], periodMin: [1, 60], overtimeMin: [1, 30], bonusAt: [1, 20], timeouts: [0, 20] };
        next.profile = { ...cur.profile };
        for (const [pk, pv] of Object.entries(v)) {
          if (!ranges[pk]) throw new Error(`Unknown sport profile field: ${pk}`);
          if (!intIn(pv, ...ranges[pk])) throw new Error(`${pk} must be a whole number from ${ranges[pk][0]} to ${ranges[pk][1]}`);
          next.profile[pk] = pv;
        }
        legacy = Object.fromEntries(Object.keys(v).map((pk) => [pk, next.profile[pk]]));
        break;
      }
      case "defaultProfileId": if (typeof v !== "string" || !getProfile(store, v)) throw new Error("Pick one of your sport profiles as the default."); next.defaultProfileId = v; break;
      case "shortcuts": {
        if (!isObj(v)) throw new Error("shortcuts must be an object");
        next.shortcuts = { ...cur.shortcuts };
        for (const [a, key] of Object.entries(v)) {
          if (!(a in cur.shortcuts)) throw new Error(`Unknown shortcut: ${a}`);
          if (typeof key !== "string" || !key || key.length > 20) throw new Error(`Shortcut for ${a} must be a key`);
          next.shortcuts[a] = key;
        }
        break;
      }
      case "engine": {
        if (!isObj(v)) throw new Error("engine must be an object");
        next.engine = { ...cur.engine };
        for (const [ek, ev] of Object.entries(v)) {
          if (ek === "kind") { if (ev !== "fake" && ev !== "obs") throw new Error("Engine must be fake or obs"); }
          else if (ek === "obsUrl") { if (typeof ev !== "string" || !/^wss?:\/\/[^\s/]+(:\d+)?\/?$/.test(ev.trim())) throw new Error("The OBS address must look like ws://127.0.0.1:4455"); }
          else if (ek === "obsPassword") { if (typeof ev !== "string" || ev.length > 200) throw new Error("The OBS password is too long"); }
          else if (ek !== "obsPasswordSet") throw new Error(`Unknown engine field: ${ek}`);
          if (ek !== "obsPasswordSet") next.engine[ek] = typeof ev === "string" ? ev.trim() : ev;
        }
        break;
      }
      case "ui": next.ui = validateUi(v, cur.ui); break; // looks, layouts, macro buttons (src/automation/ui-settings.ts)
      case "video": next.video = validateVideo(v, cur.video); break; // quality, encoder, format, replay length (src/video-settings.ts)
      case "remote": {
        if (!isObj(v)) throw new Error("remote must be an object");
        next.remote = { ...cur.remote };
        for (const [rk, rv] of Object.entries(v)) {
          if (rk === "code") { if (typeof rv !== "string" || !/^[A-Za-z0-9-]{4,16}$/.test(rv)) throw new Error("Remote code must be 4-16 letters, digits or dashes"); }
          else if (rk === "requireCode" || rk === "lockedToLan" || rk === "enabled" || rk === "producerCanBroadcast") bool(rv, rk);
          else if (rk === "port") { if (!intIn(rv, 1024, 65535)) throw new Error("Port must be a whole number from 1024 to 65535"); }
          else throw new Error(`Unknown remote field: ${rk}`);
          next.remote[rk] = rv;
        }
        break;
      }
      default: throw new Error(`Unknown setting: ${k}`);
    }
  }
  if (legacy) saveProfile(store, applyLegacy(getProfile(store, "basketball") ?? BASKETBALL, legacy), "basketball"); // after every check passed
  store.put("settings", { id: "main", ...next });
  return next;
}

// ---------------------------------------------------------------- destinations
export const destinationView = ({ key, ...d }: DestinationDoc): DestinationView => ({ ...d, keySet: !!key });
export const listDestinations = (store: Store): DestinationView[] => store.list<DestinationDoc>("destination").map(destinationView);
export const getDestinationWithKey = (store: Store, id: string) => store.get<DestinationDoc>("destination", id);

/** Every install can record to this computer: a clean database gets this destination so Setup and Preflight never dead-end. */
export const LOCAL_REC = "dest_local";
export function ensureLocalRecording(store: Store) {
  if (!store.list<DestinationDoc>("destination").some((d) => d.kind === "record")) saveDestination(store, { id: LOCAL_REC, kind: "record", name: "Record to this computer", enabled: true });
}

const DEFAULT_URL: Record<string, string> = { youtube: "rtmp://a.rtmp.youtube.com/live2", facebook: "rtmps://live-api-s.facebook.com:443/rtmp/" };

export function saveDestination(store: Store, input: any): DestinationView {
  if (!isObj(input)) throw new Error("Destination must be an object");
  if (!["youtube", "facebook", "rtmp", "srt", "record"].includes(input.kind)) throw new Error("Unknown destination type");
  if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 60) throw new Error("Give the destination a name (up to 60 characters)");
  const existing = typeof input.id === "string" ? getDestinationWithKey(store, input.id) : undefined;
  const d: DestinationDoc = { id: typeof input.id === "string" && input.id ? input.id : newId("dest"), kind: input.kind, name: input.name.trim(), enabled: input.enabled !== false };
  if (input.kind !== "record") {
    const url = (typeof input.url === "string" && input.url.trim()) || DEFAULT_URL[input.kind];
    if (!url || !/^(rtmps?|srt):\/\/[^\s/]+/.test(url)) throw new Error("The address must start with rtmp://, rtmps:// or srt://");
    d.url = url;
    const key = typeof input.key === "string" && input.key.trim() ? input.key.trim() : existing?.key;
    if (key) d.key = key;
  }
  return destinationView(store.put("destination", d));
}

// ---------------------------------------------------------------- roster CSV
type Mapping = { number: string; name: string; position: string };
export interface RosterParse { columns: string[]; mapping: Mapping; players: Player[]; warnings: { row: number; message: string }[] }
const MAX_PLAYERS = 40;

function parseRows(text: string): string[][] {
  text = text.replace(/^﻿/, "");
  const first = text.split(/\r?\n/, 1)[0];
  const delim = [",", ";", "\t"].map((c) => [c, first.split(c).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim())) rows.push(row.map((x) => x.trim()));
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row.map((x) => x.trim()));
  return rows;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9#]/g, "");
const find = (cols: string[], names: string[]) => cols.find((c) => names.includes(norm(c))) ?? "";

function detect(cols: string[]): Mapping {
  const first = find(cols, ["firstname", "first"]), last = find(cols, ["lastname", "last", "surname"]);
  const name = find(cols, ["name", "player", "playername", "fullname"]) || (first && last ? `${first}+${last}` : last || first);
  return { number: find(cols, ["jerseyno", "jersey", "jerseynumber", "number", "#", "no", "num"]), name, position: find(cols, ["pos", "position"]) };
}

export function parseRosterCsv(text: string, mapping?: Partial<Mapping>): RosterParse {
  const rows = parseRows(String(text ?? ""));
  if (!rows.length) return { columns: [], mapping: { number: "", name: "", position: "" }, players: [], warnings: [{ row: 1, message: "The file is empty" }] };
  let columns = rows[0];
  let detected = detect(columns);
  let data = rows.slice(1), rowBase = 2; // rowBase = spreadsheet row of data[0]
  // No recognisable header and the first cell looks like a jersey number: treat row 1 as a player.
  if (!detected.number && !detected.name && /^#?\d{1,3}$/.test(rows[0][0])) {
    columns = rows[0].map((_, i) => `Column ${i + 1}`);
    detected = { number: columns[0], name: columns[1] ?? "", position: columns[2] ?? "" };
    data = rows; rowBase = 1;
  }
  const m: Mapping = { ...detected, ...Object.fromEntries(Object.entries(mapping ?? {}).filter(([, v]) => typeof v === "string")) };
  const idx = (c: string) => columns.indexOf(c);
  const nameCols = m.name.split("+").map(idx);
  const warnings: RosterParse["warnings"] = [];
  const players: Player[] = [];
  const rowOf: number[] = [];
  let capped = false;
  const cell = (r: string[], i: number) => (i >= 0 ? r[i] ?? "" : "");
  if (idx(m.number) < 0) warnings.push({ row: 1, message: "Pick which column holds jersey numbers" });
  if (nameCols.some((i) => i < 0)) warnings.push({ row: 1, message: "Pick which column holds player names" });

  data.forEach((r, i) => {
    const row = rowBase + i;
    if (players.length >= MAX_PLAYERS) { if (!capped) warnings.push({ row, message: `Only the first ${MAX_PLAYERS} players were imported` }); capped = true; return; }
    const number = cell(r, idx(m.number)).replace(/^#/, "");
    const name = nameCols.map((c) => cell(r, c)).filter(Boolean).join(" ");
    if (!name) warnings.push({ row, message: "This row has no player name" });
    if (number && !/^\d{1,3}$/.test(number)) warnings.push({ row, message: `"${number}" is not a jersey number` });
    if (!number) warnings.push({ row, message: "This row has no jersey number" });
    players.push({ number, name, position: cell(r, idx(m.position)), starter: false });
    rowOf.push(row);
  });
  const seen = new Map<string, number[]>();
  players.forEach((p, i) => { if (p.number) seen.set(p.number, [...(seen.get(p.number) ?? []), rowOf[i]]); });
  for (const [n, rs] of seen) if (rs.length > 1) for (const row of rs) warnings.push({ row, message: `Jersey number ${n} is used more than once` });
  warnings.sort((a, b) => a.row - b.row);
  return { columns, mapping: m, players, warnings };
}

// ---------------------------------------------------------------- games and venues
export const listGames = (store: Store) => store.list<GameDoc>("game");
export const getGame = (store: Store, id: string) => store.get<GameDoc>("game", id);
export const listVenues = (store: Store) => store.list<VenueDoc>("venue");

function checkTeam(t: any, side: string) {
  if (!isObj(t) || typeof t.name !== "string" || !t.name.trim() || t.name.length > 40) throw new Error(`${side} team needs a name`);
  if (typeof t.abbr !== "string" || !t.abbr.trim() || t.abbr.length > 8) throw new Error(`${side} team needs an abbreviation (up to 8 characters)`);
  const roster = t.roster ?? [];
  if (!Array.isArray(roster) || roster.length > MAX_PLAYERS) throw new Error(`${side} roster can have at most ${MAX_PLAYERS} players`);
  return {
    name: t.name.trim(), abbr: t.abbr.trim().toUpperCase(), color: /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : "#888888",
    roster: roster.map((p: any) => ({ number: String(p?.number ?? "").slice(0, 3), name: String(p?.name ?? "").slice(0, 60), position: String(p?.position ?? "").slice(0, 12), starter: !!p?.starter })),
  };
}

export function saveGame(store: Store, input: any): GameDoc {
  if (!isObj(input)) throw new Error("Game must be an object");
  if (!Number.isFinite(input.startsAt)) throw new Error("Pick a date and time for the game");
  const status = input.status ?? "scheduled";
  if (!["scheduled", "live", "final"].includes(status)) throw new Error("Unknown game status");
  const home = checkTeam(input.home, "Home"), away = checkTeam(input.away, "Away");
  // Sport: a game that has started keeps its frozen profile; before that the operator may pick any profile (default = Settings).
  const before = typeof input.id === "string" && input.id ? getGame(store, input.id) : undefined;
  const wanted = typeof input.profileId === "string" && input.profileId ? input.profileId : before?.profileId ?? getSettings(store).defaultProfileId ?? DEFAULT_PROFILE_ID;
  const prof = before?.profileSnapshot ?? getProfile(store, wanted) ?? (() => { throw new Error("That sport profile does not exist. Pick another sport."); })();
  if (before?.profileSnapshot && wanted !== before.profileId && input.profileId) throw new Error("This game has already started, so its sport can't be changed.");
  const g: GameDoc = {
    id: typeof input.id === "string" && input.id ? input.id : newId("game"),
    title: typeof input.title === "string" && input.title.trim() ? input.title.trim().slice(0, 100) : `${home.name} vs ${away.name}`,
    startsAt: input.startsAt, venueId: String(input.venueId ?? ""), sport: prof.sport, profileId: before?.profileSnapshot ? before.profileId : prof.id, ...(before?.profileSnapshot && { profileSnapshot: before.profileSnapshot }), home, away,
    destinationIds: Array.isArray(input.destinationIds) ? input.destinationIds.filter((x: unknown) => typeof x === "string") : [],
    status,
  };
  if (isObj(input.finalScore) && Number.isInteger(input.finalScore.home) && Number.isInteger(input.finalScore.away)) g.finalScore = { home: input.finalScore.home, away: input.finalScore.away };
  if (typeof input.recordingId === "string") g.recordingId = input.recordingId;
  return store.put("game", g);
}

export function saveVenue(store: Store, input: any): VenueDoc {
  if (!isObj(input) || typeof input.name !== "string" || !input.name.trim()) throw new Error("Give the venue a name");
  const slots = input.slots ?? [];
  if (!Array.isArray(slots) || slots.length > 4) throw new Error("A venue has at most 4 source slots");
  const v: VenueDoc = {
    id: typeof input.id === "string" && input.id ? input.id : newId("venue"), name: input.name.trim().slice(0, 60), updatedAt: Date.now(),
    slots: slots.map((s: any) => {
      if (!intIn(s?.slot, 1, 4)) throw new Error("Source slots are numbered 1 to 4");
      return { slot: s.slot, deviceId: String(s.deviceId ?? ""), label: String(s.label ?? "").slice(0, 40) };
    }),
  };
  return store.put("venue", v);
}

// ---------------------------------------------------------------- demo data (explicit call only)
const roster = (names: string[], pos = ["PG", "SG", "SF", "PF", "C"]): Player[] =>
  names.map((name, i) => ({ number: String([3, 4, 5, 10, 11, 12, 15, 20, 21, 23, 24, 32][i]), name, position: pos[i % 5], starter: i < 5 }));
const WILDCATS = ["Jordan Reyes", "Sam Okafor", "Mia Chen", "Luis Ortega", "Dre Washington", "Eli Brandt", "Noah Kim", "Theo Banks", "Cole Rivera", "Ty Nguyen", "Alex Moore", "Jack Silva"];
const LIONS = ["Ben Carter", "Marcus Hale", "Owen Pratt", "Isaac Dunn", "Kai Foster", "Leo Grant", "Max Ellis", "Ray Soto", "Finn Walsh", "Zane Price", "Gus Lowe"];

export function seedDemo(store: Store) {
  if (listGames(store).length) return;
  const now = Date.now(), H = 3_600_000, D = 24 * H;
  const venue = saveVenue(store, { id: "venue_demo", name: "Main Gym", slots: [
    { slot: 1, deviceId: "usb-brio", label: "Center court" }, { slot: 2, deviceId: "usb-camlink", label: "Baseline" },
    { slot: 3, deviceId: "ndi-coach", label: "Bench" }, { slot: 4, deviceId: "screen-scoreboard", label: "Scoreboard screen" }] });
  saveDestination(store, { id: "dest_demo_yt", kind: "youtube", name: "YouTube (demo)", key: "demo-key", enabled: true });
  ensureLocalRecording(store);
  const rules = (triggers: any[], minGapMinutes: number, maxPerSeason: number, priority: number) => ({ triggers, minGapMinutes, maxPerSeason, priority });
  const sponsors = [
    ["sponsor_demo_dental", "Smith Dental", "SMITH", "#2b8cbe", rules(["timeout", "period_end"], 8, 20, 1)],
    ["sponsor_demo_pizza", "Harbor Pizza", "HARBOR", "#d95f0e", rules(["halftime", "postgame", "timeout"], 10, 15, 2)],
    ["sponsor_demo_cu", "Eastside Credit Union", "EASTSIDE", "#238b45", rules(["pregame", "halftime", "postgame"], 15, 12, 3)],
  ] as const;
  for (const [id, name, abbr, color, r] of sponsors)
    store.put("sponsor", { id, name, abbr, color, assets: [{ kind: "image", name: `${abbr.toLowerCase()}-logo.png` }], displaySeconds: 15, rules: r });

  const team = (name: string, abbr: string, color: string, players: string[]) => ({ name, abbr, color, roster: roster(players) });
  const wild = team("Wildcats", "WILD", "#1d4ed8", WILDCATS), lions = team("Lions", "LIONS", "#b45309", LIONS);
  const dests = ["dest_demo_yt", LOCAL_REC];
  saveGame(store, { id: "game_demo_tonight", title: "Wildcats vs Lions (demo)", startsAt: now + 2 * H, venueId: venue.id, home: wild, away: lions, destinationIds: dests, status: "scheduled" });
  const rivals: [string, string][] = [["Hawks", "HAWK"], ["Tigers", "TIGR"], ["Bears", "BEAR"], ["Eagles", "EAGL"]];
  rivals.forEach(([n, a], i) => {
    const id = `game_demo_final${i + 1}`;
    const startsAt = now - (i + 1) * 7 * D;
    saveGame(store, { id, title: `Wildcats vs ${n} (demo)`, startsAt, venueId: venue.id, home: wild, away: team(n, a, "#6b7280", LIONS), destinationIds: dests, status: "final", finalScore: { home: 52 + i * 3, away: 47 + i * 2 } });
    const air = (sp: number, trigger: any, min: number, period: number, outcome = "aired", seconds = 15) =>
      store.put("airing", { id: `airing_demo_${i}_${min}_${sp}`, gameId: id, sponsorId: sponsors[sp][0], at: startsAt + min * 60_000, period, gameClockMs: 240_000, trigger, outcome, seconds });
    air(2, "pregame", -5, 1); air(0, "timeout", 12, 1); air(1, "halftime", 40, 2, i === 2 ? "skipped" : "aired"); air(0, "timeout", 62, 3, i === 3 ? "delayed" : "aired"); air(1, "postgame", 100, 4);
  });
}

/** Freeze the game's sport rules. Called when the game starts (first activation); a game that already has one keeps it. */
export function snapshotProfile(store: Store, id: string): GameDoc {
  const g = getGame(store, id)!;
  if (g.profileSnapshot) return g;
  const prof = getProfile(store, g.profileId || getSettings(store).defaultProfileId || DEFAULT_PROFILE_ID) ?? getProfile(store, DEFAULT_PROFILE_ID) ?? BASKETBALL;
  return store.put("game", { ...g, sport: prof.sport, profileId: prof.id, profileSnapshot: structuredClone(prof) });
}
