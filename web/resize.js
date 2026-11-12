// Resizable panels. Every .panel in the app shell gets a grip in its bottom-right corner.
// Sizes are kept per view (the part of the hash before "?") and per panel title, so a redraw
// restores them. Double-click or Home clears a panel's size.

const STORE = "fieldhouse.panelSizes.v1";
const MIN_W = 220, MIN_H = 120;
const STEP = 16, BIG_STEP = 64;

const read = () => {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
};
const write = (all) => {
  try { localStorage.setItem(STORE, JSON.stringify(all)); } catch { /* storage may be unavailable */ }
};
export const clampSize = (v, min, max) => Math.min(Math.max(Math.round(v), min), max);
export const sizeKey = (scope, name, occurrence) => `${scope}::${name}::${occurrence}`;

const scope = () => (location.hash.slice(1) || "/").split("?")[0] || "/";

/** Clamp a panel's width to the right edge of its column, never below a usable minimum. */
export const clampPanelWidth = (width, left, right) => clampSize(width, MIN_W, Math.max(MIN_W, Math.round(right - left)));
/** Clamp a panel's height to the bottom of its column or the panel below. Use all the room when it is short; never overlap. */
export const clampPanelHeight = (height, top, bottom) => {
  const room = Math.max(0, Math.round(bottom - top));
  return Math.min(Math.max(Math.round(height), Math.min(MIN_H, room)), room);
};

// A display:contents wrapper has no box of its own, so use the nearest ancestor that does.
function boxedParent(p) {
  let parent = p.parentElement;
  while (parent && parent !== document.body && parent.getClientRects().length === 0) parent = parent.parentElement;
  return parent;
}

// The right edge a panel may reach: its column's content edge, or the nearest sibling in the same row.
function rightLimit(p) {
  const parent = boxedParent(p);
  const r = p.getBoundingClientRect();
  if (!parent) return window.innerWidth - 16;
  const pr = parent.getBoundingClientRect();
  const cs = getComputedStyle(parent);
  let right = pr.left + parent.clientLeft + parent.clientWidth - (parseFloat(cs.paddingRight) || 0);
  for (const sib of p.parentElement?.children ?? []) {
    if (sib === p || !(sib instanceof HTMLElement)) continue;
    const s = sib.getBoundingClientRect();
    if (!s.width || !s.height || s.top >= r.bottom || s.bottom <= r.top) continue; // another row
    if (s.left > r.left + 1) right = Math.min(right, s.left);
  }
  return right;
}

// The bottom edge a panel may reach: its column's content edge, or the nearest sibling below in the same column.
function bottomLimit(p) {
  const parent = boxedParent(p);
  const r = p.getBoundingClientRect();
  let bottom = window.innerHeight - 16;
  if (!parent) return bottom;
  const cs = getComputedStyle(parent);
  if (cs.overflowY !== "visible") { // a visible parent grows with its content; a scrolling one ends at its scroll extent
    const pr = parent.getBoundingClientRect();
    const edge = cs.overflowY === "auto" || cs.overflowY === "scroll" ? parent.scrollHeight : parent.clientHeight;
    bottom = Math.min(bottom, pr.top + parent.clientTop + edge - (parseFloat(cs.paddingBottom) || 0));
  }
  for (const sib of p.parentElement?.children ?? []) {
    if (sib === p || !(sib instanceof HTMLElement)) continue;
    const s = sib.getBoundingClientRect();
    if (!s.width || !s.height || s.top <= r.top + 1) continue; // not below
    if (s.right <= r.left + 1 || s.left >= r.right - 1) continue; // another column
    bottom = Math.min(bottom, s.top);
  }
  return bottom;
}

function panelName(p) {
  return (p.dataset.panel || p.id || p.querySelector("h2, h3")?.textContent || "panel").trim().slice(0, 60) || "panel";
}

// Applying a width can move the sibling that bounds it, so fit, lay out, and fit again.
function fitWidth(p, desired) {
  const first = clampPanelWidth(desired, p.getBoundingClientRect().left, rightLimit(p));
  p.style.width = `${first}px`;
  const r = p.getBoundingClientRect();
  return clampPanelWidth(r.width, r.left, rightLimit(p));
}

function fitHeight(p, desired) {
  const first = clampPanelHeight(desired, p.getBoundingClientRect().top, bottomLimit(p));
  p.style.height = `${first}px`;
  const r = p.getBoundingClientRect();
  return clampPanelHeight(r.height, r.top, bottomLimit(p));
}

function apply(p, key, saved) {
  p.dataset.fhResize = key;
  if (saved) {
    p.classList.add("fh-sized");
    // Height affects a scrolling column's width (scrollbar), and width affects which sibling is below, so fit both and settle.
    const r = p.getBoundingClientRect();
    p.style.height = `${clampPanelHeight(saved.h, r.top, bottomLimit(p))}px`;
    const w = fitWidth(p, saved.w);
    p.style.width = `${w}px`;
    const h = fitHeight(p, saved.h);
    p.style.height = `${h}px`;
    const w2 = fitWidth(p, w);
    p.style.width = `${w2}px`;
    if (w2 !== saved.w || h !== saved.h) {
      const all = read();
      if (all[key]) { all[key] = { w: w2, h }; write(all); }
    }
  }
}

function setSize(p, key, w, h, save) {
  const width = Math.round(w), height = Math.round(h);
  p.classList.add("fh-sized");
  p.style.width = `${width}px`;
  p.style.height = `${height}px`;
  if (!save) return;
  const all = read();
  all[key] = { w: width, h: height };
  write(all);
}

function reset(p, key) {
  p.classList.remove("fh-sized");
  p.style.removeProperty("width");
  p.style.removeProperty("height");
  const all = read();
  delete all[key];
  write(all);
}

function wire(p, key, label) {
  const grip = document.createElement("span");
  grip.className = "panel-resize";
  grip.setAttribute("role", "button");
  grip.setAttribute("tabindex", "0");
  grip.setAttribute("aria-label", `Resize ${label} panel`);
  grip.title = "Drag to resize. Double-click or press Home to reset.";
  p.append(grip);

  let drag = null;
  const stop = (e) => {
    if (!drag) return;
    drag = null;
    document.body.classList.remove("fh-resizing");
    if (grip.hasPointerCapture?.(e.pointerId)) grip.releasePointerCapture(e.pointerId);
  };

  grip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const r = p.getBoundingClientRect();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, w: r.width, h: r.height, left: r.left, right: rightLimit(p), top: r.top, bottom: bottomLimit(p) };
    try { grip.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    document.body.classList.add("fh-resizing");
  });
  grip.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const width = clampPanelWidth(drag.w + e.clientX - drag.x, drag.left, drag.right);
    p.style.width = `${width}px`; // widening can bring a panel below into the same column, so re-measure the height limit
    const height = clampPanelHeight(drag.h + e.clientY - drag.y, drag.top, Math.min(drag.bottom, bottomLimit(p)));
    setSize(p, key, width, height, false);
  });
  grip.addEventListener("pointerup", (e) => {
    if (!drag) return;
    const r = p.getBoundingClientRect();
    setSize(p, key, r.width, r.height, true);
    stop(e);
  });
  grip.addEventListener("pointercancel", stop);
  grip.addEventListener("lostpointercapture", stop);

  grip.addEventListener("dblclick", (e) => { e.preventDefault(); reset(p, key); });
  grip.addEventListener("keydown", (e) => {
    if (e.key === "Home") { e.preventDefault(); reset(p, key); return; }
    const step = e.shiftKey ? BIG_STEP : STEP;
    const r = p.getBoundingClientRect();
    let w = r.width, h = r.height;
    if (e.key === "ArrowRight") w += step;
    else if (e.key === "ArrowLeft") w -= step;
    else if (e.key === "ArrowDown") h += step;
    else if (e.key === "ArrowUp") h -= step;
    else return;
    e.preventDefault();
    const width = clampPanelWidth(w, r.left, rightLimit(p));
    p.style.width = `${width}px`;
    setSize(p, key, width, clampPanelHeight(h, r.top, bottomLimit(p)), true);
  });
}

/** Add a grip to every panel that does not have one yet, and re-apply saved sizes. */
export function enhancePanels(root = document) {
  if (!root?.querySelectorAll) return;
  const saved = read(), baseScope = scope(), seen = new Map();
  root.querySelectorAll(".panel").forEach((p) => {
    if (!(p instanceof HTMLElement)) return;
    const name = panelName(p);
    const occurrence = seen.get(name) ?? 0;
    seen.set(name, occurrence + 1);
    const key = sizeKey(baseScope, name, occurrence);
    if (p.dataset.fhResize) return;
    apply(p, key, saved[key]);
    wire(p, key, name);
  });
}

let observer = null, frame = 0;
/** Watch for panels added after the initial draw (dialogs, wizard steps, tab panels). */
export function installPanelResizing() {
  if (observer || !document.body) return;
  observer = new MutationObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => enhancePanels(document));
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("resize", () => {
    document.querySelectorAll(".panel.fh-sized[data-fh-resize]").forEach((p) => {
      const key = p.dataset.fhResize;
      const r = p.getBoundingClientRect();
      const h = fitHeight(p, r.height);
      const w = fitWidth(p, r.width);
      if (Math.round(r.width) !== w || Math.round(r.height) !== h) setSize(p, key, w, h, true);
    });
  });
}
