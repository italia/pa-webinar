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

/** Le relazioni da leggere per `entiEPersonePubblici` (da unire
 *  all'`include` di Prisma): gli enti in ordine, e solo le concessioni
 *  pubblicate e ancora valide. I campi del moderatore principale sono colonne
 *  dell'evento, già nella riga. */
export const PERSONE_PUBBLICHE_INCLUDE = {
  organizers: {
    orderBy: { sortOrder: 'asc' },
    select: { name: true, logoUrl: true, websiteUrl: true },
  },
  additionalMods: {
    where: { publicListed: true, revokedAt: null },
    select: { name: true, role: true, organizer: true, organization: true, organizationLogoUrl: true },
  },
} as const;

interface EventoConPersone {
  organizers: Array<{ name: string; logoUrl: string | null; websiteUrl: string | null }>;
  additionalMods: Array<{
    name: string;
    role: 'MODERATOR' | 'SPEAKER';
    organizer: boolean;
    organization: string | null;
    organizationLogoUrl: string | null;
  }>;
  moderatorName: string | null;
  moderatorPublicListed: boolean;
  moderatorOrganization: string | null;
  moderatorOrganizationLogoUrl: string | null;
}

/**
 * Gli enti e le persone che si mostrano di un evento: la pagina pubblica e
 * il riepilogo della sala d'attesa li prendono da qui, così una regola nuova
 * vale per entrambi. Il nome di una concessione è cifrato: lo decifra chi
 * chiama (questo modulo si usa anche nel browser, per i tipi).
 */
export function entiEPersonePubblici(
  event: EventoConPersone,
  decifra: (cifrato: string) => string | null,
): { enti: EntePubblico[]; persone: PersonaPubblica[] } {
  const enti = event.organizers.map((o) => ({
    name: o.name,
    logoUrl: logoPubblico(o.logoUrl),
    websiteUrl: sitoPubblico(o.websiteUrl),
  }));
  const persone = ordinaPersone([
    // L'organizzatore principale, se chi compila ha scelto di presentarlo.
    ...(event.moderatorPublicListed && event.moderatorName
      ? [
          {
            name: event.moderatorName,
            role: 'organizer' as const,
            organization: event.moderatorOrganization,
            logoUrl: logoPubblico(event.moderatorOrganizationLogoUrl),
          },
        ]
      : []),
    ...event.additionalMods.map((m) => ({
      name: decifra(m.name) ?? m.name,
      role: ruoloPubblico(m),
      organization: m.organization,
      logoUrl: logoPubblico(m.organizationLogoUrl),
    })),
  ]);
  return { enti, persone };
}
