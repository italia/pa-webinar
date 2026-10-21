'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { JitsiMeetExternalAPI } from '@/types/jitsi';

/**
 * La trascrizione dei sottotitoli live, accesa e spenta dal browser di chi
 * modera (ADR-018). Non e' l'unica strada: a ogni ingresso nella sala Prosody
 * chiede al portale se l'evento li vuole e la accende o la spegne da solo
 * (mod_pa_captions), anche senza un moderatore. Qui la decisione arriva
 * subito quando chi modera cambia l'interruttore.
 *
 * Jitsi la avvia quando un moderatore scrive nei metadati della stanza che la
 * vuole: il comando `setSubtitles` dell'IFrame API fa proprio questo, se il
 * token concede la feature `transcription` e Prosody ha marcato la stanza come
 * trascrivibile dal bridge. I sottotitoli nativi di Jitsi restano nascosti
 * (`displaySubtitles: false`): la sala mostra i propri.
 *
 * Il comando parte solo dopo l'ingresso nella conferenza (prima non c'è una
 * stanza a cui scriverlo) e di nuovo a ogni cambio dell'interruttore o
 * rientro. Va usato solo se il servizio è installato: senza, Jitsi tenterebbe
 * la vecchia trascrizione via telefono e mostrerebbe un errore.
 *
 * Chi avvia o ferma la registrazione da questa sala rimanda subito la scelta
 * con la funzione restituita: `startRecording` senza l'opzione
 * `transcription`, e `stopRecording` sempre, scrivono negli stessi metadati
 * che la trascrizione è spenta, e Jicofo chiuderebbe i sottotitoli. I comandi
 * dell'IFrame API si eseguono nell'ordine, quindi l'ultima parola resta la
 * scelta della sala; anche se la registrazione poi non parte.
 */
export function useCaptionsControl({
  api,
  attivo,
  accesi,
  certo = true,
  lingua,
}: {
  api: JitsiMeetExternalAPI | null;
  /** Chi usa la sala modera e il servizio dei sottotitoli è disponibile. */
  attivo: boolean;
  /** I sottotitoli dell'evento sono accesi in questo momento. */
  accesi: boolean;
  /**
   * `accesi` viene dal server, non dal valore con cui la pagina e' stata
   * disegnata: solo allora si manda anche uno «spenti».
   */
  certo?: boolean;
  /** Codice primario della lingua dell'evento ("it"). */
  lingua: string;
}): () => void {
  const [ingressi, setIngressi] = useState(0);
  const inviato = useRef<{ accesi: boolean; ingresso: number; lingua: string } | null>(
    null
  );

  useEffect(() => {
    if (!api) return;
    const entrato = () => setIngressi((n) => n + 1);
    api.addListener('videoConferenceJoined', entrato);
    return () => {
      api.removeListener('videoConferenceJoined', entrato);
    };
  }, [api]);

  useEffect(() => {
    if (!api || !attivo || ingressi === 0) return;
    const ultimo = inviato.current;
    // All'ingresso e a ogni cambio della scelta o della lingua.
    const serve =
      !ultimo ||
      ultimo.accesi !== accesi ||
      ultimo.ingresso !== ingressi ||
      ultimo.lingua !== lingua;
    if (!serve) return;
    // Anche il primo «spenti» parte, ma solo con il valore del server: a
    // stanza gia' spenta non cambia niente, e se Prosody non ha potuto
    // chiedere al portale la stanza segue comunque l'interruttore. Con il
    // valore con cui la pagina e' stata disegnata, forse vecchio, si aspetta.
    if (!accesi && !ultimo && !certo) return;
    if (manda(api, accesi, lingua))
      inviato.current = { accesi, ingresso: ingressi, lingua };
  }, [api, attivo, accesi, certo, lingua, ingressi]);

  return useCallback(() => {
    if (api && attivo && accesi && ingressi > 0) manda(api, true, lingua);
  }, [api, attivo, accesi, lingua, ingressi]);
}

/** La scelta a Jitsi; i sottotitoli nativi restano nascosti. Vero se è partita. */
function manda(api: JitsiMeetExternalAPI, accesi: boolean, lingua: string): boolean {
  try {
    api.executeCommand('setSubtitles', accesi, false, lingua);
    return true;
  } catch (err) {
    console.error('setSubtitles failed', err);
    return false;
  }
}
