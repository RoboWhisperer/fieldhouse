// Routes for everything a volunteer may tune without opening OBS: quality, recording, audio inputs, per-camera options.
// Fieldhouse's settings are the source of truth (SettingsDoc.video); the engine is told, then asked what it really uses (read-back).
import * as data from "./data";
import { isActive } from "./health";
import type { Store } from "./store";
import type { Engine, VideoInfo } from "./types";
import { differences, encoderOptions, liveBlocked, resolveEncoder, validateVideo } from "./video-settings";

type On = (method: string, pattern: string, h: (a: { body: any; params: string[] }) => unknown) => void;

export function registerEngineSettings(on: On, c: { engine: Engine; store: Store; bad: (msg: string, status?: number) => never; changed: () => void }) {
  const { engine, store, bad, changed } = c;
  const settings = () => data.getSettings(store).video;
  const live = () => isActive(engine.status());
  const wrap = async <T>(f: () => Promise<T>): Promise<T> => { try { return await f(); } catch (e: any) { return bad(e.message); } };

  /** Saved choices + what the engine reports. `pending` = saved but not applied yet because a broadcast is running. */
  async function videoInfo(): Promise<VideoInfo> {
    const settingsNow = settings(), st = engine.status();
    let applied = null as VideoInfo["applied"], encoders = encoderOptions([]), encoderInUse = resolveEncoder(settingsNow.encoder, settingsNow, []).id;
    if (st.connected && engine.videoInfo) { try { const i = await engine.videoInfo(); applied = i.applied; encoders = i.encoders; encoderInUse = i.encoderInUse; } catch { /* engine busy: show saved values only */ } }
    const diff = applied ? differences(settingsNow, applied, encoderInUse as any) : [];
    return { settings: settingsNow, applied, encoders, encoderInUse, live: live(), differences: diff, pending: live() ? diff : [] };
  }

  on("GET", "/engine/video", () => videoInfo());

  on("PUT", "/engine/video", async ({ body }) => {
    let next;
    try { next = validateVideo(body, settings()); } catch (e: any) { return bad(e.message); }
    const blocked = live() ? liveBlocked(settings(), next) : null;
    if (blocked) bad(blocked, 409);
    // Offered encoders are known only once the engine is up; a hardware choice it cannot do is refused instead of silently saved.
    if (engine.status().connected && next.encoder !== "auto" && engine.videoInfo) {
      const have = (await engine.videoInfo().catch(() => null))?.encoders.map((e) => e.id) ?? [];
      if (have.length && !have.includes(next.encoder)) bad("That encoder is not available on this computer.");
    }
    data.saveSettings(store, { video: body });
    if (engine.status().connected && engine.applyVideo) {
      try { await engine.applyVideo(next); }
      catch (e: any) { changed(); bad(e.message); } // saved either way; the next start re-applies it
    }
    changed();
    return videoInfo();
  });

  // ---- audio inputs (OBS names stay "FH ..."; the operator's names live in Fieldhouse)
  const need = <T>(f: T | undefined, what: string): T => f ?? bad(`This engine cannot ${what}.`, 501);
  on("GET", "/engine/audio", () => wrap(() => need(engine.audioInputs, "manage audio inputs").call(engine)));
  on("POST", "/engine/audio", ({ body }) => wrap(async () => {
    const a = await need(engine.addAudio, "manage audio inputs").call(engine, { role: body?.role, deviceId: typeof body?.deviceId === "string" && body.deviceId ? body.deviceId : undefined, label: String(body?.label ?? "") });
    changed(); return a;
  }));
  on("PUT", "/engine/audio/:id", ({ body, params }) => wrap(async () => {
    const p: { label?: string; deviceId?: string; gainDb?: number; muted?: boolean } = {};
    if (body?.label !== undefined) { if (typeof body.label !== "string") throw new Error("The name must be text."); p.label = body.label; }
    if (body?.deviceId !== undefined) { if (typeof body.deviceId !== "string" || !body.deviceId) throw new Error("Choose a device."); p.deviceId = body.deviceId; }
    if (body?.gainDb !== undefined) { if (typeof body.gainDb !== "number" || !(body.gainDb >= -100 && body.gainDb <= 26)) throw new Error("Gain must be between -100 and 26 dB."); p.gainDb = body.gainDb; }
    if (body?.muted !== undefined) { if (typeof body.muted !== "boolean") throw new Error("Muted must be true or false."); p.muted = body.muted; }
    const a = await need(engine.updateAudio, "manage audio inputs").call(engine, params[0], p);
    changed(); return a;
  }));
  on("DELETE", "/engine/audio/:id", ({ params }) => wrap(async () => { await need(engine.removeAudio, "manage audio inputs").call(engine, params[0]); changed(); return { ok: true }; }));

  // ---- per-camera options
  const slotOf = (s: string) => { const n = Number(s); return Number.isInteger(n) ? n : bad("Slot must be a number from 1 to 4."); };
  on("GET", "/slots/:slot/settings", ({ params }) => wrap(() => need(engine.sourceOptions, "change source settings").call(engine, slotOf(params[0]))));
  on("POST", "/slots/:slot/settings", ({ params, body }) => wrap(async () => {
    const p: Record<string, unknown> = {};
    for (const k of ["resolution", "framerate"]) if (body?.[k] !== undefined) { if (typeof body[k] !== "string") throw new Error(`The ${k} must be one of the listed choices.`); p[k] = body[k]; }
    for (const k of ["reconnectSeconds", "bufferingMb"]) if (body?.[k] !== undefined) { if (typeof body[k] !== "number") throw new Error("That setting must be a number."); p[k] = body[k]; }
    if (body?.restart !== undefined) p.restart = body.restart === true;
    const o = await need(engine.setSourceOptions, "change source settings").call(engine, slotOf(params[0]), p);
    changed(); return o;
  }));
}
