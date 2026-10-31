/**
 * Indirizzi delle pagine di gestione di un evento nell'area riservata.
 *
 * Lo staff ci entra con la propria sessione: il token del moderatore resta
 * fuori dall'indirizzo, dove finirebbe nella cronologia del browser, nei log
 * dei proxy e in ogni condivisione dello schermo. Lo si aggiunge solo per chi
 * e' entrato col link del moderatore e non ha un'altra credenziale.
 */
import type { WizardAdvancedSection, WizardStep } from '@/lib/events/wizard-steps';

/** Le schede della pagina di gestione dell'evento. */
export const EVENT_ADMIN_TABS = ['panoramica', 'persone', 'contenuti', 'dopo', 'statistiche'] as const;
export type EventAdminTab = (typeof EVENT_ADMIN_TABS)[number];

/** La scheda chiesta dall'indirizzo, se esiste. */
export function eventAdminTab(valore: string | null | undefined): EventAdminTab | null {
  return (EVENT_ADMIN_TABS as readonly string[]).includes(valore ?? '') ? (valore as EventAdminTab) : null;
}

export function eventAdminPath(
  id: string,
  opts: {
    edit?: boolean;
    viaToken?: string | null;
    step?: WizardStep | null;
    /** La sezione delle impostazioni avanzate da aprire. */
    section?: WizardAdvancedSection | null;
    /** La scheda della pagina di gestione da aprire (non per la modifica). */
    tab?: EventAdminTab | null;
    /** La modifica apre una copia appena duplicata: con la data della prossima
     *  edizione o con le stesse date dell'originale. */
    copia?: 'prossima' | 'stesse' | null;
  } = {},
): string {
  const base = `/admin/events/${id}${opts.edit ? '/edit' : ''}`;
  const query: string[] = [];
  // Il passo del wizard da cui partire (solo per la modifica).
  if (opts.edit && opts.step) query.push(`step=${opts.step}`);
  if (opts.edit && opts.step === 'advanced' && opts.section) query.push(`section=${opts.section}`);
  if (!opts.edit && opts.tab) query.push(`tab=${opts.tab}`);
  if (opts.edit && opts.copia) query.push(`copia=${opts.copia}`);
  if (opts.viaToken) query.push(`token=${encodeURIComponent(opts.viaToken)}`);
  return query.length > 0 ? `${base}?${query.join('&')}` : base;
}
