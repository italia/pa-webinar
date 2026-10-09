/**
 * Chi organizza e chi interviene, come lo mostra la pagina pubblica
 * dell'evento: gli enti che organizzano (EventOrganizer) e le persone con una
 * concessione che chi compila ha scelto di pubblicare (EventModerator con
 * `publicListed`).
 */

import type { PersonRole } from './grant-profile';

export interface PersonaPubblica {
  name: string;
  role: PersonRole;
  organization: string | null;
  logoUrl: string | null;
}

export interface EntePubblico {
  name: string;
  logoUrl: string | null;
  websiteUrl: string | null;
}

/**
 * Un logo si mostra solo se lo serve l'app (`/api/assets/…`): la pagina non
 * fa contattare a chi la visita un sito terzo (e la CSP lo bloccherebbe).
 * Restituisce il percorso, che vale su qualunque origine dell'app.
 */
export function logoPubblico(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, 'http://app.invalid');
    return u.pathname.startsWith('/api/assets/') ? u.pathname : null;
  } catch {
    return null;
  }
}

/** Il sito di un ente, solo se è un indirizzo web. */
export function sitoPubblico(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Il ruolo da mostrare per una concessione. */
export function ruoloPubblico(g: { role: 'MODERATOR' | 'SPEAKER'; organizer: boolean }): PersonRole {
  if (g.role === 'SPEAKER') return 'speaker';
  return g.organizer ? 'organizer' : 'moderator';
}

/** Prima chi organizza, poi chi conduce, poi chi parla; a parità, per nome. */
export function ordinaPersone(persone: PersonaPubblica[]): PersonaPubblica[] {
  const peso: Record<PersonRole, number> = { organizer: 0, moderator: 1, speaker: 2 };
  return [...persone].sort(
    (a, b) => peso[a.role] - peso[b.role] || a.name.localeCompare(b.name, 'it'),
  );
}
