import { issueRubricaOptOutToken } from '@/lib/persons/opt-out-token';
import { localizedUrl } from '@/lib/utils/localized-url';

/**
 * Il link firmato per uscire dalla rubrica, da mettere nelle email a chi ci
 * e' entrato (ADR-011). Ritirare il consenso deve essere facile quanto darlo
 * (GDPR art. 7.3): il modulo di iscrizione promette questo link in ogni email.
 *
 * `null` quando non va mostrato: l'iscrizione non e' legata a una persona in
 * rubrica, la persona ne e' gia' uscita, oppure il token non si puo' firmare
 * (APP_SECRET assente). In quel caso l'email resta quella di prima: meglio
 * nessun link che un link che non funziona.
 *
 * Il token e' una capacita' ristretta (solo l'uscita dalla rubrica di quella
 * persona, 90 giorni): non va nei log.
 */
export function rubricaOptOutUrl(
  person: { id: string; optedInToAddressBook: boolean } | null | undefined,
  baseUrl: string,
  locale: string,
): string | null {
  if (!person?.optedInToAddressBook) return null;
  let token: string;
  try {
    token = issueRubricaOptOutToken(person.id);
  } catch {
    return null;
  }
  return localizedUrl(
    baseUrl.replace(/\/+$/, ''),
    `/rubrica/opt-out?token=${encodeURIComponent(token)}`,
    locale,
  );
}
