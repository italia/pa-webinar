/**
 * La richiesta dell'elenco dei materiali della sala (MaterialPanel), fuori dal
 * componente perché si possa verificare senza caricare design-react-kit.
 *
 * Solo chi conduce manda il token: il server allarga l'elenco con il solo
 * token moderatore (lib/events/material-access), cioè esattamente quando
 * `isModerator` è vero, e i contrassegni di visibilità del pannello seguono la
 * stessa regola. Per iscritti, relatori e ospiti la risposta è la vista del
 * pubblico con o senza token, e mandarlo costerebbe una lookup nel DB a ogni
 * giro di polling per ogni partecipante.
 */
export function materialsListKey(
  eventSlug: string,
  token: string,
  isModerator: boolean,
): [string, string] {
  return [`/api/events/${eventSlug}/materials`, isModerator ? token : ''];
}

/** Fetcher SWR per `materialsListKey`. `Bearer ` vuoto non è un'identità:
 *  senza token, nessun header. */
export function fetchMaterials<T>([url, token]: readonly [string, string]): Promise<T> {
  return fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined).then(
    (r) => r.json() as Promise<T>,
  );
}
