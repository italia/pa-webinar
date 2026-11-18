// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * La pagina dei propri dati sul database vero: un consenso dato di nuovo dopo un
 * ritiro, con la stessa prova di quello dato in sala, e solo finche' l'evento lo
 * chiede.
 */
import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as chiediToken } from '@/app/api/events/[param]/jitsi/token/route';
import { POST as consensi } from '@/app/api/gdpr/consents/route';
import { encryptPII, hashEmail } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { eventAccessCookieName, signEventAccess } from '@/lib/event-session';
import { leggiRigheProve, postoDaIMieiDati } from '@/lib/gdpr/consent-proofs';
import { issueGdprToken } from '@/lib/gdpr/request-token';
import { ritiraComunicazioni, ritiraConsensi } from '@/lib/live/consent-withdrawal';
import { registrazioneDellIscrizione } from '@/lib/live/consents-in-force';

import { biscotti } from './biscotti';
import { creaEvento, richiesta, svuotaDatabase } from './fixtures';

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
      (await dai(b.token, b.iscrizione.id, { consent: 'transcription' })).status
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
    const senza = await dai(token, iscrizione.id, { consent: 'transcription' });
    expect(senza.status).toBe(409);
    expect((await senza.json()).code).toBe('RECORDING_CONSENT_REQUIRED');

    await dai(token, iscrizione.id, { consent: 'recording', recordingDestination: null });
    expect((await dai(token, iscrizione.id, { consent: 'transcription' })).status).toBe(
      200
    );
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
