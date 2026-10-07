// The graphics model. These exported types are the contract for the screens that edit graphics. Everything is plain JSON.
// Canvas: every graphic lives on a 1920x1080 canvas (the OBS program frame).
import type { VarMap } from "../custom-types";
export type { VarMap };

export type GraphicRole = "scorebug" | "lowerthird" | "fullscreen" | "ticker" | "corner" | "other";
export type GraphicKind = "builtin" | "html" | "caspar" | "url" | "remote";
export const ROLES: GraphicRole[] = ["scorebug", "lowerthird", "fullscreen", "ticker", "corner", "other"];
export const KINDS: GraphicKind[] = ["builtin", "html", "caspar", "url", "remote"];

export type Anchor = "top-left" | "top" | "top-right" | "left" | "center" | "right" | "bottom-left" | "bottom" | "bottom-right";
/** x/y are distances in canvas pixels from the anchored edge(s) toward the inside; for "center"/"top"/"bottom" x moves right, for "left"/"center"/"right" y moves down. */
export interface Placement { anchor: Anchor; x: number; y: number; scale: number; z: number; opacity: number }

export type AnimPreset = "none" | "fade" | "slide-left" | "slide-right" | "slide-up" | "slide-down" | "wipe" | "scale";
export type Easing = "linear" | "ease" | "ease-in" | "ease-out" | "ease-in-out";
export interface AnimSpec { preset: AnimPreset; durationMs: number; delayMs: number; easing: Easing }
export interface Animation { in: AnimSpec; out: AnimSpec }

/** manual: only commands. always: on whenever enabled. while-live: on while a broadcast (stream or recording) runs. auto-hide: manual, then off after `seconds`. */
export interface ShowPolicy { mode: "manual" | "always" | "while-live" | "auto-hide"; seconds?: number; startVisible?: boolean }

export type FieldType = "text" | "number" | "color" | "image" | "bool";
/** var: value of a variable path (e.g. "home.score"). const: fixed text, may contain {{path}} and {{path|fallback}}. manual: only what show/update send, else `default`. */
export interface FieldBinding { kind: "var" | "const" | "manual"; value: string }
export interface FieldDef { name: string; label: string; type: FieldType; default: string; binding: FieldBinding }

/** Designer properties of built-in graphics. Fonts: only families listed by GET /api/graphics/fonts render in OBS. "" = the default stack. */
export interface GraphicStyle {
  colors: { bg: string; panel: string; text: string; muted: string; accent: string; score: string; scoreText: string; clock: string; clockOff: string };
  radius: number; shadow: boolean; fontFamily: string; fontWeight: number; fontSize: number; scoreSize: number;
  /** Show or hide parts, e.g. { logos: false, clock: true }. Which parts a built-in has is listed in BUILTIN_PARTS. */
  parts: Record<string, boolean>;
  /** Ticker only: pixels per second. */
  speed: number;
}

interface Common { id: string; name: string; enabled: boolean; role: GraphicRole; description?: string; placement: Placement; animation: Animation; show: ShowPolicy; requiresGame: boolean; fields: FieldDef[]; style: GraphicStyle; createdAt: number; updatedAt: number; builtinId?: string; modified?: boolean }
export interface BuiltinGraphic extends Common { kind: "builtin"; source: Record<string, never> }
export interface HtmlGraphic extends Common { kind: "html"; source: { entry: string; width: number; height: number; allowNetwork: boolean } }
export interface CasparGraphic extends Common { kind: "caspar"; source: { entry: string; width: number; height: number; allowNetwork: boolean; dataFormat: "xml" | "json"; stopHoldMs: number; nextIsPlay?: boolean } }
export interface UrlGraphic extends Common { kind: "url"; source: { url: string; width: number; height: number; css: string } }
/** A graphic drawn by another system. `target` is the connector's own address of it (see connectors). `outputUrl` is the page that shows it; Fieldhouse adds it to OBS as a layer. */
export interface RemoteGraphic extends Common { kind: "remote"; source: { connectorId: string; target: Record<string, unknown>; outputUrl: string; width: number; height: number; css: string } }
export type GraphicDoc = BuiltinGraphic | HtmlGraphic | CasparGraphic | UrlGraphic | RemoteGraphic;

/** Parts each built-in can show or hide (keys of GraphicStyle.parts). */
export const BUILTIN_PARTS: Record<string, string[]> = {
  scorebug: ["colorBars", "clock", "period", "fouls", "timeouts", "bonus"],
  lowerthird: ["accentBar"], slate: [], sponsor: ["swatch", "caption"],
  scoreboard: ["clock", "period", "fouls", "timeouts", "bonus", "names"],
  ticker: [], clock: ["period"], lineup: ["numbers", "positions"], final: ["period", "label"],
};

// ---- connectors (docs kind "connector"). Secrets are write-only: the API shows `secretSet`, never the value.
export type ConnectorKind = "singular" | "caspar" | "http";
export interface ConnectorDoc { id: string; name: string; kind: ConnectorKind; enabled: boolean; config: Record<string, unknown>; secret?: string; createdAt: number; updatedAt: number }
export type ConnectorView = Omit<ConnectorDoc, "secret"> & { secretSet: boolean; status: { ok: boolean | null; message: string; at: number } };

/** One graphic as the overlay page needs it. */
export interface RenderItem {
  id: string; name: string; kind: GraphicKind; role: GraphicRole; builtin?: string; z: number;
  visible: boolean; phase: "on" | "stopping" | "off"; seq: number; nextSeq: number;
  placement: Placement; animation: Animation; style: GraphicStyle;
  fields: Record<string, string>; // resolved values by field name
  source?: Record<string, unknown>; // kind-specific (html/caspar: entry, width, height, allowNetwork, dataFormat; url: url...)
  data?: string; // caspar: the string handed to update() (XML or JSON)
  external?: { url: string; width: number; height: number; css: string }; // drawn by OBS as its own layer instead of inside the overlay page
}
/** Legacy-compatible `state.graphics`: scorebug/lower/slate/sponsor as before, plus items and vars. */
export interface GraphicsState {
  scorebug: boolean; lower: { title: string; sub: string } | null; slate: string | null;
  sponsor: { name: string; color: string; seconds: number; until: number } | null;
  items: RenderItem[]; vars: VarMap; engineLayers: boolean;
}

export interface ExternalLayer { id: string; url: string; width: number; height: number; z: number; visible: boolean; css?: string }
