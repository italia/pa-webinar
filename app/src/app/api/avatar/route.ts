import { type NextRequest, NextResponse } from 'next/server';

/**
 * Avatar generator aligned with Bootstrap Italia / Designers Italia palette.
 *
 * GET /api/avatar?name=Raff&size=200
 *
 * Generates an SVG avatar with the user's initial on a BI-palette background.
 * Uses Titillium Web (the official BI font family).
 * The background color is deterministic based on the name hash so the same
 * name always gets the same color.
 */

const BI_PALETTE = [
  { bg: '#004D99', fg: '#FFFFFF' }, // Primary blue dark
  { bg: '#4B44CC', fg: '#FFFFFF' }, // Analogue 1 (indigo)
  { bg: '#08A19C', fg: '#FFFFFF' }, // Analogue 2 (teal)
  { bg: '#B02E42', fg: '#FFFFFF' }, // Complementary 1 (rose)
  { bg: '#00996B', fg: '#FFFFFF' }, // Complementary 3 (green)
  { bg: '#3D5A80', fg: '#FFFFFF' }, // Neutral 1 medium
  { bg: '#6A50D3', fg: '#FFFFFF' }, // Violet
  { bg: '#0077B6', fg: '#FFFFFF' }, // Medium blue
  { bg: '#8B6AAF', fg: '#FFFFFF' }, // Mauve
  { bg: '#17324D', fg: '#FFFFFF' }, // BI neutral-1 (dark navy)
  { bg: '#0066CC', fg: '#FFFFFF' }, // BI primary
  { bg: '#2E4A62', fg: '#C9D4DE' }, // Neutral muted
];

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

function generateAvatarSvg(name: string, size: number): string {
  const idx = hashName(name) % BI_PALETTE.length;
  const entry = BI_PALETTE[idx] ?? BI_PALETTE[0]!;
  const { bg, fg } = entry;
  const initials = getInitials(name);
  const fontSize = initials.length > 1 ? size * 0.36 : size * 0.44;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${bg}" stop-opacity="1"/>
      <stop offset="100%" stop-color="${bg}" stop-opacity="0.85"/>
    </linearGradient>
  </defs>
  <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="url(#g)"/>
  <text x="50%" y="50%" dy=".1em"
    text-anchor="middle" dominant-baseline="central"
    font-family="'Titillium Web', 'Segoe UI', system-ui, sans-serif"
    font-weight="600" font-size="${fontSize}px"
    fill="${fg}" fill-opacity="0.95"
    letter-spacing="1">${initials}</text>
</svg>`;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const name = searchParams.get('name') || 'User';
  const size = Math.min(Math.max(Number(searchParams.get('size') || '200'), 32), 512);

  const svg = generateAvatarSvg(name, size);

  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
