/**
 * Contratto della duplicazione di un evento.
 *
 * Nasce da un difetto reale: il bottone "Duplica come prossima occorrenza"
 * creava davvero la copia, ma il client navigava alla pagina di modifica SENZA
 * il token e quella pagina risponde notFound(). L'operatore vedeva un 404 e
 * pensava che la duplicazione fosse fallita, mentre l'evento era stato creato.
 *
 * Il pezzo che il client non può indovinare è il `moderatorToken` nella
 * risposta: qui si verifica che ci sia sempre. Nel progetto non esistono test
 * di componenti, quindi il lato client non è coperto direttamente — questa è la
 * metà che si può proteggere, ed è quella che, se sparisce, rompe l'altra.
 */

import type { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => ({ value: 'admin-session' }) })),
}));

vi.mock('@/lib/auth/admin-session', () => ({
  isAdminAuthenticated: vi.fn(async () => true),
}));

vi.mock('@/lib/audit/admin-audit', () => ({
  logAdminAction: vi.fn(async () => undefined),
}));

vi.mock('@/lib/utils/slug', () => ({
  generateUniqueSlug: vi.fn(async () => 'copia-evento'),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn(), create: vi.fn() },
    eventReminder: { findMany: vi.fn() },
  },
}));

import { prisma } from '@/lib/db';

import { POST } from './route';

/** La rotta valida l'id come UUID: un identificativo finto la ferma con un 400. */
const SOURCE_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

const mocked = prisma as unknown as {
  event: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  eventReminder: { findMany: ReturnType<typeof vi.fn> };
};

/** Sorgente minima: i campi che la rotta legge davvero. */
function sourceEvent() {
  return {
    id: SOURCE_ID,
    slug: 'evento-originale',
    title: { it: 'Evento originale', en: 'Original event' },
    startsAt: new Date('2026-09-01T09:00:00.000Z'),
    endsAt: new Date('2026-09-01T10:00:00.000Z'),
    recurrenceRule: null,
    moderatorToken: 'token-di-origine',
    jitsiRoomName: 'stanza-origine',
    status: 'PUBLISHED',
  };
}

function request(body: unknown = {}): NextRequest {
  // L'id che conta è quello nei params (la rotta legge quello, non l'URL):
  // qui l'URL serve solo perché Request ne pretende uno valido.
  return new Request(`http://localhost/api/admin/events/${SOURCE_ID}/duplicate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // Stesso cast del test di rotta della chat: qui serve solo il boundary HTTP,
    // non le estensioni di NextRequest.
  }) as unknown as NextRequest;
}

const context = { params: Promise.resolve({ id: SOURCE_ID }) };

describe('POST /api/admin/events/[id]/duplicate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.event.findUnique.mockResolvedValue(sourceEvent());
    mocked.eventReminder.findMany.mockResolvedValue([]);
    mocked.event.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: '6f1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d',
      slug: data.slug,
      moderatorToken: data.moderatorToken,
    }));
  });

  it('restituisce il moderatorToken: senza, la pagina di modifica risponde 404', async () => {
    const res = await POST(request(), context as never);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; slug: string; moderatorToken?: string };
    expect(body.id).toBe('6f1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d');
    expect(typeof body.moderatorToken).toBe('string');
    expect(body.moderatorToken).toBeTruthy();
  });

  it('la copia NON eredita il token dell’originale: è una credenziale, non configurazione', async () => {
    const res = await POST(request(), context as never);
    const body = (await res.json()) as { moderatorToken?: string };
    expect(body.moderatorToken).not.toBe('token-di-origine');
    const created = mocked.event.create.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(created.moderatorToken).not.toBe('token-di-origine');
  });

  it('la copia nasce in BOZZA: un clone non deve andare pubblico da solo', async () => {
    await POST(request(), context as never);
    const created = mocked.event.create.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(created.status).toBe('DRAFT');
  });
});
