// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { publicRegistrationFor } from '@/lib/events/access-mode';

import { fermaInviti, riapriInviti } from './inviti-fermati';

/** Le scritture sui soli inviti: la regola si prova anche su Postgres (rubrica.db.test.ts). */
const db = { eventInvitation: { deleteMany: vi.fn(), updateMany: vi.fn() } };
const ADESSO = new Date('2026-11-06T10:00:00Z');
const DOVE = { personId: { in: ['voce'] } };

beforeEach(() => {
  vi.clearAllMocks();
  db.eventInvitation.deleteMany.mockResolvedValue({ count: 0 });
  db.eventInvitation.updateMany.mockResolvedValue({ count: 0 });
});

/** Il filtro sugli eventi aperti, riletto su un evento in memoria. */
function aperto(
  accessMode: 'OPEN' | 'INVITATION' | null,
  publicRegistrationEnabled: boolean
) {
  return async () => {
    await fermaInviti(db as never, DOVE, { adesso: ADESSO, publicRegistrationEnabled });
    const { event } = db.eventInvitation.deleteMany.mock.calls[0]![0].where as {
      event: { accessMode?: string | null; OR?: { accessMode: string | null }[] };
    };
    const ammessi = event.OR ?? [{ accessMode: event.accessMode ?? null }];
    return ammessi.some((a) => a.accessMode === accessMode);
  };
}

describe('fermaInviti', () => {
  it.each([
    ['OPEN', true],
    ['OPEN', false],
    ['INVITATION', true],
    ['INVITATION', false],
    [null, true],
    [null, false],
  ] as const)(
    'accessMode %s, sito aperto %s: la stessa risposta di publicRegistrationFor',
    async (accessMode, sito) => {
      expect(await aperto(accessMode, sito)()).toBe(
        publicRegistrationFor({ accessMode }, sito)
      );
    }
  );

  it('cancella solo i non spediti, poi segna tutte le righe rimaste', async () => {
    const ordine: string[] = [];
    db.eventInvitation.deleteMany.mockImplementation(async () => {
      ordine.push('cancella');
      return { count: 0 };
    });
    db.eventInvitation.updateMany.mockImplementation(async () => {
      ordine.push('ferma');
      return { count: 0 };
    });
    await fermaInviti(db as never, DOVE, {
      adesso: ADESSO,
      publicRegistrationEnabled: true,
    });
    expect(db.eventInvitation.deleteMany.mock.calls[0]![0].where).toMatchObject({
      AND: [DOVE],
      sentAt: null,
    });
    expect(db.eventInvitation.updateMany).toHaveBeenCalledWith({
      where: { AND: [DOVE], declinedAt: null },
      data: { declinedAt: ADESSO },
    });
    expect(ordine).toEqual(['cancella', 'ferma']);
  });
});

describe('riapriInviti', () => {
  it('toglie lo stop dalle righe di quell’indirizzo', async () => {
    await riapriInviti(db as never, 'impronta');
    expect(db.eventInvitation.updateMany).toHaveBeenCalledWith({
      where: { emailHash: 'impronta', declinedAt: { not: null } },
      data: { declinedAt: null },
    });
  });
});
