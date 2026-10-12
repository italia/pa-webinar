/**
 * Lo stato di una registrazione come lo dice l'interfaccia: la chiave di
 * admin.postprod per ciascun valore di RecordingStatus. Un valore sconosciuto
 * (un enum piu' nuovo dell'interfaccia) resta com'e'.
 */
export const RECORDING_STATUS_KEYS: Record<string, string> = {
  READY: 'statusReady',
  POSTPROD_QUEUED: 'statusQueued',
  POSTPROD_RUNNING: 'statusRunning',
  POSTPROD_PARTIAL: 'statusPartial',
  POSTPROD_DONE: 'statusDone',
  POSTPROD_FAILED: 'statusFailed',
  ARCHIVED: 'statusArchived',
};

export function recordingStatusLabel(status: string, t: (key: string) => string): string {
  const key = RECORDING_STATUS_KEYS[status];
  return key ? t(key) : status;
}

/** Il colore del badge per lo stato di una registrazione o di un job. */
export function statusBadgeClass(status: string): string {
  switch (status) {
    case 'POSTPROD_DONE':
    case 'DONE':
      return 'bg-success';
    case 'POSTPROD_FAILED':
    case 'FAILED':
      return 'bg-danger';
    case 'POSTPROD_PARTIAL':
      return 'bg-warning text-dark';
    case 'POSTPROD_RUNNING':
    case 'RUNNING':
    case 'CLAIMED':
      return 'bg-info text-dark';
    case 'POSTPROD_QUEUED':
    case 'PENDING':
      return 'bg-secondary';
    default:
      return 'bg-light text-dark';
  }
}
