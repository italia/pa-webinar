# CSP — Content Security Policy notes

## Current policy (production)

Generated per-request by `app/src/middleware.ts` in `applySecurityHeaders`. Key directives:

| Directive | Value | Notes |
|-----------|-------|-------|
| `default-src` | `'self'` | Restrictive default. |
| `frame-ancestors` | `'none'` | Equivalent of `X-Frame-Options: DENY`, modern syntax. |
| `frame-src` | `'self' https://${jitsiDomain} youtube` | Jitsi IFrame API + YouTube embed for legacy recordings. |
| `script-src` | `'self' 'nonce-X' 'strict-dynamic' https://${jitsiDomain}` | **No `'unsafe-inline'`** — per-request nonce + strict-dynamic, Next.js auto-attaches the nonce to its inline scripts via `x-nonce` request header. |
| `style-src` | `'self' 'unsafe-inline'` | **`'unsafe-inline'` deliberately retained.** See below. |
| `font-src` | `'self' data:` | Embedded woff/data URIs. |
| `img-src` | `'self' data: blob: ytimg` | Avatars + YT preview thumbs. |
| `connect-src` | `'self' jitsi (https+wss) + recording storage hosts` | Computed at request time from `RECORDING_STORAGE_TYPE`. |
| `media-src` | `'self' blob: + recording storage hosts` | Inline video player streams from object storage. |
| `object-src` | `'none'` | No Flash / Java applet etc. |
| `base-uri` | `'self'` | Prevent base-href hijacking. |
| `form-action` | `'self'` | Prevent form redirection. |

Other headers set alongside the CSP: `Strict-Transport-Security` (2y + preload), `X-Frame-Options: DENY` (legacy clickjacking guard), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera/mic scoped to Jitsi origin, geolocation off).

## Why `style-src 'unsafe-inline'` is still here

React renders the `style={{...}}` prop as a DOM `style="..."` **attribute**, not as a `<style>` block. In CSP terms that's an *inline style attribute*, controlled entirely by `'unsafe-inline'` (or by `'unsafe-hashes'` + a hash per distinct value).

A survey of the codebase as of 2026-05-27:

- **1022** occurrences of `style={{` in **60+** TSX files
- The values are frequently dynamic (`style={{transform: \`rotate(${angle}deg)\`}}`, computed widths, theme colours)
- Bootstrap Italia and `design-react-kit` components also emit inline styles internally for their own animations / layout primitives

Removing `'unsafe-inline'` today would break the rendered DOM. `'unsafe-hashes'` would need a hash per *exact* style string — impossible when React mutates them at runtime.

### Migration paths (multi-sprint, out of scope for the security round)

1. **className-only refactor** — replace every `style={{...}}` with a className backed by either a CSS module, a Bootstrap Italia utility, or a small utility class added to `globals.scss`. Most occurrences are simple (margin / colour / size); a smaller tail is dynamic and would need a CSS variable bridge (`style={{ '--x': value }}` + a class that reads `var(--x)` — note the bridge itself is still an inline style attribute, but a single property bridge is a tiny attack surface compared to arbitrary `style="..."` strings).
2. **CSS-in-JS that emits stylesheets** — migrate to a library like vanilla-extract, linaria, or @stylex that compiles `style={{...}}` to a generated stylesheet (covered by `style-src 'self'` + an emitted-class allow-list, no inline attributes left).

Both are realistic, both are large refactors. The chosen path will become a quarter-scope project.

## Why `script-src` does NOT have `'unsafe-inline'`

Inline scripts are the canonical XSS amplifier and the surface every CSP-aware auditor checks first. We:

- Generate a fresh 16-byte base64 nonce per request in the middleware.
- Surface the nonce via the `x-nonce` request header — Next.js automatically attaches it to every inline `<script>` it emits (RSC streaming chunks, hydration markers, prefetch hints).
- Combine `'nonce-X'` with `'strict-dynamic'` so the trusted nonced scripts can load their own dependencies without enumeration.
- Keep `https://${jitsiDomain}` for the external Jitsi IFrame API script.

This means an attacker who finds a reflected XSS sink in HTML *cannot* run `<script>alert(1)</script>` — they'd need to also leak the per-request nonce (different on every reload, never sent to the client outside the response headers).

## Testing CSP changes

CSP regressions don't show in unit tests — they only fire in a real browser console as "Refused to apply inline style" / "Refused to execute inline script". Manual test plan when touching the CSP:

1. `npm run dev` and open `/`, `/admin/login`, `/events/${slug}/live`, `/privacy/my-data` in a browser; watch DevTools Console.
2. Trigger the password-protected event flow and the live event entry (joins Jitsi via IFrame).
3. Test the wizard event creation in `/admin/events/new` (uses many BS Italia components with inline styles).
4. Test the GDPR self-service flow (`/privacy/my-data` and `/privacy/my-data/erasure`).
5. If any "Refused to ..." messages appear, the directive needs widening for the violating origin or a refactor of the violating call site.

In CI we currently rely on the E2E Playwright smoke test (`e2e` job) catching gross misconfiguration — the browser refuses to load, the test times out, the job fails.
