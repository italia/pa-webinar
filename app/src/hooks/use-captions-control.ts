'use client';

import { useEffect, useRef, useState } from 'react';

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
 * Riparte anche a ogni cambio della registrazione, con i sottotitoli accesi:
 * avviando o fermando la registrazione la sala di Jitsi riscrive negli stessi
 * metadati che la trascrizione è spenta (`startRecording` senza l'opzione
 * `transcription`, `stopRecording` sempre), e Jicofo chiude i sottotitoli.
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
}): void {
  const [ingressi, setIngressi] = useState(0);
  const [registrazioni, setRegistrazioni] = useState(0);
  const inviato = useRef<{
    accesi: boolean;
    ingresso: number;
    registrazione: number;
  } | null>(null);

  useEffect(() => {
    if (!api) return;
    const entrato = () => setIngressi((n) => n + 1);
    const registrazione = () => setRegistrazioni((n) => n + 1);
    api.addListener('videoConferenceJoined', entrato);
    api.addListener('recordingStatusChanged', registrazione);
    return () => {
      api.removeListener('videoConferenceJoined', entrato);
      api.removeListener('recordingStatusChanged', registrazione);
    };
  }, [api]);

  useEffect(() => {
    if (!api || !attivo || ingressi === 0) return;
    const ultimo = inviato.current;
    if (ultimo && ultimo.accesi === accesi && ultimo.ingresso === ingressi) {
      // Cambiata solo la registrazione: a sottotitoli spenti non c'è niente da
      // rimettere.
      if (ultimo.registrazione === registrazioni || !accesi) {
        inviato.current = { ...ultimo, registrazione: registrazioni };
        return;
      }
    }
    // Anche il primo «spenti» parte, ma solo con il valore del server: a
    // stanza gia' spenta non cambia niente, e se Prosody non ha potuto
    // chiedere al portale la stanza segue comunque l'interruttore. Con il
    // valore con cui la pagina e' stata disegnata, forse vecchio, si aspetta.
    if (!accesi && !ultimo && !certo) return;
    try {
      api.executeCommand('setSubtitles', accesi, false, lingua);
      inviato.current = { accesi, ingresso: ingressi, registrazione: registrazioni };
    } catch (err) {
      console.error('setSubtitles failed', err);
    }
  }, [api, attivo, accesi, certo, lingua, ingressi, registrazioni]);
}
