// Connectors: saved links to other systems (Singular / UNO, a CasparCG server, any web service) and the "Remote graphic" flow that
// ties one connector to a graphic that Fieldhouse shows, updates and hides. Secrets are write-only: the API says `secretSet`, never the value.
import { html, raw, icon, api, toast, fail, go, fmtTime } from "../app.js";
import { slugName, ROLE_LABEL, pairsText } from "./graphics-lib.js";
import { text, num, sel, chk, area, pill, sec, bindForm, openDialog, confirmDialog } from "./graphics-ui.js";
import { fieldsEditor, bindFieldButtons } from "./graphics-fields.js";

export const CONN_KIND = { singular: "Singular or UNO", caspar: "CasparCG server", http: "Web service (HTTP)" };
const CONN_HELP = {
  singular: "Online graphics from Singular.live or UNO. Fieldhouse sends names and scores to your overlay and tells it when to appear.",
  caspar: "A CasparCG server on your network. Fieldhouse tells it which template to play and what data to show.",
  http: "Anything else that can be controlled by a web address. You say which address to call to show, update and hide.",
};
const CONN_ICON = { singular: "bolt", caspar: "film", http: "link" };
const SING_TYPE = { number: "number", checkbox: "bool", color: "color", image: "image" };

// ---------------------------------------------------------------- the address of a remote graphic ("target"), shared with the editor
/** Form controls for a remote graphic's target, by connector kind. `p` is the dotted path of the target in the draft. */
export function targetFields(kind, p, t = {}) {
  if (kind === "singular") return html`<div class="gx-g2">${text(`${p}.subCompositionName`, t.subCompositionName, "Sub-composition name", { hint: "The name of the part of your overlay this graphic controls." })}
    ${sel(`${p}.outState`, t.outState || "Out", "Hide animation", [["Out", "Out"], ["Out1", "Out 1"], ["Out2", "Out 2"]], { hint: "Which exit animation Singular plays when this is hidden." })}</div>`;
  if (kind === "caspar") return html`<div class="gx-g2">${text(`${p}.template`, t.template, "Template name", { hint: "Leave empty to use the connector's template." })}
    ${text(`${p}.channel`, t.channel, "Channel", { type: "number", hint: "Empty: the connector's channel." })}${text(`${p}.layer`, t.layer, "Layer", { type: "number", hint: "Empty: the connector's layer." })}${text(`${p}.cgLayer`, t.cgLayer, "Template layer", { type: "number", hint: "Empty: the connector's setting." })}</div>`;
  if (kind === "http") return area(`${p}`, pairsText(t), "Extra values for the addresses (optional)", { rows: 3, mono: true, ph: "id: lower3", hint: raw("One per line as <code>name: value</code>. Use them in the connector's addresses as <code>{{target.name}}</code>."), pairs: true });
  return "";
}
const NUMS = ["channel", "layer", "cgLayer"];
/** Target as the API wants it: no empty values, numbers as numbers. */
export function cleanTarget(kind, t = {}) {
  const o = {};
  for (const [k, v] of Object.entries(t)) { if (v === "" || v == null) continue; o[k] = NUMS.includes(k) && Number.isFinite(+v) ? +v : v; }
  return o;
}

// ---------------------------------------------------------------- connector form
const blank = (kind) => ({ kind, name: CONN_KIND[kind], enabled: true, secret: "", clearSecret: false,
  config: kind === "singular" ? { ratePerSecond: 5, retries: 5 } : kind === "caspar" ? { host: "127.0.0.1", port: 5250, channel: 1, layer: 10, cgLayer: 1, template: "", dataFormat: "xml", playOnLoad: true, hideMode: "stop" } : { show: {}, update: {}, hide: {}, next: {}, testUrl: "" } });
const ACTIONS = [["show", "When a graphic goes on air"], ["update", "When its values change"], ["hide", "When it goes off air"], ["next", "When you press Next"]];
const act = (a, cfg) => { const x = cfg[a] || {}; const p = `config.${a}`; return html`<div class="gx-fld"><b>${ACTIONS.find((r) => r[0] === a)[1]}</b>
  <div class="gx-g2">${sel(`${p}.method`, x.method || "POST", "Method", ["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => [m, m]))}${text(`${p}.url`, x.url, "Address (URL)", { mono: true, ph: "https://example.com/graphics/show", hint: "Leave empty to do nothing at this step." })}</div>
  ${area(`${p}.headers`, pairsText(x.headers), "Headers (optional)", { rows: 2, mono: true, ph: "Authorization: Bearer {{secret}}", pairs: true })}
  <div class="gx-g2">${area(`${p}.body`, x.body, "Message body (optional)", { rows: 3, mono: true, ph: '{"name": "{{field.title}}"}' })}${sel(`${p}.bodyFormat`, x.bodyFormat || "json", "Body is", [["json", "JSON"], ["text", "Plain text"]])}</div></div>`; };

function connForm(c, d) {
  const k = c.kind, cfg = c.config;
  const body = k === "singular" ? html`
      <div class="field"><label for="gx-sec">App token</label><input class="input mono" id="gx-sec" type="password" autocomplete="new-password" spellcheck="false" data-p="secret" placeholder="${d.saved?.secretSet ? "Saved. Leave empty to keep it." : "Paste the control app token"}" aria-describedby="gx-sech">
        <span class="hint" id="gx-sech">In Singular, open your overlay, choose Control App, then copy the app token. Fieldhouse keeps it on this computer and never shows it again.</span></div>
      ${d.saved?.secretSet ? html`<div class="row">${pill("ready", "Token saved", "check")}${chk("clearSecret", c.clearSecret, "Remove the saved token when I save")}</div>` : ""}
      <div class="gx-g2">${num("config.ratePerSecond", cfg.ratePerSecond, "Messages per second", { min: 0.2, max: 50, step: 0.1, hint: "Singular's free plan allows only about 25 per minute (0.4 here). Lower this if graphics stop updating." })}
      ${num("config.retries", cfg.retries, "Tries after a failure", { min: 0, max: 10 })}</div>`
    : k === "caspar" ? html`
      <div class="gx-g3">${text("config.host", cfg.host, "Server address", { mono: true, hint: "The computer running CasparCG. 127.0.0.1 means this computer." })}${num("config.port", cfg.port, "Port", { min: 1, max: 65535, hint: "CasparCG uses 5250." })}${sel("config.dataFormat", cfg.dataFormat, "Data format", [["xml", "XML (classic templates)"], ["json", "JSON (CasparCG 2.1 and newer)"]])}</div>
      <div class="gx-g3">${num("config.channel", cfg.channel, "Channel", { min: 1 })}${num("config.layer", cfg.layer, "Layer", { min: 0 })}${num("config.cgLayer", cfg.cgLayer, "Template layer", { min: 0 })}</div>
      <div class="gx-g2">${text("config.template", cfg.template, "Template name", { hint: "As CasparCG knows it, for example lower-third. A graphic can use a different one." })}
      ${sel("config.hideMode", cfg.hideMode, "When a graphic is hidden", [["stop", "Play its exit (stop)"], ["remove", "Remove it"], ["clear", "Clear the whole layer"]])}</div>
      ${chk("config.playOnLoad", cfg.playOnLoad !== false, "Start the template as soon as it loads", "Most templates need this on.")}
      <p class="hint">A CasparCG server draws on its own video outputs. To see the graphic in OBS, give the remote graphic an output page, or import the template as a CasparCG template instead.</p>`
    : html`<p class="muted">For each step, give the address to call. Leave a step empty to skip it. You can put live values in addresses, headers and bodies: <code>{{home.score}}</code>, <code>{{field.name}}</code>, <code>{{target.key}}</code> and <code>{{secret}}</code>.</p>
      ${ACTIONS.map(([a]) => act(a, cfg))}
      ${text("config.testUrl", cfg.testUrl, "Test address (optional)", { mono: true, hint: "The Test button opens this address to check the connection. Nothing is sent to your graphics." })}
      <div class="field"><label for="gx-sec">Secret (optional)</label><input class="input mono" id="gx-sec" type="password" autocomplete="new-password" spellcheck="false" data-p="secret" placeholder="${d.saved?.secretSet ? "Saved. Leave empty to keep it." : "A key or password the service needs"}"><span class="hint">Use it as {{secret}}. It is never shown again.</span></div>
      ${d.saved?.secretSet ? html`<div class="row">${pill("ready", "Secret saved", "check")}${chk("clearSecret", c.clearSecret, "Remove the saved secret when I save")}</div>` : ""}`;
  return html`<form class="gx-stack" data-conn-form novalidate>${sec(`${CONN_KIND[k]}`, html`<p class="muted">${CONN_HELP[k]}</p>${text("name", c.name, "Name", { max: 60, hint: "How you will find it in lists." })}${body}${chk("enabled", c.enabled, "Switched on")}`)}
    <div class="gx-ft"><span class="hint gx-bad" role="alert" data-err></span><a class="btn ghost" href="#/graphics?tab=connectors">Cancel</a>${d.saved ? html`<button type="button" class="btn" data-act="test">${icon("refresh")}Test the connection</button>` : ""}<button type="submit" class="btn pri">${icon("check")}${d.saved ? "Save changes" : "Add connector"}</button></div></form>`;
}

// ---------------------------------------------------------------- the screen
const statusPill = (s) => (s?.ok === true ? pill("ready", "Working", "check") : s?.ok === false ? pill("err", "Problem", "alert") : pill("off", "Not tested yet"));
function row(c) {
  return html`<div class="gx-conn" data-conn="${c.id}"><span class="gx-ic">${icon(CONN_ICON[c.kind], "lg")}</span>
    <div style="min-width:0"><div class="row" style="gap:12px;flex-wrap:wrap"><b>${c.name}</b>${statusPill(c.status)}${c.enabled ? "" : pill("off", "Switched off")}</div>
      <div class="sub">${CONN_KIND[c.kind]}${c.secretSet ? " · Token saved" : ""} · ${c.status?.message ? html`${c.status.message}${c.status.at ? html` <span class="faint">(${fmtTime(c.status.at)})</span>` : ""}` : c.kind === "caspar" ? `${c.config.host}:${c.config.port}` : "Press Test to check that it works."}</div></div>
    <div class="acts"><button type="button" class="btn sm" data-act="test" data-id="${c.id}">${icon("refresh", "sm")}Test</button><a class="btn sm" href="#/graphics?tab=connectors&c=${c.id}">${icon("sliders", "sm")}Edit</a><a class="btn sm ghost" href="#/graphics?tab=connectors&remote=1&conn=${c.id}">${icon("plus", "sm")}Remote graphic</a><button type="button" class="btn sm ghost del" data-act="del" data-id="${c.id}">${icon("x", "sm")}Delete</button></div></div>`;
}

const remoteDraft = (conns, id) => ({ connId: id || conns[0]?.id || "", name: "", role: "other", fields: [], target: {}, outputUrl: "", width: 1920, height: 1080, comps: null, pick: "", loading: false, err: "" });

function remoteHtml(r, d) {
  const conn = d.conns.find((c) => c.id === r.connId), k = conn?.kind;
  if (!d.conns.length) return html`<div class="banner info">${icon("info", "lg")}<div><b>Add a connector first.</b> <span class="muted">A remote graphic needs a saved link to the system that draws it.</span></div><span class="sp"></span><a class="btn pri" href="#/graphics?tab=connectors&c=new">Add a connector</a></div>`;
  const comp = r.comps?.find((c) => c.name === r.pick);
  return html`
    ${sec("1. Which system draws it", html`${sel("connId", r.connId, "Connector", d.conns.map((c) => [c.id, `${c.name} (${CONN_KIND[c.kind]})`]), { re: "", hint: "Not listed? Add it on the Connectors page." })}`)}
    ${k === "singular" ? sec("2. Pick the part of your overlay", html`
        <p class="muted">Fieldhouse asks Singular which parts (sub-compositions) your overlay has and what each can show. Nothing changes in Singular.</p>
        <div><button type="button" class="btn" data-act="load" ${r.loading ? "disabled" : ""}>${icon("refresh")}${r.loading ? "Asking Singular..." : r.comps ? "Load again" : "Load my compositions"}</button></div>
        ${r.err ? html`<div class="banner err" role="alert">${icon("alert", "lg")}<div><b>That did not work.</b> <span class="muted">${r.err}</span></div></div>` : ""}
        ${r.comps ? (r.comps.length ? html`<div class="gx-pick" role="radiogroup" aria-label="Sub-composition">${r.comps.map((c) => html`<label><input type="radio" name="comp" value="${c.name}" ${c.name === r.pick ? "checked" : ""}><b>${c.name}</b><span class="hint">${c.fields.length} control${c.fields.length === 1 ? "" : "s"}${c.state ? `, now ${c.state}` : ""}${c.fields.length ? ": " + c.fields.slice(0, 5).map((f) => f.title || f.id).join(", ") : ""}</span></label>`)}</div>` : html`<p class="muted">Singular answered, but no sub-compositions were found in that app.</p>`) : ""}
        ${comp ? sel("target.outState", r.target.outState || "Out", "Hide animation", [["Out", "Out"], ["Out1", "Out 1"], ["Out2", "Out 2"]], { hint: "Which exit animation Singular plays when this is hidden." }) : ""}`)
      : k ? sec("2. Where it lives", targetFields(k, "target", r.target)) : ""}
    ${k ? sec("3. The values it shows", html`<p class="muted">${k === "singular" ? "These came from the controls of the part you picked. Choose where each value comes from: the game, fixed text, or typed in when you show it." : "Add one field per value the graphic shows. Choose where each value comes from."}</p><div data-fields>${fieldsEditor(r.fields, { prefix: "fields", vars: d.vars })}</div>`) : ""}
    ${k ? sec("4. Name it", html`<div class="gx-g2">${text("name", r.name, "Name", { max: 60, ph: "Lower third from Singular" })}${sel("role", r.role, "What kind of graphic is it", Object.entries(ROLE_LABEL))}</div>
      ${text("outputUrl", r.outputUrl, "Output page (optional)", { mono: true, ph: "https://...", hint: "The web page that shows this graphic. If you add one, Fieldhouse puts it in OBS as a layer so it appears in your video. Leave empty if another system already shows it." })}
      ${r.outputUrl ? html`<div class="gx-g2">${num("width", r.width, "Page width", { min: 100, max: 7680 })}${num("height", r.height, "Page height", { min: 100, max: 4320 })}</div>` : ""}`) : ""}
    ${k ? html`<div class="gx-ft"><span class="hint gx-bad" role="alert" data-err></span><a class="btn ghost" href="#/graphics?tab=connectors">Cancel</a><button type="button" class="btn pri" data-act="create">${icon("check")}Create remote graphic</button></div>` : ""}`;
}

export default {
  async load(ctx) {
    const [conns, vars] = await Promise.all([api.get("/graphics/connectors"), api.get("/graphics/sample-vars")]), q = ctx.query;
    const d = { conns, vars };
    if (q.c && q.c !== "new") { d.saved = conns.find((c) => c.id === q.c); if (!d.saved) throw new Error("That connector no longer exists."); d.draft = { kind: d.saved.kind, name: d.saved.name, enabled: d.saved.enabled, secret: "", clearSecret: false, config: structuredClone(d.saved.config) }; }
    else if (q.c === "new" && CONN_KIND[q.kind]) d.draft = blank(q.kind);
    if (d.draft?.kind === "http") for (const [a] of ACTIONS) d.draft.config[a] ||= {};
    if (q.remote) d.remote = remoteDraft(conns, q.conn);
    return d;
  },
  render(ctx, d) {
    const q = ctx.query;
    if (q.c === "new" && !CONN_KIND[q.kind]) return html`<div class="gx-head"><div><h1>Add a connector</h1><p class="sub">What kind of system do you want to link?</p></div></div>
      <div class="gx-kinds">${Object.keys(CONN_KIND).map((k) => html`<a class="gx-kind" href="#/graphics?tab=connectors&c=new&kind=${k}"><span class="gx-ic">${icon(CONN_ICON[k], "lg")}</span><b>${CONN_KIND[k]}</b><span class="hint">${CONN_HELP[k]}</span></a>`)}</div><a class="btn ghost" style="justify-self:start" href="#/graphics?tab=connectors">Cancel</a>`;
    if (d.draft) return html`<div class="gx-head gx-w"><div><h1>${d.saved ? `Edit ${d.saved.name}` : `New ${CONN_KIND[d.draft.kind]} connector`}</h1></div></div><div class="gx-w" data-form>${connForm(d.draft, d)}</div>`;
    if (d.remote) return html`<div class="gx-head gx-w"><div><h1>New remote graphic</h1><p class="sub">A remote graphic is drawn by another system. Fieldhouse tells it when to show, what to say and when to hide.</p></div></div><div class="gx-stack gx-w" data-remote>${remoteHtml(d.remote, d)}</div>`;
    return html`<div class="gx-head"><p class="sub" style="margin:0">A connector is a saved link to another system, such as Singular or a CasparCG server. Graphics from that system can then be shown, updated and hidden from here and from the live console.</p><span class="sp"></span>${d.conns.length ? html`<a class="btn" href="#/graphics?tab=connectors&remote=1">${icon("plus")}New remote graphic</a><a class="btn pri" href="#/graphics?tab=connectors&c=new">${icon("plus")}Add connector</a>` : ""}</div>
      <div class="panel" data-list>${d.conns.length ? d.conns.map(row) : html`<div class="empty"><span class="gx-ic">${icon("link", "lg")}</span><b>No connectors yet</b><span>You only need one if you use graphics from Singular, UNO, CasparCG or a web service. The built-in graphics need nothing.</span><a class="btn pri" href="#/graphics?tab=connectors&c=new">${icon("plus")}Add connector</a></div>`}</div>`;
  },
  bind(root, ctx, d) {
    const un = [];
    if (d.draft) { // ---- connector form
      const c = d.draft, form = root.querySelector("[data-conn-form]"), err = (m) => { root.querySelector("[data-err]").textContent = m || ""; };
      un.push(bindForm(root, c, { onChange: () => err("") }));
      const body = () => {
        const o = { name: slugName(c.name), enabled: c.enabled, config: structuredClone(c.config) };
        if (c.kind === "http") for (const a of ACTIONS.map((r) => r[0])) { const x = o.config[a]; if (!x?.url) delete o.config[a]; else { x.method ||= "POST"; x.bodyFormat ||= "json"; if (!x.body) delete x.body; if (!Object.keys(x.headers || {}).length) delete x.headers; } }
        if (c.kind === "http" && !o.config.testUrl) delete o.config.testUrl;
        if (c.secret) o.secret = c.secret; if (c.clearSecret) o.clearSecret = true;
        return o;
      };
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!slugName(c.name)) return err("Give the connector a name.");
        try {
          if (d.saved) await api.put(`/graphics/connectors/${d.saved.id}`, body()); else await api.post("/graphics/connectors", { kind: c.kind, ...body() });
          toast(d.saved ? "Saved." : "Connector added. Press Test to check it."); go("/graphics?tab=connectors");
        } catch (x) { err(x.message); }
      });
      root.querySelector('[data-act="test"]')?.addEventListener("click", async () => {
        try { const r = await api.post(`/graphics/connectors/${d.saved.id}/test`); toast(r.ok ? `Working: ${r.message}` : `Problem: ${r.message}`); } catch (x) { fail(x); }
      });
    } else if (d.remote) { // ---- remote graphic flow
      const r = d.remote, paint = () => { root.querySelector("[data-remote]").innerHTML = remoteHtml(r, d).s; };
      const err = (m) => { const e = root.querySelector("[data-err]"); if (e) e.textContent = m || ""; };
      un.push(bindForm(root, r, { onChange: () => err(""), onRedraw: (p) => { if (p === "connId") { r.comps = null; r.pick = ""; r.fields = []; r.target = {}; r.err = ""; } paint(); } }));
      un.push(bindFieldButtons(root, () => r.fields, paint));
      const pick = (e) => {
        const el = e.target.closest("input[name=comp]"); if (!el) return;
        const c = r.comps.find((x) => x.name === el.value); r.pick = c.name; r.target = { subCompositionName: c.name, outState: "Out" };
        r.fields = c.fields.map((f) => ({ name: f.id, label: f.title || f.id, type: SING_TYPE[f.type] || "text", default: f.defaultValue == null ? "" : String(f.defaultValue), binding: { kind: "manual", value: "" } }));
        if (!r.name) r.name = c.name; paint();
      };
      const click = async (e) => {
        const a = e.target.closest("[data-act]")?.dataset.act;
        if (a === "load") { r.loading = true; r.err = ""; paint(); try { r.comps = (await api.get(`/graphics/connectors/${r.connId}/model`)).compositions || []; } catch (x) { r.err = x.message; } r.loading = false; paint(); }
        if (a === "create") {
          const conn = d.conns.find((c) => c.id === r.connId);
          if (!slugName(r.name)) return err("Give the graphic a name.");
          if (conn.kind === "singular" && !r.pick) return err("Pick a sub-composition first.");
          if (r.outputUrl && !/^https?:\/\//i.test(r.outputUrl)) return err("The output page must start with http:// or https://");
          try {
            const g = await api.post("/graphics/create", { kind: "remote", name: slugName(r.name), role: r.role, fields: r.fields, source: { connectorId: r.connId, target: cleanTarget(conn.kind, r.target), outputUrl: r.outputUrl, width: r.width, height: r.height, css: "" } });
            toast("Remote graphic created."); go(`/graphics?edit=${encodeURIComponent(g.id)}`);
          } catch (x) { err(x.message); }
        }
      };
      root.addEventListener("change", pick); root.addEventListener("click", click);
      un.push(() => { root.removeEventListener("change", pick); root.removeEventListener("click", click); });
    } else { // ---- list
      const click = async (e) => {
        const b = e.target.closest("[data-act]"); if (!b) return; const id = b.dataset.id, c = d.conns.find((x) => x.id === id);
        try {
          if (b.dataset.act === "test") { b.disabled = true; const r = await api.post(`/graphics/connectors/${id}/test`); toast(r.ok ? `${c.name} works: ${r.message}` : `${c.name} has a problem: ${r.message}`); ctx.rerender(); }
          if (b.dataset.act === "del" && await confirmDialog(`Delete ${c.name}?`, "Remote graphics that use it stop working until you pick another connector for them. The saved token is removed.", "Delete", { danger: true })) { await api.del(`/graphics/connectors/${id}`); toast("Deleted."); ctx.rerender(); }
        } catch (x) { fail(x); if (b) b.disabled = false; }
      };
      root.addEventListener("click", click); un.push(() => root.removeEventListener("click", click));
    }
    return () => un.forEach((f) => f());
  },
};
