// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * La chiamata rapida su un database vero: chi partecipa entra con la voce fuori
 * dalla registrazione, il si' alla domanda lascia la prova sul suo posto e la
 * riporta ai rientri, chi modera e' nel video. Ogni ingresso nella conferenza
 * lascia una riga di presenza con il segno della voce e il suo periodo: le
 * riconnessioni non si sovrascrivono, e la rimozione su richiesta le legge.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as chiediToken } from '@/app/api/events/[param]/jitsi/token/route';
import { POST as occupante } from '@/app/api/internal/jitsi/occupants/route';
import { GET as leggiPosti } from '@/app/api/events/[param]/seats/route';
import { prisma } from '@/lib/db';

import { creaEvento, richiesta, svuotaDatabase } from './fixtures';

const RAPIDA = {
  eventType: 'INSTANT' as const,
  recordingEnabled: true,
  participantsCanUnmute: true,
  participantsCanStartVideo: true,
  participantsCanShareScreen: true,
};

beforeEach(async () => {
  await svuotaDatabase();
  vi.stubEnv('RECORDING_VOICE_EXCLUSION', 'true');
  vi.stubEnv('RECORDING_PARTICIPANT_VOICE', 'true');
});
afterEach(() => vi.unstubAllEnvs());

interface RispostaToken {
  jwt: string;
  voiceExcluded: boolean;
  consentsRecorded: { recording: boolean; multitrack: boolean };
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

const utente = (jwt: string) =>
  (
    JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString()) as {
      context: { user: { id: string; voiceExcluded?: boolean; paInVideo?: boolean } };
    }
  ).context.user;

/** Prosody (mod_pa_occupants) che dice chi entra ed esce. */
async function presenza(corpo: Record<string, unknown>) {
  const r = new Request('http://localhost/api/internal/jitsi/occupants', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': 'chiave-delle-prove-sul-database',
    },
    body: JSON.stringify(corpo),
  });
  const risposta = await occupante(r as never, { params: Promise.resolve({}) } as never);
  expect([200, 204]).toContain(risposta.status);
}

describe('chiamata rapida', () => {
  it("chi partecipa entra con la voce fuori; chi modera e' nel video", async () => {
    const evento = await creaEvento(RAPIDA);
    const ospite = await entra(evento.slug, { guestName: 'Ospite' });
    expect(ospite.voiceExcluded).toBe(true);
    expect(utente(ospite.jwt).voiceExcluded).toBe(true);
    expect(utente(ospite.jwt).paInVideo).toBeUndefined();

    const modera = await entra(evento.slug, {
      moderatorToken: evento.moderatorToken,
      displayNameOverride: 'Persona che modera',
    });
    expect(modera.voiceExcluded).toBe(false);
    expect(utente(modera.jwt).paInVideo).toBe(true);
    expect(await prisma.recordingConsent.count({ where: { eventId: evento.id } })).toBe(
      0
    );
  });

  it("il si' lascia la prova sul posto, e i rientri della stessa visita la riportano", async () => {
    const evento = await creaEvento(RAPIDA);
    const primo = await entra(evento.slug, {
      guestName: 'Ospite',
      recordingConsent: true,
    });
    expect(primo.voiceExcluded).toBe(false);
    const [prova] = await prisma.recordingConsent.findMany({
      where: { eventId: evento.id },
    });
    expect(prova).toMatchObject({
      jitsiUserId: utente(primo.jwt).id,
      destination: null,
      textVersion: null,
    });

    // La rete cade: un posto nuovo, il consenso torna come replica con il token di prima.
    const rientro = await entra(evento.slug, {
      guestName: 'Ospite',
      consentReplay: { recording: true, roomTokens: [primo.jwt] },
    });
    expect(rientro.voiceExcluded).toBe(false);
    expect(rientro.consentsInForce.recording).toBe(true);
    expect(utente(rientro.jwt).id).not.toBe(utente(primo.jwt).id);
  });

  it('ogni ingresso lascia la sua riga di presenza, con il segno della voce e il periodo', async () => {
    const evento = await creaEvento(RAPIDA);
    const stanza = evento.jitsiRoomName;
    // Fuori dalla registrazione, poi il si': si rientra con un endpoint nuovo.
    await presenza({
      room: stanza,
      endpointId: 'ep1',
      seatId: 'guest-a',
      voiceExcluded: true,
      action: 'joined',
    });
    await presenza({
      room: stanza,
      endpointId: 'ep1',
      seatId: 'guest-a',
      voiceExcluded: true,
      action: 'left',
    });
    await presenza({
      room: stanza,
      endpointId: 'ep2',
      seatId: 'guest-b',
      action: 'joined',
    });

    const righe = await prisma.roomOccupant.findMany({
      where: { eventId: evento.id },
      orderBy: { joinedAt: 'asc' },
    });
    expect(righe).toHaveLength(2);
    expect(righe[0]).toMatchObject({ endpointId: 'ep1', voiceExcluded: true });
    expect(righe[0]!.leftAt).not.toBeNull();
    expect(righe[1]).toMatchObject({
      endpointId: 'ep2',
      voiceExcluded: false,
      leftAt: null,
    });
  });

  it("chi modera legge chi e' nel video e di chi si registra la voce", async () => {
    const evento = await creaEvento(RAPIDA);
    const stanza = evento.jitsiRoomName;
    await presenza({
      room: stanza,
      endpointId: 'epm',
      seatId: `mod-${evento.id}-abc12345`,
      action: 'joined',
    });
    await presenza({
      room: stanza,
      endpointId: 'eps',
      seatId: 'guest-si',
      action: 'joined',
    });
    await presenza({
      room: stanza,
      endpointId: 'epn',
      seatId: 'guest-no',
      voiceExcluded: true,
      action: 'joined',
    });
    await presenza({
      room: stanza,
      endpointId: 'epx',
      seatId: 'guest-uscito',
      action: 'joined',
    });
    await presenza({
      room: stanza,
      endpointId: 'epx',
      seatId: 'guest-uscito',
      action: 'left',
    });

    const risposta = await leggiPosti(
      richiesta(
        `/api/events/${evento.slug}/seats`,
        'GET',
        undefined,
        evento.moderatorToken
      ) as never,
      { params: Promise.resolve({ param: evento.slug }) }
    );
    expect(risposta.status).toBe(200);
    expect(
      ((await risposta.json()) as { recording: Record<string, string> }).recording
    ).toEqual({
      epm: 'video',
      eps: 'voce',
      epn: 'nessuna',
    });
  });
});
