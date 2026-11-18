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
 * mentre e' in diretta. La registrazione vale dal prossimo ingresso in sala (il
 * token in uso resta com'e'); la trascrizione dove il server la legge mentre la
 * persona parla (le frasi dei sottotitoli) e comunque dal prossimo ingresso. Il
 * video gia' registrato non cambia. A evento concluso non ci sarebbe un ingresso,
 * e il consenso alla trascrizione si legge per iscrizione, non per periodo
 * (lib/captions/room): dato dopo, rimetterebbe nella trascrizione le tracce di un
 * periodo in cui la persona l'aveva ritirato e che la pulizia non ha ancora tolto.
 * Durante l'evento succede lo stesso, come per il consenso ridato in sala.
 * Dove la voce di chi non acconsente resta fuori dalla
 * registrazione, la trascrizione chiede prima il consenso alla registrazione, come
 * in sala; dove chi partecipa non entra mai nel video ('esclusi') il consenso alla
 * registrazione non si offre, e la trascrizione vale da sola. Il consenso alla
 * registrazione vale per il testo letto, destinazione e versione (`provaCopre`),
 * come nel modulo d'iscrizione. Le comunicazioni future non riguardano l'evento: tornano finche'
 * l'evento e l'installazione propongono la rubrica (`rubricaProposta`), come la
 * conferma di una spunta in attesa (lib/persons/spunta-in-attesa).
 */
import type { Prisma } from '@prisma/client';

import { versioneConsensoTrascrizione } from '@/lib/ai/voice-consent';
import { captionsTranscriptActive } from '@/lib/captions/availability';
import { bloccaTrascrizioneEvento } from '@/lib/captions/transcript';
import { prisma } from '@/lib/db';
import { TIMEOUT_DOPO_PULIZIA_MS } from '@/lib/gdpr/cleanup-selection';
import { periodoSostituito, postoDaIMieiDati } from '@/lib/gdpr/consent-proofs';
import { isEventOpenForRegistration } from '@/lib/events/visibility';
import {
  regolaConsenso,
  testoConsensoEvento,
  voceDi,
  type PartecipantiNelVideo,
  type VoceNelVideo,
} from '@/lib/live/consent-rule';
import { rubricaProposta } from '@/lib/persons/address-book';
import { ridaiComunicazioni } from '@/lib/persons/spunta-in-attesa';
import { partecipantiNelVideo, recordingAvailableFor } from '@/lib/recording/availability';
import {
  destinazioneDelTesto,
  provaCopre,
  testoInVigore,
  testoLetto,
  versioneCopre,
  versioneDellaProva,
  versioneLetta,
  type Destinazione,
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
    /** Come compaiono nel video i partecipanti: sceglie il testo della casella. */
    participants: PartecipantiNelVideo;
    /** La versione del testo della casella: la pagina la rimanda con il consenso. */
    textVersion: number;
    /** Il testo scelto per l'evento, che precede quello della casella. */
    eventText: string | null;
    /** Un consenso dato vale per il testo in vigore. Uno dato su un testo che non
     *  lo copre resta dato, ma non vale: si da' di nuovo. */
    inForce: boolean;
  } | null;
  transcription: {
    /** Il testo della casella: la pagina lo rimanda con il consenso. */
    text: ReturnType<typeof chiaveConsensoTrascrizione>;
    voice: VoceNelVideo;
    /** Senza il consenso alla registrazione la voce resta fuori: va dato prima. */
    needsRecording: boolean;
    /** Come per la registrazione, con la versione del testo richiesta. */
    inForce: boolean;
  } | null;
  futureCommunications: boolean;
}

/** Cio' che serve a dire se i consensi di un'iscrizione valgono adesso. */
export interface ConsensiDellIscrizione {
  consentRecording: boolean | null;
  consentRecordingWithdrawnAt: Date | null;
  consentRecordingDestination: Destinazione;
  consentRecordingVersion: number | null;
  consentMultitrack: boolean | null;
  consentMultitrackVersion: number | null;
  consentMultitrackWithdrawnAt: Date | null;
  /** Le prove di sala dell'iscrizione: il ritiro e la versione del testo, per la
   *  registrazione anche la destinazione. */
  recordingConsents: readonly {
    withdrawnAt: Date | null;
    destination: Destinazione;
    textVersion: number | null;
  }[];
  multitrackConsents: readonly { withdrawnAt: Date | null; textVersion: number }[];
}

/**
 * I consensi dell'iscrizione che valgono per il testo in vigore, con le regole del
 * token della sala (lib/live/consents-in-force) e della trascrizione
 * (lib/captions/room): dati all'iscrizione o in sala, non ritirati, su un testo che
 * copre la destinazione del video e cio' che il video riprende (`provaCopre`), e
 * con la versione richiesta.
 */
export function consensiInVigore(
  c: ConsensiDellIscrizione,
  destinazione: Destinazione,
  versioneTrascrizione: number,
  partecipanti: PartecipantiNelVideo
): { recording: boolean; transcription: boolean } {
  return {
    recording:
      (c.consentRecording === true &&
        !c.consentRecordingWithdrawnAt &&
        provaCopre(
          {
            destination: c.consentRecordingDestination,
            textVersion: c.consentRecordingVersion,
          },
          destinazione,
          partecipanti
        )) ||
      c.recordingConsents.some(
        (p) => !p.withdrawnAt && provaCopre(p, destinazione, partecipanti)
      ),
    transcription:
      (c.consentMultitrack === true &&
        !c.consentMultitrackWithdrawnAt &&
        (c.consentMultitrackVersion ?? 1) >= versioneTrascrizione) ||
      c.multitrackConsents.some(
        (p) => !p.withdrawnAt && p.textVersion >= versioneTrascrizione
      ),
  };
}

/** Le regole dell'evento per i consensi da dare, con i fatti dell'installazione. */
function regole(evento: EventoConsensi, sito: SitoConsensi) {
  const disponibile = recordingAvailableFor(evento);
  const partecipanti = partecipantiNelVideo();
  // La regola della rotta d'iscrizione: dove la scheda dice che non si registra
  // niente, il consenso alla registrazione non si chiede.
  const richiesti = consensiRichiesti(
    {
      ...evento,
      recordingEnabled: evento.recordingEnabled && disponibile,
      multitrackRecordingEnabled: evento.multitrackRecordingEnabled && disponibile,
      captionsTranscript: captionsTranscriptActive(evento, sito),
      trascrizioneVideo: trascrizioneDalVideo(evento, sito, disponibile, partecipanti),
    },
    partecipanti
  );
  const regola = regolaConsenso(evento, disponibile, partecipanti);
  return {
    partecipanti,
    voce: voceDi(partecipanti),
    richiesti,
    aperto: isEventOpenForRegistration(evento),
    destinazione: destinazioneDelTesto(evento.recordingDestination, partecipanti),
    // Senza consenso alla registrazione la voce non entra nel token: la
    // trascrizione non avrebbe niente da trascrivere (`conVoce` nel token). Dove
    // chi partecipa non entra mai nel video la voce la decide la trascrizione da
    // sola, come nella rotta d'iscrizione.
    serveRegistrazione: regola.registra && !regola.soloAscolto && !regola.voceDallaTrascrizione,
  };
}

export function offertaConsensi(
  evento: EventoConsensi,
  sito: SitoConsensi,
  iscrizione: ConsensiDellIscrizione
): OffertaConsensi {
  const r = regole(evento, sito);
  const vigore = consensiInVigore(
    iscrizione,
    r.destinazione,
    versioneConsensoTrascrizione(evento, sito),
    r.partecipanti
  );
  return {
    recording:
      r.aperto && r.richiesti.registrazione
        ? {
            destination: r.destinazione,
            voice: r.voce,
            participants: r.partecipanti,
            textVersion: versioneDellaProva(r.partecipanti),
            eventText: testoConsensoEvento(evento.recordingConsentText, r.partecipanti),
            inForce: vigore.recording,
          }
        : null,
    transcription:
      r.aperto && r.richiesti.tracce
        ? {
            text: chiaveConsensoTrascrizione(traccePerPersonaConservate(evento, sito)),
            voice: r.voce,
            needsRecording: r.serveRegistrazione,
            inForce: vigore.transcription,
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

/** Il testo che la pagina ha mostrato: per la registrazione la destinazione e la
 *  versione, per la trascrizione la casella (con la traccia che si cancella o che
 *  si conserva). */
export interface TestoLetto {
  destinazione?: Destinazione;
  versione?: number;
  trascrizione?: ReturnType<typeof chiaveConsensoTrascrizione>;
}

const CAMPI_ISCRIZIONE = {
  id: true,
  eventId: true,
  displayName: true,
  consentRecording: true,
  consentRecordingWithdrawnAt: true,
  consentRecordingDestination: true,
  consentRecordingVersion: true,
  consentMultitrack: true,
  consentMultitrackVersion: true,
  consentMultitrackWithdrawnAt: true,
  consentFutureCommunications: true,
  consentFutureCommunicationsWithdrawnAt: true,
  recordingConsents: { select: { withdrawnAt: true, destination: true, textVersion: true } },
  multitrackConsents: { select: { withdrawnAt: true, textVersion: true } },
  event: { select: CAMPI_EVENTO_CONSENSI },
} as const satisfies Prisma.RegistrationSelect;

type IscrizioneConsensi = Prisma.RegistrationGetPayload<{
  select: typeof CAMPI_ISCRIZIONE;
}>;

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
  letto: TestoLetto,
  partecipanti: PartecipantiNelVideo,
  locale: string | null
): Promise<EsitoConsensoDato> {
  // Il testo letto, destinazione e versione, come nel modulo d'iscrizione: la
  // versione si salva con o senza destinazione (`versioneLetta`).
  const testo = {
    destination: testoLetto(letto.destinazione, destinazione),
    textVersion: versioneLetta(letto.versione, partecipanti),
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
          : {
              withdrawnAt: null,
              destination: esistente.destination,
              textVersion: esistente.textVersion,
            }),
      },
      data: {
        withdrawnAt: null,
        consentedAt: new Date(),
        earlierPeriods: [
          ...(Array.isArray(esistente.earlierPeriods) ? esistente.earlierPeriods : []),
          periodoSostituito(esistente),
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
  locale: string | null
): Promise<EsitoConsensoDato> {
  // Una prova nuova accanto a quelle ritirate, che restano come erano: la stessa
  // regola del consenso dato in sala.
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
    givenAgain:
      iscrizione.multitrackConsents.some((p) => !!p.withdrawnAt) ||
      !!iscrizione.consentMultitrackWithdrawnAt,
    textVersion: VERSIONE_TESTO_TRASCRIZIONE,
  });
  return 'dato';
}

/**
 * Da' di nuovo un consenso di un'iscrizione dell'indirizzo provato dal token.
 * `letto` e' il testo che la pagina ha mostrato, come nel modulo d'iscrizione: se
 * nel frattempo e' cambiato, non vale.
 */
export async function daiConsenso(
  emailHash: string,
  registrationId: string,
  consenso: ConsensoDaDare,
  { letto = {}, locale = null }: { letto?: TestoLetto; locale?: string | null } = {}
): Promise<EsitoConsensoDato> {
  if (consenso === 'futureCommunications') {
    const iscrizione = await prisma.registration.findFirst({
      where: { id: registrationId, emailHash },
      select: {
        id: true,
        consentFutureCommunications: true,
        consentFutureCommunicationsWithdrawnAt: true,
      },
    });
    if (!iscrizione) return 'nonTrovata';
    if (iscrizione.consentFutureCommunications) return 'gia';
    // Si ridanno solo dopo un ritiro: senza, la pagina non le mostra.
    if (!iscrizione.consentFutureCommunicationsWithdrawnAt) return 'nonOfferto';
    const esito = await ridaiComunicazioni(iscrizione.id);
    return esito === 'nonProposta' ? 'nonOfferto' : esito;
  }
  const sito = await getSettings();
  const prima = await prisma.registration.findFirst({
    where: { id: registrationId, emailHash },
    select: { eventId: true },
  });
  if (!prima) return 'nonTrovata';
  return prisma.$transaction(
    async (tx) => {
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
      const vigore = consensiInVigore(
        iscrizione,
        r.destinazione,
        versioneConsensoTrascrizione(iscrizione.event, sito),
        r.partecipanti
      );
      if (consenso === 'recording') {
        if (!r.richiesti.registrazione) return 'nonOfferto';
        // La destinazione, e il testo: dove chi partecipa puo' comparire nel video
        // vale solo quello che lo dice (`versioneCopre`), come nel modulo.
        // Una pagina che non dice la versione e' di prima: rilegge.
        if (
          letto.versione === undefined ||
          !testoInVigore(letto.destinazione, r.destinazione) ||
          !versioneCopre(letto.versione, r.partecipanti)
        ) {
          return 'testoCambiato';
        }
        if (vigore.recording) return 'gia';
        return daiRegistrazione(tx, iscrizione, r.destinazione, letto, r.partecipanti, locale);
      }
      if (!r.richiesti.tracce) return 'nonOfferto';
      const testo = chiaveConsensoTrascrizione(
        traccePerPersonaConservate(iscrizione.event, sito)
      );
      if (letto.trascrizione !== testo) return 'testoCambiato';
      if (r.serveRegistrazione && !vigore.recording) return 'serveRegistrazione';
      if (vigore.transcription) return 'gia';
      return daiTrascrizione(tx, iscrizione, locale);
    },
    // Aspetta il suo turno come gli altri che prendono lo stesso blocco.
    { timeout: TIMEOUT_DOPO_PULIZIA_MS }
  );
}
