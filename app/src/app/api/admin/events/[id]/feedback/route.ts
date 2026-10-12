/**
 * GET /api/admin/events/[id]/feedback — le valutazioni dell'evento per la sua
 * pagina in amministrazione (lib/feedback/event-feedback-report): statistiche
 * per domanda, tutte le risposte senza nome, le valutazioni a stelle raccolte
 * prima dei questionari. `?format=csv&locale=it` le scarica in CSV.
 *
 * Chi: l'amministrazione e chi organizza l'evento (sessione dello staff),
 * oppure chi lo modera, con il proprio token in `Authorization: Bearer`: la
 * pagina dell'evento si apre anche dal link del moderatore. Le risposte non
 * portano nomi, quindi non c'e' niente che chi modera non debba vedere.
 */

import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';

import { defaultLocale, locales } from '@/i18n/config';
import { withErrorHandling } from '@/lib/api-handler';
import { extractModeratorToken, isEventModerator } from '@/lib/auth/moderator';
import { requireEventManager } from '@/lib/auth/staff-session';
import { prisma } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { buildEventFeedbackReport, feedbackReportCsv } from '@/lib/feedback/event-feedback-report';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request, context) => {
  const { id } = (await context.params) as { id: string };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new AppError('id must be a UUID', 400, 'BAD_REQUEST');
  }
  // Prima il token, se c'e': chi apre la pagina dal link del moderatore puo'
  // avere anche una sessione dello staff che quell'evento non lo gestisce.
  const token = extractModeratorToken(request);
  const event = token
    ? await prisma.event.findUnique({ where: { id }, select: { id: true, moderatorToken: true } })
    : null;
  if (!(event && token && (await isEventModerator(event, token)))) {
    await requireEventManager(await cookies(), id);
  }
  const report = await buildEventFeedbackReport(id);

  const url = new URL(request.url);
  if (url.searchParams.get('format') === 'csv') {
    const richiesta = url.searchParams.get('locale') ?? defaultLocale;
    const lingua = (locales as readonly string[]).includes(richiesta) ? richiesta : defaultLocale;
    const t = await getTranslations({ locale: lingua, namespace: 'admin.feedbackPanel' });
    return new Response(`\uFEFF${feedbackReportCsv(report, lingua, { yes: t('yes'), no: t('no') })}`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="valutazioni-${id.slice(0, 8)}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  }
  return Response.json(report, { headers: { 'Cache-Control': 'no-store' } });
});
