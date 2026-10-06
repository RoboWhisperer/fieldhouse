// Settings > Remote access: phones and other computers on the gym Wi-Fi (scorekeeper, scorekeeper + marks, producer).
// Server half: src/auth.ts (pairing, device tokens, LAN listener). This screen only calls /api/remote/* and /api/settings.
import { html, icon, api, toast, fail, subscribe } from "../app.js";
import { delegate, all, sw, copyText, panel } from "./settings-ui.js";
import { newCode } from "./settings-lib.js";
import { qrMatrix, qrPath } from "./settings-qr.js";

const ROLES = [["score", "Score"], ["score+marks", "Score + marks"], ["producer", "Producer"]];
const ROLE_NOTE = { score: "Clock, score, fouls, timeouts and period. Nothing else.", "score+marks": "Everything in Score, plus marking moments for the replay list.", producer: "Everything in Score + marks, plus camera pictures, cut and fade, replay, graphics and sponsor breaks." };
const pill = (cls, text) => html`<span class="pill ${cls}">${text}</span>`;
const seen = (d) => { if (d.connected) return "connected now"; const s = Math.max(0, Math.round((Date.now() - d.lastSeen) / 1000)); return s < 90 ? "seen just now" : s < 3600 ? `seen ${Math.round(s / 60)} min ago` : s < 86400 ? `seen ${Math.round(s / 3600)} h ago` : `seen ${Math.round(s / 86400)} days ago`; };
const pairUrl = (u, code) => `${u}?c=${encodeURIComponent(code)}`;

function qrSvg(url) {
  const m = qrMatrix(url);
  if (!m) return null;
  const n = m.length + 8;
  return html`<svg viewBox="-4 -4 ${n} ${n}" width="208" height="208" role="img" aria-label="QR code that opens the phone remote and fills in the pairing code" shape-rendering="crispEdges" style="display:block;background:#fff;border-radius:8px"><path d="${qrPath(m)}" fill="#0B1018"/></svg>`;
}

function view(d) {
  const r = d.settings.remote, st = d.status, url = st.urls[0];
  const qr = url ? qrSvg(pairUrl(url, st.code)) : null;
  return html`
    <div class="banner info">${icon("wifi", "lg")}<span><b>Phones and other computers can connect on the gym Wi-Fi, with no internet and no account.</b> <span class="muted">They open the address below in a browser and nothing is installed. No game data leaves this network: they talk only to this computer.</span></span></div>
    ${st.enabled && html`<div class="banner warn">${icon("shield", "lg")}<span><b>Use this only on a network you trust.</b> <span class="muted">The connection is plain HTTP, so on open Wi-Fi someone nearby could copy a device's access. Use a password-protected network (WPA2 or WPA3). A Producer device can drive the live broadcast.</span></span></div>`}
    ${st.error && html`<div class="banner err" role="alert">${icon("alert", "lg")}<span><b>Phones cannot connect yet.</b> <span class="muted">${st.error}</span></span></div>`}
    ${st.enabled && st.running && !st.urls.length && html`<div class="banner warn">${icon("alert", "lg")}<span><b>No Wi-Fi address found.</b> <span class="muted">Connect this computer to the gym Wi-Fi or a router, then check this page again.</span></span></div>`}
    ${st.note && html`<div class="banner warn">${icon("alert", "lg")}<span>${st.note} <span class="muted">Use the address shown below.</span></span></div>`}
    ${panel("Phones and computers on this network", html`
      <div class="swr"><div><div style="font-weight:650;font-size:14px">Allow phones and computers on this network</div><div class="muted" style="font-size:12.5px">${st.enabled ? (st.running ? `Open on port ${st.port}. Each device must pair first. Devices only get the screens their role allows.` : "Turned on, but not running. See the message above.") : "Off. Nothing on this computer is reachable from other devices."}</div></div>${sw(st.enabled, "enable", "Allow phones and computers on this network")}</div>`)}
    ${st.enabled && html`<div class="g2" style="grid-template-columns:288px minmax(0,1fr)">
      ${panel("Pair a phone or computer", html`<div class="qrb">
        <div>${qr ?? html`<div class="muted" style="width:208px;text-align:center">${url ? "That address is too long for a QR code. Type the address and code on the phone." : "No address to share yet."}</div>`}</div>
        <div style="text-align:center;display:grid;gap:6px"><span class="muted">Scan, or enter the pairing code</span><span class="stcode" data-code>${st.code}</span><span class="row" style="justify-content:center"><button class="btn sm" data-act="copycode">${icon("link", "sm")}Copy code</button><button class="btn sm ghost" data-act="newcode" title="Phones already paired keep working">${icon("refresh", "sm")}New code</button></span></div>
        <div class="field" style="width:100%"><span class="fl">${st.urls.length > 1 ? "Addresses for phones" : "Address for phones"}</span>
          ${st.urls.length ? st.urls.map((u) => html`<div class="row"><span class="mono" style="flex:1;min-width:0;font-size:12.5px;word-break:break-all;text-align:left">${u}</span><button class="btn sm" data-act="copyurl" data-url="${u}" aria-label="Copy ${u}">${icon("link", "sm")}Copy</button></div>`) : html`<span class="hint">None yet</span>`}
          ${st.urls.length > 1 && html`<span class="hint">This computer has several network addresses. The QR code uses the first. Pick the one on the same Wi-Fi as the phone.</span>`}</div></div>`)}
      ${panel("Connected devices", html`
        ${st.pending.map((p) => html`<div class="dev" style="background:var(--action-wash)"><div class="top"><span class="ic">${icon("phone", "lg")}</span><div style="min-width:0;flex:1"><div style="font-weight:650;font-size:15px">${p.name} wants to connect</div><div class="muted" style="font-size:12.5px">From ${p.ip}. Allow only a phone you know.</div></div><button class="btn sm pri" data-act="allow" data-id="${p.id}">Allow</button><button class="btn sm" data-act="deny" data-id="${p.id}">Deny</button></div></div>`)}
        ${st.devices.length ? st.devices.map((v) => html`<div class="dev"><div class="top"><span class="ic">${icon("phone", "lg")}</span><div style="min-width:0;flex:1"><div style="font-weight:650;font-size:15px;overflow:hidden;text-overflow:ellipsis">${v.name}</div><div class="muted" style="font-size:12.5px">${seen(v)}</div></div>${v.connected ? pill("ready", "Connected") : pill("off", "Away")}
            ${d.confirm === v.id ? html`<button class="btn sm danger" data-act="revoke" data-id="${v.id}">Remove ${v.name}</button><button class="btn sm ghost" data-act="keep">Keep</button>` : html`<button class="btn sm ghost" data-act="askrevoke" data-id="${v.id}" aria-label="Disconnect ${v.name}">Disconnect</button>`}</div>
          <div class="row"><span class="muted">Can do</span><div class="seg" role="group" aria-label="Permissions for ${v.name}">${ROLES.map(([k, l]) => html`<button type="button" class="${v.role === k ? "on" : ""}" aria-pressed="${v.role === k}" data-act="role" data-id="${v.id}" data-role="${k}">${l}</button>`)}</div></div>
          <div class="hint">${ROLE_NOTE[v.role]}</div>${v.role === "producer" && html`<div class="hint" style="color:var(--caution)">Producer can drive the live broadcast. Use it only on a trusted network (WPA2 or WPA3 Wi-Fi). On open Wi-Fi another person could copy the device's access.</div>`}</div>`)
        : !st.pending.length && html`<div class="empty">${icon("phone", "xl")}<b>No phones paired yet</b><span>Scan the QR code with a phone on this Wi-Fi, or open the address and enter the code.</span></div>`}
        <div class="row" style="padding:12px 16px;border-top:1px solid var(--line);margin-top:auto"><span class="muted">Permissions apply to one device at a time. Disconnecting a phone takes effect immediately.</span></div>`, st.devices.length ? html`<span class="chip ${st.devices.some((v) => v.connected) ? "ok" : ""}">${icon("check", "sm")}${st.devices.filter((v) => v.connected).length} connected</span>` : "")}
    </div>`}
    ${panel("Remote rules", html`
      <div class="swr"><div><div style="font-weight:650;font-size:14px">Require the pairing code</div><div class="muted" style="font-size:12.5px">${r.requireCode ? html`A device must enter ${r.code} before it can join.` : "Devices do not need a code. You approve each one here before it can join."}</div></div>${sw(r.requireCode, "req", "Require the pairing code")}</div>
      <div class="swr"><div><div style="font-weight:650;font-size:14px">Producer devices can start and stop the broadcast</div><div class="muted" style="font-size:12.5px">${r.producerCanBroadcast ? "A Producer device can go live and end the stream and recording. It must hold the stop button for 1.5 seconds." : "Off. Starting and stopping the broadcast is only possible on this computer."} Turn this on only if you trust everyone on this network.</div></div>${sw(r.producerCanBroadcast, "bcast", "Producer devices can start and stop the broadcast")}</div>
      <div class="swr"><div><div style="font-weight:650;font-size:14px">Lock the remote now</div><div class="muted" style="font-size:12.5px">${st.locked ? "Phones cannot change the game. They see that the console locked it." : "Lock it during a replay or a break so no one changes the score."}</div></div>${sw(st.locked, "lock", "Lock the remote now")}</div>
      <div class="swr"><div><div style="font-weight:650;font-size:14px">Only allow devices on this Wi-Fi network</div><div class="muted" style="font-size:12.5px">Refuses addresses that are not on a private network. Turn off only if your router uses unusual addresses.</div></div>${sw(r.lockedToLan, "lan", "Only allow devices on this Wi-Fi network")}</div>
      <div class="row" style="padding:12px 16px;border-top:1px solid var(--line)">${icon("users")}<span class="muted">If two operators edit the score, the last change wins and both see a notice.</span></div>`)}`;
}

const CSS = `.stg .dev{display:grid;gap:16px;padding:20px 16px;border-bottom:1px solid var(--line)}.stg .dev:last-child{border-bottom:0}.stg .dev .top{display:flex;align-items:center;gap:12px;min-width:0}.stg .dev .ic{width:40px;height:40px;border-radius:8px;background:var(--raised);display:grid;place-items:center;color:var(--text-2);flex:none}`;
const sameStatus = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const remote = {
  async load() {
    const [settings, status] = await Promise.all([api.get("/settings"), api.get("/remote/status")]);
    return { settings, status, confirm: null };
  },
  render: (ctx, data) => html`<div class="cp" data-box>${view(data)}</div>`,
  bind(root, ctx, data) {
    if (!document.getElementById("remote-css")) { const st = document.createElement("style"); st.id = "remote-css"; st.textContent = CSS; document.head.append(st); }
    const paint = () => { const b = root.querySelector("[data-box]"); if (b) b.innerHTML = view(data).s; };
    const refresh = async () => { try { const s = await api.get("/remote/status"); if (!sameStatus(s, data.status)) { data.status = s; paint(); } } catch {} };
    const act = async (fn) => { try { await fn(); } catch (e) { fail(e); } await refresh(); data.settings = await api.get("/settings").catch(() => data.settings); paint(); };
    const put = (remote) => act(() => api.put("/settings", { remote }));
    const a = delegate(root, "click", "act", {
      enable: () => put({ enabled: !data.status.enabled }),
      req: () => put({ requireCode: !data.settings.remote.requireCode }),
      lan: () => put({ lockedToLan: !data.settings.remote.lockedToLan }),
      bcast: () => put({ producerCanBroadcast: !data.settings.remote.producerCanBroadcast }),
      lock: () => act(() => api.post("/remote/lock", { locked: !data.status.locked })),
      newcode: () => act(async () => { await api.post("/remote/code/rotate"); toast("New pairing code. Phones already paired keep working."); }),
      copycode: () => copyText(data.status.code), copyurl: (el) => copyText(el.dataset.url),
      allow: (el) => act(() => api.post(`/remote/pending/${el.dataset.id}`, { allow: true })),
      deny: (el) => act(() => api.post(`/remote/pending/${el.dataset.id}`, { allow: false })),
      role: (el) => act(() => api.put(`/remote/devices/${el.dataset.id}`, { role: el.dataset.role })),
      askrevoke: (el) => { data.confirm = el.dataset.id; paint(); },
      keep: () => { data.confirm = null; paint(); },
      revoke: (el) => { data.confirm = null; return act(async () => { await api.del(`/remote/devices/${el.dataset.id}`); toast("Phone disconnected."); }); },
    });
    // devices connect, ask to join and drop out on their own: follow the live state, plus a slow poll for "last seen"
    let sig = JSON.stringify(ctx.S?.state?.remote ?? null);
    const off = subscribe((s) => { const n = JSON.stringify(s.remote ?? null); if (n !== sig) { sig = n; refresh(); } });
    const poll = setInterval(refresh, 5000);
    return all(a, off, () => clearInterval(poll));
  },
};
