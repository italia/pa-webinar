// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Il consenso alla registrazione dato entrando in sala, su un database vero: la
 * prova unica dell'iscrizione, il suo aggiornamento quando il testo in vigore
 * non e' piu' coperto, e due ingressi insieme. Un client simulato non vede il
 * vincolo unico, il filtro sulla colonna nulla ne' il JSON dei periodi. Le
 * repliche che la pagina manda a ogni rientro non ridanno mai un consenso ritirato.
 */
import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as chiediToken } from '@/app/api/events/[param]/jitsi/token/route';
import { consensoTrascrizione } from '@/lib/captions/room';
import { encryptPII, hashEmail } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { eventAccessCookieName, signEventAccess } from '@/lib/event-session';
import { ritiraConsensi } from '@/lib/live/consent-withdrawal';
import {
  VERSIONE_TESTO_REGISTRAZIONE,
  type PeriodoConsenso,
} from '@/lib/recording/destination';

import { biscotti } from './biscotti';
import {
  creaEvento,
  creaIscrizione,
  entraCome,
  richiesta,
  svuotaDatabase,
} from './fixtures';

const CHE_REGISTRA = { recordingEnabled: true, participantsCanUnmute: true };

beforeEach(async () => {
  await svuotaDatabase();
  vi.stubEnv('RECORDING_VOICE_EXCLUSION', 'true');
  vi.stubEnv('RECORDING_PARTICIPANT_VOICE', 'true');
});
afterEach(() => vi.unstubAllEnvs());

interface RispostaToken {
  jwt: string;
  voiceExcluded: boolean;
  recordingDestination: string | null;
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

async function iscrittoDa(eventId: string) {
  const iscrizione = await creaIscrizione(eventId);
  biscotti.set(
    eventAccessCookieName(eventId),
    await signEventAccess(eventId, iscrizione.accessToken, 3600)
  );
  return iscrizione;
}

function provaEsistente(
  eventId: string,
  registrationId: string,
  campi: {
    destination?: 'PUBLIC' | 'REGISTRANTS' | null;
    textVersion?: number | null;
    withdrawnAt?: Date | null;
  }
) {
  return prisma.recordingConsent.create({
    data: {
      eventId,
      registrationId,
      jitsiUserId: `reg-${registrationId}`,
      displayName: encryptPII('Persona Iscritta'),
      consentedAt: new Date('2026-11-01T10:00:00Z'),
      ...campi,
    },
  });
}

const prove = (eventId: string) =>
  prisma.recordingConsent.findMany({ where: { eventId } });
const registro = (eventId: string) =>
  prisma.gdprAuditLog.count({ where: { eventId, action: 'CONSENT_RECORDED' } });
const tracce = (eventId: string) =>
  prisma.multitrackConsent.findMany({ where: { eventId } });
const posto = (jwt: string) =>
  (
    JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString()) as {
      context: { user: { id: string } };
    }
  ).context.user.id;

describe('la prova dell’iscrizione quando il testo in vigore cambia', () => {
  it('dopo un allargamento il testo vecchio non vale e la prova non cambia', async () => {
    const evento = await creaEvento({ ...CHE_REGISTRA, recordingDestination: 'PUBLIC' });
    const iscrizione = await iscrittoDa(evento.id);
    await provaEsistente(evento.id, iscrizione.id, {
      destination: 'REGISTRANTS',
      textVersion: 1,
    });

    const risposta = await entra(evento.slug, {
      accessToken: iscrizione.accessToken,
      recordingConsent: true,
      recordingConsentDestination: 'REGISTRANTS',
    });

    expect(risposta.voiceExcluded).toBe(true);
    expect(risposta.recordingDestination).toBe('PUBLIC');
    expect(risposta.consentsRecorded.recording).toBe(false);
    const [prova, ...altre] = await prove(evento.id);
    expect(altre).toEqual([]);
    expect(prova!.destination).toBe('REGISTRANTS');
    expect(prova!.earlierPeriods).toBeNull();
    expect(await registro(evento.id)).toBe(0);
  });

  it('sul testo nuovo la stessa riga passa alla destinazione nuova e tiene il periodo vecchio', async () => {
    const evento = await creaEvento({ ...CHE_REGISTRA, recordingDestination: 'PUBLIC' });
    const iscrizione = await iscrittoDa(evento.id);
    const vecchia = await provaEsistente(evento.id, iscrizione.id, {
      destination: 'REGISTRANTS',
      textVersion: 1,
    });

    const risposta = await entra(evento.slug, {
      accessToken: iscrizione.accessToken,
      recordingConsent: true,
      recordingConsentDestination: 'PUBLIC',
    });

    expect(risposta.voiceExcluded).toBe(false);
    const [prova, ...altre] = await prove(evento.id);
    expect(altre).toEqual([]);
    expect(prova!.id).toBe(vecchia.id);
    expect(prova!.destination).toBe('PUBLIC');
    expect(prova!.textVersion).toBe(VERSIONE_TESTO_REGISTRAZIONE);
    expect(prova!.consentedAt.getTime()).toBeGreaterThan(vecchia.consentedAt.getTime());
    const periodi: PeriodoConsenso[] = [
      {
        consentedAt: vecchia.consentedAt.toISOString(),
        withdrawnAt: null,
        destination: 'REGISTRANTS',
        textVersion: 1,
      },
    ];
    expect(prova!.earlierPeriods).toEqual(periodi);
    expect(await registro(evento.id)).toBe(1);
  });

  it('una prova senza destinazione si aggiorna: il filtro sulla colonna nulla la trova', async () => {
    const evento = await creaEvento({
      ...CHE_REGISTRA,
      recordingDestination: 'REGISTRANTS',
    });
    const iscrizione = await iscrittoDa(evento.id);
    await provaEsistente(evento.id, iscrizione.id, {});

    await entra(evento.slug, {
      accessToken: iscrizione.accessToken,
      recordingConsent: true,
      recordingConsentDestination: 'REGISTRANTS',
    });

    const [prova] = await prove(evento.id);
    expect(prova!.destination).toBe('REGISTRANTS');
    expect(prova!.earlierPeriods).toEqual([
      {
        consentedAt: '2026-11-01T10:00:00.000Z',
        withdrawnAt: null,
        destination: null,
        textVersion: null,
      },
    ]);
  });

  it('al rientro dopo una restrizione la prova resta quella letta, senza rifarla', async () => {
    const evento = await creaEvento({
      ...CHE_REGISTRA,
      recordingDestination: 'REGISTRANTS',
    });
    const iscrizione = await iscrittoDa(evento.id);
    const vecchia = await provaEsistente(evento.id, iscrizione.id, {
      destination: 'PUBLIC',
      textVersion: 1,
    });

    const senzaRichiesta = await entra(evento.slug, {
      accessToken: iscrizione.accessToken,
    });
    const riletta = await entra(evento.slug, {
      accessToken: iscrizione.accessToken,
      recordingConsent: true,
      recordingConsentDestination: 'REGISTRANTS',
    });

    expect(senzaRichiesta.voiceExcluded).toBe(false);
    expect(riletta.voiceExcluded).toBe(false);
    const [prova, ...altre] = await prove(evento.id);
    expect(altre).toEqual([]);
    expect(prova!.destination).toBe('PUBLIC');
    expect(prova!.consentedAt).toEqual(vecchia.consentedAt);
    expect(prova!.earlierPeriods).toBeNull();
  });

  it('un consenso ritirato si ridà sul testo in vigore, con il suo periodo', async () => {
    const evento = await creaEvento({
      ...CHE_REGISTRA,
      recordingDestination: 'REGISTRANTS',
    });
    const iscrizione = await iscrittoDa(evento.id);
    const ritiro = new Date('2026-11-01T10:30:00Z');
    await provaEsistente(evento.id, iscrizione.id, {
      destination: 'PUBLIC',
      textVersion: 1,
      withdrawnAt: ritiro,
    });

    await entra(evento.slug, {
      accessToken: iscrizione.accessToken,
      recordingConsent: true,
      recordingConsentDestination: 'REGISTRANTS',
    });

    const [prova] = await prove(evento.id);
    expect(prova!.withdrawnAt).toBeNull();
    expect(prova!.destination).toBe('REGISTRANTS');
    expect(prova!.earlierPeriods).toEqual([
      {
        consentedAt: '2026-11-01T10:00:00.000Z',
        withdrawnAt: ritiro.toISOString(),
        destination: 'PUBLIC',
        textVersion: 1,
      },
    ]);
  });

  it('due ingressi insieme aggiornano una volta sola', async () => {
    const evento = await creaEvento({ ...CHE_REGISTRA, recordingDestination: 'PUBLIC' });
    const iscrizione = await iscrittoDa(evento.id);
    await provaEsistente(evento.id, iscrizione.id, {
      destination: 'REGISTRANTS',
      textVersion: 1,
    });

    const corpo = {
      accessToken: iscrizione.accessToken,
      recordingConsent: true,
      recordingConsentDestination: 'PUBLIC',
    };
    await Promise.all([entra(evento.slug, corpo), entra(evento.slug, corpo)]);

    const [prova, ...altre] = await prove(evento.id);
    expect(altre).toEqual([]);
    expect(prova!.destination).toBe('PUBLIC');
    expect(prova!.earlierPeriods).toHaveLength(1);
    expect(await registro(evento.id)).toBe(1);
  });

  it('la prima prova dell’iscrizione nasce con il testo letto e non si raddoppia', async () => {
    const evento = await creaEvento({
      ...CHE_REGISTRA,
      recordingDestination: 'REGISTRANTS',
    });
    const iscrizione = await iscrittoDa(evento.id);
    const corpo = {
      accessToken: iscrizione.accessToken,
      recordingConsent: true,
      recordingConsentDestination: 'PUBLIC',
    };

    await entra(evento.slug, corpo);
    await entra(evento.slug, corpo);

    const [prova, ...altre] = await prove(evento.id);
    expect(altre).toEqual([]);
    expect(prova).toMatchObject({
      destination: 'PUBLIC',
      textVersion: VERSIONE_TESTO_REGISTRAZIONE,
    });
  });
});

describe('la replica di un consenso gia dato', () => {
  const CON_TRACCE = { ...CHE_REGISTRA, multitrackRecordingEnabled: true };

  it('un ritiro dalla pagina dei propri dati resta tale al rientro nella stessa visita', async () => {
    const evento = await creaEvento(CON_TRACCE);
    const iscrizione = await iscrittoDa(evento.id);
    const primo = await entra(evento.slug, {
      accessToken: iscrizione.accessToken,
      recordingConsent: true,
      recordingConsentDestination: null,
      multitrackConsent: true,
    });
    expect(primo.consentsInForce).toEqual({ recording: true, transcription: true });
    await ritiraConsensi(evento.id, [], { registrazione: true }, new Date(), {
      iscrizioni: [iscrizione.id],
      origine: 'self-service',
    });
    const [ritirata] = await prove(evento.id);
    const [ritirataTraccia] = await tracce(evento.id);

    const rientro = await entra(evento.slug, {
      accessToken: iscrizione.accessToken,
      consentReplay: { recording: true, multitrack: true, roomTokens: [primo.jwt] },
    });

    expect(rientro.voiceExcluded).toBe(true);
    expect(rientro.consentsRecorded).toEqual({ recording: false, multitrack: false });
    expect(rientro.consentsInForce).toEqual({ recording: false, transcription: false });
    expect(await prove(evento.id)).toEqual([ritirata]);
    expect(await tracce(evento.id)).toEqual([ritirataTraccia]);
    expect(await registro(evento.id)).toBe(0);
  });

  it('solo un clic ridà il consenso ritirato', async () => {
    const evento = await creaEvento(CHE_REGISTRA);
    const iscrizione = await iscrittoDa(evento.id);
    await provaEsistente(evento.id, iscrizione.id, {
      destination: null,
      withdrawnAt: new Date('2026-11-02T10:00:00Z'),
    });

    const risposta = await entra(evento.slug, {
      accessToken: iscrizione.accessToken,
      recordingConsent: true,
      recordingConsentDestination: null,
    });

    expect(risposta.voiceExcluded).toBe(false);
    expect((await prove(evento.id))[0]!.withdrawnAt).toBeNull();
    expect(await registro(evento.id)).toBe(1);
  });

  it('l ospite che rientra porta sul posto nuovo la prova di prima, con la sua data', async () => {
    const evento = await creaEvento(CON_TRACCE);
    const primo = await entra(evento.slug, {
      guestName: 'Ospite',
      recordingConsent: true,
      recordingConsentDestination: null,
      multitrackConsent: true,
    });
    const [provaPrima] = await prove(evento.id);

    const rientro = await entra(evento.slug, {
      guestName: 'Ospite',
      consentReplay: { recording: true, multitrack: true, roomTokens: [primo.jwt] },
    });

    expect(rientro.voiceExcluded).toBe(false);
    expect(rientro.consentsInForce).toEqual({ recording: true, transcription: true });
    const nuova = await prisma.recordingConsent.findFirstOrThrow({
      where: { eventId: evento.id, jitsiUserId: posto(rientro.jwt) },
    });
    expect(nuova.consentedAt).toEqual(provaPrima!.consentedAt);
    expect(nuova.destination).toBe(provaPrima!.destination);
    const traccia = await prisma.multitrackConsent.findFirstOrThrow({
      where: { eventId: evento.id, jitsiUserId: posto(rientro.jwt) },
    });
    expect(traccia.textVersion).toBe(2);
    expect((await consensoTrascrizione(evento.id, posto(rientro.jwt), 2)).dato).toBe(
      true
    );
    expect(await registro(evento.id)).toBe(0);
  });

  it('dopo il ritiro la replica dell ospite non crea e non fa rivivere niente', async () => {
    const evento = await creaEvento(CON_TRACCE);
    const primo = await entra(evento.slug, {
      guestName: 'Ospite',
      recordingConsent: true,
      recordingConsentDestination: null,
      multitrackConsent: true,
    });
    await ritiraConsensi(evento.id, [posto(primo.jwt)], { registrazione: true });

    const rientro = await entra(evento.slug, {
      guestName: 'Ospite',
      consentReplay: { recording: true, multitrack: true, roomTokens: [primo.jwt] },
    });

    expect(rientro.voiceExcluded).toBe(true);
    expect(rientro.consentsInForce).toEqual({ recording: false, transcription: false });
    expect(await prove(evento.id)).toHaveLength(1);
    expect((await prove(evento.id))[0]!.withdrawnAt).not.toBeNull();
    expect(await tracce(evento.id)).toHaveLength(1);
    expect((await tracce(evento.id))[0]!.withdrawnAt).not.toBeNull();
  });

  it('il token di un altro evento non prova niente', async () => {
    const altro = await creaEvento(CON_TRACCE);
    const dAltrove = await entra(altro.slug, {
      guestName: 'Ospite',
      recordingConsent: true,
      recordingConsentDestination: null,
    });
    const evento = await creaEvento(CON_TRACCE);

    const risposta = await entra(evento.slug, {
      guestName: 'Ospite',
      consentReplay: { recording: true, roomTokens: [dAltrove.jwt] },
    });

    expect(risposta.voiceExcluded).toBe(true);
    expect(await prove(evento.id)).toEqual([]);
  });
});

describe('le prove senza iscrizione', () => {
  it('chi conduce col suo account riporta la trascrizione e dal secondo ingresso la ritira tutta', async () => {
    const evento = await creaEvento({ multitrackRecordingEnabled: true });
    const account = await entraCome('ADMIN');
    const primo = await entra(evento.slug, {
      moderatorToken: evento.moderatorToken,
      multitrackConsent: true,
    });
    expect(primo.consentsInForce.transcription).toBe(true);

    // Un'altra visita della pagina: nessun token della sala di prima.
    const secondo = await entra(evento.slug, {
      moderatorToken: evento.moderatorToken,
      consentReplay: { multitrack: true },
    });
    expect(secondo.consentsInForce.transcription).toBe(true);
    const posti = [posto(primo.jwt), posto(secondo.jwt)];
    expect(new Set(posti).size).toBe(2);
    expect(await tracce(evento.id)).toMatchObject([
      { staffAccountId: account.id },
      { staffAccountId: account.id },
    ]);
    await prisma.captionSegment.createMany({
      data: posti.map((seatId, i) => ({
        eventId: evento.id,
        messageId: `frase-${i}`,
        endpointId: `ep-${i}`,
        seatId,
        speakerName: encryptPII('Persona dello staff'),
        text: encryptPII('Una frase'),
        startedAt: new Date(),
        endedAt: new Date(),
      })),
    });

    const esito = await ritiraConsensi(evento.id, [posti[1]!], { registrazione: false });

    expect(esito).toEqual({ registrazione: false, trascrizione: true });
    expect((await tracce(evento.id)).every((t) => t.withdrawnAt)).toBe(true);
    expect(await prisma.captionSegment.count({ where: { text: { not: null } } })).toBe(0);
  });

  it('senza prova sull’account la replica della trascrizione non crea niente', async () => {
    const evento = await creaEvento({ multitrackRecordingEnabled: true });
    await entraCome('ADMIN');

    const risposta = await entra(evento.slug, {
      moderatorToken: evento.moderatorToken,
      consentReplay: { multitrack: true },
    });

    expect(risposta.consentsInForce.transcription).toBe(false);
    expect(await tracce(evento.id)).toEqual([]);
  });

  it('un ospite lascia una riga per ingresso, con il testo letto', async () => {
    const evento = await creaEvento({ ...CHE_REGISTRA, recordingDestination: 'PUBLIC' });

    await entra(evento.slug, { guestName: 'Ospite', recordingConsent: true });
    await entra(evento.slug, {
      guestName: 'Ospite',
      recordingConsent: true,
      recordingConsentDestination: 'PUBLIC',
    });

    const righe = await prove(evento.id);
    expect(righe).toHaveLength(2);
    expect(righe.map((r) => r.destination)).toEqual(['PUBLIC', 'PUBLIC']);
  });

  it("chi conduce dal link nominale e' nel video senza lasciare una prova della registrazione", async () => {
    const evento = await creaEvento({
      ...CHE_REGISTRA,
      recordingDestination: 'REGISTRANTS',
    });
    const concessione = await prisma.eventModerator.create({
      data: {
        eventId: evento.id,
        token: randomUUID(),
        name: encryptPII('Relatore 1'),
        role: 'SPEAKER',
      },
    });

    const risposta = await entra(evento.slug, {
      moderatorToken: concessione.token,
      recordingConsent: true,
      recordingConsentDestination: 'REGISTRANTS',
    });

    expect(risposta.voiceExcluded).toBe(false);
    expect(
      (
        JSON.parse(Buffer.from(risposta.jwt.split('.')[1]!, 'base64url').toString()) as {
          context: { user: { paInVideo?: boolean } };
        }
      ).context.user.paInVideo
    ).toBe(true);
    expect(await prove(evento.id)).toEqual([]);
  });

  it('la prova della trascrizione di una concessione porta il legame e l’impronta dell’indirizzo', async () => {
    const evento = await creaEvento({
      ...CHE_REGISTRA,
      multitrackRecordingEnabled: true,
      recordingDestination: 'REGISTRANTS',
    });
    const indirizzo = `${randomUUID()}@example.org`;
    const concessione = await prisma.eventModerator.create({
      data: {
        eventId: evento.id,
        token: randomUUID(),
        name: encryptPII('Relatore 1'),
        email: encryptPII(indirizzo),
        emailHash: hashEmail(indirizzo),
        role: 'SPEAKER',
      },
    });

    await entra(evento.slug, {
      moderatorToken: concessione.token,
      recordingConsent: true,
      recordingConsentDestination: 'REGISTRANTS',
      multitrackConsent: true,
    });

    const legami = { eventModeratorId: concessione.id, emailHash: hashEmail(indirizzo) };
    expect(await prove(evento.id)).toEqual([]);
    expect(
      await prisma.multitrackConsent.findMany({ where: { eventId: evento.id } })
    ).toMatchObject([legami]);
  });
});

describe("dove chi partecipa non entra mai nel video ('esclusi')", () => {
  beforeEach(() => vi.stubEnv('RECORDING_PARTICIPANT_VOICE', ''));

  it("la trascrizione data all'iscrizione toglie il segno, senza consenso alla registrazione", async () => {
    const evento = await creaEvento({
      ...CHE_REGISTRA,
      multitrackRecordingEnabled: true,
    });
    const iscrizione = await iscrittoDa(evento.id);
    await prisma.registration.update({
      where: { id: iscrizione.id },
      data: { consentMultitrack: true, consentMultitrackVersion: 2 },
    });

    const risposta = await entra(evento.slug, { accessToken: iscrizione.accessToken });

    expect(risposta.voiceExcluded).toBe(false);
    expect(await prove(evento.id)).toEqual([]);
  });

  it('senza la trascrizione resta fuori, e un consenso alla registrazione non lascia una prova', async () => {
    const evento = await creaEvento({
      ...CHE_REGISTRA,
      multitrackRecordingEnabled: true,
    });
    const iscrizione = await iscrittoDa(evento.id);

    const risposta = await entra(evento.slug, {
      accessToken: iscrizione.accessToken,
      recordingConsent: true,
    });

    expect(risposta.voiceExcluded).toBe(true);
    expect(risposta.consentsRecorded.recording).toBe(false);
    expect(await prove(evento.id)).toEqual([]);
    expect(await tracce(evento.id)).toEqual([]);
  });

  it('la trascrizione data entrando vale da sola, con la sua prova', async () => {
    const evento = await creaEvento({
      ...CHE_REGISTRA,
      multitrackRecordingEnabled: true,
    });
    const iscrizione = await iscrittoDa(evento.id);

    const risposta = await entra(evento.slug, {
      accessToken: iscrizione.accessToken,
      multitrackConsent: true,
    });

    expect(risposta.voiceExcluded).toBe(false);
    expect(risposta.consentsRecorded.multitrack).toBe(true);
    expect(await tracce(evento.id)).toHaveLength(1);
  });
});

describe("dove chi partecipa puo' comparire nel video ('visibili')", () => {
  beforeEach(() => vi.stubEnv('RECORDING_VOICE_EXCLUSION', ''));

  it('un consenso dato sul testo per la sola voce non copre, e ridato si aggiorna al testo che lo dice', async () => {
    const evento = await creaEvento({
      ...CHE_REGISTRA,
      recordingDestination: 'REGISTRANTS',
    });
    const iscrizione = await iscrittoDa(evento.id);
    await provaEsistente(evento.id, iscrizione.id, {
      destination: 'REGISTRANTS',
      textVersion: 2,
    });

    const senza = (await entra(evento.slug, {
      accessToken: iscrizione.accessToken,
    })) as RispostaToken & {
      listenOnly: boolean;
    };
    expect(senza.listenOnly).toBe(true);
    expect(senza.consentsInForce.recording).toBe(false);

    const ridato = (await entra(evento.slug, {
      accessToken: iscrizione.accessToken,
      recordingConsent: true,
      recordingConsentDestination: 'REGISTRANTS',
    })) as RispostaToken & { listenOnly: boolean };
    expect(ridato.listenOnly).toBe(false);
    const [prova, ...altre] = await prove(evento.id);
    expect(altre).toEqual([]);
    expect(prova!.textVersion).toBe(1);
    expect(prova!.earlierPeriods as unknown as PeriodoConsenso[]).toMatchObject([
      { destination: 'REGISTRANTS', textVersion: 2 },
    ]);

    const dopo = (await entra(evento.slug, {
      accessToken: iscrizione.accessToken,
    })) as RispostaToken & {
      listenOnly: boolean;
    };
    expect(dopo.listenOnly).toBe(false);
  });

  it("senza destinazione la prova dice comunque su quale testo e' stata data", async () => {
    const evento = await creaEvento({ ...CHE_REGISTRA, recordingDestination: null });
    const risposta = await entra(evento.slug, {
      guestName: 'Ospite',
      recordingConsent: true,
      recordingConsentDestination: null,
    });
    expect(risposta.consentsRecorded.recording).toBe(true);
    const [prova] = await prove(evento.id);
    expect(prova).toMatchObject({ destination: null, textVersion: 1 });
  });
});
