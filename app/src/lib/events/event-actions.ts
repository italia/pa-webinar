// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

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
  status: 'DRAFT' | 'PUBLISHED' | 'LIVE' | 'ENDED',
): Promise<void> {
  const res = await fetch(`/api/events/${eventId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${moderatorToken}` },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`stato evento: ${res.status}`);
}

/**
 * Duplica l'evento come prossima occorrenza. La copia nasce in bozza, e chi
 * chiama ne apre la modifica.
 */
export async function duplicaComeProssima(
  eventId: string,
): Promise<{ id: string; dataProssima: boolean }> {
  const res = await fetch(`/api/admin/events/${eventId}/duplicate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nextOccurrence: true }),
  });
  if (!res.ok) throw new Error(`duplicazione: ${res.status}`);
  // La copia si apre con la sessione dello staff (la rotta e' solo sua): il
  // token della copia non serve a chi l'ha creata.
  const creato = (await res.json()) as { id?: string; scheduleProjected?: boolean };
  if (!creato.id) throw new Error('duplicazione: risposta senza id');
  // Senza cadenza la copia ha le stesse date dell'originale: chi la apre
  // deve saperlo.
  return { id: creato.id, dataProssima: creato.scheduleProjected === true };
}

/**
 * L'eliminazione: con il link di conduzione, o, per lo staff che non lo ha,
 * con la sessione (la stessa rotta della selezione nell'elenco).
 */
export async function eliminaEvento(
  eventId: string,
  moderatorToken: string,
): Promise<{ ok: true } | { ok: false; codice?: string }> {
  if (!moderatorToken) {
    const res = await fetch('/api/admin/events/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [eventId] }),
    });
    const esito = res.ok
      ? ((await res.json().catch(() => ({}))) as { deleted?: number; skippedLive?: number })
      : null;
    if (esito && (esito.deleted ?? 0) > 0) return { ok: true };
    return { ok: false, codice: (esito?.skippedLive ?? 0) > 0 ? 'EVENT_LIVE' : undefined };
  }
  const res = await fetch(`/api/events/${eventId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${moderatorToken}` },
  });
  if (res.ok) return { ok: true };
  const body = (await res.json().catch(() => ({}))) as { code?: string };
  return { ok: false, codice: body.code };
}
