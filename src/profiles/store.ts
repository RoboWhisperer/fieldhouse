// Profile documents (kind "profile"). Built-ins live in code (builtins.ts); an edited built-in is saved as an override doc with the
// same id, and "reset" simply deletes that override. Users' own profiles are ordinary docs. Nothing here touches games:
// a game keeps its own frozen copy (GameDoc.profileSnapshot), see game-profile.ts.
import type { Store } from "../store";
import { BUILTINS, builtin } from "./builtins";
import { validateProfile } from "./validate";
import type { ProfileDoc } from "./types";

export const DEFAULT_PROFILE_ID = "basketball";
const newId = () => `profile_${crypto.randomUUID().slice(0, 8)}`;

export function listProfiles(store: Store): ProfileDoc[] {
  const docs = store.list<ProfileDoc>("profile");
  return [...BUILTINS.map((b) => docs.find((d) => d.id === b.id) ?? b), ...docs.filter((d) => !builtin(d.id))];
}
export const getProfile = (store: Store, id: string): ProfileDoc | undefined => store.get<ProfileDoc>("profile", id) ?? builtin(id);
export const isModified = (store: Store, id: string) => !!builtin(id) && !!store.get("profile", id);

/** Create (no id) or replace (id) a profile. Built-ins stay built-in and keep their id. */
export function saveProfile(store: Store, input: unknown, id?: string): ProfileDoc {
  if (id && !getProfile(store, id)) throw new Error("That sport profile does not exist.");
  const p = validateProfile(input, id ?? newId(), !!id && !!builtin(id));
  return store.put("profile", p);
}

export function duplicateProfile(store: Store, id: string, name?: string): ProfileDoc {
  const src = getProfile(store, id) ?? fail("That sport profile does not exist.");
  const copy = { ...structuredClone(src), name: name ?? `${src.name} copy` };
  return saveProfile(store, copy);
}

export function deleteProfile(store: Store, id: string, defaultId: string) {
  if (!getProfile(store, id)) throw new Error("That sport profile does not exist.");
  if (builtin(id)) throw new Error("Built-in sports can't be deleted. Use Reset to put the original rules back.");
  if (id === defaultId) throw new Error("This is the default sport. Choose another default first, then delete it.");
  store.del("profile", id);
}

export function resetProfile(store: Store, id: string): ProfileDoc {
  if (!builtin(id)) throw new Error("Only built-in sports can be reset.");
  store.del("profile", id);
  return builtin(id)!;
}

/** One profile as a file: fixed wrapper so Fieldhouse can recognise it, no ids or flags that only mean something on this computer. */
export function exportProfile(store: Store, id: string) {
  const { id: _id, builtin: _b, ...rest } = getProfile(store, id) ?? fail("That sport profile does not exist.");
  return { fieldhouseProfile: 1, profile: rest };
}

export function importProfile(store: Store, input: unknown): ProfileDoc {
  const body = input && typeof input === "object" && "profile" in input ? (input as any).profile : input; // accept the export wrapper or a bare profile
  return saveProfile(store, body); // a fresh id every time, so an import can never overwrite a profile
}

function fail(msg: string): never { throw new Error(msg); }
