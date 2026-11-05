import { consensiRichiesti, type FormatoEvento } from '@/lib/registration/consents';

/**
 * Il consenso alla registrazione dell'evento per chi entra dalla sala
 * d'attesa: se chiederlo, o se basta informare.
 *
 * Se chi partecipa ha microfono, videocamera o schermo, la sala lo chiede a
 * chi non l'ha gia' dato (all'iscrizione, o in sala in questa visita della
 * pagina); di solo ascolto informa e basta (lib/registration/consents).
 * Chi conduce o interviene lo vede in ogni evento che registra, facoltativo:
 * senza, entra lo stesso, ma la sua voce non resta nelle tracce per persona
 * ne' nella trascrizione (lo decide la rotta del token). Senza nulla che
 * possa registrare (lib/recording/availability), e nelle chiamate rapide,
 * non si chiede e non si informa.
 */
/**
 * L'evento registra chi conduce o interviene: la stessa regola per la sala
 * d'attesa, la pagina della sala e la rotta del token. Nelle chiamate rapide
 * la sala non mostra la registrazione, e senza nulla che possa registrare non
 * c'e' niente a cui acconsentire.
 */
export function registraChiConduce(
  evento: { recordingEnabled: boolean; eventType?: string | null },
  registrazioneDisponibile: boolean,
): boolean {
  return evento.recordingEnabled && registrazioneDisponibile && evento.eventType !== 'INSTANT';
}

export function consensoRegistrazioneIngresso(i: {
  formato: FormatoEvento;
  /** L'installazione puo' registrare. */
  registrazioneDisponibile: boolean;
  /** Moderatore o relatore. */
  conduce: boolean;
  /** Dato all'iscrizione nel browser che si e' iscritto, o in sala. */
  giaDato: boolean;
  /** Chiamata rapida (eventType INSTANT): la sala non ne mostra la registrazione. */
  istantanea?: boolean;
}): { richiesto: boolean; facoltativo: boolean; soloAscolto: boolean } {
  if (i.conduce) {
    const registra = registraChiConduce(
      { recordingEnabled: i.formato.recordingEnabled, eventType: i.istantanea ? 'INSTANT' : null },
      i.registrazioneDisponibile,
    );
    const richiesto = registra && !i.giaDato;
    return { richiesto, facoltativo: richiesto, soloAscolto: false };
  }
  const formato = consensiRichiesti({
    ...i.formato,
    recordingEnabled: i.formato.recordingEnabled && i.registrazioneDisponibile,
  });
  const richiesto = formato.registrazione && !i.giaDato;
  return {
    richiesto,
    // Chiesto ma libero: senza, si entra in solo ascolto.
    facoltativo: richiesto && formato.registrazioneFacoltativa,
    soloAscolto: formato.avvisoRegistrazione,
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
