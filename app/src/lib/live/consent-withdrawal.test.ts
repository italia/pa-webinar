import { beforeEach, describe, expect, it, vi } from 'vitest';

const tx = vi.hoisted(() => ({
  recordingConsent: { findMany: vi.fn(), updateMany: vi.fn() },
  multitrackConsent: { findMany: vi.fn(), updateMany: vi.fn() },
  registration: { updateMany: vi.fn() },
  captionSegment: { updateMany: vi.fn() },
  gdprAuditLog: { create: vi.fn() },
}));
vi.mock('@/lib/db', () => ({
  prisma: { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) },
}));

import { ritiraConsensi } from './consent-withdrawal';

const EVENTO = 'e1';
const ISCRIZIONE = '11111111-2222-4333-8444-555555555555';
const ADESSO = new Date('2026-11-01T10:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  tx.recordingConsent.findMany.mockResolvedValue([]);
  tx.multitrackConsent.findMany.mockResolvedValue([]);
  tx.recordingConsent.updateMany.mockResolvedValue({ count: 0 });
  tx.multitrackConsent.updateMany.mockResolvedValue({ count: 0 });
  tx.registration.updateMany.mockResolvedValue({ count: 0 });
  tx.captionSegment.updateMany.mockResolvedValue({ count: 0 });
});

describe('ritiraConsensi', () => {
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
        OR: [{ jitsiUserId: { in: ['mod-e1-bbbb', 'mod-e1-aaaa'] } }],
      },
      data: { withdrawnAt: ADESSO },
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

  it('senza posti non tocca niente', async () => {
    expect(await ritiraConsensi(EVENTO, [], { registrazione: true })).toEqual({
      registrazione: false,
      trascrizione: false,
    });
    expect(tx.recordingConsent.findMany).not.toHaveBeenCalled();
  });
});
