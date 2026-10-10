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
 * per persona (ADR-013) o tiene la trascrizione dai sottotitoli live. Chi non
 * lo da' partecipa lo stesso: il registratore non registra la sua voce e la
 * trascrizione non tiene le sue frasi (lo decide il server, voce per voce,
 * lib/captions/room).
 *
 * Vale per il modulo di iscrizione, per la rotta che la salva e per l'avviso
 * all'ingresso in sala: una sola regola, perché un consenso chiesto in un
 * punto e non in un altro rifiuterebbe iscrizioni valide o ne lascerebbe
 * passare di monche.
 */
/**
 * La versione del testo del consenso alla trascrizione dei propri interventi
 * con cui una persona lo da'. Si salva con il consenso
 * (Registration.consentMultitrackVersion, MultitrackConsent.textVersion):
 *   1. la traccia audio per persona, per attribuire la trascrizione;
 *   2. la trascrizione dei propri interventi con il proprio nome, dalla
 *      traccia audio o dai sottotitoli live, per il resoconto dell'evento.
 * La trascrizione dai sottotitoli tiene solo i consensi dati con il testo 2:
 * chi aveva acconsentito alla sola traccia audio non ha acconsentito a questo.
 * Si cambia insieme al testo (gdpr.consent.multitrack) quando il suo scopo
 * cambia.
 */
export const VERSIONE_TESTO_TRASCRIZIONE = 2;

export interface FormatoEvento {
  recordingEnabled: boolean;
  multitrackRecordingEnabled: boolean;
  /** La trascrizione dai sottotitoli e' attiva (lib/captions/availability). */
  captionsTranscript?: boolean;
  participantsCanUnmute: boolean;
  participantsCanStartVideo: boolean;
  participantsCanShareScreen: boolean;
}

export interface ConsensiRichiesti {
  /** Consenso alla registrazione audio e video: obbligatorio. */
  registrazione: boolean;
  /** Si registra, ma i partecipanti non hanno né microfono, né videocamera,
   *  né schermo: un'informativa, nessuna casella. */
  avvisoRegistrazione: boolean;
  /** Consenso alla trascrizione dei propri interventi: si chiede, facoltativo. */
  tracce: boolean;
}

export function consensiRichiesti(evento: FormatoEvento): ConsensiRichiesti {
  const presenza =
    evento.participantsCanUnmute ||
    evento.participantsCanStartVideo ||
    evento.participantsCanShareScreen;
  return {
    registrazione: evento.recordingEnabled && presenza,
    avvisoRegistrazione: evento.recordingEnabled && !presenza,
    tracce: evento.multitrackRecordingEnabled || !!evento.captionsTranscript,
  };
}
