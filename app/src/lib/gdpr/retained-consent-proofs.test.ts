// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  decifra: vi.fn((v: string) => `chiaro:${v}`),
  transazione: vi.fn(),
  tx: {
    registration: { findMany: vi.fn() },
    recordingConsent: { findMany: vi.fn() },
    multitrackConsent: { findMany: vi.fn() },
    retainedConsentProof: {
      createMany: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    gdprAuditLog: { create: vi.fn() },
    event: { findUnique: vi.fn() },
    postprodArtifact: { count: vi.fn(), findMany: vi.fn() },
    recording: { findMany: vi.fn() },
    callSession: { count: vi.fn() },
    $executeRaw: vi.fn(),
  },
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    ...m.tx,
    $transaction: m.transazione,
  },
}));
vi.mock('@/lib/crypto/pii', () => ({
  tryDecryptPII: m.decifra,
  encryptPII: (v: string) => v,
}));

import { TIMEOUT_PULIZIA_EVENTO_MS } from './cleanup-selection';
import { improntaTitolare, titolareIscrizione } from './consent-proofs';
import {
  conservaProve,
  proveConservateDellaPersona,
  ritiraProvaConservata,
  ritiraProveDelleIscrizioni,
  tipiDelleProve,
  tipiDelleProveEsistenti,
  togliNomeDalleProve,
  togliNomeDelleIscrizioni,
} from './retained-consent-proofs';

const { tx } = m;
const ADESSO = new Date('2026-11-01T03:00:00Z');
const t = (s: string) => new Date(`2026-10-01T${s}:00Z`);
const cliente = tx as unknown as Parameters<typeof conservaProve>[0];

const iscritta = {
  id: 'r1',
  displayName: 'cifrato-iscritta',
  emailHash: 'impronta',
  locale: 'it',
  consentTimestamp: t('09:00'),
  consentRecording: true,
  consentRecordingDestination: 'PUBLIC',
  consentRecordingVersion: 1,
  consentRecordingWithdrawnAt: null,
  consentMultitrack: true,
  consentMultitrackVersion: 2,
  consentMultitrackWithdrawnAt: t('10:00'),
};
const copiate = () =>
  (
    tx.retainedConsentProof.createMany.mock.calls[0]![0] as {
      data: Array<Record<string, unknown>>;
    }
  ).data;

beforeEach(() => {
  vi.clearAllMocks();
  m.transazione.mockImplementation(async (fn: (t: typeof m.tx) => unknown) => fn(m.tx));
  tx.postprodArtifact.findMany.mockResolvedValue([]);
  tx.recording.findMany.mockResolvedValue([]);
  tx.callSession.count.mockResolvedValue(0);
  tx.registration.findMany.mockResolvedValue([iscritta]);
  tx.recordingConsent.findMany.mockResolvedValue([]);
  tx.multitrackConsent.findMany.mockResolvedValue([]);
  tx.retainedConsentProof.updateMany.mockResolvedValue({ count: 1 });
});

describe('tipiDelleProve', () => {
  const evento = {
    youtubeUrl: null,
    recordingUrl: null,
    recordingPublished: false,
    transcriptPublished: false,
  };

  it('un evento che non esiste non conserva niente', async () => {
    tx.event.findUnique.mockResolvedValue(null);
    expect(await tipiDelleProve(tx as never, 'e1')).toEqual([]);
  });

  it('il flag della trascrizione vale solo se l’artefatto c’e’', async () => {
    tx.event.findUnique.mockResolvedValue({ ...evento, transcriptPublished: true });
    tx.postprodArtifact.count.mockResolvedValue(0);
    expect(await tipiDelleProve(tx as never, 'e1')).toEqual([]);
    tx.postprodArtifact.count.mockResolvedValue(1);
    expect(await tipiDelleProve(tx as never, 'e1')).toEqual(['transcription']);
    expect(tx.postprodArtifact.count).toHaveBeenCalledWith({
      where: { type: 'TRANSCRIPT_JSON', recording: { eventId: 'e1' } },
    });
  });

  it('senza flag non cerca l’artefatto', async () => {
    tx.event.findUnique.mockResolvedValue({ ...evento, youtubeUrl: 'https://esterno' });
    expect(await tipiDelleProve(tx as never, 'e1')).toEqual([
      'recording',
      'transcription',
    ]);
    expect(tx.postprodArtifact.count).not.toHaveBeenCalled();
  });
});

describe('conservaProve', () => {
  it('copia il nome cifrato senza decifrarlo, con date, testo e impronte', async () => {
    const n = await conservaProve(cliente, {
      eventId: 'e1',
      tipi: ['recording', 'transcription'],
      adesso: ADESSO,
    });
    expect(n).toBe(2);
    expect(m.decifra).not.toHaveBeenCalled();
    expect(copiate()[0]).toEqual({
      eventId: 'e1',
      kind: 'recording',
      source: 'registration',
      role: 'registrant',
      holderHash: improntaTitolare('e1', 'reg:r1'),
      emailHash: 'impronta',
      displayName: 'cifrato-iscritta',
      nameRemovedAt: null,
      locale: 'it',
      textVersion: 1,
      destination: 'PUBLIC',
      givenAt: t('09:00'),
      withdrawnAt: null,
    });
    expect(copiate()[1]).toMatchObject({
      kind: 'transcription',
      textVersion: 2,
      destination: null,
      withdrawnAt: t('10:00'),
    });
  });

  it('senza nome: la toglie, e un consenso valido si considera ritirato ora', async () => {
    await conservaProve(cliente, {
      eventId: 'e1',
      tipi: ['recording', 'transcription'],
      senzaNome: true,
      adesso: ADESSO,
    });
    expect(copiate()[0]).toMatchObject({
      displayName: null,
      nameRemovedAt: ADESSO,
      withdrawnAt: ADESSO,
      emailHash: 'impronta',
    });
    // Un ritiro gia' avvenuto tiene la sua ora.
    expect(copiate()[1]).toMatchObject({ withdrawnAt: t('10:00') });
  });

  it('copia solo i tipi dovuti', async () => {
    await conservaProve(cliente, {
      eventId: 'e1',
      tipi: ['transcription'],
      adesso: ADESSO,
    });
    expect(copiate().map((r) => r.kind)).toEqual(['transcription']);
  });

  it('una riga per periodo del consenso', async () => {
    tx.registration.findMany.mockResolvedValue([]);
    tx.recordingConsent.findMany.mockResolvedValue([
      {
        displayName: 'cifrato',
        jitsiUserId: 'guest-1',
        registrationId: null,
        eventModeratorId: null,
        staffAccountId: null,
        locale: null,
        consentedAt: t('11:00'),
        withdrawnAt: null,
        destination: 'REGISTRANTS',
        textVersion: 1,
        earlierPeriods: [
          {
            consentedAt: t('09:00').toISOString(),
            withdrawnAt: t('10:00').toISOString(),
          },
        ],
      },
    ]);
    const n = await conservaProve(cliente, {
      eventId: 'e1',
      tipi: ['recording'],
      adesso: ADESSO,
    });
    expect(n).toBe(2);
    expect(copiate().map((r) => [r.givenAt, r.withdrawnAt, r.destination])).toEqual([
      [t('09:00'), t('10:00'), null],
      [t('11:00'), null, 'REGISTRANTS'],
    ]);
    // Lo stesso titolare: conta una persona, e un ospite non ha un indirizzo.
    expect(new Set(copiate().map((r) => r.holderHash)).size).toBe(1);
    expect(copiate()[0]!.emailHash).toBeNull();
  });

  it('nessun tipo dovuto: non legge e non scrive', async () => {
    expect(
      await conservaProve(cliente, { eventId: 'e1', tipi: [], adesso: ADESSO })
    ).toBe(0);
    expect(tx.registration.findMany).not.toHaveBeenCalled();
    expect(tx.retainedConsentProof.createMany).not.toHaveBeenCalled();
  });

  it('nessuna riga da copiare: non scrive', async () => {
    tx.registration.findMany.mockResolvedValue([]);
    expect(
      await conservaProve(cliente, { eventId: 'e1', tipi: ['recording'], adesso: ADESSO })
    ).toBe(0);
    expect(tx.retainedConsentProof.createMany).not.toHaveBeenCalled();
  });

  it('passa il filtro alla lettura', async () => {
    await conservaProve(cliente, {
      eventId: 'e1',
      tipi: ['recording'],
      grantIds: ['g1'],
      adesso: ADESSO,
    });
    expect(tx.recordingConsent.findMany.mock.calls[0]![0].where.OR).toContainEqual({
      eventModeratorId: { in: ['g1'] },
    });
    expect(tx.registration.findMany.mock.calls[0]![0].where.id).toEqual({ in: [] });
  });
});

describe('togliNomeDalleProve', () => {
  it('toglie il nome, ritira e conta per evento', async () => {
    tx.retainedConsentProof.findMany
      .mockResolvedValueOnce([{ eventId: 'e2' }, { eventId: 'e1' }])
      .mockResolvedValueOnce([{ eventId: 'e1' }, { eventId: 'e1' }, { eventId: 'e2' }])
      .mockResolvedValue([]);
    const perEvento = await togliNomeDalleProve('impronta', ADESSO);
    // Gli eventi in fila in ordine, come chi cancella le iscrizioni.
    expect(
      tx.$executeRaw.mock.calls.map((c) => (c as unknown[]).slice(1)[0])
    ).toEqual(['captions-transcript:e1', 'captions-transcript:e2']);
    expect([...perEvento]).toEqual([
      ['e1', 2],
      ['e2', 1],
    ]);
    expect(tx.retainedConsentProof.updateMany).toHaveBeenCalledWith({
      where: { emailHash: 'impronta', nameRemovedAt: null, withdrawnAt: null },
      data: { withdrawnAt: ADESSO },
    });
    expect(tx.retainedConsentProof.updateMany).toHaveBeenCalledWith({
      where: { emailHash: 'impronta', nameRemovedAt: null },
      data: { displayName: null, nameRemovedAt: ADESSO },
    });
  });

  it('una richiesta ripetuta non cambia niente', async () => {
    tx.retainedConsentProof.findMany.mockResolvedValue([]);
    expect((await togliNomeDalleProve('impronta', ADESSO)).size).toBe(0);
    expect(tx.retainedConsentProof.updateMany).not.toHaveBeenCalled();
  });

  it('puo\' aspettare tutta la pulizia degli stessi eventi', async () => {
    tx.retainedConsentProof.findMany.mockResolvedValue([]);
    await togliNomeDalleProve('impronta', ADESSO);
    expect(m.transazione.mock.calls[0]![1].timeout).toBeGreaterThan(TIMEOUT_PULIZIA_EVENTO_MS);
  });
});

describe('tipiDelleProveEsistenti', () => {
  const evento = { youtubeUrl: null, recordingUrl: null, tempRecordingUrl: null };

  it('un evento che non esiste non conserva niente', async () => {
    tx.event.findUnique.mockResolvedValue(null);
    expect(await tipiDelleProveEsistenti(tx as never, 'e1')).toEqual([]);
  });

  it('il file non ancora pubblicato vale come video', async () => {
    tx.event.findUnique.mockResolvedValue({ ...evento, recordingUrl: 'https://file' });
    tx.postprodArtifact.count.mockResolvedValue(0);
    expect(await tipiDelleProveEsistenti(tx as never, 'e1')).toEqual([
      'recording',
      'transcription',
    ]);
  });

  it('una registrazione con il suo file non vale da sola: lo dice l’indirizzo sull’evento', async () => {
    tx.event.findUnique.mockResolvedValue(evento);
    tx.postprodArtifact.count.mockResolvedValue(0);
    tx.recording.findMany.mockResolvedValue([
      { blobKey: 'recordings/sala.mp4', mediaStartedAt: t('09:00'), tracks: [] },
    ]);
    expect(await tipiDelleProveEsistenti(tx as never, 'e1')).toEqual([]);
  });

  it('il file di una sessione vale come video, anche se l’evento non lo indica', async () => {
    tx.event.findUnique.mockResolvedValue(evento);
    tx.postprodArtifact.count.mockResolvedValue(0);
    tx.callSession.count.mockResolvedValue(1);
    expect(await tipiDelleProveEsistenti(tx as never, 'e1')).toEqual([
      'recording',
      'transcription',
    ]);
    expect(tx.callSession.count).toHaveBeenCalledWith({
      where: { eventId: 'e1', recordingUrl: { not: null } },
    });
  });

  it('le tracce per persona arrivate valgono come video, il segnaposto vuoto no', async () => {
    tx.event.findUnique.mockResolvedValue(evento);
    tx.postprodArtifact.count.mockResolvedValue(0);
    tx.recording.findMany.mockResolvedValue([
      { blobKey: 'recordings/multitrack/e1/', mediaStartedAt: null, tracks: [] },
    ]);
    expect(await tipiDelleProveEsistenti(tx as never, 'e1')).toEqual([]);
    tx.recording.findMany.mockResolvedValue([
      { blobKey: 'recordings/multitrack/e1/', mediaStartedAt: t('09:00'), tracks: [{ id: 't1' }] },
    ]);
    expect(await tipiDelleProveEsistenti(tx as never, 'e1')).toEqual([
      'recording',
      'transcription',
    ]);
    expect(tx.recording.findMany.mock.calls[0]![0].where.status).toEqual({ not: 'ARCHIVED' });
  });

  it('le tracce gia’ cancellate non valgono come video', async () => {
    tx.event.findUnique.mockResolvedValue(evento);
    tx.postprodArtifact.count.mockResolvedValue(0);
    tx.recording.findMany.mockResolvedValue([
      { blobKey: 'recordings/multitrack/e1/', mediaStartedAt: t('09:00'), tracks: [] },
    ]);
    expect(await tipiDelleProveEsistenti(tx as never, 'e1')).toEqual([]);
    expect(tx.recording.findMany.mock.calls[0]![0].select.tracks.where).toEqual({
      audioPurgedAt: null,
    });
  });

  it('la sola trascrizione tiene la sua prova', async () => {
    tx.event.findUnique.mockResolvedValue(evento);
    tx.postprodArtifact.count.mockResolvedValue(1);
    expect(await tipiDelleProveEsistenti(tx as never, 'e1')).toEqual(['transcription']);
  });
});

describe('ritiraProveDelleIscrizioni', () => {
  const dove = {
    eventId: 'e1',
    holderHash: { in: [improntaTitolare('e1', titolareIscrizione('r1'))] },
    withdrawnAt: null,
  };

  it('la registrazione porta con se\' la trascrizione', async () => {
    tx.retainedConsentProof.updateMany
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 1 });
    expect(
      await ritiraProveDelleIscrizioni(cliente, 'e1', ['r1'], { registrazione: true }, ADESSO)
    ).toEqual({ recording: 2, transcription: 1 });
    expect(tx.retainedConsentProof.updateMany.mock.calls.map((c) => c[0])).toEqual([
      { where: { ...dove, kind: 'recording' }, data: { withdrawnAt: ADESSO } },
      { where: { ...dove, kind: 'transcription' }, data: { withdrawnAt: ADESSO } },
    ]);
  });

  it('la trascrizione non tocca la registrazione', async () => {
    tx.retainedConsentProof.updateMany.mockResolvedValue({ count: 1 });
    expect(
      await ritiraProveDelleIscrizioni(cliente, 'e1', ['r1'], { registrazione: false }, ADESSO)
    ).toEqual({ recording: 0, transcription: 1 });
    expect(tx.retainedConsentProof.updateMany).toHaveBeenCalledTimes(1);
  });
});

describe('togliNomeDelleIscrizioni', () => {
  it('sceglie per titolare nell’evento, non per indirizzo, e conta le prove cambiate', async () => {
    tx.retainedConsentProof.updateMany.mockResolvedValue({ count: 2 });
    const impronta = improntaTitolare('e1', titolareIscrizione('r1'));

    expect(await togliNomeDelleIscrizioni(cliente, 'e1', ['r1'], ADESSO)).toBe(2);

    const dove = { eventId: 'e1', holderHash: { in: [impronta] }, nameRemovedAt: null };
    expect(tx.retainedConsentProof.updateMany).toHaveBeenCalledWith({
      where: { ...dove, withdrawnAt: null },
      data: { withdrawnAt: ADESSO },
    });
    expect(tx.retainedConsentProof.updateMany).toHaveBeenCalledWith({
      where: dove,
      data: { displayName: null, nameRemovedAt: ADESSO },
    });
  });
});

describe('ritiraProvaConservata', () => {
  it('cerca la prova per indirizzo e tipo', async () => {
    tx.retainedConsentProof.findFirst.mockResolvedValue(null);
    expect(await ritiraProvaConservata('impronta', 'p1', 'recording', ADESSO)).toBe(
      false
    );
    expect(tx.retainedConsentProof.findFirst.mock.calls[0]![0].where).toEqual({
      id: 'p1',
      emailHash: 'impronta',
      kind: 'recording',
    });
    expect(tx.retainedConsentProof.updateMany).not.toHaveBeenCalled();
    expect(tx.gdprAuditLog.create).not.toHaveBeenCalled();
  });

  it('la registrazione porta con se’ la trascrizione dello stesso evento', async () => {
    tx.retainedConsentProof.findFirst.mockResolvedValue({ eventId: 'e1' });
    tx.retainedConsentProof.updateMany
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 1 });
    expect(await ritiraProvaConservata('impronta', 'p1', 'recording', ADESSO)).toBe(true);
    expect(tx.retainedConsentProof.updateMany.mock.calls.map((c) => c[0].where)).toEqual([
      { eventId: 'e1', emailHash: 'impronta', kind: 'recording', withdrawnAt: null },
      { eventId: 'e1', emailHash: 'impronta', kind: 'transcription', withdrawnAt: null },
    ]);
    const riga = tx.gdprAuditLog.create.mock.calls[0]![0].data;
    expect(riga).toMatchObject({
      eventId: 'e1',
      action: 'CONSENT_WITHDRAWN',
      recordCount: 3,
    });
    expect(JSON.parse(riga.details)).toEqual({
      source: 'self-service',
      recording: 2,
      transcription: 1,
    });
  });

  it('la trascrizione non tocca la registrazione', async () => {
    tx.retainedConsentProof.findFirst.mockResolvedValue({ eventId: 'e1' });
    await ritiraProvaConservata('impronta', 'p1', 'transcription', ADESSO);
    expect(tx.retainedConsentProof.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.retainedConsentProof.updateMany.mock.calls[0]![0].where.kind).toBe(
      'transcription'
    );
  });

  it('ritirare di nuovo non scrive nel registro', async () => {
    tx.retainedConsentProof.findFirst.mockResolvedValue({ eventId: 'e1' });
    tx.retainedConsentProof.updateMany.mockResolvedValue({ count: 0 });
    expect(await ritiraProvaConservata('impronta', 'p1', 'recording', ADESSO)).toBe(true);
    expect(tx.gdprAuditLog.create).not.toHaveBeenCalled();
  });

  it('si mette in fila con la pulizia prima di ritirare', async () => {
    tx.retainedConsentProof.findFirst.mockResolvedValue({ eventId: 'e1' });
    tx.retainedConsentProof.updateMany.mockResolvedValue({ count: 1 });
    await ritiraProvaConservata('impronta', 'p1', 'transcription', ADESSO);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.retainedConsentProof.updateMany.mock.invocationCallOrder[0]!
    );
  });

  it('puo\' aspettare tutta la pulizia dello stesso evento', async () => {
    tx.retainedConsentProof.findFirst.mockResolvedValue(null);
    await ritiraProvaConservata('impronta', 'p1', 'recording', ADESSO);
    expect(m.transazione.mock.calls[0]![1].timeout).toBeGreaterThan(TIMEOUT_PULIZIA_EVENTO_MS);
  });
});

describe('proveConservateDellaPersona', () => {
  it('dice quale periodo e’ stato sostituito', async () => {
    const periodo = {
      eventId: 'e1',
      kind: 'recording',
      source: 'room',
      role: 'registrant',
      holderHash: 'titolare',
      displayName: null,
      nameRemovedAt: null,
      locale: 'it',
      textVersion: 1,
      destination: 'PUBLIC',
      retainedAt: ADESSO,
      event: { title: { it: 'Evento' }, startsAt: t('12:00') },
    };
    tx.retainedConsentProof.findMany.mockResolvedValue([
      { ...periodo, id: 'p1', givenAt: t('09:00'), withdrawnAt: null },
      { ...periodo, id: 'p2', givenAt: t('10:00'), withdrawnAt: t('11:00') },
    ]);
    const prove = await proveConservateDellaPersona('impronta');
    expect(prove.map((p) => [p.id, p.superseded])).toEqual([
      ['p1', true],
      ['p2', false],
    ]);
  });

  it('decifra il nome e non espone le impronte', async () => {
    tx.retainedConsentProof.findMany.mockResolvedValue([
      {
        id: 'p1',
        eventId: 'e1',
        kind: 'recording',
        source: 'room',
        role: 'registrant',
        holderHash: 'titolare',
        emailHash: 'impronta',
        displayName: 'cifrato',
        nameRemovedAt: null,
        locale: 'it',
        textVersion: 1,
        destination: 'PUBLIC',
        givenAt: t('09:00'),
        withdrawnAt: null,
        retainedAt: ADESSO,
        event: { title: { it: 'Evento' }, startsAt: t('12:00') },
      },
      {
        id: 'p2',
        eventId: 'e1',
        kind: 'transcription',
        source: 'room',
        role: 'registrant',
        holderHash: 'titolare',
        emailHash: 'impronta',
        displayName: null,
        nameRemovedAt: ADESSO,
        locale: null,
        textVersion: 2,
        destination: null,
        givenAt: t('09:00'),
        withdrawnAt: ADESSO,
        retainedAt: ADESSO,
        event: { title: { it: 'Evento' }, startsAt: t('12:00') },
      },
    ]);
    const prove = await proveConservateDellaPersona('impronta');
    for (const prova of prove) {
      expect(prova).not.toHaveProperty('holderHash');
      expect(prova).not.toHaveProperty('emailHash');
    }
    expect(prove[0]).toMatchObject({
      name: 'chiaro:cifrato',
      nameRemoved: false,
      withdrawnAt: null,
    });
    expect(prove[1]).toMatchObject({
      name: null,
      nameRemoved: true,
      withdrawnAt: ADESSO.toISOString(),
    });
  });
});
