# Contributing to Fieldhouse

Fieldhouse is free and open source, maintained by volunteers. Bug reports, test reports from real gyms, docs fixes and code are all welcome. Please read the [Code of Conduct](CODE_OF_CONDUCT.md) first.


## Set up

1. Install [Bun](https://bun.sh).
2. Install `ffmpeg` (used for the fake engine's test recordings and highlight export).
3. Clone the repo, then:

```bash
bun test              # all tests
bun run demo          # http://127.0.0.1:8080 with demo data
bun start             # same, empty database in data/
```

There are no npm dependencies to install. Delete `data/` to reset, or set `DB=/tmp/x.db`.

OBS Studio is not needed for most work: the demo engine (`ENGINE=fake`, used by `bun run demo`) covers everything but real video. To try real OBS, see [docs/obs-setup.md](docs/obs-setup.md) and run the end-to-end script: `bun scripts/obs-e2e.ts`.

## Project map

| Path | What is in it |
|------|---------------|
| `src/game.ts` | Game state as an event log; the basketball profile |
| `src/store.ts` | SQLite storage |
| `src/app.ts` | All API routes and flows |
| `src/engine.ts`, `src/obs.ts` | Fake engine and OBS adapter, behind the `Engine` interface in `src/types.ts` |
| `src/data.ts`, `sponsors.ts`, `reports.ts`, `preflight.ts`, `storage.ts`, `highlights.ts`, `diagnostics.ts` | Domain modules |
| `src/server.ts` | HTTP and WebSocket server |
| `web/` | Browser UI, no build step. Contract in [web/README.md](web/README.md) |
| `design/` | Design frames and tokens; the visual spec for each screen |
| `docs/` | User documentation |
| `scripts/` | Small repo tools |
| `01-*.md` to `10-*.md` | Planning documents |

Tests sit next to the code as `*.test.ts`. Run `bun test` before every pull request; add a test for new logic.

## Coding style

- Short, readable code. Prefer the standard library and what is already in the repo over a new dependency. Do not add a dependency for something a few lines can do.
- No abstractions for a single use. No settings for values that never change.
- Plain-language error messages: they are shown to a volunteer on game night. Never put stream keys or pairing codes in logs or error text.
- UI text: no jargon beyond the button labels, no pricing, trial or account language.
- Follow `.editorconfig` (UTF-8, LF, 2 spaces).

## Add a sport profile

Today the only profile is basketball, defined as data in `src/game.ts` (`basketball`: periods, period length, overtime length, bonus threshold, timeouts) and editable in Settings. The code is not yet profile-driven (`sport` is typed as `"basketball"` in `src/types.ts`). To add a sport:

1. Open an issue first and describe the sport's clock, periods, scoring values and fouls or penalties.
2. Make the profile data-driven in `src/game.ts` and widen the `sport` type in `src/types.ts`.
3. Add events that sport needs (for example downs or sets) to `Ev` in `src/game.ts`, with tests.
4. Add the sport to the game form (`web/screens/new-game.js`) and the Settings sport section (`web/screens/settings-*.js`).
5. Update [docs](docs/README.md) and the changelog.

## Add a screen

Screens are ES modules in `web/screens/`. Read [web/README.md](web/README.md) for the module contract, the live state, the API and the rules. In short: match the frame in `design/screens/`, use classes from `web/ui.css`, show loading, empty and error states, make every control work, and never show stream keys.

## Commits, sign-off and pull requests

We use the Developer Certificate of Origin (DCO) instead of a contributor license agreement. Sign every commit with `git commit -s`, which adds a `Signed-off-by: Your Name <you@example.com>` line. That line means you agree to the following (DCO 1.1, from developercertificate.org):

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

Conventions:

- One change per pull request, small where possible.
- Commit messages: a short imperative summary line ("Fix clock drift after pause"), then a blank line and the reason.
- Fill in the pull request template. Say what you could not test (real OBS, real cameras, Windows, macOS).
- Do not commit recordings, stream keys, student data or the `data/` folder.

## License and file headers

Fieldhouse is GPL-3.0-or-later. By contributing you agree your work is released under that license. Source files do not carry headers yet. If the maintainers decide to add them, use the standard short notice:

```
Copyright (C) <year> <name of author>

This file is part of Fieldhouse.

Fieldhouse is free software: you can redistribute it and/or modify it under the terms of the
GNU General Public License as published by the Free Software Foundation, either version 3 of
the License, or (at your option) any later version.

Fieldhouse is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without
even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
General Public License for more details.

You should have received a copy of the GNU General Public License along with Fieldhouse. If
not, see <https://www.gnu.org/licenses/>.
```

Do not add new third-party code or assets without recording them in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md). Only OFL, CC0 or similarly permissive assets are accepted.

## Checking documentation

After editing any Markdown file, run:

```bash
bun scripts/check-links.ts
```

It checks that relative links and `#anchors` in the Markdown files resolve.

## Security problems

Do not open a public issue. See [SECURITY.md](SECURITY.md).
