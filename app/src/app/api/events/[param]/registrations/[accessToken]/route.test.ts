// @vitest-environment node
/**
 * La lettura di un'iscrizione dal suo token: il token vale solo per il suo
 * evento, la risposta non porta l'indirizzo, e chi prova a indovinare si ferma.
 */
import type { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { registration: { findUnique } } }));

import { encryptPII } from '@/lib/crypto/pii';

import { GET } from './route';

let ip = 0;

function chiedi(slug: string, indirizzo = `10.3.0.${(ip += 1)}`) {
  const request = new Request(
    `http://localhost:3000/api/events/${slug}/registrations/tok`,
    {
      headers: { 'x-forwarded-for': indirizzo, 'accept-language': 'it' },
    }
  );
  return GET(request as unknown as NextRequest, {
    params: Promise.resolve({ param: slug, accessToken: 'tok' }),
  });
}

beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
});

beforeEach(() => {
  findUnique.mockReset();
  findUnique.mockResolvedValue({
    id: 'r1',
    email: encryptPII('anna@example.com'),
    emailHash: 'impronta',
    accessToken: 'tok',
    displayName: encryptPII('Anna Bianchi'),
    joinedAt: new Date('2026-10-02T08:00:00Z'),
    event: { slug: 'evento', title: { it: 'Evento di prova' }, status: 'LIVE' },
  });
});

describe('lettura di un’iscrizione', () => {
  it('dice il nome e l’evento, e nient’altro di personale', async () => {
    const risposta = await chiedi('evento');
    const testo = await risposta.text();
    expect(risposta.status).toBe(200);
    expect(JSON.parse(testo)).toEqual({
      id: 'r1',
      displayName: 'Anna Bianchi',
      eventSlug: 'evento',
      eventTitle: 'Evento di prova',
      eventStatus: 'LIVE',
      joinedAt: '2026-10-02T08:00:00.000Z',
    });
    expect(testo).not.toContain('anna@example.com');
    expect(testo).not.toContain('impronta');
  });

  it('un token sconosciuto e’ 404', async () => {
    findUnique.mockResolvedValue(null);
    expect((await chiedi('evento')).status).toBe(404);
  });

  it('il token di un altro evento risponde come uno sconosciuto', async () => {
    expect((await chiedi('altro-evento')).status).toBe(404);
  });

  it('chi prova a indovinare viene fermato', async () => {
    const insistente = '10.3.9.9';
    for (let i = 0; i < 30; i += 1) await chiedi('evento', insistente);
    expect((await chiedi('evento', insistente)).status).toBe(429);
  });
});
