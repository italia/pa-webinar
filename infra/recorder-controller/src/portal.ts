/**
 * Client HTTP verso il portale. L'operator legge SOLO lo stato desiderato
 * (quali eventi LIVE devono avere un recorder); non tocca credenziali —
 * JWT bot e presign li conia il portale al `recorder-claim` lato recorder.
 */

import type { DesiredRecorder } from './reconcile';

export interface PortalClientOptions {
  portalUrl: string;
  cronApiKey: string;
  fetchImpl?: typeof fetch;
}

interface RecorderDesiredResponse {
  recorders: Array<{ recordingId: string; eventId: string }>;
}

export class PortalClient {
  constructor(private readonly opts: PortalClientOptions) {}

  private get fetchImpl(): typeof fetch {
    return this.opts.fetchImpl ?? fetch;
  }

  /**
   * GET /api/internal/recorder-desired → eventi LIVE che devono avere un
   * recorder attivo (aiTranscriptEnabled + consenso multi-traccia). Il
   * portale crea/garantisce la riga Recording e ritorna il suo id.
   */
  async getRecorderDesired(): Promise<DesiredRecorder[]> {
    const res = await this.fetchImpl(
      `${this.opts.portalUrl}/api/internal/recorder-desired`,
      { headers: { 'x-api-key': this.opts.cronApiKey } },
    );
    if (!res.ok) {
      throw new Error(`recorder-desired: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as RecorderDesiredResponse;
    return body.recorders.map((r) => ({
      recordingId: r.recordingId,
      eventId: r.eventId,
    }));
  }
}
