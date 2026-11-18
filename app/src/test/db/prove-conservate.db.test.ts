// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Le prove dei consensi conservate, su un database vero: le cascate e l'ordine
 * delle cancellazioni non si provano con un client simulato. Lo storage dei
 * file e' finto, il resto no.
 */
import { randomUUID } from 'node:crypto';

import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/storage/recordings', () => ({
  assertVideoNelloStorage: vi.fn(),
  assertVideoDellEvento: vi.fn(async () => undefined),
  deleteRecordingBlob: vi.fn(async () => true),
  deleteRecordingBlobByName: vi.fn(async () => true),
}));
// I testi veri dell'italiano, letti per chiave puntata come next-intl.
vi.mock('next-intl/server', async () => {
  const it = (await import('@/i18n/messages/it.json')).default;
  return {
    getTranslations: vi.fn(
      async () => (chiave: string) =>
        chiave
          .split('.')
          .reduce<unknown>(
            (o, k) => (o as Record<string, unknown>)[k],
            it.admin.consentProofs.csv
          )
    ),
  };
});

import { GET as consensiAdmin } from '@/app/api/admin/events/[id]/consents/route';
import { DELETE as cancellaIscrizione } from '@/app/api/admin/events/[id]/registrations/[regId]/route';
import { PATCH as aggiornaPubblicazione } from '@/app/api/admin/publications/[id]/route';
import { GET as pulizia } from '@/app/api/cron/cleanup/route';
import { DELETE as togliVideo } from '@/app/api/events/[param]/recording/route';
import { PUT as aggiornaEvento } from '@/app/api/events/[param]/route';
import { DELETE as togliSessione } from '@/app/api/events/[param]/sessions/[id]/route';
import { POST as ritira } from '@/app/api/gdpr/consents/route';
import { POST as cancella } from '@/app/api/gdpr/erasure/route';
import { GET as esporta } from '@/app/api/gdpr/export/route';
import {
  bloccaTrascrizioneEvento,
  CAPTIONS_TRANSCRIPT_MODEL,
  costruisciTrascrizioneDaiSottotitoli,
} from '@/lib/captions/transcript';
import { encryptPII, hashEmail, tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { eraseRegistrations } from '@/lib/gdpr/erase-registrations';
import { issueGdprToken } from '@/lib/gdpr/request-token';
import { MULTITRACK_PREFIX } from '@/lib/recorder/lifecycle';

import {
  creaEvento,
  creaLavoro,
  creaRegistrazione,
  creaSessione,
  entraCome,
  organizza,
  richiesta,
  svuotaDatabase,
} from './fixtures';

const GIORNO = 86_400_000;
const giorniFa = (n: number) => new Date(Date.now() - n * GIORNO);
const VIDEO = 'https://storage.example.com/recordings/sala.mp4';

/** Un evento oltre la conservazione: la pulizia lo prende al primo giro. */
const CONCLUSO = {
  status: 'ENDED' as const,
  startsAt: giorniFa(62),
  endsAt: giorniFa(61),
  dataRetentionDays: 30,
};
const PUBBLICATO = {
  ...CONCLUSO,
  recordingUrl: VIDEO,
  recordingPublished: true,
  recordingPublishedAt: giorniFa(60),
};

let progressivo = 0;
const contesto = <T extends Record<string, string>>(params: T) => ({
  params: Promise.resolve(params),
});
function daIp(url: string, metodo = 'GET', corpo?: unknown) {
  progressivo += 1;
  const base = richiesta(url, metodo, corpo);
  const headers = new Headers(base.headers);
  headers.set(
    'x-forwarded-for',
    `198.18.${Math.floor(progressivo / 250)}.${progressivo % 250}`
  );
  return new Request(base.url, {
    method: metodo,
    headers,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  }) as unknown as NextRequest;
}

const giroDiPulizia = async () => {
  const res = await pulizia(
    new Request('http://localhost/api/cron/cleanup', {
      headers: { 'x-api-key': process.env.CRON_API_KEY ?? '' },
    }) as unknown as NextRequest,
    contesto({})
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, number>;
};
const chiediCancellazione = async (emailHash: string) => {
  const res = await cancella(
    daIp(`/api/gdpr/erasure?t=${issueGdprToken('erasure', emailHash)}`, 'POST'),
    contesto({})
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
};
const chiediDati = async (emailHash: string) => {
  const res = await esporta(
    daIp(`/api/gdpr/export?t=${issueGdprToken('export', emailHash)}`),
    contesto({})
  );
  expect(res.status).toBe(200);
  return (await res.json()) as {
    data: unknown[];
    consentsToken?: string;
    addressBook: Record<string, unknown> | null;
    retainedConsentProofs: Array<{
      id: string;
      kind: string;
      name: string | null;
      nameRemoved: boolean;
      superseded: boolean;
      withdrawnAt: string | null;
    }>;
  };
};

/** Un'iscritta con i due consensi all'iscrizione e la prova di sala, con un
 *  periodo precedente. */
async function iscritta(
  eventId: string,
  nome = 'Anna Bianchi',
  email = `${randomUUID()}@example.org`
) {
  const emailHash = hashEmail(email);
  const reg = await prisma.registration.create({
    data: {
      eventId,
      displayName: encryptPII(nome),
      email: encryptPII(email),
      emailHash,
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
      eventId,
      jitsiUserId: `reg-${reg.id}-aa`,
      displayName: encryptPII(nome),
      registrationId: reg.id,
      locale: 'it',
      consentedAt: giorniFa(61),
      destination: 'PUBLIC',
      textVersion: 1,
      earlierPeriods: [
        {
          consentedAt: giorniFa(65).toISOString(),
          withdrawnAt: giorniFa(64).toISOString(),
          destination: 'PUBLIC',
          textVersion: 1,
        },
      ],
    },
  });
  await prisma.multitrackConsent.create({
    data: {
      eventId,
      jitsiUserId: `reg-${reg.id}-aa`,
      displayName: encryptPII(nome),
      registrationId: reg.id,
      locale: 'it',
      consentedAt: giorniFa(61),
    },
  });
  await prisma.chatMessage.create({
    data: {
      eventId,
      senderId: `reg-${reg.id}`,
      senderName: encryptPII(nome),
      text: encryptPII('Buongiorno'),
    },
  });
  return { reg, emailHash };
}

async function creaTrascrizione(eventId: string) {
  const registrazione = await creaRegistrazione(eventId);
  const lavoro = await creaLavoro(registrazione.id, 'DONE');
  await prisma.postprodArtifact.create({
    data: {
      recordingId: registrazione.id,
      jobId: lavoro.id,
      type: 'TRANSCRIPT_JSON',
      blobKey: 'artefatti/t.json',
      mimeType: 'application/json',
      contentHash: 'a'.repeat(64),
    },
  });
}

/** La trascrizione dai sottotitoli di un evento: ogni persona con una sua frase, e
 *  la sua voce nell'elenco dei parlanti, come la scrive `costruisciTrascrizione`. */
async function trascrizioneDaiSottotitoli(
  eventId: string,
  persone: Array<{ registrationId: string; nome: string }>
) {
  const registrazione = await creaRegistrazione(eventId);
  const lavoro = await creaLavoro(registrazione.id, 'DONE');
  const corpo = JSON.stringify({
    source: 'live-captions',
    language: 'it',
    segments: persone.map((p, i) => ({
      start: i,
      end: i + 1,
      text: `Frase di ${p.nome}`,
      speaker: `SPEAKER_0${i}`,
    })),
    untranscribed: [],
    speakers: persone.map((p, i) => ({
      diarLabel: `SPEAKER_0${i}`,
      displayName: p.nome,
      totalSpeechSec: 1,
      registrationId: p.registrationId,
    })),
  });
  const artefatto = await prisma.postprodArtifact.create({
    data: {
      recordingId: registrazione.id,
      jobId: lavoro.id,
      type: 'TRANSCRIPT_JSON',
      blobKey: '',
      mimeType: 'application/json',
      inlineBody: encryptPII(corpo),
      contentHash: 'b'.repeat(64),
      modelId: CAPTIONS_TRANSCRIPT_MODEL,
    },
  });
  // Il testo originale conservato alla prima correzione.
  await prisma.postprodOriginalBody.create({
    data: {
      artifactId: artefatto.id,
      recordingId: registrazione.id,
      eventId,
      type: 'TRANSCRIPT_JSON',
      body: encryptPII(corpo),
      contentHash: 'b'.repeat(64),
    },
  });
  await prisma.speaker.createMany({
    data: persone.map((p, i) => ({
      recordingId: registrazione.id,
      diarLabel: `SPEAKER_0${i}`,
      displayName: p.nome,
    })),
  });
  return registrazione.id;
}

/** Cosa resta della trascrizione: i testi in chiaro, i nomi delle voci. */
async function restoDellaTrascrizione(recordingId: string) {
  const artefatto = await prisma.postprodArtifact.findFirstOrThrow({
    where: { recordingId, type: 'TRANSCRIPT_JSON' },
    select: { inlineBody: true, original: { select: { body: true } } },
  });
  const voci = await prisma.speaker.findMany({
    where: { recordingId },
    select: { displayName: true },
  });
  return {
    corpo: tryDecryptPII(artefatto.inlineBody!) ?? '',
    originale: tryDecryptPII(artefatto.original!.body) ?? '',
    voci: voci.map((v) => v.displayName),
  };
}

/** Una persona dello staff o una concessione con il consenso dato in sala: le due
 *  prove, con i legami e l'impronta che scrive l'ingresso in sala. */
async function proveDiSala(
  eventId: string,
  legami: { eventModeratorId?: string; staffAccountId?: string; emailHash?: string },
  { registrazione = true, posto = `mod-${eventId}-aa` } = {}
) {
  const base = {
    eventId,
    jitsiUserId: posto,
    displayName: encryptPII('Sara Rossi'),
    consentedAt: giorniFa(1),
    ...legami,
  };
  if (registrazione) await prisma.recordingConsent.create({ data: base });
  await prisma.multitrackConsent.create({ data: base });
}

/** Aspetta che `quanti` transazioni siano in fila sul blocco di un evento. */
async function inFila(quanti: number) {
  await vi.waitFor(
    async () => {
      const [{ n }] = await prisma.$queryRaw<[{ n: bigint }]>`
        SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`;
      expect(Number(n)).toBe(quanti);
    },
    { timeout: 20_000, interval: 25 }
  );
}

/** Tiene il blocco dell'evento finche' `fatto` non si risolve. */
function tieniIlBlocco(eventId: string, fatto: Promise<unknown>) {
  let preso: () => void = () => undefined;
  const bloccato = new Promise<void>((risolvi) => {
    preso = risolvi;
  });
  const finito = prisma.$transaction(
    async (tx) => {
      await bloccaTrascrizioneEvento(tx, eventId);
      preso();
      await fatto;
    },
    { timeout: 30_000 }
  );
  return { bloccato, finito };
}

/** La prova di sala dell'iscritta dopo una sostituzione: il periodo di prima e'
 *  chiuso senza un ritiro, come lo lascia l'ingresso in sala con un testo che la
 *  prova non copriva. */
async function sostituisciConsenso(registrationId: string) {
  await prisma.recordingConsent.updateMany({
    where: { registrationId },
    data: {
      consentedAt: giorniFa(61),
      destination: 'PUBLIC',
      textVersion: 1,
      earlierPeriods: [
        {
          consentedAt: giorniFa(63).toISOString(),
          withdrawnAt: null,
          destination: 'REGISTRANTS',
          textVersion: 1,
        },
      ],
    },
  });
}

const prove = (eventId: string) =>
  prisma.retainedConsentProof.findMany({
    where: { eventId },
    orderBy: { givenAt: 'asc' },
  });

beforeEach(async () => {
  await svuotaDatabase();
});

describe('pulizia dei dati', () => {
  it('un video pubblicato tiene le prove: le sorgenti se ne vanno, il nome si decifra uguale', async () => {
    const evento = await creaEvento(PUBBLICATO);
    const { reg, emailHash } = await iscritta(evento.id);
    await prisma.recordingConsent.create({
      data: {
        eventId: evento.id,
        jitsiUserId: 'guest-1',
        displayName: encryptPII('Ospite Uno'),
        consentedAt: giorniFa(61),
      },
    });

    const esito = await giroDiPulizia();

    expect(esito.eventsProcessed).toBe(1);
    expect(await prisma.registration.count({ where: { id: reg.id } })).toBe(0);
    expect(await prisma.recordingConsent.count()).toBe(0);
    expect(await prisma.multitrackConsent.count()).toBe(0);
    const righe = await prove(evento.id);
    // Iscrizione (2), sala con un periodo precedente (2), trascrizione in sala
    // (1), ospite (1).
    expect(righe).toHaveLength(6);
    expect(esito.consentProofsRetained).toBe(6);
    const conIndirizzo = righe.filter((r) => r.emailHash === emailHash);
    expect(conIndirizzo).toHaveLength(5);
    for (const r of conIndirizzo) {
      expect(tryDecryptPII(r.displayName!)).toBe('Anna Bianchi');
      expect(r.nameRemovedAt).toBeNull();
    }
    expect(new Set(conIndirizzo.map((r) => r.holderHash)).size).toBe(1);
    const ospite = righe.find((r) => r.emailHash === null)!;
    expect(tryDecryptPII(ospite.displayName!)).toBe('Ospite Uno');
    expect(ospite.role).toBe('guest');
    const periodi = righe.filter((r) => r.kind === 'recording' && r.source === 'room');
    expect(periodi.map((r) => r.destination)).toEqual(['PUBLIC', 'PUBLIC', null]);
  });

  it('il secondo giro non cambia niente e non scrive nel registro', async () => {
    const evento = await creaEvento(PUBBLICATO);
    await iscritta(evento.id);
    await giroDiPulizia();
    const prima = await prove(evento.id);
    const righeRegistro = await prisma.gdprAuditLog.count({
      where: { eventId: evento.id },
    });

    const esito = await giroDiPulizia();

    expect(esito.consentProofsRetained).toBe(0);
    expect(esito.retainedConsentProofsDeleted).toBe(0);
    expect(await prove(evento.id)).toEqual(prima);
    expect(await prisma.gdprAuditLog.count({ where: { eventId: evento.id } })).toBe(
      righeRegistro
    );
  });

  it('il link esterno conta come video', async () => {
    const evento = await creaEvento({
      ...CONCLUSO,
      youtubeUrl: 'https://video.example.com/1',
    });
    await iscritta(evento.id);
    await giroDiPulizia();
    expect(
      await prisma.retainedConsentProof.count({ where: { eventId: evento.id } })
    ).toBe(5);
  });

  it('niente registrato: nessuna prova resta', async () => {
    const evento = await creaEvento(CONCLUSO);
    await iscritta(evento.id);
    await giroDiPulizia();
    expect(await prisma.registration.count()).toBe(0);
    expect(await prisma.retainedConsentProof.count()).toBe(0);
  });

  it('un file non pubblicato tiene le prove, con il nome: la registrazione resta', async () => {
    const evento = await creaEvento({ ...CONCLUSO, recordingUrl: VIDEO });
    await iscritta(evento.id);
    await giroDiPulizia();
    const righe = await prove(evento.id);
    expect(righe).toHaveLength(5);
    expect(righe.every((r) => r.nameRemovedAt === null && r.displayName !== null)).toBe(
      true
    );
  });

  it('la sola trascrizione non pubblicata tiene la sua prova', async () => {
    const evento = await creaEvento(CONCLUSO);
    await iscritta(evento.id);
    await creaTrascrizione(evento.id);

    await giroDiPulizia();

    const righe = await prove(evento.id);
    expect(righe.length).toBeGreaterThan(0);
    expect(righe.every((r) => r.kind === 'transcription')).toBe(true);
  });

  it('la sola trascrizione pubblicata tiene la sua prova, se l’artefatto c’e’', async () => {
    const evento = await creaEvento({ ...CONCLUSO, transcriptPublished: true });
    await iscritta(evento.id);
    await creaTrascrizione(evento.id);

    await giroDiPulizia();

    const righe = await prove(evento.id);
    expect(righe.length).toBeGreaterThan(0);
    expect(righe.every((r) => r.kind === 'transcription')).toBe(true);
  });

  it('il flag della trascrizione senza artefatto non tiene le prove', async () => {
    const evento = await creaEvento({ ...CONCLUSO, transcriptPublished: true });
    await iscritta(evento.id);
    await giroDiPulizia();
    expect(await prisma.retainedConsentProof.count()).toBe(0);
  });

  it('video tolto: le prove spariscono al giro dopo, con una riga nel registro', async () => {
    const evento = await creaEvento(PUBBLICATO);
    await iscritta(evento.id);
    await giroDiPulizia();
    expect(await prisma.retainedConsentProof.count()).toBe(5);

    await prisma.event.update({
      where: { id: evento.id },
      data: { recordingUrl: null, recordingPublished: false },
    });
    const esito = await giroDiPulizia();

    expect(esito.retainedConsentProofsDeleted).toBe(5);
    expect(await prisma.retainedConsentProof.count()).toBe(0);
    const righe = await prisma.gdprAuditLog.findMany({
      where: { eventId: evento.id, action: 'DATA_DELETED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(JSON.parse(righe[0]!.details!)).toMatchObject({ retainedConsentProofs: 5 });
  });

  it('video tolto e trascrizione pubblicata: resta solo la prova della trascrizione', async () => {
    const evento = await creaEvento({ ...PUBBLICATO, transcriptPublished: true });
    await iscritta(evento.id);
    await giroDiPulizia();

    await creaTrascrizione(evento.id);
    await prisma.event.update({
      where: { id: evento.id },
      data: { recordingUrl: null, recordingPublished: false },
    });

    await giroDiPulizia();

    const righe = await prove(evento.id);
    expect(righe.length).toBeGreaterThan(0);
    expect(righe.every((r) => r.kind === 'transcription')).toBe(true);
  });

  it('una concessione porta l’indirizzo sulla prova, e se ne va nella stessa transazione', async () => {
    const evento = await creaEvento(PUBBLICATO);
    const indirizzo = `${randomUUID()}@example.org`;
    const concessione = await prisma.eventModerator.create({
      data: {
        eventId: evento.id,
        name: encryptPII('Relatrice'),
        email: encryptPII(indirizzo),
        emailHash: hashEmail(indirizzo),
        token: randomUUID(),
        role: 'SPEAKER',
      },
    });
    await prisma.recordingConsent.create({
      data: {
        eventId: evento.id,
        jitsiUserId: 'mod-e-1',
        displayName: encryptPII('Relatrice'),
        eventModeratorId: concessione.id,
        consentedAt: giorniFa(61),
      },
    });

    await giroDiPulizia();

    expect(await prisma.eventModerator.count()).toBe(0);
    const [prova] = await prove(evento.id);
    expect(prova).toMatchObject({ role: 'host', emailHash: hashEmail(indirizzo) });
  });

  it('cancellare l’evento cancella le sue prove, in cascata', async () => {
    const evento = await creaEvento(PUBBLICATO);
    await iscritta(evento.id);
    await giroDiPulizia();
    await prisma.event.delete({ where: { id: evento.id } });
    expect(await prisma.retainedConsentProof.count()).toBe(0);
  });
});

describe('cancellazione chiesta dalla persona', () => {
  it('prima della pulizia: la prova resta senza nome, con il ritiro all’ora della richiesta', async () => {
    const evento = await creaEvento({
      ...PUBBLICATO,
      endsAt: giorniFa(1),
      startsAt: giorniFa(2),
    });
    const { reg, emailHash } = await iscritta(evento.id);

    const prima = Date.now();
    const risposta = await chiediCancellazione(emailHash);

    expect(risposta).toMatchObject({ deleted: 1, consentProofsKept: 5 });
    expect(await prisma.registration.count({ where: { id: reg.id } })).toBe(0);
    expect(await prisma.recordingConsent.count()).toBe(0);
    const righe = await prove(evento.id);
    expect(righe).toHaveLength(5);
    for (const r of righe) {
      expect(r.displayName).toBeNull();
      expect(r.nameRemovedAt).not.toBeNull();
      expect(r.emailHash).toBe(emailHash);
      expect(r.withdrawnAt).not.toBeNull();
    }
    const nuovi = righe.filter((r) => r.withdrawnAt!.getTime() >= prima);
    expect(nuovi).toHaveLength(4);
  });

  it('senza niente di pubblicato non resta niente', async () => {
    const evento = await creaEvento({
      status: 'ENDED',
      startsAt: giorniFa(2),
      endsAt: giorniFa(1),
    });
    const { emailHash } = await iscritta(evento.id);
    expect(await chiediCancellazione(emailHash)).toMatchObject({ consentProofsKept: 0 });
    expect(await prisma.retainedConsentProof.count()).toBe(0);
  });

  it('dopo la pulizia: toglie il nome dalle prove conservate e lascia traccia', async () => {
    const evento = await creaEvento(PUBBLICATO);
    const { emailHash } = await iscritta(evento.id);
    await giroDiPulizia();
    const righeRegistro = await prisma.gdprAuditLog.count({
      where: { action: 'DATA_DELETED' },
    });

    const risposta = await chiediCancellazione(emailHash);

    expect(risposta).toMatchObject({ deleted: 0, consentProofsKept: 5 });
    const righe = await prove(evento.id);
    expect(righe.every((r) => r.displayName === null && r.nameRemovedAt !== null)).toBe(
      true
    );
    expect(righe.every((r) => r.withdrawnAt !== null)).toBe(true);
    expect(await prisma.gdprAuditLog.count({ where: { action: 'DATA_DELETED' } })).toBe(
      righeRegistro + 1
    );
  });

  it('una richiesta ripetuta non cambia niente e non scrive nel registro', async () => {
    const evento = await creaEvento(PUBBLICATO);
    const { emailHash } = await iscritta(evento.id);
    await giroDiPulizia();
    await chiediCancellazione(emailHash);
    const prima = await prove(evento.id);
    const righeRegistro = await prisma.gdprAuditLog.count();

    expect(await chiediCancellazione(emailHash)).toMatchObject({ consentProofsKept: 5 });

    expect(await prove(evento.id)).toEqual(prima);
    expect(await prisma.gdprAuditLog.count()).toBe(righeRegistro);
  });

  it('la prova di un’altra persona dello stesso evento non cambia', async () => {
    const evento = await creaEvento(PUBBLICATO);
    const anna = await iscritta(evento.id);
    const luca = await iscritta(evento.id, 'Luca Verdi');
    await giroDiPulizia();

    await chiediCancellazione(anna.emailHash);

    const altre = await prisma.retainedConsentProof.findMany({
      where: { emailHash: luca.emailHash },
    });
    expect(altre).toHaveLength(5);
    expect(altre.every((r) => tryDecryptPII(r.displayName!) === 'Luca Verdi')).toBe(true);
  });

  it('la concessione: copia prima, e un nuovo tentativo non la raddoppia', async () => {
    const evento = await creaEvento({
      ...PUBBLICATO,
      endsAt: giorniFa(1),
      startsAt: giorniFa(2),
    });
    const indirizzo = `${randomUUID()}@example.org`;
    const emailHash = hashEmail(indirizzo);
    const concessione = await prisma.eventModerator.create({
      data: {
        eventId: evento.id,
        name: encryptPII('Relatrice'),
        email: encryptPII(indirizzo),
        emailHash,
        token: randomUUID(),
        role: 'SPEAKER',
      },
    });
    await prisma.recordingConsent.create({
      data: {
        eventId: evento.id,
        jitsiUserId: 'mod-e-1',
        displayName: encryptPII('Relatrice'),
        eventModeratorId: concessione.id,
        consentedAt: giorniFa(1),
      },
    });

    expect(await chiediCancellazione(emailHash)).toMatchObject({
      deleted: 0,
      grantsDeleted: 1,
      consentProofsKept: 1,
    });
    expect(await chiediCancellazione(emailHash)).toMatchObject({ consentProofsKept: 1 });

    expect(await prisma.eventModerator.count()).toBe(0);
    expect(await prisma.recordingConsent.count()).toBe(0);
    const [prova] = await prove(evento.id);
    expect(prova).toMatchObject({ role: 'host', displayName: null, emailHash });
    expect(await prisma.retainedConsentProof.count()).toBe(1);
  });

  it('la cancellazione dallo staff di una sola iscrizione tiene la prova senza nome', async () => {
    const evento = await creaEvento({
      ...PUBBLICATO,
      endsAt: giorniFa(1),
      startsAt: giorniFa(2),
    });
    const { reg } = await iscritta(evento.id);
    await entraCome('ADMIN');

    const res = await cancellaIscrizione(
      richiesta(
        `/api/admin/events/${evento.id}/registrations/${reg.id}`,
        'DELETE'
      ) as NextRequest,
      contesto({ id: evento.id, regId: reg.id })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ registrations: 1, consentProofsKept: 5 });
    const righe = await prove(evento.id);
    expect(righe).toHaveLength(5);
    expect(righe.every((r) => r.displayName === null)).toBe(true);
  });

  it('la prova data con un account dello staff resta senza nome, e la pulizia non la rifa', async () => {
    const evento = await creaEvento(PUBBLICATO);
    const account = await entraCome('ORGANIZER');
    await prisma.recordingConsent.create({
      data: {
        eventId: evento.id,
        jitsiUserId: 'mod-e-staff',
        displayName: encryptPII('Sara Rossi'),
        staffAccountId: account.id,
        consentedAt: giorniFa(61),
        destination: 'PUBLIC',
        textVersion: 1,
      },
    });

    expect(await chiediCancellazione(account.emailHash)).toMatchObject({
      deleted: 0,
      consentProofsKept: 1,
    });
    await giroDiPulizia();

    expect(await prisma.recordingConsent.count()).toBe(0);
    const righe = await prove(evento.id);
    expect(righe).toHaveLength(1);
    expect(righe[0]).toMatchObject({
      role: 'host',
      displayName: null,
      emailHash: account.emailHash,
    });
    expect(righe[0]!.nameRemovedAt).not.toBeNull();
    expect(righe[0]!.withdrawnAt).not.toBeNull();
    // L'account resta: la cancellazione riguarda i dati dei partecipanti.
    expect(await prisma.staffAccount.count({ where: { id: account.id } })).toBe(1);
  });

  it('senza niente di pubblicato la prova dell’account se ne va e basta', async () => {
    const evento = await creaEvento(CONCLUSO);
    const account = await entraCome('ORGANIZER');
    await prisma.recordingConsent.create({
      data: {
        eventId: evento.id,
        jitsiUserId: 'mod-e-staff',
        displayName: encryptPII('Sara Rossi'),
        staffAccountId: account.id,
      },
    });

    expect(await chiediCancellazione(account.emailHash)).toMatchObject({
      consentProofsKept: 0,
    });

    expect(await prisma.recordingConsent.count()).toBe(0);
    expect(await prisma.retainedConsentProof.count()).toBe(0);
  });

  it('la prova resta anche se la cascata toglie l’iscrizione: nessuna chiave verso di lei', async () => {
    const evento = await creaEvento({
      ...PUBBLICATO,
      endsAt: giorniFa(1),
      startsAt: giorniFa(2),
    });
    const { reg, emailHash } = await iscritta(evento.id);
    await chiediCancellazione(emailHash);
    await prisma.registration.deleteMany({ where: { id: reg.id } });
    expect(await prisma.retainedConsentProof.count({ where: { emailHash } })).toBe(5);
  });
});

describe('la trascrizione pubblicata dopo la pulizia', () => {
  /** Un video e una trascrizione pubblicati, due persone che parlano, la pulizia
   *  passata: le iscrizioni non ci sono piu', la trascrizione si'. */
  async function dopoLaPulizia() {
    const evento = await creaEvento({ ...PUBBLICATO, transcriptPublished: true });
    const anna = await iscritta(evento.id, 'Anna Bianchi');
    const luca = await iscritta(evento.id, 'Luca Verdi');
    const registrazione = await trascrizioneDaiSottotitoli(evento.id, [
      { registrationId: anna.reg.id, nome: 'Anna Bianchi' },
      { registrationId: luca.reg.id, nome: 'Luca Verdi' },
    ]);
    await giroDiPulizia();
    expect(await prisma.registration.count({ where: { eventId: evento.id } })).toBe(0);
    return { evento, anna, luca, registrazione };
  }
  const soloLuca = async (recordingId: string) => {
    const resto = await restoDellaTrascrizione(recordingId);
    for (const testo of [resto.corpo, resto.originale]) {
      expect(testo).toContain('Frase di Luca Verdi');
      expect(testo).not.toContain('Anna Bianchi');
    }
    expect(resto.voci).toEqual(['Luca Verdi']);
  };
  const ritiraLaProva = async (
    emailHash: string,
    kind: 'recording' | 'transcription'
  ) => {
    const { retainedConsentProofs, consentsToken } = await chiediDati(emailHash);
    const prova = retainedConsentProofs.find((p) => p.kind === kind);
    const res = await ritira(
      daIp('/api/gdpr/consents', 'POST', {
        token: consentsToken,
        proofId: prova?.id,
        consent: kind,
      }),
      contesto({})
    );
    expect(res.status).toBe(200);
  };

  it('il ritiro della trascrizione toglie nome e frasi, non quelli degli altri', async () => {
    const { anna, registrazione } = await dopoLaPulizia();
    await ritiraLaProva(anna.emailHash, 'transcription');
    await soloLuca(registrazione);
  });

  it('il ritiro della registrazione, che la trascina, li toglie anche lui', async () => {
    const { anna, registrazione } = await dopoLaPulizia();
    await ritiraLaProva(anna.emailHash, 'recording');
    await soloLuca(registrazione);
  });

  it('la cancellazione chiesta dalla persona li toglie', async () => {
    const { anna, registrazione } = await dopoLaPulizia();
    await chiediCancellazione(anna.emailHash);
    await soloLuca(registrazione);
  });

  it('una trascrizione che resta vuota se ne va, e il video resta', async () => {
    const evento = await creaEvento({ ...PUBBLICATO, transcriptPublished: true });
    const anna = await iscritta(evento.id);
    const registrazione = await trascrizioneDaiSottotitoli(evento.id, [
      { registrationId: anna.reg.id, nome: 'Anna Bianchi' },
    ]);
    await giroDiPulizia();

    await chiediCancellazione(anna.emailHash);

    expect(
      await prisma.postprodArtifact.count({ where: { recordingId: registrazione } })
    ).toBe(0);
    expect(await prisma.speaker.count({ where: { recordingId: registrazione } })).toBe(0);
    expect(await prisma.recording.count({ where: { id: registrazione } })).toBe(1);
  });

  it('una richiesta ripetuta non scrive nel registro', async () => {
    const { anna } = await dopoLaPulizia();
    await chiediCancellazione(anna.emailHash);
    const righe = await prisma.gdprAuditLog.count();
    await chiediCancellazione(anna.emailHash);
    expect(await prisma.gdprAuditLog.count()).toBe(righe);
  });
});

describe('prove di chi conduce', () => {
  const RECENTE = { ...PUBBLICATO, startsAt: giorniFa(2), endsAt: giorniFa(1) };
  async function relatrice(eventId: string) {
    const indirizzo = `${randomUUID()}@example.org`;
    const emailHash = hashEmail(indirizzo);
    const concessione = await prisma.eventModerator.create({
      data: {
        eventId,
        name: encryptPII('Relatrice'),
        email: encryptPII(indirizzo),
        emailHash,
        token: randomUUID(),
        role: 'SPEAKER',
      },
    });
    return { concessione, emailHash };
  }

  it('la concessione: anche la prova della trascrizione resta senza nome, e la pulizia non la rifa', async () => {
    const evento = await creaEvento(RECENTE);
    const { concessione, emailHash } = await relatrice(evento.id);
    await proveDiSala(evento.id, { eventModeratorId: concessione.id, emailHash });

    await chiediCancellazione(emailHash);

    expect(await prisma.multitrackConsent.count()).toBe(0);
    expect(await prisma.recordingConsent.count()).toBe(0);
    const righe = await prove(evento.id);
    expect(righe.map((r) => r.kind).sort()).toEqual(['recording', 'transcription']);
    for (const r of righe) {
      expect(r).toMatchObject({ role: 'host', displayName: null, emailHash });
      expect(r.withdrawnAt).not.toBeNull();
    }
    // Lo stesso titolare per le due prove: una persona, non due.
    expect(new Set(righe.map((r) => r.holderHash)).size).toBe(1);

    await prisma.event.update({
      where: { id: evento.id },
      data: { endsAt: giorniFa(61), startsAt: giorniFa(62) },
    });
    await giroDiPulizia();
    expect(await prove(evento.id)).toHaveLength(2);
    expect((await prove(evento.id)).every((r) => r.displayName === null)).toBe(true);
  });

  it('su un video non ancora pubblicato la prova resta senza nome', async () => {
    const evento = await creaEvento({
      status: 'ENDED',
      startsAt: giorniFa(2),
      endsAt: giorniFa(1),
      dataRetentionDays: 365,
      recordingUrl: VIDEO,
    });
    const { concessione, emailHash } = await relatrice(evento.id);
    await proveDiSala(evento.id, { eventModeratorId: concessione.id, emailHash });

    expect(await chiediCancellazione(emailHash)).toMatchObject({ consentProofsKept: 2 });

    expect((await prove(evento.id)).every((r) => r.displayName === null)).toBe(true);
  });

  it('chi ha dato la sola trascrizione ha lo stesso trattamento', async () => {
    const evento = await creaEvento(RECENTE);
    const { concessione, emailHash } = await relatrice(evento.id);
    await proveDiSala(
      evento.id,
      { eventModeratorId: concessione.id, emailHash },
      { registrazione: false }
    );

    expect(await chiediCancellazione(emailHash)).toMatchObject({ consentProofsKept: 1 });

    expect(await prisma.multitrackConsent.count()).toBe(0);
    expect(await prove(evento.id)).toMatchObject([
      { kind: 'transcription', displayName: null, emailHash },
    ]);
  });

  it('l’account dello staff: la prova della trascrizione resta senza nome', async () => {
    const evento = await creaEvento(RECENTE);
    const account = await entraCome('ORGANIZER');
    await proveDiSala(evento.id, {
      staffAccountId: account.id,
      emailHash: account.emailHash,
    });

    await chiediCancellazione(account.emailHash);

    expect(await prisma.multitrackConsent.count()).toBe(0);
    expect(await prove(evento.id)).toHaveLength(2);
    expect((await prove(evento.id)).every((r) => r.displayName === null)).toBe(true);
    // L'account resta: la persona lavora ancora qui.
    expect(await prisma.staffAccount.count({ where: { id: account.id } })).toBe(1);
  });

  it('una prova scritta prima dell’impronta si raggiunge dal legame con la concessione', async () => {
    const evento = await creaEvento(RECENTE);
    const { concessione, emailHash } = await relatrice(evento.id);
    await proveDiSala(evento.id, { eventModeratorId: concessione.id });

    await chiediCancellazione(emailHash);

    expect(await prisma.multitrackConsent.count()).toBe(0);
    expect(await prove(evento.id)).toMatchObject([
      { displayName: null, emailHash },
      { displayName: null, emailHash },
    ]);
  });

  describe('l’account cancellato prima della pulizia', () => {
    async function senzaAccount(evento: { id: string }) {
      const account = await entraCome('ORGANIZER');
      await proveDiSala(evento.id, {
        staffAccountId: account.id,
        emailHash: account.emailHash,
      });
      await prisma.staffAccount.delete({ where: { id: account.id } });
      const [riga] = await prisma.recordingConsent.findMany();
      expect(riga?.staffAccountId).toBeNull();
      return account.emailHash;
    }

    it('la pulizia copia la prova con l’impronta, e la cancellazione le toglie il nome', async () => {
      const evento = await creaEvento(PUBBLICATO);
      const emailHash = await senzaAccount(evento);
      await giroDiPulizia();
      expect(await prove(evento.id)).toMatchObject([{ emailHash }, { emailHash }]);
      expect((await prove(evento.id)).every((r) => r.displayName !== null)).toBe(true);

      await chiediCancellazione(emailHash);

      expect((await prove(evento.id)).every((r) => r.displayName === null)).toBe(true);
    });

    it('prima della pulizia la cancellazione raggiunge le sorgenti', async () => {
      const evento = await creaEvento(RECENTE);
      const emailHash = await senzaAccount(evento);

      expect(await chiediCancellazione(emailHash)).toMatchObject({
        consentProofsKept: 2,
      });

      expect(await prisma.recordingConsent.count()).toBe(0);
      expect(await prisma.multitrackConsent.count()).toBe(0);
    });
  });

  it('la concessione tolta dallo staff: la cancellazione arriva lo stesso alla prova', async () => {
    const evento = await creaEvento(PUBBLICATO);
    const { concessione, emailHash } = await relatrice(evento.id);
    await proveDiSala(evento.id, { eventModeratorId: concessione.id, emailHash });
    await prisma.eventModerator.delete({ where: { id: concessione.id } });
    await giroDiPulizia();

    await chiediCancellazione(emailHash);

    expect(await prove(evento.id)).toHaveLength(2);
    expect((await prove(evento.id)).every((r) => r.displayName === null)).toBe(true);
  });
});

describe('chi conduce nei sottotitoli e nelle trascrizioni', () => {
  const RECENTE = {
    ...PUBBLICATO,
    transcriptPublished: true,
    startsAt: giorniFa(2),
    endsAt: giorniFa(1),
  };
  const POSTO = 'mod-sala-relatrice';

  async function frase(eventId: string, posto: string, nome: string, n: number) {
    const inizio = Date.now() - 3_600_000 + n * 10_000;
    await prisma.captionSegment.create({
      data: {
        eventId,
        messageId: randomUUID(),
        endpointId: `ep-${n}`,
        seatId: posto,
        speakerName: encryptPII(nome),
        text: encryptPII(`Frase di ${nome}`),
        language: 'it',
        startedAt: new Date(inizio),
        endedAt: new Date(inizio + 5_000),
      },
    });
  }

  /** Una relatrice con la sua concessione e un ospite, ognuno con una frase. */
  async function conDueVoci(eventId: string, conPosto: string = POSTO) {
    const indirizzo = `${randomUUID()}@example.org`;
    const emailHash = hashEmail(indirizzo);
    const concessione = await prisma.eventModerator.create({
      data: {
        eventId,
        name: encryptPII('Relatrice'),
        email: encryptPII(indirizzo),
        emailHash,
        token: randomUUID(),
        role: 'SPEAKER',
      },
    });
    await proveDiSala(
      eventId,
      { eventModeratorId: concessione.id, emailHash },
      { posto: conPosto }
    );
    await proveDiSala(eventId, {}, { posto: 'ospite-sala', registrazione: false });
    await frase(eventId, conPosto, 'Relatrice', 1);
    await frase(eventId, 'ospite-sala', 'Ospite', 2);
    return { concessione, emailHash };
  }

  async function costruita(eventId: string) {
    const esito = await costruisciTrascrizioneDaiSottotitoli(eventId);
    if (esito.stato !== 'scritta') throw new Error(esito.stato);
    return esito.recordingId;
  }

  const trascrizione = async (recordingId: string) => {
    const artefatto = await prisma.postprodArtifact.findFirstOrThrow({
      where: { recordingId, type: 'TRANSCRIPT_JSON' },
      select: { inlineBody: true },
    });
    const voci = await prisma.speaker.findMany({
      where: { recordingId },
      select: { displayName: true },
    });
    return {
      corpo: tryDecryptPII(artefatto.inlineBody!) ?? '',
      voci: voci.map((v) => v.displayName),
    };
  };
  const senzaRelatrice = async (recordingId: string) => {
    const { corpo, voci } = await trascrizione(recordingId);
    expect(corpo).not.toContain('Relatrice');
    expect(corpo).toContain('Frase di Ospite');
    expect(voci).toEqual(['Ospite']);
  };
  /** La pulizia a conservazione finita: restano le prove e la trascrizione. */
  const dopoLaConservazione = async (eventId: string) => {
    await prisma.event.update({
      where: { id: eventId },
      data: { startsAt: giorniFa(62), endsAt: giorniFa(61) },
    });
    await giroDiPulizia();
    expect(await prisma.captionSegment.count({ where: { eventId } })).toBe(0);
  };

  it('la cancellazione toglie le frasi salvate e la trascrizione gia’ costruita', async () => {
    const evento = await creaEvento(RECENTE);
    const { emailHash } = await conDueVoci(evento.id);
    const recordingId = await costruita(evento.id);
    expect((await trascrizione(recordingId)).voci.sort()).toEqual([
      'Ospite',
      'Relatrice',
    ]);

    await chiediCancellazione(emailHash);

    expect(await prisma.captionSegment.count({ where: { seatId: POSTO } })).toBe(0);
    expect(await prisma.captionSegment.count({ where: { seatId: 'ospite-sala' } })).toBe(
      1
    );
    await senzaRelatrice(recordingId);
  });

  it('una costruzione successiva non riporta nome e frasi', async () => {
    const evento = await creaEvento(RECENTE);
    const { emailHash } = await conDueVoci(evento.id);

    await chiediCancellazione(emailHash);

    await senzaRelatrice(await costruita(evento.id));
  });

  it('la cancellazione raggiunge i posti della sola trascrizione', async () => {
    const evento = await creaEvento(RECENTE);
    const { emailHash, concessione } = await conDueVoci(evento.id);
    await proveDiSala(
      evento.id,
      { eventModeratorId: concessione.id, emailHash },
      { posto: 'mod-sala-secondo-ingresso', registrazione: false }
    );
    await frase(evento.id, 'mod-sala-secondo-ingresso', 'Relatrice', 3);
    const recordingId = await costruita(evento.id);

    await chiediCancellazione(emailHash);

    expect(await prisma.captionSegment.count({ where: { eventId: evento.id } })).toBe(1);
    await senzaRelatrice(recordingId);
  });

  it('l’account dello staff esce allo stesso modo, e l’account resta', async () => {
    const evento = await creaEvento(RECENTE);
    await conDueVoci(evento.id);
    const account = await entraCome('ORGANIZER');
    await proveDiSala(
      evento.id,
      { staffAccountId: account.id, emailHash: account.emailHash },
      { posto: 'mod-sala-staff' }
    );
    await frase(evento.id, 'mod-sala-staff', 'Organizzatrice', 3);
    const recordingId = await costruita(evento.id);

    await chiediCancellazione(account.emailHash);

    expect(
      await prisma.captionSegment.count({ where: { seatId: 'mod-sala-staff' } })
    ).toBe(0);
    const { corpo, voci } = await trascrizione(recordingId);
    expect(corpo).not.toContain('Organizzatrice');
    expect(voci.sort()).toEqual(['Ospite', 'Relatrice']);
    expect(await prisma.staffAccount.count({ where: { id: account.id } })).toBe(1);
  });

  it('due concessioni con lo stesso nome sono due voci: ne esce solo una', async () => {
    const evento = await creaEvento(RECENTE);
    const { emailHash } = await conDueVoci(evento.id);
    const altra = await prisma.eventModerator.create({
      data: {
        eventId: evento.id,
        name: encryptPII('Relatrice'),
        token: randomUUID(),
        role: 'SPEAKER',
      },
    });
    await proveDiSala(
      evento.id,
      { eventModeratorId: altra.id },
      { posto: 'mod-sala-omonima', registrazione: false }
    );
    await frase(evento.id, 'mod-sala-omonima', 'Relatrice', 3);
    const recordingId = await costruita(evento.id);
    expect(
      (await trascrizione(recordingId)).voci.filter((v) => v === 'Relatrice')
    ).toHaveLength(2);

    await chiediCancellazione(emailHash);

    expect((await trascrizione(recordingId)).voci.sort()).toEqual([
      'Ospite',
      'Relatrice',
    ]);
  });

  it('il ritiro di una prova conservata toglie nome e frasi di chi ha la concessione', async () => {
    const evento = await creaEvento(RECENTE);
    const { emailHash } = await conDueVoci(evento.id);
    const recordingId = await costruita(evento.id);
    await dopoLaConservazione(evento.id);

    const { retainedConsentProofs, consentsToken } = await chiediDati(emailHash);
    const prova = retainedConsentProofs.find((p) => p.kind === 'transcription');
    const res = await ritira(
      daIp('/api/gdpr/consents', 'POST', {
        token: consentsToken,
        proofId: prova?.id,
        consent: 'transcription',
      }),
      contesto({})
    );

    expect(res.status).toBe(200);
    await senzaRelatrice(recordingId);
  });

  it('la cancellazione dopo la pulizia fa lo stesso', async () => {
    const evento = await creaEvento(RECENTE);
    const { emailHash } = await conDueVoci(evento.id);
    const recordingId = await costruita(evento.id);
    await dopoLaConservazione(evento.id);

    await chiediCancellazione(emailHash);

    await senzaRelatrice(recordingId);
  });

  it('un account cancellato prima della pulizia si riconosce dal posto', async () => {
    const evento = await creaEvento(RECENTE);
    await conDueVoci(evento.id);
    const account = await entraCome('ORGANIZER');
    await proveDiSala(
      evento.id,
      { staffAccountId: account.id, emailHash: account.emailHash },
      { posto: 'mod-sala-staff' }
    );
    await frase(evento.id, 'mod-sala-staff', 'Organizzatrice', 3);
    const recordingId = await costruita(evento.id);
    await prisma.staffAccount.delete({ where: { id: account.id } });
    await dopoLaConservazione(evento.id);

    await chiediCancellazione(account.emailHash);

    const { corpo } = await trascrizione(recordingId);
    expect(corpo).not.toContain('Organizzatrice');
    expect(corpo).toContain('Frase di Relatrice');
  });

  it('un corpo scritto senza impronte tiene chi conduce, e la risposta resta 200', async () => {
    const evento = await creaEvento(RECENTE);
    const { emailHash } = await conDueVoci(evento.id);
    const recordingId = await costruita(evento.id);
    const artefatto = await prisma.postprodArtifact.findFirstOrThrow({
      where: { recordingId, type: 'TRANSCRIPT_JSON' },
    });
    const corpo = JSON.parse(tryDecryptPII(artefatto.inlineBody!) ?? '{}') as {
      speakers: Array<{ titolari?: string[] }>;
    };
    for (const s of corpo.speakers) delete s.titolari;
    await prisma.postprodArtifact.update({
      where: { id: artefatto.id },
      data: { inlineBody: encryptPII(JSON.stringify(corpo)) },
    });

    await chiediCancellazione(emailHash);

    expect((await trascrizione(recordingId)).corpo).toContain('Frase di Relatrice');
    expect(await prisma.captionSegment.count({ where: { seatId: POSTO } })).toBe(0);
  });

  it('i titolari non escono dal corpo cifrato', async () => {
    const evento = await creaEvento(RECENTE);
    await conDueVoci(evento.id);
    const recordingId = await costruita(evento.id);
    const voci = await prisma.speaker.findMany({ where: { recordingId } });
    expect(JSON.stringify(voci)).not.toContain('titolari');
  });

  it('l’export consegna le prove di sala di chi conduce, anche la sola trascrizione', async () => {
    const evento = await creaEvento(RECENTE);
    const { emailHash, concessione } = await conDueVoci(evento.id);
    await prisma.recordingConsent.deleteMany({
      where: { eventModeratorId: concessione.id },
    });

    const res = await esporta(
      daIp(`/api/gdpr/export?t=${issueGdprToken('export', emailHash)}`),
      contesto({})
    );
    const { roomConsentProofs } = (await res.json()) as {
      roomConsentProofs: Array<{ kind: string; eventId: string }>;
    };

    expect(roomConsentProofs).toMatchObject([
      { kind: 'transcription', eventId: evento.id },
    ]);
  });
});

describe('un video che esiste e non e’ pubblicato', () => {
  /** Finito da poco: la conservazione dei dati non e' passata. */
  const IN_CONSERVAZIONE = {
    status: 'ENDED' as const,
    startsAt: giorniFa(2),
    endsAt: giorniFa(1),
    dataRetentionDays: 365,
  };

  it('la cancellazione conserva la prova, e la pulizia non la toglie', async () => {
    const evento = await creaEvento({ ...IN_CONSERVAZIONE, recordingUrl: VIDEO });
    const { emailHash } = await iscritta(evento.id);

    await chiediCancellazione(emailHash);
    await giroDiPulizia();

    const righe = await prove(evento.id);
    expect(righe).toHaveLength(5);
    expect(righe.every((r) => r.displayName === null && r.withdrawnAt !== null)).toBe(
      true
    );
  });

  it('vale per la registrazione temporanea e per la sola trascrizione', async () => {
    const temporanea = await creaEvento({
      ...IN_CONSERVAZIONE,
      tempRecordingUrl: VIDEO,
      tempRecordingStartedAt: new Date(),
    });
    const conTrascrizione = await creaEvento(IN_CONSERVAZIONE);
    await creaTrascrizione(conTrascrizione.id);
    const uno = await iscritta(temporanea.id);
    const due = await iscritta(conTrascrizione.id);

    await chiediCancellazione(uno.emailHash);
    await chiediCancellazione(due.emailHash);
    await giroDiPulizia();

    expect(await prove(temporanea.id)).toHaveLength(5);
    expect(
      (await prove(conTrascrizione.id)).every((r) => r.kind === 'transcription')
    ).toBe(true);
    expect(await prove(conTrascrizione.id)).toHaveLength(2);
  });

  it('la cancellazione dallo staff conserva la prova', async () => {
    const evento = await creaEvento({ ...IN_CONSERVAZIONE, recordingUrl: VIDEO });
    const { reg } = await iscritta(evento.id);
    await entraCome('ADMIN');

    const res = await cancellaIscrizione(
      richiesta(
        `/api/admin/events/${evento.id}/registrations/${reg.id}`,
        'DELETE'
      ) as NextRequest,
      contesto({ id: evento.id, regId: reg.id })
    );

    expect(res.status).toBe(200);
    expect(await prove(evento.id)).toHaveLength(5);
  });

  it('senza video e senza trascrizione non resta niente', async () => {
    const evento = await creaEvento(IN_CONSERVAZIONE);
    const { emailHash } = await iscritta(evento.id);
    await chiediCancellazione(emailHash);
    expect(await prove(evento.id)).toHaveLength(0);
  });

  it('alla fine della conservazione dei dati la prova resta, senza nome, con il video', async () => {
    const evento = await creaEvento({ ...IN_CONSERVAZIONE, recordingUrl: VIDEO });
    const { emailHash } = await iscritta(evento.id);
    await chiediCancellazione(emailHash);
    await prisma.event.update({
      where: { id: evento.id },
      data: { endsAt: giorniFa(61), startsAt: giorniFa(62), dataRetentionDays: 30 },
    });

    await giroDiPulizia();

    const righe = await prove(evento.id);
    expect(righe).toHaveLength(5);
    expect(righe.every((r) => r.displayName === null && r.withdrawnAt !== null)).toBe(
      true
    );
  });
});

describe('prove non piu’ coperte su un evento ancora in conservazione', () => {
  const LUNGA = {
    ...PUBBLICATO,
    startsAt: giorniFa(6),
    endsAt: giorniFa(5),
    dataRetentionDays: 365,
  };

  it('il video tolto: se ne vanno al giro dopo, con una riga nel registro', async () => {
    const evento = await creaEvento(LUNGA);
    const { emailHash } = await iscritta(evento.id);
    await chiediCancellazione(emailHash);
    expect(await prove(evento.id)).toHaveLength(5);

    await prisma.event.update({
      where: { id: evento.id },
      data: { recordingUrl: null, recordingPublished: false, recordingPublishedAt: null },
    });
    const conti = await giroDiPulizia();

    expect(await prove(evento.id)).toHaveLength(0);
    expect(conti.retainedConsentProofsDeleted).toBe(5);
    const [riga] = await prisma.gdprAuditLog.findMany({
      where: {
        eventId: evento.id,
        action: 'DATA_DELETED',
        details: { contains: 'retainedConsentProofs' },
      },
    });
    expect(riga?.recordCount).toBe(5);
  });

  it('una registrazione rimasta dopo aver tolto il video non le tiene', async () => {
    const evento = await creaEvento(LUNGA);
    await creaRegistrazione(evento.id);
    const { emailHash } = await iscritta(evento.id);
    await chiediCancellazione(emailHash);

    await prisma.event.update({
      where: { id: evento.id },
      data: { recordingUrl: null, recordingPublished: false, recordingPublishedAt: null },
    });
    await giroDiPulizia();

    expect(await prove(evento.id)).toHaveLength(0);
  });

  it('tolto il video resta la trascrizione: resta solo la sua prova', async () => {
    const evento = await creaEvento(LUNGA);
    await creaTrascrizione(evento.id);
    const { emailHash } = await iscritta(evento.id);
    await chiediCancellazione(emailHash);

    await prisma.event.update({
      where: { id: evento.id },
      data: { recordingUrl: null, recordingPublished: false, recordingPublishedAt: null },
    });
    await giroDiPulizia();

    const righe = await prove(evento.id);
    expect(righe).toHaveLength(2);
    expect(righe.every((r) => r.kind === 'transcription')).toBe(true);
  });

  it('con il video al suo posto il giro non cambia niente e non scrive nel registro', async () => {
    const evento = await creaEvento(LUNGA);
    const { emailHash } = await iscritta(evento.id);
    await chiediCancellazione(emailHash);
    const righe = await prisma.gdprAuditLog.count();

    expect((await giroDiPulizia()).retainedConsentProofsDeleted).toBe(0);

    expect(await prove(evento.id)).toHaveLength(5);
    expect(await prisma.gdprAuditLog.count()).toBe(righe);
  });
});

describe('un evento con piu’ sessioni registrate', () => {
  const PRIMO = 'https://storage.example.com/recordings/prima-sessione.mp4';
  const SECONDO = 'https://storage.example.com/recordings/seconda-sessione.mp4';
  const IN_CONSERVAZIONE = {
    status: 'ENDED' as const,
    startsAt: giorniFa(6),
    endsAt: giorniFa(5),
    dataRetentionDays: 365,
    recordingUrl: SECONDO,
  };

  /** Come dopo due webhook: l'evento indica l'ultimo file. */
  async function dueSessioni(campi: Parameters<typeof creaEvento>[0] = {}) {
    const evento = await creaEvento({ ...IN_CONSERVAZIONE, ...campi });
    const prima = await creaSessione(evento.id, {
      recordingUrl: PRIMO,
      recordingFilename: 'recordings/prima-sessione.mp4',
      recordingFileSize: 10n,
      recordingDuration: 60,
    });
    const seconda = await creaSessione(evento.id, {
      recordingUrl: SECONDO,
      recordingFilename: 'recordings/seconda-sessione.mp4',
      recordingFileSize: 20n,
      recordingDuration: 120,
    });
    return { evento, prima, seconda };
  }
  const cancellaSessione = async (
    evento: { id: string; moderatorToken: string },
    sessione: { id: string }
  ) => {
    const res = await togliSessione(
      richiesta(
        `/api/events/${evento.id}/sessions/${sessione.id}`,
        'DELETE',
        undefined,
        evento.moderatorToken
      ) as unknown as NextRequest,
      contesto({ param: evento.id, id: sessione.id })
    );
    expect(res.status).toBe(200);
  };
  const cancellaVideo = async (evento: { id: string; moderatorToken: string }) => {
    const res = await togliVideo(
      richiesta(
        `/api/events/${evento.id}/recording`,
        'DELETE',
        undefined,
        evento.moderatorToken
      ) as unknown as NextRequest,
      contesto({ param: evento.id })
    );
    expect(res.status).toBe(200);
  };

  it('tolta l’ultima sessione, il file dell’altra tiene le prove', async () => {
    const { evento, prima, seconda } = await dueSessioni();
    const { emailHash } = await iscritta(evento.id);
    await chiediCancellazione(emailHash);
    expect(await prove(evento.id)).toHaveLength(5);

    await cancellaSessione(evento, seconda);
    await giroDiPulizia();

    const dopo = await prisma.event.findUniqueOrThrow({ where: { id: evento.id } });
    expect(dopo.recordingUrl).toBeNull();
    expect(await prove(evento.id)).toHaveLength(5);

    await cancellaSessione(evento, prima);
    await giroDiPulizia();
    expect(await prove(evento.id)).toHaveLength(0);
  });

  it('una cancellazione dopo aver tolto l’ultima sessione conserva la prova', async () => {
    const { evento, seconda } = await dueSessioni();
    const { emailHash } = await iscritta(evento.id);
    await cancellaSessione(evento, seconda);

    await chiediCancellazione(emailHash);

    expect(await prove(evento.id)).toHaveLength(5);
  });

  it('togliere il video dell’evento toglie il file dalla sua sessione, non dall’altra', async () => {
    const { evento, prima, seconda } = await dueSessioni();
    const { emailHash } = await iscritta(evento.id);
    await chiediCancellazione(emailHash);

    await cancellaVideo(evento);
    await giroDiPulizia();

    expect(
      await prisma.callSession.findUniqueOrThrow({ where: { id: seconda.id } })
    ).toMatchObject({
      recordingUrl: null,
      recordingFilename: null,
      recordingFileSize: null,
      recordingDuration: null,
    });
    expect(
      await prisma.callSession.findUniqueOrThrow({ where: { id: prima.id } })
    ).toMatchObject({
      recordingUrl: PRIMO,
      recordingFilename: 'recordings/prima-sessione.mp4',
    });
    expect(await prove(evento.id)).toHaveLength(5);
  });

  it('con una sola sessione, togliere il video porta via le prove al giro dopo', async () => {
    const evento = await creaEvento(IN_CONSERVAZIONE);
    await creaSessione(evento.id, { recordingUrl: SECONDO });
    const { emailHash } = await iscritta(evento.id);
    await chiediCancellazione(emailHash);

    await cancellaVideo(evento);
    await giroDiPulizia();

    expect(await prove(evento.id)).toHaveLength(0);
  });

  it('due sessioni sullo stesso file: tolta una, l’altra non lo offre piu’', async () => {
    const evento = await creaEvento(IN_CONSERVAZIONE);
    const prima = await creaSessione(evento.id, { recordingUrl: SECONDO });
    const doppia = await creaSessione(evento.id, { recordingUrl: SECONDO });
    const { emailHash } = await iscritta(evento.id);
    await chiediCancellazione(emailHash);

    await cancellaSessione(evento, doppia);
    await giroDiPulizia();

    const rimasta = await prisma.callSession.findUniqueOrThrow({
      where: { id: prima.id },
    });
    expect(rimasta.recordingUrl).toBeNull();
    expect(await prove(evento.id)).toHaveLength(0);
  });

  it('togliere il video dalla modifica dell’evento lo toglie anche dalla sessione', async () => {
    const { evento, seconda } = await dueSessioni();

    const res = await aggiornaEvento(
      richiesta(
        `/api/events/${evento.id}`,
        'PUT',
        { recordingUrl: null },
        evento.moderatorToken
      ) as unknown as NextRequest,
      contesto({ param: evento.id })
    );

    expect(res.status).toBe(200);
    const sessione = await prisma.callSession.findUniqueOrThrow({
      where: { id: seconda.id },
    });
    expect(sessione.recordingUrl).toBeNull();
  });

  it('togliere il video dalla pubblicazione lo toglie anche dalla sessione', async () => {
    const { evento, prima, seconda } = await dueSessioni();
    await entraCome('ADMIN');
    await organizza(evento.id);

    const res = await aggiornaPubblicazione(
      richiesta(`/api/admin/publications/${evento.id}`, 'PATCH', {
        recordingUrl: null,
      }) as unknown as NextRequest,
      contesto({ id: evento.id })
    );

    expect(res.status).toBe(200);
    const [sessione, altra] = await Promise.all([
      prisma.callSession.findUniqueOrThrow({ where: { id: seconda.id } }),
      prisma.callSession.findUniqueOrThrow({ where: { id: prima.id } }),
    ]);
    expect(sessione.recordingUrl).toBeNull();
    expect(altra.recordingUrl).toBe(PRIMO);
  });

  it('caricare un altro file non toglie quello della sessione', async () => {
    const { evento, seconda } = await dueSessioni();
    await entraCome('ADMIN');
    await organizza(evento.id);

    const res = await aggiornaPubblicazione(
      richiesta(`/api/admin/publications/${evento.id}`, 'PATCH', {
        recordingUrl: VIDEO,
      }) as unknown as NextRequest,
      contesto({ id: evento.id })
    );

    expect(res.status).toBe(200);
    const sessione = await prisma.callSession.findUniqueOrThrow({
      where: { id: seconda.id },
    });
    expect(sessione.recordingUrl).toBe(SECONDO);
  });

  it('la registrazione scaduta toglie i file di tutte le sessioni, e con loro le prove', async () => {
    const { evento, prima, seconda } = await dueSessioni({
      recordingPublished: true,
      recordingPublishedAt: giorniFa(5),
      recordingDeleteAfterDays: 1,
    });
    const { emailHash } = await iscritta(evento.id);
    await chiediCancellazione(emailHash);
    expect(await prove(evento.id)).toHaveLength(5);

    await giroDiPulizia();

    const sessioni = await prisma.callSession.findMany({
      where: { id: { in: [prima.id, seconda.id] } },
      select: { recordingUrl: true, recordingFilename: true },
    });
    expect(sessioni).toEqual([
      { recordingUrl: null, recordingFilename: null },
      { recordingUrl: null, recordingFilename: null },
    ]);
    // Nello stesso giro: niente piu' video, niente piu' prove.
    expect(await prove(evento.id)).toHaveLength(0);
  });
});

describe('tracce per persona senza un video', () => {
  const IN_CONSERVAZIONE = {
    status: 'ENDED' as const,
    startsAt: giorniFa(6),
    endsAt: giorniFa(5),
    dataRetentionDays: 365,
  };

  /** Il segnaposto di una registrazione solo a tracce, senza webhook del video. */
  async function soloTracce(eventId: string, audioPurgedAt: Date | null) {
    const sessione = await creaSessione(eventId);
    const registrazione = await prisma.recording.create({
      data: {
        callSessionId: sessione.id,
        eventId,
        blobKey: `${MULTITRACK_PREFIX}${randomUUID()}/`,
        mediaStartedAt: giorniFa(5),
      },
    });
    await prisma.recordingTrack.create({
      data: {
        recordingId: registrazione.id,
        participantId: 'posto-1',
        blobKey: `${registrazione.blobKey}posto-1-0.ogg`,
        audioPurgedAt,
      },
    });
    return registrazione;
  }

  it('finche’ le tracce ci sono, la cancellazione conserva anche la prova della registrazione', async () => {
    const evento = await creaEvento(IN_CONSERVAZIONE);
    await soloTracce(evento.id, null);
    const { emailHash } = await iscritta(evento.id);

    await chiediCancellazione(emailHash);
    await giroDiPulizia();

    expect(new Set((await prove(evento.id)).map((p) => p.kind))).toEqual(
      new Set(['recording', 'transcription'])
    );
  });

  it('audio cancellato e trascrizione rimasta: resta solo la prova della trascrizione', async () => {
    const evento = await creaEvento(IN_CONSERVAZIONE);
    await soloTracce(evento.id, giorniFa(1));
    await creaTrascrizione(evento.id);
    const { emailHash } = await iscritta(evento.id);

    await chiediCancellazione(emailHash);

    const righe = await prove(evento.id);
    expect(righe).toHaveLength(2);
    expect(righe.every((r) => r.kind === 'transcription')).toBe(true);
  });

  it('l’audio cancellato dopo la cancellazione toglie la prova della registrazione al giro dopo', async () => {
    const evento = await creaEvento(IN_CONSERVAZIONE);
    const registrazione = await soloTracce(evento.id, null);
    await creaTrascrizione(evento.id);
    const { emailHash } = await iscritta(evento.id);
    await chiediCancellazione(emailHash);
    expect((await prove(evento.id)).some((p) => p.kind === 'recording')).toBe(true);

    await prisma.recordingTrack.updateMany({
      where: { recordingId: registrazione.id },
      data: { audioPurgedAt: new Date() },
    });
    await giroDiPulizia();

    const righe = await prove(evento.id);
    expect(righe).toHaveLength(2);
    expect(righe.every((r) => r.kind === 'transcription')).toBe(true);
  });
});

describe('pulizia e cancellazione insieme', () => {
  it('una cancellazione che arriva durante la pulizia non lascia una prova con il nome', async () => {
    const evento = await creaEvento(PUBBLICATO);
    const { emailHash } = await iscritta(evento.id);

    await Promise.all([giroDiPulizia(), chiediCancellazione(emailHash)]);

    const righe = await prove(evento.id);
    expect(righe.length).toBeGreaterThan(0);
    expect(righe.every((r) => r.displayName === null && r.nameRemovedAt !== null)).toBe(
      true
    );
    // Una riga per consenso, non una per ciascuna delle due transazioni.
    expect(righe).toHaveLength(5);
  });

  it('pulizia e cancellazione di molti iscritti insieme non si bloccano a vicenda', async () => {
    const evento = await creaEvento(PUBBLICATO);
    const persone: string[] = [];
    for (let i = 0; i < 12; i += 1) persone.push((await iscritta(evento.id)).emailHash);

    await Promise.all([giroDiPulizia(), ...persone.map(chiediCancellazione)]);

    const righe = await prove(evento.id);
    expect(righe).toHaveLength(5 * persone.length);
    expect(righe.every((r) => r.displayName === null)).toBe(true);
    expect(await prisma.chatMessage.count()).toBe(0);
  });

  it('la cancellazione dello staff che arriva a pulizia finita toglie il nome', async () => {
    const evento = await creaEvento(PUBBLICATO);
    const { reg } = await iscritta(evento.id);
    const altra = await iscritta(evento.id, 'Luca Verdi');
    await entraCome('ADMIN');
    // La rotta ha gia' letto l'iscrizione quando la pulizia si chiude.
    const letta = prisma.registration.findUnique.bind(prisma.registration);
    const lettura = vi.spyOn(prisma.registration, 'findUnique').mockImplementationOnce(((
      argomenti: Parameters<typeof letta>[0]
    ) =>
      letta(argomenti).then(async (riga) => {
        await giroDiPulizia();
        return riga;
      })) as unknown as typeof prisma.registration.findUnique);

    const res = await cancellaIscrizione(
      richiesta(
        `/api/admin/events/${evento.id}/registrations/${reg.id}`,
        'DELETE'
      ) as NextRequest,
      contesto({ id: evento.id, regId: reg.id })
    );
    lettura.mockRestore();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ registrations: 0, consentProofsKept: 5 });
    const sue = await prisma.retainedConsentProof.findMany({
      where: { emailHash: { not: altra.emailHash } },
    });
    expect(sue).toHaveLength(5);
    expect(sue.every((r) => r.displayName === null && r.nameRemovedAt !== null)).toBe(
      true
    );
    expect(sue.every((r) => r.withdrawnAt !== null)).toBe(true);
    // L'altra persona dello stesso evento non cambia.
    const altrui = await prisma.retainedConsentProof.findMany({
      where: { emailHash: altra.emailHash },
    });
    expect(altrui.every((r) => tryDecryptPII(r.displayName!) === 'Luca Verdi')).toBe(
      true
    );
    expect(altrui.every((r) => r.nameRemovedAt === null)).toBe(true);
  });

  it('la cancellazione dello staff non tocca le prove della stessa persona su altri eventi', async () => {
    const evento = await creaEvento(PUBBLICATO);
    const altroEvento = await creaEvento(PUBBLICATO);
    const indirizzo = `${randomUUID()}@example.org`;
    const { reg } = await iscritta(evento.id, 'Anna Bianchi', indirizzo);
    await iscritta(altroEvento.id, 'Anna Bianchi', indirizzo);
    await giroDiPulizia();

    await eraseRegistrations([{ id: reg.id, eventId: evento.id }], 'prova');

    const qui = await prove(evento.id);
    const li = await prove(altroEvento.id);
    expect(qui.length).toBeGreaterThan(0);
    expect(qui.every((r) => r.displayName === null)).toBe(true);
    expect(li.length).toBeGreaterThan(0);
    expect(li.every((r) => r.displayName !== null && r.nameRemovedAt === null)).toBe(
      true
    );
  });
});

describe('pulizia e ritiro insieme', () => {
  it('il ritiro che ha letto l’iscrizione e arriva dopo la pulizia vale sulla prova', async () => {
    const evento = await creaEvento(PUBBLICATO);
    const { reg, emailHash } = await iscritta(evento.id);
    const altra = await iscritta(evento.id, 'Luca Verdi');
    const { consentsToken } = await chiediDati(emailHash);

    // Il blocco tiene ferma la pulizia e poi il ritiro: la pulizia si mette in
    // fila per prima, quindi cancella tutto mentre il ritiro aspetta.
    let sblocca: () => void = () => undefined;
    const via = new Promise<void>((risolvi) => {
      sblocca = risolvi;
    });
    const { bloccato, finito } = tieniIlBlocco(evento.id, via);
    await bloccato;
    const giro = giroDiPulizia();
    await inFila(1);
    const risposta = ritira(
      daIp('/api/gdpr/consents', 'POST', {
        token: consentsToken,
        registrationId: reg.id,
        consent: 'recording',
      }),
      contesto({})
    );
    await inFila(2);
    sblocca();
    await Promise.all([finito, giro]);

    expect((await risposta).status).toBe(200);
    expect(await prisma.registration.count({ where: { eventId: evento.id } })).toBe(0);
    const sue = await prisma.retainedConsentProof.findMany({ where: { emailHash } });
    expect(sue).toHaveLength(5);
    // Il periodo gia' ritirato conserva la sua ora; gli altri sono ritirati ora.
    expect(sue.every((r) => r.withdrawnAt !== null)).toBe(true);
    const altrui = await prisma.retainedConsentProof.findMany({
      where: { emailHash: altra.emailHash, source: 'registration' },
    });
    expect(altrui.every((r) => r.withdrawnAt === null)).toBe(true);
    const riga = await prisma.gdprAuditLog.findFirstOrThrow({
      where: { eventId: evento.id, action: 'CONSENT_WITHDRAWN' },
    });
    expect(JSON.parse(riga.details ?? '{}')).toMatchObject({
      source: 'self-service',
      recording: 2,
      transcription: 2,
    });
  });

  it('ritirare la sola trascrizione lascia valida la registrazione anche nella corsa', async () => {
    const evento = await creaEvento(PUBBLICATO);
    const { reg, emailHash } = await iscritta(evento.id);
    await prisma.recordingConsent.updateMany({
      where: { registrationId: reg.id },
      data: { earlierPeriods: [] },
    });
    const { consentsToken } = await chiediDati(emailHash);
    let sblocca: () => void = () => undefined;
    const via = new Promise<void>((risolvi) => {
      sblocca = risolvi;
    });
    const { bloccato, finito } = tieniIlBlocco(evento.id, via);
    await bloccato;
    const giro = giroDiPulizia();
    await inFila(1);
    const risposta = ritira(
      daIp('/api/gdpr/consents', 'POST', {
        token: consentsToken,
        registrationId: reg.id,
        consent: 'transcription',
      }),
      contesto({})
    );
    await inFila(2);
    sblocca();
    await Promise.all([finito, giro]);

    expect((await risposta).status).toBe(200);
    const sue = await prisma.retainedConsentProof.findMany({ where: { emailHash } });
    expect(
      sue.filter((r) => r.kind === 'transcription').every((r) => r.withdrawnAt)
    ).toBe(true);
    expect(sue.filter((r) => r.kind === 'recording').every((r) => !r.withdrawnAt)).toBe(
      true
    );
  });

  it('il ritiro aspetta il blocco oltre i 5 secondi predefiniti', async () => {
    const evento = await creaEvento(PUBBLICATO);
    const { reg, emailHash } = await iscritta(evento.id);
    const { consentsToken } = await chiediDati(emailHash);
    const attesa = new Promise((risolvi) => setTimeout(risolvi, 6_000));
    const { bloccato, finito } = tieniIlBlocco(evento.id, attesa);
    await bloccato;

    const res = await ritira(
      daIp('/api/gdpr/consents', 'POST', {
        token: consentsToken,
        registrationId: reg.id,
        consent: 'recording',
      }),
      contesto({})
    );
    await finito;

    expect(res.status).toBe(200);
    expect(
      (await prisma.registration.findUniqueOrThrow({ where: { id: reg.id } }))
        .consentRecordingWithdrawnAt
    ).not.toBeNull();
  }, 15_000);
});

describe('i propri dati', () => {
  it('chi ha solo prove le vede, le ritira, e la registrazione porta via la trascrizione', async () => {
    const evento = await creaEvento(PUBBLICATO);
    const { emailHash } = await iscritta(evento.id);
    await giroDiPulizia();

    const dati = await chiediDati(emailHash);
    expect(dati.data).toEqual([]);
    expect(dati.retainedConsentProofs).toHaveLength(5);
    expect(dati.retainedConsentProofs[0]).toMatchObject({
      name: 'Anna Bianchi',
      nameRemoved: false,
    });
    expect(dati.consentsToken).toBeTruthy();
    expect(
      await prisma.gdprAuditLog.count({
        where: { eventId: evento.id, action: 'DATA_EXPORTED' },
      })
    ).toBe(1);

    const prova = dati.retainedConsentProofs.find(
      (p) => p.kind === 'recording' && !p.withdrawnAt
    )!;
    const res = await ritira(
      daIp('/api/gdpr/consents', 'POST', {
        token: dati.consentsToken,
        proofId: prova.id,
        consent: 'recording',
      }),
      contesto({})
    );

    expect(res.status).toBe(200);
    const righe = await prove(evento.id);
    expect(righe).toHaveLength(5);
    expect(righe.every((r) => r.withdrawnAt !== null)).toBe(true);
    // Il nome resta: il ritiro non e' una cancellazione.
    expect(righe.every((r) => r.displayName !== null)).toBe(true);
    const [riga] = await prisma.gdprAuditLog.findMany({
      where: { eventId: evento.id, action: 'CONSENT_WITHDRAWN' },
    });
    expect(riga!.recordCount).toBeGreaterThan(0);
  });

  it('il ritiro della trascrizione lascia valida la registrazione', async () => {
    const evento = await creaEvento(PUBBLICATO);
    const { emailHash } = await iscritta(evento.id);
    await giroDiPulizia();
    const dati = await chiediDati(emailHash);
    const prova = dati.retainedConsentProofs.find((p) => p.kind === 'transcription')!;

    await ritira(
      daIp('/api/gdpr/consents', 'POST', {
        token: dati.consentsToken,
        proofId: prova.id,
        consent: 'transcription',
      }),
      contesto({})
    );

    const righe = await prove(evento.id);
    expect(
      righe.filter((r) => r.kind === 'transcription').every((r) => r.withdrawnAt)
    ).toBe(true);
    expect(righe.some((r) => r.kind === 'recording' && !r.withdrawnAt)).toBe(true);
  });

  it('la prova di un altro indirizzo risponde 404 e resta com’e’', async () => {
    const evento = await creaEvento(PUBBLICATO);
    await iscritta(evento.id);
    const altra = await iscritta(evento.id, 'Luca Verdi');
    await giroDiPulizia();
    const dati = await prisma.retainedConsentProof.findFirstOrThrow({
      where: { emailHash: { not: altra.emailHash }, kind: 'recording' },
    });

    const res = await ritira(
      daIp('/api/gdpr/consents', 'POST', {
        token: issueGdprToken('consents', altra.emailHash),
        proofId: dati.id,
        consent: 'recording',
      }),
      contesto({})
    );

    expect(res.status).toBe(404);
    expect(
      (await prisma.retainedConsentProof.findUniqueOrThrow({ where: { id: dati.id } }))
        .withdrawnAt
    ).toBeNull();
  });

  it('dopo la cancellazione le prove restano leggibili, senza nome', async () => {
    const evento = await creaEvento(PUBBLICATO);
    const { emailHash } = await iscritta(evento.id);
    await giroDiPulizia();
    await chiediCancellazione(emailHash);

    const dati = await chiediDati(emailHash);

    expect(dati.retainedConsentProofs).toHaveLength(5);
    expect(
      dati.retainedConsentProofs.every(
        (p) => p.name === null && p.nameRemoved && p.withdrawnAt
      )
    ).toBe(true);
  });

  it('chi e’ solo in rubrica vede la voce; il pannello conta le prove conservate', async () => {
    const indirizzo = `${randomUUID()}@example.org`;
    const emailHash = hashEmail(indirizzo);
    await prisma.person.create({
      data: {
        emailHash,
        email: encryptPII(indirizzo),
        displayName: encryptPII('Anna Bianchi'),
        optedInToAddressBook: true,
        optedInAt: giorniFa(10),
      },
    });
    const dati = await chiediDati(emailHash);
    expect(dati.data).toEqual([]);
    expect(dati.addressBook).toMatchObject({ email: indirizzo, optedIn: true });
    expect(dati.addressBook?.optOutToken).toBeTruthy();
    expect(dati.consentsToken).toBeUndefined();

    const evento = await creaEvento(PUBBLICATO);
    await iscritta(evento.id);
    await giroDiPulizia();
    await entraCome('ADMIN');
    const res = await consensiAdmin(
      richiesta(`/api/admin/events/${evento.id}/consents`) as NextRequest,
      contesto({ id: evento.id })
    );
    expect(await res.json()).toMatchObject({
      total: 5,
      retained: 5,
      // Una persona sola, nonostante le righe.
      summary: {
        recording: { given: 1, withdrawn: 0 },
        transcription: { given: 1, withdrawn: 0 },
      },
    });
  });

  describe('sostituzione, poi ritiro', () => {
    const riepilogo = async (eventId: string) => {
      await entraCome('ADMIN');
      const res = await consensiAdmin(
        richiesta(`/api/admin/events/${eventId}/consents`) as NextRequest,
        contesto({ id: eventId })
      );
      return (await res.json()) as {
        total: number;
        summary: { recording: { given: number; withdrawn: number } };
      };
    };
    const csv = async (eventId: string) => {
      await entraCome('ADMIN');
      const res = await consensiAdmin(
        richiesta(
          `/api/admin/events/${eventId}/consents?format=csv&locale=it`
        ) as NextRequest,
        contesto({ id: eventId })
      );
      return (await res.text()).trim().split('\n');
    };
    const ritiraDallaPagina = async (registrationId: string, emailHash: string) => {
      const dati = await chiediDati(emailHash);
      const res = await ritira(
        daIp('/api/gdpr/consents', 'POST', {
          token: dati.consentsToken,
          registrationId,
          consent: 'recording',
        }),
        contesto({})
      );
      expect(res.status).toBe(200);
    };

    it('la persona ha ritirato, prima e dopo la pulizia, e il CSV non confonde i periodi', async () => {
      const evento = await creaEvento(PUBBLICATO);
      const { reg, emailHash } = await iscritta(evento.id);
      await sostituisciConsenso(reg.id);
      await ritiraDallaPagina(reg.id, emailHash);

      expect((await riepilogo(evento.id)).summary.recording).toEqual({
        given: 0,
        withdrawn: 1,
      });
      const prima = await csv(evento.id);
      const sostituite = prima.filter((r) => r.includes('Da un consenso successivo'));
      expect(sostituite).toHaveLength(1);
      expect(sostituite[0]).toContain(';;1;Riservata;');

      await giroDiPulizia();

      expect(await prisma.recordingConsent.count()).toBe(0);
      expect((await riepilogo(evento.id)).summary.recording).toEqual({
        given: 0,
        withdrawn: 1,
      });
      const dopo = await csv(evento.id);
      expect(dopo.filter((r) => r.includes('Da un consenso successivo'))).toEqual(
        sostituite
      );
    });

    it('senza ritiro il consenso vale una volta, anche dopo la pulizia', async () => {
      const evento = await creaEvento(PUBBLICATO);
      const { reg, emailHash } = await iscritta(evento.id);
      await sostituisciConsenso(reg.id);

      expect((await riepilogo(evento.id)).summary.recording).toEqual({
        given: 1,
        withdrawn: 0,
      });
      await giroDiPulizia();
      expect((await riepilogo(evento.id)).summary.recording).toEqual({
        given: 1,
        withdrawn: 0,
      });

      // Il periodo sostituito non e' il consenso da ritirare.
      const dati = await chiediDati(emailHash);
      const sostituite = dati.retainedConsentProofs.filter((p) => p.superseded);
      expect(sostituite).toHaveLength(1);
      expect(sostituite[0]!.withdrawnAt).toBeNull();
    });

    it('il ritiro di una prova conservata non lo fa passare per ritirato', async () => {
      const evento = await creaEvento(PUBBLICATO);
      const { reg, emailHash } = await iscritta(evento.id);
      await sostituisciConsenso(reg.id);
      await giroDiPulizia();
      const dati = await chiediDati(emailHash);
      const attuale = dati.retainedConsentProofs.find(
        (p) => p.kind === 'recording' && !p.withdrawnAt && !p.superseded
      )!;

      const res = await ritira(
        daIp('/api/gdpr/consents', 'POST', {
          token: dati.consentsToken,
          proofId: attuale.id,
          consent: 'recording',
        }),
        contesto({})
      );

      expect(res.status).toBe(200);
      expect((await riepilogo(evento.id)).summary.recording).toEqual({
        given: 0,
        withdrawn: 1,
      });
      expect(
        (await csv(evento.id)).filter((r) => r.includes('Da un consenso successivo'))
      ).toHaveLength(1);
    });

    it('la cancellazione chiesta dalla persona lascia riconoscibile il periodo sostituito', async () => {
      const evento = await creaEvento(PUBBLICATO);
      const { reg, emailHash } = await iscritta(evento.id);
      await sostituisciConsenso(reg.id);

      await chiediCancellazione(emailHash);

      expect((await riepilogo(evento.id)).summary.recording).toEqual({
        given: 0,
        withdrawn: 1,
      });
      expect(
        (await csv(evento.id)).filter((r) => r.includes('Da un consenso successivo'))
      ).toHaveLength(1);
    });
  });

  it('il CSV dice il nome tolto per quello che e’', async () => {
    const evento = await creaEvento(PUBBLICATO);
    const { emailHash } = await iscritta(evento.id);
    await giroDiPulizia();
    await chiediCancellazione(emailHash);
    await entraCome('ADMIN');

    const res = await consensiAdmin(
      richiesta(
        `/api/admin/events/${evento.id}/consents?format=csv&locale=it`
      ) as NextRequest,
      contesto({ id: evento.id })
    );

    const testo = await res.text();
    expect(testo).toContain('(nome rimosso su richiesta)');
    expect(testo).not.toContain('Anna Bianchi');
  });
});
