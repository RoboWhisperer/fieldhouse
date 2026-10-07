# Graphics Studio

The **Graphics** page (left menu) is where you look after everything that appears on top of your video: the score bug, name bars, sponsor cards, tickers, and graphics that come from other systems. This page is for the person running the broadcast. If you build your own templates, see [Graphics: templates, imports and connectors](graphics-authoring.md).

## The library

Every graphic is a card with a small live picture of how it looks. Each card shows what kind it is, whether it is **On air** or **Off air**, and has:

- a switch to turn it on or off (a switched-off graphic cannot be shown),
- **Show** and **Hide**,
- **Edit**, **Duplicate** and **Export** (saves a `.fhgfx` file you can share or back up),
- **Delete** for your own graphics, or **Reset to default** for the built-in ones.

At the top, the **On air** strip lists what viewers see right now. Press **Hide** next to a graphic, or **Clear all graphics** to take everything down. Graphics set to "always on" stay.

**New graphic** starts a blank page, a copy of a built-in, an import, a web overlay, or a remote graphic.

## The editor

Open **Edit** on any card. On the left is a preview of the 1920 by 1080 picture. Drag the dashed box to move the graphic, or focus it and use the arrow keys (hold Shift for bigger steps). On the right:

- **Where it sits** and **How it moves** (size, layer, see-through amount, how it appears and leaves).
- **When it shows**: only when you press Show, hide by itself after some seconds, always on, or while you are streaming or recording.
- **Values it shows**: each value comes from the live game, from fixed text, or is typed when you show it.
- **Look** (built-in graphics): colors with a readability hint, corner roundness, sizes, which parts show, and the font.
- **Page files** (custom pages and CasparCG templates): a simple code editor, upload and replace files, and a preview that reloads when you save.

**Try it** lets you type values and press Show, Update, Next and Hide on the preview only, or on the real stream. Nothing is saved until you press **Save changes**.

### A note about fonts

The video is drawn by OBS, which only has the fonts installed on the computer it runs on. The font list in the editor is what OBS really has. A font that exists only on your computer can look right in the preview and then be missing on the stream, so stay with the list.

## Adding a graphic

**Import** takes a `.html` file, a `.zip` of a template folder, a `.fhgfx` pack, or several files at once. Nothing is stored until you finish four steps: choose, check what Fieldhouse found (and any warnings), match each value to the game, then name and place it. **Try an example** adds one of three small CasparCG-style templates. **Web overlay by its address** adds a page from the internet as its own layer (needs internet while broadcasting).

## Connectors and remote graphics

A **connector** is a saved link to another system: Singular or UNO, a CasparCG server, or any web service. Add one, press **Test**, and Fieldhouse tells you in plain words if it works. Secrets such as the Singular app token are kept on this computer and never shown again; the form only says "Token saved".

A **remote graphic** ties a connector to a graphic that another system draws. For Singular, load your compositions, pick one, and Fieldhouse creates a field for each control. If you give the graphic an output page, Fieldhouse adds that page to OBS so it appears in your video.

All of this stays on your computer. No account is needed.
