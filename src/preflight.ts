// Go-live checks, grouped as in 10-ui-design-spec.md 5.6. Every non-ok check says what is wrong and names its fix.
import { checkDestination } from "./destination-check";
import type { Check, DestinationDoc, EngineStatus, GameDoc, SettingsDoc } from "./types";

const GB = 1024 ** 3;
const NEED_GB = 45; // 15 GB/hour x a 3-hour game

export async function runChecks(ctx: { engine: EngineStatus; game?: GameDoc; destinations: DestinationDoc[]; settings: SettingsDoc }): Promise<Check[]> {
  const { engine, game } = ctx;
  const out: Check[] = [];
  const add = (c: Omit<Check, "result" | "fix"> & { result: string; fix?: string }) => out.push(c.status === "ok" ? { ...c, fix: undefined } : c);

  // Video
  const bad = engine.sources.filter((s) => s.status !== "ok");
  if (!engine.connected) add({ id: "video.sources", group: "Video", name: "Cameras and sources", status: "err", result: engine.engine === "obs" ? (engine.obs?.managed?.message || "The video engine is not connected, so no video can be checked.") : "The video engine is not running.", fix: "Start video engine" });
  else if (!engine.sources.length) add({ id: "video.sources", group: "Video", name: "Cameras and sources", status: "err", result: "No video sources are set up.", fix: "Add a source" });
  else if (bad.some((s) => s.status === "missing")) add({ id: "video.sources", group: "Video", name: "Cameras and sources", status: "err", result: `${bad.filter((s) => s.status === "missing").map((s) => s.label).join(", ")} is not connected.`, fix: "Reconnect" });
  else if (bad.length) add({ id: "video.sources", group: "Video", name: "Cameras and sources", status: "warn", result: `${bad.map((s) => s.label).join(", ")} is reconnecting.`, fix: "Reconnect" });
  else add({ id: "video.sources", group: "Video", name: "Cameras and sources", status: "ok", result: `All ${engine.sources.length} source${engine.sources.length > 1 ? "s are" : " is"} live.` });

  // Audio
  const chans = engine.mixer; // any audio input counts, whatever the engine calls it
  const heard = chans.filter((m) => !m.muted && m.level > 0.01);
  if (!heard.length) add({ id: "audio.levels", group: "Audio", name: "Audio levels", status: "warn", result: chans.length ? (chans.every((m) => m.muted) ? "Every audio input is muted." : "No sound is coming in. Check the microphone and the mixer.") : "No audio input was found.", fix: "Check microphone" });
  else add({ id: "audio.levels", group: "Audio", name: "Audio levels", status: "ok", result: "Sound is coming in." });
  const loud = chans.filter((m) => m.level > 0.97);
  add(loud.length
    ? { id: "audio.clipping", group: "Audio", name: "No clipping", status: "warn", result: `${loud.map((m) => m.label).join(", ")} is too loud and may distort.`, fix: "Lower gain" }
    : { id: "audio.clipping", group: "Audio", name: "No clipping", status: "ok", result: "Levels are in a safe range." });

  // Network
  const live = ctx.destinations.filter((d) => d.enabled && d.kind !== "record" && (!game?.destinationIds.length || game.destinationIds.includes(d.id)));
  await Promise.all(live.map(async (d) => {
    const chk = await checkDestination(d.url ?? "", { timeoutMs: 2000 }); // same check as going live: address, DNS and a real connection
    add({ id: `network.dns.${d.id}`, group: "Network", name: `Reach ${d.name}`, status: chk.ok ? "ok" : "err", result: chk.ok ? `${d.name} can be reached.` : `Can't reach ${d.name}. ${chk.message}`, fix: "Re-test" });
  }));
  add(engine.stream.live
    ? { id: "network.upload", group: "Network", name: "Upload speed", status: engine.stream.droppedFrames > 0 || engine.stream.reconnecting ? "warn" : "ok", result: `Streaming at ${Math.round(engine.stream.kbps)} kbps, ${engine.stream.droppedFrames} dropped frames.`, fix: "Lower quality" }
    : { id: "network.upload", group: "Network", name: "Upload speed", status: "warn", result: "Not measured until you are live", fix: "Test stream privately" });

  // Storage
  const free = engine.diskFreeBytes / GB;
  const roomFor = `${free.toFixed(0)} GB free; a 3-hour game needs about ${NEED_GB} GB.`;
  add({ id: "storage.space", group: "Storage", name: "Recording space", status: free < 10 ? "err" : free < NEED_GB ? "warn" : "ok", result: free < NEED_GB ? `Not enough room: ${roomFor}` : `${roomFor} Plenty of room.`, fix: "Free up space" });

  // Destination
  const dests = ctx.destinations.filter((d) => d.enabled && (!game?.destinationIds.length || game.destinationIds.includes(d.id)));
  if (!dests.length) add({ id: "destination.set", group: "Destination", name: "Where it goes", status: "err", result: "No destination is turned on.", fix: "Choose destination" });
  for (const d of dests) {
    const ready = d.kind === "record" || (d.url && d.key);
    add({ id: `destination.${d.id}`, group: "Destination", name: d.name, status: ready ? "ok" : "err", result: d.kind === "record" ? "Recording to this computer only." : ready ? "Address and stream key are set." : `${d.name} is missing its ${d.url ? "stream key" : "address"}.`, fix: "Add stream key" });
  }

  // Game
  if (!game) add({ id: "game.set", group: "Game", name: "Game", status: "err", result: "No game is selected.", fix: "Choose game" });
  else {
    for (const side of ["home", "away"] as const) {
      const t = game[side];
      add({ id: `game.roster.${side}`, group: "Game", name: `${t.name} roster`, status: t.roster.length ? "ok" : "warn", result: t.roster.length ? `${t.roster.length} players loaded.` : `No players loaded for ${t.name}.`, fix: "Import roster" });
      const n = t.roster.filter((p) => p.starter).length;
      if (t.roster.length) add({ id: `game.starters.${side}`, group: "Game", name: `${t.name} starters`, status: n >= 5 ? "ok" : "warn", result: n >= 5 ? "Starting five marked." : `${n} of 5 starters marked for ${t.name}.`, fix: "Mark starters" });
    }
  }
  return out;
}
