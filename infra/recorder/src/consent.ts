/**
 * Il consenso alla registrazione della voce, chiesto al portale per ogni
 * traccia prima di registrarla.
 *
 * Il registratore vede solo l'endpoint del bridge di chi parla; il portale sa
 * di chi e' (Prosody gli dice chi c'e' in sala) e se ha dato il consenso alla
 * trascrizione dei propri interventi. Senza consenso la traccia non si
 * registra: chi non acconsente partecipa lo stesso, ma la sua voce non finisce
 * in un file.
 *
 * Nel dubbio non si registra: un portale che non risponde non autorizza
 * niente. Prosody potrebbe segnalare l'ingresso un attimo dopo che la traccia
 * e' arrivata, quindi un «no» si richiede ancora un paio di volte. Se alla
 * fine il portale non conosce l'endpoint, lo si scrive nel log: se succede a
 * tutti, Prosody non manda gli occupanti (mod_pa_occupants) e il registratore
 * non registra nessuno.
 */

export interface ConsentCheckOptions {
  portalUrl: string;
  cronApiKey: string;
  eventId: string;
  fetchImpl?: typeof fetch;
  /** Attese prima dei nuovi tentativi dopo un «no». */
  retryDelaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

interface Risposta {
  record: boolean;
  /** Il portale non sa di chi e' l'endpoint. */
  sconosciuto: boolean;
}

export function makeConsentCheck(opts: ConsentCheckOptions): (endpointId: string) => Promise<boolean> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const delays = opts.retryDelaysMs ?? [3000, 10_000];

  const log = opts.log ?? ((msg: string) => console.warn(msg));
  const askOnce = async (endpointId: string): Promise<Risposta> => {
    const url = new URL(`${opts.portalUrl}/api/internal/recorder/consent`);
    url.searchParams.set('eventId', opts.eventId);
    url.searchParams.set('endpoint', endpointId);
    try {
      const res = await fetchImpl(url, {
        headers: { 'x-api-key': opts.cronApiKey },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { record: false, sconosciuto: false };
      const body = (await res.json()) as { record?: unknown; reason?: unknown };
      return { record: body.record === true, sconosciuto: body.reason === 'unknown' };
    } catch {
      return { record: false, sconosciuto: false };
    }
  };

  return async (endpointId: string) => {
    let risposta = await askOnce(endpointId);
    for (const delay of delays) {
      if (risposta.record) return true;
      await sleep(delay);
      risposta = await askOnce(endpointId);
    }
    if (!risposta.record && risposta.sconosciuto) {
      log(
        `[consent] il portale non conosce l'endpoint ${endpointId}: Prosody manda gli occupanti (mod_pa_occupants)?`,
      );
    }
    return risposta.record;
  };
}
