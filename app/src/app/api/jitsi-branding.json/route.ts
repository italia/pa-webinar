import { getSettings } from '@/lib/settings';
import { appBaseUrl } from '@/lib/env';
import {
  JITSI_AVATAR_BACKGROUNDS,
  JITSI_STAGE_BACKGROUND,
  JITSI_STAGE_SVG,
  JITSI_SURFACE,
  JITSI_SURFACE_RAISED,
  JITSI_SURFACE_STRONG,
  JITSI_TILE_BACKGROUND,
} from '@/lib/jitsi/branding';

const CORS_HEADERS = {
  'Cache-Control': 'public, s-maxage=300',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/** La filigrana come data URI: nessuna seconda richiesta fra domini. */
const STAGE_IMAGE = `data:image/svg+xml;base64,${Buffer.from(JITSI_STAGE_SVG).toString('base64')}`;

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET() {
  const settings = await getSettings();

  return Response.json(
    {
      // Lo stesso colore dell'interfaceConfig (lib/jitsi/config): qui vince
      // il branding, e i due non devono dire cose diverse.
      backgroundColor: JITSI_STAGE_BACKGROUND,
      backgroundImageUrl: STAGE_IMAGE,
      premeetingBackground: `linear-gradient(135deg, ${JITSI_STAGE_BACKGROUND} 0%, #0059B3 100%)`,
      // Le superfici di Jitsi nei blu della sala (lib/jitsi/branding): la
      // striscia delle miniature (`uiBackground`), la barra dei controlli con
      // menu e finestre (`ui01`), evidenziazioni e riquadri senza telecamera
      // (`ui02`, `ui03`; `thumbnailBackground` dove la versione di Jitsi lo
      // distingue), bordi e passaggi del mouse (`ui04`).
      customTheme: {
        palette: {
          uiBackground: JITSI_STAGE_BACKGROUND,
          ui01: JITSI_SURFACE,
          ui02: JITSI_SURFACE_RAISED,
          ui03: JITSI_SURFACE_RAISED,
          ui04: JITSI_SURFACE_STRONG,
          thumbnailBackground: JITSI_TILE_BACKGROUND,
        },
      },
      logoClickUrl: settings.organizationUrl || '',
      // La filigrana di Jitsi resta spenta (SHOW_JITSI_WATERMARK); senza un
      // logo scelto dall'amministratore non se ne indica nessuno, cosi' non
      // compare nemmeno quello predefinito del server Jitsi.
      logoImageUrl: settings.jitsiWatermarkUrl || settings.logoUrl || '',
      avatarBackgrounds: JITSI_AVATAR_BACKGROUNDS,
      // Guardato: un NEXT_PUBLIC_APP_URL senza schema faceva 500 questa route.
      inviteDomain: appBaseUrl()?.hostname ?? '',
    },
    { headers: CORS_HEADERS },
  );
}
