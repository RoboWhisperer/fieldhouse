// Where things live. Dev (`bun src/server.ts` from the repo) keeps everything under ./data.
// An installed app (the desktop shell sets FIELDHOUSE_PACKAGED=1) uses the OS's per-user locations.
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function paths() {
  const home = homedir();
  const packaged = process.env.FIELDHOUSE_PACKAGED === "1";
  const osData =
    process.platform === "win32" ? join(process.env.APPDATA || join(home, "AppData", "Roaming"), "Fieldhouse")
    : process.platform === "darwin" ? join(home, "Library", "Application Support", "Fieldhouse")
    : join(process.env.XDG_DATA_HOME || join(home, ".local", "share"), "fieldhouse");
  const dataDir = resolve(process.env.FIELDHOUSE_HOME || (packaged ? osData : "data"));
  const root = join(import.meta.dir, "..");
  return {
    packaged,
    dataDir,
    db: join(dataDir, "fieldhouse.db"),
    logs: join(dataDir, "logs"),
    // recordings go where people look for video; dev keeps them next to the database
    recordings: resolve(process.env.FIELDHOUSE_RECORDINGS || (packaged ? join(home, "Videos", "Fieldhouse") : join(dataDir, "recordings"))),
    web: resolve(process.env.FIELDHOUSE_WEB || join(root, "web")),
    assets: resolve(process.env.FIELDHOUSE_ASSETS || join(import.meta.dir, "assets")),
    overlay: resolve(process.env.FIELDHOUSE_OVERLAY || join(import.meta.dir, "overlay.html")),
  };
}
