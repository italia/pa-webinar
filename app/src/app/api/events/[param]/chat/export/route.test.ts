// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
/**
 * Lo scaricamento della chat: stesse regole della lettura, i messaggi nascosti
 * restano nascosti, e nel file non finisce l'id di chi scrive, che per un ospite
 * deriva dall'indirizzo IP.
 */
import type { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, authorizeChatRead } = vi.hoisted(() => ({
  prisma: { event: { findUnique: vi.fn() }, chatMessage: { findMany: vi.fn() } },
  authorizeChatRead: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('@/lib/chat/read-access', () => ({ authorizeChatRead }));

import { encryptPII } from '@/lib/crypto/pii';
import { ForbiddenError } from '@/lib/errors';

import { GET } from './route';

function scarica(query = '', headers: Record<string, string> = {}) {
  const request = new Request(
    `http://localhost:3000/api/events/evento/chat/export${query}`,
    { headers }
  );
  return GET(request as unknown as NextRequest, {
    params: Promise.resolve({ param: 'evento' }),
  });
}

function messaggio(extra: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    senderId: 'guest-derivato-dall-indirizzo',
    senderName: encryptPII('Anna Bianchi'),
    isModerator: false,
    text: encryptPII('Buongiorno a tutti'),
    createdAt: new Date('2026-10-02T08:00:00Z'),
    editedAt: null,
    attachmentName: null,
    reactions: [],
    replyTo: null,
    ...extra,
  };
}

beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.APP_SECRET = 'segreto-di-prova-dell-esportazione-chat-lungo';
});

beforeEach(() => {
  vi.clearAllMocks();
  authorizeChatRead.mockResolvedValue({ eventId: 'ev-1' });
  prisma.event.findUnique.mockResolvedValue({
    slug: 'evento',
    startsAt: new Date('2026-10-02T08:00:00Z'),
    timezone: 'Europe/Rome',
  });
  prisma.chatMessage.findMany.mockResolvedValue([messaggio()]);
});

describe('esportazione della chat', () => {
  it('chi non puo’ leggere la chat non la scarica', async () => {
    authorizeChatRead.mockRejectedValue(new ForbiddenError());
    expect((await scarica()).status).toBe(403);
    expect(prisma.chatMessage.findMany).not.toHaveBeenCalled();
  });

  it('il controllo riceve il token di chi chiede', async () => {
    await scarica('', { authorization: 'Bearer token-del-moderatore' });
    expect(authorizeChatRead).toHaveBeenCalledWith('evento', 'token-del-moderatore');
  });

  it('i messaggi nascosti non si leggono, e c’e’ un tetto', async () => {
    await scarica();
    const query = prisma.chatMessage.findMany.mock.calls[0]![0] as {
      where: unknown;
      take: number;
    };
    expect(query.where).toEqual({ eventId: 'ev-1', hiddenAt: null });
    expect(query.take).toBe(5000);
  });

  it('il testo e’ in chiaro, con l’ora dell’evento e il ruolo', async () => {
    prisma.chatMessage.findMany.mockResolvedValue([
      messaggio({
        isModerator: true,
        attachmentName: 'slide.pdf',
        reactions: [{ emoji: '👍' }],
      }),
    ]);
    const r = await scarica();
    const testo = await r.text();
    expect(testo).toContain('Anna Bianchi (moderatore): Buongiorno a tutti');
    expect(testo).toContain('[allegato: slide.pdf]');
    expect(testo).toContain('👍1');
    expect(testo).toContain('10:00:00');
    expect(r.headers.get('content-type')).toContain('text/plain');
  });

  it('il file e’ un allegato che non resta in cache', async () => {
    const r = await scarica('?format=json');
    expect(r.headers.get('content-disposition')).toBe(
      'attachment; filename="chat-evento-2026-10-02.json"'
    );
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('content-type')).toContain('application/json');
  });

  it('nel file non c’e’ l’id di chi scrive, ma una chiave opaca', async () => {
    const r = await scarica('?format=json');
    const testo = await r.text();
    const corpo = JSON.parse(testo) as { messages: Array<{ senderKey: string }> };
    expect(testo).not.toContain('guest-derivato-dall-indirizzo');
    expect(corpo.messages[0]!.senderKey).toMatch(/^[0-9a-f]{16}$/);
  });

  it('la stessa persona ha chiavi diverse in eventi diversi', async () => {
    const chiave = async () =>
      (
        (await (await scarica('?format=json')).json()) as {
          messages: Array<{ senderKey: string }>;
        }
      ).messages[0]!.senderKey;
    const prima = await chiave();
    authorizeChatRead.mockResolvedValue({ eventId: 'ev-2' });
    expect(await chiave()).not.toBe(prima);
  });

  it('non si cita il nome di chi ha scritto un messaggio poi nascosto', async () => {
    prisma.chatMessage.findMany.mockResolvedValue([
      messaggio({
        replyTo: { senderName: encryptPII('Luca Verdi'), hiddenAt: new Date() },
      }),
      messaggio({
        id: 'm2',
        replyTo: { senderName: encryptPII('Sara Neri'), hiddenAt: null },
      }),
    ]);
    const corpo = (await (await scarica('?format=json')).json()) as {
      messages: Array<{ replyTo: string | null }>;
    };
    expect(corpo.messages.map((m) => m.replyTo)).toEqual([null, 'Sara Neri']);
  });

  it('i messaggi vecchi in chiaro restano leggibili, e un messaggio modificato lo dice', async () => {
    prisma.chatMessage.findMany.mockResolvedValue([
      messaggio({ text: 'testo in chiaro', editedAt: new Date('2026-10-02T08:05:00Z') }),
    ]);
    const testo = await (await scarica()).text();
    expect(testo).toContain('testo in chiaro');
    expect(testo).toContain('(modificato)');
  });

  it('un formato sconosciuto ricade sul testo', async () => {
    const r = await scarica('?format=exe');
    expect(r.headers.get('content-disposition')).toContain('.txt"');
  });
});
