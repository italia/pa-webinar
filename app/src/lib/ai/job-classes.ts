/**
 * Quale worker serve a ciascun tipo di job di post-produzione.
 *
 * Il worker con la GPU (nodo dedicato, molta memoria) fa la trascrizione
 * (WhisperX, pyannote) e il doppiaggio: Piper gira su CPU, ma la filigrana
 * AudioSeal elabora l'intera traccia in un colpo solo e per un evento lungo
 * chiede decine di GB. Sintesi e traduzioni chiedono il testo al servizio
 * vLLM, che ha la sua GPU, e l'archivio rimuxa senza ricodificare: questi
 * vanno al worker senza GPU, quando il chart lo prevede, e per una sintesi
 * si accende una sola A100 (quella di vLLM) invece di due.
 */

export const POSTPROD_JOB_KINDS = [
  'TRANSCRIBE',
  'TRANSCRIBE_MULTITRACK',
  'SUMMARIZE',
  'TRANSLATE',
  'SUBTITLE',
  'DUB',
  'ARCHIVE',
] as const;
export type PostprodJobKind = (typeof POSTPROD_JOB_KINDS)[number];

/** I job del worker con la GPU. Lo stesso elenco sta nel chart
 *  (templates/cronjob-postprod-worker.yaml). */
export const GPU_WORKER_KINDS: readonly PostprodJobKind[] = ['TRANSCRIBE', 'TRANSCRIBE_MULTITRACK', 'DUB'];

/** I job che il worker senza GPU puo' eseguire. */
export const CPU_WORKER_KINDS: readonly PostprodJobKind[] = POSTPROD_JOB_KINDS.filter(
  (k) => !GPU_WORKER_KINDS.includes(k),
);
