/**
 * Il messaggio da mostrare per una risposta d'errore di un'API del portale.
 *
 * Il campo `error` delle risposte e' per chi sviluppa: e' in inglese e parla
 * di modelli e campi. All'utente si dice cosa e' successo nella sua lingua
 * (chiavi `apiErrors.*`), in quest'ordine:
 *  1. il `code` della risposta, quando nomina una condizione precisa che
 *     l'utente puo' risolvere (la pipeline AI spenta, una trascrizione
 *     corretta a mano);
 *  2. i casi che contano per la schermata (`propri`, per stato HTTP);
 *  3. lo stato HTTP, solo dove il significato e' lo stesso per ogni rotta;
 *  4. il messaggio di ripiego della schermata.
 * Il 409 non ha un testo generico: nelle nostre API vuol dire spesso un
 * conflitto che dura (un evento non attivo), e «ricarica e riprova» sarebbe
 * un consiglio sbagliato.
 */
export type ApiErrorKey =
  | 'unauthorized'
  | 'forbidden'
  | 'notFound'
  | 'tooLarge'
  | 'rateLimited'
  | 'aiPipelineDisabled'
  | 'recordingWithoutMedia'
  | 'transcriptCorrected'
  | 'noParticipantTracks'
  | 'summaryMissing'
  | 'storageUnavailable'
  | 'aiDisabledForEvent'
  | 'sourceTranscriptMissing'
  | 'sameLanguage';

/** I codici d'errore che le rotte usano per le condizioni sopra. */
export const API_ERROR_CODES = {
  AI_PIPELINE_DISABLED: 'aiPipelineDisabled',
  RECORDING_WITHOUT_MEDIA: 'recordingWithoutMedia',
  TRANSCRIPT_CORRECTED: 'transcriptCorrected',
  NO_PARTICIPANT_TRACKS: 'noParticipantTracks',
  SUMMARY_MISSING: 'summaryMissing',
  STORAGE_UNAVAILABLE: 'storageUnavailable',
  AI_DISABLED_FOR_EVENT: 'aiDisabledForEvent',
  SOURCE_TRANSCRIPT_MISSING: 'sourceTranscriptMissing',
  SAME_LANGUAGE: 'sameLanguage',
} as const satisfies Record<string, ApiErrorKey>;

const PER_STATO: Partial<Record<number, ApiErrorKey>> = {
  401: 'unauthorized',
  403: 'forbidden',
  404: 'notFound',
  413: 'tooLarge',
  429: 'rateLimited',
};

export function messaggioErroreApi(
  stato: number,
  t: (chiave: ApiErrorKey) => string,
  ripiego: string,
  propri: Partial<Record<number, string>> = {},
  codice?: string | null,
): string {
  if (codice && Object.hasOwn(API_ERROR_CODES, codice)) {
    return t(API_ERROR_CODES[codice as keyof typeof API_ERROR_CODES]);
  }
  const proprio = propri[stato];
  if (proprio) return proprio;
  const chiave = PER_STATO[stato];
  return chiave ? t(chiave) : ripiego;
}

/** Il `code` del corpo di una risposta d'errore, se c'e'. */
export async function codiceErrore(risposta: Response): Promise<string | null> {
  try {
    const corpo = (await risposta.json()) as { code?: unknown } | null;
    return typeof corpo?.code === 'string' ? corpo.code : null;
  } catch {
    return null;
  }
}
