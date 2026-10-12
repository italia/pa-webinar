/**
 * Il moderatore nasconde un messaggio della chat: cosa finisce nella
 * cronologia della sala. La correzione del proprio messaggio da parte
 * dell'autore non e' un'azione di conduzione e non si registra.
 */
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    chatMessage: { findFirst: vi.fn(), update: vi.fn() },
  },
}));
vi.mock('@/lib/crypto/pii', () => ({ encryptPII: (v: string) => v }));
vi.mock('@/lib/chat/pubsub', () => ({ publishChat: vi.fn() }));
vi.mock('@/lib/storage', () => ({ getFilesStorage: () => null }));
vi.mock('@/lib/chat/authenticate', () => ({ authenticateChatSender: vi.fn() }));
vi.mock('@/lib/auth/moderator', () => ({
  extractModeratorToken: (req: Request) =>
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null,
  verifyModeratorToken: vi.fn(),
}));
vi.mock('@/lib/live/actions', () => ({ recordLiveAction: vi.fn(), recordLiveActions: vi.fn() }));

import { prisma } from '@/lib/db';
import { authenticateChatSender } from '@/lib/chat/authenticate';
import { verifyModeratorToken } from '@/lib/auth/moderator';
import { recordLiveAction } from '@/lib/live/actions';

import { DELETE, PATCH } from './route';

const mockedFind = prisma.chatMessage.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedUpdate = prisma.chatMessage.update as unknown as ReturnType<typeof vi.fn>;
const mockedVerify = verifyModeratorToken as unknown as ReturnType<typeof vi.fn>;
const mockedAuth = authenticateChatSender as unknown as ReturnType<typeof vi.fn>;

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const MESSAGE_ID = '22222222-2222-4222-8222-222222222222';

const ctx = { params: Promise.resolve({ param: 'evento', messageId: MESSAGE_ID }) };
const url = `https://webinar.gov.it/api/events/evento/chat/${MESSAGE_ID}`;
const del = (token = 'MOD') =>
  new Request(url, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  }) as unknown as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  mockedVerify.mockImplementation(async (_slug: string, token: string) =>
    token === 'MOD' ? { id: EVENT_ID } : null,
  );
  mockedUpdate.mockResolvedValue({});
  mockedFind.mockResolvedValue({ id: MESSAGE_ID, hiddenAt: null, attachmentBlobPath: null });
});

describe('DELETE /chat/[messageId] — cronologia della sala', () => {
  it('nascondere un messaggio registra solo il suo id', async () => {
    const res = await DELETE(del(), ctx);
    expect(res.status).toBe(200);
    expect(mockedUpdate).toHaveBeenCalledTimes(1);
    expect(recordLiveAction).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      kind: 'chat.hidden',
      actor: 'moderator',
      data: { messageId: MESSAGE_ID },
    });
  });

  it('un messaggio gia’ nascosto non si registra di nuovo', async () => {
    mockedFind.mockResolvedValue({
      id: MESSAGE_ID,
      hiddenAt: new Date('2026-10-01T10:00:00.000Z'),
      attachmentBlobPath: null,
    });
    const res = await DELETE(del(), ctx);
    expect(res.status).toBe(200);
    expect(recordLiveAction).not.toHaveBeenCalled();
  });

  it('senza moderazione, o su un messaggio inesistente: niente', async () => {
    expect((await DELETE(del('ALTRO'), ctx)).status).toBe(403);
    mockedFind.mockResolvedValue(null);
    expect((await DELETE(del(), ctx)).status).toBe(404);
    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(recordLiveAction).not.toHaveBeenCalled();
  });
});

describe('PATCH /chat/[messageId] — la correzione dell’autore', () => {
  it('non finisce nella cronologia', async () => {
    mockedAuth.mockResolvedValue({
      eventId: EVENT_ID,
      senderId: 'reg-1',
      senderName: 'Partecipante',
      isModerator: false,
      isPerPersonIdentity: true,
    });
    mockedFind.mockResolvedValue({ id: MESSAGE_ID, senderId: 'reg-1', createdAt: new Date() });
    const res = await PATCH(
      new Request(url, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Corretto' }),
      }) as unknown as NextRequest,
      ctx,
    );
    expect(res.status).toBe(200);
    expect(recordLiveAction).not.toHaveBeenCalled();
  });
});
