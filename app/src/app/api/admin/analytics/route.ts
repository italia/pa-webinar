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

  const [overview, timeline, topEvents, recentEvents] = await Promise.all([
    getOverview(days),
    getTimeline(days ?? 365),
    getTopEvents(10),
    getEventAnalytics(10),
  ]);

  return Response.json({
    overview,
    timeline,
    topEvents,
    recentEvents,
  });
});
