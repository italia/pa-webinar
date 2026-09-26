import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * La cancellazione (art. 17) deve togliere anche la voce di rubrica: le
 * iscrizioni la puntano con onDelete SetNull, quindi cancellare solo quelle
 * lasciava in rubrica nome e organizzazione di chi aveva chiesto di sparire.
 */
vi.mock('@/lib/db', () => ({
  prisma: {
    person: { deleteMany: vi.fn() },
    registration: { findMany: vi.fn(), deleteMany: vi.fn() },
    gdprAuditLog: { create: vi.fn() },
  },
}));
vi.mock('@/lib/gdpr/request-token', () => ({
  verifyGdprToken: (token: string) => (token === 'valido' ? { emailHash: 'h'.repeat(64) } : null),
}));

import { prisma } from '@/lib/db';

import { POST } from './route';

const db = prisma as unknown as {
  person: { deleteMany: ReturnType<typeof vi.fn> };
  registration: { findMany: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> };
  gdprAuditLog: { create: ReturnType<typeof vi.fn> };
};

let ip = 0;
function req(token: string): Request {
  ip += 1;
  return new Request(`https://portale.example.test/api/gdpr/erasure?t=${token}`, {
    method: 'POST',
    headers: { 'x-forwarded-for': `203.0.113.${ip}` },
  });
}
const ctx = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
  db.person.deleteMany.mockResolvedValue({ count: 1 });
  db.registration.deleteMany.mockResolvedValue({ count: 1 });
  db.gdprAuditLog.create.mockResolvedValue({});
});

describe('POST /api/gdpr/erasure', () => {
  it('deletes the address-book entry together with the registrations', async () => {
    db.registration.findMany.mockResolvedValue([{ id: 'r1', eventId: 'e1' }]);
    const res = await POST(req('valido') as never, ctx as never);
    expect(res.status).toBe(200);
    expect(db.person.deleteMany).toHaveBeenCalledWith({ where: { emailHash: 'h'.repeat(64) } });
    expect(await res.json()).toEqual({ ok: true, deleted: 1, addressBookDeleted: true });
  });

  it('deletes the address-book entry even when no registration is left', async () => {
    db.registration.findMany.mockResolvedValue([]);
    const res = await POST(req('valido') as never, ctx as never);
    expect(db.person.deleteMany).toHaveBeenCalled();
    expect(await res.json()).toEqual({ ok: true, deleted: 0, addressBookDeleted: true });
  });

  it('touches nothing with an invalid token', async () => {
    const res = await POST(req('falso') as never, ctx as never);
    expect(res.status).toBe(401);
    expect(db.person.deleteMany).not.toHaveBeenCalled();
    expect(db.registration.deleteMany).not.toHaveBeenCalled();
  });
});
