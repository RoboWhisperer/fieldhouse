import { expect, test } from "bun:test";
import { launchCommand, mergeWebsocketConfig, parseFlatpakVersion, websocketConfigPath, windowsExeCandidates } from "./obs-manager";

test("websocket config path per OS", () => {
  const home = "/home/u";
  expect(websocketConfigPath("flatpak", { home, env: {} })).toBe("/home/u/.var/app/com.obsproject.Studio/config/obs-studio/plugin_config/obs-websocket/config.json");
  expect(websocketConfigPath("native", { home, env: {} })).toBe("/home/u/.config/obs-studio/plugin_config/obs-websocket/config.json");
  expect(websocketConfigPath("native", { home, env: { XDG_CONFIG_HOME: "/x" } })).toBe("/x/obs-studio/plugin_config/obs-websocket/config.json");
  expect(websocketConfigPath("macos", { home: "/Users/u", env: {} })).toBe("/Users/u/Library/Application Support/obs-studio/plugin_config/obs-websocket/config.json");
  expect(websocketConfigPath("windows", { home: "C:\\Users\\u", env: { APPDATA: "C:\\Users\\u\\AppData\\Roaming" } })).toBe("C:\\Users\\u\\AppData\\Roaming\\obs-studio\\plugin_config\\obs-websocket\\config.json");
});

test("windows exe candidates", () => {
  expect(windowsExeCandidates({})).toEqual(["C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe", "C:\\Program Files (x86)\\obs-studio\\bin\\64bit\\obs64.exe"]);
  expect(windowsExeCandidates({ ProgramFiles: "D:\\PF" })[0]).toBe("D:\\PF\\obs-studio\\bin\\64bit\\obs64.exe");
});

test("config merge keeps unknown keys, enables server, is idempotent", () => {
  const a = mergeWebsocketConfig({ server_enabled: false, server_port: 4455, extra: 1 }, { password: "pw" });
  expect(a.config).toMatchObject({ server_enabled: true, server_port: 4455, auth_required: true, server_password: "pw", extra: 1, first_load: false });
  expect(a.changed).toBe(true);
  expect(mergeWebsocketConfig(a.config, { password: "pw" }).changed).toBe(false);
  expect(mergeWebsocketConfig(null, { password: "p" }).port).toBe(4455);
  expect(mergeWebsocketConfig({ server_enabled: true, server_port: 4466 }, { password: "p" }).port).toBe(4466);
  expect(mergeWebsocketConfig({}, { password: "p", port: 5000 }).port).toBe(5000);
});

test("launch command per install type", () => {
  expect(launchCommand({ installed: true, kind: "flatpak", launch: [] }, ["/home/u/Videos", "bad path"])).toEqual(["flatpak", "run", "--filesystem=/home/u/Videos", "com.obsproject.Studio", "--disable-shutdown-check"]);
  expect(launchCommand({ installed: true, kind: "windows", launch: ["C:\\obs64.exe"] })).toEqual(["C:\\obs64.exe", "--disable-shutdown-check"]);
  expect(launchCommand({ installed: true, kind: "macos", launch: ["open"] })[0]).toBe("open");
  expect(parseFlatpakVersion("OBS Studio\n\n          ID: com.obsproject.Studio\n     Version: 32.2.2\n")).toBe("32.2.2");
});

test("flatpakUnreachable refuses folders a Flatpak OBS cannot write, allows home folders", async () => {
  const { flatpakUnreachable } = await import("./obs-manager");
  for (const d of ["/tmp/x", "/tmp", "/var/lib/rec", "/usr/share/x", "/run/user/1000/x"]) expect(flatpakUnreachable(d)).toContain("home directory");
  for (const d of ["/home/user/Videos/Fieldhouse", "/mnt/usb/games", "/media/user/disk/rec", "/tmpfoo/x"]) expect(flatpakUnreachable(d)).toBeNull();
});
