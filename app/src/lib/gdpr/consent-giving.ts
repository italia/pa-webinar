// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Un consenso dato di nuovo dalla pagina dei propri dati (POST /api/gdpr/consents),
 * senza entrare in sala: la registrazione, la trascrizione dei propri interventi
 * e le comunicazioni future di un'iscrizione.
 *
 * La prova e' la stessa di un consenso dato in sala (lib/live/consent-withdrawal
 * per il ritiro, api/events/[param]/jitsi/token per il clic): per la
 * registrazione la prova dell'iscrizione torna valida con l'ora nuova e il periodo
 * di prima resta in `earlierPeriods`; per la trascrizione si aggiunge una prova
 * accanto a quella ritirata. Ogni consenso dato scrive `CONSENT_RECORDED` nel
 * registro GDPR dell'evento, con `source: self-service` e senza dati personali.
 * Il posto della prova non e' un ingresso in sala: e' quello dell'iscrizione con
 * il suffisso `mydata` (`postoDaIMieiDati`), che nessuna conferenza usa, e da cui
 * l'elenco delle prove sa che il consenso e' stato dato da qui.
 *
 * Quando si puo' dare. Registrazione e trascrizione solo finche' l'evento chiede
 * quel consenso a chi si iscrive (la regola del modulo, lib/registration/consents)
 * e accetta ancora iscrizioni (`isEventOpenForRegistration`): prima dell'inizio e
 * mentre e' in diretta. Il consenso vale dal prossimo ingresso in sala e non tocca
 * cio' che e' gia' stato registrato; a evento concluso non ci sarebbe un ingresso,
 * e un consenso dato dopo non deve rimettere in gioco tracce o frasi di un periodo
 * in cui la persona era fuori. Dove la voce di chi non acconsente resta fuori dalla
 * registrazione, la trascrizione chiede prima il consenso alla registrazione, come
 * in sala. Le comunicazioni future non riguardano l'evento: tornano finche'
 * l'evento e l'installazione propongono la rubrica (`rubricaProposta`), come la
 * conferma di una spunta in attesa (lib/persons/spunta-in-attesa).
 */
import type { Prisma } from '@prisma/client';

import { versioneConsensoTrascrizione } from '@/lib/ai/voice-consent';
import { captionsTranscriptActive } from '@/lib/captions/availability';
import { bloccaTrascrizioneEvento } from '@/lib/captions/transcript';
import { origineDelPosto, postoDaIMieiDati } from '@/lib/gdpr/consent-proofs';
import { prisma } from '@/lib/db';
import { isEventOpenForRegistration } from '@/lib/events/visibility';
import {
  regolaConsenso,
  testoConsensoEvento,
  type VoceNelVideo,
} from '@/lib/live/consent-rule';
import { rubricaProposta } from '@/lib/persons/address-book';
import { ridaiComunicazioni } from '@/lib/persons/spunta-in-attesa';
import { recordingAvailableFor, voceNelVideo } from '@/lib/recording/availability';
import {
  consensoCopre,
  destinazioneDelTesto,
  testoInVigore,
  testoLetto,
  VERSIONE_TESTO_REGISTRAZIONE,
  type Destinazione,
  type PeriodoConsenso,
} from '@/lib/recording/destination';
import {
  chiaveConsensoTrascrizione,
  consensiRichiesti,
  traccePerPersonaConservate,
  trascrizioneDalVideo,
  VERSIONE_TESTO_TRASCRIZIONE,
} from '@/lib/registration/consents';
import { getSettings } from '@/lib/settings';

export type ConsensoDaDare = 'recording' | 'transcription' | 'futureCommunications';

/** I campi dell'evento che decidono cosa si puo' dare: li legge anche l'export. */
export const CAMPI_EVENTO_CONSENSI = {
  id: true,
  status: true,
  eventType: true,
  endsAt: true,
  recordingEnabled: true,
  multitrackRecordingEnabled: true,
  aiTranscriptEnabled: true,
  captionsTranscriptEnabled: true,
  liveCaptionsEnabled: true,
  participantsCanUnmute: true,
  participantsCanStartVideo: true,
  participantsCanShareScreen: true,
  recordingDestination: true,
  recordingConsentText: true,
  retainParticipantTracks: true,
  offerAddressBook: true,
} as const satisfies Prisma.EventSelect;

export type EventoConsensi = Prisma.EventGetPayload<{
  select: typeof CAMPI_EVENTO_CONSENSI;
}>;

interface SitoConsensi {
  liveCaptionsEnabled?: boolean | null;
  aiPipelineEnabled?: boolean | null;
  addressBookEnabled?: boolean | null;
}

/**
 * Cosa la pagina puo' offrire di dare, con il testo da mostrare: lo stesso della
 * casella del modulo e della sala. `null`: quel consenso oggi non si da' da qui.
 */
export interface OffertaConsensi {
  recording: {
    /** La destinazione del testo in vigore: la pagina la rimanda con il consenso. */
    destination: Destinazione;
    voice: VoceNelVideo;
    /** Il testo scelto per l'evento, che precede quello della casella. */
    eventText: string | null;
  } | null;
  transcription: {
    text: ReturnType<typeof chiaveConsensoTrascrizione>;
    voice: VoceNelVideo;
    /** Senza il consenso alla registrazione la voce resta fuori: va dato prima. */
    needsRecording: boolean;
  } | null;
  futureCommunications: boolean;
}

/** Le regole dell'evento per i consensi da dare, con i fatti dell'installazione. */
function regole(evento: EventoConsensi, sito: SitoConsensi) {
  const disponibile = recordingAvailableFor(evento);
  const voce = voceNelVideo();
  // La regola della rotta d'iscrizione: dove la scheda dice che non si registra
  // niente, il consenso alla registrazione non si chiede.
  const richiesti = consensiRichiesti({
    ...evento,
    recordingEnabled: evento.recordingEnabled && disponibile,
    multitrackRecordingEnabled: evento.multitrackRecordingEnabled && disponibile,
    captionsTranscript: captionsTranscriptActive(evento, sito),
    trascrizioneVideo: trascrizioneDalVideo(evento, sito, disponibile, voce),
  });
  const regola = regolaConsenso(evento, disponibile, voce);
  return {
    voce,
    richiesti,
    aperto: isEventOpenForRegistration(evento),
    destinazione: destinazioneDelTesto(evento.recordingDestination, voce),
    // Senza consenso alla registrazione la voce non entra nel token: la
    // trascrizione non avrebbe niente da trascrivere (`conVoce` nel token).
    serveRegistrazione: regola.registra && !regola.soloAscolto,
  };
}

export function offertaConsensi(
  evento: EventoConsensi,
  sito: SitoConsensi
): OffertaConsensi {
  const r = regole(evento, sito);
  return {
    recording:
      r.aperto && r.richiesti.registrazione
        ? {
            destination: r.destinazione,
            voice: r.voce,
            eventText: testoConsensoEvento(evento.recordingConsentText, r.voce),
          }
        : null,
    transcription:
      r.aperto && r.richiesti.tracce
        ? {
            text: chiaveConsensoTrascrizione(traccePerPersonaConservate(evento, sito)),
            voice: r.voce,
            needsRecording: r.serveRegistrazione,
          }
        : null,
    futureCommunications: rubricaProposta(evento, sito),
  };
}

export type EsitoConsensoDato =
  | 'dato'
  /** Il consenso vale gia': non si scrive niente. */
  | 'gia'
  /** L'iscrizione non c'e', o non e' di questo indirizzo. */
  | 'nonTrovata'
  /** L'evento oggi non chiede questo consenso, o non accetta piu' iscrizioni. */
  | 'nonOfferto'
  /** La trascrizione chiede prima il consenso alla registrazione. */
  | 'serveRegistrazione'
  /** Il testo letto non e' quello in vigore: la pagina va ricaricata. */
  | 'testoCambiato';

const CAMPI_ISCRIZIONE = {
  id: true,
  eventId: true,
  displayName: true,
  consentRecording: true,
  consentRecordingWithdrawnAt: true,
  consentRecordingDestination: true,
  consentMultitrack: true,
  consentMultitrackVersion: true,
  consentMultitrackWithdrawnAt: true,
  consentFutureCommunications: true,
  consentFutureCommunicationsWithdrawnAt: true,
  event: { select: CAMPI_EVENTO_CONSENSI },
} as const satisfies Prisma.RegistrationSelect;

type IscrizioneConsensi = Prisma.RegistrationGetPayload<{
  select: typeof CAMPI_ISCRIZIONE;
}>;

/** Il consenso alla registrazione dell'iscrizione vale per il testo in vigore. */
async function registrazioneInVigore(
  tx: Prisma.TransactionClient,
  iscrizione: IscrizioneConsensi,
  destinazione: Destinazione
): Promise<boolean> {
  if (
    iscrizione.consentRecording === true &&
    !iscrizione.consentRecordingWithdrawnAt &&
    consensoCopre(iscrizione.consentRecordingDestination, destinazione)
  ) {
    return true;
  }
  const prova = await tx.recordingConsent.findFirst({
    where: {
      eventId: iscrizione.eventId,
      registrationId: iscrizione.id,
      withdrawnAt: null,
    },
    select: { destination: true },
  });
  return prova !== null && consensoCopre(prova.destination, destinazione);
}

async function registro(
  tx: Prisma.TransactionClient,
  eventId: string,
  dettagli: Record<string, unknown>
): Promise<void> {
  await tx.gdprAuditLog.create({
    data: {
      eventId,
      action: 'CONSENT_RECORDED',
      recordCount: 1,
      details: JSON.stringify({ source: 'self-service', ...dettagli }),
    },
  });
}

async function daiRegistrazione(
  tx: Prisma.TransactionClient,
  iscrizione: IscrizioneConsensi,
  destinazione: Destinazione,
  letta: Destinazione | undefined,
  locale: string | null
): Promise<EsitoConsensoDato> {
  if (await registrazioneInVigore(tx, iscrizione, destinazione)) return 'gia';
  const destinazioneLetta = testoLetto(letta, destinazione);
  const testo = {
    destination: destinazioneLetta,
    textVersion: destinazioneLetta ? VERSIONE_TESTO_REGISTRAZIONE : null,
  };
  // La prova dell'iscrizione e' una sola (vincolo unico): torna valida con l'ora
  // nuova, e il periodo di prima resta nella prova, come per il consenso ridato
  // in sala. Se esiste e non e' ritirata, non copriva il testo in vigore: il suo
  // periodo resta come sostituito.
  const esistente = await tx.recordingConsent.findFirst({
    where: { eventId: iscrizione.eventId, registrationId: iscrizione.id },
    select: {
      jitsiUserId: true,
      consentedAt: true,
      withdrawnAt: true,
      earlierPeriods: true,
      destination: true,
      textVersion: true,
    },
  });
  if (esistente) {
    // Il `where` non trova piu' la riga se un consenso dato in sala nello stesso
    // momento l'ha gia' aggiornata: allora il consenso vale gia'.
    const { count } = await tx.recordingConsent.updateMany({
      where: {
        eventId: iscrizione.eventId,
        registrationId: iscrizione.id,
        ...(esistente.withdrawnAt
          ? { withdrawnAt: { not: null } }
          : { withdrawnAt: null, destination: esistente.destination }),
      },
      data: {
        withdrawnAt: null,
        consentedAt: new Date(),
        earlierPeriods: [
          ...(Array.isArray(esistente.earlierPeriods) ? esistente.earlierPeriods : []),
          {
            consentedAt: esistente.consentedAt.toISOString(),
            withdrawnAt: esistente.withdrawnAt?.toISOString() ?? null,
            destination: esistente.destination,
            textVersion: esistente.textVersion,
            // Un periodo dato da qui lo dice; senza, in sala.
            ...(origineDelPosto(esistente.jitsiUserId) === 'self-service' && {
              source: 'self-service' as const,
            }),
          } satisfies PeriodoConsenso,
        ],
        ...testo,
        // Il periodo in corso viene da qui: il posto lo dice all'elenco delle prove.
        jitsiUserId: postoDaIMieiDati(iscrizione.id),
        // Il nome dell'iscrizione, gia' cifrato: si copia com'e'.
        displayName: iscrizione.displayName,
        locale,
      },
    });
    if (count === 0) return 'gia';
  } else {
    // Due richieste insieme non raddoppiano la prova (vincolo unico).
    const { count } = await tx.recordingConsent.createMany({
      data: [
        {
          eventId: iscrizione.eventId,
          jitsiUserId: postoDaIMieiDati(iscrizione.id),
          displayName: iscrizione.displayName,
          registrationId: iscrizione.id,
          locale,
          ...testo,
        },
      ],
      skipDuplicates: true,
    });
    if (count === 0) return 'gia';
  }
  await registro(tx, iscrizione.eventId, {
    kind: 'recording',
    givenAgain: !!esistente?.withdrawnAt || !!iscrizione.consentRecordingWithdrawnAt,
    previousConsentedAt: esistente?.consentedAt.toISOString() ?? null,
    withdrawnAt: esistente?.withdrawnAt?.toISOString() ?? null,
    previousDestination: esistente?.destination ?? null,
    destination: testo.destination,
    textVersion: testo.textVersion,
  });
  return 'dato';
}

async function daiTrascrizione(
  tx: Prisma.TransactionClient,
  iscrizione: IscrizioneConsensi,
  sito: SitoConsensi,
  locale: string | null
): Promise<EsitoConsensoDato> {
  const versione = versioneConsensoTrascrizione(iscrizione.event, sito);
  const allIscrizione =
    iscrizione.consentMultitrack === true &&
    !iscrizione.consentMultitrackWithdrawnAt &&
    (iscrizione.consentMultitrackVersion ?? 1) >= versione;
  const prova = allIscrizione
    ? null
    : await tx.multitrackConsent.findFirst({
        where: {
          eventId: iscrizione.eventId,
          registrationId: iscrizione.id,
          textVersion: { gte: versione },
          withdrawnAt: null,
        },
        select: { id: true },
      });
  if (allIscrizione || prova) return 'gia';
  // Una prova nuova accanto a quelle ritirate, che restano come erano: la stessa
  // regola del consenso dato in sala.
  const ritirata = await tx.multitrackConsent.findFirst({
    where: {
      eventId: iscrizione.eventId,
      registrationId: iscrizione.id,
      withdrawnAt: { not: null },
    },
    select: { id: true },
  });
  await tx.multitrackConsent.create({
    data: {
      eventId: iscrizione.eventId,
      jitsiUserId: postoDaIMieiDati(iscrizione.id),
      displayName: iscrizione.displayName,
      registrationId: iscrizione.id,
      locale,
      textVersion: VERSIONE_TESTO_TRASCRIZIONE,
    },
  });
  await registro(tx, iscrizione.eventId, {
    kind: 'transcription',
    givenAgain: !!ritirata || !!iscrizione.consentMultitrackWithdrawnAt,
    textVersion: VERSIONE_TESTO_TRASCRIZIONE,
  });
  return 'dato';
}

/**
 * Da' di nuovo un consenso di un'iscrizione dell'indirizzo provato dal token.
 * `letta` e' la destinazione del testo mostrato per la registrazione, come nel
 * modulo d'iscrizione: se nel frattempo e' cambiata, non vale.
 */
export async function daiConsenso(
  emailHash: string,
  registrationId: string,
  consenso: ConsensoDaDare,
  { letta, locale = null }: { letta?: Destinazione; locale?: string | null } = {}
): Promise<EsitoConsensoDato> {
  const sito = await getSettings();
  if (consenso === 'futureCommunications') {
    const iscrizione = await prisma.registration.findFirst({
      where: { id: registrationId, emailHash },
      select: CAMPI_ISCRIZIONE,
    });
    if (!iscrizione) return 'nonTrovata';
    if (iscrizione.consentFutureCommunications) return 'gia';
    // Si ridanno solo dopo un ritiro: senza, la pagina non le mostra.
    if (!iscrizione.consentFutureCommunicationsWithdrawnAt) return 'nonOfferto';
    const esito = await ridaiComunicazioni(iscrizione.id);
    return esito === 'nonProposta' ? 'nonOfferto' : esito;
  }
  const prima = await prisma.registration.findFirst({
    where: { id: registrationId, emailHash },
    select: { eventId: true },
  });
  if (!prima) return 'nonTrovata';
  return prisma.$transaction(async (tx) => {
    // In fila con i ritiri, le cancellazioni e la pulizia dello stesso evento:
    // l'iscrizione si rilegge dopo il turno, e se nel frattempo e' stata
    // cancellata non c'e' piu' niente a cui legare la prova.
    await bloccaTrascrizioneEvento(tx, prima.eventId);
    const iscrizione = await tx.registration.findFirst({
      where: { id: registrationId, emailHash },
      select: CAMPI_ISCRIZIONE,
    });
    if (!iscrizione) return 'nonTrovata';
    const r = regole(iscrizione.event, sito);
    if (!r.aperto) return 'nonOfferto';
    if (consenso === 'recording') {
      if (!r.richiesti.registrazione) return 'nonOfferto';
      if (!testoInVigore(letta, r.destinazione)) return 'testoCambiato';
      return daiRegistrazione(tx, iscrizione, r.destinazione, letta, locale);
    }
    if (!r.richiesti.tracce) return 'nonOfferto';
    if (
      r.serveRegistrazione &&
      !(await registrazioneInVigore(tx, iscrizione, r.destinazione))
    ) {
      return 'serveRegistrazione';
    }
    return daiTrascrizione(tx, iscrizione, sito, locale);
  });
}
