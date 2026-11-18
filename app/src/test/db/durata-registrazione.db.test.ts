// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * La registrazione non segue la conservazione dei dati dei partecipanti: su un
 * database vero, la pulizia GDPR (`/api/cron/cleanup`) e quella della
 * post-produzione (`/api/cron/postprod-retention`) insieme. Gli storage dei file
 * sono finti, il resto no.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  cancellaVideo: vi.fn(async (_url: string) => true),
  cancellaVideoPerNome: vi.fn(async (_nome: string) => true),
  cancellaOutput: vi.fn(async (_chiave: string) => true),
  cancellaDallaPostProduzione: vi.fn(async (_chiave: string) => true),
}));
vi.mock('@/lib/storage/recordings', () => ({
  assertVideoNelloStorage: vi.fn(),
  assertVideoDellEvento: vi.fn(async () => undefined),
  deleteRecordingBlob: m.cancellaVideo,
  deleteRecordingBlobByName: m.cancellaVideoPerNome,
}));
vi.mock('@/lib/storage/postprod', () => ({
  isPostprodStorageConfigured: () => true,
  deletePostprodBlob: m.cancellaOutput,
  getPostprodStorage: () => ({ delete: m.cancellaDallaPostProduzione }),
}));

import { GET as pulizia } from '@/app/api/cron/cleanup/route';
import { GET as puliziaPostProduzione } from '@/app/api/cron/postprod-retention/route';
import { DELETE as togliVideo } from '@/app/api/events/[param]/recording/route';
import { PUT as aggiornaEvento } from '@/app/api/events/[param]/route';
import { CAPTIONS_TRANSCRIPT_MODEL } from '@/lib/captions/transcript';
import { encryptPII, hashEmail } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';

import {
  creaEvento,
  creaLavoro,
  creaRegistrazione,
  entraCome,
  organizza,
  richiesta,
  svuotaDatabase,
} from './fixtures';

const GIORNO = 86_400_000;
const giorniFa = (n: number) => new Date(Date.now() - n * GIORNO);
const VIDEO = 'https://storage.example.com/recordings/sala.mp4';
const PRIMA = 'https://storage.example.com/recordings/prima.mp4';

/** Concluso da 61 giorni, dati conservati 30: la pulizia dei dati lo prende. */
const CONCLUSO = {
  status: 'ENDED' as const,
  startsAt: giorniFa(62),
  endsAt: giorniFa(61),
  dataRetentionDays: 30,
};

const contesto = { params: Promise.resolve({}) };
const conChiave = (url: string) =>
  new Request(`http://localhost${url}`, {
    headers: { 'x-api-key': process.env.CRON_API_KEY ?? '' },
  }) as unknown as NextRequest;

async function giroDiPulizia(): Promise<Record<string, unknown>> {
  const res = await pulizia(conChiave('/api/cron/cleanup'), contesto);
  const corpo = (await res.json()) as Record<string, unknown>;
  expect(res.status, JSON.stringify(corpo)).toBe(200);
  return corpo;
}

async function giroDellaPostProduzione(): Promise<Record<string, unknown>> {
  const res = await puliziaPostProduzione(
    conChiave('/api/cron/postprod-retention'),
    contesto
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

/**
 * Un evento registrato com'e' dopo la sala: il video dell'evento e di due
 * sessioni, la trascrizione e la sintesi della post-produzione con i nomi dei
 * parlanti, la trascrizione dai sottotitoli su una registrazione senza file, e
 * i dati delle persone (iscrizione con i consensi, prova in sala, chat, chi era
 * in sala, frasi dei sottotitoli, registro di chi parla).
 */
async function eventoRegistrato(campi: Parameters<typeof creaEvento>[0] = {}) {
  const evento = await creaEvento({ ...CONCLUSO, recordingUrl: VIDEO, ...campi });
  const email = `${randomUUID()}@example.org`;
  const iscrizione = await prisma.registration.create({
    data: {
      eventId: evento.id,
      displayName: encryptPII('Anna Bianchi'),
      email: encryptPII(email),
      emailHash: hashEmail(email),
      locale: 'it',
      consentGiven: true,
      consentTimestamp: giorniFa(70),
      consentRecording: true,
      consentRecordingDestination: 'PUBLIC',
      consentRecordingVersion: 1,
      consentMultitrack: true,
      consentMultitrackVersion: 2,
      accessToken: randomUUID(),
    },
  });
  await prisma.recordingConsent.create({
    data: {
      eventId: evento.id,
      jitsiUserId: 'guest-1',
      displayName: encryptPII('Ospite Uno'),
      consentedAt: giorniFa(61),
    },
  });
  await prisma.chatMessage.create({
    data: {
      eventId: evento.id,
      senderName: encryptPII('Anna Bianchi'),
      senderId: `reg-${iscrizione.id}`,
      text: encryptPII('Buongiorno a tutti'),
    },
  });
  await prisma.roomOccupant.create({
    data: {
      eventId: evento.id,
      endpointId: 'ep-1',
      seatId: `reg-${iscrizione.id}-aa`,
      joinedAt: giorniFa(61),
    },
  });
  await prisma.captionSegment.create({
    data: {
      eventId: evento.id,
      messageId: randomUUID(),
      endpointId: 'ep-1',
      startedAt: giorniFa(61),
      endedAt: giorniFa(61),
    },
  });

  // Il video dell'evento, con la sua sessione, e quello di una sessione prima.
  const registrazione = await creaRegistrazione(evento.id);
  await prisma.callSession.update({
    where: { id: registrazione.callSessionId },
    data: {
      recordingUrl: VIDEO,
      recordingFilename: 'recordings/sala.mp4',
      participants: [{ name: 'Anna Bianchi' }],
      dominantSpeakerLog: [{ endpointId: 'ep-1', name: 'Anna Bianchi' }],
    },
  });
  await prisma.callSession.create({
    data: {
      eventId: evento.id,
      jitsiRoomName: `stanza-${randomUUID()}`,
      startedAt: giorniFa(62),
      recordingUrl: PRIMA,
      recordingFilename: 'recordings/prima.mp4',
    },
  });
  const lavoro = await creaLavoro(registrazione.id, 'DONE');
  for (const [type, blobKey] of [
    ['TRANSCRIPT_JSON', `postprod/${registrazione.id}/transcript.json`],
    ['SUMMARY_MD', `postprod/${registrazione.id}/summary.md`],
  ] as const) {
    await prisma.postprodArtifact.create({
      data: {
        recordingId: registrazione.id,
        jobId: lavoro.id,
        type,
        blobKey,
        mimeType: 'application/json',
        contentHash: 'a'.repeat(64),
      },
    });
  }
  await prisma.speaker.create({
    data: {
      recordingId: registrazione.id,
      diarLabel: 'SPEAKER_00',
      displayName: 'Anna Bianchi',
    },
  });
  // Un lavoro ancora in coda: alla scadenza non deve partire.
  await creaLavoro(registrazione.id, 'PENDING');

  // La trascrizione dai sottotitoli, su una registrazione senza file.
  const sottotitoli = await creaRegistrazione(evento.id);
  await prisma.recording.update({ where: { id: sottotitoli.id }, data: { blobKey: '' } });
  const lavoroSottotitoli = await creaLavoro(sottotitoli.id, 'DONE');
  await prisma.postprodArtifact.create({
    data: {
      recordingId: sottotitoli.id,
      jobId: lavoroSottotitoli.id,
      type: 'TRANSCRIPT_JSON',
      blobKey: '',
      mimeType: 'application/json',
      contentHash: 'b'.repeat(64),
      modelId: CAPTIONS_TRANSCRIPT_MODEL,
      inlineBody: encryptPII('{"segments":[]}'),
    },
  });
  await prisma.speaker.create({
    data: {
      recordingId: sottotitoli.id,
      diarLabel: 'SPEAKER_00',
      displayName: 'Anna Bianchi',
    },
  });

  return { evento, iscrizione, registrazione, sottotitoli };
}

const proveDi = (eventId: string) =>
  prisma.retainedConsentProof.findMany({
    where: { eventId },
    orderBy: { givenAt: 'asc' },
  });

beforeEach(async () => {
  vi.clearAllMocks();
  await svuotaDatabase();
});

describe('la registrazione oltre la conservazione dei dati', () => {
  it('il video non pubblicato e i suoi output restano, i dati delle persone no', async () => {
    const { evento, registrazione, sottotitoli } = await eventoRegistrato();

    const esito = await giroDiPulizia();
    await giroDellaPostProduzione();

    expect(esito.eventsProcessed).toBe(1);
    // I dati delle persone se ne sono andati…
    expect(await prisma.registration.count({ where: { eventId: evento.id } })).toBe(0);
    expect(await prisma.recordingConsent.count({ where: { eventId: evento.id } })).toBe(
      0
    );
    expect(await prisma.chatMessage.count({ where: { eventId: evento.id } })).toBe(0);
    expect(await prisma.roomOccupant.count({ where: { eventId: evento.id } })).toBe(0);
    expect(await prisma.captionSegment.count({ where: { eventId: evento.id } })).toBe(0);
    const sessione = await prisma.callSession.findUniqueOrThrow({
      where: { id: registrazione.callSessionId },
    });
    expect(sessione.participants).toEqual([]);
    expect(sessione.dominantSpeakerLog).toEqual([]);

    // …la registrazione resta, file e output compresi.
    expect(m.cancellaVideo).not.toHaveBeenCalled();
    expect(m.cancellaOutput).not.toHaveBeenCalled();
    const dopo = await prisma.event.findUniqueOrThrow({ where: { id: evento.id } });
    expect(dopo.recordingUrl).toBe(VIDEO);
    expect(sessione.recordingUrl).toBe(VIDEO);
    expect(
      await prisma.postprodArtifact.count({ where: { recordingId: registrazione.id } })
    ).toBe(2);
    expect(
      await prisma.postprodArtifact.count({
        where: { recordingId: sottotitoli.id, modelId: CAPTIONS_TRANSCRIPT_MODEL },
      })
    ).toBe(1);
    expect(
      await prisma.speaker.count({ where: { recording: { eventId: evento.id } } })
    ).toBe(2);
    expect(
      (await prisma.recording.findUniqueOrThrow({ where: { id: registrazione.id } }))
        .status
    ).not.toBe('ARCHIVED');

    // Le prove delle voci che ci stanno restano con lei, con il nome.
    const prove = await proveDi(evento.id);
    expect(prove.length).toBeGreaterThan(0);
    expect(prove.every((p) => p.displayName !== null && p.nameRemovedAt === null)).toBe(
      true
    );
    expect(new Set(prove.map((p) => p.kind))).toEqual(
      new Set(['recording', 'transcription'])
    );
  });

  it('il giro di ogni giorno non cambia niente e non scrive nel registro', async () => {
    const { evento } = await eventoRegistrato();
    await giroDiPulizia();
    await giroDellaPostProduzione();
    const prove = await proveDi(evento.id);
    const righe = await prisma.gdprAuditLog.count({ where: { eventId: evento.id } });

    const esito = await giroDiPulizia();
    await giroDellaPostProduzione();

    expect(esito.consentProofsRetained).toBe(0);
    expect(esito.retainedConsentProofsDeleted).toBe(0);
    expect(esito.recordingsExpired).toBe(0);
    expect(await proveDi(evento.id)).toEqual(prove);
    expect(await prisma.gdprAuditLog.count({ where: { eventId: evento.id } })).toBe(
      righe
    );
    expect(m.cancellaVideo).not.toHaveBeenCalled();
  });
});

describe('la scadenza scelta da chi organizza', () => {
  it('cancella video, output e prove; la durata resta sull’evento', async () => {
    const { evento, registrazione, sottotitoli } = await eventoRegistrato({
      recordingDeleteAfterDays: 30,
    });

    // Primo giro: la pulizia dei dati e la scadenza (61 giorni dalla fine).
    const esito = await giroDiPulizia();

    expect(esito.recordingsExpired).toBe(1);
    expect(m.cancellaVideo.mock.calls.map((c) => c[0]).sort()).toEqual([PRIMA, VIDEO]);
    const dopo = await prisma.event.findUniqueOrThrow({ where: { id: evento.id } });
    expect(dopo).toMatchObject({
      recordingUrl: null,
      recordingPublished: false,
      transcriptPublished: false,
      recordingDeleteAfterDays: 30,
    });
    expect(
      await prisma.callSession.count({
        where: {
          eventId: evento.id,
          OR: [{ recordingUrl: { not: null } }, { recordingFilename: { not: null } }],
        },
      })
    ).toBe(0);
    // Cio' che sta solo nel database se ne va subito: la trascrizione dai
    // sottotitoli (con la sua registrazione senza file) e i nomi dei parlanti.
    expect(await prisma.recording.count({ where: { id: sottotitoli.id } })).toBe(0);
    expect(
      await prisma.speaker.count({ where: { recording: { eventId: evento.id } } })
    ).toBe(0);
    const video = await prisma.recording.findUniqueOrThrow({
      where: { id: registrazione.id },
      select: { retentionUntil: true, jobs: { select: { status: true } } },
    });
    expect(video.retentionUntil).not.toBeNull();
    expect(video.jobs.map((j) => j.status).sort()).toEqual(['DONE', 'FAILED']);
    const [cancellazione] = await prisma.gdprAuditLog.findMany({
      where: { eventId: evento.id, action: 'RECORDING_DELETED' },
    });
    expect(JSON.parse(cancellazione!.details!)).toEqual({
      reason: 'retention_expired',
      retentionDays: 30,
      countedFrom: 'event_end',
      files: 2,
      recordings: 2,
    });

    // La post-produzione toglie i suoi output dalla data scritta dalla pulizia.
    const post = await giroDellaPostProduzione();
    expect(post.expiredRecordings).toBe(1);
    expect(m.cancellaOutput).toHaveBeenCalledTimes(2);
    expect(
      await prisma.postprodArtifact.count({
        where: { recording: { eventId: evento.id } },
      })
    ).toBe(0);
    expect(
      (await prisma.recording.findUniqueOrThrow({ where: { id: registrazione.id } }))
        .status
    ).toBe('ARCHIVED');

    // Il giro dopo: niente piu' da coprire, le prove se ne vanno, e la
    // scadenza non si ripete.
    const secondo = await giroDiPulizia();
    expect(await proveDi(evento.id)).toHaveLength(0);
    expect(secondo.recordingsExpired).toBe(0);
    expect(
      await prisma.gdprAuditLog.count({
        where: { eventId: evento.id, action: 'RECORDING_DELETED' },
      })
    ).toBe(1);
  });

  it('non pubblicata conta dalla fine dell’evento, anche prima della scadenza dei dati', async () => {
    const evento = await creaEvento({
      status: 'ENDED',
      startsAt: giorniFa(11),
      endsAt: giorniFa(10),
      dataRetentionDays: 30,
      recordingUrl: VIDEO,
      recordingDeleteAfterDays: 7,
    });
    const iscrizione = await prisma.registration.create({
      data: {
        eventId: evento.id,
        displayName: encryptPII('Anna Bianchi'),
        email: encryptPII('anna@example.org'),
        emailHash: hashEmail('anna@example.org'),
        consentGiven: true,
        consentTimestamp: giorniFa(12),
        accessToken: randomUUID(),
      },
    });

    const esito = await giroDiPulizia();

    expect(esito.recordingsExpired).toBe(1);
    expect(m.cancellaVideo).toHaveBeenCalledWith(VIDEO);
    expect(
      (await prisma.event.findUniqueOrThrow({ where: { id: evento.id } })).recordingUrl
    ).toBeNull();
    // I dati delle persone hanno la loro scadenza, che non e' passata.
    expect(esito.eventsProcessed).toBe(0);
    expect(await prisma.registration.count({ where: { id: iscrizione.id } })).toBe(1);
  });

  it('prima della scadenza non tocca niente', async () => {
    const { evento } = await eventoRegistrato({ recordingDeleteAfterDays: 90 });

    const esito = await giroDiPulizia();

    expect(esito.recordingsExpired).toBe(0);
    expect(m.cancellaVideo).not.toHaveBeenCalled();
    expect(
      (await prisma.event.findUniqueOrThrow({ where: { id: evento.id } })).recordingUrl
    ).toBe(VIDEO);
  });
});

describe('le scelte che non fanno scadere la registrazione al giro dopo', () => {
  async function modifica(
    eventId: string,
    token: string,
    corpo: Record<string, unknown>
  ) {
    const risposta = await aggiornaEvento(
      richiesta(`/api/events/${eventId}`, 'PUT', corpo, token) as never,
      { params: Promise.resolve({ param: eventId }) }
    );
    expect(risposta.status).toBe(200);
  }

  it('scegliere la durata su un evento finito da tempo la fa contare da adesso', async () => {
    const { evento } = await eventoRegistrato();

    await modifica(evento.id, evento.moderatorToken, { recordingDeleteAfterDays: 1 });
    const esito = await giroDiPulizia();

    expect(esito.recordingsExpired).toBe(0);
    expect(m.cancellaVideo).not.toHaveBeenCalled();
    // Passato il giorno, se ne va.
    await prisma.event.update({
      where: { id: evento.id },
      data: { recordingRetentionFrom: giorniFa(2) },
    });
    expect((await giroDiPulizia()).recordingsExpired).toBe(1);
  });

  it('togliere la pubblicazione non la fa scadere dalla fine dell’evento', async () => {
    const { evento } = await eventoRegistrato({
      recordingPublished: true,
      recordingPublishedAt: giorniFa(10),
      recordingDeleteAfterDays: 30,
    });

    await modifica(evento.id, evento.moderatorToken, { recordingPublished: false });
    const esito = await giroDiPulizia();

    expect(esito.recordingsExpired).toBe(0);
    expect(
      (await prisma.event.findUniqueOrThrow({ where: { id: evento.id } })).recordingUrl
    ).toBe(VIDEO);
  });

  it('un file agganciato dopo la scadenza non se ne va al giro dopo', async () => {
    await entraCome('ORGANIZER');
    const evento = await creaEvento({ ...CONCLUSO, recordingDeleteAfterDays: 30 });
    await organizza(evento.id);

    await modifica(evento.id, evento.moderatorToken, { recordingUrl: VIDEO });
    const esito = await giroDiPulizia();

    expect(esito.recordingsExpired).toBe(0);
    expect(
      (await prisma.event.findUniqueOrThrow({ where: { id: evento.id } })).recordingUrl
    ).toBe(VIDEO);
  });

  it('togliere a mano il video pubblicato lascia agli output la loro durata', async () => {
    const { evento, registrazione } = await eventoRegistrato({
      recordingPublished: true,
      recordingPublishedAt: giorniFa(10),
      recordingDeleteAfterDays: 30,
    });

    const risposta = await togliVideo(
      richiesta(
        `/api/events/${evento.id}/recording`,
        'DELETE',
        undefined,
        evento.moderatorToken
      ) as never,
      { params: Promise.resolve({ param: evento.id }) }
    );
    expect(risposta.status).toBe(200);
    const esito = await giroDiPulizia();

    // Il video se n'e' andato a mano; trascrizioni e sintesi restano, e la
    // durata conta da adesso, non dalla fine dell'evento.
    expect(esito.recordingsExpired).toBe(0);
    expect(
      await prisma.postprodArtifact.count({ where: { recordingId: registrazione.id } })
    ).toBe(2);
    expect(
      (await prisma.event.findUniqueOrThrow({ where: { id: evento.id } }))
        .recordingRetentionFrom
    ).not.toBeNull();
  });

  it('un lavoro in mano a un worker rinvia la scadenza', async () => {
    const { evento, registrazione } = await eventoRegistrato({
      recordingDeleteAfterDays: 30,
    });
    await creaLavoro(registrazione.id, 'RUNNING');

    const esito = await giroDiPulizia();

    expect(esito.recordingsDeferred).toBe(1);
    expect(m.cancellaVideo).not.toHaveBeenCalled();
    expect(
      (await prisma.event.findUniqueOrThrow({ where: { id: evento.id } })).recordingUrl
    ).toBe(VIDEO);
    // Quello in coda si ferma comunque.
    expect(
      await prisma.postprodJob.count({
        where: { recordingId: registrazione.id, status: 'PENDING' },
      })
    ).toBe(0);
  });
});

describe('il video pubblicato, come prima', () => {
  it('conta dalla pubblicazione: pubblicato da poco resta, anche se l’evento e’ vecchio', async () => {
    const { evento } = await eventoRegistrato({
      recordingPublished: true,
      recordingPublishedAt: giorniFa(10),
      recordingDeleteAfterDays: 30,
    });

    const esito = await giroDiPulizia();

    expect(esito.recordingsExpired).toBe(0);
    expect(m.cancellaVideo).not.toHaveBeenCalled();
    expect(
      await prisma.event.findUniqueOrThrow({ where: { id: evento.id } })
    ).toMatchObject({
      recordingUrl: VIDEO,
      recordingPublished: true,
    });
  });

  it('oltre la sua durata dalla pubblicazione se ne va e si toglie dalla pagina', async () => {
    const { evento } = await eventoRegistrato({
      recordingPublished: true,
      recordingPublishedAt: giorniFa(31),
      recordingDeleteAfterDays: 30,
    });

    const esito = await giroDiPulizia();

    expect(esito.recordingsExpired).toBe(1);
    expect(m.cancellaVideo).toHaveBeenCalledWith(VIDEO);
    expect(
      await prisma.event.findUniqueOrThrow({ where: { id: evento.id } })
    ).toMatchObject({
      recordingUrl: null,
      recordingPublished: false,
      recordingPublishedAt: null,
    });
    const [riga] = await prisma.gdprAuditLog.findMany({
      where: { eventId: evento.id, action: 'RECORDING_DELETED' },
    });
    expect(JSON.parse(riga!.details!)).toMatchObject({ countedFrom: 'publication' });
  });

  it('senza durata resta pubblicato, con le sue prove', async () => {
    const { evento } = await eventoRegistrato({
      recordingPublished: true,
      recordingPublishedAt: giorniFa(400),
    });

    await giroDiPulizia();
    await giroDellaPostProduzione();

    expect(m.cancellaVideo).not.toHaveBeenCalled();
    expect(
      await prisma.event.findUniqueOrThrow({ where: { id: evento.id } })
    ).toMatchObject({
      recordingUrl: VIDEO,
      recordingPublished: true,
    });
    expect((await proveDi(evento.id)).length).toBeGreaterThan(0);
  });
});

describe('gli eventi nati prima della regola', () => {
  // A chi si e' iscritto si era detto che il video non pubblicato se ne va con i
  // suoi dati: la promessa resta (lib/recording/legacy-retention).
  async function modifica(eventId: string, token: string, corpo: Record<string, unknown>) {
    return aggiornaEvento(richiesta(`/api/events/${eventId}`, 'PUT', corpo, token) as never, {
      params: Promise.resolve({ param: eventId }),
    });
  }

  it('il video non pubblicato se ne va con i dati, quello di un evento nuovo resta', async () => {
    const vecchio = await eventoRegistrato({ legacyRecordingRetention: true });
    const NUOVO = 'https://storage.example.com/recordings/nuovo.mp4';
    const nuovo = await creaEvento({ ...CONCLUSO, recordingUrl: NUOVO });

    const esito = await giroDiPulizia();

    expect(esito.recordingsExpired).toBe(1);
    expect(m.cancellaVideo).toHaveBeenCalledWith(VIDEO);
    expect(m.cancellaVideo).not.toHaveBeenCalledWith(NUOVO);
    expect(
      (await prisma.event.findUniqueOrThrow({ where: { id: vecchio.evento.id } })).recordingUrl
    ).toBeNull();
    expect(
      (await prisma.event.findUniqueOrThrow({ where: { id: nuovo.id } })).recordingUrl
    ).toBe(NUOVO);
     const [riga] = await prisma.gdprAuditLog.findMany({
      where: { eventId: vecchio.evento.id, action: 'RECORDING_DELETED' },
    });
    expect(JSON.parse(riga!.details!)).toMatchObject({
      retentionDays: 30,
      countedFrom: 'event_end',
      legacyPromise: true,
    });
  });

  it('pubblicato resta come prima, e senza durata non scade', async () => {
    const { evento } = await eventoRegistrato({
      legacyRecordingRetention: true,
      recordingPublished: true,
      recordingPublishedAt: giorniFa(400),
    });
    expect((await giroDiPulizia()).recordingsExpired).toBe(0);
    expect(m.cancellaVideo).not.toHaveBeenCalled();
    expect(
      (await prisma.event.findUniqueOrThrow({ where: { id: evento.id } })).recordingPublished
    ).toBe(true);
  });

  it('la durata si accorcia, non si toglie ne’ si allunga finche’ il video non e’ pubblicato', async () => {
    const evento = await creaEvento({
      status: 'ENDED',
      startsAt: giorniFa(3),
      endsAt: giorniFa(2),
      dataRetentionDays: 30,
      recordingUrl: VIDEO,
      legacyRecordingRetention: true,
    });

    expect(
      (await modifica(evento.id, evento.moderatorToken, { recordingDeleteAfterDays: 7 })).status
    ).toBe(200);
    for (const giorni of [null, 90]) {
      const rifiutata = await modifica(evento.id, evento.moderatorToken, {
        recordingDeleteAfterDays: giorni,
      });
      expect(rifiutata.status).toBe(422);
      expect((await rifiutata.json()).code).toBe('RECORDING_RETENTION_LEGACY');
    }
    // Scegliere la durata non sposta il punto di partenza: la promessa conta
    // dalla fine dell'evento.
    expect(
      await prisma.event.findUniqueOrThrow({
        where: { id: evento.id },
        select: { recordingDeleteAfterDays: true, recordingRetentionFrom: true },
      })
    ).toEqual({ recordingDeleteAfterDays: 7, recordingRetentionFrom: null });

    // Pubblicato, la durata conta dalla pubblicazione come prima: si sceglie liberamente.
    expect(
      (
        await modifica(evento.id, evento.moderatorToken, {
          recordingPublished: true,
          recordingDeleteAfterDays: null,
        })
      ).status
    ).toBe(200);
  });

  it('la migrazione segna gli eventi che c’erano, non le bozze', async () => {
    const [bozza, concluso] = [
      await creaEvento({ status: 'DRAFT', recordingRetentionFrom: giorniFa(1) }),
      // La migrazione precedente aveva messo il punto di partenza ad adesso.
      await creaEvento({ ...CONCLUSO, recordingDeleteAfterDays: 90, recordingRetentionFrom: giorniFa(1) }),
    ];
    const sql = readFileSync(
      path.join(
        __dirname,
        '../../../prisma/migrations/20261118700000_conservazione_registrazioni_precedenti/migration.sql'
      ),
      'utf8'
    );
    const aggiornamento = sql.slice(sql.indexOf('UPDATE'));
    await prisma.$executeRawUnsafe(aggiornamento);

    const campi = { legacyRecordingRetention: true, recordingRetentionFrom: true } as const;
    expect(
      (await prisma.event.findUniqueOrThrow({ where: { id: bozza.id }, select: campi }))
        .legacyRecordingRetention
    ).toBe(false);
    expect(
      await prisma.event.findUniqueOrThrow({ where: { id: concluso.id }, select: campi })
    ).toEqual({ legacyRecordingRetention: true, recordingRetentionFrom: null });
    // La promessa conta dalla fine: il video non pubblicato se ne va al giro.
    await prisma.event.update({ where: { id: concluso.id }, data: { recordingUrl: VIDEO } });
    expect((await giroDiPulizia()).recordingsExpired).toBe(1);
  });
});
