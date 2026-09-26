// @vitest-environment node
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Le email da spedire una volta sola: la garanzia è l'indice unico della
 * colonna dedup_key, non una lettura prima della scrittura.
 */
vi.mock('@/lib/db', () => ({ prisma: { emailOutbox: { create: vi.fn() } } }));
vi.mock('@/lib/crypto/pii', () => ({ encryptPII: (v: string) => `enc:${v}` }));

import { prisma } from '@/lib/db';

import { enqueueEmailOnce } from './outbox';

const create = prisma.emailOutbox.create as unknown as ReturnType<typeof vi.fn>;
const input = { to: 'a@example.test', subject: 'S', html: '<p>h</p>', dedupKey: 'k1' };

beforeEach(() => vi.clearAllMocks());

describe('enqueueEmailOnce', () => {
  it('accoda la riga con la chiave nella sua colonna', async () => {
    create.mockResolvedValue({ id: 'r1' });
    expect(await enqueueEmailOnce(input)).toBe(true);
    expect(create.mock.calls[0]![0].data).toMatchObject({ dedupKey: 'k1' });
  });

  it('con la stessa chiave già presente non accoda e non lancia', async () => {
    create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    expect(await enqueueEmailOnce(input)).toBe(false);
  });

  it('un altro errore del database risale a chi chiama', async () => {
    create.mockRejectedValue(new Error('connection lost'));
    await expect(enqueueEmailOnce(input)).rejects.toThrow('connection lost');
  });
});
