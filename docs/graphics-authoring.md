# Graphics: templates, imports and connectors

Fieldhouse draws its own graphics (score bug, lower third and more) and can also show graphics made elsewhere. This guide is for people who build or bring their own. Everything works without an account or internet, except what the other service itself needs.

There are five kinds of graphic:

| Kind | What it is |
|---|---|
| Built-in | The graphics that come with Fieldhouse. You can change colours, size, place, animation and which parts show, and reset them. |
| HTML | A page you write (or copy) that Fieldhouse fills with live data. |
| CasparCG template | An HTML template made for CasparCG (`play()`, `stop()`, `update()`). Imported as it is. |
| Web page | Any web overlay with an address (for example the output page of a Singular or UNO overlay). It becomes its own layer in OBS. |
| Remote | A graphic that another system draws (Singular, UNO, a CasparCG server, anything with an HTTP address). Fieldhouse tells it when to show, update and hide, and can add its output page to OBS. |

## Fonts: read this first

OBS's built-in browser behaves differently from Chrome. Measured inside OBS 32 (Flatpak) on the development machine:

- **Only `system-ui` and named families draw text.** The generic names `serif`, `sans-serif`, `monospace`, `cursive` and `fantasy` drew nothing at all. A template that says `font-family: sans-serif` (or says nothing and gets the browser default) shows **no text** in OBS on such a computer.
- **Fonts shipped with the graphic work.** A `.woff2`, `.woff`, `.ttf` or `.otf` file inside the graphic's folder, loaded with `@font-face { src: url(myfont.ttf) }`, rendered correctly in OBS. Fonts from the internet are not allowed unless you switch on "Allow network".
- The families installed in OBS are listed by `GET /api/graphics/fonts` (the overlay measures them inside OBS the first time it loads). Built-in graphics can use any of them (Settings > Graphics, font).

What Fieldhouse does for you: every HTML and CasparCG page it serves starts with a default font stack (`system-ui`, Roboto, Noto Sans, DejaVu Sans, Liberation Sans, Arial...) and maps the common names Arial, Helvetica, Helvetica Neue, Verdana, Tahoma, Segoe UI, Trebuchet MS, Times New Roman, Georgia, Courier New and Impact onto installed fonts. Your own CSS still wins, so always name a real family, for example:

```css
font-family: "DejaVu Sans", "Liberation Sans", Roboto, Arial, sans-serif;
```

The clock in the built-in score bug is drawn as seven-segment shapes, not text, for the same reason.

## Writing an HTML graphic

Create a graphic of kind HTML. It gets a starter page. The page is 1920 by 1080 pixels with a transparent background (set `background: transparent` and position things with `position: absolute`). Put any images, fonts, CSS and scripts in the same folder and refer to them with relative paths.

Fieldhouse adds `/gfx/_runtime.js` to the page for you. It gives you:

### Declarative bindings (no script)

```html
<span data-fh-bind="home.score"></span>              <!-- text from a variable -->
<span data-fh-bind="@title"></span>                   <!-- text from one of the graphic's own fields (@name) -->
<span data-fh-bind="custom.sponsorLine" data-fh-fallback="Welcome"></span>
<img data-fh-attr="src:home.logo; alt:home.name">      <!-- attributes (not onclick and similar) -->
<div data-fh-style="--team:home.color; width:custom.barWidth"></div>   <!-- CSS properties -->
<div data-fh-show="home.bonus">BONUS</div>             <!-- hidden when empty, 0 or false -->
<p data-fh-template>{{home.name}} {{home.score}} - {{away.score}} {{away.name|Visitors}}</p>
```

Values are always put in as text or as an attribute value, never as markup, so a team called `<b>Lions</b>` shows literally.

### Script hooks

```html
<script>
  Fieldhouse.onUpdate(function (vars, fields) {   // every time anything changes
    document.title = vars["home.name"];
  });
  Fieldhouse.onPlay(function () { /* the graphic was put on air */ });
  Fieldhouse.onStop(function () { /* it was taken off air */ });
  Fieldhouse.onNext(function () { /* the operator pressed Next */ });
  var abbr = Fieldhouse.get("home.abbr", "HOME");  // read a variable (or "@field") with a fallback
</script>
```

While a graphic is on air the `<html>` element has the class `fh-on`, so you can animate in CSS alone: `html.fh-on #bar { transform: none }`.

### Variables

`home.` and `away.` plus `name`, `abbr`, `color`, `score`, `fouls`, `timeouts`, `bonus`; `period`, `periodLabel` (Q3, 2nd half...), `clock` (04:31), `clockMs`, `running`; `game.title`, `game.date`, `game.venue`; starters `home.starters.1.name`, `.number`, `.position` and `home.starters.count`; full rosters with `roster` instead of `starters`; `lower.title`, `lower.sub`; `sponsor.name`; `custom.<key>` for your own custom fields; `counters.<id>.home` / `.away` (for sports with extra counters). The list with sample values is `GET /api/graphics/sample-vars`.

### Fields

A graphic's **fields** are the named values you can send when showing it. Each field is bound to a variable (`home.score`), to fixed text (which may contain `{{home.name}}`), or left manual (the operator or a rule types it). In a page you read them with `@name`. In a CasparCG template they become the data sent to `update()`.

### Where text goes: escaping

In a page, use `data-fh-bind` and friends (safe). If you build markup yourself, use `textContent`, not `innerHTML`. For the `{{path}}` syntax used in constants and connector templates, the text is escaped for its place: HTML text and attributes (`&`, `<`, `>`, quotes), CSS (only letters, digits and `# . , % ( ) / -` survive), URLs (percent-encoded) or JSON strings (escaped).

### Safety limits

HTML graphics run in a sandboxed frame: scripts yes, but no access to Fieldhouse or its data, no cookies or local storage, no forms, no popups. They may only load files from their own folder (plus `data:` and `blob:`). "Allow network" lets a graphic load things from the internet (a script library, a font, live data); leave it off unless you need it. Pages are limited to 50 MB and 500 files and these file types: html css js json svg png jpg jpeg gif webp woff woff2 ttf otf mp4 webm.

## Importing a CasparCG template

Import a single `.html`, a `.zip` of the template folder, or several files at once (choose the folder). Fieldhouse checks the files, then **analyses** the template and shows what it found:

- which of `play()`, `stop()`, `update()` and `next()` it defines;
- the field ids it seems to use (from `componentData id=`, `data-field` attributes, `getElementById` and element ids) with a suggested variable where the name gives it away (`homeScore` becomes `home.score`);
- whether it prefers XML (the CasparCG default: `<templateData><componentData id="f0"><data id="text" value="..."/></componentData></templateData>`) or JSON (`{"f0":"..."}`), judged from how `update()` reads its data. You can override this per graphic;
- warnings: Flash files (`.ft`, `.swf`: not usable), 3D transforms, anything loaded from the internet, a missing `play()` or `update()`.

You then map each template field to a variable or a constant, choose the role and placement (templates are full-canvas, so the default is the top left corner at 0, 0) and save.

How it plays: when you show the graphic Fieldhouse sends `update(data)` then `play()`; when you hide it, `stop()` (the page stays on screen for the "hold after stop" time, 1.5 seconds by default, so its exit animation can finish, then it disappears); **Next** calls `next()`; changed data calls `update()` again. CasparCG templates animate themselves, so the preset animations do not apply to them.

Three small working templates are included, one for each style: a lower third that takes XML, a score bug that takes JSON and follows the live game, and a full-screen card with a Next step. Install them from "Try an example" and open their files to see how a template is built.

## Fieldhouse graphic packs (`.fhgfx`)

Export any graphic to share it. A pack is a zip with `manifest.json` (`schema: 1`, the graphic's settings, a file list) and the graphic's files. It never contains ids, dates, passwords or tokens. Importing one always makes a new graphic, so it can never replace one you have.

## Web pages and OBS layers

Give a graphic kind "Web page" an address (`https://...`, or `http://` for a page on your own network) and a size. Fieldhouse adds it to OBS as a browser source named `FH Ext <id>` inside every Fieldhouse scene, hidden. **Show** turns it on, **Hide** turns it off, both at once, with no reload. Layers with a negative stacking order (`z`) go under the Fieldhouse overlay page, others above it. Your own OBS sources are never touched. Use the optional CSS box for small fixes such as hiding a page's background.

## Connecting other systems

Make a connector first (Graphics > Connectors), give it its secret once (it is stored, never shown again and never written to logs), press **Test connection**, then create a *Remote* graphic that uses it.

### Singular and UNO overlays

1. In Singular (or UNO) open your overlay's **Control App** and copy its app token. In Fieldhouse make a Singular connector and paste the token.
2. Press **Test connection**. Fieldhouse reads the control app (a read-only call).
3. In the import wizard Fieldhouse reads the **model** and lists the sub-compositions with their control nodes. Pick one (or type its name). Each control node becomes a field of the graphic; bind it to a variable such as `home.score`.
4. **Show** sends the values with state `In`; changes send only what changed; **Hide** sends `Out` (choose `Out1` or `Out2` if your composition uses them).
5. To see the overlay in your program, paste the overlay's **output URL** (the page designed for OBS browser sources; copy it from the overlay's output settings in Singular) into the graphic's "Output page" box. Fieldhouse adds it to OBS as a layer.

Limits: Singular's free plan allows about 25 calls a minute, so Fieldhouse sends at most 5 a second by default and merges quick changes; lower it in the connector's settings if you see "limiting" messages. If Singular cannot be reached Fieldhouse retries a few times, then tells you. *Not yet verified against a real Singular account.*

### CasparCG server

Enter the server's address, port (5250), channel, layer, the template path as CasparCG knows it (for example `fieldhouse/lower-third`) and the data format. Fieldhouse sends `CG ADD` (with the data and play-on-load), `CG UPDATE`, `CG NEXT` and `CG STOP` / `REMOVE` / `CLEAR`. If the connection drops it reconnects and puts what was on air back. *Not yet verified against a real CasparCG server (it is tested against a stand-in that speaks AMCP).* Note that the CasparCG server draws on its own outputs; to see it in OBS give the graphic an output page, or import the template into Fieldhouse as a CasparCG template instead and let Fieldhouse draw it.

### Anything else (HTTP)

For a graphics system with an HTTP interface, write a request for each action (show, update, hide, next): method, address, headers and body. Variables work inside them: `{{home.score}}`, `{{field.name}}`, `{{target.key}}`, and `{{secret}}` for the stored key.

```
POST https://example.com/api/lowerthird
Authorization: Bearer {{secret}}
{"name": "{{field.title}}", "team": "{{home.name}}"}
```

## Automation

Rules and macros can show, hide, update and clear any graphic by its id (see [Automation](automation-guide.md)). Developers: see the [graphics API](dev/graphics-api.md).
