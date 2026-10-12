/**
 * POST /api/events/[param]/chat/typing — «sto scrivendo».
 *
 * Il client lo chiama mentre chi partecipa compone un messaggio, al più ogni
 * `TYPING_PING_MS` (lib/chat/typing). Il mittente si riconosce con le STESSE
 * regole dell'invio di un messaggio (`authenticateChatSender`: token di grant o
 * di registrazione per questo evento, oppure ospite con un nome nella finestra
 * in cui la sala è aperta agli ospiti), così chi non può scrivere in chat non
 * può nemmeno risultare «sta scrivendo».
 *
 * Corpo JSON (anche `{}` per chi ha un token), con gli stessi campi d'identità
 * della POST di un messaggio:
 *   - `guestName`: il nome dell'ospite senza token;
 *   - `displayNameOverride`: il nome dichiarato sul link primario condiviso del
 *     moderatore (ignorato per le identità nominali, come per i messaggi).
 *
 * Risponde 204 senza corpo e non scrive nulla nel database: è un segnale
 * effimero, pubblicato sul canale `chat-typing:<eventId>` e consegnato dallo
 * stream della chat come `event: typing` con la chiave opaca e il nome del
 * mittente, mai il suo id.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { parseJsonBody, withErrorHandling } from '@/lib/api-handler';
import { extractModeratorToken } from '@/lib/auth/moderator';
import { authenticateChatSender } from '@/lib/chat/authenticate';
import { senderColourKey } from '@/lib/chat/sender-key';
import { publishTyping } from '@/lib/chat/typing-pubsub';
import { RateLimitError, ValidationError } from '@/lib/errors';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/** Il corpo porta al più due nomi: un limite stretto evita di leggere in
 *  memoria corpi grandi a ogni battuta di tastiera. */
const TYPING_BODY_MAX_BYTES = 2048;

/** Per mittente: un avviso ogni 3 s fa 20 al minuto; il margine copre il link
 *  primario condiviso, dove più moderatori hanno lo stesso posto. */
const TYPING_PER_SENDER_LIMIT = 40;

/**
 * Per evento, per processo: oltre questa soglia l'avviso si accetta e non si
 * pubblica. Ogni avviso raggiunge ogni lettore della sala, quindi il traffico
 * cresce col quadrato delle persone; da tre persone in su l'indicatore dice
 * comunque solo «più persone stanno scrivendo», e dieci avvisi al secondo
 * bastano a mostrarlo.
 */
const TYPING_PER_EVENT_PER_SECOND = 10;

const typingSchema = z.object({
  guestName: z.string().trim().min(1).max(80).optional(),
  displayNameOverride: z.string().trim().min(1).max(80).optional(),
});

export const POST = withErrorHandling(async (request, context) => {
  const { param } = await context.params;
  const token = extractModeratorToken(request);

  const body = await parseJsonBody(request, TYPING_BODY_MAX_BYTES);
  const parsed = typingSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }

  const auth = await authenticateChatSender(
    param,
    token,
    parsed.data.guestName,
    parsed.data.displayNameOverride,
    request,
  );

  const rl = rateLimit(`chat-typing:${auth.eventId}:${auth.senderId}`, {
    limit: TYPING_PER_SENDER_LIMIT,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  // Oltre il tetto per evento non si risponde con un errore: chi scrive non ha
  // fatto nulla di sbagliato, e l'indicatore in sala resta comunque acceso dagli
  // avvisi che passano.
  const budget = rateLimit(`chat-typing-event:${auth.eventId}`, {
    limit: TYPING_PER_EVENT_PER_SECOND,
    windowMs: 1000,
  });
  if (budget.allowed) {
    // Senza attesa: nessuna risposta dipende dal fan-out, e senza Redis la
    // pubblicazione non fa nulla.
    void publishTyping({
      eventId: auth.eventId,
      senderKey: senderColourKey(auth.senderId),
      senderName: auth.senderName,
    });
  }

  return new NextResponse(null, { status: 204 });
});
