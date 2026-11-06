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
  deleteRecordingBlob: vi.fn(async () => true),
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
import { GET as pulizia } from '@/app/api/cron/cleanup/route';
import { POST as ritira } from '@/app/api/gdpr/consents/route';
import { POST as cancella } from '@/app/api/gdpr/erasure/route';
import { GET as esporta } from '@/app/api/gdpr/export/route';
import { encryptPII, hashEmail, tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { eraseRegistrations } from '@/lib/gdpr/erase-registrations';
import { issueGdprToken } from '@/lib/gdpr/request-token';

import {
  creaEvento,
  creaLavoro,
  creaRegistrazione,
  entraCome,
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

  it('niente di pubblicato: nessuna prova resta', async () => {
    const evento = await creaEvento(CONCLUSO);
    await iscritta(evento.id);
    await giroDiPulizia();
    expect(await prisma.registration.count()).toBe(0);
    expect(await prisma.retainedConsentProof.count()).toBe(0);
  });

  it('un file non pubblicato non tiene le prove', async () => {
    const evento = await creaEvento({ ...CONCLUSO, recordingUrl: VIDEO });
    await iscritta(evento.id);
    await giroDiPulizia();
    expect(await prisma.retainedConsentProof.count()).toBe(0);
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
