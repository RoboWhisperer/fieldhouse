// Settings sections: destinations, graphics themes, sport profile.
import { html, raw, icon, api, S, toast, fail } from "../app.js";
import { REPO, delegate, all, sw, dirtyBar, setDirty, setErr, copyText, lnk, panel } from "./settings-ui.js";
import { contrast, rate, isHex, sportSummary } from "./settings-lib.js";

const tag = (r) => r.querySelector("[data-box]");
const paint = (root, view) => { const b = tag(root); if (b) b.innerHTML = view().s; };
const errOf = (e) => (e?.message || String(e));

// ================================================================ destinations
const PROV = {
  youtube: { name: "YouTube", logo: "YT", bg: "#c4302b", url: "rtmp://a.rtmp.youtube.com/live2", where: "YouTube Studio, under Go Live" },
  facebook: { name: "Facebook", logo: "FB", bg: "#1b6ac9", url: "rtmps://live-api-s.facebook.com:443/rtmp/", where: "Facebook Live Producer" },
  rtmp: { name: "Custom RTMP", logo: null, bg: "var(--line-strong)", url: "rtmp://", where: "your streaming service" },
};
const SLOTS = Object.keys(PROV);
const hostOf = (u) => { try { return new URL(u).host; } catch { return u || ""; } };
const pill = (cls, text) => html`<span class="pill ${cls}">${text}</span>`;

const dOf = (data, slot) => data.list.find((d) => d.kind === slot);
function E(data, slot) {
  const d = dOf(data, slot), base = d?.url ?? PROV[slot].url;
  return (data.ed[slot] ||= { open: slot === "rtmp", url: base, base, key: "", show: false, err: "" });
}
const edits = (data) => SLOTS.flatMap((s) => { const e = data.ed[s]; if (!e) return []; return [e.url.trim() !== e.base && `${PROV[s].name} server address`, e.key !== "" && `${PROV[s].name} stream key`].filter(Boolean); });

function slotRow(data, slot) {
  const P = PROV[slot], d = dOf(data, slot), e = E(data, slot), live = d?.keySet && d?.url, res = d && data.res[d.id];
  const dirty = e.url.trim() !== e.base || e.key !== "";
  const status = res ? (res.ok ? pill("ready", "Server found") : pill("err", "Could not reach")) : live ? pill("ready", slot === "rtmp" ? "Saved" : "Connected") : slot === "rtmp" ? pill("off", "Not set up") : pill("off", "Not connected");
  const sub = live ? html`Server ${hostOf(d.url)}, stream key saved` : slot === "rtmp" ? "Any service that gives you a server address and a stream key" : html`Copy the server address and stream key from ${P.where}`;
  const editor = e.open && html`
    <div class="kv"><label class="muted" for="url-${slot}">Server address</label><input id="url-${slot}" class="input mono" data-in="url" data-slot="${slot}" value="${e.url}" spellcheck="false" autocomplete="off"><span class="chip warn" data-chip="url-${slot}" style="visibility:${e.url.trim() !== e.base ? "visible" : "hidden"}">Edited</span></div>
    <div class="kv"><label class="muted" for="key-${slot}">Stream key</label><input id="key-${slot}" class="input mono" type="${e.show ? "text" : "password"}" data-in="key" data-slot="${slot}" value="${e.key}" placeholder="${d?.keySet ? "Saved. Type a new key to replace it" : "Paste the stream key"}" spellcheck="false" autocomplete="off"><span class="row" style="gap:8px"><span class="chip warn" data-chip="key-${slot}" style="visibility:${e.key !== "" ? "visible" : "hidden"}">Edited</span><button class="btn sm" data-act="reveal" data-slot="${slot}" ${e.key ? "" : "disabled"} title="${e.key ? "" : "Only a key typed in this session can be shown"}">${icon("eye")}${e.show ? "Hide" : "Reveal"}</button></span></div>
    <div class="hint">The stream key is write-only: once saved, Fieldhouse never shows it again.</div>`;
  return html`<div class="dst" style="align-items:start">
    <span class="logo-ph" style="background:${P.bg}">${P.logo ?? icon("link", "lg")}</span>
    <div style="min-width:0;display:grid;gap:10px"><div><div style="font-weight:650;font-size:15px">${P.name}</div><div class="muted" style="font-size:12.5px">${sub}</div>${res ? html`<div class="hint ${res.ok ? "" : "err"}" role="status">${res.message}</div>` : ""}</div>${editor}</div>
    <div class="row" style="margin-top:2px">${status}
      ${d && html`<button class="btn sm" data-act="test" data-id="${d.id}" ${dirty ? "disabled" : ""} title="${dirty ? "Save your changes first" : ""}">Test</button>`}
      ${slot !== "rtmp" && !e.open && html`<button class="btn sm ${live ? "ghost" : ""}" data-act="open" data-slot="${slot}">${live ? "Edit" : "Connect"}</button>`}
      ${slot !== "rtmp" && e.open && !live && html`<button class="btn sm ghost" data-act="close" data-slot="${slot}">Cancel</button>`}
      ${d && html`<button class="btn sm ghost" data-act="del" data-id="${d.id}">Disconnect</button>`}</div></div>`;
}
function destView(data) {
  const used = new Set(SLOTS.map((s) => dOf(data, s)?.id));
  const others = data.list.filter((d) => !used.has(d.id));
  return html`${panel("Destinations", html`
    <div class="row" style="padding:12px 16px;border-bottom:1px solid var(--line);align-items:flex-start"><span style="color:var(--text-2)">${icon("info", "lg")}</span><span class="muted">Signing in with YouTube or Facebook is not built. Instead, copy the server address (RTMP URL) and the stream key from the platform and paste them here. Keys stay on this computer.</span></div>
    ${SLOTS.map((s) => slotRow(data, s))}
    ${others.map((d) => html`<div class="dst"><span class="logo-ph" style="background:var(--line-strong)">${icon("link", "lg")}</span><div style="min-width:0"><div style="font-weight:650;font-size:15px">${d.name}</div><div class="muted" style="font-size:12.5px">${d.kind === "record" ? "Recording on this computer" : html`${d.kind.toUpperCase()} ${hostOf(d.url)}${d.keySet ? ", stream key saved" : ""}`}</div>${data.res[d.id] ? html`<div class="hint ${data.res[d.id].ok ? "" : "err"}">${data.res[d.id].message}</div>` : ""}</div><div class="row"><button class="btn sm" data-act="test" data-id="${d.id}">Test</button>${d.kind !== "record" && html`<button class="btn sm ghost" data-act="del" data-id="${d.id}">Disconnect</button>`}</div></div>`)}`)}`;
}
export const destinations = {
  async load() { return { list: await api.get("/destinations"), ed: {}, res: {} }; },
  render: (ctx, data) => html`<div class="cp" data-box>${destView(data)}</div>`,
  bar: () => dirtyBar(""),
  bind(root, ctx, data) {
    const view = () => destView(data), note = () => setDirty(root, edits(data));
    const slotOf = (el) => el.dataset.slot;
    const reset = () => { data.ed = {}; setErr(root, ""); paint(root, view); note(); };
    const a = delegate(root, "click", "act", {
      open: (el) => { E(data, slotOf(el)).open = true; paint(root, view); },
      close: (el) => { delete data.ed[slotOf(el)]; paint(root, view); note(); },
      reveal: (el) => { const e = E(data, slotOf(el)); e.show = !e.show; paint(root, view); },
      discard: reset,
      save: async () => {
        setErr(root, "");
        for (const s of SLOTS) {
          const e = data.ed[s]; if (!e || (e.url.trim() === e.base && !e.key)) continue;
          const d = dOf(data, s);
          try { await api.post("/destinations", { id: d?.id, kind: s, name: d?.name ?? PROV[s].name, url: e.url.trim(), key: e.key || undefined, enabled: d?.enabled ?? true }); }
          catch (err) { setErr(root, `${PROV[s].name}: ${errOf(err)}`); return; }
        }
        toast("Destinations saved."); ctx.rerender();
      },
      test: async (el) => { try { data.res[el.dataset.id] = await api.post(`/destinations/${el.dataset.id}/test`); } catch (e) { data.res[el.dataset.id] = { ok: false, message: errOf(e) }; } paint(root, view); },
      del: async (el) => {
        const d = data.list.find((x) => x.id === el.dataset.id);
        if (!confirm(`Disconnect ${d?.name ?? "this destination"}? Its saved server address and stream key will be removed from this computer.`)) return;
        try { await api.del(`/destinations/${el.dataset.id}`); toast("Disconnected."); ctx.rerender(); } catch (e) { fail(e); }
      },
    });
    const i = delegate(root, "input", "in", { url: (el) => { E(data, slotOf(el)).url = el.value; chips(); }, key: (el) => { E(data, slotOf(el)).key = el.value; chips(); } });
    function chips() {
      for (const s of SLOTS) { const e = data.ed[s]; if (!e) continue; const u = root.querySelector(`[data-chip="url-${s}"]`), k = root.querySelector(`[data-chip="key-${s}"]`), r = root.querySelector(`[data-act="reveal"][data-slot="${s}"]`), t = dOf(data, s); if (u) u.style.visibility = e.url.trim() !== e.base ? "visible" : "hidden"; if (k) k.style.visibility = e.key ? "visible" : "hidden"; if (r) r.disabled = !e.key; if (t) { const b = root.querySelector(`[data-act="test"][data-id="${t.id}"]`); if (b) b.disabled = e.url.trim() !== e.base || !!e.key; } }
      note();
    }
    return all(a, i);
  },
};

// ================================================================ themes
const THEMES = [
  { id: "hardwood", name: "Hardwood", sub: "Court tones", bg: "#6b4a2a", bug: "#0b1018", fg: "#fff", sc: "#fff", scFg: "#0b1018", sc2: "#e6ecf4" },
  { id: "midnight", name: "Midnight", sub: "Dark navy", bg: "#101a2c", bug: "#0b1018", fg: "#fff", sc: "#e6ecf4", scFg: "#0b1018" },
  { id: "clean", name: "Clean White", sub: "Bright feeds", bg: "#cfd8e3", bug: "#fff", fg: "#0b1018", sc: "#0b1018", scFg: "#fff" },
  { id: "contrast", name: "High Contrast", sub: "Max legibility", bg: "#000", bug: "#000", fg: "#fff", sc: "#fff", scFg: "#000" },
];
const periodParts = (p) => (p > 4 ? ["OT", p - 4 > 1 ? String(p - 4) : ""] : ["Q", String(p)]);
const clr = (c, d) => (isHex(c) ? c : d);

function themeCard(t, on, g) {
  const h = g?.home.abbr ?? "HOME", a = g?.away.abbr ?? "AWAY", gs = S.state?.game;
  const mini = html`<span style="width:4px;background:${clr(g?.home.color, "var(--home)")}"></span><span style="padding:0 5px">${h}</span><span style="padding:0 5px;background:${t.sc};color:${t.scFg}">${gs?.home.score ?? 0}</span><span style="padding:0 5px;background:${t.sc2 ?? t.sc};color:${t.scFg}">${gs?.away.score ?? 0}</span><span style="padding:0 5px">${a}</span><span style="width:4px;background:${clr(g?.away.color, "var(--away)")}"></span>`;
  return html`<button type="button" class="card-btn th" data-act="theme" data-id="${t.id}" aria-pressed="${on}" style="${on ? "border:2px solid var(--action);background:var(--action-wash)" : "border:1px solid var(--line)"}">
    <div style="position:relative;height:92px;border-radius:6px;overflow:hidden;background:${t.bg}"><div style="position:absolute;left:8px;top:8px;display:flex;height:16px;border-radius:3px;overflow:hidden;font:800 8px/16px var(--ui);color:${t.fg};background:${t.bug}">${mini}</div></div>
    <div class="row"><div style="min-width:0"><div style="font-weight:650;font-size:14px;white-space:nowrap">${t.name}</div><div class="muted" style="font-size:12px;white-space:nowrap">${t.sub}</div></div><span class="sp"></span>${on ? pill("info noDot", "Selected") : pill("off noDot", "Choose")}</div></button>`;
}
function themeView(data) {
  const s = data.settings, t = THEMES.find((x) => x.id === s.theme) ?? THEMES[0], g = data.game, gs = S.state?.game;
  const [pl, pn] = periodParts(gs?.period ?? 1);
  const teamRow = (side) => {
    const tm = g[side], ok = isHex(tm.color), ratio = ok ? contrast(tm.color, t.bug) : 0, r = rate(ratio);
    return html`<div class="row" style="padding:10px 0;${side === "home" ? "border-bottom:1px solid var(--line)" : ""}"><span class="swatch" style="width:28px;height:28px;border-radius:6px;background:${clr(tm.color, "var(--line-strong)")}"></span><div style="min-width:0"><b>${tm.name}</b><div class="muted mono" style="font-size:12px">${tm.color} (${side})</div></div><span class="sp"></span>${ok && pill(r.id, `${r.label} ${ratio.toFixed(1)}:1`)}<input type="color" value="${clr(tm.color, "#000000")}" data-in="color" data-side="${side}" aria-label="${tm.name} color"></div>`;
  };
  return html`
  ${panel("Built-in themes", html`<div class="g4">${THEMES.map((x) => themeCard(x, x.id === s.theme, g))}</div>`)}
  <div class="g2">
    ${panel(`Live preview: ${t.name}`, html`<div class="pb"><div class="monitor pgm" style="${g ? `--home:${clr(g.home.color, "#F5A524")};--away:${clr(g.away.color, "#8B6CFF")}` : ""}"><div class="feed center"></div>
      <div class="bug"><div class="tm h" style="background:${t.bug};color:${t.fg}"><i></i>${g?.home.abbr ?? "HOME"}</div><div class="sc" style="background:${t.sc};color:${t.scFg}" ${raw(gs ? 'data-bind="game.home.score"' : "")}>${gs?.home.score ?? 0}</div><div class="sc" style="background:${t.sc2 ?? t.sc};color:${t.scFg}" ${raw(gs ? 'data-bind="game.away.score"' : "")}>${gs?.away.score ?? 0}</div><div class="tm a" style="background:${t.bug};color:${t.fg}">${g?.away.abbr ?? "AWAY"}<i></i></div><div class="cl"><span><small style="color:#9FB0C5;margin-right:4px" data-pl>${pl}</small><span data-pn>${pn}</span> &nbsp; <span ${gs ? "data-clock" : ""}>${gs ? "" : `${String(data.profile.periodMin).padStart(2, "0")}:00`}</span></span></span></div></div>
      <span class="tag">PROGRAM</span></div>
      <div class="muted" style="margin-top:12px">${g ? "Score bug and lower third share the theme. This is the active game, live." : "No game is active, so this preview shows placeholder team names. Set up a game to see yours."}</div>
      <div class="row muted" style="align-items:flex-start;gap:10px;margin-top:14px;padding-top:14px;border-top:1px solid var(--line)">${icon("info", "lg")}<span style="flex:1">Custom themes are not built yet. When they are, they will be plain HTML and CSS folders placed in <span class="mono">data/themes</span>.</span><button class="btn sm" data-act="copy" data-text="data/themes">${icon("folder", "sm")}Copy folder path</button></div></div>`)}
    <div class="col-g">
      ${panel("Team colors", g ? html`<div style="padding:6px 14px">${teamRow("home")}${teamRow("away")}</div><div class="hint" style="padding:0 14px 12px">Measured against the score bug background of this theme. Colors are saved to the active game (${g.title}). Dim colors still work for the stripe but are hard to read as small text.</div>` : html`<div class="empty">${icon("users", "xl")}<div>Team colors belong to a game. No game is active yet.</div><a class="btn sm" href="#/game/new" style="text-decoration:none">Set up a game</a></div>`)}
      ${panel("On the graphics", html`<div style="padding:4px 14px">
        <div class="row" style="padding:12px 0;border-bottom:1px solid var(--line)">${sw(s.showLogos, "logos", "Show team logos")}<div><b>Show team logos</b><div class="muted" style="font-size:12px">Beside team names in the bug</div></div></div>
        <div class="row" style="padding:12px 0">${sw(s.showSponsorCorner, "corner", "Show sponsor corner")}<div><b>Show sponsor corner</b><div class="muted" style="font-size:12px">Small logo top right during play</div></div></div></div>`)}
    </div></div>`;
}
export const themes = {
  async load() { const [settings] = await Promise.all([api.get("/settings")]); return { settings, profile: settings.profile, game: S.state?.gameDoc ?? null }; },
  render: (ctx, data) => html`<div class="cp" data-box>${themeView(data)}</div>`,
  bind(root, ctx, data) {
    const view = () => themeView(data);
    const put = async (patch) => { try { data.settings = await api.put("/settings", patch); paint(root, view); } catch (e) { fail(e); } };
    const a = delegate(root, "click", "act", {
      theme: (el) => put({ theme: el.dataset.id }),
      logos: () => put({ showLogos: !data.settings.showLogos }),
      corner: () => put({ showSponsorCorner: !data.settings.showSponsorCorner }),
      copy: (el) => copyText(el.dataset.text),
    });
    const i = delegate(root, "change", "in", {
      color: async (el) => {
        const side = el.dataset.side, g = data.game; if (!g) return;
        try { data.game = await api.put(`/games/${g.id}`, { ...g, [side]: { ...g[side], color: el.value.toUpperCase() } }); paint(root, view); } catch (e) { fail(e); paint(root, view); }
      },
    });
    return all(a, i);
  },
  onState(root, st) {
    const [l, n] = periodParts(st.game?.period ?? 1), pl = root.querySelector("[data-pl]"), pn = root.querySelector("[data-pn]");
    if (pl && pl.textContent !== l) pl.textContent = l; if (pn && pn.textContent !== n) pn.textContent = n;
  },
};

// ================================================================ sport profile
const FIELDS = [["periods", "Periods", "Number of periods", 1, 8, ""], ["periodMin", "Period length", "Minutes per period", 1, 60, "min"], ["overtimeMin", "Overtime", "Length of each extra period", 1, 30, "min"], ["bonusAt", "Bonus at", "Team fouls in a period before the bonus", 1, 20, "fouls"], ["timeouts", "Timeouts per team", "Full game", 0, 20, ""]];
const sportDirty = (d) => FIELDS.filter(([k]) => String(d.vals[k]) !== String(d.settings.profile[k])).map(([, l]) => l.toLowerCase());
function sportView(data) {
  const v = data.vals, g = data.game, pr = { ...data.settings.profile, ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Number(x)])) };
  const n = sportDirty(data).length;
  return html`<div class="g2" style="grid-template-columns:minmax(0,1.35fr) minmax(0,1fr)">
    ${panel("Basketball rules", html`
      ${FIELDS.map(([k, label, sub, lo, hi, unit]) => html`<div class="row2"><div><label for="pf-${k}"><b>${label}</b></label><div class="muted" style="font-size:12px">${sub} (${lo} to ${hi})</div></div><div class="row" style="gap:8px"><input id="pf-${k}" class="input mono" type="number" min="${lo}" max="${hi}" step="1" style="width:84px" data-in="${k}" value="${v[k]}">${unit && html`<span class="muted">${unit}</span>`}</div></div>`)}
      <div class="row2"><div><b>Clock direction</b><div class="muted" style="font-size:12px">Basketball clocks count down</div></div><span class="chip">Counts down</span></div>`, html`<span class="chip warn" data-count style="visibility:${n ? "visible" : "hidden"}">${icon("alert", "sm")}${n} edited</span>`)}
    <div class="col-g" style="gap:16px">
      ${panel("Sport", html`<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:12px">
        <div class="card-btn" style="border:2px solid var(--action);background:var(--action-wash);display:flex;flex-direction:column;gap:8px"><div class="row">${icon("ball", "lg")}<b>Basketball</b></div>${pill("info", "Selected")}</div>
        ${["Football", "Volleyball", "Soccer"].map((s) => html`<div class="card-btn" aria-disabled="true" style="opacity:.6;display:flex;flex-direction:column;gap:8px;min-width:0"><b>${s}</b>${pill("off noDot", "Coming later")}</div>`)}</div>
        <div style="padding:0 12px 12px;display:grid;gap:10px"><span class="muted">Fieldhouse is open source. Add a sport by writing a profile.</span><div class="row">${lnk(`${REPO}/blob/main/CONTRIBUTING.md`, "Contribute a profile", "btn sm", "book")}${lnk(REPO, "View source", "btn sm ghost", "link")}</div><div class="hint">These links use a placeholder repository address.</div></div>`)}
      ${panel("Preview on the Game Ribbon", html`<div class="pb" style="display:grid;gap:10px;flex:none"><div class="ribbon sm"><i class="cap" style="background:${clr(g?.home.color, "var(--home)")}"></i><div class="team">${g?.home.abbr ?? "HOME"} <span class="score">${g ? S.state?.game?.home.score ?? 0 : 0}</span></div><div class="mid"><span class="per"><small style="font:700 11px var(--ui);color:var(--text-2);margin-right:2px">Q</small>1</span><span class="clk" data-pclk>${String(Math.max(0, pr.periodMin) || 0).padStart(2, "0")}:00</span></div><div class="team"><span class="score">${g ? S.state?.game?.away.score ?? 0 : 0}</span> ${g?.away.abbr ?? "AWAY"}</div><i class="cap" style="background:${clr(g?.away.color, "var(--away)")}"></i></div><div class="hint" data-sum>${sportSummary(pr)}</div></div>`)}
    </div></div>`;
}
export const sport = {
  async load() { const settings = await api.get("/settings"); return { settings, vals: { ...settings.profile }, game: S.state?.gameDoc ?? null }; },
  render: (ctx, data) => html`<div class="cp" data-box>${sportView(data)}</div>`,
  bar: () => dirtyBar(""),
  bind(root, ctx, data) {
    const note = () => { const n = sportDirty(data); setDirty(root, n); const c = root.querySelector("[data-count]"); if (c) { c.style.visibility = n.length ? "visible" : "hidden"; c.lastChild.textContent = `${n.length} edited`; } };
    const a = delegate(root, "click", "act", {
      discard: () => { data.vals = { ...data.settings.profile }; setErr(root, ""); paint(root, () => sportView(data)); note(); },
      save: async () => {
        setErr(root, ""); root.querySelectorAll("[data-in]").forEach((x) => x.classList.remove("err"));
        const profile = {}; for (const [k] of FIELDS) { const raw = String(data.vals[k]).trim(); profile[k] = raw === "" ? NaN : Number(raw); }
        if (Object.values(profile).some((x) => Number.isNaN(x))) return setErr(root, "Fill in every rule with a whole number.");
        try { data.settings = await api.put("/settings", { profile }); data.vals = { ...data.settings.profile }; toast("Sport profile saved."); paint(root, () => sportView(data)); note(); }
        catch (e) { setErr(root, errOf(e)); const f = /^(\w+) must/.exec(errOf(e))?.[1]; root.querySelector(`#pf-${f}`)?.classList.add("err"); }
      },
    });
    const i = delegate(root, "input", "in", { periods: upd, periodMin: upd, overtimeMin: upd, bonusAt: upd, timeouts: upd });
    function upd(el) {
      data.vals[el.dataset.in] = el.value; el.classList.remove("err");
      const pr = { ...data.settings.profile, ...Object.fromEntries(Object.entries(data.vals).map(([k, x]) => [k, Number(x)])) };
      root.querySelector("[data-sum]").textContent = sportSummary(pr); root.querySelector("[data-pclk]").textContent = `${String(Math.max(0, pr.periodMin) || 0).padStart(2, "0")}:00`; note();
    }
    return all(a, i);
  },
};
