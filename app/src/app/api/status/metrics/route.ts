import { NextResponse } from 'next/server';

import { withErrorHandling } from '@/lib/api-handler';
import { NotFoundError } from '@/lib/errors';
import { ADMIN_ONLY_CACHE_CONTROL, statusDataAccess } from '@/lib/status-page';
import {
  isPrometheusConfigured,
  queryPrometheusRange,
} from '@/lib/prometheus';
import { METRICS_APP_LABEL } from '@/lib/metrics';

export const dynamic = 'force-dynamic';

const ALLOWED_QUERIES: Record<string, string> = {
  uptime: `avg_over_time(up{job=~".*eventi.*"}[24h]) * 100`,
  responseTime: `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{app="${METRICS_APP_LABEL}"}[5m]))`,
  participants: `eventi_jvb_participants{app="${METRICS_APP_LABEL}"}`,
  conferences: `eventi_jvb_conferences{app="${METRICS_APP_LABEL}"}`,
  stress: `eventi_jvb_stress_level{app="${METRICS_APP_LABEL}"}`,
};

export const GET = withErrorHandling(async (request) => {
  // Pagina di stato spenta dall'amministrazione: questi dati servono solo a
  // lei e alla mappa dell'infrastruttura dell'area admin (lib/status-page).
  const access = await statusDataAccess();
  if (access === 'none') throw new NotFoundError('Status page');

  if (!isPrometheusConfigured()) {
    return NextResponse.json({ available: false });
  }

  const url = new URL(request.url);
  const metric = url.searchParams.get('metric');
  const hours = Math.min(parseInt(url.searchParams.get('hours') || '4', 10), 24);

  if (!metric || !ALLOWED_QUERIES[metric]) {
    return NextResponse.json({ error: 'Invalid metric' }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  const start = String(now - hours * 3600);
  const end = String(now);
  const step = hours <= 1 ? '15' : hours <= 4 ? '60' : '300';

  try {
    const result = await queryPrometheusRange(ALLOWED_QUERIES[metric], start, end, step);
    return NextResponse.json({
      available: true,
      metric,
      data: result.data,
    }, {
      // Pubblica solo se lo è la pagina: altrimenti la risposta è quella
      // dell'amministratore, e una cache condivisa la girerebbe a tutti.
      headers: {
        'Cache-Control': access === 'public' ? 'public, max-age=30' : ADMIN_ONLY_CACHE_CONTROL,
      },
    });
  } catch {
    return NextResponse.json({ available: false });
  }
});
