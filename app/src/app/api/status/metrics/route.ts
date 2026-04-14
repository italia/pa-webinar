import { NextResponse } from 'next/server';

import { withErrorHandling } from '@/lib/api-handler';
import {
  isPrometheusConfigured,
  queryPrometheusRange,
} from '@/lib/prometheus';

export const dynamic = 'force-dynamic';

const ALLOWED_QUERIES: Record<string, string> = {
  uptime: 'avg_over_time(up{job=~".*eventi.*"}[24h]) * 100',
  responseTime: 'histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{app="eventi-dtd"}[5m]))',
  participants: 'eventi_jvb_participants{app="eventi-dtd"}',
  conferences: 'eventi_jvb_conferences{app="eventi-dtd"}',
  stress: 'eventi_jvb_stress_level{app="eventi-dtd"}',
};

export const GET = withErrorHandling(async (request) => {
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
      headers: { 'Cache-Control': 'public, max-age=30' },
    });
  } catch {
    return NextResponse.json({ available: false });
  }
});
