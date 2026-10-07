/* Fieldhouse graphics runtime. Served at /gfx/_runtime.js and added to every custom HTML graphic automatically.
   Docs: docs/graphics-authoring.md. No fonts, timers or network needed: everything runs from messages the overlay page sends. */
(function () {
  var FH = (window.Fieldhouse = window.Fieldhouse || {});
  var vars = {}, fields = {}, h = { update: [], play: [], stop: [], next: [] }, lastData = null, playing = false;
  FH.vars = vars; FH.fields = fields;
  var on = function (k) { return function (fn) { if (typeof fn === "function") h[k].push(fn); return FH; }; };
  FH.onUpdate = on("update"); FH.onPlay = on("play"); FH.onStop = on("stop"); FH.onNext = on("next");
  /** Value of a variable path, or of a field with "@name". */
  FH.get = function (path, fallback) {
    var v = path.charAt(0) === "@" ? fields[path.slice(1)] : vars[path];
    return v === undefined || v === "" ? (fallback === undefined ? "" : fallback) : v;
  };
  var cssSafe = function (s) { return String(s).replace(/[^\w #.,%()\/\-]/g, ""); };
  var template = function (t) { return t.replace(/\{\{\s*([\w.@\-]+)\s*(?:\|([^}]*))?\}\}/g, function (_m, p, fb) { return String(FH.get(p, fb)); }); };
  var BAD_ATTR = /^(on|srcdoc$|formaction$)/i;
  /** Apply data-fh-bind / data-fh-attr / data-fh-style / data-fh-show / data-fh-template inside `root`. Everything is set as text or attribute values, never as markup. */
  FH.apply = function (root) {
    root = root || document;
    root.querySelectorAll("[data-fh-bind]").forEach(function (el) { var t = String(FH.get(el.getAttribute("data-fh-bind"), el.getAttribute("data-fh-fallback"))); if (el.textContent !== t) el.textContent = t; });
    root.querySelectorAll("[data-fh-template]").forEach(function (el) { if (el.__fhT === undefined) el.__fhT = el.textContent; var t = template(el.__fhT); if (el.textContent !== t) el.textContent = t; });
    root.querySelectorAll("[data-fh-attr]").forEach(function (el) {
      el.getAttribute("data-fh-attr").split(";").forEach(function (pair) {
        var i = pair.indexOf(":"); if (i < 1) return;
        var name = pair.slice(0, i).trim(), val = String(FH.get(pair.slice(i + 1).trim()));
        if (BAD_ATTR.test(name) || /^\s*(javascript|data:text\/html)/i.test(val)) return;
        if (el.getAttribute(name) !== val) el.setAttribute(name, val);
      });
    });
    root.querySelectorAll("[data-fh-style]").forEach(function (el) {
      el.getAttribute("data-fh-style").split(";").forEach(function (pair) { var i = pair.indexOf(":"); if (i < 1) return; el.style.setProperty(pair.slice(0, i).trim(), cssSafe(FH.get(pair.slice(i + 1).trim()))); });
    });
    root.querySelectorAll("[data-fh-show]").forEach(function (el) { var v = FH.get(el.getAttribute("data-fh-show")); el.hidden = v === "" || v === "0" || v === "false" || v === 0 || v === false; });
  };
  var fire = function (k, a, b) { h[k].forEach(function (fn) { try { fn(a, b); } catch (e) { console.error(e); } }); };
  var call = function (name, arg) { var f = window[name]; if (typeof f === "function") { try { f(arg); } catch (e) { console.error(e); } } };
  function onMessage(ev) {
    var m = ev.data;
    if (!m || m.fh !== 1 || ev.source !== window.parent) return;
    if (m.op === "state") {
      vars = FH.vars = m.vars || {}; fields = FH.fields = m.fields || {};
      FH.apply(document); fire("update", vars, fields);
      if (m.mode === "caspar" && typeof m.data === "string" && m.data !== lastData) { lastData = m.data; call("update", m.data); }
    } else if (m.op === "play") { playing = true; document.documentElement.classList.add("fh-on"); fire("play"); if (m.mode === "caspar") call("play"); }
    else if (m.op === "stop") { playing = false; document.documentElement.classList.remove("fh-on"); fire("stop"); if (m.mode === "caspar") call("stop"); }
    else if (m.op === "next") { fire("next"); if (m.mode === "caspar") call("next"); }
  }
  /** Used by the overlay page itself (not by graphics): set the values bindings read. */
  FH.set = function (v, f) { vars = FH.vars = v || {}; fields = FH.fields = f || {}; };
  FH.playing = function () { return playing; };
  if (window.parent !== window) { // inside the overlay page's frame
    window.addEventListener("message", onMessage);
    window.addEventListener("error", function (e) { window.parent.postMessage({ fh: 1, op: "error", message: String(e.message).slice(0, 200) }, "*"); });
    var hello = function () { window.parent.postMessage({ fh: 1, op: "ready" }, "*"); };
    if (document.readyState === "complete") hello(); else window.addEventListener("load", hello);
  }
})();
