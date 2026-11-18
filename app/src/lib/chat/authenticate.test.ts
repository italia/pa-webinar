// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Chi scrive in chat: il ramo con il token passa da resolveTokenSender, il ramo
 * ospite sta qui. Con il pubblico anonimo l'ospite scrive con lo pseudonimo del
 * suo posto, lo stesso del video, mai con il nome dato in sala d'attesa.
 */
const { db, sender } = vi.hoisted(() => ({
  db: { event: { findUnique: vi.fn() } },
  sender: { resolveTokenSender: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/chat/sender', () => sender);
vi.mock('@/lib/settings', () => ({
  getSettings: async () => ({ guestAccessEnabled: true }),
}));
vi.mock('@/lib/live/pseudonym', () => ({
  pseudonimo: vi.fn(async (_evento: string, posto: string) => `Pseudo ${posto}`),
}));
vi.mock('@/lib/chat/sender-key', () => ({
  guestSenderId: (ip: string, nome: string) => `guest-${ip}-${nome}`,
}));
vi.mock('@/lib/rate-limit', () => ({ getClientIp: () => '203.0.113.9' }));
const nick = vi.hoisted(() => ({ presi: new Set<string>() }));
vi.mock('@/lib/live/nickname', () => ({
  nicknameDellOspite: vi.fn(async (_e: string, nome: string, chiave: string) =>
    nick.presi.has(`${nome}|${chiave}`)
  ),
}));

import {
  assertChatOpen,
  authenticateChatSender,
  type ChatAuthResult,
} from './authenticate';

const EVENT_ID = '44444444-4444-4444-8444-444444444444';
const evento = (over: Record<string, unknown> = {}) => ({
  id: EVENT_ID,
  status: 'LIVE',
  eventType: 'SCHEDULED',
  accessMode: null,
  moderatorToken: 'PRIMARIO',
  moderatorName: 'Chi modera',
  chatEnabled: true,
  audienceAnonymous: false,
  ...over,
});
const req = new Request('https://webinar.example.gov.it/api/events/evento/chat');
const scrive = (token: string | null, guestName?: string, nomeDigitato?: string) =>
  authenticateChatSender('evento', token, guestName, nomeDigitato, req);

beforeEach(() => {
  vi.clearAllMocks();
  db.event.findUnique.mockResolvedValue(evento());
  sender.resolveTokenSender.mockResolvedValue(null);
});

describe('authenticateChatSender — ospite', () => {
  it('senza pseudonimi scrive col nome dato', async () => {
    await expect(scrive(null, ' Bruno ')).resolves.toMatchObject({
      eventId: EVENT_ID,
      senderName: 'Bruno',
      isModerator: false,
      isPerPersonIdentity: false,
    });
  });

  it('con il pubblico anonimo scrive con lo pseudonimo del posto, mai col nome dato', async () => {
    db.event.findUnique.mockResolvedValue(evento({ audienceAnonymous: true }));
    const esito = await scrive(null, 'Bruno Verdi');
    expect(esito.senderName).toBe(`Pseudo ${esito.senderId}`);
    expect(esito.senderName).not.toBe('Bruno Verdi');
    expect(esito.isModerator).toBe(false);
  });

  it('due messaggi dello stesso ospite tengono lo stesso pseudonimo', async () => {
    db.event.findUnique.mockResolvedValue(evento({ audienceAnonymous: true }));
    const primo = await scrive(null, 'Bruno');
    const secondo = await scrive(null, 'Bruno');
    expect(secondo.senderName).toBe(primo.senderName);
  });

  it('col pubblico anonimo il nickname preso entrando prende il posto dello pseudonimo', async () => {
    db.event.findUnique.mockResolvedValue(
      evento({ audienceAnonymous: true, nicknamesEnabled: true })
    );
    nick.presi.add('Pippo|guest-203.0.113.9-Pippo');
    try {
      await expect(scrive(null, 'Pippo')).resolves.toMatchObject({ senderName: 'Pippo' });
      // Un nome che l'ospite non ha preso come nickname resta dietro lo pseudonimo.
      const altro = await scrive(null, 'Pluto');
      expect(altro.senderName).toBe(`Pseudo ${altro.senderId}`);
    } finally {
      nick.presi.clear();
    }
  });

  it("senza l'opzione il pubblico anonimo resta con lo pseudonimo, anche per un nickname preso", async () => {
    db.event.findUnique.mockResolvedValue(
      evento({ audienceAnonymous: true, nicknamesEnabled: false })
    );
    nick.presi.add('Pippo|guest-203.0.113.9-Pippo');
    try {
      const esito = await scrive(null, 'Pippo');
      expect(esito.senderName).toBe(`Pseudo ${esito.senderId}`);
    } finally {
      nick.presi.clear();
    }
  });

  it('il nome resta obbligatorio, anche se poi non si mostra', async () => {
    db.event.findUnique.mockResolvedValue(evento({ audienceAnonymous: true }));
    await expect(scrive(null, '   ')).rejects.toMatchObject({ statusCode: 422 });
  });

  it('fuori dalla finestra degli ospiti non scrive', async () => {
    db.event.findUnique.mockResolvedValue(
      evento({ status: 'ENDED', audienceAnonymous: true })
    );
    await expect(scrive(null, 'Bruno')).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('authenticateChatSender — con un token', () => {
  it('iscritto e relatore passano dalla stessa regola, con il token ricevuto', async () => {
    db.event.findUnique.mockResolvedValue(evento({ audienceAnonymous: true }));
    sender.resolveTokenSender.mockResolvedValue({
      eventId: EVENT_ID,
      senderId: 'reg-reg-1',
      senderName: 'Pseudo reg-reg-1',
      isModerator: false,
      isPerPersonIdentity: true,
    });
    await expect(scrive('TOKEN', undefined, 'Nome Digitato')).resolves.toMatchObject({
      senderName: 'Pseudo reg-reg-1',
      chatEnabled: true,
    });
    expect(sender.resolveTokenSender).toHaveBeenCalledWith(
      expect.objectContaining({ audienceAnonymous: true }),
      'TOKEN',
      'Nome Digitato'
    );
  });

  it('un token che non risolve è un 403, non un ospite', async () => {
    await expect(scrive('SBAGLIATO', 'Bruno')).rejects.toMatchObject({ statusCode: 403 });
  });

  it('evento inesistente: 404', async () => {
    db.event.findUnique.mockResolvedValue(null);
    await expect(scrive(null, 'Bruno')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('assertChatOpen', () => {
  const auth = (over: Partial<ChatAuthResult>): ChatAuthResult => ({
    eventId: EVENT_ID,
    senderId: 'x',
    senderName: 'x',
    isModerator: false,
    isPerPersonIdentity: false,
    chatEnabled: true,
    ...over,
  });

  it('a chat spenta scrive solo chi modera', () => {
    expect(() => assertChatOpen(auth({ chatEnabled: false }))).toThrow();
    expect(() =>
      assertChatOpen(auth({ chatEnabled: false, isModerator: true }))
    ).not.toThrow();
    expect(() => assertChatOpen(auth({}))).not.toThrow();
  });
});
