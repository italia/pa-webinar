/**
 * Claim del work-order dal portale (ADR-013 Fase 3).
 *
 * L'operator avvia il recorder passando solo RECORDING_ID/EVENT_ID. All'avvio
 * il recorder reclama lo specifico recording e riceve JWT bot + nome stanza
 * da `POST /api/internal/recorder-claim` (x-api-key). Le credenziali Jitsi
 * non vivono quindi nell'operator né nello spec del Job/container.
 */

export interface WorkOrder {
  recordingId: string;
  eventId: string;
  roomName: string;
  jwt: string;
}

export async function claimWorkOrder(opts: {
  portalUrl: string;
  cronApiKey: string;
  recordingId: string;
  fetchImpl?: typeof fetch;
}): Promise<WorkOrder> {
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${opts.portalUrl.replace(/\/+$/, '')}/api/internal/recorder-claim`;
  const res = await doFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': opts.cronApiKey,
    },
    body: JSON.stringify({ recordingId: opts.recordingId }),
  });
  if (!res.ok) {
    throw new Error(`recorder-claim fallito: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as WorkOrder;
}
