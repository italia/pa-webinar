/**
 * Admin dashboard data for questionnaire responses.
 *
 * Query params:
 *   - eventId?        filter to one event
 *   - placement?      PRE_REGISTRATION | POST_EVENT
 *   - from?           ISO date (inclusive lower bound on submittedAt)
 *   - to?             ISO date (exclusive upper bound)
 *
 * Returns per-questionnaire aggregates: item distribution (choices),
 * average (LIKERT), yes/no split, and sample text responses — enough
 * for a BI overview without pulling every answer to the browser.
 */

import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { prisma } from '@/lib/db';
import { AppError, UnauthorizedError } from '@/lib/errors';
import { QUESTIONNAIRE_PLACEMENTS } from '@/lib/validation/schemas';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withErrorHandling(async (request) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const url = new URL(request.url);
  const eventId = url.searchParams.get('eventId');
  const placementParam = url.searchParams.get('placement');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  if (eventId && !UUID_RE.test(eventId)) {
    throw new AppError('eventId must be a UUID', 400, 'BAD_REQUEST');
  }
  if (
    placementParam &&
    !(QUESTIONNAIRE_PLACEMENTS as readonly string[]).includes(placementParam)
  ) {
    throw new AppError('invalid placement', 400, 'BAD_REQUEST');
  }
  const placement = placementParam as
    | (typeof QUESTIONNAIRE_PLACEMENTS)[number]
    | null;

  const questionnaires = await prisma.eventQuestionnaire.findMany({
    where: {
      ...(eventId && { eventId }),
      ...(placement && { placement }),
    },
    orderBy: { createdAt: 'desc' },
    include: {
      event: { select: { id: true, slug: true, title: true } },
      templates: {
        orderBy: { sortOrder: 'asc' },
        include: { template: { include: { items: { orderBy: { sortOrder: 'asc' } } } } },
      },
      adhocItems: { orderBy: { sortOrder: 'asc' } },
      responses: {
        where: {
          ...(from && { submittedAt: { gte: new Date(from) } }),
          ...(to && { submittedAt: { lt: new Date(to) } }),
          ...(from && to && {
            submittedAt: { gte: new Date(from), lt: new Date(to) },
          }),
        },
        include: { answers: true },
      },
    },
  });

  const out = questionnaires.map((q) => {
    const items = [
      ...q.templates.flatMap((link) => link.template.items),
      ...q.adhocItems,
    ];

    const itemAggregates = items.map((item) => {
      const answersForItem = q.responses.flatMap((r) =>
        r.answers.filter((a) => a.itemId === item.id),
      );
      const totalAnswered = answersForItem.length;

      const summary: Record<string, unknown> = { type: item.type, totalAnswered };

      if (item.type === 'SINGLE_CHOICE' || item.type === 'MULTI_CHOICE') {
        const opts = (item.options as Record<string, string>[] | null) ?? [];
        const counts = new Array(opts.length).fill(0);
        for (const a of answersForItem) {
          const choices = (a.valueChoices as number[] | null) ?? [];
          for (const idx of choices) {
            if (idx >= 0 && idx < counts.length) counts[idx]++;
          }
        }
        summary.distribution = counts.map((count, idx) => ({
          idx,
          label: opts[idx] ?? {},
          count,
        }));
      } else if (item.type === 'YES_NO') {
        let yes = 0;
        let no = 0;
        for (const a of answersForItem) {
          if (a.valueScale === 1) yes++;
          else if (a.valueScale === 0) no++;
        }
        summary.yes = yes;
        summary.no = no;
      } else if (item.type === 'LIKERT') {
        const values = answersForItem
          .map((a) => a.valueScale)
          .filter((v): v is number => v != null);
        const min = item.scaleMin ?? 1;
        const max = item.scaleMax ?? 5;
        const buckets: Record<number, number> = {};
        for (let i = min; i <= max; i++) buckets[i] = 0;
        for (const v of values) {
          if (v in buckets) buckets[v] = (buckets[v] ?? 0) + 1;
        }
        summary.average =
          values.length > 0
            ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100
            : null;
        summary.distribution = Object.entries(buckets).map(([k, count]) => ({
          value: Number(k),
          count,
        }));
      } else if (item.type === 'OPEN_TEXT') {
        summary.samples = answersForItem
          .map((a) => a.valueText)
          .filter((t): t is string => !!t && t.length > 0)
          .slice(0, 10);
      }

      return {
        itemId: item.id,
        prompt: item.prompt,
        type: item.type,
        summary,
      };
    });

    return {
      id: q.id,
      event: {
        id: q.event.id,
        slug: q.event.slug,
        title: q.event.title,
      },
      placement: q.placement,
      title: q.title,
      responseCount: q.responses.length,
      items: itemAggregates,
    };
  });

  return Response.json(
    { rows: out },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
