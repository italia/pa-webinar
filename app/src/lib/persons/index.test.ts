// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * La voce di rubrica all'iscrizione: la tocca solo la spunta. Solo la spunta
 * sposta la data del consenso da cui si contano i mesi di conservazione.
 */
vi.mock('@/lib/crypto/pii', () => ({
  encryptPIIOrNull: (v: string | null | undefined) => (v ? `cifrato:${v}` : null),
}));

import { upsertPersonOnRegistration } from '@/lib/persons';

const ADESSO = new Date('2026-11-06T10:00:00Z');

const tx = {
  person: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  eventInvitation: { updateMany: vi.fn() },
};
const db = tx as never;

const iscrizione = {
  emailHash: 'impronta',
  email: 'email-cifrata',
  displayName: 'Persona 1',
  organization: 'Ente',
  organizationRole: 'Ruolo',
  organizationType: 'MINISTRY',
} as const;

beforeEach(() => {
  vi.useFakeTimers({ now: ADESSO });
  vi.clearAllMocks();
  tx.person.create.mockResolvedValue({ id: 'nuova' });
  tx.person.update.mockResolvedValue({ id: 'voce' });
  tx.eventInvitation.updateMany.mockResolvedValue({ count: 0 });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('upsertPersonOnRegistration', () => {
  it('senza spunta e senza voce non crea niente', async () => {
    tx.person.findUnique.mockResolvedValue(null);
    expect(
      await upsertPersonOnRegistration(db, { ...iscrizione, optedIn: false })
    ).toBeNull();
    expect(tx.person.create).not.toHaveBeenCalled();
    expect(tx.person.update).not.toHaveBeenCalled();
  });

  it('senza spunta una voce esistente si collega e non cambia: niente rinnovo', async () => {
    tx.person.findUnique.mockResolvedValue({ id: 'voce' });
    expect(await upsertPersonOnRegistration(db, { ...iscrizione, optedIn: false })).toBe(
      'voce'
    );
    expect(tx.person.update).not.toHaveBeenCalled();
    expect(tx.eventInvitation.updateMany).not.toHaveBeenCalled();
  });

  it("la prima spunta crea la voce con l'email gia' cifrata, senza cifrarla di nuovo", async () => {
    tx.person.findUnique.mockResolvedValue(null);
    expect(await upsertPersonOnRegistration(db, { ...iscrizione, optedIn: true })).toBe(
      'nuova'
    );
    expect(tx.person.create.mock.calls[0]![0].data).toEqual({
      emailHash: 'impronta',
      email: 'email-cifrata',
      displayName: 'cifrato:Persona 1',
      organization: 'Ente',
      organizationRole: 'Ruolo',
      organizationType: 'MINISTRY',
      optedInToAddressBook: true,
      optedInAt: ADESSO,
      lastActiveAt: ADESSO,
    });
  });

  it('una nuova spunta rinnova il consenso e aggiorna email e profilo', async () => {
    tx.person.findUnique.mockResolvedValue({ id: 'voce' });
    expect(await upsertPersonOnRegistration(db, { ...iscrizione, optedIn: true })).toBe(
      'voce'
    );
    expect(tx.person.update).toHaveBeenCalledWith({
      where: { id: 'voce' },
      select: { id: true },
      data: expect.objectContaining({
        email: 'email-cifrata',
        optedInAt: ADESSO,
        lastActiveAt: ADESSO,
        optedOutAt: null,
        optedInToAddressBook: true,
      }),
    });
  });

  it('una spunta riapre gli inviti fermati di quell’indirizzo', async () => {
    tx.person.findUnique.mockResolvedValue(null);
    await upsertPersonOnRegistration(db, { ...iscrizione, optedIn: true });
    expect(tx.eventInvitation.updateMany).toHaveBeenCalledWith({
      where: { emailHash: 'impronta', declinedAt: { not: null } },
      data: { declinedAt: null },
    });
  });

  it("senza email nell'ingresso quella della voce resta com'e'", async () => {
    tx.person.findUnique.mockResolvedValue({ id: 'voce' });
    const { email: _email, ...senzaEmail } = iscrizione;
    await upsertPersonOnRegistration(db, { ...senzaEmail, optedIn: true });
    expect(tx.person.update.mock.calls[0]![0].data.email).toBeUndefined();
  });
});
