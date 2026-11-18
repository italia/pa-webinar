// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { cookies } from 'next/headers';

import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { withErrorHandling } from '@/lib/api-handler';
import { UnauthorizedError } from '@/lib/errors';
import {
  getOverview,
  getTimeline,
  getTopEvents,
  getEventAnalytics,
} from '@/lib/analytics';
import { mesiDelCatalogo } from '@/lib/analytics/catalog-stats';
import { statisticheCatalogo } from '@/lib/analytics/catalog-stats-query';
import { getSettings } from '@/lib/settings';

function parseDays(period: string | null): number | undefined {
  switch (period) {
    case '7d':
      return 7;
    case '30d':
      return 30;
    case '90d':
      return 90;
    case 'all':
      return undefined;
    default:
      return 30;
  }
}

export const GET = withErrorHandling(async (request) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) {
    throw new UnauthorizedError();
  }

  const url = new URL(request.url);
  const period = url.searchParams.get('period');
  const days = parseDays(period);
  // Il catalogo ha il suo periodo, in mesi (?months=): i tipi e i modelli si
  // confrontano mese per mese. `?section=` chiede una parte sola, perche' la
  // pagina cambia i due periodi separatamente e non rilegge l'altra.
  const mesi = mesiDelCatalogo(url.searchParams.get('months'));
  const section = url.searchParams.get('section');

  if (section === 'catalog') {
    const settings = await getSettings();
    return Response.json({
      catalog: await statisticheCatalogo(mesi, settings.defaultTimezone),
    });
  }

  const [overview, timeline, topEvents, recentEvents, catalog] = await Promise.all([
    getOverview(days),
    getTimeline(days ?? 365),
    getTopEvents(10),
    getEventAnalytics(10),
    section === 'overview'
      ? undefined
      : getSettings().then((s) => statisticheCatalogo(mesi, s.defaultTimezone)),
  ]);

  return Response.json({
    overview,
    timeline,
    topEvents,
    recentEvents,
    ...(catalog && { catalog }),
  });
});
