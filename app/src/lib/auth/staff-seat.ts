import { cookies } from 'next/headers';
import { cache } from 'react';

import { getStaffSession, puoGestire, staffPerIntestazione } from './staff-session';

/**
 * Chi dello staff c'e' dietro il link primario di un evento.
 *
 * Il link primario e' condiviso dalla squadra che conduce: chi lo apre e'
 * «un moderatore», non una persona. Se pero' chi lo apre ha anche una sessione
 * dello staff con un account che gestisce l'evento (chi entra in sala
 * dall'area di amministrazione), quella persona e' nota: entra con il suo
 * nome, e in chat ha un posto suo (puo' correggere i propri messaggi).
 *
 * Nessuna credenziale nuova: vale finche' vale la sessione. Disattivare
 * l'account o togliergli l'evento lo toglie anche da qui; il link primario
 * resta quello di prima, per chi non ha un account (la chiave dell'istanza,
 * chi ha ricevuto solo il link).
 */
export const staffDietroIlPrimario = cache(async function staffDietroIlPrimario(
  eventId: string
): Promise<{ accountId: string; nome: string } | null> {
  let store: Awaited<ReturnType<typeof cookies>>;
  try {
    store = await cookies();
  } catch {
    // Fuori da una richiesta: nessuna sessione.
    return null;
  }
  // Senza il cookie della sessione non si paga ne' la verifica ne' la lettura.
  if (!store.get('admin_session')) return null;
  const session = await getStaffSession(store);
  if (!session?.accountId || !(await puoGestire(session, eventId))) return null;
  const nome = (await staffPerIntestazione(store))?.nome?.trim();
  return nome ? { accountId: session.accountId, nome } : null;
});
