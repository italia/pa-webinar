import { getSettings } from '@/lib/settings';

const CORS_HEADERS = {
  'Cache-Control': 'public, s-maxage=300',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET() {
  const settings = await getSettings();

  return Response.json(
    {
      backgroundColor: settings.primaryColor || '#0F1B2D',
      backgroundImageUrl: '',
      logoClickUrl: settings.organizationUrl || '',
      logoImageUrl:
        settings.jitsiWatermarkUrl ||
        settings.logoUrl ||
        '/images/dtd-watermark.svg',
      inviteDomain: new URL(
        process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      ).hostname,
    },
    { headers: CORS_HEADERS },
  );
}
