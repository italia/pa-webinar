/**
 * GET /api/admin/events/[id]/consents
 *
 * Le prove dei consensi dell'evento (lib/gdpr/consent-proofs): in JSON il
 * solo riepilogo, senza nomi, per il pannello; con `?format=csv&locale=it`
 * l'elenco completo, con i nomi, per dimostrare i consensi (art. 7.1 GDPR).
 * Solo per lo staff che gestisce l'evento: il link del moderatore si puo'
 * inoltrare, e l'elenco porta i nomi delle persone. Ogni esportazione lascia
 * una riga DATA_EXPORTED nel registro GDPR dell'evento.
 */
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';

import { defaultLocale } from '@/i18n/config';
import { withErrorHandling } from '@/lib/api-handler';
import { requireEventManager } from '@/lib/auth/staff-session';
import { prisma } from '@/lib/db';
import { linguaPagina } from '@/lib/email/lingua';
import { proveConsensoEvento, riepilogoProve } from '@/lib/gdpr/consent-proofs';
import { csvText } from '@/lib/utils/csv';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request, context) => {
  const { id } = (await context.params) as { id: string };
  // Valida anche l'id (400 se non e' un UUID).
  await requireEventManager(await cookies(), id);

  const url = new URL(request.url);
  if (url.searchParams.get('format') !== 'csv') {
    // Il riepilogo non ha bisogno dei nomi: non si decifrano.
    const righe = await proveConsensoEvento(id, { nomi: false });
    return Response.json(
      { summary: riepilogoProve(righe), total: righe.length },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }
  const righe = await proveConsensoEvento(id);
  const lingua = linguaPagina(url.searchParams.get('locale')) ?? defaultLocale;
  const t = await getTranslations({
    locale: lingua,
    namespace: 'admin.consentProofs.csv',
  });
  const testo = csvText([
    [
      t('kind'),
      t('source'),
      t('role'),
      t('name'),
      t('givenAt'),
      t('withdrawnAt'),
      t('textVersion'),
    ],
    ...righe.map((r) => [
      t(`kinds.${r.kind}`),
      t(`sources.${r.source}`),
      t(`roles.${r.role}`),
      // Un nome che non si decifra si dice, non si lascia vuoto.
      r.name ?? t('unreadableName'),
      r.givenAt,
      r.withdrawnAt ?? '',
      r.textVersion === null ? '' : String(r.textVersion),
    ]),
  ]);
  await prisma.gdprAuditLog.create({
    data: {
      eventId: id,
      action: 'DATA_EXPORTED',
      recordCount: righe.length,
      details: JSON.stringify({ source: 'admin-consent-proofs' }),
    },
  });
  return new Response(`\uFEFF${testo}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="consensi-${id.slice(0, 8)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
});
