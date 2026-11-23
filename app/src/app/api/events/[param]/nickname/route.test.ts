// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Moderatore from '@/lib/auth/moderator';
import type * as Nickname from '@/lib/live/nickname';

/**
 * Chi salva un nickname e chi lo prova soltanto: il token e' un posto, e solo
 * il browser che si e' iscritto cambia cio' che sta sull'iscrizione.
 */
const { db, sessione, grant, nick } = vi.hoisted(() => ({
  db: { event: { findUnique: vi.fn() }, registration: { findUnique: vi.fn() } },
  sessione: { readOwnedEventAccessToken: vi.fn() },
  grant: { resolveGrantForEvent: vi.fn() },
  nick: { salvaNicknameIscrizione: vi.fn(), verificaNickname: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ prisma: db }));
const sito = vi.hoisted(() => ({ guestAccessEnabled: true, joinGrant: false }));
vi.mock('@/lib/settings', () => ({
  getSettings: async () => ({ guestAccessEnabled: sito.guestAccessEnabled }),
}));
vi.mock('@/lib/events/join-grant', () => ({ hasJoinGrant: async () => sito.joinGrant }));
vi.mock('@/lib/event-session', () => sessione);
vi.mock('@/lib/auth/moderator', async (orig) => ({
  ...(await orig<typeof Moderatore>()),
  resolveGrantForEvent: grant.resolveGrantForEvent,
}));
vi.mock('@/lib/live/nickname', async (orig) => ({
  ...(await orig<typeof Nickname>()),
  salvaNicknameIscrizione: nick.salvaNicknameIscrizione,
  verificaNickname: nick.verificaNickname,
}));

import { PUT } from './route';

const SLUG = 'evento';
const EVENT_ID = 'ev-1';
let ip = 0;

function richiesta(corpo: unknown, token?: string): NextRequest {
  ip += 1;
  return new Request(`https://webinar.example.gov.it/api/events/${SLUG}/nickname`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `198.51.100.${ip}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(corpo),
  }) as unknown as NextRequest;
}
const ctx = { params: Promise.resolve({ param: SLUG }) };
const evento = (over: Record<string, unknown> = {}) => ({
  id: EVENT_ID,
  status: 'PUBLISHED',
  eventType: 'SCHEDULED',
  accessMode: null,
  endsAt: new Date(Date.now() + 3_600_000),
  joinPasswordHash: null,
  nicknamesEnabled: true,
  audienceAnonymous: false,
  moderatorToken: 'PRIMARIO',
  moderatorName: 'Chi modera',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.event.findUnique.mockResolvedValue(evento());
  db.registration.findUnique.mockResolvedValue({ id: 'reg-1', eventId: EVENT_ID });
  sessione.readOwnedEventAccessToken.mockResolvedValue('TOKEN');
  grant.resolveGrantForEvent.mockResolvedValue(null);
  nick.salvaNicknameIscrizione.mockImplementation(
    async (_e: string, _r: string, n: string | null) => ({
      ok: true,
      nickname: n,
    })
  );
  nick.verificaNickname.mockImplementation(async (_e: string, n: string) => ({
    ok: true,
    nickname: n,
  }));
});

describe('PUT /api/events/[param]/nickname', () => {
  it("l'iscritto, dal suo browser, lo salva sull'iscrizione", async () => {
    const res = await PUT(richiesta({ nickname: ' Pippo ' }, 'TOKEN'), ctx as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ nickname: 'Pippo', saved: true });
    expect(nick.salvaNicknameIscrizione).toHaveBeenCalledWith(EVENT_ID, 'reg-1', 'Pippo');
  });

  it('e lo toglie con null, anche a opzione spenta o a evento concluso', async () => {
    db.event.findUnique.mockResolvedValue(
      evento({ nicknamesEnabled: false, status: 'ENDED' })
    );
    const res = await PUT(richiesta({ nickname: null }, 'TOKEN'), ctx as never);
    expect(await res.json()).toEqual({ nickname: null, saved: true });
    expect(nick.salvaNicknameIscrizione).toHaveBeenCalledWith(EVENT_ID, 'reg-1', null);
  });

  it("chi apre il link di un altro lo prova soltanto: l'iscrizione non cambia", async () => {
    sessione.readOwnedEventAccessToken.mockResolvedValue(null);
    const res = await PUT(richiesta({ nickname: 'Pluto' }, 'TOKEN'), ctx as never);
    expect(await res.json()).toEqual({ nickname: 'Pluto', saved: false });
    expect(nick.salvaNicknameIscrizione).not.toHaveBeenCalled();
    // Nemmeno toglierlo: il nickname dell'iscritto resta suo.
    await PUT(richiesta({ nickname: null }, 'TOKEN'), ctx as never);
    expect(nick.salvaNicknameIscrizione).not.toHaveBeenCalled();
  });

  it('col pubblico anonimo chi apre il link di un altro resta con lo pseudonimo', async () => {
    sessione.readOwnedEventAccessToken.mockResolvedValue(null);
    db.event.findUnique.mockResolvedValue(evento({ audienceAnonymous: true }));
    const res = await PUT(richiesta({ nickname: 'Pluto' }, 'TOKEN'), ctx as never);
    expect(res.status).toBe(403);
  });

  it("l'ospite lo prova senza salvare niente, dove potrebbe entrare", async () => {
    db.event.findUnique.mockResolvedValue(evento({ status: 'LIVE' }));
    const res = await PUT(richiesta({ nickname: 'Pippo' }), ctx as never);
    expect(await res.json()).toEqual({ nickname: 'Pippo', saved: false });
    expect(nick.verificaNickname).toHaveBeenCalledWith(EVENT_ID, 'Pippo', {
      ospite: expect.stringMatching(/^guest-/),
    });
  });

  it("fuori dalla finestra degli ospiti, o senza la password, l'ospite non prova niente", async () => {
    // Prima che la sala d'attesa si apra un evento a calendario non ammette
    // ospiti.
    expect((await PUT(richiesta({ nickname: 'Pippo' }), ctx as never)).status).toBe(403);
    db.event.findUnique.mockResolvedValue(
      evento({ status: 'LIVE', joinPasswordHash: 'scrypt:x:y' })
    );
    expect((await PUT(richiesta({ nickname: 'Pippo' }), ctx as never)).status).toBe(403);
    sito.joinGrant = true;
    try {
      expect((await PUT(richiesta({ nickname: 'Pippo' }), ctx as never)).status).toBe(
        200
      );
    } finally {
      sito.joinGrant = false;
    }
    // A sala d'attesa aperta (in accensione) li ammette gia'.
    db.event.findUnique.mockResolvedValue(evento({ status: 'PROVISIONING' }));
    expect((await PUT(richiesta({ nickname: 'Pippo' }), ctx as never)).status).toBe(200);
    expect(nick.verificaNickname).toHaveBeenCalledTimes(2);
  });

  it('chi conduce non ne ha uno: 403', async () => {
    db.registration.findUnique.mockResolvedValue(null);
    grant.resolveGrantForEvent.mockResolvedValue({
      role: 'SPEAKER',
      isPrimaryShared: false,
      grantId: 'g',
    });
    const res = await PUT(richiesta({ nickname: 'Pippo' }, 'GRANT'), ctx as never);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'HOSTS_USE_THEIR_NAME' });
  });

  it("un token che non e' dell'evento: 403", async () => {
    db.registration.findUnique.mockResolvedValue({ id: 'reg-x', eventId: 'altro' });
    const res = await PUT(richiesta({ nickname: 'Pippo' }, 'TOKEN'), ctx as never);
    expect(res.status).toBe(403);
  });

  it("senza l'opzione non se ne sceglie uno; a evento concluso nemmeno", async () => {
    db.event.findUnique.mockResolvedValue(evento({ nicknamesEnabled: false }));
    const spento = await PUT(richiesta({ nickname: 'Pippo' }, 'TOKEN'), ctx as never);
    expect(spento.status).toBe(403);
    expect(await spento.json()).toMatchObject({ code: 'NICKNAMES_DISABLED' });
    db.event.findUnique.mockResolvedValue(evento({ status: 'ENDED' }));
    const finito = await PUT(richiesta({ nickname: 'Pippo' }, 'TOKEN'), ctx as never);
    expect(finito.status).toBe(409);
  });

  it("un rifiuto torna con il motivo, o con un'alternativa", async () => {
    nick.salvaNicknameIscrizione.mockResolvedValueOnce({ ok: false, motivo: 'host' });
    const non = await PUT(richiesta({ nickname: 'Mario' }, 'TOKEN'), ctx as never);
    expect(non.status).toBe(422);
    expect(await non.json()).toMatchObject({ code: 'NICKNAME_INVALID', reason: 'host' });
    db.event.findUnique.mockResolvedValue(evento({ status: 'LIVE' }));
    nick.verificaNickname.mockResolvedValueOnce({
      ok: false,
      motivo: 'taken',
      suggerimento: 'Pippo2',
    });
    const preso = await PUT(richiesta({ nickname: 'Pippo' }), ctx as never);
    expect(preso.status).toBe(409);
    expect(await preso.json()).toMatchObject({
      code: 'NICKNAME_TAKEN',
      suggestion: 'Pippo2',
    });
  });

  it("un corpo sbagliato: 422, e un evento che non c'e': 404", async () => {
    expect((await PUT(richiesta({ nickname: 3 }), ctx as never)).status).toBe(422);
    db.event.findUnique.mockResolvedValue(null);
    expect((await PUT(richiesta({ nickname: 'Pippo' }), ctx as never)).status).toBe(404);
  });
});
