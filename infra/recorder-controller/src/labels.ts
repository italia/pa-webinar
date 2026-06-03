/**
 * Identificatori condivisi fra i runner (K8s label / Docker label) così il
 * dedup e l'elenco usano le stesse chiavi indipendentemente dall'ambiente.
 */

export const COMPONENT_LABEL = 'app.kubernetes.io/component';
export const COMPONENT_VALUE = 'recorder';
/** Lega un'unità di lavoro al suo recordingId (chiave del dedup). */
export const RECORDING_ID_LABEL = 'eventi-dtd.it/recording-id';
export const EVENT_ID_LABEL = 'eventi-dtd.it/event-id';

/** Nome/handle deterministico per recordingId (idempotenza lato API). */
export function recorderHandleName(recordingId: string): string {
  const compact = recordingId.replace(/-/g, '').slice(0, 20);
  return `recorder-${compact}`;
}
