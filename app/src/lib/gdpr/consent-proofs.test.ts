// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  registration: { findMany: vi.fn() },
  recordingConsent: { findMany: vi.fn() },
  multitrackConsent: { findMany: vi.fn() },
  retainedConsentProof: { findMany: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/crypto/pii', () => ({ tryDecryptPII: (v: string) => `chiaro:${v}` }));

import {
  improntaTitolare,
  leggiRigheProve,
  periodiSostituiti,
  proveConsensoEvento,
  riepilogoProve,
} from './consent-proofs';

const REG = '11111111-2222-4333-8444-555555555555';
const t = (s: string) => new Date(`2026-11-01T${s}:00Z`);

beforeEach(() => {
  vi.clearAllMocks();
  db.retainedConsentProof.findMany.mockResolvedValue([]);
  db.registration.findMany.mockResolvedValue([
    {
      id: REG,
      displayName: 'iscritta',
      consentTimestamp: t('09:00'),
      consentRecording: true,
      consentRecordingWithdrawnAt: t('10:30'),
      consentMultitrack: true,
      consentMultitrackVersion: 2,
      consentMultitrackWithdrawnAt: null,
    },
  ]);
  db.recordingConsent.findMany.mockResolvedValue([
    {
      displayName: 'ospite',
      jitsiUserId: 'guest-1',
      registrationId: null,
      eventModeratorId: null,
      staffAccountId: null,
      consentedAt: t('10:00'),
      withdrawnAt: null,
    },
    {
      displayName: 'relatrice',
      jitsiUserId: 'mod-e-1',
      registrationId: null,
      eventModeratorId: 'g1',
      staffAccountId: null,
      consentedAt: t('09:30'),
      withdrawnAt: null,
    },
    // La stessa relatrice, rientrata: una persona sola.
    {
      displayName: 'relatrice',
      jitsiUserId: 'mod-e-2',
      registrationId: null,
      eventModeratorId: 'g1',
      staffAccountId: null,
      consentedAt: t('09:45'),
      withdrawnAt: null,
    },
  ]);
  db.multitrackConsent.findMany.mockResolvedValue([
    {
      displayName: 'iscritta',
      jitsiUserId: `reg-${REG}-aa`,
      registrationId: REG,
      consentedAt: t('10:05'),
      withdrawnAt: t('10:20'),
      textVersion: 2,
    },
  ]);
});

describe('proveConsensoEvento', () => {
  it('una riga per prova, in ordine di tempo, con ruolo, origine e ritiro', async () => {
    const righe = await proveConsensoEvento('e1');
    expect(
      righe.map((r) => [r.kind, r.source, r.role, r.name, r.withdrawnAt !== null])
    ).toEqual([
      ['recording', 'registration', 'registrant', 'chiaro:iscritta', true],
      ['transcription', 'registration', 'registrant', 'chiaro:iscritta', false],
      ['recording', 'room', 'host', 'chiaro:relatrice', false],
      ['recording', 'room', 'host', 'chiaro:relatrice', false],
      ['recording', 'room', 'guest', 'chiaro:ospite', false],
      ['transcription', 'room', 'registrant', 'chiaro:iscritta', true],
    ]);
    expect(righe[1]!.textVersion).toBe(2);
    expect(righe[0]!.textVersion).toBeNull();
  });

  it('il riepilogo conta persone, non righe: chi rientra conta una volta', async () => {
    // Iscritta: registrazione ritirata; trascrizione data all'iscrizione (vale)
    // e ritirata in sala in un altro momento: vale ancora la prima.
    expect(riepilogoProve(await proveConsensoEvento('e1'))).toEqual({
      recording: { given: 2, withdrawn: 1 },
      transcription: { given: 1, withdrawn: 0 },
    });
  });

  it('senza nomi non decifra niente', async () => {
    const righe = await proveConsensoEvento('e1', { nomi: false });
    expect(righe.every((r) => r.name === null)).toBe(true);
    expect(db.recordingConsent.findMany.mock.calls[0]![0].select.displayName).toBe(false);
  });

  it('un consenso ridato dopo un ritiro porta anche i periodi di prima', async () => {
    db.registration.findMany.mockResolvedValue([]);
    db.multitrackConsent.findMany.mockResolvedValue([]);
    db.recordingConsent.findMany.mockResolvedValue([
      {
        displayName: 'iscritta',
        jitsiUserId: `reg-${REG}-bb`,
        registrationId: REG,
        eventModeratorId: null,
        staffAccountId: null,
        consentedAt: t('11:00'),
        withdrawnAt: null,
        earlierPeriods: [
          {
            consentedAt: t('10:00').toISOString(),
            withdrawnAt: t('10:30').toISOString(),
          },
        ],
      },
    ]);
    const righe = await proveConsensoEvento('e1');
    expect(righe.map((r) => [r.givenAt, r.withdrawnAt])).toEqual([
      [t('10:00').toISOString(), t('10:30').toISOString()],
      [t('11:00').toISOString(), null],
    ]);
    expect(riepilogoProve(righe).recording).toEqual({ given: 1, withdrawn: 0 });
  });

  describe('un periodo sostituito da uno successivo', () => {
    /** La prova di un'iscritta, con il periodo di prima chiuso da una sostituzione. */
    const sostituita = (altri: Record<string, unknown> = {}) => {
      db.registration.findMany.mockResolvedValue([]);
      db.multitrackConsent.findMany.mockResolvedValue([]);
      db.recordingConsent.findMany.mockResolvedValue([
        {
          displayName: 'iscritta',
          jitsiUserId: `reg-${REG}-bb`,
          registrationId: REG,
          eventModeratorId: null,
          staffAccountId: null,
          consentedAt: t('11:00'),
          withdrawnAt: null,
          destination: 'PUBLIC',
          textVersion: 1,
          earlierPeriods: [
            {
              consentedAt: t('10:00').toISOString(),
              withdrawnAt: null,
              destination: 'REGISTRANTS',
              textVersion: 1,
            },
          ],
          ...altri,
        },
      ]);
    };

    it('resta come prova del suo testo, e il consenso vale una volta', async () => {
      sostituita();
      const righe = await proveConsensoEvento('e1');
      expect(righe.map((r) => [r.destination, r.withdrawnAt, r.superata])).toEqual([
        ['REGISTRANTS', null, true],
        ['PUBLIC', null, false],
      ]);
      expect(riepilogoProve(righe).recording).toEqual({ given: 1, withdrawn: 0 });
    });

    it('chi ritira dopo la sostituzione ha ritirato', async () => {
      sostituita({ withdrawnAt: t('11:30') });
      expect(riepilogoProve(await proveConsensoEvento('e1')).recording).toEqual({
        given: 0,
        withdrawn: 1,
      });
    });

    it('sostituito, ritirato e ridato: il consenso vale', async () => {
      sostituita({
        consentedAt: t('12:00'),
        earlierPeriods: [
          { consentedAt: t('10:00').toISOString(), withdrawnAt: null },
          {
            consentedAt: t('11:00').toISOString(),
            withdrawnAt: t('11:30').toISOString(),
          },
        ],
      });
      const righe = await proveConsensoEvento('e1');
      expect(righe.map((r) => r.superata)).toEqual([true, false, false]);
      expect(riepilogoProve(righe).recording).toEqual({ given: 1, withdrawn: 0 });
    });

    it('un periodo ritirato resta un ritiro', async () => {
      sostituita({
        earlierPeriods: [
          {
            consentedAt: t('10:00').toISOString(),
            withdrawnAt: t('10:30').toISOString(),
          },
        ],
      });
      expect((await proveConsensoEvento('e1')).map((r) => r.superata)).toEqual([
        false,
        false,
      ]);
    });

    it('dopo la copia si riconosce uguale: nessun nuovo consenso valido', async () => {
      db.registration.findMany.mockResolvedValue([]);
      db.multitrackConsent.findMany.mockResolvedValue([]);
      db.recordingConsent.findMany.mockResolvedValue([]);
      const conservata = {
        kind: 'recording',
        source: 'room',
        role: 'registrant',
        holderHash: 'impronta',
        displayName: null,
        nameRemovedAt: null,
        textVersion: 1,
        destination: 'PUBLIC',
      };
      db.retainedConsentProof.findMany.mockResolvedValue([
        { ...conservata, givenAt: t('10:00'), withdrawnAt: null },
        { ...conservata, givenAt: t('11:00'), withdrawnAt: t('11:30') },
      ]);
      const righe = await proveConsensoEvento('e1');
      expect(righe.map((r) => r.superata)).toEqual([true, false]);
      expect(riepilogoProve(righe).recording).toEqual({ given: 0, withdrawn: 1 });
    });
  });

  it('riporta destinazione e versione del testo, anche dei periodi precedenti', async () => {
    db.registration.findMany.mockResolvedValue([
      {
        id: REG,
        displayName: 'iscritta',
        consentTimestamp: t('09:00'),
        consentRecording: true,
        consentRecordingDestination: 'REGISTRANTS',
        consentRecordingVersion: 1,
        consentRecordingWithdrawnAt: null,
        consentMultitrack: false,
      },
    ]);
    db.multitrackConsent.findMany.mockResolvedValue([]);
    db.recordingConsent.findMany.mockResolvedValue([
      {
        displayName: 'ospite',
        jitsiUserId: 'guest-1',
        registrationId: null,
        eventModeratorId: null,
        staffAccountId: null,
        consentedAt: t('11:00'),
        withdrawnAt: null,
        destination: 'PUBLIC',
        textVersion: 1,
        earlierPeriods: [
          // Un periodo scritto prima che il testo dichiarasse la destinazione.
          { consentedAt: t('10:00').toISOString(), withdrawnAt: t('10:10').toISOString() },
          {
            consentedAt: t('10:20').toISOString(),
            withdrawnAt: t('10:30').toISOString(),
            destination: 'REGISTRANTS',
            textVersion: 1,
          },
          'non e’ un periodo',
        ],
      },
    ]);
    const righe = await proveConsensoEvento('e1');
    expect(righe.map((r) => [r.destination, r.textVersion])).toEqual([
      ['REGISTRANTS', 1],
      [null, null],
      ['REGISTRANTS', 1],
      ['PUBLIC', 1],
    ]);
  });

  it('legge anche le prove conservate: nome, nome tolto e stessa impronta', async () => {
    const adesso = t('12:00');
    const impronta = improntaTitolare('e1', `reg:${REG}`);
    db.retainedConsentProof.findMany.mockResolvedValue([
      {
        kind: 'recording',
        source: 'registration',
        role: 'registrant',
        holderHash: impronta,
        displayName: 'cifrato',
        nameRemovedAt: null,
        textVersion: 1,
        destination: 'PUBLIC',
        givenAt: t('08:00'),
        withdrawnAt: null,
      },
      {
        kind: 'recording',
        source: 'room',
        role: 'guest',
        holderHash: 'altra',
        displayName: null,
        nameRemovedAt: adesso,
        textVersion: null,
        destination: null,
        givenAt: t('08:30'),
        withdrawnAt: adesso,
      },
    ]);
    const righe = await proveConsensoEvento('e1');
    expect(db.retainedConsentProof.findMany.mock.calls[0]![0].where).toEqual({ eventId: 'e1' });
    expect(righe[0]).toMatchObject({
      name: 'chiaro:cifrato',
      nomeRimosso: false,
      conservata: true,
      givenAt: t('08:00').toISOString(),
    });
    expect(righe[1]).toMatchObject({ name: null, nomeRimosso: true, conservata: true });
    // La stessa persona con la sorgente viva e con la prova conservata conta una
    // volta: quella della riga ritirata resta valida grazie alla conservata.
    expect(riepilogoProve(righe).recording).toEqual({ given: 3, withdrawn: 1 });
  });

  it('il titolare non esce in chiaro', async () => {
    const righe = await proveConsensoEvento('e1');
    expect(righe.every((r) => /^[0-9a-f]{64}$/.test(r.holder))).toBe(true);
  });

  it('senza nomi non legge il nome delle prove conservate', async () => {
    await proveConsensoEvento('e1', { nomi: false });
    expect(db.retainedConsentProof.findMany.mock.calls[0]![0].select.displayName).toBe(false);
  });
});

describe('periodiSostituiti', () => {
  const periodo = (givenAt: string, withdrawnAt: string | null, altri = {}) => ({
    kind: 'recording',
    source: 'room',
    role: 'registrant',
    holderHash: 'impronta',
    givenAt: t(givenAt),
    withdrawnAt: withdrawnAt ? t(withdrawnAt) : null,
    ...altri,
  });

  it('un periodo aperto seguito da un altro e’ sostituito; l’ultimo no', () => {
    const [primo, secondo] = [periodo('10:00', null), periodo('11:00', null)];
    expect([...periodiSostituiti([secondo, primo])]).toEqual([primo]);
  });

  it('un periodo ritirato prima del successivo non e’ sostituito', () => {
    expect(
      periodiSostituiti([periodo('10:00', '10:30'), periodo('11:00', null)]).size
    ).toBe(0);
  });

  it('un ritiro scritto dopo la copia lo lascia sostituito', () => {
    const primo = periodo('10:00', '12:00');
    expect([...periodiSostituiti([primo, periodo('11:00', '12:00')])]).toEqual([primo]);
  });

  it('la prova dell’iscrizione non e’ un periodo di quella di sala', () => {
    expect(
      periodiSostituiti([
        periodo('09:00', null, { source: 'registration' }),
        periodo('10:00', null),
      ]).size
    ).toBe(0);
  });

  it('le prove di sala di chi conduce sono una per posto, e non si sostituiscono', () => {
    expect(
      periodiSostituiti([
        periodo('10:00', null, { role: 'host' }),
        periodo('11:00', '11:30', { role: 'host' }),
      ]).size
    ).toBe(0);
  });

  it('non mescola titolari diversi', () => {
    expect(
      periodiSostituiti([
        periodo('10:00', null),
        periodo('11:00', null, { holderHash: 'altra' }),
      ]).size
    ).toBe(0);
  });
});

describe('leggiRigheProve', () => {
  it('senza filtri legge tutto l’evento, con il cifrato e gli indirizzi', async () => {
    db.registration.findMany.mockResolvedValue([
      {
        id: REG,
        displayName: 'iscritta',
        emailHash: 'impronta-iscritta',
        locale: 'it',
        consentTimestamp: t('09:00'),
        consentRecording: true,
        consentRecordingWithdrawnAt: null,
        consentMultitrack: false,
      },
    ]);
    db.recordingConsent.findMany.mockResolvedValue([
      {
        displayName: 'relatrice',
        jitsiUserId: 'mod-e-1',
        registrationId: null,
        eventModeratorId: 'g1',
        staffAccountId: null,
        locale: 'en',
        consentedAt: t('09:30'),
        withdrawnAt: null,
        eventModerator: { emailHash: 'impronta-relatrice' },
      },
      {
        displayName: 'staff',
        jitsiUserId: 'mod-e-2',
        registrationId: null,
        eventModeratorId: null,
        staffAccountId: 's1',
        locale: null,
        consentedAt: t('09:40'),
        withdrawnAt: null,
        staffAccount: { emailHash: 'impronta-staff' },
      },
    ]);
    db.multitrackConsent.findMany.mockResolvedValue([
      {
        displayName: 'iscritta',
        jitsiUserId: `reg-${REG}-aa`,
        registrationId: REG,
        locale: 'it',
        consentedAt: t('10:05'),
        withdrawnAt: null,
        textVersion: 2,
        registration: { emailHash: 'impronta-iscritta' },
      },
    ]);
    const righe = await leggiRigheProve(
      db as unknown as Parameters<typeof leggiRigheProve>[0],
      'e1'
    );
    expect(db.registration.findMany.mock.calls[0]![0].where.id).toBeUndefined();
    expect(righe.map((r) => [r.displayName, r.emailHash, r.holder])).toEqual([
      ['iscritta', 'impronta-iscritta', `reg:${REG}`],
      ['relatrice', 'impronta-relatrice', 'concessione:g1'],
      ['staff', 'impronta-staff', 'staff:s1'],
      ['iscritta', 'impronta-iscritta', `reg:${REG}`],
    ]);
  });

  it('un ospite non ha un indirizzo', async () => {
    const righe = await leggiRigheProve(
      db as unknown as Parameters<typeof leggiRigheProve>[0],
      'e1'
    );
    expect(righe.find((r) => r.holder === 'posto:guest-1')?.emailHash).toBeNull();
  });

  it('filtra per iscrizione', async () => {
    await leggiRigheProve(db as unknown as Parameters<typeof leggiRigheProve>[0], 'e1', {
      registrationIds: ['r1'],
    });
    expect(db.registration.findMany.mock.calls[0]![0].where.id).toEqual({ in: ['r1'] });
    expect(db.recordingConsent.findMany.mock.calls[0]![0].where.OR).toEqual([
      { registrationId: { in: ['r1'] } },
      { eventModeratorId: { in: [] } },
      { staffAccountId: { in: [] } },
    ]);
    expect(db.multitrackConsent.findMany.mock.calls[0]![0].where.registrationId).toEqual({
      in: ['r1'],
    });
  });

  it('filtra per concessione: restano fuori le prove delle iscrizioni', async () => {
    await leggiRigheProve(db as unknown as Parameters<typeof leggiRigheProve>[0], 'e1', {
      grantIds: ['g1'],
    });
    expect(db.registration.findMany.mock.calls[0]![0].where.id).toEqual({ in: [] });
    expect(db.recordingConsent.findMany.mock.calls[0]![0].where.OR).toEqual([
      { registrationId: { in: [] } },
      { eventModeratorId: { in: ['g1'] } },
      { staffAccountId: { in: [] } },
    ]);
    expect(db.multitrackConsent.findMany.mock.calls[0]![0].where.registrationId).toEqual({
      in: [],
    });
  });

  it('filtra per account dello staff: restano fuori le prove delle iscrizioni', async () => {
    await leggiRigheProve(db as unknown as Parameters<typeof leggiRigheProve>[0], 'e1', {
      staffAccountIds: ['s1'],
    });
    expect(db.registration.findMany.mock.calls[0]![0].where.id).toEqual({ in: [] });
    expect(db.recordingConsent.findMany.mock.calls[0]![0].where.OR).toEqual([
      { registrationId: { in: [] } },
      { eventModeratorId: { in: [] } },
      { staffAccountId: { in: ['s1'] } },
    ]);
  });
});
