// @vitest-environment node
/**
 * La revoca dal link delle email: un solo consenso copre rubrica e
 * informazioni sui prossimi eventi, quindi la revoca li toglie entrambi.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    person: { findUnique: vi.fn(), update: vi.fn() },
    registration: { updateMany: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}));
vi.mock('@/lib/persons/opt-out-token', () => ({
  verifyRubricaOptOutToken: (token: string) => (token === 'buono' ? { personId: 'p-1' } : null),
}));

import { prisma } from '@/lib/db';

import { POST } from './route';

function revoca(token: string): Promise<Response> {
  const request = new Request(`http://localhost:3000/api/rubrica/opt-out?token=${token}`, {
    method: 'POST',
    headers: { 'x-forwarded-for': '10.9.0.1' },
  });
  return POST(request as never, { params: Promise.resolve({}) } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.person.findUnique).mockResolvedValue({
    id: 'p-1',
    displayName: 'x',
    organization: null,
    optedInToAddressBook: true,
    optedOutAt: null,
  } as never);
});

describe('POST /api/rubrica/opt-out', () => {
  it('toglie la persona dalla rubrica e revoca le informazioni sui prossimi eventi', async () => {
    const res = await revoca('buono');
    expect(res.status).toBe(200);
    expect(prisma.person.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p-1' },
        data: expect.objectContaining({ optedInToAddressBook: false }),
      }),
    );
    expect(prisma.registration.updateMany).toHaveBeenCalledWith({
      where: { personId: 'p-1', consentFutureCommunications: true },
      data: { consentFutureCommunications: false },
    });
  });

  it('un token non valido non tocca niente', async () => {
    const res = await revoca('cattivo');
    expect(res.status).toBe(401);
    expect(prisma.person.update).not.toHaveBeenCalled();
    expect(prisma.registration.updateMany).not.toHaveBeenCalled();
  });
});
