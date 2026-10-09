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
 * La traccia audio per persona (ADR-013) resta un consenso esplicito ogni
 * volta che l'evento la registra: il registratore multitraccia registra ogni
 * traccia remota senza guardare il consenso, quindi chi riceve la parola
 * dev'essere già coperto.
 *
 * Vale per il modulo di iscrizione, per la rotta che la salva e per l'avviso
 * all'ingresso in sala: una sola regola, perché un consenso chiesto in un
 * punto e non in un altro rifiuterebbe iscrizioni valide o ne lascerebbe
 * passare di monche.
 */
export interface FormatoEvento {
  recordingEnabled: boolean;
  multitrackRecordingEnabled: boolean;
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
  /** Consenso alla traccia audio per persona: obbligatorio. */
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
    tracce: evento.multitrackRecordingEnabled,
  };
}
