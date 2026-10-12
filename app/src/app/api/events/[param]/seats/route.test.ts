// @vitest-environment node
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    registration: { findUnique: vi.fn(), findMany: vi.fn() },
    eventModerator: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/redis', () => ({
  getRedis: () => null,
  withDeadline: <T,>(op: Promise<T>) => op,
}));
const cookie = vi.hoisted(() => ({ token: null as string | null }));
vi.mock('@/lib/event-session', () => ({
  readOwnedEventAccessToken: vi.fn(async () => cookie.token),
}));
vi.mock('@/lib/auth/moderator', async (importOriginal) => {
  const vero = await importOriginal<typeof Moderatore>();
  return {
    ...vero,
    resolveGrantForEvent: vi.fn(async (_e: unknown, token: string) =>
      token === 'MOD'
        ? { role: 'MODERATOR', displayName: null, isPrimaryShared: true, grantId: null, email: null }
        : token === 'REL'
          ? { role: 'SPEAKER', displayName: 'Relatore 1', isPrimaryShared: false, grantId: 'g1', email: 'rel@ente.it' }
          : null,
    ),
    isEventModerator: vi.fn(async (_e: unknown, token: string | null) => token === 'MOD'),
  };
});
vi.mock('@/lib/crypto/pii', () => ({
  tryDecryptPII: (v: string) => v.replace(/^cifrato:/, ''),
}));

import type * as Moderatore from '@/lib/auth/moderator';
import { prisma } from '@/lib/db';
import { resetSeatsMemoryForTests } from '@/lib/live/seats';

import { GET, POST } from './route';

const ctx = () => ({ params: Promise.resolve({ param: 'evento' }) });
const dichiara = (token: string, endpointId: string) =>
  POST(
    new Request('https://webinar.gov.it/api/events/evento/seats', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpointId }),
    }) as unknown as NextRequest,
    ctx(),
  );
const leggi = (token: string) =>
  GET(
    new Request('https://webinar.gov.it/api/events/evento/seats', {
      headers: { Authorization: `Bearer ${token}` },
    }) as unknown as NextRequest,
    ctx(),
  );
const fn = (f: unknown) => f as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  resetSeatsMemoryForTests();
  cookie.token = null;
  fn(prisma.event.findUnique).mockResolvedValue({ id: 'e1', moderatorToken: 'MOD', moderatorName: null });
  fn(prisma.registration.findUnique).mockImplementation(async ({ where }: { where: { accessToken: string } }) =>
    where.accessToken.startsWith('ISCR') ? { id: `r-${where.accessToken}`, eventId: 'e1' } : null,
  );
  fn(prisma.registration.findMany).mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
    where.id.in.map((id) => ({ id, displayName: `cifrato:Nome ${id}`, email: `cifrato:${id}@ente.it` })),
  );
  fn(prisma.eventModerator.findMany).mockResolvedValue([{ id: 'g1', name: 'cifrato:Relatore 1', email: 'cifrato:rel@ente.it' }]);
});

describe('/api/events/[slug]/seats', () => {
  it('lega ogni endpoint a cio’ che il token prova, e chi modera lo legge', async () => {
    cookie.token = 'ISCR1';
    expect((await dichiara('ISCR1', 'aa01')).status).toBe(204);
    cookie.token = null;
    expect((await dichiara('ISCR2', 'aa02')).status).toBe(204);
    expect((await dichiara('REL', 'aa03')).status).toBe(204);
    expect((await dichiara('MOD', 'aa04')).status).toBe(204);

    const res = await leggi('MOD');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect((await res.json()).seats).toEqual({
      aa01: { kind: 'registration', name: 'Nome r-ISCR1', email: 'r-ISCR1@ente.it' },
      aa02: { kind: 'forwardedLink', name: 'Nome r-ISCR2', email: 'r-ISCR2@ente.it' },
      aa03: { kind: 'grant', name: 'Relatore 1', email: 'rel@ente.it' },
      aa04: { kind: 'sharedModeratorLink', name: null, email: null },
    });
  });

  it('un endpoint dichiarato da due token non mostra nessuna delle due identita’', async () => {
    cookie.token = 'ISCR1';
    await dichiara('ISCR1', 'aa01');
    cookie.token = 'ISCR9';
    expect((await dichiara('ISCR9', 'aa01')).status).toBe(204);
    const seats = (await (await leggi('MOD')).json()).seats;
    expect(seats.aa01).toEqual({ kind: 'contested', name: null, email: null });
  });

  it('solo chi modera legge; un token sconosciuto non dichiara', async () => {
    expect((await leggi('REL')).status).toBe(403);
    expect((await leggi('ISCR1')).status).toBe(403);
    expect((await dichiara('BOH', 'aa05')).status).toBe(403);
    expect((await dichiara('ISCR1', 'non valido!')).status).toBe(422);
  });
});
