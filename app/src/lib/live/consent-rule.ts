// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { consensiRichiesti } from '@/lib/registration/consents';

/**
 * La regola del consenso alla registrazione per chi entra nella conferenza,
 * la stessa per il server (il token di Jitsi, lib/live/listen-only) e per la
 * sala (sala d'attesa, pannello dei partecipanti).
 *
 * Chi compare nel video: solo chi conduce (moderatori, relatori, chi organizza
 * dal link primario; nelle chiamate rapide chi la modera), sempre, con nome e
 * immagine (`conduceNelVideo`). Chi partecipa non compare mai: ne' riquadro, ne'
 * immagine, ne' nome. Dei suoi interventi si registra solo la voce, e solo con
 * il consenso; senza, nemmeno quella. Il consenso alla registrazione e' quindi
 * solo di chi partecipa.
 *
 * Tutto questo vale come lo garantisce l'installazione (`PartecipantiNelVideo`):
 * dove la voce non entra nel video ('esclusi') il consenso alla registrazione
 * non si chiede, e dove chi partecipa puo' comparire ('visibili') chi non
 * acconsente segue in solo ascolto. Un testo non promette mai piu' di cosi'.
 */
export interface EventoConsenso {
  eventType?: string;
  recordingEnabled: boolean;
  multitrackRecordingEnabled: boolean;
  participantsCanUnmute: boolean;
  participantsCanStartVideo: boolean;
  participantsCanShareScreen: boolean;
}

/**
 * Come compaiono nel video completo i partecipanti, cioe' chi non conduce: la
 * capacita' dell'installazione, l'unica da cui la regola e i testi derivano
 * (lib/recording/availability la legge dall'ambiente, ADR-022):
 *   - 'assente': non c'e' un video completo (niente Jibri);
 *   - 'solo-voce': mai volto, nome o riquadro; la voce di chi ha il consenso si';
 *   - 'esclusi': mai volto, nome o riquadro, e nemmeno la voce: nel video compare
 *     e si sente solo chi conduce;
 *   - 'visibili': nessuna garanzia (Jitsi esterno, testo della conferenza
 *     sostituito): chi partecipa puo' comparire con volto e nome, anche in
 *     silenzio nelle miniature.
 */
export type PartecipantiNelVideo = 'assente' | 'solo-voce' | 'esclusi' | 'visibili';

/**
 * La voce di chi non ha un consenso valido nel video completo: non c'e' un video
 * completo (`assente`), il registratore non la riproduce (`rimovibile`), oppure
 * resta (`fissa`). Si ricava da `PartecipantiNelVideo` (`voceDi`) per chi deve
 * solo sapere se la voce resta fuori.
 */
export type VoceNelVideo = 'assente' | 'rimovibile' | 'fissa';

/** La voce di chi non acconsente, dalla capacita' dell'installazione. */
export function voceDi(partecipanti: PartecipantiNelVideo): VoceNelVideo {
  if (partecipanti === 'assente') return 'assente';
  return partecipanti === 'visibili' ? 'fissa' : 'rimovibile';
}

export interface RegolaConsenso {
  /** Conta chi ha un consenso valido: la voce di chi partecipa senza resta
   *  fuori dalla registrazione, e il resto della sala non cambia. */
  registra: boolean;
  /** Il consenso alla registrazione della voce si chiede a chi partecipa. */
  richiesto: boolean;
  /** Senza consenso, solo ascolto: la voce non si potrebbe togliere dal video.
   *  Solo qui i blocchi della sala seguono il consenso. */
  soloAscolto: boolean;
  /** Chi partecipa non e' mai nel video, nemmeno con la voce ('esclusi'): il
   *  consenso alla registrazione non ha niente da coprire e non si chiede. La
   *  voce resta registrabile solo dalle tracce per persona e dalla trascrizione
   *  dai sottotitoli, e la decide il consenso alla trascrizione: senza, il token
   *  porta `voiceExcluded` come sempre. */
  voceDallaTrascrizione: boolean;
}

/**
 * Chi conduce e' nel video, con nome e immagine, dove c'e' un video della sala:
 * e' la regola, non una scelta dell'evento, e non chiede un consenso (la base
 * giuridica la dichiara il titolare). La colonna `Event.hostsAlwaysRecorded`
 * resta nel database e non si legge piu'. Senza un video completo (`assente`)
 * restano le tracce per persona, che seguono il consenso alla trascrizione,
 * anche per chi conduce.
 */
export function conduceNelVideo(partecipanti: PartecipantiNelVideo): boolean {
  return partecipanti !== 'assente';
}

/**
 * Se ritirare il consenso alla registrazione ritira anche quello alla
 * trascrizione dei propri interventi. Di solito si': la voce entra nelle tracce
 * per persona e nella trascrizione solo con il consenso alla registrazione, e
 * senza non c'e' niente da trascrivere. Dove chi partecipa non entra mai nel
 * video ('esclusi') il consenso alla registrazione non copre niente e la voce la
 * decide la sola trascrizione (`voceDallaTrascrizione`): ritirare il primo, dato
 * prima che l'installazione cambiasse, lascia il secondo com'e'.
 */
export function ritiroPortaTrascrizione(partecipanti: PartecipantiNelVideo): boolean {
  return partecipanti !== 'esclusi';
}

export function regolaConsenso(
  event: EventoConsenso,
  registrazioneDisponibile: boolean,
  partecipanti: PartecipantiNelVideo,
): RegolaConsenso {
  const voce = voceDi(partecipanti);
  // Dove chi partecipa non e' mai nel video ('esclusi') la registrazione si offre
  // lo stesso, anche nelle chiamate rapide: riprende solo chi conduce. Non c'e'
  // niente da chiedere, e la voce di chi partecipa la registrano solo le tracce
  // per persona e la trascrizione dai sottotitoli, con il loro consenso.
  const esclusi = partecipanti === 'esclusi';
  // Una chiamata rapida non chiede niente all'ingresso: chi partecipa entra con
  // la voce fuori dalla registrazione, e la domanda arriva in sala a ogni avvio
  // (components/live/recording-question). Per questo si registra solo dove la
  // voce di chi non acconsente resta davvero fuori: altrove la sala non offre la
  // registrazione, e il solo ascolto non tocca mai una chiamata rapida.
  if (event.eventType === 'INSTANT') {
    const registra = event.recordingEnabled && registrazioneDisponibile && voce === 'rimovibile';
    return {
      registra,
      richiesto: registra && !esclusi,
      soloAscolto: false,
      voceDallaTrascrizione: registra && esclusi,
    };
  }
  const recordingEnabled = event.recordingEnabled && registrazioneDisponibile;
  const richiesto = consensiRichiesti({ ...event, recordingEnabled }, partecipanti).registrazione;
  return {
    // Dove la voce resta nel video e l'evento si limita ad avvisare, nessuno ha
    // potuto dire di no: restano i limiti dell'evento, come sempre.
    registra: recordingEnabled && (voce === 'rimovibile' || (voce === 'fissa' && richiesto)),
    richiesto,
    soloAscolto: recordingEnabled && voce === 'fissa' && richiesto,
    voceDallaTrascrizione: recordingEnabled && esclusi,
  };
}

/**
 * Il testo sulla registrazione scelto per l'evento, se si puo' mostrare. Si
 * mostra con la casella del consenso alla registrazione, che lo copre: senza un
 * video completo parlerebbe di una registrazione che non c'e', e dove chi
 * partecipa non e' mai nel video ('esclusi') la casella non c'e'. Vale quello
 * predefinito.
 */
export function testoConsensoEvento(
  testo: string | null | undefined,
  partecipanti: PartecipantiNelVideo
): string | null {
  return partecipanti === 'assente' || partecipanti === 'esclusi' ? null : testo?.trim() || null;
}
