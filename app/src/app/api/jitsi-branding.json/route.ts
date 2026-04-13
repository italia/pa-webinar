import { getSettings } from '@/lib/settings';

const CORS_HEADERS = {
  'Cache-Control': 'public, s-maxage=300',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/**
 * Avatar background palette derived from Bootstrap Italia / Designers Italia:
 * primary-a8, analogue-1-a5, analogue-2-a7, complementary-1-a7,
 * complementary-3-a7, neutral-1-a5, analogue-1-a4, primary-b3, analogue-1-b3
 */
const BI_AVATAR_BACKGROUNDS = [
  '#004D99',
  '#4B44CC',
  '#08A19C',
  '#B02E42',
  '#00996B',
  '#3D5A80',
  '#6A50D3',
  '#0077B6',
  '#8B6AAF',
];

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET() {
  const settings = await getSettings();

  return Response.json(
    {
      backgroundColor: '#17324D',
      premeetingBackground: 'radial-gradient(circle at 30% 40%, #17324D 0%, #0F1B2D 100%)',
      backgroundImageUrl: '',
      logoClickUrl: settings.organizationUrl || '',
      logoImageUrl:
        settings.jitsiWatermarkUrl ||
        settings.logoUrl ||
        '/images/dtd-watermark.svg',
      avatarBackgrounds: BI_AVATAR_BACKGROUNDS,
      inviteDomain: new URL(
        process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      ).hostname,
    },
    { headers: CORS_HEADERS },
  );
}
