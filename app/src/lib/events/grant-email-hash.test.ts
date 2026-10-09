import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: { eventModerator: { findMany: vi.fn(), update: vi.fn() } },
}));
vi.mock('@/lib/crypto/pii', () => ({
  tryDecryptPII: (v: string | null) => {
    if (v === 'chiave-sbagliata') throw new Error('key');
    return v === 'illeggibile' ? null : v;
  },
  hashEmail: (v: string) => `hash:${v}`,
}));

import { prisma } from '@/lib/db';

import { completaImprontaConcessioni } from './grant-email-hash';

const db = prisma as unknown as {
  eventModerator: { findMany: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};

beforeEach(() => vi.clearAllMocks());

describe('completaImprontaConcessioni', () => {
  it('scrive l’impronta solo sulle concessioni senza segno di organizzatore', async () => {
    db.eventModerator.findMany
      .mockResolvedValueOnce([{ id: 'a', email: 'a@example.test' }])
      .mockResolvedValueOnce([]);
    expect(await completaImprontaConcessioni(10)).toBe(1);
    expect(db.eventModerator.findMany.mock.calls[0]![0].where).toEqual({
      emailHash: null,
      email: { not: null },
      organizer: false,
    });
    expect(db.eventModerator.update).toHaveBeenCalledWith({
      where: { id: 'a' },
      data: { emailHash: 'hash:a@example.test' },
    });
  });

  it('va oltre le righe che non si leggono, invece di fermarsi su di esse', async () => {
    db.eventModerator.findMany
      .mockResolvedValueOnce([
        { id: 'a', email: 'illeggibile' },
        { id: 'b', email: 'chiave-sbagliata' },
        { id: 'c', email: 'non-un-indirizzo' },
      ])
      .mockResolvedValueOnce([{ id: 'd', email: 'd@example.test' }])
      .mockResolvedValueOnce([]);
    expect(await completaImprontaConcessioni(10)).toBe(1);
    // La seconda pagina parte dopo l'ultima riga letta.
    expect(db.eventModerator.findMany.mock.calls[1]![0].where.id).toEqual({ gt: 'c' });
    expect(db.eventModerator.update).toHaveBeenCalledTimes(1);
  });
});
