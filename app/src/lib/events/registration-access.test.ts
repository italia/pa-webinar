import { beforeEach, describe, expect, it, vi } from 'vitest';

const { count } = vi.hoisted(() => ({ count: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: { eventInvitation: { count } } }));

import { registrationAccessFor } from './registration-access';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('registrationAccessFor', () => {
  it('iscrizione pubblica accesa: aperta, senza contare gli inviti', async () => {
    await expect(registrationAccessFor('evt-1', true)).resolves.toBe('open');
    expect(count).not.toHaveBeenCalled();
  });

  it('spenta, con invitati: solo su invito', async () => {
    count.mockResolvedValue(3);
    await expect(registrationAccessFor('evt-1', false)).resolves.toBe('invitation');
    expect(count).toHaveBeenCalledWith({ where: { eventId: 'evt-1' } });
  });

  it('spenta, senza invitati: chiusa', async () => {
    count.mockResolvedValue(0);
    await expect(registrationAccessFor('evt-1', false)).resolves.toBe('closed');
  });
});
