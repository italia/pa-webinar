/**
 * Chi vede i dati della pagina di stato.
 *
 * La pagina `/status` e le rotte che la alimentano espongono lo stato dei
 * servizi e la topologia dell'infrastruttura (domini, namespace, repliche).
 * Pubblicarli è una scelta dell'amministrazione (`SiteSetting.statusPageEnabled`):
 * spenta, la pagina non esiste e i suoi dati li vede solo l'amministratore,
 * che li ritrova nella mappa dell'infrastruttura della propria area.
 *
 * `/api/status` fa eccezione parziale: la sala live lo interroga per sapere se
 * il ponte video è pronto, quindi a pagina spenta risponde comunque, ma solo
 * con quei valori (vedi la rotta).
 */

import { cookies } from 'next/headers';

import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { getSettings } from '@/lib/settings';

/**
 * `public`: pagina accesa, la risposta è uguale per chiunque e una cache
 * condivisa può tenerla. `admin`: pagina spenta, la vede solo l'amministratore
 * — la risposta dipende dal suo cookie e non deve finire in una cache
 * condivisa, che la servirebbe a chi riceverebbe 404. `none`: 404.
 */
export type StatusDataAccess = 'public' | 'admin' | 'none';

export async function statusDataAccess(): Promise<StatusDataAccess> {
  if ((await getSettings()).statusPageEnabled) return 'public';
  return (await isAdminAuthenticated(await cookies())) ? 'admin' : 'none';
}

export async function statusDataVisible(): Promise<boolean> {
  return (await statusDataAccess()) !== 'none';
}

/** L'intestazione di cache di una risposta vista solo dall'amministratore. */
export const ADMIN_ONLY_CACHE_CONTROL = 'private, no-store';
