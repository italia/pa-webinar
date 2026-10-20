/**
 * Invio di un file con l'avanzamento e la possibilita' di annullarlo.
 *
 * `fetch` non dice quanta parte del corpo e' partita: per una barra di
 * avanzamento serve XMLHttpRequest. La promessa non fallisce mai: l'esito
 * dice se il server ha accettato, ha risposto con un errore, se la rete non
 * c'era o se l'invio e' stato annullato. Il testo dell'errore del server non
 * esce di qui: conta lo stato, piu' il codice applicativo se c'e'.
 */

export type EsitoInvio =
  | { tipo: 'ok'; corpo: unknown }
  | { tipo: 'errore'; status: number; codice?: string }
  | { tipo: 'rete' }
  | { tipo: 'annullato' };

export interface OpzioniInvio {
  /** Da 0 a 100, mentre il corpo parte. */
  onProgress?: (percentuale: number) => void;
  signal?: AbortSignal;
}

function leggiJson(testo: string): unknown {
  try {
    return JSON.parse(testo) as unknown;
  } catch {
    return null;
  }
}

export function inviaFile(
  url: string,
  corpo: FormData,
  { onProgress, signal }: OpzioniInvio = {}
): Promise<EsitoInvio> {
  return new Promise((risolvi) => {
    if (signal?.aborted) {
      risolvi({ tipo: 'annullato' });
      return;
    }
    const xhr = new XMLHttpRequest();
    const annulla = () => xhr.abort();
    // A richiesta finita l'annullamento non serve piu': si stacca.
    const fine = (esito: EsitoInvio) => {
      signal?.removeEventListener('abort', annulla);
      risolvi(esito);
    };
    xhr.open('POST', url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) {
        onProgress?.(Math.min(100, Math.round((e.loaded / e.total) * 100)));
      }
    };
    xhr.onload = () => {
      const json = leggiJson(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        fine({ tipo: 'ok', corpo: json });
        return;
      }
      const codice =
        json &&
        typeof json === 'object' &&
        typeof (json as { code?: unknown }).code === 'string'
          ? (json as { code: string }).code
          : undefined;
      fine({ tipo: 'errore', status: xhr.status, codice });
    };
    xhr.onerror = () => fine({ tipo: 'rete' });
    xhr.onabort = () => fine({ tipo: 'annullato' });
    signal?.addEventListener('abort', annulla, { once: true });
    xhr.send(corpo);
  });
}

/** Cosa dire a chi carica, per stato e codice della risposta. */
export type ErroreCaricamento =
  'troppoGrande' | 'tipo' | 'nonDisponibile' | 'accesso' | 'troppi' | 'generico';

export function erroreDaRisposta(status: number, codice?: string): ErroreCaricamento {
  if (status === 413) return 'troppoGrande';
  if (status === 415) return 'tipo';
  if (status === 503 && codice === 'STORAGE_UNAVAILABLE') return 'nonDisponibile';
  if (status === 401 || status === 403) return 'accesso';
  if (status === 429) return 'troppi';
  return 'generico';
}
