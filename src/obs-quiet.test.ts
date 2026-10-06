import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APP_QUIET, USER_QUIET, mergeIni, obsVersionNumber, quietFlags, quietPlan } from "./obs-quiet";
import { clearCrashMarkers, launchCommand, obsConfigDir, obsLogDir, parseTasklist, seedQuietConfig, terminateCommand, websocketConfigPath } from "./obs-manager";

test("mergeIni keeps user keys, comments, other sections and is idempotent", () => {
  const before = "; my comment\n[General]\nMaxLogs=10\nConfirmOnExit=true\nCustom=1\n\n[Video]\nRenderer=OpenGL\n";
  const a = mergeIni(before, { General: { ConfirmOnExit: "false", FirstRun: "true" }, BasicWindow: { SysTrayEnabled: "true" } });
  expect(a.changed).toBe(true);
  expect(a.text).toBe("; my comment\n[General]\nMaxLogs=10\nConfirmOnExit=false\nCustom=1\nFirstRun=true\n\n[Video]\nRenderer=OpenGL\n\n[BasicWindow]\nSysTrayEnabled=true\n");
  const b = mergeIni(a.text, { General: { ConfirmOnExit: "false", FirstRun: "true" }, BasicWindow: { SysTrayEnabled: "true" } });
  expect(b.changed).toBe(false);
  expect(b.text).toBe(a.text);
});

test("mergeIni: 'absent' keys never overwrite, empty file and CRLF files work", () => {
  expect(mergeIni("[General]\nLastVersion=5\n", {}, { General: { LastVersion: "9", Other: "1" } }).text).toBe("[General]\nLastVersion=5\nOther=1\n");
  expect(mergeIni("", { A: { b: "c" } }).text).toBe("[A]\nb=c\n");
  const crlf = mergeIni("[General]\r\nFirstRun=false\r\n", { General: { FirstRun: "true" } });
  expect(crlf.text).toBe("[General]\r\nFirstRun=true\r\n");
  expect(mergeIni("[General]\nFirstRun=true", { General: { FirstRun: "true" } }).changed).toBe(false);
});

test("version number encoding and which file gets which keys", () => {
  expect(obsVersionNumber("32.2.2")).toBe(537001986); // the real LastVersion OBS 32.2.2 writes
  expect(obsVersionNumber("28.1")).toBe(28 * 2 ** 24 + 1 * 2 ** 16);
  expect(obsVersionNumber(undefined)).toBeUndefined();
  const modern = quietPlan("32.2.2");
  expect(modern.map((p) => p.file)).toEqual(["global.ini", "user.ini"]);
  expect(modern[0].set).toEqual(APP_QUIET); expect(modern[1].set).toEqual(USER_QUIET);
  expect(modern[0].absent.General.LastVersion).toBe("537001986");
  const old = quietPlan("29.1.3"); // OBS <= 30 keeps everything in global.ini
  expect(old.map((p) => p.file)).toEqual(["global.ini"]);
  expect(old[0].set.BasicWindow.SysTrayWhenStarted).toBe("true");
  expect(quietPlan(undefined).map((p) => p.file)).toEqual(["global.ini", "user.ini"]); // unknown: write both
  expect(quietPlan(undefined)[0].set.General).toMatchObject({ EnableAutoUpdates: "false", ConfirmOnExit: "false" });
});

test("the key set silences what a volunteer would otherwise meet", () => {
  expect(USER_QUIET.General).toMatchObject({ FirstRun: "true", ConfirmOnExit: "false" });
  expect(USER_QUIET.BasicWindow).toMatchObject({ WarnBeforeStartingStream: "false", WarnBeforeStoppingStream: "false", WarnBeforeStoppingRecord: "false", OpenStatsOnStartup: "false", SysTrayEnabled: "true", SysTrayWhenStarted: "true", SysTrayMinimizeToTray: "true" });
  expect(APP_QUIET.General.EnableAutoUpdates).toBe("false");
});

test("config, log and ini locations per OS / install type", () => {
  const lin = { home: "/home/u", env: {} };
  expect(obsConfigDir("flatpak", lin)).toBe("/home/u/.var/app/com.obsproject.Studio/config/obs-studio");
  expect(obsConfigDir("native", lin)).toBe("/home/u/.config/obs-studio");
  expect(obsConfigDir("native", { home: "/home/u", env: { XDG_CONFIG_HOME: "/x" } })).toBe("/x/obs-studio");
  expect(obsConfigDir("macos", { home: "/Users/u", env: {} })).toBe("/Users/u/Library/Application Support/obs-studio");
  const win = { home: "C:\\Users\\u", env: { APPDATA: "C:\\Users\\u\\AppData\\Roaming" } };
  expect(obsConfigDir("windows", win)).toBe("C:\\Users\\u\\AppData\\Roaming\\obs-studio");
  expect(obsConfigDir("windows", { home: "C:\\Users\\u", env: {} })).toBe("C:\\Users\\u\\AppData\\Roaming\\obs-studio");
  expect(obsLogDir("windows", win)).toBe("C:\\Users\\u\\AppData\\Roaming\\obs-studio\\logs");
  expect(obsLogDir("flatpak", lin)).toBe("/home/u/.var/app/com.obsproject.Studio/config/obs-studio/logs");
  expect(obsLogDir("macos", { home: "/Users/u", env: {} })).toBe("/Users/u/Library/Application Support/obs-studio/logs");
  expect(websocketConfigPath("windows", win)).toBe("C:\\Users\\u\\AppData\\Roaming\\obs-studio\\plugin_config\\obs-websocket\\config.json");
});

test("launch flags per OS keep OBS in the tray and suppress its dialogs", () => {
  expect(quietFlags("linux")).toEqual(["--minimize-to-tray", "--disable-shutdown-check", "--disable-missing-files-check"]);
  expect(quietFlags("win32")).toContain("--disable-updater");
  expect(quietFlags("darwin")).toContain("--disable-updater");
  expect(launchCommand({ installed: true, kind: "native", launch: ["/usr/bin/obs"] }, [], "linux")).toEqual(["/usr/bin/obs", ...quietFlags("linux")]);
  const mac = launchCommand({ installed: true, kind: "macos", launch: ["open"] });
  expect(mac.slice(0, 6)).toEqual(["open", "-g", "-j", "-a", "OBS", "--args"]); // background + hidden
  expect(mac).toContain("--minimize-to-tray");
});

test("seedQuietConfig writes only what is missing, per install type, and leaves the user's keys alone", () => {
  const home = mkdtempSync(join(tmpdir(), "fh-seed-"));
  const dir = obsConfigDir("flatpak", { home, env: {} });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "global.ini"), "[General]\nMaxLogs=10\nEnableAutoUpdates=true\n");
  const wrote = seedQuietConfig({ install: { installed: true, kind: "flatpak", version: "32.2.2", launch: [] }, home, env: {} });
  expect(wrote).toEqual(["global.ini", "user.ini"]);
  const g = readFileSync(join(dir, "global.ini"), "utf8"), u = readFileSync(join(dir, "user.ini"), "utf8");
  expect(g).toContain("MaxLogs=10"); expect(g).toContain("EnableAutoUpdates=false"); expect(g).toContain("LastVersion=537001986");
  expect(u).toContain("ConfirmOnExit=false"); expect(u).toContain("SysTrayWhenStarted=true");
  expect(seedQuietConfig({ install: { installed: true, kind: "flatpak", version: "32.2.2", launch: [] }, home, env: {} })).toEqual([]); // second run: nothing to do
});

test("stale crash markers are removed before launch (they would open the 'Crash Detected' dialog)", () => {
  const home = mkdtempSync(join(tmpdir(), "fh-sent-"));
  const s = join(obsConfigDir("native", { home, env: {} }), ".sentinel");
  mkdirSync(s, { recursive: true });
  writeFileSync(join(s, "run_abc"), ""); writeFileSync(join(s, "run_def"), ""); writeFileSync(join(s, "keep.txt"), "x");
  expect(clearCrashMarkers({ install: { installed: true, kind: "native", launch: [] }, home, env: {} })).toBe(2);
  expect(existsSync(join(s, "run_abc"))).toBe(false); expect(existsSync(join(s, "keep.txt"))).toBe(true);
  expect(clearCrashMarkers({ install: { installed: false, launch: [] } })).toBe(0);
});

test("quit commands: polite first, forced last, per OS", () => {
  expect(terminateCommand("native", 42)).toEqual(["kill", "-TERM", "42"]);
  expect(terminateCommand("native", 42, true)).toEqual(["kill", "-KILL", "42"]);
  expect(terminateCommand("flatpak", 42, true)).toEqual(["flatpak", "kill", "com.obsproject.Studio"]);
  expect(terminateCommand("windows", 42)).toEqual(["taskkill", "/PID", "42"]); // no /F: a normal close
  expect(terminateCommand("windows", 42, true)).toEqual(["taskkill", "/PID", "42", "/F"]);
  expect(parseTasklist('"obs64.exe","1234","Console","1","200,000 K"\r\n"obs64.exe","99","Console","1","1 K"')).toEqual([1234, 99]);
  expect(parseTasklist("INFO: No tasks are running which match the specified criteria.")).toEqual([]);
});
