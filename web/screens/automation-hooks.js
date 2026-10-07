// Automation > Webhooks (messages Fieldhouse sends out) and Integrations (API keys, Companion / Stream Deck, event stream).
import { html, raw, esc, icon, api, toast, fail } from "../app.js";
import { lookups, repaintBox, pill, ago, clock, sw } from "./automation-lib.js";
import { copyText } from "./settings-ui.js";

// ================================================================ webhooks
const BLANK = () => ({ name: "", url: "", events: ["game.*"], enabled: true, secret: "", clearSecret: false });
const QUICK = [["*", "Everything"], ["game.*", "All game events"], ["engine.*", "All video events"]];
const DELIV = { ok: ["ready", "Delivered", "check"], retrying: ["check", "Trying again", "refresh"], failed: ["err", "Failed", "alert"] };
const host = (u) => { try { const x = new URL(u); return x.host + (x.pathname === "/" ? "" : x.pathname); } catch { return u; } };

function wview(d) {
  const ev = d.cat.webhookEvents.filter((e) => !["*", "game.*", "engine.*", "trigger.<name>"].includes(e));
  const f = d.form;
  return html`<div class="bar-row"><p class="muted lead">A webhook tells another program (Companion, a scoreboard site, your own script) the moment something happens. Fieldhouse only sends; it never opens a door for others.</p><span class="sp"></span>
      ${f ? "" : html`<button type="button" class="btn" data-a="example">${icon("book")}Start from an example</button><button type="button" class="btn pri" data-a="new">${icon("plus")}Add a webhook</button>`}</div>
    ${f ? html`<section class="panel"><div class="ph"><h3>${f.id ? "Edit webhook" : "New webhook"}</h3></div><div class="pb stack">
      <div class="g2"><label class="field"><span class="fl">Name <span class="req">*</span></span><input class="input" data-w="name" data-fk="fk-wname" value="${f.name}" maxlength="40" autocomplete="off"></label>
        <label class="field"><span class="fl">Web address to send to <span class="req">*</span></span><input class="input mono" data-w="url" value="${f.url}" placeholder="https://example.com/fieldhouse" autocomplete="off" spellcheck="false"><span class="hint">Starts with http:// or https://. Fieldhouse does not follow redirects and waits 5 seconds at most.</span></label></div>
      <fieldset class="rowsfs"><legend>Send me</legend><div class="chips">${QUICK.map(([e, l]) => html`<label class="chk"><input type="checkbox" data-ev="${e}" ${raw(f.events.includes(e) ? "checked" : "")}> <span>${l} <code>${e}</code></span></label>`)}</div>
        <details ${raw(f.events.some((e) => !QUICK.some((q) => q[0] === e)) ? "open" : "")}><summary>Pick single events</summary><div class="evgrid">${ev.map((e) => html`<label class="chk"><input type="checkbox" data-ev="${e}" ${raw(f.events.includes(e) ? "checked" : "")}> <code>${e}</code></label>`)}</div></details>
        <label class="field"><span class="fl">Other events (comma separated, optional)</span><input class="input mono" data-w="other" value="${f.other ?? f.events.filter((e) => !d.cat.webhookEvents.includes(e)).join(", ")}" placeholder="trigger.goal-horn"><span class="hint">Your own triggers look like <code>trigger.name-in-lower-case</code>.</span></label></fieldset>
      <div class="field"><span class="fl">Signing secret (optional)</span>${f.secretSet ? html`<div class="row"><span class="pill ready noDot">${icon("check", "sm")}A secret is saved</span><label class="chk"><input type="checkbox" data-w="clearSecret" ${raw(f.clearSecret ? "checked" : "")}> <span>Remove it</span></label></div>` : ""}
        <input class="input" type="password" data-w="secret" value="${f.secret}" placeholder="${f.secretSet ? "Type a new secret to replace the saved one" : "8 to 200 characters"}" autocomplete="new-password" aria-label="Signing secret"><span class="hint">The secret is never shown again after saving. With one, every message carries a signature the receiver can check (<code>X-Fieldhouse-Signature</code>).</span></div>
      <label class="chk"><input type="checkbox" data-w="enabled" ${raw(f.enabled ? "checked" : "")}> <span>On (sends messages)</span></label>
      <div class="row"><button type="button" class="btn pri" data-a="wsave">${icon("check")}Save webhook</button><button type="button" class="btn" data-a="wcancel">Cancel</button><span class="hint err" data-werr role="alert"></span></div></div></section>` : ""}
    <div class="panel"><div class="ph"><h3>Webhooks</h3></div>${d.hooks.length ? html`<ul class="rlist">${d.hooks.map((w) => html`<li class="rrow ${w.enabled ? "" : "off"}"><div>${sw(w.enabled, "wtoggle", `${w.name} is ${w.enabled ? "on" : "off"}`, `data-id="${esc(w.id)}"`)}</div>
      <div class="rmain"><b class="rname">${w.name}</b><span class="muted mono">${host(w.url)}</span><span class="chips">${w.events.map((e) => html`<code class="chip">${e}</code>`)}</span></div>
      <div class="rlast">${w.secretSet ? pill("ready", "Signed", "shield") : pill("off", "Not signed")}${d.test[w.id] ? html`<span class="${d.test[w.id].ok ? "ok-t" : "err-t"}" role="status">${d.test[w.id].ok ? "Test worked" : "Test failed"}: ${d.test[w.id].message}</span>` : ""}</div>
      <div class="ract"><button type="button" class="btn sm" data-a="wtest" data-id="${w.id}" aria-label="Send a test message to ${w.name}">Send test</button><button type="button" class="btn sm ghost" data-a="wedit" data-id="${w.id}" aria-label="Edit ${w.name}">Edit</button>
        ${d.confirm === w.id ? html`<button type="button" class="btn sm danger" data-a="wdel" data-id="${w.id}" data-fk="fk-wdel-${w.id}">Delete ${w.name}</button><button type="button" class="btn sm ghost" data-a="keep">Keep</button>` : html`<button type="button" class="btn sm ghost" data-a="waskdel" data-id="${w.id}" data-fk="fk-waskdel-${w.id}" aria-label="Delete ${w.name}">Delete</button>`}</div></li>`)}</ul>`
      : html`<div class="empty">${icon("link", "xl")}<b>No webhooks yet</b><span>Add one to tell another program about timeouts, scores or the stream going live.</span></div>`}</div>
    <div class="panel"><div class="ph"><h3>Recent deliveries</h3><span class="sp"></span><button type="button" class="btn sm ghost" data-a="wrefresh">${icon("refresh", "sm")}Refresh</button></div>
      ${d.deliveries.length ? html`<table class="tbl"><thead><tr><th>Time</th><th>Webhook</th><th>Event</th><th>Result</th><th>Tries</th><th>What happened</th></tr></thead><tbody>${d.deliveries.map((x) => { const [c, t, ic] = DELIV[x.status] ?? ["off", x.status, "info"]; return html`<tr><td class="m">${clock(x.at)}</td><td>${x.name}</td><td class="m">${x.event}</td><td>${pill(c, t, ic)}</td><td class="n">${x.attempts}</td><td class="wrapc">${x.code ? `${x.code}. ` : ""}${x.message}</td></tr>`; })}</tbody></table>`
      : html`<div class="empty sm"><span>Nothing has been sent yet.</span></div>`}</div>
    <details class="panel how"><summary>How a program can check the signature</summary><div class="pb stack"><p>Each message has <code>X-Fieldhouse-Timestamp</code> and <code>X-Fieldhouse-Signature: sha256=...</code>. The receiver computes HMAC-SHA256 of the text <code>timestamp.body</code> (the timestamp, a dot, then the raw body) with your secret and compares. Messages that fail with a network error, 5xx, 408 or 429 are tried again after 1, 5 and 30 seconds.</p></div></details>`;
}
export const webhooks = {
  async load() { const [cat, hooks, deliveries] = await Promise.all([lookups().then((l) => l.catalog), api.get("/webhooks"), api.get("/webhooks/deliveries?n=30")]); return { cat, hooks, deliveries, form: null, confirm: null, test: {} }; },
  render: (ctx, d) => html`<div data-box>${wview(d)}</div>`,
  bind(root, ctx, d) {
    const box = root.querySelector("[data-box]"), paint = (fk) => repaintBox(box, wview(d).s, fk);
    const reload = async () => { [d.hooks, d.deliveries] = await Promise.all([api.get("/webhooks"), api.get("/webhooks/deliveries?n=30")]); };
    const err = (m) => { const e = box.querySelector("[data-werr]"); if (e) e.textContent = m || ""; };
    const form = (f) => { d.form = f; paint("fk-wname"); window.scrollTo(0, 0); };
    box.addEventListener("input", (e) => { const el = e.target, k = el.dataset.w; if (!d.form) return; if (k) d.form[k] = el.type === "checkbox" ? el.checked : el.value; });
    box.addEventListener("change", (e) => { const el = e.target; if (el.dataset.ev && d.form) { const s = new Set(d.form.events); el.checked ? s.add(el.dataset.ev) : s.delete(el.dataset.ev); d.form.events = [...s]; } });
    box.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-a],[data-act]"); if (!b) return; const a = b.dataset.a ?? b.dataset.act, id = b.dataset.id, w = d.hooks.find((x) => x.id === id);
      try {
        if (a === "new") form(BLANK()); else if (a === "example") form({ ...BLANK(), name: "Companion", events: ["game.timeout"] });
        else if (a === "wedit") form({ ...BLANK(), ...w, secret: "", secretSet: w.secretSet });
        else if (a === "wcancel") { d.form = null; paint(); }
        else if (a === "wsave") {
          const f = d.form, other = (f.other ?? f.events.filter((x) => !d.cat.webhookEvents.includes(x)).join(", ")).split(",").map((x) => x.trim()).filter(Boolean);
          const events = [...new Set([...f.events.filter((x) => d.cat.webhookEvents.includes(x)), ...other])];
          const body = { name: f.name.trim(), url: f.url.trim(), events, enabled: f.enabled, ...(f.clearSecret ? { secret: "" } : f.secret ? { secret: f.secret } : {}) };
          err(""); try { f.id ? await api.put(`/webhooks/${f.id}`, body) : await api.post("/webhooks", body); toast("Webhook saved."); d.form = null; await reload(); paint(); } catch (x) { err(x.message); }
        }
        else if (a === "wtoggle") { await api.put(`/webhooks/${id}`, { ...w, enabled: b.getAttribute("aria-checked") !== "true" }); await reload(); paint(); }
        else if (a === "wtest") { d.test[id] = { ok: false, message: "Sending..." }; paint(); d.test[id] = await api.post(`/webhooks/${id}/test`); await reload(); paint(`fk-wdel-${id}`); }
        else if (a === "waskdel") { d.confirm = id; paint(`fk-wdel-${id}`); } else if (a === "keep") { d.confirm = null; paint(); }
        else if (a === "wdel") { await api.del(`/webhooks/${id}`); toast("Webhook deleted."); d.confirm = null; await reload(); paint(); }
        else if (a === "wrefresh") { await reload(); paint(); }
      } catch (x) { fail(x); }
    });
    if (ctx.query?.example) { history.replaceState(null, "", "#/automation/webhooks"); form({ ...BLANK(), name: "Companion", events: ["game.timeout"] }); }
    const poll = setInterval(async () => { if (d.form) return; const before = JSON.stringify(d.deliveries); try { d.deliveries = await api.get("/webhooks/deliveries?n=30"); if (JSON.stringify(d.deliveries) !== before) paint(document.activeElement?.dataset?.fk); } catch {} }, 4000);
    return () => clearInterval(poll);
  },
};

// ================================================================ integrations
const ROLE = { controller: ["Controller", "Can run macros, change the score and clock, switch cameras, play replays, show graphics, fire sponsors and change custom field values. Nothing else."], producer: ["Producer", "Everything a Controller can do, plus the audio mixer and camera pictures. It can start or stop the broadcast only if you allow that in Settings, Remote access."] };
function iview(d) {
  const base = d.remote.urls?.[0] ?? "", on = d.remote.enabled && base, shown = d.fresh;
  const m = d.macros.find((x) => x.id === d.macroId) ?? d.macros[0], mid = m?.id ?? "MACRO_ID";
  const U = on ? base : "http://CONSOLE-ADDRESS:8081";
  const cu = (t, label, c = t) => html`<div class="copyline"><code class="mono">${t}</code><button type="button" class="btn sm" data-a="copy" data-t="${c}" aria-label="Copy ${label}">${icon("link", "sm")}Copy</button></div>`;
  return html`<div class="bar-row"><p class="muted lead">Let a Stream Deck, Bitfocus Companion or your own script press Fieldhouse buttons or read the game. A key works like a password for one program, so give each program its own and remove it when you stop using it.</p></div>
    ${!d.remote.enabled ? html`<div class="banner warn">${icon("alert", "lg")}<span><b>Remote access is off.</b> <span class="muted">Programs on other computers cannot reach Fieldhouse yet. A program on this same computer needs no key. To allow other devices, turn it on in <a href="#/settings/remote">Settings, Remote access</a>.</span></span></div>` : !base ? html`<div class="banner warn">${icon("alert", "lg")}<span><b>No network address found.</b> <span class="muted">Connect this computer to the gym network, then reload this page.</span></span></div>` : ""}
    ${shown ? html`<section class="panel keyshown" role="alert"><div class="ph"><h3>Copy your new key now</h3></div><div class="pb stack"><p class="keynote"><b>This key is shown only once.</b> <span class="muted">Fieldhouse keeps only a scrambled copy, so it cannot be shown again. If you lose it, remove it and make a new one.</span></p>
      <div class="copyline"><code class="mono big" data-keytext>${shown.key}</code><button type="button" class="btn pri" data-a="copykey" data-fk="fk-copykey">${icon("link")}Copy key</button></div>
      <div class="row"><span>Name: <b>${shown.device.name}</b></span><span>Role: <b>${ROLE[shown.device.role][0]}</b></span><span class="sp"></span><button type="button" class="btn" data-a="dismiss">I have copied it</button></div></div></section>` : ""}
    <section class="panel"><div class="ph"><h3>API keys</h3></div><div class="pb stack">
      <div class="g3"><label class="field"><span class="fl">What will use this key? <span class="req">*</span></span><input class="input" data-k="name" data-fk="fk-kname" placeholder="Companion" maxlength="40" autocomplete="off"></label>
        <label class="field"><span class="fl">What it may do</span><select class="select" data-k="role">${Object.entries(ROLE).map(([k, [l]]) => html`<option value="${k}">${l}</option>`)}</select></label>
        <div class="field"><span class="fl">&nbsp;</span><button type="button" class="btn ${shown ? "" : "pri"}" data-a="mint">${icon("plus")}Make a key</button></div></div>
      <ul class="hints">${Object.values(ROLE).map(([l, t]) => html`<li><b>${l}:</b> ${t}</li>`)}</ul><span class="hint err" data-kerr role="alert"></span></div>
      ${d.keys.length ? html`<table class="tbl"><thead><tr><th>Name</th><th>May do</th><th>Made</th><th>Last used</th><th></th></tr></thead><tbody>${d.keys.map((k) => html`<tr><td><b>${k.name}</b></td><td>${ROLE[k.role]?.[0] ?? k.role}</td><td>${ago(k.createdAt)}</td><td>${k.lastSeen ? ago(k.lastSeen) : "Never"}</td><td style="text-align:right">${d.confirm === k.id ? html`<button type="button" class="btn sm danger" data-a="revoke" data-id="${k.id}" data-fk="fk-rv-${k.id}">Remove ${k.name}</button> <button type="button" class="btn sm ghost" data-a="keep">Keep</button>` : html`<button type="button" class="btn sm ghost" data-a="askrevoke" data-id="${k.id}" data-fk="fk-arv-${k.id}" aria-label="Remove key ${k.name}">Remove</button>`}</td></tr>`)}</tbody></table>`
      : html`<div class="empty sm"><span>No keys yet.</span></div>`}</section>
    <section class="panel"><div class="ph"><h3>Companion and Stream Deck, step by step</h3></div><div class="pb stack">
      <ol class="steps"><li>Make a key above (Controller is enough) and copy it.</li>
        <li>In Companion add a <b>Generic HTTP</b> connection (or the "HTTP request" action in your Stream Deck software).</li>
        <li>On a button, add the action <b>POST</b> with this address:${m ? html` <label class="field inl"><span class="fl vh">Macro</span><select class="select" data-k="macro" aria-label="Which macro the address runs">${d.macros.map((x) => html`<option value="${x.id}" ${raw(x.id === mid ? "selected" : "")}>${x.label}</option>`)}</select></label>` : html` (make a macro first)`}
          ${cu(`POST ${U}/api/macros/${mid}/run`, "the address", `${U}/api/macros/${mid}/run`)}</li>
        <li>Add a header named <code>Authorization</code> with the value <code>Bearer </code> followed by your key: ${cu("Authorization: Bearer fhk_YOUR_KEY", "the header", "Bearer fhk_YOUR_KEY")}</li>
        <li>Leave the body empty and press the button. A Stream Deck on this same computer needs no key and can use <code>http://localhost:8080</code> instead.</li></ol>
      <p class="muted">To wake rules that start with "A button, hotkey or outside tool asks for it", send ${cu(`POST ${U}/api/automation/trigger   {"name":"Goal horn"}`, "the trigger request")}</p></div></section>
    <section class="panel"><div class="ph"><h3>Event stream (read only)</h3></div><div class="pb stack"><p class="muted">A program can listen to what happens in the game as it happens (scores, fouls, custom field changes). It can only listen, not change anything. Open it from this computer, or from another one with a key.</p>
      ${cu(`${location.origin}/api/stream?events=game.*,custom.*`, "the event stream address on this computer")}${on ? cu(`${base}/api/stream?events=game.*,custom.*`, "the event stream address on the network") : ""}
      <p class="hint">Change <code>events=</code> to the names you want, separated by commas. Phones paired for scoring cannot use the stream.</p></div></section>`;
}
export const integrations = {
  async load() { const [keys, remote, macros] = await Promise.all([api.get("/remote/keys"), api.get("/remote/status").catch(() => ({ enabled: false, urls: [] })), api.get("/macros")]); return { keys, remote, macros, macroId: macros[0]?.id, fresh: null, confirm: null }; },
  render: (ctx, d) => html`<div data-box>${iview(d)}</div>`,
  bind(root, ctx, d) {
    const box = root.querySelector("[data-box]"), paint = (fk) => repaintBox(box, iview(d).s, fk);
    box.addEventListener("change", (e) => { if (e.target.dataset.k === "macro") { d.macroId = e.target.value; paint("macro"); } });
    box.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-a]"); if (!b) return; const a = b.dataset.a;
      try {
        if (a === "mint") {
          const name = box.querySelector('[data-k="name"]').value.trim(), role = box.querySelector('[data-k="role"]').value, er = box.querySelector("[data-kerr]");
          if (!name) { er.textContent = "Give the key a name so you know what uses it."; box.querySelector('[data-k="name"]').focus(); return; }
          d.fresh = await api.post("/remote/keys", { name, role }); d.keys = await api.get("/remote/keys"); paint("fk-copykey");
        }
        else if (a === "copykey") copyText(d.fresh.key);
        else if (a === "dismiss") { d.fresh = null; paint(); }
        else if (a === "copy") copyText(b.dataset.t);
        else if (a === "askrevoke") { d.confirm = b.dataset.id; paint(`fk-rv-${b.dataset.id}`); } else if (a === "keep") { d.confirm = null; paint(); }
        else if (a === "revoke") { await api.del(`/remote/devices/${b.dataset.id}`); toast("Key removed. Programs using it stop working right away."); d.confirm = null; d.keys = await api.get("/remote/keys"); paint(); }
      } catch (x) { fail(x); }
    });
  },
};
