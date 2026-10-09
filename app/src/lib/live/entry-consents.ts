import { consensiRichiesti, type FormatoEvento } from '@/lib/registration/consents';

/**
 * Il consenso alla registrazione dell'evento per chi entra dalla sala
 * d'attesa: se chiederlo, o se basta informare.
 *
 * Se chi partecipa ha microfono, videocamera o schermo, la sala lo chiede a
 * chi non l'ha gia' dato (all'iscrizione, o in sala in questa visita della
 * pagina); di solo ascolto informa e basta (lib/registration/consents). Chi
 * conduce o interviene per incarico non lo vede: la registrazione e' cosa
 * sua. Senza nulla che possa registrare (lib/recording/availability) non si
 * chiede e non si informa.
 */
export function consensoRegistrazioneIngresso(i: {
  formato: FormatoEvento;
  /** L'installazione puo' registrare. */
  registrazioneDisponibile: boolean;
  /** Moderatore o relatore. */
  conduce: boolean;
  /** Dato all'iscrizione nel browser che si e' iscritto, o in sala. */
  giaDato: boolean;
}): { richiesto: boolean; soloAscolto: boolean } {
  const formato = consensiRichiesti({
    ...i.formato,
    recordingEnabled: i.formato.recordingEnabled && i.registrazioneDisponibile,
  });
  return {
    richiesto: !i.conduce && formato.registrazione && !i.giaDato,
    soloAscolto: !i.conduce && formato.avvisoRegistrazione,
  };
}

export interface ProveConsenso {
  registrazione: boolean;
  tracce: boolean;
}

/**
 * Quali consensi mandare con la richiesta del JWT: quelli dati ora in sala
 * d'attesa, e quelli che il server ha gia' salvato in questa visita della
 * pagina. A ogni ingresso, anche dopo un rientro o una riconnessione: ogni
 * ingresso e' un posto nuovo nella conferenza (per un ospite, magari con un
 * altro nome), e ogni posto ha la sua prova. Per un'iscrizione il server non
 * la raddoppia.
 */
export function consensiDaInviare(
  prefs: { recordingConsent?: boolean; multitrackConsent?: boolean },
  salvati: ProveConsenso,
): ProveConsenso {
  return {
    registrazione: !!prefs.recordingConsent || salvati.registrazione,
    tracce: !!prefs.multitrackConsent || salvati.tracce,
  };
}
