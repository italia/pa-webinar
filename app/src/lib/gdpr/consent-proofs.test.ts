import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  registration: { findMany: vi.fn() },
  recordingConsent: { findMany: vi.fn() },
  multitrackConsent: { findMany: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/crypto/pii', () => ({ tryDecryptPII: (v: string) => `chiaro:${v}` }));

import { proveConsensoEvento, riepilogoProve } from './consent-proofs';

const REG = '11111111-2222-4333-8444-555555555555';
const t = (s: string) => new Date(`2026-11-01T${s}:00Z`);

beforeEach(() => {
  vi.clearAllMocks();
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
});
