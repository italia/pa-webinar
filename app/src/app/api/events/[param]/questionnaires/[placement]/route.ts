/**
 * Public endpoint to render a questionnaire configured for an event.
 *
 * Returns the rendered structure (templates' items in link order, then
 * ad-hoc items in sortOrder) for the client to build the form. Does not
 * leak respondent answers — see .../responses for that.
 *
 * Accepts both event UUID and slug in the path param (mirrors the
 * existing /api/events/[param] convention).
 */

import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError } from '@/lib/errors';
import { findEventQuestionnaireByPlacement } from '@/lib/questionnaires';
import { QUESTIONNAIRE_PLACEMENTS } from '@/lib/validation/schemas';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withErrorHandling(async (_request, context) => {
  const { param, placement: rawPlacement } = await context.params;
  if (!(QUESTIONNAIRE_PLACEMENTS as readonly string[]).includes(rawPlacement)) {
    throw new AppError(
      `placement must be one of: ${QUESTIONNAIRE_PLACEMENTS.join(', ')}`,
      400,
      'BAD_REQUEST',
    );
  }
  const placement = rawPlacement as (typeof QUESTIONNAIRE_PLACEMENTS)[number];

  const event = await prisma.event.findUnique({
    where: UUID_RE.test(param) ? { id: param } : { slug: param },
    select: { id: true },
  });
  if (!event) throw new NotFoundError('Event');

  const q = await findEventQuestionnaireByPlacement(event.id, placement);
  if (!q) throw new NotFoundError('EventQuestionnaire');

  return Response.json(
    {
      id: q.id,
      placement: q.placement,
      title: q.title,
      description: q.description,
      required: q.required,
      allowEdit: q.allowEdit,
      items: q.items,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
