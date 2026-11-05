// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Quali consensi chiedere a chi si iscrive, dal formato dell'evento.
 *
 * Il consenso alla registrazione composita riguarda la voce, l'immagine e lo
 * schermo di chi partecipa: se l'evento non concede ai partecipanti né il
 * microfono, né la videocamera, né la condivisione dello schermo (e il bridge
 * lo fa rispettare, mod_pa_media_lock), la registrazione non li contiene e
 * l'iscrizione li informa invece di chiedere. Se chi conduce dà loro la
 * parola, sono loro ad accendere il microfono: lo dice l'informativa.
 *
 * La trascrizione dei propri interventi, con il proprio nome, e' un consenso
 * a parte e facoltativo: si chiede quando l'evento registra una traccia audio
 * per persona (ADR-013), tiene la trascrizione dai sottotitoli live o trascrive
 * il video con la pipeline AI (`trascrizioneDalVideo`). Chi non lo da'
 * partecipa lo stesso: il registratore non registra la sua voce e la
 * trascrizione dai sottotitoli non tiene le sue frasi (lo decide il server,
 * voce per voce, lib/captions/room). Il video completo non si divide per voce:
 * non si trascrive da solo, lo fa chi conferma che tutte le voci hanno
 * acconsentito (lib/ai/voice-consent).
 *
 * Il consenso alla registrazione e' libero (art. 7.4 GDPR): non e' mai una
 * condizione per iscriversi o per entrare. Chi non lo da' partecipa come tutti e
 * resta fuori dalla registrazione (lib/live/listen-only).
 *
 * Vale per il modulo di iscrizione, per la rotta che la salva e per l'avviso
 * all'ingresso in sala: una sola regola, perché un consenso chiesto in un
 * punto e non in un altro rifiuterebbe iscrizioni valide o ne lascerebbe
 * passare di monche.
 */
import type { VoceNelVideo } from '@/lib/live/consent-rule';

/**
 * La versione del testo del consenso alla trascrizione dei propri interventi
 * con cui una persona lo da'. Si salva con il consenso
 * (Registration.consentMultitrackVersion, MultitrackConsent.textVersion):
 *   1. la traccia audio per persona, per attribuire la trascrizione;
 *   2. la trascrizione dei propri interventi con il proprio nome, dalla
 *      traccia audio, dai sottotitoli live o dal video, per il resoconto
 *      dell'evento.
 * La trascrizione dai sottotitoli tiene solo i consensi dati con il testo 2:
 * chi aveva acconsentito alla sola traccia audio non ha acconsentito a questo.
 * Si cambia insieme al testo (gdpr.consent.multitrack) quando il suo scopo
 * cambia. Le due varianti di `chiaveConsensoTrascrizione` hanno lo stesso scopo e
 * la stessa versione: cambia solo quanto resta la traccia, e una versione nuova
 * toglierebbe valore ai consensi gia' dati con il testo 2.
 */
export const VERSIONE_TESTO_TRASCRIZIONE = 2;

export interface FormatoEvento {
  recordingEnabled: boolean;
  multitrackRecordingEnabled: boolean;
  /** La trascrizione dai sottotitoli e' attiva (lib/captions/availability). */
  captionsTranscript?: boolean;
  /** La pipeline AI trascrive il video (`trascrizioneDalVideo`). Si calcola: la
   *  rotta passa le colonne dell'evento, e il solo flag dell'evento non basta. */
  trascrizioneVideo?: boolean;
  participantsCanUnmute: boolean;
  participantsCanStartVideo: boolean;
  participantsCanShareScreen: boolean;
}

export interface ConsensiRichiesti {
  /** Consenso alla registrazione audio e video: si chiede, facoltativo. */
  registrazione: boolean;
  /** Si registra, ma i partecipanti non hanno né microfono, né videocamera,
   *  né schermo: un'informativa, nessuna casella. */
  avvisoRegistrazione: boolean;
  /** Consenso alla trascrizione dei propri interventi: si chiede, facoltativo. */
  tracce: boolean;
}

/**
 * La pipeline AI trascrive il video completo dell'evento: c'e' un video da
 * trascrivere (l'evento registra, l'installazione puo' farlo, e non solo con le
 * tracce per persona), l'evento vuole la trascrizione e la pipeline e' accesa.
 * Nelle chiamate rapide la sala non mostra la registrazione e non si chiede
 * niente. Sicura nel client: i fatti sull'installazione li riceve.
 */
export function trascrizioneDalVideo(
  evento: {
    eventType?: string | null;
    recordingEnabled?: boolean;
    aiTranscriptEnabled?: boolean;
  },
  sito: { aiPipelineEnabled?: boolean | null },
  registrazioneDisponibile: boolean,
  voce: VoceNelVideo
): boolean {
  return (
    evento.eventType !== 'INSTANT' &&
    !!evento.recordingEnabled &&
    registrazioneDisponibile &&
    voce !== 'assente' &&
    !!evento.aiTranscriptEnabled &&
    !!sito.aiPipelineEnabled
  );
}

/**
 * Il testo della casella della trascrizione, come chiave sotto `gdpr.consent`:
 * lo stesso nel modulo e in sala d'attesa. Dove le tracce per persona si
 * conservano (Event.retainParticipantTracks) il testo non ne promette la
 * cancellazione.
 */
export function chiaveConsensoTrascrizione(evento: {
  retainParticipantTracks?: boolean | null;
}) {
  return evento.retainParticipantTracks ? 'multitrackRetained' : 'multitrack';
}

/** Da quali fatti dipende il consenso alla trascrizione dei propri interventi. */
export type FormatoTrascrizione = Partial<
  Pick<
    FormatoEvento,
    'multitrackRecordingEnabled' | 'captionsTranscript' | 'trascrizioneVideo'
  >
>;

/**
 * L'evento chiede il consenso alla trascrizione dei propri interventi: la
 * regola unica di modulo, rotta, sala d'attesa e token.
 */
export function trascrizioneRichiesta(evento: FormatoTrascrizione): boolean {
  return (
    !!evento.multitrackRecordingEnabled ||
    !!evento.captionsTranscript ||
    !!evento.trascrizioneVideo
  );
}

export function consensiRichiesti(evento: FormatoEvento): ConsensiRichiesti {
  const presenza =
    evento.participantsCanUnmute ||
    evento.participantsCanStartVideo ||
    evento.participantsCanShareScreen;
  const registrazione = evento.recordingEnabled && presenza;
  return {
    registrazione,
    avvisoRegistrazione: evento.recordingEnabled && !presenza,
    tracce: trascrizioneRichiesta(evento),
  };
}
