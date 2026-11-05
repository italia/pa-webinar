// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  admin: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  queryRaw: vi.fn(),
}));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));
vi.mock('@/lib/auth/admin-session', () => ({ isAdminAuthenticated: m.admin }));
vi.mock('@/lib/crypto/pii', () => ({
  tryDecryptPII: (v: string | null) => (v ? `chiaro:${v}` : null),
}));
vi.mock('@/lib/db', () => ({
  prisma: { person: { findMany: m.findMany, count: m.count }, $queryRaw: m.queryRaw },
}));

import { GET } from './route';

const riga = (id: string) => ({
  id,
  displayName: 'nome',
  organization: 'Ente',
  organizationRole: null,
  organizationType: null,
  optedInToAddressBook: true,
  optedInAt: null,
  optedOutAt: null,
  lastActiveAt: new Date('2026-01-01'),
  retentionMonths: 24,
  createdAt: new Date('2026-01-01'),
  _count: { registrations: 2 },
});

beforeEach(() => {
  vi.clearAllMocks();
  m.admin.mockResolvedValue(true);
  m.findMany.mockResolvedValue([riga('p1'), riga('p2')]);
  m.count.mockResolvedValue(2);
  m.queryRaw.mockResolvedValue([{ person_id: 'p1', email: 'cifrata' }]);
});

describe('GET /api/admin/rubrica', () => {
  it("solo l'amministrazione", async () => {
    m.admin.mockResolvedValueOnce(false);
    const res = await GET(
      new Request('http://x/api/admin/rubrica') as never,
      {} as never
    );
    expect(res.status).toBe(401);
  });

  it("senza withEmail non legge ne' restituisce indirizzi", async () => {
    const res = await GET(
      new Request('http://x/api/admin/rubrica?q=ente') as never,
      {} as never
    );
    const body = await res.json();
    expect(m.queryRaw).not.toHaveBeenCalled();
    expect(body.rows[0]).not.toHaveProperty('email');
    expect(m.findMany.mock.calls[0]?.[0]?.where).toEqual({
      optedInToAddressBook: true,
      organization: { contains: 'ente', mode: 'insensitive' },
    });
  });

  it("con withEmail: solo chi ha un'iscrizione, con l'email dell'ultima", async () => {
    const res = await GET(
      new Request('http://x/api/admin/rubrica?q=ente&withEmail=1') as never,
      {} as never
    );
    const body = await res.json();
    expect(m.findMany.mock.calls[0]?.[0]?.where).toMatchObject({
      optedInToAddressBook: true,
      registrations: { some: {} },
    });
    expect(body.rows.map((r: { email: string | null }) => r.email)).toEqual([
      'chiaro:cifrata',
      null,
    ]);
  });
});
