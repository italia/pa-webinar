/**
 * Una persona nuova dell'evento, prima di entrare nell'elenco: la usano il
 * modulo del passo «Persone» e quello breve del passo «Programma», con le
 * stesse regole. Nome ed email servono (ognuno riceve un proprio link), un
 * indirizzo vale una persona sola, organizzatore principale compreso.
 */

import type { PersonRole } from '@/lib/events/grant-profile';

import type {
  ModeratorEntry,
  PersonProfile,
  SpeakerEntry,
  StepPeopleValue,
} from './step-2-people';
import { emailValida } from './validation';

/** La persona come la si sta scrivendo. */
export interface Bozza extends PersonProfile {
  name: string;
  email: string;
  personId: string | null;
  role: PersonRole;
}

// «Mostra nella pagina pubblica» parte spento per tutti: pubblicare nome ed
// ente di una persona è una scelta, persona per persona.
export const BOZZA_VUOTA: Bozza = {
  name: '',
  email: '',
  personId: null,
  role: 'speaker',
  organization: null,
  organizationLogoUrl: null,
  publicListed: false,
  photoId: null,
};

/** Perche' una persona non si aggiunge: le chiavi dei messaggi del passo
 *  «Persone» (`admin.wizard.step3`). */
export type ErrorePersona = 'personRequired' | 'invalidEmail' | 'duplicateEmail';

/**
 * Gli indirizzi gia' usati: le persone dell'elenco e quelli indicati a parte
 * (l'organizzatore principale), senza distinguere maiuscole: quelli di un
 * evento esistente possono averne.
 */
export function indirizziPresi(
  moderators: ReadonlyArray<{ email: string }>,
  speakers: ReadonlyArray<{ email: string }>,
  altri: readonly string[] = []
): Set<string> {
  return new Set(
    [...moderators.map((m) => m.email), ...speakers.map((s) => s.email), ...altri]
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

/** La bozza pronta per l'elenco, o perche' non lo e'. */
export function controllaBozza(
  bozza: Bozza,
  presi: ReadonlySet<string>
): { persona: SpeakerEntry; role: PersonRole } | { errore: ErrorePersona } {
  if (!bozza.name.trim() || !bozza.email.trim()) return { errore: 'personRequired' };
  const email = bozza.email.trim().toLowerCase();
  if (!emailValida(email)) return { errore: 'invalidEmail' };
  if (presi.has(email)) return { errore: 'duplicateEmail' };
  return {
    role: bozza.role,
    persona: {
      name: bozza.name.trim(),
      email,
      personId: bozza.personId,
      organization: bozza.organization?.trim() || null,
      organizationLogoUrl: bozza.organizationLogoUrl?.trim() || null,
      publicListed: bozza.publicListed,
      photoId: bozza.photoId ?? null,
    },
  };
}

/** Mette una persona nell'elenco del suo ruolo. */
export function conRuolo(
  moderators: ModeratorEntry[],
  speakers: SpeakerEntry[],
  persona: SpeakerEntry,
  role: PersonRole
): Pick<StepPeopleValue, 'moderators' | 'speakers'> {
  if (role === 'speaker') return { moderators, speakers: [...speakers, persona] };
  return {
    moderators: [...moderators, { ...persona, organizer: role === 'organizer' }],
    speakers,
  };
}
