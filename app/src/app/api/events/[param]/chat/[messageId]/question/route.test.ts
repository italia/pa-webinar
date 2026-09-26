import { createHash } from 'crypto';

import type { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Lo stato di una domanda passa sullo stream SSE a TUTTA la sala, ospiti senza
 * token compresi. L'envelope porta i campi veri del messaggio (vedi la rotta):
 * fra questi c'era l'id grezzo dell'autore, che per un ospite è il base64 di
 * `ip:nome`. Qui si verifica che non esca più, né in chiaro né in forma
 * ricostruibile per enumerazione.
 */
vi.mock('@/lib/db', () => ({
  prisma: {
    chatMessage: { findFirst: vi.fn(), update: vi.fn() },
  },
}));
vi.mock('@/lib/crypto/pii', () => ({ tryDecryptPII: (v: string) => v }));
vi.mock('@/lib/chat/pubsub', () => ({ publishChat: vi.fn() }));
vi.mock('@/lib/auth/moderator', () => ({
  extractModeratorToken: (req: Request) =>
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null,
  verifyModeratorToken: vi.fn(),
}));

import { prisma } from '@/lib/db';
import { publishChat } from '@/lib/chat/pubsub';
import { senderColourKey } from '@/lib/chat/sender-key';
import { verifyModeratorToken } from '@/lib/auth/moderator';

import { PATCH } from './route';

const mockedFind = prisma.chatMessage.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedUpdate = prisma.chatMessage.update as unknown as ReturnType<typeof vi.fn>;
const mockedPublish = publishChat as unknown as ReturnType<typeof vi.fn>;
const mockedVerify = verifyModeratorToken as unknown as ReturnType<typeof vi.fn>;

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const MESSAGE_ID = '22222222-2222-4222-8222-222222222222';
const GUEST_IP = '203.0.113.7';
const GUEST_SENDER_ID = `guest-${Buffer.from(`${GUEST_IP}:Anna`)
  .toString('base64url')
  .slice(0, 24)}`;

function patchRequest(status: 'ANSWERED' | 'DISMISSED' | null): NextRequest {
  return new Request(
    `https://webinar.gov.it/api/events/evento/chat/${MESSAGE_ID}/question`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: 'Bearer MOD' },
      body: JSON.stringify({ status }),
    },
  ) as unknown as NextRequest;
}

const ctx = { params: Promise.resolve({ param: 'evento', messageId: MESSAGE_ID }) };

const previousSecret = process.env.APP_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.APP_SECRET = 'segreto-di-prova-lungo-almeno-trentadue-byte';
  mockedVerify.mockResolvedValue({ id: EVENT_ID });
  mockedUpdate.mockResolvedValue({});
  mockedFind.mockResolvedValue({
    id: MESSAGE_ID,
    isQuestion: true,
    hiddenAt: null,
    answeredAt: null,
    dismissedAt: null,
    senderId: GUEST_SENDER_ID,
    senderName: 'Anna',
    isModerator: false,
    text: 'Quando esce la registrazione?',
    createdAt: new Date('2026-07-22T10:00:00.000Z'),
  });
});

afterEach(() => {
  if (previousSecret === undefined) delete process.env.APP_SECRET;
  else process.env.APP_SECRET = previousSecret;
});

describe('PATCH /chat/[messageId]/question — published envelope', () => {
  it("does not hand a guest's IP to the room when a moderator answers the question", async () => {
    const res = await PATCH(patchRequest('ANSWERED'), ctx);
    expect(res.status).toBe(200);
    expect(mockedPublish).toHaveBeenCalledTimes(1);

    const envelope = mockedPublish.mock.calls[0]![0] as Record<string, unknown>;
    const payload = JSON.stringify(envelope);
    expect(envelope.op).toBe('question');
    expect(envelope).not.toHaveProperty('senderId');
    expect(payload).not.toContain(GUEST_SENDER_ID);
    expect(payload).not.toContain(GUEST_IP);
    expect(envelope.senderKey).toBe(senderColourKey(GUEST_SENDER_ID));

    // La chiave è un HMAC: chi conosce il nome visibile e prova tutti gli IP
    // non la ritrova con uno SHA-256 non firmato dell'id.
    const unkeyed = createHash('sha256').update(GUEST_SENDER_ID).digest('hex').slice(0, 16);
    expect(envelope.senderKey).not.toBe(unkeyed);
  });
});
