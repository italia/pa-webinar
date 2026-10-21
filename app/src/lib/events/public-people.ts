/**
 * Chi organizza e chi interviene, come lo mostra la pagina pubblica
 * dell'evento: gli enti che organizzano (EventOrganizer) e le persone con una
 * concessione che chi compila ha scelto di pubblicare (EventModerator con
 * `publicListed`).
 */

import type { PersonRole } from './grant-profile';
import { personPhotoPath } from './person-photo';

export interface PersonaPubblica {
  name: string;
  role: PersonRole;
  organization: string | null;
  logoUrl: string | null;
  /** La foto della persona (percorso dell'app), solo se è presentata: come
   *  il nome, compare per la scelta di chi compila. */
  photoUrl: string | null;
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

/**
 * Prima chi organizza, poi chi conduce, poi chi parla. A parità di ruolo,
 * nell'ordine del programma (`turno`: il primo argomento su cui la persona
 * interviene), poi per nome: chi non interviene su nessun argomento viene
 * dopo chi interviene, in ordine alfabetico come prima.
 */
export function ordinaPersone<T extends PersonaPubblica & { turno?: number | null }>(persone: T[]): T[] {
  const peso: Record<PersonRole, number> = { organizer: 0, moderator: 1, speaker: 2 };
  const turno = (p: T) => p.turno ?? Number.POSITIVE_INFINITY;
  return [...persone].sort(
    (a, b) =>
      peso[a.role] - peso[b.role] ||
      (turno(a) === turno(b) ? 0 : turno(a) < turno(b) ? -1 : 1) ||
      a.name.localeCompare(b.name, 'it'),
  );
}

/** Le relazioni da leggere per `entiEPersonePubblici` (da unire
 *  all'`include` o al `select` di Prisma): gli enti in ordine, solo le
 *  concessioni pubblicate e ancora valide, e gli argomenti dell'agenda che
 *  hanno chi interviene (l'ordine del programma). I campi del moderatore
 *  principale sono colonne dell'evento, già nella riga; `agendaEnabled` lo
 *  aggiunge chi usa un `select`. */
export const PERSONE_PUBBLICHE_INCLUDE = {
  organizers: {
    orderBy: { sortOrder: 'asc' },
    select: { name: true, logoUrl: true, websiteUrl: true },
  },
  additionalMods: {
    where: { publicListed: true, revokedAt: null },
    select: {
      id: true,
      name: true,
      role: true,
      organizer: true,
      organization: true,
      organizationLogoUrl: true,
      photoId: true,
    },
  },
  agendaItems: {
    // Solo quelli con chi interviene: una persona o l'organizzatore principale.
    where: { NOT: { speakerGrantId: null, speakerPrimary: false } },
    orderBy: { sortOrder: 'asc' },
    select: { speakerGrantId: true, speakerPrimary: true },
  },
} as const;

interface EventoConPersone {
  organizers: Array<{ name: string; logoUrl: string | null; websiteUrl: string | null }>;
  additionalMods: Array<{
    id: string;
    name: string;
    role: 'MODERATOR' | 'SPEAKER';
    organizer: boolean;
    organization: string | null;
    organizationLogoUrl: string | null;
    photoId: string | null;
  }>;
  /** L'agenda e' accesa: solo allora il programma ordina le persone. */
  agendaEnabled: boolean;
  /** Gli argomenti dell'agenda in ordine, con chi interviene. */
  agendaItems: Array<{ speakerGrantId: string | null; speakerPrimary: boolean }>;
  moderatorName: string | null;
  moderatorPublicListed: boolean;
  moderatorOrganization: string | null;
  moderatorOrganizationLogoUrl: string | null;
  moderatorPhotoId: string | null;
}

/**
 * Gli enti e le persone che si mostrano di un evento: la pagina pubblica, il
 * riepilogo della sala d'attesa, l'anteprima dei link e i dati strutturati li
 * prendono da qui, così una regola nuova vale per tutti. Il nome di una
 * concessione è cifrato: lo decifra chi chiama (questo modulo si usa anche nel
 * browser, per i tipi).
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
  // Il primo argomento del programma su cui ognuno interviene.
  const turni = new Map<string, number>();
  let turnoPrincipale: number | null = null;
  if (event.agendaEnabled) {
    event.agendaItems.forEach((a, i) => {
      if (a.speakerPrimary) turnoPrincipale ??= i;
      else if (a.speakerGrantId && !turni.has(a.speakerGrantId)) turni.set(a.speakerGrantId, i);
    });
  }
  const persone = ordinaPersone([
    // L'organizzatore principale, se chi compila ha scelto di presentarlo.
    ...(event.moderatorPublicListed && event.moderatorName
      ? [
          {
            name: event.moderatorName,
            role: 'organizer' as const,
            organization: event.moderatorOrganization,
            logoUrl: logoPubblico(event.moderatorOrganizationLogoUrl),
            photoUrl: event.moderatorPhotoId ? personPhotoPath(event.moderatorPhotoId) : null,
            turno: turnoPrincipale,
          },
        ]
      : []),
    ...event.additionalMods.map((m) => ({
      name: decifra(m.name) ?? m.name,
      role: ruoloPubblico(m),
      organization: m.organization,
      logoUrl: logoPubblico(m.organizationLogoUrl),
      photoUrl: m.photoId ? personPhotoPath(m.photoId) : null,
      turno: turni.get(m.id) ?? null,
    })),
  ]).map(({ turno: _turno, ...persona }) => persona);
  return { enti, persone };
}
