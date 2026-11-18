// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Il pass di presenza di una chiamata rapida (lib/recording/presence-pass):
 * mentre la registrazione e' in corso, la sala lo chiede con i token di questa
 * visita come prova del posto, e il server posa il cookie che dopo la chiamata
 * apre la registrazione dal link della chiamata. Vale per chiunque sia in
 * sala, abbia acconsentito o no a comparire nel video.
 *
 * Si chiede a ogni avvio della registrazione (chi entra a registrazione in
 * corso la vede gia' accesa). L'avvio lo riferisce al server chi modera, a
 * volte un attimo dopo che la sala lo vede: con `RECORDING_NOT_RUNNING` (409)
 * si riprova poco dopo, qualche volta, e cosi' con il limite delle richieste
 * (429) o un guasto del server. Il primo tentativo parte dopo un attimo a
 * caso: all'avvio tutta la sala chiede insieme, spesso dalla stessa rete. Un
 * errore non disturba la chiamata: senza pass si resta come prima, e il
 * prossimo avvio riprova.
 */

/** Le attese fra un tentativo e il successivo (ms), dopo il primo. */
const ATTESE_MS = [3_000, 8_000, 20_000, 45_000];
/** Il primo tentativo arriva entro questo tempo, a caso. */
const SPARPAGLIO_MS = 5_000;

export function usePresencePass(
  slug: string,
  /** La chiamata e' rapida e la registrazione e' in corso. */
  attivo: boolean,
  /** I token della sala consegnati in questa visita (gli ultimi in coda). */
  tokenSalaRef: RefObject<string[]>
): void {
  useEffect(() => {
    if (!attivo) return;
    let annullato = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const prova = async (tentativo: number): Promise<void> => {
      if (annullato) return;
      const roomTokens = tokenSalaRef.current ?? [];
      let riprova = roomTokens.length === 0;
      if (!riprova) {
        try {
          const res = await fetch(
            `/api/events/${encodeURIComponent(slug)}/recording/presence`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ roomTokens: roomTokens.slice(-50) }),
              credentials: 'same-origin',
            }
          );
          if (res.ok) return;
          if (res.status === 409 || res.status === 429 || res.status >= 500)
            riprova = true;
        } catch {
          riprova = true;
        }
      }
      const attesa = ATTESE_MS[tentativo];
      if (riprova && attesa !== undefined && !annullato) {
        timer = setTimeout(
          () => void prova(tentativo + 1),
          attesa + Math.random() * 1_000
        );
      }
    };

    timer = setTimeout(() => void prova(0), Math.random() * SPARPAGLIO_MS);
    return () => {
      annullato = true;
      if (timer) clearTimeout(timer);
    };
  }, [slug, attivo, tokenSalaRef]);
}
