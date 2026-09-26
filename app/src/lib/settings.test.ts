import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Prisma } from '@prisma/client';

const findUnique = vi.fn();
const createMany = vi.fn();
const findUniqueOrThrow = vi.fn();
vi.mock('./db', () => ({
  prisma: {
    siteSetting: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      createMany: (...a: unknown[]) => createMany(...a),
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
    findUnique.mockReset();
    createMany.mockReset();
    findUniqueOrThrow.mockReset();
  });

  it('con la riga gia\' presente la legge e basta, senza tentare di crearla', async () => {
    findUnique.mockResolvedValue({ id: 'singleton', siteName: 'PA Webinar' });
    await expect(getSettings()).resolves.toMatchObject({ id: 'singleton' });
    expect(createMany).not.toHaveBeenCalled();
  });

  it('su un\'installazione nuova la crea senza errori anche se un\'altra richiesta arriva prima', async () => {
    findUnique.mockResolvedValue(null);
    // `skipDuplicates`: un conflitto non e' un errore, la riga c'e' comunque.
    createMany.mockResolvedValue({ count: 0 });
    findUniqueOrThrow.mockResolvedValue({ id: 'singleton', siteName: 'PA Webinar' });
    await expect(getSettings()).resolves.toMatchObject({ id: 'singleton' });
    expect(createMany).toHaveBeenCalledWith({
      data: [{ id: 'singleton' }],
      skipDuplicates: true,
    });
  });

  it('se il vincolo di unicita\' scatta comunque, rilegge la riga invece di fallire', async () => {
    findUnique.mockResolvedValue(null);
    createMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' }),
    );
    findUniqueOrThrow.mockResolvedValue({ id: 'singleton', siteName: 'PA Webinar' });
    await expect(getSettings()).resolves.toMatchObject({ id: 'singleton' });
  });

  it('gli altri errori non vengono nascosti', async () => {
    findUnique.mockResolvedValue(null);
    createMany.mockRejectedValue(new Error('database down'));
    await expect(getSettings()).rejects.toThrow('database down');
  });

  it('un errore di lettura non viene nascosto', async () => {
    findUnique.mockRejectedValue(new Error('database down'));
    await expect(getSettings()).rejects.toThrow('database down');
    expect(createMany).not.toHaveBeenCalled();
  });
});
