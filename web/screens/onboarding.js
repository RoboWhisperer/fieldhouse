import { html, icon, api, S, fail, go } from "../app.js";

export const SEEN_KEY = "fieldhouse.seenOnboarding";
export const markSeen = () => { try { localStorage.setItem(SEEN_KEY, "1"); } catch {} };
const SRC = "https://github.com/RoboWhisperer/fieldhouse";
const TITLES = ["Welcome to Fieldhouse", "Detect and test your first camera", "Run a practice broadcast"];
const KIND = { usb: "Camera", ndi: "Network", srt: "Network", screen: "Screen", test: "Test pattern", audio: "Microphone" };

let step = 1;

export default {
  shell: "night", step: 1,
  css: `.ob-wrap{width:960px;max-width:100%;margin:0 auto;display:grid;gap:28px;padding-top:48px}
.ob-labels{display:flex;gap:24px;font-weight:600;color:var(--text-3)}.ob-labels .d{color:var(--ready)}.ob-labels .o{color:var(--text)}
.ob-two{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:16px}
.ob-dev{display:flex;align-items:center;gap:12px;padding:12px 14px;border:0;border-bottom:1px solid var(--line);background:none;color:inherit;font:inherit;text-align:left;width:100%}
button.ob-dev{cursor:pointer}button.ob-dev:hover{background:var(--raised)}
.ob-dev .nm{font-weight:600}.ob-dev .sub{font-size:12px;color:var(--text-2)}
.ob-lic{flex-direction:row;align-items:center;gap:16px;padding:14px 16px}
.ob-steps{display:grid;gap:12px;margin:0;padding:0;list-style:none}.ob-steps li{display:flex;gap:12px;align-items:flex-start}
.ob-foot{display:flex;align-items:center;gap:12px}`,
  async load() {
    const needObs = () => S.state?.engine?.engine === "obs" && !S.state.engine.connected;
    const devices = needObs() ? [] : await api.get("/devices");
    return { devices, tried: false, needObs: needObs(), obsBusy: false };
  },
  render(ctx, d) {
    const cam = (d.sources || S.state?.engine?.sources || []).find((s) => s.slot === 1);
    const video = d.devices.filter((x) => x.kind !== "audio");
    const mic = d.devices.find((x) => x.kind === "audio");
    const body = step === 1 ? html`<div class="panel"><div class="pb col-g">
        <div>Fieldhouse runs your whole broadcast from this laptop: cameras, scoreboard graphics, sponsor breaks, streaming and a recording of every game.</div>
        <ul class="ob-steps">
          <li>${icon("video", "lg")}<div><b>Plug in a camera.</b> <span class="muted">One USB camera or capture card is enough to start.</span></div></li>
          <li>${icon("play", "lg")}<div><b>Try a practice broadcast.</b> <span class="muted">Nothing goes public until you choose a destination and go live.</span></div></li>
          <li>${icon("ball", "lg")}<div><b>Run the real game.</b> <span class="muted">Enter teams, load rosters, check sources, then start.</span></div></li>
        </ul></div></div>`
      : step === 2 && d.needObs ? html`<div class="panel"><div class="pb col-g"><div>Fieldhouse uses OBS Studio (free) to handle video. Press the button and Fieldhouse opens and sets up OBS for you.</div>
        <div><button class="btn pri lg" data-act="obs" ${d.obsBusy ? "disabled" : ""}>${d.obsBusy ? "Starting OBS..." : "Connect OBS"}</button></div><span class="hint">Having trouble? Settings > Engine has more options.</span></div></div>`
      : step === 2 ? html`<div class="ob-two">
        <div class="monitor ${cam ? "pvw" : ""}" style="${cam ? "border-color:var(--ready)" : ""}">
          ${cam ? html`<img id="ob-snap" alt="Camera 1 preview" src="/snap/cam1?t=${Date.now()}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">` : html`<div class="feed"></div><div class="ov" style="position:absolute;inset:0;display:grid;place-items:center;text-align:center;color:var(--text-2);font-weight:600">${video.length ? "Choose a device to test it" : "No camera found yet"}</div>`}
          ${cam && html`<span class="tag">${icon("check", "sm")}WORKING</span><span class="src">${cam.label} · ${cam.detail}</span>`}
        </div>
        <div class="panel">
          <div class="ph"><h3>Detected devices</h3><span class="sp"></span><button class="btn sm ghost" data-act="scan">${icon("refresh", "sm")}Scan again</button></div>
          ${video.length ? video.map((v) => html`<button class="ob-dev" data-dev="${v.id}"><span class="logo-ph" style="background:var(--raised);color:var(--text-2)">${icon("video", "lg")}</span><div style="min-width:0"><div class="nm">${v.label}</div><div class="sub">${KIND[v.kind] || v.kind} · ${v.detail}</div></div><span class="sp"></span>${cam && d.picked === v.id ? html`<span class="pill ready">Camera 1</span>` : html`<span class="pill info noDot">Use as Camera 1</span>`}</button>`) : html`<div class="empty">No video device found. Plug in a USB camera or capture card, then scan again.</div>`}
          ${mic && html`<div class="ob-dev"><span class="logo-ph" style="background:var(--raised);color:var(--text-2)">${icon("mic", "lg")}</span><div style="min-width:0"><div class="nm">${mic.label}</div><div class="sub">${mic.detail}</div></div></div>`}
        </div></div>`
      : html`<div class="panel"><div class="pb col-g">
        <div>A practice broadcast uses a real game page with a demo scoreboard. You can run the clock, add points, fire a sponsor break and check the recording without going public.</div>
        <ul class="ob-steps">
          <li>${icon("check", "lg")}<div><b>It records locally.</b> <span class="muted">Nothing is sent anywhere unless you turn on a destination.</span></div></li>
          <li>${icon("check", "lg")}<div><b>You can undo everything.</b> <span class="muted">Every score and foul has an undo.</span></div></li>
        </ul>
        <div class="row"><button class="btn pri" data-act="demo">${icon("play")}Load demo data and look around</button><button class="btn" data-act="first">Create your first game</button></div>
      </div></div>`;
    return html`<div class="ob-wrap">
      <div class="col-g" style="gap:8px"><div class="ob-labels">${["Welcome", "Detect your camera", "Practice broadcast"].map((l, i) => html`<span class="${i + 1 < step ? "d" : i + 1 === step ? "o" : ""}">${i + 1} ${l}</span>`)}<span class="sp"></span><span class="muted" style="font-weight:500">Step ${step} of 3</span></div>
        <div class="bar"><b style="width:${Math.round((step / 3) * 100)}%"></b></div></div>
      <div class="col-g" style="gap:6px"><h1 class="t">${TITLES[step - 1]}</h1>${step === 2 && html`<div class="muted" style="font-size:14px">Plug in a USB camera or capture card. Fieldhouse finds it and shows what it sees.</div>`}</div>
      ${body}
      <div class="panel ob-lic"><span style="color:var(--ready)">${icon("link", "xl")}</span><div style="min-width:0"><div style="font-weight:650;font-size:15px">Free and open source, for every school</div><div class="muted" style="font-size:12.5px">No account, no trial, no card. The source code is public, so you can see exactly what runs your broadcast, and nothing leaves this laptop unless you turn it on.</div></div><span class="sp"></span><a class="btn" href="${SRC}" target="_blank" rel="noopener" style="text-decoration:none">${icon("book")}View source</a></div>
      <div class="ob-foot">
        ${step > 1 ? html`<button class="btn ghost" data-act="back">${icon("left")}Back</button>` : html`<button class="btn ghost" data-act="skip">Skip setup</button>`}
        <span class="sp"></span>
        ${step === 2 && html`<button class="btn ghost" data-act="pattern">No camera yet? Use a test pattern</button>`}
        ${step < 3 ? html`<button class="btn pri lg" data-act="next">${step === 1 ? "Next: detect your camera" : "Next: practice broadcast"}${icon("right")}</button>` : html`<button class="btn pri lg" data-act="done">Finish and go Home${icon("right")}</button>`}
      </div></div>`;
  },
  bind(root, ctx, d) {
    const use = async (id) => {
      const dev = d.devices.find((x) => x.id === id);
      if (!dev) return fail(new Error("No camera or test pattern is available to use."));
      try { d.sources = await api.post("/slots", { slot: 1, deviceId: id, label: "Camera 1" }); d.picked = id; await ctx.redraw(); } catch (e) { fail(e); }
    };
    // First visit to step 2: use the first video device so the preview shows something immediately.
    if (step === 2 && !d.tried) {
      d.tried = true;
      const first = d.devices.find((x) => x.kind !== "audio");
      if (first && !(d.sources || S.state?.engine?.sources || []).some((s) => s.slot === 1)) use(first.id);
    }
    const snap = root.querySelector("#ob-snap");
    const timer = snap && setInterval(() => { snap.src = `/snap/cam1?t=${Date.now()}`; }, 700);
    root.onclick = async (e) => {
      const dev = e.target.closest("[data-dev]"); if (dev) return use(dev.dataset.dev);
      const a = e.target.closest("[data-act]")?.dataset.act; if (!a) return;
      try {
        if (a === "obs") { d.obsBusy = true; ctx.redraw(); try { await api.post("/engine/obs/connect", { mode: "launch" }); d.devices = await api.get("/devices"); d.needObs = false; d.tried = false; } catch (err) { fail(err); } d.obsBusy = false; ctx.redraw(); }
        else if (a === "next") { step++; ctx.redraw(); }
        else if (a === "back") { step--; ctx.redraw(); }
        else if (a === "scan") { d.devices = await api.get("/devices"); ctx.redraw(); }
        else if (a === "pattern") await use((d.devices.find((x) => x.kind === "test") || d.devices.find((x) => x.kind !== "audio"))?.id);
        else if (a === "skip" || a === "done") { markSeen(); step = 1; go("/"); }
        else if (a === "demo") { await api.post("/demo"); markSeen(); step = 1; go("/"); }
        else if (a === "first") { markSeen(); step = 1; go("/game/new?fresh=1"); }
      } catch (err) { fail(err); }
    };
    return () => clearInterval(timer);
  },
};
