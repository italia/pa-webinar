import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/organizations/suggestions?q=...
 *
 * Returns distinct organization names matching the query prefix.
 * Used for autocomplete in the registration form.
 */
export const GET = withErrorHandling(async (request) => {
  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim();

  if (!q || q.length < 2) {
    return Response.json({ suggestions: [] });
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

  return Response.json({ suggestions });
});
