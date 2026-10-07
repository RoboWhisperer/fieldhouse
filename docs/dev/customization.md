# Customizing the console: data model and theme tokens

For the UI wave. Data and validation live in `src/automation/ui-settings.ts` (model) and `src/automation/ui-theme.ts` (palettes, contrast). Nothing here changes `web/tokens.css`: the web app applies the variables from `GET /api/ui` on top of it. API: [automation-api.md](automation-api.md#display-settings).

## `settings.ui`

```ts
{ theme: "dark"|"light"|"high-contrast"|"auto", accent: ""|"#RRGGBB", density: "compact"|"comfortable"|"spacious",
  textScale: 0.9..1.3, reducedMotion: "system"|"on"|"off", customCss: string (<= 8000 chars),
  layouts: { active: string, presets: LayoutPreset[] },           // 1..12 presets, "default" always exists and cannot be deleted
  macroButtons: { macroId, color?, size?: "normal"|"large" }[] }  // <= 24, in order
LayoutPreset { id, name, builtin?, columns: { left: Panel[], center: Panel[], right: Panel[] }, hidden: Panel[] }
Panel = graphics | audio | events | sponsor | game | replay | custom | macros
```

Every panel is in exactly one place (a column or `hidden`); panels left out are hidden. Presets: create, duplicate (`from`), edit, delete, reset to default and activate through the `/api/ui/layouts` routes. `macros` is the big-button panel; `custom` is the Custom fields panel (`GET/PUT /api/custom`, `fields[].type` says which input to draw: text, number, color, image, bool). Defaults are advisory: the console maps panels to its own cards.

## Mapping from settings to the web app

`GET /api/ui` returns `themes` (three variable maps, accent already applied), `common`, `attrs` and `customCss`. Apply:

1. Pick the map: `theme` of `dark`, `light` or `high-contrast`; for `auto` use `light` when `matchMedia("(prefers-color-scheme: light)")` matches, else `dark`. Set each entry on `document.documentElement.style` (or one generated `<style>:root{...}`).
2. Set `common` the same way, and the `attrs` on `<html>`.
3. Text size: `html{font-size:calc(13px * var(--ui-text-scale))}` (tokens.css uses 13px).
4. Density: use `--ui-gap`, `--ui-pad`, `--ui-row` in layout CSS (compact 6/6/28, comfortable 10/10/36, spacious 14/14/44 px).
5. Motion: `data-motion="reduce"` means no transitions; `full` means allow them even if the system asks for less; `system` means follow `prefers-reduced-motion`.
6. Custom CSS: add last, in one `<style id="user-css">`, **only in the local console** (never the phone remote, never `/overlay`).

Theme variables (all `--name`): `ground panel raised inset line line-strong text text-2 text-3 action action-hi action-ink action-wash action-fill program program-fill program-wash ready ready-wash caution caution-wash led led-dim home away`. Dark equals today's tokens.css.

With an accent: `--action` and `--action-fill` = the accent; `--action-ink` = black or white, whichever reads better on it; `--action-hi` (accent used as text or links) is moved toward black/white until it has 4.5:1 on `--panel` and `--raised`; `--action-wash` is a mix of `--panel` and the accent.

## Contrast

Computed with WCAG 2.x relative luminance. The test suite (`src/automation/ui.test.ts`) asserts, for **light** and **high-contrast**, every pair in `CONTRAST_PAIRS` (text, muted text, button ink, links, status colours >= 4.5:1; borders and action >= 3:1), and that any accent keeps ink, link text and wash AA in all three themes. Known gap in the shipped dark look (not changed here): `--program` on `--panel` is 4.47:1 (just under 4.5) and `--line-strong` on `--panel` is 1.78:1 (decorative border).

## Custom CSS limits

Applied only in the local console. Refused (the save fails with a plain reason): `@import`, `@charset`, `@namespace`, `@font-face`, any `url()` except a small embedded `data:image/png|jpeg|gif|webp;base64,...`, `image-set()`, `src()`, `element()`, `cross-fade()`, `expression()`, `javascript:`, `vbscript:`, `behavior`, `-moz-binding`, any `scheme://` text, backslash escapes, `<` and `>`, unbalanced braces, more than 8000 characters. This is a deny list over the text, so treat it as a safety net for mistakes and cross-site paste, not as a sandbox against someone who already controls the console. `POST /api/ui/check-css` lets the editor check as you type.
