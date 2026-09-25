# Self-hosted fonts

This folder holds the web fonts of the .italia design system (Bootstrap Italia and design-react-kit). The portal serves them itself, from `/fonts/`.

## Why they are self-hosted

- **No third-party requests.** Loading fonts from Google Fonts or another CDN would send every visitor's IP address and browser details to a third party as soon as a page loads. PA Webinar serves its own fonts, scripts and stylesheets. The few optional external resources are listed in [Logs and external resources](../../../docs/GDPR.md#logs-and-external-resources) in the privacy guide.
- **The Content Security Policy enforces it.** The policy allows fonts only from the portal itself and from `data:` URIs (`font-src 'self' data:`), so a font URL on another host is blocked. See [Content Security Policy directives](../../../docs/SECURITY-CSP.md#content-security-policy-directives).

## Families and files

| Family | Used by Bootstrap Italia as | Weights declared | Files |
|---|---|---|---|
| Titillium Web | `$font-family-sans-serif`, the body and heading font | 300, 400, 600, 700, one static file per weight and subset | `titillium-web-<weight>-latin.woff2`, `titillium-web-<weight>-latin-ext.woff2` |
| Roboto Mono | `$font-family-monospace` | 400 to 700, one variable file | `roboto-mono-latin.woff2`, `roboto-mono-latin-ext.woff2` |
| Lora | `$font-family-serif` | 400 to 700, one variable file | `lora-latin.woff2`, `lora-latin-ext.woff2` |

- **WOFF2 only**, taken from Google Fonts as its `latin` and `latin-ext` subsets.
- **`latin`** covers Basic Latin, Latin-1 and common punctuation and symbols, including the euro sign in Titillium Web and Lora. **`latin-ext`** covers the extended Latin letters of languages such as Czech, Polish, Romanian and Maltese.
- **The Roboto Mono files have no euro glyph**, although `_fonts.scss` lists U+20AC in their `unicode-range`. A `€` in monospace text therefore renders in the system `monospace` font, the fallback of Bootstrap Italia's `$font-family-monospace`.
- **No Cyrillic or Greek subset is bundled.** Cyrillic and Greek characters, such as Bulgarian and Greek interface text or event content in those scripts, render in the fallback fonts of each stack. Browsers fall back one character at a time, so Latin characters on the same page, such as digits, names and URLs, still use the web fonts. For body text, the fallback is `Geneva, Tahoma, sans-serif`, from Bootstrap Italia's `$font-family-sans-serif`.
- **Upright faces only.** No italic face is declared, so the browser synthesizes italics.
- **Roboto Mono's variable axis** runs from 100 to 700 in the file, but `_fonts.scss` declares only the 400 to 700 range.

To read a file's copyright notice, version and license URL, dump its `name` table with fontTools from the repository root. Name ID 0 holds the copyright notice, ID 5 the version and ID 14 the license URL. Install fontTools in a virtual environment outside the repository: distributions that apply PEP 668, such as Debian and Ubuntu, refuse a global `pip install`. The `woff` extra pulls in the Brotli decoder that WOFF2 files need.

```bash
python3 -m venv ~/.venvs/fonttools
~/.venvs/fonttools/bin/pip install 'fonttools[woff]'
~/.venvs/fonttools/bin/ttx -q -t name -o - app/public/fonts/lora-latin.woff2
```

With pipx installed, `pipx run --spec 'fonttools[woff]' ttx -q -t name -o - app/public/fonts/lora-latin.woff2` does the same in one line.

## How they load

1. `app/src/styles/_fonts.scss` declares one `@font-face` per face and subset: one per weight for Titillium Web, and one covering the `400 700` weight range for each of the variable Roboto Mono and Lora. Each rule points at `/fonts/<file>.woff2`, with `font-display: swap` and the subset's `unicode-range`.
2. `app/src/styles/globals.scss` imports `fonts` before `bootstrap-italia`, and `app/src/app/layout.tsx` imports `globals.scss`, so every page gets the declarations.
3. Bootstrap Italia refers to the three families by name only, in `node_modules/bootstrap-italia/src/scss/base/_variables.scss`. Its SCSS declares no `@font-face` of its own, and the app does not use the package's font loader, so `_fonts.scss` is the only source of the faces.
4. **`font-display: swap`** renders text in the fallback font at once and swaps in the web font when it arrives, so text is never invisible while fonts load.
5. **`unicode-range`** lets the browser download only the subsets a page needs. A page with no character in the `latin-ext` range never fetches the `latin-ext` files.

The `src` paths are literal file names. Renaming or replacing a file means editing `_fonts.scss` in the same change.

## Other users of these families

- **The square** (`lobby/`) asks for `Titillium Web` by name for its canvas labels. Inside the portal, it gets the faces declared here.
- **The link-preview image** (`/api/og/event/[slug]`) is drawn on the server and does not read these files. It loads the Titillium Web TTF files shipped in the `bootstrap-italia` package (`node_modules/bootstrap-italia/src/fonts/Titillium_Web/`). `outputFileTracingIncludes` in `app/next.config.ts` copies them into the standalone build.
- **Initials avatars and emails** name Titillium Web but never load these files. The avatars built by `app/src/lib/avatar.ts` (served by `/api/avatar` and embedded as a data URI in the Jitsi token) are standalone SVG images, and an image cannot use the page's web fonts. The email templates (`app/src/lib/email/templates.ts`, `app/src/lib/email/notification.ts`) set the family in inline styles but link no font file. Both render in the next font of their stack: `Segoe UI` or `system-ui` for avatars, Helvetica or Arial for emails.

## License

All three families are under the **SIL Open Font License, Version 1.1** (OFL). The license field of each bundled file points to the OFL. The fonts stay under the OFL: the repository's EUPL-1.2 does not apply to them. The OFL allows them to be bundled and redistributed with software under any license.

| Family | Copyright notice, verbatim from the files | Reserved Font Name |
|---|---|---|
| Titillium Web | Copyright (c) 2009-2011 by Accademia di Belle Arti di Urbino and students of MA course of Visual design. Some rights reserved. | None declared |
| Roboto Mono | Copyright 2015 The Roboto Mono Project Authors (https://github.com/googlefonts/robotomono) | None declared |
| Lora | Copyright 2011 The Lora Project Authors (https://github.com/cyrealtype/Lora-Cyrillic), with Reserved Font Name "Lora". | "Lora" |

- **Roboto Mono's license depends on the release.** The bundled files point to the OFL. Older Roboto Mono releases were under the Apache License 2.0, including the copy inside the `bootstrap-italia` package. Do not copy that package's `LICENSE.txt` for these files.
- **Lora has a Reserved Font Name.** Under the OFL, a modified version may not use the name "Lora" without permission from the copyright holders. If you re-subset or otherwise alter the Lora files, rename the family or use unmodified upstream files.
- **License text.** The copyright notices travel inside each file's metadata. The OFL also requires the license text to travel with the fonts, and this folder does not contain it yet. The official text is at [openfontlicense.org](https://openfontlicense.org/). The license status of every bundled asset is tracked in [Bundled assets](../../../THIRD-PARTY-LICENSES.md#bundled-assets).

## Changing or adding a font

- Use the upstream WOFF2 subsets and keep the naming pattern of this folder.
- Update `_fonts.scss` in the same change. The `unicode-range` of each rule must match the subset in its file.
- Read the new file's license and copyright with the command above. Then update the License section here and the row in [Bundled assets](../../../THIRD-PARTY-LICENSES.md#bundled-assets), and commit the license text next to the file.
- Never point `src` at an external host. The CSP blocks it, and the privacy model forbids it.

Front-end conventions for the design system are in [Extending PA Webinar](../../../docs/development/extending.md#the-interface-and-the-italia-design-system).
