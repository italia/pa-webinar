import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { withErrorHandling } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/api-handler';
import { UnauthorizedError } from '@/lib/errors';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import {
  isPrometheusConfigured,
  queryPrometheus,
  queryPrometheusRange,
} from '@/lib/prometheus';

export const dynamic = 'force-dynamic';

interface QueryPayload {
  query: string;
  start?: string;
  end?: string;
  step?: string;
}

export const POST = withErrorHandling(async (request) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  if (!isPrometheusConfigured()) {
    return NextResponse.json({ available: false }, { status: 200 });
  }

  const body = await parseJsonBody(request) as QueryPayload;
  if (!body.query || typeof body.query !== 'string') {
    return NextResponse.json({ error: 'query is required' }, { status: 400 });
  }

  try {
    if (body.start && body.end && body.step) {
      const result = await queryPrometheusRange(body.query, body.start, body.end, body.step);
      return NextResponse.json({ available: true, ...result });
    }
    const result = await queryPrometheus(body.query);
    return NextResponse.json({ available: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Prometheus query failed';
    return NextResponse.json({ available: true, error: message }, { status: 502 });
  }
});
