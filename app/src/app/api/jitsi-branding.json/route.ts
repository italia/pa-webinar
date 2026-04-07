import { getSettings } from '@/lib/settings';

export async function GET() {
  const settings = await getSettings();

  return Response.json(
    {
      backgroundColor: settings.primaryColor || '#002855',
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
    {
      headers: { 'Cache-Control': 'public, s-maxage=300' },
    },
  );
}
