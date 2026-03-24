# Self-Hosted Fonts

GDPR-compliant self-hosted fonts — no external CDN requests.

## Included Fonts

| Font | Weights | Format | Source |
|------|---------|--------|--------|
| **Titillium Web** | 300, 400, 600, 700 | woff2 (latin + latin-ext) | Google Fonts v19 |
| **Roboto Mono** | 400–700 (variable) | woff2 (latin + latin-ext) | Google Fonts v31 |
| **Lora** | 400–700 (variable) | woff2 (latin + latin-ext) | Google Fonts v37 |

## How it works

- `@font-face` rules are defined in `src/styles/_fonts.scss`
- Loaded before Bootstrap Italia via `src/styles/globals.scss`
- Bootstrap Italia references these fonts by family name in its SCSS variables
- `font-display: swap` ensures text is visible while fonts load
- `unicode-range` subsetting minimizes download size for each charset
