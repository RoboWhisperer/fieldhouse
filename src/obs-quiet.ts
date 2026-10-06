// Makes OBS silent: no wizard, no update prompt, no "are you sure" dialogs, main window parked in the tray.
// Everything here is pure (strings in, strings out) so every OS can be unit-tested on one machine; only the caller touches disk.
//
// Findings on OBS 32.2.2 (Flatpak, Linux). OBS >= 31 split its settings over TWO files in the config folder:
//   global.ini  = app-level keys   (General/EnableAutoUpdates, General/LastVersion, ...)
//   user.ini    = UI preferences   (General/FirstRun, General/ConfirmOnExit, BasicWindow/Warn*, BasicWindow/SysTray*, ...)
// Older OBS (<= 30) keeps all of them in global.ini, so for an unknown or old version we write the UI keys to both files.
//   - The Auto-Configuration Wizard appears only when FirstRun is not true AND global.ini has no LastVersion.
//   - Crash/"unclean shutdown" dialog: launch flag --disable-shutdown-check (OBS also does not show it for a Fieldhouse-stopped OBS).
//   - Missing-files dialog on startup: launch flag --disable-missing-files-check.
//   - Tray: SysTrayEnabled + SysTrayWhenStarted + --minimize-to-tray start with the main window hidden IF the desktop has a tray
//     (KDE, Windows, macOS menu bar, GNOME with the AppIndicator extension). Without a tray OBS shows its window; nothing here can prevent that.
//   - macOS: `open -g -j` launches in the background and hidden. Windows: windowsHide on the spawn.
//   - Updates: EnableAutoUpdates=false and --disable-updater (Windows/macOS only; a Flatpak updates through Flatpak).
export type Ini = Record<string, Record<string, string>>;

/** UI preferences that stop every confirmation and park the window in the tray. */
export const USER_QUIET: Ini = {
  General: { FirstRun: "true", ConfirmOnExit: "false" },
  BasicWindow: {
    WarnBeforeStartingStream: "false", WarnBeforeStoppingStream: "false", WarnBeforeStoppingRecord: "false",
    OpenStatsOnStartup: "false", SysTrayEnabled: "true", SysTrayWhenStarted: "true", SysTrayMinimizeToTray: "true",
  },
};
/** App-level keys. EnableAutoUpdates is forced; LastVersion only ever fills a gap (see quietPlan). */
export const APP_QUIET: Ini = { General: { EnableAutoUpdates: "false" } };

/** OBS stores its version as major<<24 | minor<<16 | patch ("32.2.2" -> 537001986). */
export function obsVersionNumber(v?: string): number | undefined {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(v ?? "");
  return m ? Number(m[1]) * 2 ** 24 + Number(m[2]) * 2 ** 16 + Number(m[3] ?? 0) : undefined;
}

/** Which key sets go into which file, for an OBS of this version (undefined = unknown, write both). */
export function quietPlan(version?: string): { file: "global.ini" | "user.ini"; set: Ini; absent: Ini }[] {
  const major = Number(/^(\d+)/.exec(version ?? "")?.[1] ?? NaN);
  const last = obsVersionNumber(version);
  const absent: Ini = last ? { General: { LastVersion: String(last) } } : {};
  const plan: { file: "global.ini" | "user.ini"; set: Ini; absent: Ini }[] = [{ file: "global.ini", set: APP_QUIET, absent }];
  if (!(major < 31)) plan.push({ file: "user.ini", set: USER_QUIET, absent: {} });
  if (!(major >= 31)) plan[0] = { ...plan[0], set: mergeSets(APP_QUIET, USER_QUIET) };
  return plan;
}
const mergeSets = (a: Ini, b: Ini): Ini => { const o: Ini = {}; for (const x of [a, b]) for (const [s, kv] of Object.entries(x)) o[s] = { ...o[s], ...kv }; return o; };

/** Launch flags that keep OBS quiet. profile is passed only when it already exists (OBS would otherwise ask). */
export const QUIET_FLAGS = ["--minimize-to-tray", "--disable-shutdown-check", "--disable-missing-files-check"];
export function quietFlags(platform: NodeJS.Platform | string): string[] {
  return platform === "win32" || platform === "darwin" ? [...QUIET_FLAGS, "--disable-updater"] : QUIET_FLAGS;
}

/**
 * Merge `set` (forced) and `absent` (only when the key is missing) into INI text. Every other line, comment and the user's own
 * keys are kept byte for byte. Missing sections are appended. Line endings of the file are preserved.
 */
export function mergeIni(text: string, set: Ini, absent: Ini = {}): { text: string; changed: boolean } {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text === "" ? [] : text.replace(/(\r?\n)$/, "").split(/\r?\n/);
  const want = new Map<string, Map<string, { v: string; force: boolean }>>();
  for (const [ini, force] of [[absent, false], [set, true]] as const) for (const [s, kv] of Object.entries(ini)) for (const [k, v] of Object.entries(kv)) { if (!want.has(s)) want.set(s, new Map()); want.get(s)!.set(k, { v, force }); }
  const out: string[] = [];
  let changed = false, cur: string | null = null, seen = new Set<string>();
  const flush = () => { // end of a section: add what it lacks
    if (cur === null) return;
    let at = out.length; while (at > 0 && out[at - 1].trim() === "") at--; // new keys go before the blank lines that end the section
    const add = [...(want.get(cur) ?? [])].filter(([k]) => !seen.has(k)).map(([k, w]) => `${k}=${w.v}`);
    if (add.length) { out.splice(at, 0, ...add); changed = true; }
    want.get(cur)?.clear();
  };
  for (const line of lines) {
    const sec = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (sec) { flush(); cur = sec[1]; seen = new Set(); out.push(line); continue; }
    const kv = cur !== null ? /^([^=;#\s][^=]*?)\s*=(.*)$/.exec(line) : null;
    const w = kv && want.get(cur!)?.get(kv[1]);
    if (kv) seen.add(kv[1]);
    if (kv && w?.force && kv[2] !== w.v) { out.push(`${kv[1]}=${w.v}`); changed = true; } else out.push(line);
  }
  flush();
  for (const [s, kvs] of want) if (kvs.size) { // sections the file does not have yet
    if (out.length && out[out.length - 1] !== "") out.push("");
    out.push(`[${s}]`); for (const [k, w] of kvs) out.push(`${k}=${w.v}`); changed = true;
  }
  return { text: out.join(eol) + (out.length ? eol : ""), changed };
}
