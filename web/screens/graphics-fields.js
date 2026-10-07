// The "data fields" editor shared by the graphic editor, the import wizard and the remote-graphic flow.
// A field is a named value a graphic uses. Where its value comes from is its binding: a live variable, fixed text, or typed in when shown.
import { html, raw, esc, icon } from "../app.js";
import { VAR_LABEL, varGroups } from "./graphics-lib.js";
import { text, sel } from "./graphics-ui.js";

export const TYPES = [["text", "Text"], ["number", "Number"], ["color", "Color"], ["image", "Image address"], ["bool", "Yes or no"]];
export const BINDINGS = [["var", "A live value from the game"], ["const", "Fixed text (can include live values)"], ["manual", "Typed in when I show it"]];
let n = 0;

/** A <select> of every variable, grouped, with the sample value in each label. */
export function varSelect(path, value, vars, label = "Which value") {
  const i = "gv" + ++n, groups = varGroups(vars), known = new Set(groups.flatMap(([, ks]) => ks));
  const lab = (k) => `${VAR_LABEL[k] || k}${vars?.[k] !== undefined && String(vars[k]) !== "" ? ` (for example ${String(vars[k]).slice(0, 24)})` : ""}`;
  return html`<div class="field"><label for="${i}">${label}</label><select class="input" id="${i}" data-p="${path}">
    ${!value ? html`<option value="" selected>Choose a value...</option>` : ""}
    ${value && !known.has(value) ? html`<option value="${value}" selected>${value} (not in the sample game)</option>` : ""}
    ${groups.map(([g, ks]) => html`<optgroup label="${g}">${ks.map((k) => html`<option value="${k}" ${k === value ? "selected" : ""}>${lab(k)}</option>`)}</optgroup>`)}
  </select></div>`;
}

function defaultControl(path, f) {
  if (f.type === "bool") return sel(path, f.default === "true" ? "true" : "false", "Starts as", [["false", "No"], ["true", "Yes"]]);
  if (f.type === "color") { const hex = /^#[0-9a-f]{6}$/i.test(f.default); return html`<div class="field"><span class="fl">Starts as</span><div class="row"><input type="color" value="${hex ? f.default : "#000000"}" data-p="${path}" aria-label="Pick a color"><input class="input mono" value="${f.default}" data-p="${path}" data-hex aria-label="Color code" placeholder="#1F7A8C"></div></div>`; }
  return text(path, f.default, "Starts as", { type: f.type === "number" ? "number" : "text", hint: undefined });
}

/** opts: prefix (path of the array in the draft), vars, locked (built-in: names and types fixed, no add or remove). */
export function fieldsEditor(fields, { prefix = "fields", vars = {}, locked = false } = {}) {
  if (!fields.length && locked) return html`<p class="muted">This graphic has no data fields. Everything it shows comes from the game.</p>`;
  return html`<div class="col-g">
    ${fields.length ? fields.map((f, i) => { const p = `${prefix}.${i}`, b = f.binding || { kind: "manual", value: "" }; return html`<div class="gx-fld" data-fld="${i}">
      <div class="row"><b>${f.label || f.name || "Field"}</b><span class="sp"></span>${locked ? "" : html`<button type="button" class="btn sm ghost" data-rmf="${i}" aria-label="Remove field ${f.label || f.name}">${icon("x", "sm")}Remove</button>`}</div>
      <div class="gx-g3">${text(`${p}.label`, f.label, "Label", {})}
        ${text(`${p}.name`, f.name, "Name", { mono: true, ro: locked, hint: locked ? "Fixed for built-in graphics." : "What the template looks for." })}
        ${sel(`${p}.type`, f.type, "Type", TYPES, { re: "" })}</div>
      <div class="gx-g2">${defaultControl(`${p}.default`, f)}
        ${sel(`${p}.binding.kind`, b.kind, "Where the value comes from", BINDINGS, { re: "" })}</div>
      ${b.kind === "var" ? varSelect(`${p}.binding.value`, b.value, vars) : b.kind === "const" ? text(`${p}.binding.value`, b.value, "Fixed text", { hint: raw("Type <code>{{home.name}}</code> to put a live value inside the text, or <code>{{home.name|Home}}</code> to use &quot;Home&quot; when it is empty.") }) : html`<p class="hint">Not tied to the game. It shows the starting value until you type another when showing it.</p>`}
    </div>`; }) : html`<p class="muted">No fields yet. Fields are the values a graphic shows, such as a name or a score.</p>`}
    ${locked ? "" : html`<div><button type="button" class="btn sm" data-addf>${icon("plus", "sm")}Add a field</button></div>`}
  </div>`;
}

export const newField = (fields) => { let k = fields.length + 1; while (fields.some((f) => f.name === "field" + k)) k++; return { name: "field" + k, label: "Field " + k, type: "text", default: "", binding: { kind: "manual", value: "" } }; };

/** Handle Add/Remove buttons of a fieldsEditor inside `root`; `get()` returns the draft array, `redraw()` repaints. Returns a cleanup. */
export function bindFieldButtons(root, get, redraw) {
  const h = (e) => {
    if (e.target.closest("[data-addf]")) { get().push(newField(get())); redraw(); }
    const r = e.target.closest("[data-rmf]"); if (r) { get().splice(+r.dataset.rmf, 1); redraw(); }
  };
  root.addEventListener("click", h);
  return () => root.removeEventListener("click", h);
}
export { esc };
