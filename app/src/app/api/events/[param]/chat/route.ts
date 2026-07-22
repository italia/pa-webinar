/**
 * In-app chat endpoints for live events.
 *
 *   GET  /chat[?since=<iso>&limit=<n>]  →  paginated history (most
 *       recent first). Useful on (a) mount — rehydrate the panel with
 *       what happened so far — and (b) post-event — archive view in
 *       the moderator UI.
 *
 *   POST /chat                           →  submit a new message.
 *       Auth: participant accessToken OR moderator token OR guest.
 *       Tokenless guests are admitted on any LIVE event, and — only for
 *       INSTANT calls (open-by-link, no scheduled gate) — also during
 *       the bridge warm-up (PROVISIONING/IDLE) so the waiting room chat
 *       works while the JVB spins up. Scheduled/password events never
 *       admit tokenless guests outside LIVE (a stranger can flip
 *       PUBLISHED→PROVISIONING via the unauthenticated /wake otherwise).
 *       Guest sender-name comes from the body (untrusted, same risk
 *       profile as Jitsi pre-join display-name). Message is persisted to
 *       Postgres and published on Redis for real-time fan-out to SSE
 *       subscribers on any pod.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import {
  ForbiddenError,
  RateLimitError,
  ValidationError,
} from '@/lib/errors';
import { extractModeratorToken } from '@/lib/auth/moderator';
import { encryptPII, tryDecryptPII } from '@/lib/crypto/pii';
import {
  publishChat,
  type ChatReplyRef,
  type ChatAttachmentRef,
} from '@/lib/chat/pubsub';
import { authenticateChatSender } from '@/lib/chat/authenticate';
import { tallyReactions } from '@/lib/chat/emoji';
import { senderColourKey } from '@/lib/chat/sender-key';
import { authorizeChatRead } from '@/lib/chat/read-access';
import {
  CHAT_ATTACHMENT_MIME,
  CHAT_ATTACHMENT_MAX_BYTES,
  attachmentRefFromRow,
  assetUrlFromKey,
} from '@/lib/chat/attachments';
import {
  verifyChatAttachmentToken,
  type ChatAttachmentClaims,
} from '@/lib/chat/attachment-token';
import { chatMessagesTotal } from '@/lib/metrics';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';


const HISTORY_DEFAULT_LIMIT = 100;
const HISTORY_MAX_LIMIT = 500;
const MESSAGE_MAX_LENGTH = 2000;

const REPLY_SNIPPET_MAX = 140;

const postSchema = z
  .object({
    // May be empty when an attachment is present (see refine below).
    text: z.string().trim().max(MESSAGE_MAX_LENGTH).default(''),
    // Provided by guests only — participants and moderators derive the
    // name from their token lookup. Ignored for those branches.
    guestName: z.string().trim().min(1).max(80).optional(),
    // Self-asserted display name for a moderator on the SHARED primary link,
    // where the server has no per-person name. Honoured ONLY for that grant
    // (per-row co-moderators/speakers keep their authoritative decrypted name).
    // Mirrors the JWT displayName override already used for the video identity.
    displayNameOverride: z.string().trim().min(1).max(80).optional(),
    // Optional single attachment, referenced by the SIGNED token minted by the
    // upload route (never a client URL/metadata — that would let a member point
    // at an arbitrary blob or spoof mime/size). Authenticated members only.
    attachmentToken: z.string().min(1).max(4000).optional(),
    // Optional reply to an earlier message in the same event.
    replyToId: z.string().uuid().optional(),
  })
  .refine((d) => d.text.length > 0 || d.attachmentToken !== undefined, {
    message: 'empty message',
    path: ['text'],
  });

export const GET = withErrorHandling(async (request, context) => {
  const { param } = await context.params;
  const url = new URL(request.url);
  const since = url.searchParams.get('since');
  const limit = Math.min(
    parseInt(url.searchParams.get('limit') ?? String(HISTORY_DEFAULT_LIMIT), 10),
    HISTORY_MAX_LIMIT,
  );

  // History is PII (names + free text) and was world-readable for any event in
  // any status. Readers now clear the same bar as writers — see read-access.
  const { eventId, senderId: callerId, isPerPersonIdentity } = await authorizeChatRead(
    param,
    extractModeratorToken(request),
  );

  const rows = await prisma.chatMessage.findMany({
    where: {
      eventId,
      hiddenAt: null,
      ...(since && { createdAt: { gt: new Date(since) } }),
    },
    orderBy: { createdAt: since ? 'asc' : 'desc' },
    take: limit,
    select: {
      id: true,
      senderId: true,
      senderName: true,
      isModerator: true,
      text: true,
      createdAt: true,
      attachmentBlobPath: true,
      attachmentName: true,
      attachmentMime: true,
      attachmentSize: true,
      editedAt: true,
      reactions: { select: { emoji: true, senderId: true } },
      replyToId: true,
      replyTo: {
        select: {
          id: true,
          senderName: true,
          text: true,
          hiddenAt: true,
          attachmentBlobPath: true,
        },
      },
    },
  });

  // When no `since` is passed the client wants the most recent N —
  // we queried desc for that, but the UI renders oldest-first so we
  // reverse here. With `since` we already queried asc (incremental
  // catch-up) so the order is already correct.
  const ordered = since ? rows : rows.slice().reverse();

  return NextResponse.json({
    messages: ordered.map((m) => {
      // A reply whose parent was hidden/removed degrades to no quote.
      const replyTo: ChatReplyRef | undefined =
        m.replyTo && !m.replyTo.hiddenAt
          ? {
              id: m.replyTo.id,
              senderName: tryDecryptPII(m.replyTo.senderName) ?? m.replyTo.senderName,
              text:
                (tryDecryptPII(m.replyTo.text) ?? m.replyTo.text).slice(
                  0,
                  REPLY_SNIPPET_MAX,
                ) || (m.replyTo.attachmentBlobPath ? '📎' : ''),
            }
          : undefined;
      const mineReactions = callerId
        ? m.reactions.filter((r) => r.senderId === callerId).map((r) => r.emoji)
        : [];
      return {
        id: m.id,
        // NOT the raw senderId: a guest one is base64 of `ip:name` and decodes
        // straight back to the attendee's public IP. The client only ever used
        // it to pick a bubble colour, so it gets a one-way key instead.
        senderKey: senderColourKey(m.senderId),
        // Whether the CALLER may act on this message. Computed here because the
        // client cannot: a seat id is shared by several people, so comparing ids
        // (or names) client-side got it wrong in both directions.
        mine: !!callerId && m.senderId === callerId,
        canEdit: !!callerId && m.senderId === callerId && isPerPersonIdentity,
        myReactions: mineReactions,
        // senderName + text are encrypted at rest (see schema comment).
        // tryDecryptPII falls back to the input string for legacy
        // plaintext rows, so this is safe across the migration boundary.
        senderName: tryDecryptPII(m.senderName) ?? m.senderName,
        isModerator: m.isModerator,
        text: tryDecryptPII(m.text) ?? m.text,
        createdAt: m.createdAt.toISOString(),
        editedAt: m.editedAt ? m.editedAt.toISOString() : null,
        // Tallies travel with the history so a late joiner sees the same counts
        // a live client has been accumulating from the stream.
        reactions: tallyReactions(m.reactions),
        attachment: attachmentRefFromRow(m),
        ...(replyTo ? { replyTo } : {}),
      };
    }),
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
});

export const POST = withErrorHandling(async (request, context) => {
  const { param } = await context.params;
  const token = extractModeratorToken(request);

  const body = await parseJsonBody(request);
  const parsed = postSchema.safeParse(body);
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

  // Per-sender rate limit: keep chat flowing for a normal speaker
  // (~1 message/sec bursts) but prevent spam / accidental paste loops.
  const rl = rateLimit(`chat:${auth.eventId}:${auth.senderId}`, {
    limit: 30,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  // Attachments: authenticated members only (never tokenless guests). The token
  // is a signed capability minted by the upload route — verifying it proves the
  // blob key/mime/size/name belong to a file THIS sender just uploaded for THIS
  // event, so nothing here is client-controlled (no arbitrary blob reference, no
  // spoofed metadata). We still re-check mime/size against the policy in case the
  // allow-list tightened since the token was issued.
  let attachmentClaims: ChatAttachmentClaims | null = null;
  if (parsed.data.attachmentToken) {
    if (auth.senderId.startsWith('guest-')) {
      throw new ForbiddenError('Guests cannot attach files');
    }
    attachmentClaims = verifyChatAttachmentToken(parsed.data.attachmentToken, {
      eventId: auth.eventId,
      senderId: auth.senderId,
    });
    if (
      !attachmentClaims ||
      !CHAT_ATTACHMENT_MIME.has(attachmentClaims.mime) ||
      attachmentClaims.size > CHAT_ATTACHMENT_MAX_BYTES
    ) {
      throw new ValidationError('Invalid attachment', [
        { path: ['attachmentToken'], message: 'expired, tampered, or unsupported attachment' },
      ]);
    }
  }

  // Reply: the parent must exist, belong to THIS event, and not be hidden.
  // A missing/foreign/hidden parent is dropped (message still posts, no reply).
  let replyRef: ChatReplyRef | undefined;
  let replyToId: string | null = null;
  if (parsed.data.replyToId) {
    const parent = await prisma.chatMessage.findFirst({
      where: { id: parsed.data.replyToId, eventId: auth.eventId, hiddenAt: null },
      select: { id: true, senderName: true, text: true, attachmentBlobPath: true },
    });
    if (parent) {
      replyToId = parent.id;
      const parentText = (tryDecryptPII(parent.text) ?? parent.text).slice(
        0,
        REPLY_SNIPPET_MAX,
      );
      replyRef = {
        id: parent.id,
        senderName: tryDecryptPII(parent.senderName) ?? parent.senderName,
        // An attachment-only parent has no text: quote a paperclip glyph instead
        // of a blank line (matches the client compose bar).
        text: parentText || (parent.attachmentBlobPath ? '📎' : ''),
      };
    }
  }

  // Encrypt PII fields at rest. senderName, text and the attachment filename
  // are the PII-bearing columns; everything else (senderId, eventId,
  // isModerator, mime, size, blobPath) is non-PII metadata. We keep plaintext
  // in local vars so the Redis envelope below stays human-readable without an
  // extra decrypt on the fan-out hot path.
  const plaintextSenderName = auth.senderName;
  const plaintextText = parsed.data.text;

  const created = await prisma.chatMessage.create({
    data: {
      eventId: auth.eventId,
      senderId: auth.senderId,
      senderName: encryptPII(plaintextSenderName),
      isModerator: auth.isModerator,
      text: encryptPII(plaintextText),
      replyToId,
      ...(attachmentClaims
        ? {
            attachmentBlobPath: attachmentClaims.key,
            attachmentName: encryptPII(attachmentClaims.name),
            attachmentMime: attachmentClaims.mime,
            attachmentSize: BigInt(attachmentClaims.size),
          }
        : {}),
    },
  });
  chatMessagesTotal.inc({ event_id: auth.eventId });

  // Fan out the server-derived URL (assetUrlFromKey of the signed key), NOT any
  // client value — a live subscriber must never be handed an off-origin URL.
  const attachmentRef: ChatAttachmentRef | undefined = attachmentClaims
    ? {
        url: assetUrlFromKey(attachmentClaims.key),
        name: attachmentClaims.name,
        mime: attachmentClaims.mime,
        size: attachmentClaims.size,
      }
    : undefined;

  // Fire-and-forget Redis fan-out — persistence is already done, and
  // pubsub failure is survivable (clients fall back to GET /history
  // polling on reconnect). Redis carries plaintext (encryption is
  // at-rest only); SSE subscribers re-emit verbatim to clients.
  void publishChat({
    id: created.id,
    eventId: created.eventId,
    senderId: created.senderId,
    senderName: plaintextSenderName,
    isModerator: created.isModerator,
    text: plaintextText,
    createdAt: created.createdAt.toISOString(),
    ...(attachmentRef ? { attachment: attachmentRef } : {}),
    ...(replyRef ? { replyTo: replyRef } : {}),
  });

  return NextResponse.json({
    id: created.id,
    createdAt: created.createdAt.toISOString(),
    // The caller's own seat id. The panel has no other way to tell which
    // messages are really its own: comparing display names is wrong whenever two
    // people share one (two moderators on the shared link are both "Moderatore"),
    // and that comparison is what decides whether the edit affordance appears.
    senderKey: senderColourKey(auth.senderId),
    // Whether this identity may edit its own messages at all — a shared link
    // cannot, so the UI should not offer it (the server refuses anyway).
    canEdit: auth.isPerPersonIdentity,
  }, { status: 201 });
});
