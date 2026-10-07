// A live preview of graphics: the real overlay page (/overlay, the same renderer OBS loads) scaled into a 16:9 box.
// The page normally shows what is on air. Here we replace its feed: after it loads we hand it our own state (sample variables, the
// graphics we want to see) and ignore the server's pushes. No new routes: this only uses /overlay and /gfx/<id>/ (loopback, same origin).
import { renderItem } from "./graphics-lib.js";

export const PREVIEW_CSS = `
.gx-stage{position:relative;aspect-ratio:16/9;overflow:hidden;border-radius:8px;border:1px solid var(--line);background:#0b0f19 url(/img/feed-center.svg) center/cover}
.gx-stage::before{content:"";position:absolute;inset:0;background:rgba(5,8,14,.35)}
.gx-frame{color-scheme:light;position:absolute;left:0;top:0;width:1920px;height:1080px;border:0;background:transparent;transform-origin:0 0}
.gx-stage .gx-ph{position:absolute;inset:0;display:grid;place-items:center;text-align:center;padding:10px;color:var(--text-2);font-size:12px;gap:4px;align-content:center}
`;

/** docs: graphic documents to draw (each is "on air" in the preview). vars: variable map. */
export function mountPreview(host, { docs = [], vars = {}, external = false, onDraw } = {}) {
  const s = { docs, vars, external, nonce: 0, ctl: {} };
  const f = document.createElement("iframe");
  f.src = "/overlay"; f.title = "Preview"; f.tabIndex = -1; f.setAttribute("aria-hidden", "true"); f.className = "gx-frame";
  host.append(f);
  let orig = null, win = null, dead = false, raf = 0;
  const scale = () => { const k = host.clientWidth / 1920; if (k > 0) f.style.transform = `scale(${k})`; };
  const ro = new ResizeObserver(scale); ro.observe(host); scale();
  const c = (id) => (s.ctl[id] ||= { phase: "on", seq: 1, nextSeq: 0, over: {} });
  function draw() {
    if (!orig || dead) return;
    const items = s.docs.filter((d) => s.external || (d.kind !== "url" && d.kind !== "remote")).map((d) => renderItem(d, s.vars, { ...c(d.id), nonce: s.nonce })).sort((a, b) => a.z - b.z);
    try { orig({ graphics: { items, vars: s.vars, engineLayers: false, scorebug: false, lower: null, slate: null, sponsor: null }, game: null }); } catch {}
    onDraw?.();
  }
  const later = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); };
  f.addEventListener("load", () => { win = f.contentWindow; orig = win.show; win.show = () => {}; draw(); });
  const first = () => s.docs[0]?.id;
  return {
    /** Replace what is drawn (after an edit). */
    set(docs2, vars2) { s.docs = docs2; if (vars2) s.vars = vars2; later(); },
    /** Edit-time test commands (they act on the preview only, never on the stream). */
    show(over = {}, id = first()) { const x = c(id); x.over = over; x.phase = "on"; x.seq++; later(); },
    update(over, id = first()) { c(id).over = over; later(); },
    next(id = first()) { c(id).nextSeq++; later(); },
    hide(id = first()) { c(id).phase = "off"; later(); },
    phase: (id = first()) => c(id).phase,
    /** Reload the page of an HTML graphic (after its files changed). */
    reload() { s.nonce++; later(); },
    /** Where the first graphic sits in the 1920x1080 canvas (for the drag handle), or null. */
    rect() {
      try { const p = win?.document.querySelector(".pos"); if (!p) return null; const r = p.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; } catch { return null; }
    },
    setExternal(v) { s.external = v; later(); },
    scale: () => host.clientWidth / 1920,
    destroy() { dead = true; ro.disconnect(); cancelAnimationFrame(raf); f.remove(); },
  };
}

/** Mount previews lazily: a card's preview starts when it scrolls into view. Returns a cleanup. */
export function lazyPreviews(root, make) {
  const live = [];
  const io = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting && !e.target.dataset.on) { e.target.dataset.on = "1"; const p = make(e.target); if (p) live.push(p); io.unobserve(e.target); }
  }, { rootMargin: "200px" });
  root.querySelectorAll("[data-thumb]").forEach((el) => io.observe(el));
  return { stop() { io.disconnect(); live.forEach((p) => p.destroy()); }, live };
}
