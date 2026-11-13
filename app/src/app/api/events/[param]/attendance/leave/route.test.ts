// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
/**
 * L'ora di uscita di un iscritto. Il token identifica un posto, non una persona:
 * scrive solo il browser che si e' iscritto e ha il cookie firmato. Un link
 * inoltrato non sovrascrive l'uscita di chi lo ha ricevuto per primo.
 */
import type { NextRequest } from 'next/server';
import { SignJWT } from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, biscotti } = vi.hoisted(() => ({
  prisma: {
    event: { findFirst: vi.fn() },
    registration: { updateMany: vi.fn() },
  },
  biscotti: new Map<string, { value: string }>(),
}));

vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (nome: string) => biscotti.get(nome) }),
}));

import { eventAccessCookieName, signEventAccess } from '@/lib/event-session';

import { POST } from './route';

const EVENTO = '11111111-1111-4111-8111-111111111111';
const ALTRO_EVENTO = '22222222-2222-4222-8222-222222222222';
const LINK = 'link-personale';
const SEGRETO = 'segreto-di-prova-dell-uscita-dalla-sala-lungo';

let contatore = 0;
let indirizzo = '';

function esci(corpo: unknown = { accessToken: LINK }, param = 'evento') {
  const request = new Request(
    `http://localhost:3000/api/events/${param}/attendance/leave`,
    {
      method: 'POST',
      headers: { 'x-forwarded-for': indirizzo },
      body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
    }
  );
  return POST(request as unknown as NextRequest, { params: Promise.resolve({ param }) });
}

async function conCookie(token = LINK, evento = EVENTO): Promise<void> {
  biscotti.set(eventAccessCookieName(EVENTO), {
    value: await signEventAccess(evento, token, 3600),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  process.env.APP_SECRET = SEGRETO;
  indirizzo = `203.0.113.${++contatore}`;
  biscotti.clear();
  prisma.event.findFirst.mockResolvedValue({ id: EVENTO });
  prisma.registration.updateMany.mockResolvedValue({ count: 1 });
});

describe('cosa si accetta', () => {
  it('un corpo che non e’ JSON e’ 400', async () => {
    expect((await esci('non json')).status).toBe(400);
  });

  it.each([
    ['senza token', {}],
    ['con il token vuoto', { accessToken: '' }],
    ['con un token troppo lungo', { accessToken: 'x'.repeat(257) }],
  ])('%s e’ 422', async (_nome, corpo) => {
    expect((await esci(corpo)).status).toBe(422);
    expect(prisma.event.findFirst).not.toHaveBeenCalled();
  });

  it('un evento inesistente e’ 404', async () => {
    prisma.event.findFirst.mockResolvedValue(null);
    await conCookie();
    expect((await esci()).status).toBe(404);
    expect(prisma.registration.updateMany).not.toHaveBeenCalled();
  });

  it('l’evento si cerca per slug, o per identificativo se ne ha la forma', async () => {
    await esci();
    expect(prisma.event.findFirst.mock.calls[0]![0].where).toEqual({ slug: 'evento' });
    await esci({ accessToken: LINK }, EVENTO);
    expect(prisma.event.findFirst.mock.calls[1]![0].where).toEqual({
      OR: [{ id: EVENTO }, { slug: EVENTO }],
    });
  });

  it('oltre il limite per indirizzo si ferma prima di leggere l’evento', async () => {
    prisma.event.findFirst.mockResolvedValue(null);
    for (let i = 0; i < 240; i++) await esci();
    const r = await esci();
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBeTruthy();
    expect(prisma.event.findFirst).toHaveBeenCalledTimes(240);
  });
});

describe('chi registra l’uscita', () => {
  async function nienteScritto() {
    const r = await esci();
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toEqual({ ok: false });
    expect(prisma.registration.updateMany).not.toHaveBeenCalled();
  }

  it('un link inoltrato, senza il cookie, non scrive niente', async () => {
    await nienteScritto();
  });

  it('il cookie di un’altra iscrizione non vale per questo token', async () => {
    await conCookie('link-di-qualcun-altro');
    await nienteScritto();
  });

  it('il cookie di un altro evento non vale', async () => {
    await conCookie(LINK, ALTRO_EVENTO);
    await nienteScritto();
  });

  it('un cookie firmato con un altro segreto non vale', async () => {
    const falso = await new SignJWT({ eventId: EVENTO, token: LINK })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('altro-segreto-di-prova-abbastanza-lungo-davvero'));
    biscotti.set(eventAccessCookieName(EVENTO), { value: falso });
    await nienteScritto();
  });

  it('un cookie scaduto non vale', async () => {
    const scaduto = await new SignJWT({ eventId: EVENTO, token: LINK })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(SEGRETO));
    biscotti.set(eventAccessCookieName(EVENTO), { value: scaduto });
    await nienteScritto();
  });

  it('senza segreto configurato non scrive nessuno', async () => {
    await conCookie();
    delete process.env.APP_SECRET;
    await nienteScritto();
  });

  it('chi si e’ iscritto da quel browser registra l’uscita, e nient’altro', async () => {
    await conCookie();
    const prima = Date.now();
    const r = await esci();
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toEqual({ ok: true });
    const { where, data } = prisma.registration.updateMany.mock.calls[0]![0] as {
      where: unknown;
      data: { leftAt: Date };
    };
    expect(where).toEqual({ accessToken: LINK, eventId: EVENTO });
    expect(Object.keys(data)).toEqual(['leftAt']);
    expect(data.leftAt.getTime()).toBeGreaterThanOrEqual(prima);
  });

  it('un’iscrizione che non c’e’ piu’ risponde ok: false', async () => {
    prisma.registration.updateMany.mockResolvedValue({ count: 0 });
    await conCookie();
    await expect((await esci()).json()).resolves.toEqual({ ok: false });
  });
});
