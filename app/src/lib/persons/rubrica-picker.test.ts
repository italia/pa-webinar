// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  count: vi.fn(),
  impostazioni: { addressBookEnabled: true as boolean | undefined },
}));
vi.mock('@/lib/db', () => ({ prisma: { person: { count: m.count } } }));
vi.mock('@/lib/settings', () => ({ getSettings: async () => m.impostazioni }));

import { rubricaConPersone } from './rubrica-picker';

beforeEach(() => {
  m.count.mockReset();
  m.count.mockResolvedValue(3);
  m.impostazioni.addressBookEnabled = true;
});

describe('rubricaConPersone', () => {
  it("conta solo chi resta in rubrica e ha un'email nella voce, senza guardare le iscrizioni", async () => {
    expect(await rubricaConPersone()).toBe(true);
    expect(m.count).toHaveBeenCalledWith({
      where: { optedInToAddressBook: true, email: { not: null } },
    });
  });

  it('nessuna voce utile, nessun selettore', async () => {
    m.count.mockResolvedValue(0);
    expect(await rubricaConPersone()).toBe(false);
  });

  it("spenta dall'installazione: niente selettore, anche con persone in rubrica", async () => {
    m.impostazioni.addressBookEnabled = false;
    expect(await rubricaConPersone()).toBe(false);
    expect(m.count).not.toHaveBeenCalled();
  });
});
