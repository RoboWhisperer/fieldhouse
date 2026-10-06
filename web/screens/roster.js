import { html, icon, api, S, fail, go, toast } from "../app.js";

const dupNums = (list) => { const c = {}; list.forEach((p) => { if (p.number) c[p.number] = (c[p.number] || 0) + 1; }); return new Set(Object.keys(c).filter((k) => c[k] > 1)); };

export default {
  shell: "night", step: 1,
  css: `.ro{display:grid;grid-template-columns:420px minmax(0,1fr);gap:16px;height:100%;grid-template-rows:auto minmax(0,1fr) auto}.ro .full{grid-column:1/-1}
.ro .tabs button{padding:10px 14px;background:none;border:0;border-bottom:2px solid transparent;margin-bottom:-1px;color:var(--text-2);font:inherit;font-weight:600;cursor:pointer}.ro .tabs button.on{color:var(--text);border-color:var(--action)}
.ro .map{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.ro .map .select{height:32px;padding:0 6px}
.ro .file{display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--line-strong);border-radius:8px;background:var(--inset)}
.ro .file.drop{border-style:dashed;justify-content:center;color:var(--text-2);cursor:pointer}.ro .file.over{border-color:var(--action);background:var(--action-wash)}
.ro .tbl.dn td{height:40px}.ro .tbl tr.dup td{background:var(--caution-wash)}.ro .tbl tr.hit td{outline:1px solid var(--action)}
.ro .cell{height:28px;border-radius:6px;border:1px solid var(--line);background:var(--inset);color:var(--text);font:inherit;padding:0 8px;width:100%;min-width:0}
.ro .cell.num{width:56px;text-align:center;font:600 13px var(--mono)}.ro tr.dup .cell.num{border-color:var(--caution);color:var(--caution)}
.ro button.check{background:none;color:#fff;cursor:pointer;padding:0}.ro .foot{display:flex;align-items:center;gap:12px}
.ro select.cell{height:32px}.ro textarea.cell{height:110px;padding:8px;font-family:var(--mono)}`,
  async load(ctx) {
    const id = S.state?.gameId;
    if (!id) return { game: null };
    const game = await api.get(`/games/${id}`);
    return { game, tab: "home", R: { home: game.home.roster.map((p) => ({ ...p })), away: game.away.roster.map((p) => ({ ...p })) }, P: {}, paste: false, flag: 0 };
  },
  render(ctx, d) {
    if (!d.game) return html`<div class="empty"><h2 class="t">No game selected</h2><div>Set up a game first, then add its rosters.</div><button class="btn pri" data-go="/game/new">Set up a game</button></div>`;
    const side = d.tab, team = d.game[side], list = d.R[side], P = d.P[side], dups = dupNums(list);
    const sel = (key) => html`<div class="col-g" style="gap:4px"><span class="hint">${{ number: "Number", name: "Name", position: "Position" }[key]}</span><select class="select" data-map="${key}" aria-label="${key} column">${key === "position" && html`<option value="">(none)</option>`}${[...new Set([...P.parse.columns, P.parse.mapping[key]])].filter((c) => c || key === "position").map((c) => html`<option ${c === P.parse.mapping[key] ? "selected" : ""}>${c}</option>`)}</select></div>`;
    return html`<div class="ro">
      <div class="tabs full">${["home", "away"].map((s) => html`<button class="${s === side ? "on" : ""}" data-tab="${s}"><i class="swatch" style="background:${d.game[s].color};margin-right:8px"></i>${s === "home" ? "Home" : "Away"} · ${d.game[s].name} (${d.R[s].length})</button>`)}</div>
      <section class="panel"><div class="ph"><h3>Import from CSV</h3><span class="sp"></span><button class="btn sm ghost" data-act="paste">Paste from spreadsheet</button></div>
        <div class="pb col-g" style="gap:16px">
          ${d.paste && html`<div class="col-g" style="gap:8px"><textarea class="cell" id="pastebox" placeholder="Paste rows here: number, name, position" aria-label="Pasted roster"></textarea><div class="row"><button class="btn pri sm" data-act="parse-paste">Read roster</button><button class="btn ghost sm" data-act="paste">Cancel</button></div></div>`}
          ${P ? html`<div class="file">${icon("check", "lg")}<div style="min-width:0"><div style="font-weight:600">${P.name}</div><div class="faint" style="font-size:12px">${P.parse.players.length} players found${P.parse.columns.length ? " · columns detected" : ""}</div></div><span class="sp"></span><button class="btn sm ghost" data-act="file">Replace</button></div>
            <div class="field"><span class="fl">Match columns</span><div class="map">${sel("number")}${sel("name")}${sel("position")}</div></div>
            ${P.parse.warnings.filter((w) => !/more than once/.test(w.message)).length > 0 && html`<div class="banner warn" style="align-items:flex-start">${icon("alert")}<div>${P.parse.warnings.filter((w) => !/more than once/.test(w.message)).slice(0, 5).map((w) => html`<div>Row ${w.row}: ${w.message}</div>`)}</div></div>`}
            <div><div class="muted" style="font-weight:600;margin-bottom:6px">Preview of first rows</div><table class="tbl dn"><thead><tr><th>Number</th><th>Name</th><th>Position</th></tr></thead><tbody>${P.parse.players.slice(0, 5).map((p) => html`<tr><td class="m">${p.number}</td><td>${p.name}</td><td>${p.position}</td></tr>`)}</tbody></table></div>`
            : html`<div class="muted">Export your roster from a spreadsheet as CSV, or paste the rows. Columns are matched for you.</div>`}
          <div class="file drop" id="dz" tabindex="0" role="button" data-act="file">${icon("up2")}${P ? "Drop a different CSV here to replace" : "Drop a CSV here or click to choose a file"}</div>
          <input type="file" id="fi" accept=".csv,.tsv,.txt,text/csv,text/plain" class="hidden">
          <button class="btn" style="align-self:flex-start" data-act="add">${icon("plus")}Add player manually</button>
        </div></section>
      <section class="panel"><div class="ph"><h3>Roster</h3><span class="sp"></span><span class="muted" id="starters">${list.filter((p) => p.starter).length} starters selected</span></div>
        <div id="dupbanner"></div>
        <div class="scroll" style="flex:1;padding:4px 0">${list.length ? html`<table class="tbl dn"><thead><tr><th>#</th><th>Name</th><th>Position</th><th>Starter</th><th></th></tr></thead><tbody>
          ${list.map((p, i) => html`<tr data-i="${i}" class="${dups.has(p.number) ? "dup" : ""}"><td><input class="cell num" data-k="number" value="${p.number}" maxlength="3" inputmode="numeric" aria-label="Jersey number"></td><td><input class="cell" data-k="name" value="${p.name}" maxlength="60" aria-label="Player name"></td><td><input class="cell" data-k="position" value="${p.position}" maxlength="12" aria-label="Position"></td>
            <td><button class="check ${p.starter ? "on" : ""}" data-star="${i}" role="checkbox" aria-checked="${p.starter}" aria-label="Starter">${p.starter && icon("check")}</button></td><td class="n"><button class="btn sm ghost" data-del="${i}" aria-label="Remove player">${icon("x", "sm")}</button></td></tr>`)}</tbody></table>`
          : html`<div class="empty">No players yet. Import a CSV or add players by hand.</div>`}</div></section>
      <div class="foot full"><button class="btn ghost" data-go="/game/new">${icon("left")}Back</button><span class="sp"></span><button class="btn ghost" data-act="numbers">Use numbers only</button><button class="btn pri lg" data-act="save">Continue to Sources${icon("right")}</button></div></div>`;
  },
  bind(root, ctx, d) {
    if (!d.game) { root.onclick = (e) => e.target.closest("[data-go]") && go(e.target.closest("[data-go]").dataset.go); return; }
    const list = () => d.R[d.tab];
    const paint = () => {
      const dups = dupNums(list());
      root.querySelectorAll("tbody tr[data-i]").forEach((tr) => tr.classList.toggle("dup", dups.has(list()[tr.dataset.i]?.number)));
      root.querySelector("#starters").textContent = `${list().filter((p) => p.starter).length} starters selected`;
      const n = [...dups][0];
      root.querySelector("#dupbanner").innerHTML = n ? `<div class="banner warn" style="margin:12px 14px 0"><svg class="i"><use href="#i-alert"/></svg><span><b>Number ${n.replace(/[<>&"]/g, "")} is used ${list().filter((p) => p.number === n).length} times.</b> Change one of them before going live.</span><span class="sp"></span><button class="btn sm" data-act="jump">Jump to row</button></div>` : "";
      root.querySelectorAll("[data-tab]").forEach((b) => { const s = b.dataset.tab; b.lastChild.textContent = `${s === "home" ? "Home" : "Away"} · ${d.game[s].name} (${d.R[s].length})`; });
    };
    paint();
    const parse = async (text, name, mapping) => {
      try {
        const parse = await api.post("/roster/parse", { text, mapping });
        if (parse.players.length && !parse.players.some((p) => p.starter)) parse.players.slice(0, 5).forEach((p) => { p.starter = true; }); // sensible default; the Starter column changes it
        d.P[d.tab] = { text, name, parse }; d.R[d.tab] = parse.players; d.paste = false; ctx.redraw();
      } catch (e) { fail(e); }
    };
    const readFile = (f) => { if (!f) return; const r = new FileReader(); r.onload = () => parse(String(r.result), f.name); r.onerror = () => fail(new Error("Could not read that file.")); r.readAsText(f); };
    const fi = root.querySelector("#fi"); fi.onchange = () => readFile(fi.files[0]);
    const dz = root.querySelector("#dz");
    dz.ondragover = (e) => { e.preventDefault(); dz.classList.add("over"); }; dz.ondragleave = () => dz.classList.remove("over");
    dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove("over"); readFile(e.dataTransfer.files[0]); };
    dz.onkeydown = (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), fi.click());
    root.oninput = (e) => { const tr = e.target.closest("tr[data-i]"); if (!tr || !e.target.dataset.k) return; const k = e.target.dataset.k; list()[tr.dataset.i][k] = k === "number" ? e.target.value.replace(/\D/g, "") : e.target.value; if (k === "number") e.target.value = list()[tr.dataset.i].number; paint(); };
    root.onchange = (e) => { if (e.target.dataset.map) { const P = d.P[d.tab], m = { ...P.parse.mapping, [e.target.dataset.map]: e.target.value }; parse(P.text, P.name, m); } };
    const save = async () => {
      const keep = (l) => l.filter((p) => p.number || p.name.trim());
      const g = { ...d.game, home: { ...d.game.home, roster: keep(d.R.home) }, away: { ...d.game.away, roster: keep(d.R.away) } };
      d.game = await api.put(`/games/${g.id}`, g);
    };
    root.onclick = async (e) => {
      const t = e.target.closest("[data-go],[data-tab],[data-star],[data-del],[data-act]"); if (!t) return;
      const a = t.dataset.act;
      try {
        if (t.dataset.go) go(t.dataset.go);
        else if (t.dataset.tab) { d.tab = t.dataset.tab; ctx.redraw(); }
        else if (t.dataset.star) { const p = list()[t.dataset.star]; p.starter = !p.starter; t.classList.toggle("on", p.starter); t.setAttribute("aria-checked", p.starter); t.innerHTML = p.starter ? '<svg class="i"><use href="#i-check"/></svg>' : ""; paint(); }
        else if (t.dataset.del) { list().splice(+t.dataset.del, 1); ctx.redraw(); }
        else if (a === "add") { list().push({ number: "", name: "", position: "", starter: false }); await ctx.redraw(); document.querySelector("#screen tbody tr:last-child input")?.focus(); }
        else if (a === "paste") { d.paste = !d.paste; ctx.redraw(); }
        else if (a === "parse-paste") { const v = root.querySelector("#pastebox").value; v.trim() ? parse(v, "Pasted rows") : toast("Paste some rows first."); }
        else if (a === "file") fi.click();
        else if (a === "jump") { const n = [...dupNums(list())][0]; const tr = [...root.querySelectorAll("tbody tr[data-i]")].find((r) => list()[r.dataset.i].number === n); tr?.scrollIntoView({ block: "center" }); tr?.querySelector("input").focus(); }
        else if (a === "numbers") { await save(); go("/sources"); }
        else if (a === "save") { await save(); go("/sources"); }
      } catch (err) { fail(err); }
    };
  },
};
