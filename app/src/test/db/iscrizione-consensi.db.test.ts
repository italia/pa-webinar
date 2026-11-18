// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * I consensi dell'iscrizione sul database vero: la colonna con l'enum della
 * destinazione, la transazione che lascia tutto com'era quando il testo e'
 * cambiato, la rubrica che resta intatta dove non si propone e il link per
 * uscirne, che resta nelle email a chi ha gia' una voce.
 */
import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as iscrivi } from '@/app/api/events/[param]/registrations/route';
import { decryptPII, hashEmail } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { verifyRubricaOptOutToken } from '@/lib/persons/opt-out-token';
import { invalidateSettingsCache, leggiOCrea } from '@/lib/settings';

import { creaEvento, richiesta, svuotaDatabase } from './fixtures';

// Fuori da Next `getTranslations` lancia, e la conferma non partirebbe.
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (chiave: string) => chiave,
}));

const FUTURO = 24 * 3_600_000;

/** Un evento aperto alle iscrizioni, con la registrazione chiesta a chi partecipa. */
function eventoAperto(campi: Partial<Prisma.EventUncheckedCreateInput> = {}) {
  return creaEvento({
    status: 'PUBLISHED',
    startsAt: new Date(Date.now() + FUTURO),
    endsAt: new Date(Date.now() + FUTURO + 3_600_000),
    recordingEnabled: true,
    participantsCanUnmute: true,
    ...campi,
  });
}

let ip = 0;

function iscriviti(slug: string, email: string, corpo: Record<string, unknown> = {}) {
  ip += 1;
  const r = richiesta(`/api/events/${slug}/registrations`, 'POST', {
    displayName: 'Persona Iscritta',
    email,
    consentGiven: true,
    locale: 'it',
    ...corpo,
  });
  r.headers.set('x-forwarded-for', `10.9.${Math.floor(ip / 250)}.${ip % 250}`);
  return iscrivi(r as never, { params: Promise.resolve({ param: slug }) });
}

const nuovaEmail = () => `${randomUUID()}@example.org`;

async function impostazioni(campi: Prisma.SiteSettingUpdateInput) {
  await leggiOCrea();
  await prisma.siteSetting.update({ where: { id: 'singleton' }, data: campi });
  invalidateSettingsCache();
}

const iscrizioneDi = (email: string) =>
  prisma.registration.findFirstOrThrow({ where: { emailHash: hashEmail(email) } });

const auditDi = async (eventId: string) => {
  const riga = await prisma.gdprAuditLog.findFirstOrThrow({
    where: { eventId, action: 'CONSENT_RECORDED' },
  });
  return JSON.parse(riga.details ?? '{}') as Record<string, unknown>;
};

beforeEach(async () => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://webinar.example.org');
  await svuotaDatabase();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('destinazione del consenso alla registrazione', () => {
  it('con il consenso si salvano destinazione e versione del testo', async () => {
    // Il testo per la sola voce: il chart dichiara che chi partecipa resta fuori
    // dal video e che, con il consenso, la sua voce si sente.
    vi.stubEnv('RECORDING_VOICE_EXCLUSION', 'true');
    vi.stubEnv('RECORDING_PARTICIPANT_VOICE', 'true');
    const evento = await eventoAperto({ recordingDestination: 'REGISTRANTS' });
    const email = nuovaEmail();

    const risposta = await iscriviti(evento.slug, email, {
      consentRecording: true,
      consentRecordingDestination: 'REGISTRANTS',
    });

    expect(risposta.status).toBe(201);
    expect(await iscrizioneDi(email)).toMatchObject({
      consentRecording: true,
      consentRecordingDestination: 'REGISTRANTS',
      consentRecordingVersion: 2,
    });
    expect(await auditDi(evento.id)).toMatchObject({
      consentRecordingDestination: 'REGISTRANTS',
      consentRecordingVersion: 2,
    });
  });

  it("dove chi partecipa puo' comparire si salva la versione del testo che lo dice", async () => {
    const evento = await eventoAperto({ recordingDestination: 'REGISTRANTS' });
    const email = nuovaEmail();

    await iscriviti(evento.slug, email, {
      consentRecording: true,
      consentRecordingDestination: 'REGISTRANTS',
    });

    expect(await iscrizioneDi(email)).toMatchObject({
      consentRecordingDestination: 'REGISTRANTS',
      consentRecordingVersion: 1,
    });
  });

  it('senza consenso restano nulle', async () => {
    const evento = await eventoAperto({ recordingDestination: 'PUBLIC' });
    const email = nuovaEmail();

    const risposta = await iscriviti(evento.slug, email, {
      consentRecording: false,
      consentRecordingDestination: 'PUBLIC',
    });

    expect(risposta.status).toBe(201);
    expect(await iscrizioneDi(email)).toMatchObject({
      consentRecording: false,
      consentRecordingDestination: null,
      consentRecordingVersion: null,
    });
  });

  it("un evento senza destinazione non la salva, ma salva la versione del testo", async () => {
    vi.stubEnv('RECORDING_VOICE_EXCLUSION', 'true');
    vi.stubEnv('RECORDING_PARTICIPANT_VOICE', 'true');
    const evento = await eventoAperto();
    const email = nuovaEmail();

    await iscriviti(evento.slug, email, {
      consentRecording: true,
      consentRecordingDestination: null,
    });

    expect(await iscrizioneDi(email)).toMatchObject({
      consentRecording: true,
      consentRecordingDestination: null,
      consentRecordingVersion: 2,
    });
  });

  it("dove chi partecipa puo' comparire la versione si salva anche senza destinazione", async () => {
    const evento = await eventoAperto();
    const email = nuovaEmail();

    await iscriviti(evento.slug, email, {
      consentRecording: true,
      consentRecordingDestination: null,
    });

    expect(await iscrizioneDi(email)).toMatchObject({
      consentRecordingDestination: null,
      consentRecordingVersion: 1,
    });
  });

  it('il testo cambiato a pagina aperta non lascia traccia: 422, nessuna riga', async () => {
    const evento = await eventoAperto({ recordingDestination: 'PUBLIC' });
    const email = nuovaEmail();

    const risposta = await iscriviti(evento.slug, email, {
      consentRecording: true,
      consentRecordingDestination: 'REGISTRANTS',
      consentAddressBook: true,
    });

    expect(risposta.status).toBe(422);
    expect(await risposta.json()).toMatchObject({
      details: [
        {
          path: ['consentRecording'],
          message: 'registration.errors.recordingDestinationChanged',
        },
      ],
    });
    expect(await prisma.registration.count()).toBe(0);
    expect(await prisma.gdprAuditLog.count()).toBe(0);
    expect(await prisma.person.count()).toBe(0);
    expect(await prisma.emailOutbox.count()).toBe(0);
  });

  it("senza video e senza tracce non c'e' niente a cui acconsentire", async () => {
    vi.stubEnv('JITSI_WEB_INTERNAL_URL', 'http://jitsi-web');
    vi.stubEnv('JIBRI_HEALTH_URL', '');
    vi.stubEnv('RECORDER_CONTROLLER_URL', 'http://recorder-controller');
    const evento = await eventoAperto({ recordingDestination: 'REGISTRANTS' });
    const email = nuovaEmail();

    const risposta = await iscriviti(evento.slug, email, { consentRecording: true });

    expect(risposta.status).toBe(201);
    expect(await iscrizioneDi(email)).toMatchObject({
      consentRecording: null,
      consentRecordingDestination: null,
      consentRecordingVersion: null,
    });
  });

  it("dove non c'e' un video vale il testo senza destinazione", async () => {
    vi.stubEnv('JITSI_WEB_INTERNAL_URL', 'http://jitsi-web');
    vi.stubEnv('JIBRI_HEALTH_URL', '');
    vi.stubEnv('RECORDER_CONTROLLER_URL', 'http://recorder-controller');
    const evento = await eventoAperto({
      recordingDestination: 'REGISTRANTS',
      multitrackRecordingEnabled: true,
      aiTranscriptEnabled: true,
    });
    const email = nuovaEmail();

    const risposta = await iscriviti(evento.slug, email, {
      consentRecording: true,
      consentRecordingDestination: null,
    });

    expect(risposta.status).toBe(201);
    // Il testo senza video ha un numero suo: non copre un video.
    expect(await iscrizioneDi(email)).toMatchObject({
      consentRecording: true,
      consentRecordingDestination: null,
      consentRecordingVersion: 3,
    });
  });
});

describe('casella della trascrizione', () => {
  it('con la pipeline accesa la trascrizione dal video salva consenso e versione', async () => {
    await impostazioni({ aiPipelineEnabled: true });
    const evento = await eventoAperto({ aiTranscriptEnabled: true });
    const email = nuovaEmail();

    await iscriviti(evento.slug, email, {
      consentRecording: true,
      consentRecordingDestination: null,
      consentMultitrack: true,
    });

    expect(await iscrizioneDi(email)).toMatchObject({
      consentMultitrack: true,
      consentMultitrackVersion: 2,
    });
  });

  it("a pipeline spenta il consenso resta null: non e' stato chiesto", async () => {
    const evento = await eventoAperto({ aiTranscriptEnabled: true });
    const email = nuovaEmail();

    await iscriviti(evento.slug, email, { consentMultitrack: true });

    expect(await iscrizioneDi(email)).toMatchObject({
      consentMultitrack: null,
      consentMultitrackVersion: null,
    });
  });
});

describe('rubrica', () => {
  const conRubrica = { consentAddressBook: true, consentFutureCommunications: true };

  async function vocePrecedente(email: string) {
    const prima = new Date('2026-01-15T10:00:00.000Z');
    return prisma.person.create({
      data: {
        emailHash: hashEmail(email),
        organization: 'Ente precedente',
        optedInToAddressBook: true,
        optedInAt: prima,
        lastActiveAt: prima,
      },
    });
  }

  it("proposta: la voce nasce legata all'iscrizione", async () => {
    const evento = await eventoAperto({ recordingEnabled: false });
    const email = nuovaEmail();

    const risposta = await iscriviti(evento.slug, email, conRubrica);

    expect(risposta.status).toBe(201);
    const voce = await prisma.person.findUniqueOrThrow({
      where: { emailHash: hashEmail(email) },
    });
    expect(voce.optedInToAddressBook).toBe(true);
    expect(await iscrizioneDi(email)).toMatchObject({
      personId: voce.id,
      consentFutureCommunications: true,
    });
  });

  it.each([
    ["dall'evento", { offerAddressBook: false }, {}],
    ["dall'installazione", {}, { addressBookEnabled: false }],
  ])('non proposta %s: 201 e nessuna voce nuova', async (_nome, campi, sito) => {
    await impostazioni(sito);
    const evento = await eventoAperto({ recordingEnabled: false, ...campi });
    const email = nuovaEmail();

    const risposta = await iscriviti(evento.slug, email, conRubrica);

    expect(risposta.status).toBe(201);
    expect(await prisma.person.count()).toBe(0);
    expect(await iscrizioneDi(email)).toMatchObject({
      personId: null,
      consentFutureCommunications: false,
    });
    expect(await auditDi(evento.id)).toMatchObject({
      consentAddressBook: false,
      consentFutureCommunications: false,
    });
  });

  it("non proposta: una voce che esiste gia' resta intatta e legata all'iscrizione", async () => {
    const email = nuovaEmail();
    const prima = await vocePrecedente(email);
    const evento = await eventoAperto({
      recordingEnabled: false,
      offerAddressBook: false,
    });

    const risposta = await iscriviti(evento.slug, email, {
      ...conRubrica,
      organization: 'Ente nuovo',
    });

    expect(risposta.status).toBe(201);
    expect(await prisma.person.findUniqueOrThrow({ where: { id: prima.id } })).toEqual(
      prima
    );
    expect((await iscrizioneDi(email)).personId).toBe(prima.id);
  });

  it('non proposta: la conferma porta il link per uscire dalla rubrica', async () => {
    const email = nuovaEmail();
    const prima = await vocePrecedente(email);
    const evento = await eventoAperto({
      recordingEnabled: false,
      offerAddressBook: false,
    });

    expect((await iscriviti(evento.slug, email)).status).toBe(201);

    const posta = await prisma.emailOutbox.findFirstOrThrow();
    const token = decryptPII(posta.html).match(/opt-out\?token=([^"&]+)/)?.[1];
    expect(token).toBeDefined();
    expect(verifyRubricaOptOutToken(decodeURIComponent(token ?? ''))).toEqual({
      personId: prima.id,
    });
  });

  it('non proposta, senza una voce: la conferma non parla della rubrica', async () => {
    const evento = await eventoAperto({
      recordingEnabled: false,
      offerAddressBook: false,
    });

    expect((await iscriviti(evento.slug, nuovaEmail())).status).toBe(201);

    const posta = await prisma.emailOutbox.findFirstOrThrow();
    expect(decryptPII(posta.html)).not.toContain('opt-out');
  });
});
