import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { isAdminAuthenticated } from '@/lib/auth/admin-session';
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

export async function GET(request: NextRequest) {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const period = request.nextUrl.searchParams.get('period');
  const days = parseDays(period);

  const [overview, timeline, topEvents, recentEvents] = await Promise.all([
    getOverview(days),
    getTimeline(days ?? 365),
    getTopEvents(10),
    getEventAnalytics(10),
  ]);

  return NextResponse.json({
    overview,
    timeline,
    topEvents,
    recentEvents,
  });
}
