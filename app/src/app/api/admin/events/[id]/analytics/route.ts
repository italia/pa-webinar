/**
 * GET /api/admin/events/[id]/analytics
 *
 * Post-event statistics for ANY event (recording optional). Composes the
 * existing aggregate recap (buildRecap) with:
 *   - attendance/conversion (Registration.joinedAt)
 *   - chat volume + authorship + moderator/audience split
 *   - an engagement TIMELINE (chat/Q&A/upvotes/polls/words bucketed over the
 *     call — "when interaction peaked")
 *   - a top-speakers leaderboard + talk-time balance (when a recording exists)
 *   - a composite ATTENTION score (participation proxy, admin-only)
 *
 * Per-person speaker stats are pseudonymous by default (Partecipante N).
 * All heavy per-row reads are capped; the endpoint is admin-gated.
 */
import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { statisticheEvento } from '@/lib/analytics/event-stats';
import { requireEventManager } from '@/lib/auth/staff-session';
import { NotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (_request, context) => {
  const { id } = await (context as { params: Promise<{ id: string }> }).params;
  // Di chi gestisce l'evento: l'admin, chi l'ha creato o un altro organizzatore (eventScope, ADR-014).
  await requireEventManager(await cookies(), id);
  const statistiche = await statisticheEvento(id);
  if (!statistiche) throw new NotFoundError('Event');
  return Response.json(statistiche);
});
