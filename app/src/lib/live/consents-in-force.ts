// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import {
  versioneConsensoTrascrizione,
  type EventoConsensoVoce,
} from '@/lib/ai/voice-consent';
import { consensoTrascrizione, iscrizioneDelPosto } from '@/lib/captions/room';
import { prisma } from '@/lib/db';
import { consensoCopre, type Destinazione } from '@/lib/recording/destination';
import { getSettings } from '@/lib/settings';

/**
 * I consensi che valgono adesso per chi e' in sala, con le stesse regole del
 * token della conferenza e del registratore: la risposta del token li porta a ogni
 * ingresso, e `POST /api/events/[param]/consents/in-force` li rilegge a sala aperta,
 * perche' cambiano senza un token nuovo. Un ritiro dalla pagina dei propri dati
 * toglie la prova; i sottotitoli accesi dal vivo alzano la versione del testo
 * richiesta (`versioneConsensoTrascrizione`).
 */
export interface ConsensiInVigore {
  recording: boolean;
  transcription: boolean;
}

export type EventoConsensiInVigore = EventoConsensoVoce & {
  id: string;
  recordingEnabled: boolean;
};

export async function trascrizioneInVigore(
  event: EventoConsensoVoce & { id: string },
  posto: string
): Promise<boolean> {
  const versione = versioneConsensoTrascrizione(event, await getSettings());
  const { dato } = await consensoTrascrizione(event.id, posto, versione);
  return dato;
}

/**
 * Il consenso alla registrazione di un'iscrizione: dato nel modulo, o in sala con
 * la prova legata all'iscrizione. Uno ritirato non vale, e nemmeno uno dato su un
 * testo che non copre quello in vigore.
 */
export async function registrazioneDellIscrizione(
  event: { id: string; recordingEnabled: boolean },
  iscrizione: {
    id: string;
    consentRecording: boolean | null;
    consentRecordingWithdrawnAt: Date | null;
    consentRecordingDestination: Destinazione;
  },
  destinazione: Destinazione
): Promise<boolean> {
  if (
    iscrizione.consentRecording === true &&
    !iscrizione.consentRecordingWithdrawnAt &&
    consensoCopre(iscrizione.consentRecordingDestination, destinazione)
  ) {
    return true;
  }
  if (!event.recordingEnabled) return false;
  const prova = await prisma.recordingConsent.findFirst({
    where: { eventId: event.id, registrationId: iscrizione.id, withdrawnAt: null },
    select: { destination: true },
  });
  return prova !== null && consensoCopre(prova.destination, destinazione);
}

/**
 * Lo stato a sala aperta, dai posti provati dai token della visita, dal piu'
 * vecchio al piu' recente. L'ultimo e' il posto della conferenza in corso: la
 * trascrizione si legge su quello, come fa il token. Chi non e' iscritto ha un
 * posto nuovo a ogni ingresso, quindi la registrazione vale se resta una prova
 * non ritirata su uno dei posti.
 */
export async function consensiInVigoreDeiPosti(
  event: EventoConsensiInVigore,
  posti: readonly string[],
  destinazione: Destinazione
): Promise<ConsensiInVigore> {
  const posto = posti.at(-1);
  if (!posto) return { recording: false, transcription: false };
  const [recording, transcription] = await Promise.all([
    registrazioneInVigore(event, posto, posti, destinazione),
    trascrizioneInVigore(event, posto),
  ]);
  return { recording, transcription };
}

async function registrazioneInVigore(
  event: EventoConsensiInVigore,
  posto: string,
  posti: readonly string[],
  destinazione: Destinazione
): Promise<boolean> {
  const iscrizioneId = iscrizioneDelPosto(posto);
  if (iscrizioneId) {
    const iscrizione = await prisma.registration.findFirst({
      where: { id: iscrizioneId, eventId: event.id },
      select: {
        id: true,
        consentRecording: true,
        consentRecordingWithdrawnAt: true,
        consentRecordingDestination: true,
      },
    });
    return !!iscrizione && registrazioneDellIscrizione(event, iscrizione, destinazione);
  }
  if (!event.recordingEnabled) return false;
  const prove = await prisma.recordingConsent.findMany({
    where: { eventId: event.id, jitsiUserId: { in: [...posti] }, withdrawnAt: null },
    select: { destination: true },
  });
  return prove.some((p) => consensoCopre(p.destination, destinazione));
}
