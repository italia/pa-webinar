/**
 * POST /api/events/[slug]/analytics/peak — il segno di vita della sala.
 *
 * Oltre al picco, il resoconto dei client tiene aggiornato `lastActiveAt`: è
 * il segnale per sala con cui, anche senza scaler, una chiamata abbandonata si
 * chiude e una occupata no. Al più una volta al minuto, solo con qualcuno in
 * conferenza, con la condizione nella WHERE (nessuna lettura in più).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  eventFindFirst: vi.fn(),
  eventUpdateMany: vi.fn(),
  sessionFindFirst: vi.fn(),
  sessionUpdateMany: vi.fn(),
  executeRaw: vi.fn(async () => 1),
  resolveGrantForEvent: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findFirst: mocks.eventFindFirst, updateMany: mocks.eventUpdateMany },
    $executeRaw: mocks.executeRaw,
    callSession: { findFirst: mocks.sessionFindFirst, updateMany: mocks.sessionUpdateMany },
    registration: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/auth/moderator', () => ({
  extractModeratorToken: vi.fn(),
  resolveGrantForEvent: mocks.resolveGrantForEvent,
}));

import { POST } from './route';

const NOW = new Date('2026-09-25T10:00:00Z');
let n = 0;

async function riferisci(count: number) {
  // Un indirizzo diverso per chiamata: i limiti sono per IP e per chi riferisce.
  const req = new Request('http://localhost/api/events/istantanea/analytics/peak', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${++n}` },
    body: JSON.stringify({ count }),
  });
  const res = await POST(req as unknown as Parameters<typeof POST>[0], {
    params: Promise.resolve({ param: 'istantanea' }),
  });
  return res.status;
}

/** Le scritture di `last_active_at`: SQL diretto, con i suoi parametri. */
const stampe = () =>
  mocks.executeRaw.mock.calls.map((c) => {
    const [strings, ...values] = c as unknown as [TemplateStringsArray, ...unknown[]];
    return { sql: strings.join('?'), values };
  });

beforeEach(() => {
  vi.clearAllMocks();
  // Solo l'orologio: i limiti di frequenza usano i timer veri.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  mocks.eventFindFirst.mockResolvedValue({
    id: 'evt-1',
    moderatorToken: 'tok',
    maxParticipants: 50,
    eventType: 'INSTANT',
    _count: { registrations: 0 },
  });
  mocks.eventUpdateMany.mockResolvedValue({ count: 1 });
  mocks.sessionFindFirst.mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('POST /analytics/peak — segno di vita', () => {
  it('con qualcuno in conferenza aggiorna lastActiveAt, al più una volta al minuto', async () => {
    expect(await riferisci(3)).toBe(200);

    const [stampa] = stampe();
    expect(stampa).toBeDefined();
    expect(stampa!.sql).toContain('UPDATE "events" SET "last_active_at"');
    expect(stampa!.sql).toContain(`"status" = 'LIVE'`);
    // Mai updated_at: il battito non è una modifica dell'evento.
    expect(stampa!.sql).not.toContain('updated_at');
    expect(stampa!.values).toEqual([NOW, 'evt-1', new Date(NOW.getTime() - 60_000)]);
    // E nessuna scrittura di lastActiveAt passa da Prisma (toccherebbe updated_at).
    for (const c of mocks.eventUpdateMany.mock.calls) {
      expect((c[0] as { data: Record<string, unknown> }).data).not.toHaveProperty('lastActiveAt');
    }
  });

  it('una sala vuota non è un segno di vita', async () => {
    expect(await riferisci(0)).toBe(200);
    expect(stampe()).toEqual([]);
  });
});
