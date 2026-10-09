import { z } from 'zod';

/**
 * Il profilo pubblico di una persona dell'evento (concessione di moderatore o
 * relatore): l'ente a cui appartiene, con il logo, se organizza l'evento e se
 * la pagina pubblica la presenta. L'ente della persona è distinto dall'ente
 * che organizza l'evento (EventOrganizer).
 */
export const grantProfileSchema = z.object({
  /** Organizzatore: solo per un moderatore. */
  organizer: z.boolean().optional(),
  organization: z.string().trim().max(200).optional().nullable(),
  organizationLogoUrl: z.string().url().max(2048).optional().nullable(),
  publicListed: z.boolean().optional(),
});

export type GrantProfile = z.infer<typeof grantProfileSchema>;

/** I campi del profilo come vanno scritti nella riga: vuoto = nessun valore. */
export function grantProfileData(p: GrantProfile) {
  return {
    ...(p.organizer !== undefined ? { organizer: p.organizer } : {}),
    ...(p.organization !== undefined ? { organization: p.organization || null } : {}),
    ...(p.organizationLogoUrl !== undefined
      ? { organizationLogoUrl: p.organizationLogoUrl || null }
      : {}),
    ...(p.publicListed !== undefined ? { publicListed: p.publicListed } : {}),
  };
}

/** Il ruolo di una persona dell'evento, come lo sceglie chi compila. */
export type PersonRole = 'organizer' | 'moderator' | 'speaker';

/** Il profilo di una concessione come sta nel database. */
export interface SavedGrantProfile {
  organizer: boolean;
  organization: string | null;
  organizationLogoUrl: string | null;
  publicListed: boolean;
}

/**
 * Il profilo di una persona del wizard come va salvato: testo senza spazi ai
 * bordi, vuoto = nessun valore.
 */
export function profiloSalvato(p: {
  organizer?: boolean;
  organization?: string | null;
  organizationLogoUrl?: string | null;
  publicListed?: boolean;
}): SavedGrantProfile {
  return {
    organizer: !!p.organizer,
    organization: p.organization?.trim() || null,
    organizationLogoUrl: p.organizationLogoUrl?.trim() || null,
    publicListed: !!p.publicListed,
  };
}

/**
 * I campi del profilo cambiati, o null se nessuno. Un campo assente in `dopo`
 * non si tocca: una bozza salvata nel browser prima che il profilo esistesse
 * non deve cancellare ciò che è già salvato.
 */
export function differenzaProfilo(
  prima: SavedGrantProfile,
  dopo: Partial<SavedGrantProfile>,
): Partial<SavedGrantProfile> | null {
  const diff: Partial<SavedGrantProfile> = {};
  if (dopo.organizer !== undefined && prima.organizer !== !!dopo.organizer) {
    diff.organizer = !!dopo.organizer;
  }
  if (dopo.organization !== undefined) {
    const v = dopo.organization?.trim() || null;
    if ((prima.organization || null) !== v) diff.organization = v;
  }
  if (dopo.organizationLogoUrl !== undefined) {
    const v = dopo.organizationLogoUrl?.trim() || null;
    if ((prima.organizationLogoUrl || null) !== v) diff.organizationLogoUrl = v;
  }
  if (dopo.publicListed !== undefined && prima.publicListed !== !!dopo.publicListed) {
    diff.publicListed = !!dopo.publicListed;
  }
  return Object.keys(diff).length > 0 ? diff : null;
}
