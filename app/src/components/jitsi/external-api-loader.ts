/**
 * Caricamento di `external_api.js` dal server della conferenza.
 *
 * Il tag <script> sopravvive al componente che lo crea: un rientro in sala o
 * un «Riprova» montano un nuovo JitsiRoom mentre il tag del precedente e'
 * ancora nella pagina. Tre regole tengono in piedi il riuso:
 *
 * - si riusa solo un tag NOSTRO e ancora in caricamento, ascoltando sia
 *   `load` sia `error`: un tag gia' fallito non manda piu' eventi, e chi lo
 *   aspettasse resterebbe sullo spinner per sempre;
 * - un tag fallito si toglie subito dalla pagina, cosi' il tentativo dopo ne
 *   crea uno nuovo invece di trovarlo;
 * - uno script arrivato senza definire l'API (una pagina d'errore o di login
 *   al posto del file) conta come fallito, e il suo tag si butta.
 *
 * Il browser non distingue un certificato non accettato da una rete che non
 * arriva: per entrambi dice solo `error`. La sala li racconta insieme.
 */

/** Attributo che marca i tag creati qui, con il loro stato. */
export const EXTERNAL_API_ATTR = 'data-pa-jitsi-api';

interface LoadHandlers {
  onLoad: () => void;
  onError: () => void;
}

function apiDefined(): boolean {
  return typeof window !== 'undefined' && typeof window.JitsiMeetExternalAPI === 'function';
}

/**
 * Carica (o aspetta) `https://<domain>/external_api.js` e chiama `onLoad`
 * quando l'API e' disponibile, `onError` quando non lo sara'. Restituisce la
 * funzione che stacca i gestori: va chiamata allo smontaggio.
 */
export function loadExternalApi(domain: string, { onLoad, onError }: LoadHandlers): () => void {
  if (apiDefined()) {
    onLoad();
    return () => {};
  }

  let script = document.querySelector<HTMLScriptElement>(`script[${EXTERNAL_API_ATTR}="loading"]`);
  if (!script) {
    // Tag nostri arrivati senza API: non serviranno piu' a nessuno.
    document.querySelectorAll(`script[${EXTERNAL_API_ATTR}]`).forEach((s) => s.remove());
    const el = document.createElement('script');
    el.src = `https://${domain}/external_api.js`;
    el.async = true;
    el.setAttribute(EXTERNAL_API_ATTR, 'loading');
    // Stato del tag, indipendente da chi lo aspetta: registrati per primi,
    // girano prima dei gestori dei componenti.
    el.addEventListener('load', () => el.setAttribute(EXTERNAL_API_ATTR, 'loaded'));
    el.addEventListener('error', () => el.remove());
    document.head.appendChild(el);
    script = el;
  }

  const handleLoad = () => {
    if (apiDefined()) onLoad();
    else {
      script?.remove();
      onError();
    }
  };
  const handleError = () => onError();
  script.addEventListener('load', handleLoad);
  script.addEventListener('error', handleError);

  const attached = script;
  return () => {
    attached.removeEventListener('load', handleLoad);
    attached.removeEventListener('error', handleError);
  };
}
