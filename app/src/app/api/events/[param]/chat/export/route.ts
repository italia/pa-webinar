/**
 * GET /chat/export?format=txt|json — download the chat of an event.
 *
 * "pulsante per esportare la chat, visto che quando termina l'evento verrà
 * persa": the messages are in fact persisted, but there was no way to take them
 * with you, so from a participant's point of view they may as well have been
 * gone. Useful to the people who were there, and to the internal processes that
 * feed the AI pipeline.
 *
 * Authorization is exactly the chat's own read gate — no new exposure: whoever
 * may fetch the history through `GET /chat` may download the same messages here.
 * A moderator keeps access after the event; an anonymous visitor gets neither.
 *
 * Hidden messages stay hidden. They are kept in the archive for compliance, not
 * for redistribution, and a moderator hid them for a reason.
 */

import { withErrorHandling } from '@/lib/api-handler';
import { extractModeratorToken } from '@/lib/auth/moderator';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { authorizeChatRead } from '@/lib/chat/read-access';
import { tallyReactions } from '@/lib/chat/emoji';
import { senderColourKey } from '@/lib/chat/sender-key';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Plenty for a webinar, and a hard stop so one request cannot stream a whole
 *  database into memory. */
const MAX_MESSAGES = 5000;

export const GET = withErrorHandling(async (request, context) => {
  const { param } = await context.params;
  const format = new URL(request.url).searchParams.get('format') === 'json' ? 'json' : 'txt';

  const { eventId } = await authorizeChatRead(param, extractModeratorToken(request));

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { slug: true, startsAt: true, timezone: true },
  });

  const rows = await prisma.chatMessage.findMany({
    where: { eventId, hiddenAt: null },
    orderBy: { createdAt: 'asc' },
    take: MAX_MESSAGES,
    select: {
      id: true,
      senderId: true,
      senderName: true,
      isModerator: true,
      text: true,
      createdAt: true,
      editedAt: true,
      attachmentName: true,
      reactions: { select: { emoji: true } },
      replyTo: { select: { senderName: true, hiddenAt: true } },
    },
  });

  const messages = rows.map((m) => ({
    id: m.id,
    at: m.createdAt.toISOString(),
    // Names and text are encrypted at rest; tryDecryptPII also passes through
    // the legacy plaintext rows unchanged.
    from: tryDecryptPII(m.senderName) ?? m.senderName,
    // Chiave opaca, non l'id: quello degli ospiti decodifica nell'IP pubblico,
    // e questo è un file che viene scaricato e girato.
    senderKey: senderColourKey(m.senderId),
    isModerator: m.isModerator,
    text: tryDecryptPII(m.text) ?? m.text,
    edited: m.editedAt ? m.editedAt.toISOString() : null,
    attachment: m.attachmentName,
    replyTo:
      m.replyTo && !m.replyTo.hiddenAt
        ? tryDecryptPII(m.replyTo.senderName) ?? m.replyTo.senderName
        : null,
    reactions: tallyReactions(m.reactions),
  }));

  const stamp = (event?.startsAt ?? new Date()).toISOString().slice(0, 10);
  const filename = `chat-${event?.slug ?? 'evento'}-${stamp}.${format}`;

  const body =
    format === 'json'
      ? JSON.stringify(
          { event: event?.slug, exportedAt: new Date().toISOString(), messages },
          null,
          2,
        )
      : messages
          .map((m) => {
            const time = new Date(m.at).toLocaleString('it-IT', {
              timeZone: event?.timezone ?? 'Europe/Rome',
            });
            const marks = [
              m.edited ? '(modificato)' : '',
              m.attachment ? `[allegato: ${m.attachment}]` : '',
              Object.entries(m.reactions)
                .map(([e, n]) => `${e}${n}`)
                .join(' '),
            ]
              .filter(Boolean)
              .join(' ');
            return `[${time}] ${m.from}${m.isModerator ? ' (moderatore)' : ''}: ${m.text}${
              marks ? ` ${marks}` : ''
            }`;
          })
          .join('\n');

  return new Response(body, {
    headers: {
      'Content-Type':
        format === 'json' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
});
