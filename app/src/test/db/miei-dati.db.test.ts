// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * La pagina dei propri dati sul database vero: un consenso dato di nuovo dopo un
 * ritiro, con la stessa prova di quello dato in sala, e solo finche' l'evento lo
 * chiede; la correzione di nome ed ente e la cancellazione di una sola
 * iscrizione, confermate con il codice mandato all'indirizzo.
 */
import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as chiediToken } from '@/app/api/events/[param]/jitsi/token/route';
import { POST as consensi } from '@/app/api/gdpr/consents/route';
import { POST as annulla } from '@/app/api/gdpr/registrations/cancel/route';
import { POST as correggi } from '@/app/api/gdpr/registrations/edit/route';
import { decryptPII, encryptPII, hashEmail, tryDecryptPII } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { eventAccessCookieName, signEventAccess } from '@/lib/event-session';
import { leggiRigheProve, postoDaIMieiDati } from '@/lib/gdpr/consent-proofs';
import { issueGdprToken } from '@/lib/gdpr/request-token';
import { ritiraComunicazioni, ritiraConsensi } from '@/lib/live/consent-withdrawal';
import { registrazioneDellIscrizione } from '@/lib/live/consents-in-force';

import { biscotti } from './biscotti';
import { creaEvento, richiesta, svuotaDatabase } from './fixtures';

// Fuori da Next `getTranslations` lancia: l'email del codice usa i testi veri.
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const messaggi = (await import('@/i18n/messages/it.json')).default;
  return {
    getTranslations: async ({ namespace }: { namespace: string }) =>
      createTranslator({
        locale: 'it',
        messages: messaggi,
        namespace: namespace as never,
      }),
  };
});

const CON_TRACCE = {
  recordingEnabled: true,
  participantsCanUnmute: true,
  multitrackRecordingEnabled: true,
} satisfies Partial<Prisma.EventUncheckedCreateInput>;

beforeEach(async () => {
  await svuotaDatabase();
  vi.stubEnv('RECORDING_VOICE_EXCLUSION', 'true');
});
afterEach(() => vi.unstubAllEnvs());

async function iscritto(
  eventId: string,
  campi: Partial<Prisma.RegistrationUncheckedCreateInput> = {}
) {
  const email = `${randomUUID()}@example.org`;
  const emailHash = hashEmail(email);
  const iscrizione = await prisma.registration.create({
    data: {
      eventId,
      displayName: encryptPII('Persona Iscritta'),
      email: encryptPII(email),
      emailHash,
      consentGiven: true,
      consentTimestamp: new Date(),
      accessToken: randomUUID(),
      ...campi,
    },
  });
  return { iscrizione, emailHash, token: issueGdprToken('consents', emailHash) };
}

let ip = 0;
async function dai(
  token: string,
  registrationId: string,
  corpo: Record<string, unknown>
) {
  ip += 1;
  const r = richiesta('/api/gdpr/consents', 'POST', {
    token,
    registrationId,
    give: true,
    locale: 'it',
    ...corpo,
  });
  r.headers.set('x-forwarded-for', `10.9.${Math.floor(ip / 250)}.${ip % 250}`);
  return consensi(r as never, { params: Promise.resolve({}) });
}

const righeRegistro = (eventId: string, action: string) =>
  prisma.gdprAuditLog.findMany({
    where: { eventId, action },
    orderBy: { createdAt: 'asc' },
  });

describe('un consenso dato di nuovo da «I miei dati»', () => {
  it('la registrazione torna valida con la prova di sala, e il periodo di prima resta', async () => {
    const evento = await creaEvento(CON_TRACCE);
    const { iscrizione, token } = await iscritto(evento.id, {
      consentRecording: true,
      consentMultitrack: true,
      consentMultitrackVersion: 2,
    });
    await prisma.recordingConsent.create({
      data: {
        eventId: evento.id,
        jitsiUserId: `reg-${iscrizione.id}-abcd1234`,
        displayName: encryptPII('Nome in sala'),
        registrationId: iscrizione.id,
        consentedAt: new Date(Date.now() - 600_000),
      },
    });
    await ritiraConsensi(evento.id, [], { registrazione: true }, new Date(), {
      iscrizioni: [iscrizione.id],
      origine: 'self-service',
    });
    const prima = await prisma.registration.findUniqueOrThrow({
      where: { id: iscrizione.id },
    });
    expect(await registrazioneDellIscrizione(evento, prima, null)).toBe(false);

    const res = await dai(token, iscrizione.id, {
      consent: 'recording',
      recordingDestination: null,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ given: 'recording' });

    const prova = await prisma.recordingConsent.findFirstOrThrow({
      where: { registrationId: iscrizione.id },
    });
    expect(prova.withdrawnAt).toBeNull();
    expect(prova.locale).toBe('it');
    expect(prova.earlierPeriods).toEqual([
      expect.objectContaining({ withdrawnAt: expect.any(String) }),
    ]);
    // Il prossimo ingresso lo trova: il token della sala legge la stessa regola.
    expect(await registrazioneDellIscrizione(evento, prima, null)).toBe(true);
    // La trascrizione ritirata con la registrazione resta ritirata.
    expect(
      await prisma.multitrackConsent.count({
        where: { registrationId: iscrizione.id, withdrawnAt: null },
      })
    ).toBe(0);

    const [riga] = await righeRegistro(evento.id, 'CONSENT_RECORDED');
    expect(JSON.parse(riga!.details!)).toMatchObject({
      source: 'self-service',
      kind: 'recording',
      givenAgain: true,
    });
    expect(riga!.details).not.toContain('Persona');

    // L'elenco delle prove dice da dove viene ogni periodo.
    const righe = await leggiRigheProve(prisma, evento.id, {
      registrationIds: [iscrizione.id],
    });
    expect(
      righe
        .filter((r) => r.kind === 'recording')
        .map((r) => [r.source, r.withdrawnAt === null])
    ).toEqual([
      ['registration', false],
      ['room', false],
      ['self-service', true],
    ]);

    // Un secondo clic non scrive niente.
    expect(
      (
        await dai(token, iscrizione.id, {
          consent: 'recording',
          recordingDestination: null,
        })
      ).status
    ).toBe(200);
    expect(await righeRegistro(evento.id, 'CONSENT_RECORDED')).toHaveLength(1);
  });

  it("senza prova di sala ne nasce una sul posto dell'iscrizione, non su un ingresso", async () => {
    const evento = await creaEvento(CON_TRACCE);
    const { iscrizione, token } = await iscritto(evento.id, {
      consentRecording: true,
      consentRecordingWithdrawnAt: new Date(),
    });
    expect(
      (
        await dai(token, iscrizione.id, {
          consent: 'recording',
          recordingDestination: null,
        })
      ).status
    ).toBe(200);
    const prova = await prisma.recordingConsent.findFirstOrThrow({
      where: { registrationId: iscrizione.id },
    });
    expect(prova.jitsiUserId).toBe(postoDaIMieiDati(iscrizione.id));
    expect(prova.displayName).toBe(iscrizione.displayName);
  });

  it('un periodo dato da qui resta di «I miei dati» anche quando lo sostituisce la sala', async () => {
    const evento = await creaEvento(CON_TRACCE);
    const { iscrizione, token } = await iscritto(evento.id, { consentRecording: false });
    await dai(token, iscrizione.id, { consent: 'recording', recordingDestination: null });
    await ritiraConsensi(evento.id, [], { registrazione: true }, new Date(), {
      iscrizioni: [iscrizione.id],
      origine: 'self-service',
    });
    // Di nuovo, ma dalla sala: il clic nella finestra dei consensi.
    biscotti.set(
      eventAccessCookieName(evento.id),
      await signEventAccess(evento.id, iscrizione.accessToken, 3600)
    );
    const ingresso = await chiediToken(
      richiesta(`/api/events/${evento.slug}/jitsi/token`, 'POST', {
        accessToken: iscrizione.accessToken,
        recordingConsent: true,
        recordingConsentDestination: null,
      }) as never,
      { params: Promise.resolve({ param: evento.slug }) }
    );
    expect(ingresso.status).toBe(200);
    const prova = await prisma.recordingConsent.findFirstOrThrow({
      where: { registrationId: iscrizione.id },
    });
    expect(prova.jitsiUserId).not.toBe(postoDaIMieiDati(iscrizione.id));
    expect(prova.earlierPeriods).toEqual([
      expect.objectContaining({
        source: 'self-service',
        withdrawnAt: expect.any(String),
      }),
    ]);
    const righe = await leggiRigheProve(prisma, evento.id, {
      registrationIds: [iscrizione.id],
    });
    expect(righe.map((r) => r.source)).toEqual(['self-service', 'room']);
  });

  it('vale per il testo letto: una destinazione cambiata a pagina aperta non vale', async () => {
    const evento = await creaEvento({ ...CON_TRACCE, recordingDestination: 'PUBLIC' });
    const { iscrizione, token } = await iscritto(evento.id, { consentRecording: false });
    const vecchio = await dai(token, iscrizione.id, {
      consent: 'recording',
      recordingDestination: 'REGISTRANTS',
    });
    expect(vecchio.status).toBe(409);
    expect((await vecchio.json()).code).toBe('CONSENT_TEXT_CHANGED');
    const giusto = await dai(token, iscrizione.id, {
      consent: 'recording',
      recordingDestination: 'PUBLIC',
    });
    expect(giusto.status).toBe(200);
    const prova = await prisma.recordingConsent.findFirstOrThrow({
      where: { registrationId: iscrizione.id },
    });
    expect(prova.destination).toBe('PUBLIC');
    expect(prova.textVersion).toBe(1);
  });

  it('un consenso che non copre piu’ il testo in vigore si da di nuovo, come chiede la sala', async () => {
    const evento = await creaEvento({ ...CON_TRACCE, recordingDestination: 'PUBLIC' });
    const { iscrizione, token } = await iscritto(evento.id, {
      consentRecording: true,
      consentRecordingDestination: 'REGISTRANTS',
      consentRecordingVersion: 1,
    });
    const prima = await prisma.registration.findUniqueOrThrow({
      where: { id: iscrizione.id },
    });
    expect(await registrazioneDellIscrizione(evento, prima, 'PUBLIC')).toBe(false);
    const res = await dai(token, iscrizione.id, {
      consent: 'recording',
      recordingDestination: 'PUBLIC',
    });
    expect(res.status).toBe(200);
    expect(await righeRegistro(evento.id, 'CONSENT_RECORDED')).toHaveLength(1);
    expect(await registrazioneDellIscrizione(evento, prima, 'PUBLIC')).toBe(true);
  });

  it("a evento concluso, o dove l'evento non lo chiede, non si da'", async () => {
    const concluso = await creaEvento({
      ...CON_TRACCE,
      status: 'ENDED',
      endsAt: new Date(Date.now() - 60_000),
    });
    const a = await iscritto(concluso.id, { consentRecording: false });
    const res = await dai(a.token, a.iscrizione.id, {
      consent: 'recording',
      recordingDestination: null,
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('CONSENT_NOT_OFFERED');

    const senzaRegistrazione = await creaEvento({ participantsCanUnmute: true });
    const b = await iscritto(senzaRegistrazione.id);
    expect(
      (
        await dai(b.token, b.iscrizione.id, {
          consent: 'transcription',
          transcriptionText: 'multitrackRetained',
        })
      ).status
    ).toBe(409);
    expect(await prisma.recordingConsent.count()).toBe(0);
    expect(await prisma.multitrackConsent.count()).toBe(0);
  });

  it('la trascrizione chiede prima la registrazione, poi una prova nuova accanto a quella ritirata', async () => {
    const evento = await creaEvento(CON_TRACCE);
    const { iscrizione, token } = await iscritto(evento.id, {
      consentRecording: true,
      consentMultitrack: true,
      consentMultitrackVersion: 2,
    });
    await ritiraConsensi(evento.id, [], { registrazione: true }, new Date(), {
      iscrizioni: [iscrizione.id],
      origine: 'self-service',
    });
    const senza = await dai(token, iscrizione.id, {
      consent: 'transcription',
      transcriptionText: 'multitrackRetained',
    });
    expect(senza.status).toBe(409);
    expect((await senza.json()).code).toBe('RECORDING_CONSENT_REQUIRED');

    await dai(token, iscrizione.id, { consent: 'recording', recordingDestination: null });
    // La casella letta conta anche per la trascrizione: qui le tracce restano con
    // i dati dell'evento (pipeline AI spenta), e il testo che lo dice e' un altro.
    const vecchio = await dai(token, iscrizione.id, {
      consent: 'transcription',
      transcriptionText: 'multitrack',
    });
    expect((await vecchio.json()).code).toBe('CONSENT_TEXT_CHANGED');
    expect(
      (
        await dai(token, iscrizione.id, {
          consent: 'transcription',
          transcriptionText: 'multitrackRetained',
        })
      ).status
    ).toBe(200);
    const prove = await prisma.multitrackConsent.findMany({
      where: { registrationId: iscrizione.id },
    });
    expect(prove).toHaveLength(1);
    expect(prove[0]).toMatchObject({ withdrawnAt: null, textVersion: 2 });
    expect(prove[0]!.jitsiUserId).toBe(postoDaIMieiDati(iscrizione.id));
    // Il ritiro dell'iscrizione resta: e' la storia del consenso.
    const dopo = await prisma.registration.findUniqueOrThrow({
      where: { id: iscrizione.id },
    });
    expect(dopo.consentMultitrackWithdrawnAt).not.toBeNull();
    const righe = await righeRegistro(evento.id, 'CONSENT_RECORDED');
    expect(righe.map((r) => JSON.parse(r.details!).kind)).toEqual([
      'recording',
      'transcription',
    ]);
  });

  it("le comunicazioni future riportano in rubrica con i dati dell'iscrizione", async () => {
    const evento = await creaEvento({
      status: 'ENDED',
      endsAt: new Date(Date.now() - 60_000),
    });
    const { iscrizione, emailHash, token } = await iscritto(evento.id, {
      consentFutureCommunications: true,
      organization: 'Ente di prova',
    });
    await ritiraComunicazioni(emailHash);
    // Le comunicazioni non riguardano l'evento: si ridanno anche a evento concluso.
    const res = await dai(token, iscrizione.id, { consent: 'futureCommunications' });
    expect(res.status).toBe(200);
    const voce = await prisma.person.findUniqueOrThrow({ where: { emailHash } });
    expect(voce).toMatchObject({
      optedInToAddressBook: true,
      optedOutAt: null,
      organization: 'Ente di prova',
    });
    expect(voce.email).not.toBeNull();
    const dopo = await prisma.registration.findUniqueOrThrow({
      where: { id: iscrizione.id },
    });
    expect(dopo).toMatchObject({ consentFutureCommunications: true, personId: voce.id });
    const [riga] = await righeRegistro(evento.id, 'CONSENT_RECORDED');
    expect(JSON.parse(riga!.details!)).toMatchObject({
      source: 'self-service',
      consentFutureCommunications: true,
      givenAgain: true,
    });
  });

  it('le comunicazioni mai ritirate, o dove la rubrica non si propone, non si danno da qui', async () => {
    const evento = await creaEvento({ offerAddressBook: false });
    const a = await iscritto(evento.id);
    expect(
      (await dai(a.token, a.iscrizione.id, { consent: 'futureCommunications' })).status
    ).toBe(409);
    await ritiraComunicazioni(a.emailHash);
    expect(
      (await dai(a.token, a.iscrizione.id, { consent: 'futureCommunications' })).status
    ).toBe(409);
    expect(await prisma.person.count()).toBe(0);
  });

  it("si tocca solo un'iscrizione dell'indirizzo del token", async () => {
    const evento = await creaEvento(CON_TRACCE);
    const a = await iscritto(evento.id, { consentRecording: false });
    const b = await iscritto(evento.id);
    const res = await dai(b.token, a.iscrizione.id, {
      consent: 'recording',
      recordingDestination: null,
    });
    expect(res.status).toBe(404);
    expect(await prisma.recordingConsent.count()).toBe(0);
  });
});

/** Il codice dell'ultima email accodata: la persona lo legge nella sua casella. */
async function codiceArrivato(): Promise<{ codice: string; destinatario: string }> {
  const riga = await prisma.emailOutbox.findFirstOrThrow({
    orderBy: { createdAt: 'desc' },
  });
  const testo = decryptPII(riga.text!);
  const codice = /\b(\d{6})\b/.exec(testo)?.[1];
  expect(codice, 'nessun codice nel testo').toBeDefined();
  expect(riga.subject).not.toContain(codice!);
  return { codice: codice!, destinatario: decryptPII(riga.toAddress) };
}

async function chiamaCorreggi(corpo: Record<string, unknown>) {
  ip += 1;
  const r = richiesta('/api/gdpr/registrations/edit', 'POST', { locale: 'it', ...corpo });
  r.headers.set('x-forwarded-for', `10.10.${Math.floor(ip / 250)}.${ip % 250}`);
  return correggi(r as never, { params: Promise.resolve({}) });
}

describe('la correzione di nome ed ente', () => {
  it('chiede il codice, lo manda all’indirizzo e corregge solo con quello', async () => {
    const evento = await creaEvento();
    const { iscrizione, token, emailHash } = await iscritto(evento.id, {
      organization: 'Vecchio',
    });
    const corpo = {
      token,
      registrationId: iscrizione.id,
      scope: 'registration',
      displayName: '  Anna Bianchi ',
      organization: 'Comune di Prova',
    };

    const richiesto = await chiamaCorreggi(corpo);
    expect(richiesto.status).toBe(202);
    const { issuedAt } = (await richiesto.json()) as { issuedAt: number };
    const { codice, destinatario } = await codiceArrivato();
    expect(hashEmail(destinatario)).toBe(emailHash);
    // Niente cambia prima della conferma.
    expect(
      tryDecryptPII(
        (await prisma.registration.findUniqueOrThrow({ where: { id: iscrizione.id } }))
          .displayName
      )
    ).toBe('Persona Iscritta');

    const sbagliato = String((Number(codice) + 1) % 1_000_000).padStart(6, '0');
    expect((await chiamaCorreggi({ ...corpo, code: sbagliato, issuedAt })).status).toBe(
      403
    );
    // Lo stesso codice non vale per altri valori.
    expect(
      (
        await chiamaCorreggi({
          ...corpo,
          displayName: 'Altro Nome',
          code: codice,
          issuedAt,
        })
      ).status
    ).toBe(403);

    const fatto = await chiamaCorreggi({ ...corpo, code: codice, issuedAt });
    expect(fatto.status).toBe(200);
    expect(await fatto.json()).toMatchObject({ updated: 1, displayName: 'Anna Bianchi' });
    const dopo = await prisma.registration.findUniqueOrThrow({
      where: { id: iscrizione.id },
    });
    expect(tryDecryptPII(dopo.displayName)).toBe('Anna Bianchi');
    expect(dopo.organization).toBe('Comune di Prova');

    const [riga] = await righeRegistro(evento.id, 'DATA_RECTIFIED');
    expect(JSON.parse(riga!.details!)).toEqual({
      source: 'self-service',
      scope: 'registration',
      fields: ['displayName', 'organization'],
      emailHashPrefix: emailHash.substring(0, 8),
    });
    expect(riga!.details).not.toContain('Anna');
    expect(riga!.details).not.toContain('Comune');
  });

  it('per tutte le iscrizioni corregge anche la voce di rubrica, non le altre persone', async () => {
    const [a, b] = [await creaEvento(), await creaEvento()];
    const prima = await iscritto(a.id, { organization: 'Vecchio' });
    const email = decryptPII(prima.iscrizione.email);
    const seconda = await prisma.registration.create({
      data: {
        eventId: b.id,
        displayName: encryptPII('Persona Iscritta'),
        email: encryptPII(email),
        emailHash: prima.emailHash,
        consentGiven: true,
        consentTimestamp: new Date(),
        accessToken: randomUUID(),
      },
    });
    await prisma.person.create({
      data: {
        emailHash: prima.emailHash,
        email: encryptPII(email),
        displayName: encryptPII('Persona Iscritta'),
        organization: 'Vecchio',
        optedInToAddressBook: true,
        optedInAt: new Date(),
      },
    });
    const altra = await iscritto(a.id);
    const corpo = {
      token: prima.token,
      registrationId: prima.iscrizione.id,
      scope: 'address',
      displayName: 'Anna Bianchi',
      organization: null,
    };
    const { issuedAt } = (await (await chiamaCorreggi(corpo)).json()) as {
      issuedAt: number;
    };
    const { codice } = await codiceArrivato();
    expect((await chiamaCorreggi({ ...corpo, code: codice, issuedAt })).status).toBe(200);

    for (const id of [prima.iscrizione.id, seconda.id]) {
      const r = await prisma.registration.findUniqueOrThrow({ where: { id } });
      expect([tryDecryptPII(r.displayName), r.organization]).toEqual([
        'Anna Bianchi',
        null,
      ]);
    }
    const voce = await prisma.person.findUniqueOrThrow({
      where: { emailHash: prima.emailHash },
    });
    expect([tryDecryptPII(voce.displayName!), voce.organization]).toEqual([
      'Anna Bianchi',
      null,
    ]);
    const estranea = await prisma.registration.findUniqueOrThrow({
      where: { id: altra.iscrizione.id },
    });
    expect(tryDecryptPII(estranea.displayName)).toBe('Persona Iscritta');
    const righe = await prisma.gdprAuditLog.findMany({
      where: { action: 'DATA_RECTIFIED' },
    });
    expect(righe.map((r) => r.eventId).sort()).toEqual([a.id, b.id, null].sort());
  });

  it('segue le regole del modulo: nome, e l’ente dove un evento lo chiede', async () => {
    const evento = await creaEvento({ requireOrganization: true });
    const { iscrizione, token } = await iscritto(evento.id, { organization: 'Ente' });
    const corpo = { token, registrationId: iscrizione.id, scope: 'registration' };
    const senzaEnte = await chiamaCorreggi({
      ...corpo,
      displayName: 'Anna',
      organization: '  ',
    });
    expect(senzaEnte.status).toBe(422);
    expect((await senzaEnte.json()).details).toEqual([
      expect.objectContaining({ path: ['organization'] }),
    ]);
    expect(
      (await chiamaCorreggi({ ...corpo, displayName: ' A ', organization: 'Ente' }))
        .status
    ).toBe(422);
    expect(await prisma.emailOutbox.count()).toBe(0);
  });

  it('senza il token della pagina, o per un’iscrizione di un altro indirizzo, niente codice', async () => {
    const evento = await creaEvento();
    const a = await iscritto(evento.id);
    const b = await iscritto(evento.id);
    const corpo = {
      registrationId: a.iscrizione.id,
      scope: 'registration',
      displayName: 'Anna',
      organization: null,
    };
    expect((await chiamaCorreggi({ ...corpo, token: b.token })).status).toBe(404);
    expect(
      (await chiamaCorreggi({ ...corpo, token: issueGdprToken('export', a.emailHash) }))
        .status
    ).toBe(401);
    expect(await prisma.emailOutbox.count()).toBe(0);
  });
});

async function chiamaAnnulla(corpo: Record<string, unknown>) {
  ip += 1;
  const r = richiesta('/api/gdpr/registrations/cancel', 'POST', {
    locale: 'it',
    ...corpo,
  });
  r.headers.set('x-forwarded-for', `10.11.${Math.floor(ip / 250)}.${ip % 250}`);
  return annulla(r as never, { params: Promise.resolve({}) });
}

describe('la cancellazione di una sola iscrizione', () => {
  it('con il codice cancella quell’iscrizione e cio’ che porta, e tiene la prova senza nome', async () => {
    const evento = await creaEvento({
      ...CON_TRACCE,
      recordingUrl: 'recordings/video.mp4',
    });
    const altroEvento = await creaEvento();
    const { iscrizione, token, emailHash } = await iscritto(evento.id, {
      consentRecording: true,
    });
    const email = decryptPII(iscrizione.email);
    const altra = await prisma.registration.create({
      data: {
        eventId: altroEvento.id,
        displayName: encryptPII('Persona Iscritta'),
        email: encryptPII(email),
        emailHash,
        consentGiven: true,
        consentTimestamp: new Date(),
        accessToken: randomUUID(),
      },
    });
    await prisma.person.create({
      data: {
        emailHash,
        email: encryptPII(email),
        optedInToAddressBook: true,
        optedInAt: new Date(),
      },
    });
    await prisma.chatMessage.create({
      data: {
        eventId: evento.id,
        senderId: `reg-${iscrizione.id}`,
        senderName: encryptPII('Persona Iscritta'),
        text: encryptPII('ciao'),
      },
    });
    const corpo = { token, registrationId: iscrizione.id };

    const richiesto = await chiamaAnnulla(corpo);
    expect(richiesto.status).toBe(202);
    const { issuedAt } = (await richiesto.json()) as { issuedAt: number };
    const { codice } = await codiceArrivato();
    // Un codice per correggere non cancella.
    expect(
      (
        await chiamaAnnulla({
          ...corpo,
          code: String((Number(codice) + 7) % 1e6).padStart(6, '0'),
          issuedAt,
        })
      ).status
    ).toBe(403);
    expect(await prisma.registration.count({ where: { id: iscrizione.id } })).toBe(1);

    const fatto = await chiamaAnnulla({ ...corpo, code: codice, issuedAt });
    expect(fatto.status).toBe(200);
    expect(await fatto.json()).toEqual({ deleted: 1, consentProofsKept: 1 });
    expect(await prisma.registration.count({ where: { id: iscrizione.id } })).toBe(0);
    expect(
      await prisma.chatMessage.count({ where: { senderId: `reg-${iscrizione.id}` } })
    ).toBe(0);
    // Il codice della cancellazione era un'email di quell'iscrizione: se ne va con lei.
    expect(await prisma.emailOutbox.count()).toBe(0);
    const [prova] = await prisma.retainedConsentProof.findMany({
      where: { eventId: evento.id },
    });
    expect(prova).toMatchObject({ kind: 'recording', displayName: null, emailHash });
    // Il resto dell'indirizzo resta.
    expect(await prisma.registration.count({ where: { id: altra.id } })).toBe(1);
    expect(await prisma.person.count({ where: { emailHash } })).toBe(1);

    const [riga] = await righeRegistro(evento.id, 'DATA_DELETED');
    expect(JSON.parse(riga!.details!)).toEqual({
      source: 'gdpr-registration-cancel',
      emailHashPrefix: emailHash.substring(0, 8),
      consentProofsWithoutName: 1,
    });
    // Rifatto, l'iscrizione non c'e' piu'.
    expect((await chiamaAnnulla({ ...corpo, code: codice, issuedAt })).status).toBe(404);
  });

  it('il codice di un’iscrizione non cancella un’altra dello stesso indirizzo', async () => {
    const [a, b] = [await creaEvento(), await creaEvento()];
    const prima = await iscritto(a.id);
    const seconda = await prisma.registration.create({
      data: {
        eventId: b.id,
        displayName: encryptPII('Persona Iscritta'),
        email: prima.iscrizione.email,
        emailHash: prima.emailHash,
        consentGiven: true,
        consentTimestamp: new Date(),
        accessToken: randomUUID(),
      },
    });
    const { issuedAt } = (await (
      await chiamaAnnulla({ token: prima.token, registrationId: prima.iscrizione.id })
    ).json()) as { issuedAt: number };
    const { codice } = await codiceArrivato();
    const res = await chiamaAnnulla({
      token: prima.token,
      registrationId: seconda.id,
      code: codice,
      issuedAt,
    });
    expect(res.status).toBe(403);
    expect(await prisma.registration.count()).toBe(2);
  });
});
