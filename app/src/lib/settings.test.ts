import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Prisma } from '@prisma/client';

const upsert = vi.fn();
const findUniqueOrThrow = vi.fn();
vi.mock('./db', () => ({
  prisma: {
    siteSetting: {
      upsert: (...a: unknown[]) => upsert(...a),
      findUniqueOrThrow: (...a: unknown[]) => findUniqueOrThrow(...a),
    },
  },
}));

import { getSettings, invalidateSettingsCache, nomeEnte } from './settings';

describe('nomeEnte', () => {
  it("restituisce il nome dell'ente configurato", () => {
    expect(nomeEnte({ organizationName: 'Comune di Esempio' })).toBe('Comune di Esempio');
  });

  it('senza nome, o con soli spazi, dichiara il dato mancante invece di inventarlo', () => {
    expect(nomeEnte({ organizationName: '' })).toBeNull();
    expect(nomeEnte({ organizationName: '   ' })).toBeNull();
  });
});

describe('getSettings', () => {
  beforeEach(() => {
    invalidateSettingsCache();
    upsert.mockReset();
    findUniqueOrThrow.mockReset();
  });

  it('se un’altra richiesta ha appena creato la riga, la rilegge invece di fallire', async () => {
    upsert.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' }),
    );
    findUniqueOrThrow.mockResolvedValue({ id: 'singleton', siteName: 'PA Webinar' });
    await expect(getSettings()).resolves.toMatchObject({ id: 'singleton' });
  });

  it('gli altri errori non vengono nascosti', async () => {
    upsert.mockRejectedValue(new Error('database down'));
    await expect(getSettings()).rejects.toThrow('database down');
  });
});
