import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Disattivare o eliminare un account rigenera il link principale di ogni
 * evento che l'account gestiva: anche di quelli in cui era organizzatore,
 * perché la pagina dell'evento gli mostrava il link.
 */
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({})) }));
vi.mock('@/lib/auth/staff-session', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requireAdmin: vi.fn(async () => ({ role: 'admin', accountId: null })),
}));
vi.mock('@/lib/audit/admin-audit', () => ({ logAdminAction: vi.fn(async () => undefined) }));
vi.mock('@/lib/crypto/pii', () => ({ encryptPII: (v: string) => v }));
const tx = vi.hoisted(() => ({
  staffAccount: { findUnique: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
  staffLoginToken: { deleteMany: vi.fn() },
  event: { findMany: vi.fn(), update: vi.fn() },
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    staffAccount: { findUnique: vi.fn(async () => ({ id: ID, active: true })) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  },
}));

import { DELETE, PATCH } from './route';

const ID = '3a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const ctx = { params: Promise.resolve({ id: ID }) };

function req(method: string, body?: unknown): Request {
  return new Request(`https://portale.example.test/api/admin/organizers/${ID}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

const atteso = {
  where: {
    AND: [
      {
        OR: [
          { createdById: ID },
          { additionalMods: { some: { organizer: true, revokedAt: null, emailHash: 'impronta' } } },
        ],
      },
    ],
  },
  select: { id: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  tx.staffAccount.findUnique.mockResolvedValue({ emailHash: 'impronta' });
  tx.staffAccount.deleteMany.mockResolvedValue({ count: 1 });
  tx.event.findMany.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }]);
});

describe('account dello staff: i link degli eventi che gestiva', () => {
  it('disattivarlo rigenera anche quelli degli eventi co-organizzati', async () => {
    const res = await PATCH(req('PATCH', { active: false }) as never, ctx as never);
    expect(res.status).toBe(200);
    expect(tx.event.findMany).toHaveBeenCalledWith(atteso);
    expect(tx.event.update).toHaveBeenCalledTimes(2);
  });

  it('eliminarlo, lo stesso, prima di cancellare l’account', async () => {
    const res = await DELETE(req('DELETE') as never, ctx as never);
    expect(res.status).toBe(200);
    expect(tx.event.findMany).toHaveBeenCalledWith(atteso);
    expect(tx.event.update.mock.invocationCallOrder[0]).toBeLessThan(
      tx.staffAccount.deleteMany.mock.invocationCallOrder[0]!,
    );
  });
});
