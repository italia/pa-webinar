/**
 * Indirizzi delle pagine di gestione di un evento nell'area riservata.
 *
 * Lo staff ci entra con la propria sessione: il token del moderatore resta
 * fuori dall'indirizzo, dove finirebbe nella cronologia del browser, nei log
 * dei proxy e in ogni condivisione dello schermo. Lo si aggiunge solo per chi
 * e' entrato col link del moderatore e non ha un'altra credenziale.
 */
import type { WizardAdvancedSection, WizardStep } from '@/lib/events/wizard-steps';

export function eventAdminPath(
  id: string,
  opts: {
    edit?: boolean;
    viaToken?: string | null;
    step?: WizardStep | null;
    /** La sezione delle impostazioni avanzate da aprire. */
    section?: WizardAdvancedSection | null;
  } = {},
): string {
  const base = `/admin/events/${id}${opts.edit ? '/edit' : ''}`;
  const query: string[] = [];
  // Il passo del wizard da cui partire (solo per la modifica).
  if (opts.edit && opts.step) query.push(`step=${opts.step}`);
  if (opts.edit && opts.step === 'advanced' && opts.section) query.push(`section=${opts.section}`);
  if (opts.viaToken) query.push(`token=${encodeURIComponent(opts.viaToken)}`);
  return query.length > 0 ? `${base}?${query.join('&')}` : base;
}
