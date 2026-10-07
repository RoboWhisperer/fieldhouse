// External web layers in OBS: each one is a browser input "FH Ext <id>" placed in every FH scene next to "FH Overlay".
// Only inputs with that exact prefix are ever created, changed or removed; the operator's own OBS items are never touched.
// Showing/hiding only flips the scene item's enabled flag (the page stays loaded, so it is instant).
import type { Req } from "./obs-devices";
import { OVERLAY } from "./obs-provision";
import type { ExternalLayer } from "./graphics/types";

export const EXT_PREFIX = "FH Ext ";
export const extName = (id: string) => EXT_PREFIX + id.replace(/[^\w-]/g, "_");
const BASE_CSS = "body { background-color: rgba(0, 0, 0, 0); margin: 0px auto; overflow: hidden; }";
const settingsOf = (l: ExternalLayer) => ({ url: l.url, width: l.width, height: l.height, fps: 30, css: BASE_CSS + (l.css ? " " + l.css : ""), shutdown: false, restart_when_active: false, reroute_audio: false });
const shape = (l: ExternalLayer) => JSON.stringify({ ...settingsOf(l), n: extName(l.id), z: l.z });

export class ObsLayers {
  private want: ExternalLayer[] = [];
  private applied = new Map<string, { shape: string; visible: boolean; items: Map<string, number> }>(); // by layer id
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private req: Req, private scenes: () => string[]) {}
  set(layers: ExternalLayer[]) { this.want = structuredClone(layers); }
  /** Apply the latest wanted list. `full` re-checks everything in OBS (after provisioning or a reconnect). */
  apply(full = false): Promise<void> { const run = () => this.run(full); const p = this.chain.then(run, run); this.chain = p.catch(() => {}); return p; }

  private async run(full: boolean) {
    const want = this.want, scenes = this.scenes();
    if (full) this.applied.clear();
    // fast path: same layers as last time, only visibility differs
    const same = this.applied.size === want.length && want.every((l) => this.applied.get(l.id)?.shape === shape(l));
    if (same) {
      await Promise.all(want.filter((l) => this.applied.get(l.id)!.visible !== l.visible).flatMap((l) => {
        const a = this.applied.get(l.id)!; a.visible = l.visible;
        return [...a.items].map(([sceneName, sceneItemId]) => this.req("SetSceneItemEnabled", { sceneName, sceneItemId, sceneItemEnabled: l.visible }));
      }));
      return;
    }
    const have = new Map(((await this.req("GetInputList")).inputs as { inputName: string; inputKind: string }[]).map((i) => [i.inputName, i.inputKind]));
    const names = new Set(want.map((l) => extName(l.id)));
    for (const n of have.keys()) if (n.startsWith(EXT_PREFIX) && !names.has(n)) {
      for (const sc of scenes) { // OBS 32 keeps an input alive until its scene items are gone
        const id = await this.req("GetSceneItemId", { sceneName: sc, sourceName: n }).then((r) => r.sceneItemId, () => null);
        if (id != null) await this.req("RemoveSceneItem", { sceneName: sc, sceneItemId: id }).catch(() => {});
      }
      await this.req("RemoveInput", { inputName: n }).catch(() => {});
    }
    this.applied.clear();
    for (const l of want) {
      const name = extName(l.id), s = settingsOf(l), items = new Map<string, number>();
      if (!have.has(name)) await this.req("CreateInput", { sceneName: scenes[0], inputName: name, inputKind: "browser_source", inputSettings: s, sceneItemEnabled: l.visible });
      else {
        const cur = (await this.req("GetInputSettings", { inputName: name })).inputSettings ?? {};
        if (Object.entries(s).some(([k, v]) => cur[k] !== v)) await this.req("SetInputSettings", { inputName: name, inputSettings: s, overlay: true });
      }
      for (const sc of scenes) {
        const list = (await this.req("GetSceneItemList", { sceneName: sc })).sceneItems as { sourceName: string; sceneItemId: number; sceneItemEnabled: boolean }[];
        let it = list.find((i) => i.sourceName === name);
        if (!it) { const r = await this.req("CreateSceneItem", { sceneName: sc, sourceName: name, sceneItemEnabled: l.visible }); items.set(sc, r.sceneItemId); continue; }
        items.set(sc, it.sceneItemId);
        if (it.sceneItemEnabled !== l.visible) await this.req("SetSceneItemEnabled", { sceneName: sc, sceneItemId: it.sceneItemId, sceneItemEnabled: l.visible });
      }
      this.applied.set(l.id, { shape: shape(l), visible: l.visible, items });
    }
    for (const sc of scenes) await this.order(sc, want);
  }

  /** Keep the camera at the bottom, then layers with z < 0, then FH Overlay, then layers with z >= 0 (each group by z). */
  private async order(sceneName: string, want: ExternalLayer[]) {
    const list = ((await this.req("GetSceneItemList", { sceneName })).sceneItems as { sourceName: string; sceneItemId: number; sceneItemIndex: number }[]).sort((a, b) => a.sceneItemIndex - b.sceneItemIndex);
    const ids = new Map(list.map((i) => [i.sourceName, i.sceneItemId]));
    const byZ = (l: ExternalLayer[]) => [...l].sort((a, b) => a.z - b.z).map((x) => extName(x.id));
    const mine = new Set(want.map((l) => extName(l.id)));
    const desired = [...list.map((i) => i.sourceName).filter((n) => n !== OVERLAY && !mine.has(n)), ...byZ(want.filter((l) => l.z < 0)), ...(ids.has(OVERLAY) ? [OVERLAY] : []), ...byZ(want.filter((l) => l.z >= 0))];
    const cur = list.map((i) => i.sourceName);
    for (let i = 0; i < desired.length; i++) {
      if (cur[i] === desired[i]) continue;
      await this.req("SetSceneItemIndex", { sceneName, sceneItemId: ids.get(desired[i])!, sceneItemIndex: i });
      cur.splice(cur.indexOf(desired[i]), 1); cur.splice(i, 0, desired[i]);
    }
  }
}
