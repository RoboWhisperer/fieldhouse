// Settings sections: keyboard shortcuts, remote, storage.
import { html, icon, api, toast, fail, fmtBytes, fmtDate } from "../app.js";
import { delegate, all, sw, copyText, panel, setErr } from "./settings-ui.js";
import { conflicts, normKey, MODIFIER_KEYS, DEFAULT_SHORTCUTS, SHORTCUT_GROUPS, SHORTCUT_LABEL, hoursLeft, newCode } from "./settings-lib.js";
import { qrMatrix, qrPath } from "./settings-qr.js";

const paint = (root, view) => { const b = root.querySelector("[data-box]"); if (b) b.innerHTML = view().s; };
const errOf = (e) => e?.message || String(e);
const pill = (cls, text) => html`<span class="pill ${cls}">${text}</span>`;

// ================================================================ shortcuts
const keyParts = (k) => (k.endsWith("+") && k.length > 1 ? [...k.slice(0, -2).split("+").filter(Boolean), "+"] : k.split("+")).map((p) => (p.length === 1 ? p.toUpperCase() : p));
const kbds = (k) => html`<span class="row" style="gap:4px">${keyParts(k).map((p, i) => html`${i ? html`<span class="muted">+</span>` : ""}<span class="kbd">${p}</span>`)}</span>`;
const labelOf = (a) => SHORTCUT_LABEL[a] ?? a;

function shortView(d) {
  const sc = d.settings.shortcuts, cf = conflicts(sc), bad = new Set(cf.flatMap((c) => c.actions)), q = d.filter.trim().toLowerCase();
  const known = new Set(SHORTCUT_GROUPS.flatMap((g) => g[1])), extra = Object.keys(sc).filter((a) => !known.has(a));
  const groups = [...SHORTCUT_GROUPS, ...(extra.length ? [["Other", extra]] : [])].map(([g, acts]) => [g, acts.filter((a) => a in sc && (!q || labelOf(a).toLowerCase().includes(q) || sc[a].toLowerCase().includes(q)))]).filter(([, a]) => a.length);
  const c0 = cf[0];
  return html`
    ${c0 && html`<div class="banner warn">${icon("alert", "lg")}<span style="flex:1"><b>${keyParts(c0.key).join("+")} is used ${c0.actions.length === 2 ? "twice" : c0.actions.length + " times"}.</b> <span class="muted">${c0.actions.map(labelOf).join(" and ")} both use it. Pick a different key for one of them.</span></span><button class="btn sm" data-act="fix" data-action="${c0.actions[c0.actions.length - 1]}">Fix conflict</button></div>`}
    <div class="panel"><table class="tbl" style="table-layout:fixed"><colgroup><col style="width:38%"><col style="width:26%"><col></colgroup><tbody>
      ${groups.length ? groups.map(([g, acts]) => html`<tr><td colspan="3" class="grp">${g}</td></tr>${acts.map((a) => html`<tr><td style="font-weight:550;height:40px">${labelOf(a)}</td><td style="height:40px">${d.rec === a ? html`<span class="kbd" style="border-color:var(--action);box-shadow:0 0 0 3px rgba(61,139,253,.25);width:150px" role="status">Press a new key…</span>` : kbds(sc[a])}</td><td class="act" style="height:40px"><span class="row" style="gap:8px;justify-content:flex-end">${bad.has(a) && d.rec !== a && html`<span class="chip warn">${icon("alert", "sm")}Conflict</span>`}${d.rec === a ? html`<button class="btn sm ghost" data-act="cancel">Cancel</button>` : html`<button class="btn sm ghost" data-act="edit" data-action="${a}" aria-label="Edit key for ${labelOf(a)}">${icon("sliders", "sm")}Edit</button>`}</span></td></tr>`)}`) : html`<tr><td colspan="3" style="height:80px;text-align:center" class="muted">No shortcut matches that filter.</td></tr>`}
    </tbody></table></div>
    ${d.rec && html`<div class="hint">Press the new key now. Escape cancels. Alt combinations are not used.</div>`}`;
}
export const shortcuts = {
  async load() { return { settings: await api.get("/settings"), rec: null, filter: "" }; },
  render: (ctx, data) => html`<div class="row"><label class="input" style="width:320px;color:var(--text-3)">${icon("search")}<input data-in="filter" placeholder="Filter shortcuts" aria-label="Filter shortcuts" style="all:unset;flex:1;color:var(--text);min-width:0"></label><span class="sp"></span><button class="btn" data-act="copy">${icon("book")}Copy as text</button><button class="btn" data-act="reset">${icon("refresh")}Reset to defaults</button></div><div class="cp" data-box>${shortView(data)}</div>`,
  bind(root, ctx, data) {
    let off = null;
    const view = () => shortView(data);
    const stop = () => { off?.(); off = null; data.rec = null; paint(root, view); };
    const put = async (shortcuts, msg) => { try { data.settings = await api.put("/settings", { shortcuts }); toast(msg); } catch (e) { fail(e); } };
    function record(action) {
      off?.(); data.rec = action; paint(root, view);
      const h = async (e) => {
        if (MODIFIER_KEYS.includes(e.key)) return;
        e.preventDefault(); e.stopPropagation();
        if (e.key === "Escape") return stop();
        if (e.altKey) return toast("Alt combinations are not used. Press another key.");
        const k = normKey(e); off(); off = null; data.rec = null;
        await put({ [action]: k }, `${labelOf(action)} is now ${k}.`); paint(root, view);
      };
      document.addEventListener("keydown", h, true); off = () => document.removeEventListener("keydown", h, true);
    }
    const a = delegate(root, "click", "act", {
      edit: (el) => record(el.dataset.action), fix: (el) => record(el.dataset.action), cancel: stop,
      reset: async () => { if (!confirm("Reset every keyboard shortcut to its default?")) return; await put({ ...DEFAULT_SHORTCUTS }, "Shortcuts reset to defaults."); paint(root, view); },
      copy: () => copyText(SHORTCUT_GROUPS.map(([g, acts]) => `${g}\n` + acts.filter((x) => x in data.settings.shortcuts).map((x) => `  ${labelOf(x)}: ${keyParts(data.settings.shortcuts[x]).join("+")}`).join("\n")).join("\n\n")),
    });
    const i = delegate(root, "input", "in", { filter: (el) => { data.filter = el.value; paint(root, view); } });
    return all(a, i, () => off?.());
  },
};

// ================================================================ remote (src/auth.ts is the other half)
export { remote } from "./settings-remote.js";

// ================================================================ storage
const RET = [["never", "Never delete automatically"], ["90d", "90 days"], ["season", "One season"]];
const selectable = (r) => !!r.endedAt;
function storView(d) {
  const u = d.usage, total = u.totalBytes || 1, other = Math.max(0, u.totalBytes - u.freeBytes - u.recordingsBytes - u.highlightsBytes);
  const pc = (n) => `${Math.min(100, (n / total) * 100).toFixed(2)}%`;
  const est = hoursLeft(u.freeBytes, d.recs), s = d.settings, sel = d.recs.filter((r) => d.sel.has(r.id));
  const title = (r) => d.games[r.gameId] ?? "Unknown game";
  const maxGb = Math.max(100, Math.round(total / 1e9));
  const cats = [["var(--action)", "Recordings", `${d.recs.length} recording${d.recs.length === 1 ? "" : "s"}, full-length video`, u.recordingsBytes], ["var(--ready)", "Highlights", "Clips and replays you saved", u.highlightsBytes], ["var(--caution)", "Other files", "Everything else on this disk", other], ["var(--line-strong)", "Free", "Available for new recordings", u.freeBytes]];
  const allOn = d.recs.filter(selectable).length > 0 && d.recs.filter(selectable).every((r) => d.sel.has(r.id));
  return html`
  <div class="g2" style="grid-template-columns:minmax(0,1fr) 340px">
    ${panel("Recordings folder and disk", html`<div class="pb" style="display:grid;gap:12px;align-content:start">
      <div class="row"><label class="input mono" style="flex:1">${icon("folder")}<input data-in="dir" value="${d.dir}" aria-label="Recordings folder" spellcheck="false" style="all:unset;flex:1;min-width:0;color:var(--text)"></label><button class="btn" data-act="savedir" ${d.dir.trim() === s.storageDir ? "disabled" : ""}>${icon("folder")}Save folder</button></div>
      <div class="hint err" role="alert" data-err>${d.dirErr}</div>
      <div class="row" style="align-items:baseline;flex-wrap:wrap"><span style="font-size:22px;font-weight:700" class="tnum">${fmtBytes(u.freeBytes)} free</span><span class="muted">of ${fmtBytes(u.totalBytes)}</span><span class="sp"></span><span class="chip ${est.hours >= 5 ? "ok" : "warn"}">${icon(est.hours >= 5 ? "check" : "alert", "sm")}About ${Math.floor(est.hours)} hours of recording left</span></div>
      <div class="hint">${est.measured ? "Estimated from the size of your finished recordings." : "Estimated at 6 Mbps because there are no finished recordings to measure yet."}</div>
      <div class="ststack" role="img" aria-label="Disk use">${cats.slice(0, 3).map(([c, , , n]) => html`<b style="width:${pc(n)};background:${c}"></b>`)}</div>
      <div>${cats.map(([c, name, sub, n]) => html`<div class="stcat"><i style="background:${c}"></i><span><b>${name}</b> <span class="muted">${sub}</span></span><span class="tnum">${fmtBytes(n)}</span></div>`)}</div></div>`)}
    ${panel("Recording", html`
      <div class="fr"><label class="fl muted" for="st-ret">Keep recordings for</label><select id="st-ret" class="select" data-in="retention">${RET.map(([v, l]) => html`<option value="${v}" ${v === s.retention ? "selected" : ""}>${l}</option>`)}</select><span class="hint">Only recordings of finished games that you have exported are removed once they are this old; anything not exported is kept twice as long. The game on screen is never touched. One season means one year.</span></div>
      <div class="fr"><div class="row"><label class="fl muted" for="st-low">Warn me when free space is below</label><span class="sp"></span><b class="tnum" data-lowv>${s.lowSpaceGb} GB</b></div><input id="st-low" type="range" min="1" max="${Math.max(maxGb, s.lowSpaceGb)}" step="1" value="${s.lowSpaceGb}" data-in="low"><span class="hint">Fieldhouse warns you on the Live screen if free space drops below this during a broadcast.</span></div>`)}
  </div>
  ${panel("Recent recordings", html`
    ${d.confirm && html`<div class="banner err" style="margin:12px 14px;align-items:flex-start;flex-direction:column"><div class="row">${icon("alert", "lg")}<b>Delete ${sel.length} recording${sel.length === 1 ? "" : "s"} from this computer? This cannot be undone.</b></div>${sel.map((r) => html`<div class="field" style="width:100%"><label for="cf-${r.id}">Type <b>${title(r)}</b> to confirm</label><input id="cf-${r.id}" class="input" data-in="confirm" data-id="${r.id}" value="${d.typed[r.id] ?? ""}" autocomplete="off" spellcheck="false"></div>`)}<div class="hint err" role="alert" data-derr>${d.delErr}</div><div class="row"><button class="btn danger" data-act="dodelete" disabled>Delete for good</button><button class="btn" data-act="canceldel">Cancel</button></div></div>`}
    ${d.recs.length ? html`<table class="tbl"><thead><tr><th style="width:36px"><button type="button" class="check ${allOn ? "on" : ""}" role="checkbox" aria-checked="${allOn}" aria-label="Select all" data-act="selall">${allOn && icon("check")}</button></th><th>Game</th><th>Date</th><th class="n">Size</th><th>Status</th></tr></thead><tbody>
      ${d.recs.map((r) => html`<tr><td><button type="button" class="check ${d.sel.has(r.id) ? "on" : ""}" role="checkbox" aria-checked="${d.sel.has(r.id)}" aria-label="Select ${title(r)}" data-act="sel" data-id="${r.id}" ${selectable(r) ? "" : "disabled"}>${d.sel.has(r.id) && icon("check")}</button></td><td>${title(r)}</td><td class="m">${fmtDate(r.startedAt, { month: "short", day: "numeric", year: "numeric" })}</td><td class="n">${fmtBytes(r.bytes)}</td><td>${!r.endedAt ? pill("check", "Recording") : r.exported ? pill("ready", "Exported") : pill("info", "Not exported")}</td></tr>`)}</tbody></table>`
      : html`<div class="empty">${icon("disk", "xl")}<b>No recordings yet</b><span>Recordings appear here after a game is recorded.</span></div>`}
    <div class="row" style="padding:10px 14px;border-top:1px solid var(--line)">${icon("lock")}<span class="muted">Recordings never leave this computer unless you export them. To delete, type the game name to confirm.</span><span class="sp"></span><button class="btn danger" data-act="delete" ${sel.length ? "" : "disabled"}>${icon("x")}Delete selected (${sel.length})</button></div>`)}`;
}
export const storage = {
  async load() {
    const [settings, usage, recs, games] = await Promise.all([api.get("/settings"), api.get("/storage"), api.get("/recordings"), api.get("/games")]);
    return { settings, usage, recs: recs.sort((a, b) => b.startedAt - a.startedAt), games: Object.fromEntries(games.map((g) => [g.id, g.title])), dir: settings.storageDir, dirErr: "", sel: new Set(), confirm: false, typed: {}, delErr: "" };
  },
  render: (ctx, data) => html`<div class="cp" data-box>${storView(data)}</div>`,
  bind(root, ctx, data) {
    const view = () => storView(data), repaint = () => paint(root, view);
    const ready = () => { const b = root.querySelector('[data-act="dodelete"]'); if (b) b.disabled = !data.recs.filter((r) => data.sel.has(r.id)).every((r) => data.typed[r.id] === (data.games[r.gameId] ?? "Unknown game")); };
    const put = async (patch) => { try { data.settings = await api.put("/settings", patch); toast("Saved."); } catch (e) { fail(e); } repaint(); };
    const a = delegate(root, "click", "act", {
      savedir: async () => { try { data.settings = await api.put("/settings", { storageDir: data.dir.trim() }); toast("Recordings folder saved."); ctx.rerender(); } catch (e) { data.dirErr = errOf(e); repaint(); } },
      sel: (el) => { const id = el.dataset.id; data.sel.has(id) ? data.sel.delete(id) : data.sel.add(id); data.confirm = false; repaint(); },
      selall: () => { const ids = data.recs.filter(selectable).map((r) => r.id), every = ids.every((i) => data.sel.has(i)); data.sel = new Set(every ? [] : ids); data.confirm = false; repaint(); },
      delete: () => { data.confirm = true; data.typed = {}; data.delErr = ""; repaint(); ready(); },
      canceldel: () => { data.confirm = false; repaint(); },
      dodelete: async () => {
        const todo = data.recs.filter((r) => data.sel.has(r.id));
        for (const r of todo) { try { await api.del(`/recordings/${r.id}`); } catch (e) { data.delErr = `${data.games[r.gameId] ?? "A recording"}: ${errOf(e)}`; repaint(); ready(); return; } }
        toast(`Deleted ${todo.length} recording${todo.length === 1 ? "" : "s"}.`); ctx.rerender();
      },
    });
    const i = delegate(root, "input", "in", {
      dir: (el) => { data.dir = el.value; data.dirErr = ""; const b = root.querySelector('[data-act="savedir"]'); b.disabled = el.value.trim() === data.settings.storageDir; setErr(root, ""); },
      confirm: (el) => { data.typed[el.dataset.id] = el.value; ready(); },
      low: (el) => { root.querySelector("[data-lowv]").textContent = `${el.value} GB`; },
    });
    const c = delegate(root, "change", "in", { retention: (el) => put({ retention: el.value }), low: (el) => put({ lowSpaceGb: Number(el.value) }) });
    return all(a, i, c);
  },
};
