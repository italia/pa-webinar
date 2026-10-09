import { beforeEach, describe, expect, it, vi } from 'vitest';

const { count } = vi.hoisted(() => ({ count: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: { eventInvitation: { count } } }));

import { publicRegistrationFor, registrationAccessFor } from './registration-access';

const evento = (accessMode: 'OPEN' | 'INVITATION' | null = null) => ({ id: 'evt-1', accessMode });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('registrationAccessFor', () => {
  it('iscrizione pubblica accesa: aperta, senza contare gli inviti', async () => {
    await expect(registrationAccessFor(evento(), true)).resolves.toBe('open');
    expect(count).not.toHaveBeenCalled();
  });

  it('spenta, con invitati: solo su invito', async () => {
    count.mockResolvedValue(3);
    await expect(registrationAccessFor(evento(), false)).resolves.toBe('invitation');
    expect(count).toHaveBeenCalledWith({ where: { eventId: 'evt-1' } });
  });

  it('spenta, senza invitati: chiusa', async () => {
    count.mockResolvedValue(0);
    await expect(registrationAccessFor(evento(), false)).resolves.toBe('closed');
  });
});

describe('scelta dell evento', () => {
  it('la scelta dell evento vale sopra quella del sito, in tutti e due i sensi', () => {
    expect(publicRegistrationFor({ accessMode: 'OPEN' }, false)).toBe(true);
    expect(publicRegistrationFor({ accessMode: 'INVITATION' }, true)).toBe(false);
    expect(publicRegistrationFor({ accessMode: null }, true)).toBe(true);
    expect(publicRegistrationFor({ accessMode: null }, false)).toBe(false);
  });

  it('solo su invito con il sito aperto: conta gli invitati', async () => {
    count.mockResolvedValue(2);
    await expect(registrationAccessFor(evento('INVITATION'), true)).resolves.toBe('invitation');
    count.mockResolvedValue(0);
    await expect(registrationAccessFor(evento('INVITATION'), true)).resolves.toBe('closed');
  });

  it('aperto con il sito chiuso: aperta', async () => {
    await expect(registrationAccessFor(evento('OPEN'), false)).resolves.toBe('open');
    expect(count).not.toHaveBeenCalled();
  });
});
