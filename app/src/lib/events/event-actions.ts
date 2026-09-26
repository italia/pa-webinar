/**
 * Le azioni sull'evento che l'amministrazione lancia da piu' punti (la
 * pagina dell'evento, il menu della sua scheda nell'elenco). Una sola
 * implementazione: due copie della stessa chiamata finiscono per divergere,
 * ed e' cosi' che un bottone smette di fare quello che fa l'altro.
 */

/** Cambia lo stato dell'evento (pubblica, ritira, avvia) col token del moderatore. */
export async function impostaStatoEvento(
  eventId: string,
  moderatorToken: string,
  status: 'DRAFT' | 'PUBLISHED' | 'LIVE',
): Promise<void> {
  const res = await fetch(`/api/events/${eventId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${moderatorToken}` },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`stato evento: ${res.status}`);
}

/**
 * Duplica l'evento come prossima occorrenza. La copia nasce in bozza; il
 * token serve a chi chiama per aprirne la modifica, che senza risponde 404.
 */
export async function duplicaComeProssima(
  eventId: string,
): Promise<{ id: string; moderatorToken: string }> {
  const res = await fetch(`/api/admin/events/${eventId}/duplicate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nextOccurrence: true }),
  });
  if (!res.ok) throw new Error(`duplicazione: ${res.status}`);
  const creato = (await res.json()) as { id: string; moderatorToken?: string };
  if (!creato.moderatorToken) throw new Error('duplicazione: token mancante');
  return { id: creato.id, moderatorToken: creato.moderatorToken };
}
