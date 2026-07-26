/**
 * Stato di una domanda in chat, deciso dal moderatore.
 *
 *   PATCH /chat/<messageId>/question   { status: 'ANSWERED' | 'DISMISSED' | null }
 *
 * Perché una rotta a parte e non un campo sulla PATCH esistente: quella è la
 * modifica del PROPRIO messaggio da parte dell'autore, con finestra di 15
 * minuti e regole di identità sue. Qui l'attore è il moderatore e l'oggetto è
 * lo stato della coda. Mescolarle avrebbe voluto dire cambiare il contratto di
 * una rotta già in uso — in questo progetto è il tipo di modifica che ha già
 * rotto percorsi funzionanti.
 *
 * "Scartata" NON è "nascosta": nascondere (DELETE) cancella l'allegato, toglie
 * il messaggio dalla conversazione per tutti ed esclude la riga da storia,
 * export e archivio. Scartare una domanda la lascia leggibile — chi l'ha
 * scritta continua a vedere il proprio messaggio — e la toglie solo dalle
 * domande ancora aperte.
 *
 * Solo role=MODERATOR: verifyModeratorToken esclude i relatori.
 */

import { NextResponse } from 'next/server';

import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { extractModeratorToken, verifyModeratorToken } from '@/lib/auth/moderator';
import { publishChat } from '@/lib/chat/pubsub';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { ForbiddenError, NotFoundError, RateLimitError, ValidationError } from '@/lib/errors';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const patchSchema = z.object({
  // null = riporta la domanda tra quelle aperte (il moderatore può sbagliare).
  status: z.enum(['ANSWERED', 'DISMISSED']).nullable(),
});

export const PATCH = withErrorHandling(async (request, context) => {
  const { param, messageId } = await context.params;
  if (!UUID_RE.test(messageId)) throw new NotFoundError('Message');

  const token = extractModeratorToken(request);
  if (!token) throw new ForbiddenError('Moderator token required');

  const event = await verifyModeratorToken(param, token);
  if (!event) throw new ForbiddenError('Invalid moderator token');

  // Stesso tetto delle altre azioni di moderazione: una coda di domande si
  // smaltisce a mano, non a raffica.
  const rl = rateLimit(`chat-question:${event.id}`, {
    limit: 60,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  const body = await parseJsonBody(request);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) throw new ValidationError('Invalid question status');

  const message = await prisma.chatMessage.findFirst({
    where: { id: messageId, eventId: event.id },
    select: {
      id: true,
      isQuestion: true,
      hiddenAt: true,
      answeredAt: true,
      dismissedAt: true,
      // Servono per riempire l'envelope con i valori VERI: vedi publishChat più
      // sotto, dove è spiegato perché un envelope "vuoto" è pericoloso.
      senderId: true,
      senderName: true,
      isModerator: true,
      text: true,
      createdAt: true,
    },
  });
  if (!message || message.hiddenAt) throw new NotFoundError('Message');
  if (!message.isQuestion) throw new ValidationError('Not a question');

  const { status } = parsed.data;
  // Idempotente: ri-segnare lo stesso stato non sposta il timestamp, così
  // l'ordine di ciò che è già stato evaso non cambia sotto gli occhi di chi legge.
  const answeredAt =
    status === 'ANSWERED' ? (message.answeredAt ?? new Date()) : null;
  const dismissedAt =
    status === 'DISMISSED' ? (message.dismissedAt ?? new Date()) : null;

  await prisma.chatMessage.update({
    where: { id: message.id },
    data: {
      answeredAt,
      dismissedAt,
      moderatedBy: status ? `mod-${event.id}` : null,
    },
  });

  // L'envelope porta i campi VERI del messaggio, non segnaposto vuoti.
  //
  // Il motivo è il rolling update. Un client della versione precedente non
  // riconosce `op:'question'` e cade su upsertMessage. Se il messaggio è nella
  // sua finestra la dedup per id lo scarta e non succede nulla; ma se è più
  // vecchio della finestra caricata (200 messaggi) la dedup NON scatta, il
  // messaggio viene accodato e — con `createdAt` a epoch 0 — porterebbe il
  // watermark del backfill al 1970, facendo ripescare al client l'inizio della
  // chat sotto ai messaggi recenti, con un'ondata di notifiche di menzione
  // vecchie di ore. Con i valori reali, il caso peggiore è una riga corretta
  // mostrata due volte fino al ricaricamento.
  void publishChat({
    id: message.id,
    eventId: event.id,
    senderId: message.senderId,
    senderName: tryDecryptPII(message.senderName) ?? message.senderName,
    isModerator: message.isModerator,
    text: tryDecryptPII(message.text) ?? message.text,
    createdAt: message.createdAt.toISOString(),
    isQuestion: true,
    answeredAt: answeredAt ? answeredAt.toISOString() : null,
    dismissedAt: dismissedAt ? dismissedAt.toISOString() : null,
    op: 'question',
  });

  return NextResponse.json({
    answeredAt: answeredAt ? answeredAt.toISOString() : null,
    dismissedAt: dismissedAt ? dismissedAt.toISOString() : null,
  });
});
