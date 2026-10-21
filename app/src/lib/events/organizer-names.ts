/**
 * Chi organizza un evento, come testo: gli enti organizzatori nell'ordine
 * scelto, altrimenti il nome libero (`organizerName`), che resta per gli
 * eventi senza enti, per esempio le registrazioni caricate. Stringa vuota se
 * non c'e' nessuno.
 */
export function nomiOrganizzatori(evento: {
  organizers?: Array<{ name: string }> | null;
  organizerName?: string | null;
}): string {
  const enti = (evento.organizers ?? []).map((o) => o.name.trim()).filter(Boolean);
  return enti.length > 0 ? enti.join(', ') : (evento.organizerName?.trim() ?? '');
}
