// @vitest-environment node
/**
 * POST /api/admin/events/[id]/recap — «Aggiorna il riepilogo pubblico».
 *
 * Lo chiede chi modera col proprio token o lo staff che gestisce l'evento;
 * si rifa' solo su un evento concluso con i dati ancora conservati.
 */

import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));
vi.mock('@/lib/auth/staff-session', () => ({
  requireEventManager: vi.fn(async () => ({ role: 'admin', accountId: null })),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    eventModerator: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/events/recap', () => ({ ricostruisciRiepilogo: vi.fn() }));

import { requireEventManager } from '@/lib/auth/staff-session';
import { prisma } from '@/lib/db';
import { ForbiddenError } from '@/lib/errors';
import { ricostruisciRiepilogo } from '@/lib/events/recap';

import { POST } from './route';

const mockedManager = vi.mocked(requireEventManager);
const mockedRicostruisci = vi.mocked(ricostruisciRiepilogo);
const mockedEvent = prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedGrant = prisma.eventModerator.findUnique as unknown as ReturnType<
  typeof vi.fn
>;

const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'TOKEN_MODERATORE_PRINCIPALE';

function chiama(
  id = EVENT_ID,
  token?: string
): [NextRequest, { params: Promise<{ id: string }> }] {
  return [
    new Request(`https://webinar.example.gov.it/api/admin/events/${id}/recap`, {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }) as unknown as NextRequest,
    { params: Promise.resolve({ id }) },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedManager.mockResolvedValue({ role: 'admin', accountId: null } as Awaited<
    ReturnType<typeof requireEventManager>
  >);
  mockedEvent.mockResolvedValue({ id: EVENT_ID, moderatorToken: TOKEN });
  mockedGrant.mockResolvedValue(null);
  mockedRicostruisci.mockResolvedValue('fatto');
});

describe('POST /api/admin/events/[id]/recap', () => {
  it('chi modera col suo token: rifatto, senza chiedere la sessione', async () => {
    const res = await POST(...chiama(EVENT_ID, TOKEN));
    expect(res.status).toBe(200);
    expect(mockedManager).not.toHaveBeenCalled();
    expect(mockedRicostruisci).toHaveBeenCalledWith(EVENT_ID);
  });

  it('senza token decide la sessione dello staff', async () => {
    mockedManager.mockRejectedValue(new ForbiddenError('no'));
    const res = await POST(...chiama());
    expect(res.status).toBe(403);
    expect(mockedRicostruisci).not.toHaveBeenCalled();
  });

  it('evento non concluso o dati scaduti: 409 con il motivo', async () => {
    mockedRicostruisci.mockResolvedValue('non-concluso');
    expect((await POST(...chiama(EVENT_ID, TOKEN))).status).toBe(409);
    mockedRicostruisci.mockResolvedValue('scaduto');
    const res = await POST(...chiama(EVENT_ID, TOKEN));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('RETENTION_EXPIRED');
  });

  it('identificativo non valido: 400', async () => {
    expect((await POST(...chiama('abc'))).status).toBe(400);
  });
});
