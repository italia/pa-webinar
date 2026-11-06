// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { beforeEach, describe, expect, it, vi } from 'vitest';

const tx = vi.hoisted(() => ({
  recordingConsent: { findMany: vi.fn(), updateMany: vi.fn() },
  multitrackConsent: { findMany: vi.fn(), updateMany: vi.fn() },
  registration: { updateMany: vi.fn(), findMany: vi.fn() },
  person: { updateMany: vi.fn() },
  eventInvitation: { findMany: vi.fn(), deleteMany: vi.fn(), updateMany: vi.fn() },
  emailOutbox: { deleteMany: vi.fn() },
  captionSegment: { updateMany: vi.fn() },
  retainedConsentProof: { updateMany: vi.fn() },
  gdprAuditLog: { create: vi.fn(), createMany: vi.fn() },
}));
const trascrizione = vi.hoisted(() => ({
  bloccaTrascrizioneEvento: vi.fn(async () => undefined),
  togliPersoneDalleTrascrizioni: vi.fn(async () => 0),
}));
vi.mock('@/lib/captions/transcript', () => trascrizione);
const transazione = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db', () => ({
  prisma: { $transaction: transazione },
}));
vi.mock('@/lib/settings', () => ({
  getSettings: async () => ({ publicRegistrationEnabled: true }),
}));

import { TIMEOUT_PULIZIA_EVENTO_MS } from '@/lib/gdpr/cleanup-selection';
import { improntaTitolare, titolareAccount } from '@/lib/gdpr/consent-proofs';

import { ritiraComunicazioni, ritiraConsensi } from './consent-withdrawal';

const EVENTO = 'e1';
const ISCRIZIONE = '11111111-2222-4333-8444-555555555555';
const ADESSO = new Date('2026-11-01T10:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  transazione.mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx));
  tx.retainedConsentProof.updateMany.mockResolvedValue({ count: 0 });
  tx.recordingConsent.findMany.mockResolvedValue([]);
  tx.multitrackConsent.findMany.mockResolvedValue([]);
  tx.recordingConsent.updateMany.mockResolvedValue({ count: 0 });
  tx.multitrackConsent.updateMany.mockResolvedValue({ count: 0 });
  tx.registration.updateMany.mockResolvedValue({ count: 0 });
  tx.captionSegment.updateMany.mockResolvedValue({ count: 0 });
  tx.eventInvitation.findMany.mockResolvedValue([]);
});

describe('ritiraConsensi', () => {
  it('puo\' aspettare tutta la pulizia dello stesso evento', async () => {
    await ritiraConsensi(EVENTO, [], { registrazione: true }, ADESSO, {
      iscrizioni: [ISCRIZIONE],
    });
    expect(transazione.mock.calls[0]![1].timeout).toBeGreaterThan(TIMEOUT_PULIZIA_EVENTO_MS);
  });

  it('senza iscrizioni non cerca prove conservate', async () => {
    await ritiraConsensi(EVENTO, ['ospite-1'], { registrazione: true }, ADESSO);
    expect(tx.retainedConsentProof.updateMany).not.toHaveBeenCalled();
  });

  it("l'iscritto ritira tutto cio' che porta la sua iscrizione, di ogni ingresso", async () => {
    tx.registration.updateMany.mockResolvedValue({ count: 1 });
    const esito = await ritiraConsensi(
      EVENTO,
      [`reg-${ISCRIZIONE}-ab12cd34`],
      { registrazione: true },
      ADESSO
    );
    expect(esito).toEqual({ registrazione: true, trascrizione: true });
    // La prova della registrazione: per posto e per iscrizione.
    expect(tx.recordingConsent.updateMany).toHaveBeenCalledWith({
      where: {
        eventId: EVENTO,
        withdrawnAt: null,
        OR: [
          { jitsiUserId: { in: [`reg-${ISCRIZIONE}-ab12cd34`] } },
          { registrationId: { in: [ISCRIZIONE] } },
        ],
      },
      data: { withdrawnAt: ADESSO },
    });
    // Il consenso dato all'iscrizione, per la registrazione e per la trascrizione.
    expect(tx.registration.updateMany).toHaveBeenCalledWith({
      where: {
        eventId: EVENTO,
        id: { in: [ISCRIZIONE] },
        consentRecording: true,
        consentRecordingWithdrawnAt: null,
      },
      data: { consentRecordingWithdrawnAt: ADESSO },
    });
    expect(tx.registration.updateMany).toHaveBeenCalledWith({
      where: {
        eventId: EVENTO,
        id: { in: [ISCRIZIONE] },
        consentMultitrack: true,
        consentMultitrackWithdrawnAt: null,
      },
      data: { consentMultitrackWithdrawnAt: ADESSO },
    });
    // Le frasi dei sottotitoli di ogni posto dell'iscrizione perdono testo, nome e posto.
    expect(tx.captionSegment.updateMany).toHaveBeenCalledWith({
      where: {
        eventId: EVENTO,
        OR: [
          { seatId: { in: [`reg-${ISCRIZIONE}-ab12cd34`] } },
          { seatId: { startsWith: `reg-${ISCRIZIONE}-` } },
        ],
      },
      data: { seatId: null, speakerName: null, text: null },
    });
  });

  it("solo la trascrizione: la registrazione resta com'era", async () => {
    tx.multitrackConsent.updateMany.mockResolvedValue({ count: 1 });
    const esito = await ritiraConsensi(
      EVENTO,
      ['guest-abc'],
      { registrazione: false },
      ADESSO
    );
    expect(esito).toEqual({ registrazione: false, trascrizione: true });
    expect(tx.recordingConsent.updateMany).not.toHaveBeenCalled();
    expect(tx.multitrackConsent.updateMany).toHaveBeenCalledWith({
      where: {
        eventId: EVENTO,
        withdrawnAt: null,
        OR: [{ jitsiUserId: { in: ['guest-abc'] } }],
      },
      data: { withdrawnAt: ADESSO },
    });
    // Un ospite non ha un'iscrizione da toccare.
    expect(tx.registration.updateMany).not.toHaveBeenCalled();
  });

  it('chi conduce dal link primario col suo account ritira anche le prove dei suoi ingressi precedenti', async () => {
    tx.recordingConsent.findMany
      .mockResolvedValueOnce([
        { registrationId: null, eventModeratorId: null, staffAccountId: 'acc-1' },
      ])
      .mockResolvedValueOnce([
        { jitsiUserId: 'mod-e1-aaaa' },
        { jitsiUserId: 'mod-e1-bbbb' },
      ]);
    tx.recordingConsent.updateMany.mockResolvedValue({ count: 2 });
    await ritiraConsensi(EVENTO, ['mod-e1-bbbb'], { registrazione: true }, ADESSO);
    expect(tx.recordingConsent.findMany).toHaveBeenLastCalledWith({
      where: { eventId: EVENTO, staffAccountId: { in: ['acc-1'] } },
      select: { jitsiUserId: true },
    });
    expect(tx.recordingConsent.updateMany).toHaveBeenCalledWith({
      where: {
        eventId: EVENTO,
        withdrawnAt: null,
        OR: [
          { jitsiUserId: { in: ['mod-e1-bbbb', 'mod-e1-aaaa'] } },
          { staffAccountId: { in: ['acc-1'] } },
        ],
      },
      data: { withdrawnAt: ADESSO },
    });
    // La trascrizione dei posti di prima, legati dalla stessa prova.
    expect(tx.multitrackConsent.updateMany).toHaveBeenCalledWith({
      where: {
        eventId: EVENTO,
        withdrawnAt: null,
        OR: [
          { jitsiUserId: { in: ['mod-e1-bbbb', 'mod-e1-aaaa'] } },
          { staffAccountId: { in: ['acc-1'] } },
        ],
      },
      data: { withdrawnAt: ADESSO },
    });
    expect(trascrizione.togliPersoneDalleTrascrizioni).toHaveBeenCalledWith(
      tx,
      [EVENTO],
      [],
      [improntaTitolare(EVENTO, titolareAccount('acc-1'))]
    );
  });

  it('chi ha dato la sola trascrizione col suo account la ritira anche dagli ingressi precedenti', async () => {
    tx.multitrackConsent.findMany
      .mockResolvedValueOnce([{ registrationId: null, staffAccountId: 'acc-1' }])
      .mockResolvedValueOnce([{ jitsiUserId: 'mod-e1-aaaa' }, { jitsiUserId: 'mod-e1-bbbb' }]);
    tx.multitrackConsent.updateMany.mockResolvedValue({ count: 2 });
    tx.captionSegment.updateMany.mockResolvedValue({ count: 4 });

    const esito = await ritiraConsensi(EVENTO, ['mod-e1-bbbb'], { registrazione: false }, ADESSO);

    expect(esito).toEqual({ registrazione: false, trascrizione: true });
    expect(tx.multitrackConsent.updateMany).toHaveBeenCalledWith({
      where: {
        eventId: EVENTO,
        withdrawnAt: null,
        OR: [
          { jitsiUserId: { in: ['mod-e1-bbbb', 'mod-e1-aaaa'] } },
          { staffAccountId: { in: ['acc-1'] } },
        ],
      },
      data: { withdrawnAt: ADESSO },
    });
    expect(tx.captionSegment.updateMany).toHaveBeenCalledWith({
      where: {
        eventId: EVENTO,
        OR: [{ seatId: { in: ['mod-e1-bbbb', 'mod-e1-aaaa'] } }],
      },
      data: { seatId: null, speakerName: null, text: null },
    });
  });

  it("una concessione nominale e' un posto: il ritiro non tocca chi apre lo stesso link altrove", async () => {
    tx.recordingConsent.findMany.mockResolvedValueOnce([
      { registrationId: null, eventModeratorId: 'grant-1', staffAccountId: null },
    ]);
    await ritiraConsensi(EVENTO, ['mod-e1-cccc'], { registrazione: true }, ADESSO);
    // Nessuna ricerca dei posti di altri ingressi con la stessa concessione.
    expect(tx.recordingConsent.findMany).toHaveBeenCalledTimes(1);
    const where = tx.recordingConsent.updateMany.mock.calls[0]![0].where as {
      OR: unknown[];
    };
    expect(where.OR).toEqual([{ jitsiUserId: { in: ['mod-e1-cccc'] } }]);
  });

  it('ogni ritiro lascia una riga nel registro GDPR, senza dati personali', async () => {
    tx.recordingConsent.updateMany.mockResolvedValue({ count: 1 });
    tx.multitrackConsent.updateMany.mockResolvedValue({ count: 2 });
    tx.captionSegment.updateMany.mockResolvedValue({ count: 5 });
    await ritiraConsensi(EVENTO, ['guest-x'], { registrazione: true }, ADESSO);
    expect(tx.gdprAuditLog.create).toHaveBeenCalledWith({
      data: {
        eventId: EVENTO,
        action: 'CONSENT_WITHDRAWN',
        recordCount: 3,
        details: JSON.stringify({
          source: 'room',
          recording: 1,
          transcription: 2,
          captionSegmentsCleared: 5,
        }),
      },
    });
    // Niente da ritirare: nessuna riga.
    vi.clearAllMocks();
    tx.recordingConsent.findMany.mockResolvedValue([]);
    tx.multitrackConsent.findMany.mockResolvedValue([]);
    tx.recordingConsent.updateMany.mockResolvedValue({ count: 0 });
    tx.multitrackConsent.updateMany.mockResolvedValue({ count: 0 });
    tx.captionSegment.updateMany.mockResolvedValue({ count: 0 });
    await ritiraConsensi(EVENTO, ['guest-y'], { registrazione: false }, ADESSO);
    expect(tx.gdprAuditLog.create).not.toHaveBeenCalled();
  });

  it("dal posto di un link inoltrato non si risale all'iscrizione di chi l'aveva", async () => {
    await ritiraConsensi(EVENTO, ['guest-inoltro'], { registrazione: true }, ADESSO);
    expect(tx.registration.updateMany).not.toHaveBeenCalled();
    const where = tx.recordingConsent.updateMany.mock.calls[0]![0].where as {
      OR: unknown[];
    };
    expect(where.OR).toEqual([{ jitsiUserId: { in: ['guest-inoltro'] } }]);
  });

  it('dalla pagina dei propri dati parte dall\'iscrizione, senza posti', async () => {
    tx.registration.updateMany.mockResolvedValue({ count: 1 });
    const esito = await ritiraConsensi(EVENTO, [], { registrazione: true }, ADESSO, {
      iscrizioni: [ISCRIZIONE],
      origine: 'self-service',
    });
    expect(esito.registrazione).toBe(true);
    expect(tx.registration.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: [ISCRIZIONE] }, consentRecording: true }),
      }),
    );
    const dettagli = JSON.parse(tx.gdprAuditLog.create.mock.calls[0]![0].data.details);
    expect(dettagli.source).toBe('self-service');
  });

  it('dopo l\'evento la persona se ne va anche dalla trascrizione gia\' costruita', async () => {
    await ritiraConsensi(EVENTO, [], { registrazione: false }, ADESSO, {
      iscrizioni: [ISCRIZIONE],
      origine: 'self-service',
    });
    expect(trascrizione.bloccaTrascrizioneEvento).toHaveBeenCalledWith(tx, EVENTO);
    expect(trascrizione.togliPersoneDalleTrascrizioni).toHaveBeenCalledWith(
      tx,
      [EVENTO],
      [ISCRIZIONE],
      []
    );
  });

  it('senza posti non tocca niente', async () => {
    expect(await ritiraConsensi(EVENTO, [], { registrazione: true })).toEqual({
      registrazione: false,
      trascrizione: false,
    });
    expect(tx.recordingConsent.findMany).not.toHaveBeenCalled();
  });
});

describe('ritiraComunicazioni', () => {
  it('toglie comunicazioni e rubrica, su ogni iscrizione dell\'indirizzo', async () => {
    tx.registration.findMany.mockResolvedValue([{ eventId: 'e1' }, { eventId: 'e2' }]);
    tx.person.updateMany.mockResolvedValue({ count: 1 });
    expect(await ritiraComunicazioni('impronta', ADESSO)).toBe(true);
    expect(tx.registration.updateMany).toHaveBeenCalledWith({
      where: { emailHash: 'impronta', consentFutureCommunications: true },
      data: { consentFutureCommunications: false, consentFutureCommunicationsWithdrawnAt: ADESSO },
    });
    expect(tx.person.updateMany).toHaveBeenCalledWith({
      where: { emailHash: 'impronta', optedInToAddressBook: true },
      data: { optedInToAddressBook: false, optedOutAt: ADESSO, email: null },
    });
    expect(tx.gdprAuditLog.createMany.mock.calls[0]![0].data).toHaveLength(2);
  });

  it('lascia il segno del ritiro anche sulle iscrizioni senza la spunta', async () => {
    tx.registration.findMany.mockResolvedValue([]);
    tx.person.updateMany.mockResolvedValue({ count: 1 });
    await ritiraComunicazioni('impronta', ADESSO);
    expect(tx.registration.updateMany).toHaveBeenCalledWith({
      where: { emailHash: 'impronta', consentFutureCommunicationsWithdrawnAt: null },
      data: { consentFutureCommunicationsWithdrawnAt: ADESSO },
    });
  });

  it("ferma gli inviti dell'indirizzo, anche quelli scritti a mano", async () => {
    tx.registration.findMany.mockResolvedValue([]);
    tx.person.updateMany.mockResolvedValue({ count: 1 });
    await ritiraComunicazioni('impronta', ADESSO);
    const dove = { OR: [{ emailHash: 'impronta' }, { person: { emailHash: 'impronta' } }] };
    expect(tx.eventInvitation.deleteMany.mock.calls[0]![0].where).toMatchObject({
      AND: [dove],
      sentAt: null,
    });
    expect(tx.eventInvitation.updateMany).toHaveBeenCalledWith({
      where: { AND: [dove], declinedAt: null },
      data: { declinedAt: ADESSO },
    });
  });

  it('toglie le email degli inviti ancora in coda', async () => {
    tx.registration.findMany.mockResolvedValue([]);
    tx.person.updateMany.mockResolvedValue({ count: 1 });
    tx.eventInvitation.findMany.mockResolvedValue([{ id: 'inv-1' }]);
    tx.emailOutbox.deleteMany.mockResolvedValue({ count: 1 });
    await ritiraComunicazioni('impronta', ADESSO);
    expect(tx.emailOutbox.deleteMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['PENDING', 'FAILED'] },
        OR: [{ dedupKey: { startsWith: 'event-invitation:inv-1:' } }],
      },
    });
  });

  it('una spunta in attesa di conferma non sopravvive al ritiro', async () => {
    tx.registration.findMany.mockResolvedValue([]);
    tx.person.updateMany.mockResolvedValue({ count: 0 });
    await ritiraComunicazioni('impronta', ADESSO);
    expect(tx.registration.updateMany).toHaveBeenCalledWith({
      where: { emailHash: 'impronta', addressBookPending: true },
      data: { addressBookPending: false },
    });
  });

  it('la spunta in attesa annullata lascia una riga nel registro', async () => {
    tx.registration.findMany.mockResolvedValue([
      { eventId: 'e1', consentFutureCommunications: false, addressBookPending: true },
      { eventId: 'e2', consentFutureCommunications: true, addressBookPending: false },
    ]);
    tx.person.updateMany.mockResolvedValue({ count: 0 });
    expect(await ritiraComunicazioni('impronta', ADESSO)).toBe(true);
    expect(tx.registration.findMany.mock.calls[0]![0].where).toEqual({
      emailHash: 'impronta',
      OR: [{ consentFutureCommunications: true }, { addressBookPending: true }],
    });
    const righe = tx.gdprAuditLog.createMany.mock.calls[0]![0].data as {
      eventId: string;
      action: string;
      details: string;
    }[];
    expect(righe.map((r) => [r.eventId, r.action, JSON.parse(r.details)])).toEqual([
      [
        'e1',
        'CONSENT_WITHDRAWN',
        { source: 'self-service', futureCommunications: 0, addressBookPending: 1 },
      ],
      ['e2', 'CONSENT_WITHDRAWN', { source: 'self-service', futureCommunications: 1 }],
    ]);
  });

  it('senza consenso da ritirare non scrive niente nel registro', async () => {
    tx.registration.findMany.mockResolvedValue([]);
    tx.person.updateMany.mockResolvedValue({ count: 0 });
    expect(await ritiraComunicazioni('impronta', ADESSO)).toBe(false);
    expect(tx.gdprAuditLog.createMany).toHaveBeenCalledWith({ data: [] });
  });
});
