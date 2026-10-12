// @vitest-environment node
/**
 * GET /api/admin/postprod — il filtro per evento.
 *
 * Arrivando da un evento si chiedono le sue registrazioni: un identificativo
 * malformato e' un errore, non l'elenco di tutte.
 */

import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));
vi.mock('@/lib/auth/staff-session', () => ({
  requireStaff: vi.fn(async () => ({ role: 'admin', accountId: null })),
  eventScope: vi.fn(() => ({})),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    recording: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
  },
}));

import { prisma } from '@/lib/db';

import { GET } from './route';

const findMany = prisma.recording.findMany as unknown as ReturnType<typeof vi.fn>;

function chiama(query: string) {
  return GET(
    new Request(
      `https://webinar.example.gov.it/api/admin/postprod${query}`
    ) as unknown as NextRequest,
    { params: Promise.resolve({}) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/admin/postprod — filtro per evento', () => {
  it('un identificativo malformato: 400, nessuna ricerca', async () => {
    const res = await chiama('?eventId=1234abcd');
    expect(res.status).toBe(400);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('un identificativo valido filtra le registrazioni di quell’evento', async () => {
    const id = '22222222-2222-4222-8222-222222222222';
    const res = await chiama(`?eventId=${id}`);
    expect(res.status).toBe(200);
    expect(findMany.mock.calls[0]![0]).toMatchObject({ where: { eventId: id } });
  });
});
