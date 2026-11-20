// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

'use client';

import { useCallback, useEffect, useReducer } from 'react';

import {
  aggiornaDomanda,
  domandaAperta,
  DOMANDA_INIZIALE,
} from '@/lib/live/recording-question';

/**
 * La domanda a chi e' fuori dalla registrazione di una chiamata rapida, a ogni
 * avvio (lib/live/recording-question). La sala la monta una volta; la finestra
 * e' components/live/recording-question.
 */
export function useRecordingQuestion({
  attiva,
  inCorso,
  fuori,
}: {
  /** Una chiamata rapida che registra, con la persona in sala. */
  attiva: boolean;
  /** La registrazione e' in corso (`recordingStatusChanged` di Jitsi). */
  inCorso: boolean;
  /** Il token in uso esclude la persona dalla registrazione; null senza token. */
  fuori: boolean | null;
}): { aperta: boolean; rispondi: () => void } {
  const [stato, invia] = useReducer(aggiornaDomanda, DOMANDA_INIZIALE);
  // Fuori dalla sala non si contano giri: rientrando, la domanda torna come per
  // chi entra a registrazione in corso.
  const registra = attiva && inCorso;
  useEffect(() => {
    invia({ tipo: 'registrazione', inCorso: registra });
  }, [registra]);
  // Anche a ogni giro nuovo: chi e' gia' nella registrazione non va chiesto.
  useEffect(() => {
    if (fuori === false) invia({ tipo: 'dentro' });
  }, [fuori, stato.giro, stato.inCorso]);
  const rispondi = useCallback(() => invia({ tipo: 'risposta' }), []);
  return { aperta: attiva && domandaAperta(stato, fuori), rispondi };
}
