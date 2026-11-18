// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import type { VoceNelVideo } from '@/lib/live/consent-rule';
import {
  consensiRichiesti,
  trascrizioneRichiesta,
  type FormatoEvento,
  type FormatoTrascrizione,
} from '@/lib/registration/consents';

/**
 * Il consenso alla registrazione dell'evento per chi entra dalla sala
 * d'attesa: se chiederlo, o se basta informare.
 *
 * Se chi partecipa ha microfono, videocamera o schermo, la sala lo chiede a
 * chi non l'ha gia' dato (all'iscrizione, o in sala in questa visita della
 * pagina); di solo ascolto informa e basta (lib/registration/consents).
 * Chi conduce o interviene lo vede in ogni evento che registra, salvo che
 * l'evento lo tenga sempre nella registrazione (conduceSempreRegistrato). E'
 * sempre facoltativo: chi non lo da' entra lo stesso (lib/live/listen-only). Senza
 * nulla che possa registrare (lib/recording/availability) non si chiede e non si
 * informa. Nelle chiamate rapide non si chiede all'ingresso: tutti entrano fuori
 * dalla registrazione, e la sala lo chiede quando qualcuno la avvia
 * (components/live/recording-question).
 */
/**
 * L'evento registra chi conduce o interviene: la stessa regola per la sala
 * d'attesa, la pagina della sala e la rotta del token. Senza nulla che possa
 * registrare non c'e' niente a cui acconsentire. Una chiamata rapida registra
 * solo dove chi non acconsente resta fuori dal video (`voce` 'rimovibile',
 * lib/live/consent-rule): altrove la sala non offre la registrazione.
 */
export function registraChiConduce(
  evento: { recordingEnabled: boolean; eventType?: string | null },
  registrazioneDisponibile: boolean,
  voce?: VoceNelVideo,
): boolean {
  if (!evento.recordingEnabled || !registrazioneDisponibile) return false;
  return evento.eventType !== 'INSTANT' || voce === 'rimovibile';
}

export function consensoRegistrazioneIngresso(i: {
  formato: FormatoEvento;
  /** L'installazione puo' registrare. */
  registrazioneDisponibile: boolean;
  /** Moderatore o relatore. */
  conduce: boolean;
  /** Dato all'iscrizione nel browser che si e' iscritto, o in sala. */
  giaDato: boolean;
  /** Chiamata rapida (eventType INSTANT): la domanda arriva in sala, quando
   *  qualcuno avvia la registrazione. */
  istantanea?: boolean;
  /** Chi conduce e' sempre nella registrazione (lib/live/consent-rule). */
  conduceSempreRegistrato?: boolean;
}): { richiesto: boolean; soloAscolto: boolean } {
  if (i.istantanea) return { richiesto: false, soloAscolto: false };
  if (i.conduce) {
    const registra = registraChiConduce(
      { recordingEnabled: i.formato.recordingEnabled },
      i.registrazioneDisponibile,
    );
    return { richiesto: registra && !i.giaDato && !i.conduceSempreRegistrato, soloAscolto: false };
  }
  const formato = consensiRichiesti({
    ...i.formato,
    recordingEnabled: i.formato.recordingEnabled && i.registrazioneDisponibile,
  });
  const richiesto = formato.registrazione && !i.giaDato;
  return {
    richiesto,
    soloAscolto: formato.avvisoRegistrazione,
  };
}

/**
 * La casella della trascrizione dei propri interventi per chi entra: la stessa
 * regola del modulo d'iscrizione (lib/registration/consents), finche' l'evento
 * non e' concluso. E' facoltativa e non ferma l'ingresso: chi non la da' entra,
 * ma la sua voce non si registra ne' si trascrive (lo decide il server, voce per
 * voce). Senza `giaDato`, `voce` e `soloAscolto` risponde se l'evento la chiede
 * a questa persona, data o no: e' cio' che mostra la finestra dei consensi.
 */
export function consensoTrascrizioneIngresso(i: {
  formato: FormatoTrascrizione;
  /** L'evento e' concluso: non resta niente da trascrivere. */
  concluso: boolean;
  /** Dato all'iscrizione o in sala: la casella non si ripropone. */
  giaDato?: boolean;
  /** La voce di chi non acconsente nel video (lib/recording/availability). */
  voce?: VoceNelVideo;
  /** Il `soloAscolto` di `consensoRegistrazioneIngresso`: si avvisa e basta. */
  soloAscolto?: boolean;
  /** Il consenso alla registrazione si chiede solo in sala, quando qualcuno la
   *  avvia: la chiamata rapida che registra. */
  registrazioneInSala?: boolean;
}): boolean {
  // Dove si avvisa soltanto, e nelle chiamate rapide, la voce non si registra
  // senza il consenso, che si da' in sala: la trascrizione, qui, non varrebbe.
  const nonVarrebbe = (i.voce === 'rimovibile' && !!i.soloAscolto) || !!i.registrazioneInSala;
  return trascrizioneRichiesta(i.formato) && !i.concluso && !i.giaDato && !nonVarrebbe;
}

export interface ProveConsenso {
  registrazione: boolean;
  tracce: boolean;
}

export function stessiConsensi(a: ProveConsenso, b: ProveConsenso): boolean {
  return a.registrazione === b.registrazione && a.tracce === b.tracce;
}

export interface ConsensiDaInviare {
  /** Dati ora con un clic, e non ancora salvati dal server. */
  dati: ProveConsenso;
  /** Gia' dati: la pagina li riporta a un nuovo ingresso, senza un clic. */
  repliche: ProveConsenso;
}

/**
 * Quali consensi mandare con la richiesta del JWT, tenendo separati quelli dati
 * ora in sala da quelli che il server ha gia' salvato in questa visita della
 * pagina. Solo un clic da' un consenso: una replica vale se il server ne trova
 * ancora la prova, quindi un ritiro fatto altrove (la pagina dei propri dati,
 * un'altra scheda) non si annulla da solo a un rientro. Ogni ingresso e' un posto
 * nuovo nella conferenza, per questo una replica viaggia con ogni ingresso.
 */
export function consensiDaInviare(
  prefs: { recordingConsent?: boolean; multitrackConsent?: boolean },
  salvati: ProveConsenso,
): ConsensiDaInviare {
  const dati = {
    registrazione: !!prefs.recordingConsent,
    tracce: !!prefs.multitrackConsent,
  };
  return {
    dati,
    repliche: {
      registrazione: !dati.registrazione && salvati.registrazione,
      tracce: !dati.tracce && salvati.tracce,
    },
  };
}
