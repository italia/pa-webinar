/**
 * GET /api/admin/events/[id]/room-review — cio' che la revisione della sala
 * non trova nelle rotte della sala: tutte le domande segnate in chat (non
 * solo quelle fra gli ultimi messaggi) e le parole di ogni giro di «In una
 * parola» (la sala legge solo l'ultimo). Sono le stesse cose che contano nel
 * riepilogo pubblico e nella lista «Chiudi l'evento».
 *
 * Chi: l'amministrazione e chi organizza l'evento (sessione dello staff),
 * oppure chi lo modera, con il proprio token in `Authorization: Bearer`.
 */

import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { extractModeratorToken, isEventModeratorCached } from '@/lib/auth/moderator';
import { requireEventManager } from '@/lib/auth/staff-session';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { isUuid } from '@/lib/events/event-param';
import { countWordsByPerson } from '@/lib/wordcloud/normalize';

export const dynamic = 'force-dynamic';

/** Un tetto alle domande restituite: nessuna sala reale ne segna tante. */
const DOMANDE_MAX = 1000;

export const GET = withErrorHandling(async (request, context) => {
  const { id } = (await context.params) as { id: string };
  if (!isUuid(id)) throw new AppError('id must be a UUID', 400, 'BAD_REQUEST');
  const token = extractModeratorToken(request);
  const event = token
    ? await prisma.event.findUnique({
        where: { id },
        select: { id: true, moderatorToken: true },
      })
    : null;
  if (!(event && token && (await isEventModeratorCached(event, token)))) {
    await requireEventManager(await cookies(), id);
  }

  const campi = {
    id: true,
    senderName: true,
    text: true,
    createdAt: true,
    answeredAt: true,
    dismissedAt: true,
  } as const;
  const domanda = { eventId: id, isQuestion: true, hiddenAt: null };
  const [aperte, chiuse, giri] = await Promise.all([
    // Prima le domande ancora aperte (sono quelle che la lista «Chiudi
    // l'evento» conta), poi le chiuse piu' recenti, fino al tetto: oltre si
    // dice che ce ne sono altre.
    prisma.chatMessage.findMany({
      where: { ...domanda, answeredAt: null, dismissedAt: null },
      orderBy: { createdAt: 'asc' },
      take: DOMANDE_MAX + 1,
      select: campi,
    }),
    prisma.chatMessage.findMany({
      where: {
        ...domanda,
        OR: [{ answeredAt: { not: null } }, { dismissedAt: { not: null } }],
      },
      orderBy: { createdAt: 'desc' },
      take: DOMANDE_MAX + 1,
      select: campi,
    }),
    prisma.wordCloudRound.findMany({
      where: { eventId: id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        prompt: true,
        createdAt: true,
        submissions: {
          where: { hiddenAt: null },
          select: { word: true, registrationId: true, guestId: true },
        },
      },
    }),
  ]);

  // Le aperte per prime; delle chiuse, le piu' recenti che stanno nel tetto,
  // in ordine di tempo.
  const aperteMostrate = aperte.slice(0, DOMANDE_MAX);
  const chiuseMostrate = chiuse.slice(0, DOMANDE_MAX - aperteMostrate.length).reverse();

  return Response.json(
    {
      domandeTroncate: aperte.length + chiuse.length > DOMANDE_MAX,
      domandeChat: [...aperteMostrate, ...chiuseMostrate].map((m) => ({
        id: m.id,
        senderName: tryDecryptPII(m.senderName) ?? m.senderName,
        text: tryDecryptPII(m.text) ?? m.text,
        createdAt: m.createdAt.toISOString(),
        answeredAt: m.answeredAt?.toISOString() ?? null,
        dismissedAt: m.dismissedAt?.toISOString() ?? null,
      })),
      giri: giri.map((g) => ({
        id: g.id,
        prompt: g.prompt,
        createdAt: g.createdAt.toISOString(),
        words: countWordsByPerson(g.submissions),
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
});
