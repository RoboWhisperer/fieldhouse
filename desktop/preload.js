// The whole renderer-facing surface. Keep it tiny; every call is checked again in main.js.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fieldhouse", Object.freeze({
  version: ipcRenderer.sendSync("fh:version"),
  platform: process.platform,
  openDataFolder: () => ipcRenderer.invoke("fh:open-data"),
  openLogs: () => ipcRenderer.invoke("fh:open-logs"),
  updateState: () => ipcRenderer.invoke("fh:update-state"), // "disabled" | "idle" | "checking" | "downloading" | "ready" | "error"
  checkForUpdates: () => ipcRenderer.invoke("fh:update-check"),
}));
