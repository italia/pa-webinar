// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * I consensi in vigore riletti a sala aperta, su un database vero: cambiano senza
 * un token nuovo, e la lettura deve dire lo stesso del token e del registratore.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as leggiConsensi } from '@/app/api/events/[param]/consents/in-force/route';
import { POST as chiediToken } from '@/app/api/events/[param]/jitsi/token/route';
import { prisma } from '@/lib/db';
import { eventAccessCookieName, signEventAccess } from '@/lib/event-session';
import { ritiraConsensi } from '@/lib/live/consent-withdrawal';

import { biscotti } from './biscotti';
import { creaEvento, creaIscrizione, richiesta, svuotaDatabase } from './fixtures';

const CON_TRACCE = {
  recordingEnabled: true,
  participantsCanUnmute: true,
  multitrackRecordingEnabled: true,
};

beforeEach(async () => {
  await svuotaDatabase();
  vi.stubEnv('RECORDING_VOICE_EXCLUSION', 'true');
  vi.stubEnv('CAPTIONS_STATUS_URL', 'http://captions.example.org/health');
});
afterEach(() => vi.unstubAllEnvs());

interface RispostaToken {
  jwt: string;
  consentsInForce: { recording: boolean; transcription: boolean };
}

async function entra(
  slug: string,
  corpo: Record<string, unknown>
): Promise<RispostaToken> {
  const risposta = await chiediToken(
    richiesta(`/api/events/${slug}/jitsi/token`, 'POST', corpo) as never,
    { params: Promise.resolve({ param: slug }) }
  );
  expect(risposta.status).toBe(200);
  return (await risposta.json()) as RispostaToken;
}

async function leggi(slug: string, roomTokens: string[]) {
  const risposta = await leggiConsensi(
    richiesta(`/api/events/${slug}/consents/in-force`, 'POST', { roomTokens }) as never,
    { params: Promise.resolve({ param: slug }) }
  );
  expect(risposta.status).toBe(200);
  return risposta.json();
}

async function iscrittoDa(eventId: string) {
  const iscrizione = await creaIscrizione(eventId);
  biscotti.set(
    eventAccessCookieName(eventId),
    await signEventAccess(eventId, iscrizione.accessToken, 3600)
  );
  return iscrizione;
}

const conIConsensi = (accessToken: string) => ({
  accessToken,
  recordingConsent: true,
  recordingConsentDestination: null,
  multitrackConsent: true,
});

describe('i consensi in vigore a sala aperta', () => {
  it('dicono lo stesso della risposta del token', async () => {
    const evento = await creaEvento(CON_TRACCE);
    const iscrizione = await iscrittoDa(evento.id);
    const { jwt, consentsInForce } = await entra(
      evento.slug,
      conIConsensi(iscrizione.accessToken)
    );
    expect(consentsInForce).toEqual({ recording: true, transcription: true });
    expect(await leggi(evento.slug, [jwt])).toEqual({
      ...consentsInForce,
      recordingDestination: null,
    });
  });

  it('un ritiro dalla pagina dei propri dati si vede senza rientrare', async () => {
    const evento = await creaEvento(CON_TRACCE);
    const iscrizione = await iscrittoDa(evento.id);
    const { jwt } = await entra(evento.slug, conIConsensi(iscrizione.accessToken));
    await ritiraConsensi(evento.id, [], { registrazione: true }, new Date(), {
      iscrizioni: [iscrizione.id],
      origine: 'self-service',
    });
    expect(await leggi(evento.slug, [jwt])).toMatchObject({
      recording: false,
      transcription: false,
    });
  });

  it('i sottotitoli accesi dal vivo chiedono il testo che comprende la trascrizione', async () => {
    const evento = await creaEvento({
      ...CON_TRACCE,
      captionsTranscriptEnabled: true,
      liveCaptionsEnabled: false,
    });
    const iscrizione = await iscrittoDa(evento.id);
    const { jwt } = await entra(evento.slug, conIConsensi(iscrizione.accessToken));
    await prisma.multitrackConsent.updateMany({
      where: { eventId: evento.id },
      data: { textVersion: 1 },
    });
    await prisma.registration.update({
      where: { id: iscrizione.id },
      data: { consentMultitrack: null },
    });
    expect(await leggi(evento.slug, [jwt])).toMatchObject({ transcription: true });

    await prisma.event.update({
      where: { id: evento.id },
      data: { liveCaptionsEnabled: true },
    });

    expect(await leggi(evento.slug, [jwt])).toMatchObject({
      recording: true,
      transcription: false,
    });
  });

  it('per un ospite vale una prova su uno dei posti della visita, finche non la ritira', async () => {
    const evento = await creaEvento(CON_TRACCE);
    const primo = await entra(evento.slug, {
      guestName: 'Ospite',
      recordingConsent: true,
      recordingConsentDestination: null,
    });
    const secondo = await entra(evento.slug, { guestName: 'Ospite' });
    expect(secondo.consentsInForce.recording).toBe(false);
    const posti = [primo.jwt, secondo.jwt];
    expect(await leggi(evento.slug, posti)).toMatchObject({ recording: true });

    const prova = await prisma.recordingConsent.findFirstOrThrow({
      where: { eventId: evento.id },
    });
    await ritiraConsensi(evento.id, [prova.jitsiUserId], { registrazione: true });

    expect(await leggi(evento.slug, posti)).toMatchObject({ recording: false });
  });

  it('un testo nuovo che il consenso non copre non vale, e la risposta lo dice', async () => {
    const evento = await creaEvento({
      ...CON_TRACCE,
      recordingDestination: 'REGISTRANTS',
    });
    const iscrizione = await iscrittoDa(evento.id);
    const { jwt } = await entra(evento.slug, {
      ...conIConsensi(iscrizione.accessToken),
      recordingConsentDestination: 'REGISTRANTS',
    });
    await prisma.event.update({
      where: { id: evento.id },
      data: { recordingDestination: 'PUBLIC' },
    });
    expect(await leggi(evento.slug, [jwt])).toMatchObject({
      recording: false,
      recordingDestination: 'PUBLIC',
    });
  });
});
