import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Gli invitati dell'evento, con chi si e' gia' iscritto: il confronto e' per
 * impronta dell'indirizzo, anche per gli inviti di prima della cifratura.
 */
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({})) }));
vi.mock('@/lib/auth/staff-session', () => ({
  requireEventManager: vi.fn(async () => ({ role: 'organizer' })),
}));
vi.mock('@/lib/audit/admin-audit', () => ({ logAdminAction: vi.fn() }));
vi.mock('@/lib/crypto/pii', () => ({
  tryDecryptPII: (v: string | null) => (v ? v.replace(/^enc:/, '') : v),
  hashEmail: (v: string) => `hash:${v.trim().toLowerCase()}`,
  encryptPII: (v: string) => `enc:${v}`,
  encryptPIIOrNull: (v: string | null) => (v ? `enc:${v}` : null),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    eventInvitation: { findMany: vi.fn() },
    registration: { findMany: vi.fn() },
  },
}));

import { prisma } from '@/lib/db';

import { GET } from './route';

const db = prisma as unknown as {
  event: { findUnique: ReturnType<typeof vi.fn> };
  eventInvitation: { findMany: ReturnType<typeof vi.fn> };
  registration: { findMany: ReturnType<typeof vi.fn> };
};

const EVENT_ID = '0e5c3a9e-4b1d-4c7e-9f2a-6d8b1c3e5f70';
const ctx = { params: Promise.resolve({ id: EVENT_ID }) };
const invito = (id: string, email: string, emailHash: string | null) => ({
  id,
  eventId: EVENT_ID,
  personId: null,
  role: 'GUEST',
  name: null,
  email,
  emailHash,
  token: `link-${id}`,
  person: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.event.findUnique.mockResolvedValue({ id: EVENT_ID });
});

describe('GET /api/admin/events/[id]/invitations', () => {
  it('dice chi fra gli invitati si e\' iscritto, anche per gli inviti senza impronta', async () => {
    db.eventInvitation.findMany.mockResolvedValue([
      invito('a', 'enc:iscritta@example.org', 'hash:iscritta@example.org'),
      invito('b', 'enc:assente@example.org', 'hash:assente@example.org'),
      // Invito di prima della cifratura: indirizzo in chiaro, senza impronta.
      invito('c', 'Vecchia@Example.org', null),
    ]);
    db.registration.findMany.mockResolvedValue([
      { emailHash: 'hash:iscritta@example.org' },
      { emailHash: 'hash:vecchia@example.org' },
    ]);

    const res = await GET(new Request('https://portale.example.test/') as never, ctx as never);
    const { rows } = (await res.json()) as { rows: Array<{ id: string; registered: boolean; email: string }> };

    expect(rows.map((r) => [r.id, r.registered])).toEqual([
      ['a', true],
      ['b', false],
      ['c', true],
    ]);
    expect(rows[0]?.email).toBe('iscritta@example.org');
    // L'impronta e il link d'iscrizione dell'invito restano sul server.
    expect(rows.every((r) => !('emailHash' in r) && !('token' in r))).toBe(true);
    expect(db.registration.findMany).toHaveBeenCalledWith({
      where: {
        eventId: EVENT_ID,
        emailHash: { in: ['hash:iscritta@example.org', 'hash:assente@example.org', 'hash:vecchia@example.org'] },
      },
      select: { emailHash: true },
    });
  });

  it('senza invitati non interroga le iscrizioni', async () => {
    db.eventInvitation.findMany.mockResolvedValue([]);
    const res = await GET(new Request('https://portale.example.test/') as never, ctx as never);
    expect((await res.json()).rows).toEqual([]);
    expect(db.registration.findMany).not.toHaveBeenCalled();
  });
});
