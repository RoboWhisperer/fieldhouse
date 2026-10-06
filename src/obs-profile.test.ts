import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { profileIniPath, profileSettings, writeProfile } from "./obs-profile";
import { DEFAULT_VIDEO } from "./video-settings";
import { launchCommand } from "./obs-manager";

test("profile values: size, fps, bitrate, encoder, format, replay length and reconnect rules", () => {
  const p = profileSettings({ ...DEFAULT_VIDEO, resolution: "1080p", fps: 60, videoKbps: 6000, audioKbps: 192, recordFormat: "mkv", replaySeconds: 120 }, []);
  expect(p.Video).toMatchObject({ BaseCX: "1920", BaseCY: "1080", OutputCX: "1920", OutputCY: "1080", FPSType: "0", FPSCommon: "60", FPSInt: "60" });
  expect(p.SimpleOutput).toMatchObject({ RecRB: "true", RecRBTime: "120", VBitrate: "6000", ABitrate: "192", RecFormat2: "mkv", StreamEncoder: "x264", Preset: "superfast", x264Settings: "keyint=60" });
  expect(p.Output).toMatchObject({ Mode: "Simple", Reconnect: "true", RetryDelay: "2", MaxRetries: "2000" });
  expect(p.General.Name).toBe("Fieldhouse");
  expect(profileSettings({ ...DEFAULT_VIDEO, resolution: "1080p", fps: 60 }, ["nvenc"]).SimpleOutput.StreamEncoder).toBe("nvenc"); // automatic picks hardware for 1080p60
  expect(profileSettings(DEFAULT_VIDEO, []).Video).toMatchObject({ OutputCX: "1280", OutputCY: "720", FPSCommon: "30" });
});

test("profile paths per OS", () => {
  expect(profileIniPath("flatpak", { home: "/h", env: {} })).toBe("/h/.var/app/com.obsproject.Studio/config/obs-studio/basic/profiles/Fieldhouse/basic.ini");
  expect(profileIniPath("macos", { home: "/Users/u", env: {} })).toBe("/Users/u/Library/Application Support/obs-studio/basic/profiles/Fieldhouse/basic.ini");
  expect(profileIniPath("windows", { home: "C:\\u", env: { APPDATA: "C:\\u\\AppData\\Roaming" } })).toBe("C:\\u\\AppData\\Roaming\\obs-studio\\basic\\profiles\\Fieldhouse\\basic.ini");
});

test("writeProfile creates a new profile, updates an existing one, keeps unrelated keys and is idempotent", () => {
  const home = mkdtempSync(join(tmpdir(), "fh-prof-"));
  const install = { installed: true, kind: "native" as const, launch: [] };
  const path = profileIniPath("native", { home, env: {} });
  expect(writeProfile({ install, video: DEFAULT_VIDEO, home, env: {} })).toBe(path);
  expect(readFileSync(path, "utf8")).toContain("OutputCX=1280");
  writeFileSync(path, readFileSync(path, "utf8") + "\n[Custom]\nKeep=me\n");
  writeProfile({ install, video: { ...DEFAULT_VIDEO, resolution: "1080p" }, home, env: {} });
  const t = readFileSync(path, "utf8");
  expect(t).toContain("OutputCX=1920"); expect(t).not.toContain("OutputCX=1280"); expect(t).toContain("Keep=me");
  const before = t; writeProfile({ install, video: { ...DEFAULT_VIDEO, resolution: "1080p" }, home, env: {} });
  expect(readFileSync(path, "utf8")).toBe(before);
  expect(writeProfile({ install: { installed: false, launch: [] }, video: DEFAULT_VIDEO })).toBeNull();
  mkdirSync(dirname(path), { recursive: true });
});

test("OBS is started straight into the Fieldhouse profile when it exists", () => {
  const c = launchCommand({ installed: true, kind: "flatpak", launch: [] }, [], "linux", "Fieldhouse");
  expect(c.slice(-2)).toEqual(["--profile", "Fieldhouse"]);
  expect(launchCommand({ installed: true, kind: "flatpak", launch: [] }, [], "linux")).not.toContain("--profile");
});
