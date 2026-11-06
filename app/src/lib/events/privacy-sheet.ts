// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import type { Event, RecordingAudience, SiteSetting } from '@prisma/client';

import {
  captionsTranscriptActive,
  liveCaptionsAvailable,
} from '@/lib/captions/availability';
import { domandePubbliche } from '@/lib/events/post-event-sections';
import { tracceConfigurate } from '@/lib/live/capture-state';
import {
  conduceSempreRegistrato,
  regolaConsenso,
  type VoceNelVideo,
} from '@/lib/live/consent-rule';
import { registraChiConduce } from '@/lib/live/entry-consents';
import { elencoVisibileAlPubblico } from '@/lib/live/participant-list';
import { rubricaProposta } from '@/lib/persons/address-book';
import { MESI_RUBRICA_PREDEFINITI } from '@/lib/persons/retention';
import {
  recordingAvailable,
  tracceDisponibili,
  voceNelVideo,
} from '@/lib/recording/availability';
import { destinazioneDelTesto } from '@/lib/recording/destination';
import { trascrizioneDalVideo } from '@/lib/registration/consents';

/**
 * La scheda privacy di un evento: cosa succede ai dati di chi partecipa, secondo
 * le impostazioni dell'evento e dell'installazione. Sta sopra un'informativa
 * unica e si ricalcola a ogni pagina, quindi segue l'evento e non si salva.
 *
 * Contiene fatti, mai testi: li sceglie `components/events/privacy-sheet`, nella
 * lingua della pagina. Dice solo cio' che e' vero, e dove una cosa dipende da chi
 * organizza dice «puo'»: per questo un fatto assente non nega niente.
 *
 * Si calcola sul server e arriva al client come dato. Le regole
 * sull'installazione leggono l'ambiente, che nel browser non c'e', e la rubrica
 * legge una colonna che le impostazioni pubbliche non portano. I componenti
 * client importano da qui solo i tipi.
 */

/** Cosa si registra della sala. `soloTracce`: niente video, una traccia audio
 *  per ogni persona che acconsente. */
export type ModoRegistrazione = 'nessuna' | 'soloTracce' | 'manuale' | 'automatica';

/** Dove va il video. `nonDichiarata`: l'evento non l'ha mai detto, decide chi
 *  organizza dopo l'evento. */
export type DestinazioneScheda = RecordingAudience | 'nonDichiarata';

/**
 * Cosa succede a chi non acconsente:
 *  - `restaFuori`: partecipa e non entra nella registrazione;
 *  - `soloAscolto`: la voce non si toglie dal video, quindi partecipa ascoltando;
 *  - `avviso`: il pubblico non ha microfono, videocamera e schermo e non c'e'
 *    niente da chiedere, finche' chi conduce non gli da' la parola;
 *  - `avvisoVoce`: come sopra, e chi riceve la parola acconsente in sala.
 */
export type ChiNonAcconsente = 'restaFuori' | 'soloAscolto' | 'avviso' | 'avvisoVoce';

export interface SchedaPrivacy {
  registrazione: {
    modo: ModoRegistrazione;
    /** Null se non c'e' un video. */
    destinazione: DestinazioneScheda | null;
    /** Null se non si registra niente. */
    chiNonAcconsente: ChiNonAcconsente | null;
    /** Chi conduce e' sempre nella registrazione (lib/live/consent-rule). */
    conduceSempre: boolean;
  };
  trascrizione: {
    /** Il testo dei sottotitoli si conserva per chi acconsente. */
    sottotitoli: boolean;
    /** La traccia audio per persona, e cosa ne resta. Null se non si registra. */
    tracce: 'cancellate' | 'conservate' | null;
    /** La sola via e' il video completo, e chi organizza deve confermare che
     *  tutte le voci hanno acconsentito (lib/ai/voice-consent). */
    dalVideo: boolean;
  };
  sottotitoli: {
    attivi: boolean;
    /** Dove l'evento tiene la trascrizione dai sottotitoli, il testo non sparisce
     *  con la diretta. Non dipende da `attivi`: chi modera puo' accenderli dal
     *  vivo (`schedaInSala`, components/events/privacy-sheet). */
    testoConservato: boolean;
  };
  /** Null con la pipeline spenta. Con la pipeline accesa c'e' sempre, perche' il
   *  resoconto post-evento non dipende dai flag dell'evento (lib/report/enqueue). */
  ia: {
    sintesi: boolean;
    traduzione: boolean;
    doppiaggio: boolean;
    /** Chi organizza puo' chiedere dopo l'evento cio' che la scheda non dice,
     *  anche a flag spenti (api/admin/events/[id]/generate-ai e
     *  api/admin/postprod/recordings/[id]/generate-ai): la trascrizione, la
     *  sintesi o la traduzione. Falso se c'e' gia' tutto, o niente da elaborare. */
    elaborabileDopo: boolean;
  } | null;
  /** Chat e domande del Q&A dopo l'evento. */
  chat: {
    /** L'evento ha la chat: i messaggi non si pubblicano mai. */
    attiva: boolean;
    /** L'evento raccoglie domande. */
    domandeAttive: boolean;
    /** Cosa si pubblica delle domande (`domandePubbliche`). Non dipende da
     *  `domandeAttive`: chi modera puo' aprire il Q&A dal vivo (`schedaInSala`,
     *  components/events/privacy-sheet). */
    esitoDomande: 'soloTesto' | 'nonPubblicate';
  };
  elencoVisibile: boolean;
  pseudonimi: boolean;
  conservazione: {
    giorniDati: number;
    /** Null se non c'e' un video. `giorniDopoPubblicazione` e' null dove il
     *  video non ha una scadenza propria (lib/gdpr/cleanup-selection). */
    video: { giorniDopoPubblicazione: number | null } | null;
  };
  /** Null dove la rubrica non si propone. */
  rubrica: { mesi: number } | null;
}

/**
 * Cosa solo il server sa dell'installazione. `trascrizioneSottotitoli` e'
 * `captionsTranscriptActive`, e non si ricava dagli altri campi perche' la regola
 * resti in un punto solo.
 */
export interface AmbienteScheda {
  registrazioneDisponibile: boolean;
  voce: VoceNelVideo;
  sottotitoliDisponibili: boolean;
  trascrizioneSottotitoli: boolean;
  tracceDisponibili: boolean;
}

export type EventoScheda = Pick<
  Event,
  | 'eventType'
  | 'recordingEnabled'
  | 'autoStartRecording'
  | 'recordingDestination'
  | 'recordingAudience'
  | 'multitrackRecordingEnabled'
  | 'retainParticipantTracks'
  | 'hostsAlwaysRecorded'
  | 'participantsCanUnmute'
  | 'participantsCanStartVideo'
  | 'participantsCanShareScreen'
  | 'liveCaptionsEnabled'
  | 'captionsTranscriptEnabled'
  | 'aiTranscriptEnabled'
  | 'aiSummaryEnabled'
  | 'aiTranslationEnabled'
  | 'aiDubbingEnabled'
  | 'chatEnabled'
  | 'qaEnabled'
  | 'postEventShowQA'
  | 'participantListVisible'
  | 'audienceAnonymous'
  | 'dataRetentionDays'
  | 'recordingDeleteAfterDays'
  | 'offerAddressBook'
>;

/**
 * Campi obbligatori di proposito: `addressBookEnabled` non e' tra le impostazioni
 * pubbliche, e con un campo opzionale la rubrica sembrerebbe sempre accesa. Cosi'
 * il compilatore accetta solo la riga di `getSettings()`.
 */
export type SitoScheda = Pick<
  SiteSetting,
  'aiPipelineEnabled' | 'addressBookEnabled' | 'liveCaptionsEnabled'
>;

function chiNonAcconsente(
  evento: EventoScheda,
  ambiente: AmbienteScheda
): ChiNonAcconsente {
  const regola = regolaConsenso(evento, ambiente.registrazioneDisponibile, ambiente.voce);
  if (regola.soloAscolto) return 'soloAscolto';
  if (regola.richiesto) return 'restaFuori';
  return ambiente.voce === 'fissa' ? 'avviso' : 'avvisoVoce';
}

/**
 * La scheda di un evento. Null per le chiamate rapide: non chiedono consensi e
 * chi entra dal link non ne vede la registrazione, ma chi modera puo' avviarla,
 * quindi nessuna delle due risposte sarebbe vera per tutti.
 *
 * Riceve l'evento com'e', con il suo `eventType`, non i valori che la pagina
 * maschera per chi guarda: lo stesso evento ha una scheda sola.
 */
export function schedaPrivacy({
  evento,
  sito,
  ambiente,
}: {
  evento: EventoScheda;
  sito: Pick<SitoScheda, 'aiPipelineEnabled' | 'addressBookEnabled'>;
  ambiente: AmbienteScheda;
}): SchedaPrivacy | null {
  if (evento.eventType === 'INSTANT') return null;

  const { registrazioneDisponibile, voce } = ambiente;
  const registra = registraChiConduce(evento, registrazioneDisponibile);
  const video = registra && voce !== 'assente';
  const tracce = tracceConfigurate(
    evento,
    registrazioneDisponibile && ambiente.tracceDisponibili
  );

  let modo: ModoRegistrazione = 'nessuna';
  if (video) modo = evento.autoStartRecording ? 'automatica' : 'manuale';
  else if (tracce) modo = 'soloTracce';
  const siRegistra = modo !== 'nessuna';

  // `trascrizioneDalVideo` e' vera anche con le tracce per persona, che sono la
  // via che la pipeline prende quando ci sono.
  const dalVideo =
    !tracce && trascrizioneDalVideo(evento, sito, registrazioneDisponibile, voce);
  const sintesi = siRegistra && evento.aiSummaryEnabled;
  const traduzione = siRegistra && evento.aiTranslationEnabled;

  return {
    registrazione: {
      modo,
      destinazione: video
        ? (destinazioneDelTesto(evento.recordingDestination, voce) ?? 'nonDichiarata')
        : null,
      chiNonAcconsente: siRegistra ? chiNonAcconsente(evento, ambiente) : null,
      conduceSempre: siRegistra && conduceSempreRegistrato(evento, voce),
    },
    trascrizione: {
      sottotitoli: ambiente.trascrizioneSottotitoli,
      // Una traccia mai trascritta resta quanto i dati dell'evento
      // (api/cron/multitrack-purge): senza pipeline la cancellazione non arriva.
      tracce: !tracce
        ? null
        : evento.retainParticipantTracks || !sito.aiPipelineEnabled
          ? 'conservate'
          : 'cancellate',
      dalVideo,
    },
    sottotitoli: {
      attivi: ambiente.sottotitoliDisponibili && evento.liveCaptionsEnabled !== false,
      testoConservato:
        ambiente.sottotitoliDisponibili && evento.captionsTranscriptEnabled,
    },
    ia: sito.aiPipelineEnabled
      ? {
          sintesi,
          traduzione,
          // Serve un video. Si accoda con ogni lingua tradotta, anche con una
          // aggiunta dopo l'evento a traduzione spenta (lib/ai/enqueue).
          doppiaggio: video && evento.aiDubbingEnabled,
          elaborabileDopo: siRegistra && !((tracce || dalVideo) && sintesi && traduzione),
        }
      : null,
    chat: {
      attiva: evento.chatEnabled,
      domandeAttive: evento.qaEnabled,
      esitoDomande: domandePubbliche({ ...evento, qaEnabled: true })
        ? 'soloTesto'
        : 'nonPubblicate',
    },
    elencoVisibile: elencoVisibileAlPubblico(evento),
    pseudonimi: evento.audienceAnonymous,
    conservazione: {
      giorniDati: evento.dataRetentionDays,
      // Uno zero non e' una scadenza: lib/gdpr/cleanup-selection lo ignora.
      video: video
        ? { giorniDopoPubblicazione: evento.recordingDeleteAfterDays || null }
        : null,
    },
    rubrica: rubricaProposta(evento, sito) ? { mesi: MESI_RUBRICA_PREDEFINITI } : null,
  };
}

/**
 * La scheda di un evento, con i fatti dell'installazione letti dall'ambiente. Si
 * chiama solo sul server, con la riga di `getSettings()`, e il client riceve il
 * risultato.
 */
export function schedaPrivacyEvento(
  evento: EventoScheda,
  sito: SitoScheda
): SchedaPrivacy | null {
  return schedaPrivacy({
    evento,
    sito,
    ambiente: {
      registrazioneDisponibile: recordingAvailable(),
      voce: voceNelVideo(),
      sottotitoliDisponibili: liveCaptionsAvailable(sito),
      trascrizioneSottotitoli: captionsTranscriptActive(evento, sito),
      tracceDisponibili: tracceDisponibili(),
    },
  });
}

/**
 * Il testo sull'elaborazione della registrazione scritto dall'amministrazione per
 * questa lingua (SiteSetting.aiConsentDisclosure), o null.
 */
export function testoIaDelSito(
  sito: Pick<SiteSetting, 'aiConsentDisclosure'>,
  locale: string
): string | null {
  return (
    ((sito.aiConsentDisclosure as Record<string, string> | null) ?? {})[locale] ?? null
  );
}
