# Third-party licenses

Fieldhouse itself is licensed under GPL-3.0-or-later (see [LICENSE](LICENSE)). This file lists what it uses, bundles, or expects the user to install separately.

"Confirmed" means the license was read from a primary source (the project's own license file or documentation). "Not confirmed" means it is stated here from planning notes and must be checked before a release. This is not legal advice.

## Bundled in this repository

| Component | License | Status | Notes |
|-----------|---------|--------|-------|
| DSEG7 Classic Bold (embedded as a data URI in `web/tokens.css`, LED digits in the app UI; the OBS overlay draws its digits as SVG and uses no font) | SIL Open Font License 1.1 | Confirmed (font readme, dseg 0.46.0 npm package) | Copyright keshikan (http://www.keshikan.net/index-e.html). Fonts under the OFL may be bundled and embedded; the license text and copyright notice must travel with the font. The full OFL 1.1 text is at https://openfontlicense.org/ and is not yet copied into this repo. **Maintainer: add `src/assets/OFL.txt` before release.** The readme in the package we checked is version 0.40 of the font family; confirm the shipped file matches. |
| Feed images in `src/assets/feeds` and `web/img` | Written for this project | Not confirmed | Original placeholder artwork. Confirm they are covered by the project license. |

Fieldhouse has no npm dependencies at runtime (`package.json` lists none).

## Runtime and build tools

| Component | License | Status | Notes |
|-----------|---------|--------|-------|
| Bun (runtime) | MIT, with the following parts under other licenses | Confirmed (Bun's `LICENSE.md`, github.com/oven-sh/bun) | Bun statically links JavaScriptCore/WebKit, which is LGPL-2 licensed; Bun's license file explains how to relink. It also statically links BoringSSL, libarchive, tinycc (LGPL v2.1), ICU and others, each listed in that file. If a desktop installer bundles Bun, ship Bun's `LICENSE.md` notices with it. |
| Electron (desktop shell) | MIT | Not confirmed from a primary source | The desktop app is built with Electron plus a compiled Bun program (the Bun notes above apply to it). Electron bundles Chromium, whose notices must also ship (see below). |
| electron-builder, electron-updater (if used) | MIT | Not confirmed | Check the versions actually used. Automatic updates are not verified. |
| Chromium / CEF | BSD-3-Clause plus many third-party notices | Not confirmed | Applies if an installer bundles Chromium (Electron) or if OBS's browser source is used (OBS bundles CEF). Ship the notice file the framework provides. |
| FFmpeg (`ffmpeg` command-line tool) | LGPL-2.1-or-later or GPL-2.0-or-later, depending on how the build was configured | Not confirmed | Fieldhouse calls the `ffmpeg` found on the user's computer (test recordings, highlight export). It does not link it. If an installer bundles an FFmpeg build, record which configuration it is and ship its license and source offer. |

## External programs the user installs

| Component | License | Status | Notes |
|-----------|---------|--------|-------|
| OBS Studio | GPL-2.0-or-later | License not confirmed from a primary source. Fieldhouse was tested with OBS Studio 32.2.2 (Flatpak) | Fieldhouse controls OBS as a separate program over obs-websocket. It does not include OBS code. Verify the "or later" wording in the OBS version you test against. |
| obs-websocket (built into OBS Studio 28 and later) | GPL-2.0 | License not confirmed. Tested with version 5.7.4 | Fieldhouse speaks the v5 protocol over a WebSocket. |
| SRT (used by OBS and some camera apps) | MPL-2.0 | Not confirmed | Not part of Fieldhouse. |
| NDI | Proprietary SDK and branding terms | Unresolved | **Not bundled and not used.** NDI may be incompatible with GPL distribution. Anyone who wants NDI sources installs the NDI plugin for OBS themselves, under NDI's own terms. Do not add NDI code to this repository until the SDK terms are checked. |

## Patents and codecs

Open-source licenses do not grant patent rights. Fieldhouse streams H.264 and AAC, which are covered by patent pools that apply to distributors of encoders. Fieldhouse does not ship an encoder; it uses the encoders in the user's installed OBS and hardware. See `07-business-licensing-support.md`.

## Trademarks

OBS, YouTube, Facebook, NDI, Hudl and vMix are names of their owners. Fieldhouse is not affiliated with or endorsed by any of them. "Fieldhouse" is a working title; no trademark search has been done.
