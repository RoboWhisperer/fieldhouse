import { expect, test } from "bun:test";
import { ObsLayers, extName } from "./obs-layers";

// A tiny stand-in for obs-websocket: scenes hold ordered items; inputs are a name -> kind map.
function fakeObs(scenes: string[]) {
  const inputs = new Map<string, any>([["FH cam1 video", {}], ["FH Overlay", {}], ["User thing", {}]]);
  const items = new Map<string, { sourceName: string; sceneItemId: number; enabled: boolean }[]>();
  let id = 1; const calls: string[] = [];
  for (const s of scenes) items.set(s, [{ sourceName: "FH cam1 video", sceneItemId: id++, enabled: true }, { sourceName: "User thing", sceneItemId: id++, enabled: true }, { sourceName: "FH Overlay", sceneItemId: id++, enabled: true }]);
  const list = (s: string) => items.get(s)!.map((x, i) => ({ sourceName: x.sourceName, sceneItemId: x.sceneItemId, sceneItemIndex: i, sceneItemEnabled: x.enabled }));
  const req = async (t: string, d: any = {}) => {
    calls.push(t);
    switch (t) {
      case "GetInputList": return { inputs: [...inputs.keys()].map((n) => ({ inputName: n, inputKind: "x" })) };
      case "CreateInput": inputs.set(d.inputName, d.inputSettings); items.get(d.sceneName)!.push({ sourceName: d.inputName, sceneItemId: id, enabled: d.sceneItemEnabled }); return { sceneItemId: id++ };
      case "GetInputSettings": return { inputSettings: inputs.get(d.inputName) };
      case "SetInputSettings": inputs.set(d.inputName, { ...inputs.get(d.inputName), ...d.inputSettings }); return {};
      case "GetSceneItemList": return { sceneItems: list(d.sceneName) };
      case "CreateSceneItem": items.get(d.sceneName)!.push({ sourceName: d.sourceName, sceneItemId: id, enabled: d.sceneItemEnabled }); return { sceneItemId: id++ };
      case "SetSceneItemEnabled": items.get(d.sceneName)!.find((x) => x.sceneItemId === d.sceneItemId)!.enabled = d.sceneItemEnabled; return {};
      case "SetSceneItemIndex": { const l = items.get(d.sceneName)!, i = l.findIndex((x) => x.sceneItemId === d.sceneItemId), [x] = l.splice(i, 1); l.splice(d.sceneItemIndex, 0, x); return {}; }
      case "GetSceneItemId": { const x = items.get(d.sceneName)!.find((y) => y.sourceName === d.sourceName); if (!x) throw new Error("no"); return { sceneItemId: x.sceneItemId }; }
      case "RemoveSceneItem": items.set(d.sceneName, items.get(d.sceneName)!.filter((x) => x.sceneItemId !== d.sceneItemId)); return {};
      case "RemoveInput": inputs.delete(d.inputName); return {};
    }
    throw new Error("unexpected " + t);
  };
  return { req, inputs, items, calls, order: (s: string) => items.get(s)!.map((x) => x.sourceName) };
}
const L = (id: string, z: number, visible: boolean) => ({ id, url: "https://example.com/" + id, width: 1920, height: 1080, z, visible });

test("external layers: created in every scene, ordered by z around the overlay, toggled without a reload, removed again", async () => {
  const scenes = ["FH cam1", "FH cam2"], o = fakeObs(scenes);
  const ext = new ObsLayers(o.req as any, () => scenes);
  ext.set([L("a", 5, false), L("b", -1, true)]); await ext.apply();
  expect(o.order("FH cam2")).toEqual(["FH cam1 video", "User thing", extName("b"), "FH Overlay", extName("a")]);
  expect(o.items.get("FH cam1")!.find((x) => x.sourceName === extName("a"))!.enabled).toBe(false);
  expect(o.items.get("FH cam1")!.find((x) => x.sourceName === extName("b"))!.enabled).toBe(true);
  const before = o.calls.length;
  ext.set([L("a", 5, true), L("b", -1, true)]); await ext.apply(); // only the flag changes
  expect(o.calls.slice(before).every((c) => c === "SetSceneItemEnabled")).toBe(true);
  expect(o.items.get("FH cam2")!.find((x) => x.sourceName === extName("a"))!.enabled).toBe(true);
  ext.set([L("a", 5, true), { ...L("b", -1, true), url: "https://example.com/new" }]); await ext.apply(); // a changed address is written, not re-created
  expect(o.inputs.get(extName("b")).url).toBe("https://example.com/new");
  ext.set([L("a", 5, true)]); await ext.apply();
  expect([...o.inputs.keys()].filter((n) => n.startsWith("FH Ext "))).toEqual([extName("a")]);
  expect(o.order("FH cam1")).not.toContain(extName("b"));
  ext.set([]); await ext.apply();
  expect([...o.inputs.keys()].sort()).toEqual(["FH Overlay", "FH cam1 video", "User thing"]); // the operator's own item is untouched
});
