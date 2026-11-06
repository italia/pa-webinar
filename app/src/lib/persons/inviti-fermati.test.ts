// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { publicRegistrationFor } from '@/lib/events/access-mode';

import { fermaInviti, indirizzoFermato, riapriInviti } from './inviti-fermati';

/** Le scritture sui soli inviti: la regola si prova anche su Postgres (rubrica.db.test.ts). */
const db = {
  eventInvitation: { findMany: vi.fn(), deleteMany: vi.fn(), updateMany: vi.fn() },
  emailOutbox: { deleteMany: vi.fn() },
};
const ADESSO = new Date('2026-11-06T10:00:00Z');
const DOVE = { personId: { in: ['voce'] } };

beforeEach(() => {
  vi.clearAllMocks();
  db.eventInvitation.findMany.mockResolvedValue([]);
  db.emailOutbox.deleteMany.mockResolvedValue({ count: 0 });
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

describe('fermaInviti e la coda', () => {
  it('toglie dalla coda le email non partite degli inviti fermati, prima di cancellarli', async () => {
    db.eventInvitation.findMany.mockResolvedValue([{ id: 'inv-1' }, { id: 'inv-2' }]);
    await fermaInviti(db as never, DOVE, {
      adesso: ADESSO,
      publicRegistrationEnabled: true,
    });
    expect(db.eventInvitation.findMany.mock.calls[0]![0].where).toEqual({ AND: [DOVE] });
    expect(db.emailOutbox.deleteMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['PENDING', 'FAILED'] },
        OR: [
          { dedupKey: { startsWith: 'event-invitation:inv-1:' } },
          { dedupKey: { startsWith: 'event-invitation:inv-2:' } },
        ],
      },
    });
    expect(db.emailOutbox.deleteMany.mock.invocationCallOrder[0]!).toBeLessThan(
      db.eventInvitation.deleteMany.mock.invocationCallOrder[0]!
    );
  });

  it('senza inviti la coda non si tocca', async () => {
    await fermaInviti(db as never, DOVE, {
      adesso: ADESSO,
      publicRegistrationEnabled: true,
    });
    expect(db.emailOutbox.deleteMany).not.toHaveBeenCalled();
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

describe('indirizzoFermato', () => {
  const db = {
    person: { findUnique: vi.fn() },
    eventInvitation: { findFirst: vi.fn() },
    registration: { findFirst: vi.fn() },
  };
  const fermato = () =>
    indirizzoFermato(db as unknown as Parameters<typeof indirizzoFermato>[0], 'impronta');

  beforeEach(() => {
    db.person.findUnique.mockReset().mockResolvedValue(null);
    db.eventInvitation.findFirst.mockReset().mockResolvedValue(null);
    db.registration.findFirst.mockReset().mockResolvedValue(null);
  });

  it('senza nessuna traccia e’ libero', async () => {
    expect(await fermato()).toBe(false);
  });

  it('una voce con un ritiro lo ferma', async () => {
    db.person.findUnique.mockResolvedValue({ optedInToAddressBook: false, optedOutAt: new Date() });
    expect(await fermato()).toBe(true);
  });

  it('un invito fermato lo ferma anche con una voce attiva', async () => {
    db.person.findUnique.mockResolvedValue({ optedInToAddressBook: true, optedOutAt: null });
    db.eventInvitation.findFirst.mockResolvedValue({ id: 'altro' });
    expect(await fermato()).toBe(true);
  });

  it('senza voce lo ricorda un’iscrizione', async () => {
    db.registration.findFirst.mockResolvedValue({ id: 'iscrizione' });
    expect(await fermato()).toBe(true);
  });

  it('una voce attiva ha superato un ritiro vecchio rimasto sulle iscrizioni', async () => {
    db.person.findUnique.mockResolvedValue({ optedInToAddressBook: true, optedOutAt: null });
    db.registration.findFirst.mockResolvedValue({ id: 'iscrizione' });
    expect(await fermato()).toBe(false);
  });

  it('una voce mai entrata in rubrica non supera il ritiro di un’iscrizione', async () => {
    db.person.findUnique.mockResolvedValue({ optedInToAddressBook: false, optedOutAt: null });
    db.registration.findFirst.mockResolvedValue({ id: 'iscrizione' });
    expect(await fermato()).toBe(true);
  });
});
