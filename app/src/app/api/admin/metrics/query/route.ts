import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { UnauthorizedError, ValidationError } from '@/lib/errors';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import {
  isPrometheusConfigured,
  queryPrometheus,
  queryPrometheusRange,
} from '@/lib/prometheus';

export const dynamic = 'force-dynamic';

const queryBodySchema = z.object({
  query: z.string().min(1).max(4096),
  start: z.string().min(1).max(64).optional(),
  end: z.string().min(1).max(64).optional(),
  step: z.string().min(1).max(32).optional(),
});

export const POST = withErrorHandling(async (request) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  if (!isPrometheusConfigured()) {
    return NextResponse.json({ available: false }, { status: 200 });
  }

  const parsed = queryBodySchema.safeParse(await parseJsonBody(request));
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }
  const { query, start, end, step } = parsed.data;

  try {
    const isRange = Boolean(start && end && step);
    const result = isRange
      ? await queryPrometheusRange(query, start!, end!, step!)
      : await queryPrometheus(query);
    await logAdminAction({
      request,
      action: 'ADMIN_METRICS_QUERY',
      target: query,
      details: isRange ? { start, end, step } : null,
    });
    return NextResponse.json({ available: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Prometheus query failed';
    return NextResponse.json({ available: true, error: message }, { status: 502 });
  }
});
