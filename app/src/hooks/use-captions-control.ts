'use client';

import { useEffect, useRef, useState } from 'react';

import type { JitsiMeetExternalAPI } from '@/types/jitsi';

/**
 * La trascrizione dei sottotitoli live, accesa e spenta dal browser di chi
 * modera (ADR-018).
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
 */
export function useCaptionsControl({
  api,
  attivo,
  accesi,
  lingua,
}: {
  api: JitsiMeetExternalAPI | null;
  /** Chi usa la sala modera e il servizio dei sottotitoli è disponibile. */
  attivo: boolean;
  /** I sottotitoli dell'evento sono accesi in questo momento. */
  accesi: boolean;
  /** Codice primario della lingua dell'evento ("it"). */
  lingua: string;
}): void {
  const [ingressi, setIngressi] = useState(0);
  const inviato = useRef<{ accesi: boolean; ingresso: number } | null>(null);

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
    if (ultimo && ultimo.accesi === accesi && ultimo.ingresso === ingressi) return;
    // Spegnere senza averli mai accesi da qui non serve: lo stato iniziale
    // della stanza è già "spenti".
    if (!accesi && !ultimo) return;
    try {
      api.executeCommand('setSubtitles', accesi, false, lingua);
      inviato.current = { accesi, ingresso: ingressi };
    } catch (err) {
      console.error('setSubtitles failed', err);
    }
  }, [api, attivo, accesi, lingua, ingressi]);
}
