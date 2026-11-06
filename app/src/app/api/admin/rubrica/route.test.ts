// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  admin: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
}));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));
vi.mock('@/lib/auth/admin-session', () => ({ isAdminAuthenticated: m.admin }));
vi.mock('@/lib/crypto/pii', () => ({
  tryDecryptPII: (v: string | null) => (v ? `chiaro:${v}` : null),
}));
vi.mock('@/lib/db', () => ({
  prisma: { person: { findMany: m.findMany, count: m.count } },
}));

import { GET } from './route';

const riga = (id: string, email: string | null = null) => ({
  id,
  displayName: 'nome',
  email,
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
  m.findMany.mockResolvedValue([riga('p1', 'cifrata'), riga('p2', 'altra')]);
  m.count.mockResolvedValue(2);
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
    expect(m.findMany.mock.calls[0]?.[0]?.select.email).toBe(false);
    expect(body.rows[0]).not.toHaveProperty('email');
    expect(m.findMany.mock.calls[0]?.[0]?.where).toEqual({
      optedInToAddressBook: true,
      organization: { contains: 'ente', mode: 'insensitive' },
    });
  });

  it("con withEmail: solo le voci con un'email, letta dalla voce e decifrata", async () => {
    const res = await GET(
      new Request('http://x/api/admin/rubrica?q=ente&withEmail=1') as never,
      {} as never
    );
    const body = await res.json();
    const query = m.findMany.mock.calls[0]?.[0];
    expect(query?.where).toEqual({
      optedInToAddressBook: true,
      organization: { contains: 'ente', mode: 'insensitive' },
      email: { not: null },
    });
    expect(query?.select.email).toBe(true);
    expect(body.rows.map((r: { email: string | null }) => r.email)).toEqual([
      'chiaro:cifrata',
      'chiaro:altra',
    ]);
  });
});
