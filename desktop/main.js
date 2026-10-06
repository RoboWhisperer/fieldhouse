// Fieldhouse desktop shell: starts the compiled Bun server as a child process ("sidecar") and shows its UI in a window.
// Deliberately thin: no product logic lives here, so the shell can be swapped (Tauri etc.) without touching the app.
const { app, BrowserWindow, Menu, Tray, Notification, dialog, ipcMain, nativeImage, powerSaveBlocker, screen, session, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pkg = require("./package.json");
const REPO = pkg.repository.url.replace(/\.git$/, "");
const isMac = process.platform === "darwin";
const isWin = process.platform === "win32";
const dev = !app.isPackaged;
const repoRoot = path.join(__dirname, "..");

// ---- paths (mirror src/config.ts so the shell can open the same folders) ----
const dataDir = path.resolve(process.env.FIELDHOUSE_HOME || (
  isWin ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Fieldhouse")
  : isMac ? path.join(os.homedir(), "Library", "Application Support", "Fieldhouse")
  : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "fieldhouse")));
const logsDir = path.join(dataDir, "logs");
const sidecarLog = path.join(logsDir, "sidecar.log");

// ---- state ----
let win = null, tray = null, origin = null, child = null;
let quitting = false, quitCheck = "idle"; // idle | checking | ok
let crashes = [];         // timestamps of unexpected sidecar exits
let live = false, blockerId = null, pollTimer = null;
let update = { state: "disabled", version: null };
let updater = null;

function log(msg) {
  try { fs.mkdirSync(logsDir, { recursive: true }); fs.appendFileSync(path.join(logsDir, "desktop.log"), `${new Date().toISOString()} ${msg}\n`); } catch {}
}

// ---- sidecar ----
function sidecarCommand() {
  const exe = isWin ? "fieldhouse-server.exe" : "fieldhouse-server";
  const dir = dev ? path.join(__dirname, "build", `server-${process.arch}`) : path.join(process.resourcesPath, "server");
  const bin = path.join(dir, exe);
  const env = { ...process.env, FIELDHOUSE_PACKAGED: "1", PORT: "0", HOST: "127.0.0.1" };
  if (fs.existsSync(bin)) {
    env.FIELDHOUSE_WEB = path.join(dir, "web");
    env.FIELDHOUSE_ASSETS = path.join(dir, "assets");
    env.FIELDHOUSE_OVERLAY = path.join(dir, "overlay.html");
    return { cmd: bin, args: [], env, cwd: dataDir };
  }
  if (!dev) throw new Error(`sidecar missing: ${bin}`);
  return { cmd: "bun", args: ["src/server.ts"], env, cwd: repoRoot }; // dev fallback
}

function startSidecar() {
  return new Promise((resolve, reject) => {
    const { cmd, args, env, cwd } = sidecarCommand();
    fs.mkdirSync(logsDir, { recursive: true }); // also creates dataDir, which is the sidecar's cwd
    const out = fs.openSync(sidecarLog, "a");
    const p = spawn(cmd, args, { env, cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    child = p;
    let buf = "", settled = false;
    const sink = (d) => { try { fs.writeSync(out, d); } catch {} };
    p.stderr.on("data", sink);
    p.stdout.on("data", (d) => {
      sink(d);
      if (settled) return;
      buf += d;
      const m = /^FIELDHOUSE_READY (\{.*\})$/m.exec(buf);
      if (m) { settled = true; resolve(JSON.parse(m[1]).port); }
    });
    p.on("error", (e) => { if (!settled) { settled = true; reject(e); } });
    p.on("exit", (code, sig) => {
      try { fs.closeSync(out); } catch {}
      log(`sidecar exited code=${code} signal=${sig}`);
      if (child === p) child = null;
      if (!settled) { settled = true; reject(new Error(`sidecar exited early (${code ?? sig})`)); }
      else if (!quitting) onSidecarCrash();
    });
    setTimeout(() => { if (!settled) { settled = true; p.kill(); reject(new Error("sidecar start timed out")); } }, 30000);
  });
}

async function waitForState(port) {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/state`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("sidecar never answered /api/state");
}

function stopSidecar() {
  const p = child;
  if (!p) return Promise.resolve();
  return new Promise((resolve) => {
    // 20 s: the sidecar finishes the recording and closes the video engine it started before it exits
    const t = setTimeout(() => { log("sidecar did not exit in 20 s, killing"); p.kill("SIGKILL"); }, 20000);
    p.once("exit", () => { clearTimeout(t); resolve(); });
    p.kill("SIGTERM"); // on Windows this is a hard terminate (no signals); SQLite WAL stays consistent
  });
}

async function launch() {
  const port = await startSidecar();
  await waitForState(port);
  origin = `http://127.0.0.1:${port}`;
  log(`sidecar ready on ${origin}`);
  return origin;
}

function onSidecarCrash() {
  const now = Date.now();
  crashes = crashes.filter((t) => now - t < 60000).concat(now);
  live = false;
  if (crashes.length > 5) return showError();
  const delay = Math.min(500 * 2 ** (crashes.length - 1), 8000);
  log(`sidecar crashed (${crashes.length} in 60 s), restarting in ${delay} ms`);
  setTimeout(async () => {
    if (quitting) return;
    try { await launch(); if (win) win.loadURL(origin); } catch (e) { log(`restart failed: ${e.message}`); child ? null : onSidecarCrash(); }
  }, delay);
}

function showError() {
  origin = null;
  if (!win) createWindow();
  win.loadFile(path.join(__dirname, "error.html"));
}

// ---- live-broadcast awareness ----
async function isLive() {
  if (!origin) return false;
  try {
    const s = await (await fetch(`${origin}/api/state`, { signal: AbortSignal.timeout(2000) })).json();
    return !!(s.engine?.stream?.live || s.engine?.record?.active);
  } catch { return false; }
}

function startPolling() {
  pollTimer = setInterval(async () => {
    live = await isLive();
    if (live && blockerId === null) blockerId = powerSaveBlocker.start("prevent-display-sleep");
    if (!live && blockerId !== null) { powerSaveBlocker.stop(blockerId); blockerId = null; }
    if (!live && updater && update.state === "available") updater.downloadUpdate().catch(() => {});
  }, 5000);
  pollTimer.unref();
}

// ---- window ----
const stateFile = () => path.join(app.getPath("userData"), "window.json");
function loadBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    const ok = screen.getAllDisplays().some((d) => { const a = d.workArea; return b.x >= a.x - 50 && b.y >= a.y - 50 && b.x < a.x + a.width - 100 && b.y < a.y + a.height - 100; });
    return ok ? b : { width: b.width, height: b.height };
  } catch { return { width: 1440, height: 900 }; }
}

function createWindow() {
  win = new BrowserWindow({
    ...loadBounds(), minWidth: 1280, minHeight: 720, show: false, backgroundColor: "#0B1018", title: "Fieldhouse",
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  });
  win.once("ready-to-show", () => win.show());
  const save = () => { if (!win.isMinimized() && !win.isMaximized()) try { fs.writeFileSync(stateFile(), JSON.stringify(win.getBounds())); } catch {} };
  win.on("resized", save); win.on("moved", save);

  win.on("close", async (e) => {
    if (quitting || quitCheck !== "idle") return;
    e.preventDefault();
    if (isMac || (await isLive())) return win.hide(); // keep running: a broadcast is on (or macOS convention)
    app.quit();
  });
  win.on("closed", () => { win = null; });

  const wc = win.webContents;
  wc.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
  wc.on("will-navigate", (e, url) => {
    if (origin && new URL(url).origin === origin) return;
    e.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });
  if (origin) win.loadURL(origin);
}

function hardenSession() {
  const ses = session.defaultSession;
  const allowed = new Set(["clipboard-sanitized-write", "fullscreen"]);
  ses.setPermissionRequestHandler((_wc, perm, cb) => cb(allowed.has(perm)));
  ses.setPermissionCheckHandler((_wc, perm) => allowed.has(perm));
  ses.webRequest.onHeadersReceived((d, cb) => {
    if (origin && d.url.startsWith(origin)) {
      const ws = origin.replace("http:", "ws:");
      d.responseHeaders["Content-Security-Policy"] = [`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self' ${ws}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`];
    }
    cb({ responseHeaders: d.responseHeaders });
  });
}

// ---- IPC (only the app's own pages may call) ----
function trusted(e) {
  const u = e.senderFrame?.url || "";
  return (origin && u.startsWith(origin + "/")) || (u.startsWith("file://") && u.endsWith("/error.html"));
}
ipcMain.on("fh:version", (e) => { e.returnValue = app.getVersion(); });
ipcMain.handle("fh:open-data", (e) => trusted(e) && shell.openPath(dataDir));
ipcMain.handle("fh:open-logs", (e) => { if (!trusted(e)) return; fs.mkdirSync(logsDir, { recursive: true }); return shell.openPath(logsDir); });
ipcMain.handle("fh:update-state", (e) => trusted(e) ? update.state : "disabled");
ipcMain.handle("fh:update-check", (e) => trusted(e) && checkForUpdates());

// ---- updates (electron-updater, GitHub provider from electron-builder `publish`) ----
function setupUpdater() {
  if (dev || process.env.FIELDHOUSE_NO_UPDATE) return;
  try {
    ({ autoUpdater: updater } = require("electron-updater"));
  } catch (e) { return log(`updater unavailable: ${e.message}`); }
  updater.autoDownload = false;          // never pull a big file while streaming
  updater.autoInstallOnAppQuit = false;  // never install without an explicit, post-game restart
  update.state = "idle";
  updater.on("checking-for-update", () => setUpdate("checking"));
  updater.on("update-not-available", () => setUpdate("idle"));
  updater.on("update-available", (i) => { setUpdate("available", i.version); if (!live) updater.downloadUpdate().catch(() => {}); });
  updater.on("download-progress", () => setUpdate("downloading"));
  updater.on("update-downloaded", (i) => {
    setUpdate("ready", i.version);
    new Notification({ title: "Fieldhouse update ready", body: `Version ${i.version} is downloaded. Restart when the game is over.` }).show();
  });
  updater.on("error", (e) => { log(`updater: ${e.message}`); setUpdate("error"); });
  setTimeout(checkForUpdates, 30000);
  setInterval(checkForUpdates, 6 * 3600 * 1000).unref();
}
function setUpdate(state, version = update.version) { update = { state, version }; buildMenu(); }
function checkForUpdates() { if (updater && ["idle", "error"].includes(update.state)) updater.checkForUpdates().catch(() => {}); return update.state; }
async function restartForUpdate() {
  if (await isLive()) return dialog.showMessageBox(win, { type: "info", message: "A broadcast is live", detail: "Finish the game first, then restart to update." });
  quitting = true; // the sidecar is stopped by before-quit
  stopSidecar().then(() => updater.quitAndInstall());
}

// ---- menu + tray ----
function buildMenu() {
  const updateItem = update.state === "ready" ? [{ label: `Update ready (${update.version}): restart when the game is over`, click: restartForUpdate }]
    : update.state === "downloading" ? [{ label: "Downloading update...", enabled: false }]
    : updater ? [{ label: "Check for updates", click: checkForUpdates, enabled: ["idle", "error"].includes(update.state) }] : [];
  const about = () => dialog.showMessageBox(win, { type: "info", title: "About Fieldhouse", message: `Fieldhouse ${app.getVersion()}`, detail: `Free and open-source sports broadcast production.\nLicense: ${pkg.license}\n${REPO}\n\nNo telemetry. No accounts.` });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ label: "Fieldhouse", submenu: [{ label: "About Fieldhouse", click: about }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }] }] : []),
    { label: "File", submenu: [...(isMac ? [{ role: "close" }] : [{ role: "quit" }])] },
    { role: "editMenu" },
    { label: "View", submenu: [{ role: "reload" }, ...(dev ? [{ role: "toggleDevTools" }] : []), { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] },
    { role: "windowMenu" },
    { role: "help", submenu: [
      { label: "Documentation", click: () => shell.openExternal(`${REPO}#readme`) },
      { label: "Report a bug", click: () => shell.openExternal(`${REPO}/issues/new`) },
      { type: "separator" },
      { label: "Show data folder", click: () => shell.openPath(dataDir) },
      { label: "Show logs", click: () => { fs.mkdirSync(logsDir, { recursive: true }); shell.openPath(logsDir); } },
      ...updateItem,
      ...(isMac ? [] : [{ type: "separator" }, { label: "About Fieldhouse", click: about }]),
    ] },
  ]));
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "assets", "icon.png")).resize({ width: 22, height: 22 }));
  tray.setToolTip("Fieldhouse");
  const toggle = () => { if (!win) createWindow(); else if (win.isVisible() && win.isFocused()) win.hide(); else { win.show(); win.focus(); } };
  tray.setContextMenu(Menu.buildFromTemplate([{ label: "Show / Hide", click: toggle }, { type: "separator" }, { label: "Quit", click: () => app.quit() }]));
  tray.on("click", toggle);
}

// ---- lifecycle ----
if (!app.requestSingleInstanceLock()) { app.quit(); } else {
  app.on("second-instance", () => { if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); });

  app.whenReady().then(async () => {
    hardenSession();
    buildMenu();
    createTray();
    try { await launch(); } catch (e) { log(`start failed: ${e.message}`); createWindow(); return showError(); }
    createWindow();
    startPolling();
    setupUpdater();
  });

  for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => app.quit()); // dev Ctrl-C, `kill`

  app.on("activate", () => { if (win) win.show(); else if (origin) createWindow(); });
  app.on("window-all-closed", () => {}); // lifecycle is handled in the window "close" handler and the tray

  app.on("before-quit", (e) => {
    if (quitCheck === "ok") return;
    e.preventDefault();
    if (quitCheck === "checking") return;
    quitCheck = "checking";
    (async () => {
      if (!quitting && await isLive()) {
        if (win) { win.show(); win.focus(); }
        const { response } = await dialog.showMessageBox(win ?? undefined, {
          type: "warning", buttons: ["Keep broadcasting", "Quit and stop"], defaultId: 0, cancelId: 0,
          message: "A broadcast is live", detail: "Quitting now ends the stream and the recording.",
        });
        if (response === 0) { quitCheck = "idle"; return; }
      }
      quitting = true;
      clearInterval(pollTimer);
      if (blockerId !== null) powerSaveBlocker.stop(blockerId);
      await stopSidecar();
      quitCheck = "ok";
      app.quit();
    })();
  });
}
