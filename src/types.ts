// Shared contract between engine, domain modules, server and web UI. Change here first, then everywhere.
import type { Team } from "./game";
export type { Team };

// ---------------------------------------------------------------- engine
export interface DeviceInfo { id: string; label: string; kind: "usb" | "ndi" | "srt" | "screen" | "audio" | "test"; detail: string; inUse: boolean }
export interface SourceInfo {
  id: string; // stable id, e.g. "cam1"
  slot: number; // 1-4
  deviceId?: string; // the DeviceInfo assigned to this slot (so slots survive reloads and venue apply)
  label: string; // "Center court"
  kind: DeviceInfo["kind"];
  detail: string; // "1080p60"
  status: "ok" | "reconnecting" | "missing";
  audio: number; // 0..1 level
}
export interface MixerChannel { id: string; label: string; level: number; gainDb: number; muted: boolean }
export interface EngineStatus {
  engine: "fake" | "obs";
  connected: boolean;
  program: string | null; // source id on air
  preview: string | null; // source id next
  replay: { active: boolean };
  sources: SourceInfo[];
  mixer: MixerChannel[];
  stream: { live: boolean; destination?: string; startedAt?: number; kbps: number; droppedFrames: number; reconnecting: boolean };
  record: { active: boolean; file?: string; startedAt?: number; bytes: number };
  cpu: number; // 0..100
  diskFreeBytes: number;
  graphicsInProgram: boolean; // true: the overlay is composed inside the engine (OBS), so the UI must not draw its own score bug
  obs?: { version?: string; profile?: string; provisioned: boolean; replayBuffer: boolean; error?: string; created: string[]; notes: string[] }; // OBS engine only
}
export interface Engine {
  status(): EngineStatus; // cheap sync snapshot
  onChange(cb: () => void): () => void; // returns unsubscribe
  detectDevices(): Promise<DeviceInfo[]>;
  setSlot(slot: number, deviceId: string | null, label?: string): Promise<void>;
  setPreview(sourceId: string): Promise<void>;
  cut(): Promise<void>; // swap preview and program
  fade(ms: number): Promise<void>;
  startStream(dest: { name: string; url: string; key: string }): Promise<void>;
  stopStream(): Promise<void>;
  startRecord(dir: string, basename: string): Promise<string>; // returns the file path
  stopRecord(): Promise<void>;
  setMute(mixerId: string, muted: boolean): Promise<void>;
  setGain(mixerId: string, gainDb: number): Promise<void>;
  replay(opts: { secondsBack: number; speed: number }): Promise<void>; // plays the buffer into program
  stopReplay(): Promise<void>;
  snapshot(sourceId: string): Promise<{ type: string; body: Uint8Array } | null>; // still image for monitors/tiles; "program"/"preview" = what is on air / next, with graphics
  addNetworkSource?(url: string, label: string): Promise<DeviceInfo>; // srt/rtmp/rtsp/http(s) stream or local video file; use the returned id with setSlot
  provision?(): Promise<void>; // (re)create what the engine needs inside the media app (OBS scenes etc.)
  close(): Promise<void>;
}

// ---------------------------------------------------------------- documents (SQLite `docs` table)
export interface Player { number: string; name: string; position: string; starter: boolean }
export interface TeamDoc { name: string; abbr: string; color: string; roster: Player[] }
export interface GameDoc {
  id: string;
  title: string;
  startsAt: number; // ms epoch
  venueId: string;
  sport: "basketball";
  home: TeamDoc;
  away: TeamDoc;
  destinationIds: string[];
  status: "scheduled" | "live" | "final";
  finalScore?: { home: number; away: number };
  recordingId?: string;
}
export interface VenueDoc { id: string; name: string; slots: { slot: number; deviceId: string; label: string }[]; updatedAt: number }
export interface DestinationDoc {
  id: string;
  kind: "youtube" | "facebook" | "rtmp" | "srt" | "record";
  name: string;
  url?: string;
  key?: string; // never sent to the UI; UI sees keySet
  enabled: boolean;
}
export type DestinationView = Omit<DestinationDoc, "key"> & { keySet: boolean };
export type Trigger = "pregame" | "timeout" | "period_end" | "halftime" | "postgame";
export interface SponsorDoc {
  id: string;
  name: string;
  abbr: string;
  color: string;
  assets: { kind: "image" | "video" | "audio"; name: string; seconds?: number }[];
  displaySeconds: number;
  rules: { triggers: Trigger[]; minGapMinutes: number; maxPerSeason: number; priority: number }; // priority 1 = first
}
export interface AiringDoc {
  id: string;
  gameId: string;
  sponsorId: string;
  at: number;
  period: number;
  gameClockMs: number;
  trigger: Trigger;
  outcome: "aired" | "skipped" | "delayed";
  seconds: number;
}
export interface RecordingDoc { id: string; gameId: string; file: string; startedAt: number; endedAt?: number; bytes: number; exported: boolean }
export interface SettingsDoc {
  theme: "hardwood" | "midnight" | "clean" | "contrast";
  showLogos: boolean;
  showSponsorCorner: boolean;
  profile: { periods: number; periodMin: number; overtimeMin: number; bonusAt: number; timeouts: number };
  shortcuts: Record<string, string>; // action -> key
  storageDir: string;
  retention: "never" | "90d" | "season";
  lowSpaceGb: number;
  remote: { requireCode: boolean; code: string; lockedToLan: boolean; enabled: boolean; port: number; producerCanBroadcast: boolean };
  telemetry: boolean; // opt-in, default false
  activeGameId?: string;
  autoFireSponsors: boolean;
  engine: { kind: "fake" | "obs"; obsUrl: string; obsPassword?: string; obsPasswordSet?: boolean }; // obsPassword is write-only: the API only ever returns obsPasswordSet
}

// ---------------------------------------------------------------- preflight, reports, graphics
export interface Check {
  id: string;
  group: "Video" | "Audio" | "Network" | "Storage" | "Destination" | "Game";
  name: string;
  status: "ok" | "warn" | "err";
  result: string; // plain-language outcome
  fix?: string; // label of the fix action when status != ok
}
export interface Graphics {
  scorebug: boolean;
  lower: { title: string; sub: string } | null;
  slate: string | null;
  sponsor: { name: string; color: string; seconds: number; until: number } | null;
}
export interface Clip { startMs: number; endMs: number; label: string; eventSeq: number[] } // offsets into the recording
