// HTTP routes for sport profiles (docs kind "profile"). Registered once from createApp. Rules and limits: src/profiles/validate.ts.
// Editing a profile never changes a game that has started: games keep their own frozen copy (GameDoc.profileSnapshot).
import { getSettings } from "./data";
import { deleteProfile, duplicateProfile, exportProfile, getProfile, importProfile, isModified, listProfiles, resetProfile, saveProfile } from "./profiles/store";
import type { Store } from "./store";

type On = (method: string, pattern: string, h: (a: { body: any; params: string[] }) => unknown) => void;

export function registerProfileRoutes(on: On, c: { store: Store; bad: (msg: string, status?: number) => never; changed: () => void }) {
  const { store, bad, changed } = c;
  const view = (p: NonNullable<ReturnType<typeof getProfile>>) => ({ ...p, modified: isModified(store, p.id) }); // modified: a built-in someone edited (Reset is available)
  const one = (id: string) => getProfile(store, id) ?? bad("That sport profile does not exist.", 404);
  const done = <T>(x: T): T => { changed(); return x; };

  on("GET", "/profiles", () => listProfiles(store).map(view));
  on("POST", "/profiles", ({ body }) => done(view(typeof body?.duplicateOf === "string" ? duplicateProfile(store, body.duplicateOf, typeof body.name === "string" ? body.name : undefined) : saveProfile(store, body))));
  on("POST", "/profiles/import", ({ body }) => done(view(importProfile(store, body))));
  on("GET", "/profiles/:id", ({ params }) => view(one(params[0])!));
  on("PUT", "/profiles/:id", ({ body, params }) => (one(params[0]), done(view(saveProfile(store, body, params[0])))));
  on("DELETE", "/profiles/:id", ({ params }) => (one(params[0]), deleteProfile(store, params[0], getSettings(store).defaultProfileId ?? "basketball"), done({ ok: true })));
  on("POST", "/profiles/:id/reset", ({ params }) => (one(params[0]), done(view(resetProfile(store, params[0])))));
  on("GET", "/profiles/:id/export", ({ params }) => {
    one(params[0]);
    const body = exportProfile(store, params[0]);
    const file = body.profile.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "sport";
    return new Response(JSON.stringify(body, null, 2), { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="fieldhouse-${file}.json"` } });
  });
}
