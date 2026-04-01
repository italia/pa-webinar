import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/organizations/suggestions?q=...
 *
 * Returns distinct organization names matching the query prefix.
 * Used for autocomplete in the registration form.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json({ suggestions: [] });
  }

  const results = await prisma.registration.findMany({
    where: {
      organization: { startsWith: q, mode: 'insensitive' },
    },
    select: { organization: true },
    distinct: ['organization'],
    take: 10,
    orderBy: { organization: 'asc' },
  });

  const suggestions = results
    .map((r) => r.organization)
    .filter((name): name is string => name !== null);

  return NextResponse.json({ suggestions });
}
