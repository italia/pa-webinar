/**
 * Indirizzi delle pagine di gestione di un evento nell'area riservata.
 *
 * Lo staff ci entra con la propria sessione: il token del moderatore resta
 * fuori dall'indirizzo, dove finirebbe nella cronologia del browser, nei log
 * dei proxy e in ogni condivisione dello schermo. Lo si aggiunge solo per chi
 * e' entrato col link del moderatore e non ha un'altra credenziale.
 */
export function eventAdminPath(
  id: string,
  opts: { edit?: boolean; viaToken?: string | null } = {},
): string {
  const base = `/admin/events/${id}${opts.edit ? '/edit' : ''}`;
  return opts.viaToken ? `${base}?token=${encodeURIComponent(opts.viaToken)}` : base;
}
