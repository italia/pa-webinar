/**
 * Quale worker serve a ciascun tipo di job di post-produzione, e quale motore.
 *
 * Il worker con la GPU (nodo dedicato, molta memoria) fa la trascrizione
 * (WhisperX, pyannote) e il doppiaggio: Piper gira su CPU, ma la filigrana
 * AudioSeal elabora l'intera traccia in un colpo solo e per un evento lungo
 * chiede decine di GB. Sintesi e traduzioni chiedono il testo al servizio
 * vLLM, che ha la sua GPU, e l'archivio rimuxa senza ricodificare: questi
 * vanno al worker senza GPU, quando il chart lo prevede, e per una sintesi
 * si accende una sola A100 (quella di vLLM) invece di due.
 *
 * La traduzione di titolo e descrizione (TRANSLATE_TEXT) non usa vLLM: la fa
 * il motore di traduzione su CPU (postprod.mt nel chart). L'orchestratore
 * accende vLLM solo per i tipi di LLM_JOB_KINDS e il motore su CPU solo per
 * quelli di MT_JOB_KINDS (api/internal/postprod-pending).
 */

export const POSTPROD_JOB_KINDS = [
  'TRANSCRIBE',
  'TRANSCRIBE_MULTITRACK',
  'SUMMARIZE',
  'TRANSLATE',
  'SUBTITLE',
  'DUB',
  'ARCHIVE',
  'REPORT',
  'TRANSLATE_TEXT',
] as const;
export type PostprodJobKind = (typeof POSTPROD_JOB_KINDS)[number];

/** I job del worker con la GPU. Lo stesso elenco sta nel chart
 *  (templates/cronjob-postprod-worker.yaml). */
export const GPU_WORKER_KINDS: readonly PostprodJobKind[] = ['TRANSCRIBE', 'TRANSCRIBE_MULTITRACK', 'DUB'];

/** I job che il worker senza GPU puo' eseguire. */
export const CPU_WORKER_KINDS: readonly PostprodJobKind[] = POSTPROD_JOB_KINDS.filter(
  (k) => !GPU_WORKER_KINDS.includes(k),
);

/**
 * I job che chiedono testo a vLLM (infra/ai/worker/main.py): la trascrizione
 * per la correzione, sintesi, traduzioni e resoconto. Doppiaggio, archivio e
 * sottotitoli no, e la traduzione dei testi dell'evento usa il motore su CPU:
 * nessuno di questi accende la GPU di vLLM.
 */
export const LLM_JOB_KINDS: readonly PostprodJobKind[] = [
  'TRANSCRIBE',
  'TRANSCRIBE_MULTITRACK',
  'SUMMARIZE',
  'TRANSLATE',
  'REPORT',
];

/** I job del motore di traduzione su CPU (postprod.mt nel chart). */
export const MT_JOB_KINDS: readonly PostprodJobKind[] = ['TRANSLATE_TEXT'];

/** I job dell'evento, senza registrazione (`eventId`, `recordingId` nullo). */
export const EVENT_JOB_KINDS: readonly PostprodJobKind[] = ['REPORT', 'TRANSLATE_TEXT'];
