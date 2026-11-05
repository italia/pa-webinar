// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { captionsTranscriptActive } from '@/lib/captions/availability';

/**
 * Cosa si sta catturando in sala oltre alla registrazione di Jibri, che la
 * sala sa da sola dall'evento di Jitsi. Il registratore per persona parte
 * quando l'evento va in diretta (GET /api/internal/recorder-desired, con le
 * stesse condizioni), e la trascrizione dai sottotitoli gira finche' i
 * sottotitoli sono accesi, anche a chi prova prima della diretta: nessuno dei
 * due passa da un comando in sala.
 *
 * Si guarda la configurazione dell'evento, non il registratore: uno che si sta
 * ancora accendendo conta come acceso. Sbagliare per eccesso costa un avviso;
 * sbagliare per difetto vuol dire catturare senza dirlo.
 *
 * La trascrizione dal video completo, dopo l'evento, non e' una cattura in
 * sala: la annuncia la sala d'attesa (`waiting.aiNotice`).
 */
export interface StatoCattura {
  /** Si registra l'audio di ciascuno, per chi ha acconsentito. */
  registrazione: boolean;
  /** Si conserva il testo degli interventi di chi ha acconsentito. */
  trascrizione: boolean;
}

const STATI_CON_SALA = ['PUBLISHED', 'IDLE', 'PROVISIONING', 'LIVE'];

export function statoCattura(
  evento: {
    status: string;
    recordingEnabled: boolean;
    aiTranscriptEnabled: boolean;
    multitrackRecordingEnabled: boolean;
    captionsTranscriptEnabled: boolean;
    liveCaptionsEnabled?: boolean | null;
  },
  sito: { liveCaptionsEnabled?: boolean | null },
  registrazioneDisponibile = true
): StatoCattura {
  const tracce =
    registrazioneDisponibile &&
    evento.status === 'LIVE' &&
    evento.recordingEnabled &&
    evento.aiTranscriptEnabled &&
    evento.multitrackRecordingEnabled;
  const sottotitoli =
    STATI_CON_SALA.includes(evento.status) && captionsTranscriptActive(evento, sito);
  return { registrazione: tracce, trascrizione: tracce || sottotitoli };
}

/** Lo stato nella risposta di `/lifecycle`; `null` se la risposta non lo porta. */
export function catturaDallaRisposta(risposta: unknown): StatoCattura | null {
  const cattura = (
    risposta as { capture?: { recording?: unknown; transcription?: unknown } } | null
  )?.capture;
  if (
    typeof cattura?.recording !== 'boolean' ||
    typeof cattura.transcription !== 'boolean'
  )
    return null;
  return { registrazione: cattura.recording, trascrizione: cattura.transcription };
}
