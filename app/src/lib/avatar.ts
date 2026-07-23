/**
 * Shared avatar generation utilities.
 *
 * Used by:
 * - /api/avatar route (HTTP proxy with Gravatar fallback)
 * - JWT generation (inline data URI, the default)
 *
 * The data URI is the default because it always works and starts no request,
 * not because a remote URL is forbidden: verified on the deployed jitsi-web
 * (stable-10741), the bundle takes `avatarURL` from the JWT unconditionally,
 * preloads it, and falls back to initials if it fails to load. No CSP header is
 * served for that origin either.
 */

const DEFAULT_SIZE = 200;
const MIN_SIZE = 32;
const MAX_SIZE = 512;

/**
 * Lato del quadrato richiesto a `/api/avatar`, in pixel.
 *
 * Due trappole in una riga sola, ed è per questo che vive qui, testata.
 * `Number('abc')` è NaN, e NaN sopravvive sia a Math.max sia a Math.min:
 * l'SVG verrebbe costruito con coordinate NaN, su una route pubblica. Ma
 * `Number('')` è 0, che è FINITO, e verrebbe schiacciato sul minimo di 32 —
 * cioè proprio la richiesta senza `size`, la forma più comune, servita a 32px
 * dentro uno slot da 200.
 */
export function parseAvatarSize(raw: string | null): number {
  const n = raw ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n)) return DEFAULT_SIZE;
  return Math.min(Math.max(n, MIN_SIZE), MAX_SIZE);
}

const BI_PALETTE = [
  { bg: '#004D99', fg: '#FFFFFF' },
  { bg: '#4B44CC', fg: '#FFFFFF' },
  { bg: '#08A19C', fg: '#FFFFFF' },
  { bg: '#B02E42', fg: '#FFFFFF' },
  { bg: '#00996B', fg: '#FFFFFF' },
  { bg: '#3D5A80', fg: '#FFFFFF' },
  { bg: '#6A50D3', fg: '#FFFFFF' },
  { bg: '#0077B6', fg: '#FFFFFF' },
  { bg: '#8B6AAF', fg: '#FFFFFF' },
  { bg: '#17324D', fg: '#FFFFFF' },
  { bg: '#0066CC', fg: '#FFFFFF' },
  { bg: '#2E4A62', fg: '#C9D4DE' },
] as const;

function hashName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '?';
  if (parts.length === 1) return first.toUpperCase();
  const last = parts[parts.length - 1]?.[0] ?? '';
  return (first + last).toUpperCase();
}

export function generateAvatarSvg(name: string, size: number): string {
  const idx = hashName(name) % BI_PALETTE.length;
  const entry = BI_PALETTE[idx] ?? BI_PALETTE[0]!;
  const { bg, fg } = entry;
  const initials = getInitials(name);
  const fontSize = initials.length > 1 ? size * 0.36 : size * 0.44;
  const r = size / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="${size}" y2="${size}" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${bg}"/>
      <stop offset="100%" stop-color="${bg}" stop-opacity="0.82"/>
    </linearGradient>
  </defs>
  <circle cx="${r}" cy="${r}" r="${r}" fill="url(#g)"/>
  <text x="50%" y="50%" dy=".1em"
    text-anchor="middle" dominant-baseline="central"
    font-family="'Titillium Web','Segoe UI',system-ui,sans-serif"
    font-weight="600" font-size="${fontSize}px"
    fill="${fg}" fill-opacity="0.95"
    letter-spacing="1">${initials}</text>
</svg>`;
}

/**
 * Returns a data URI for an SVG avatar — works inside Jitsi iframe
 * without any CSP or CORS issues.
 */
export function generateAvatarDataUri(name: string, size = 200): string {
  const svg = generateAvatarSvg(name, size);
  const b64 = Buffer.from(svg).toString('base64');
  return `data:image/svg+xml;base64,${b64}`;
}
