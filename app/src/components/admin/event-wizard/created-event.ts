/**
 * Dal wizard alla pagina di gestione dell'evento appena creato: quali risorse
 * non sono state salvate e se la pubblicazione richiesta e' fallita. Passa per
 * sessionStorage, con una chiave per evento, e porta solo tipi di risorsa:
 * nessun dato delle persone.
 */
export type UnsavedResource =
  | 'organizers'
  | 'invitations'
  | 'moderators'
  | 'speakers'
  | 'materials'
  | 'questionnaires';

export interface CreationOutcome {
  unsaved: UnsavedResource[];
  /** «Pubblica» chiesto, ma l'evento e' rimasto in bozza. */
  publishFailed: boolean;
}

const TIPI: readonly UnsavedResource[] = [
  'organizers',
  'invitations',
  'moderators',
  'speakers',
  'materials',
  'questionnaires',
];

const chiave = (eventId: string) => `pa-wizard-unsaved:${eventId}`;

/** Vero se l'esito e' stato salvato: altrimenti chi chiama deve dirlo altrove. */
export function rememberCreation(eventId: string, esito: CreationOutcome): boolean {
  try {
    if (esito.unsaved.length === 0 && !esito.publishFailed) {
      sessionStorage.removeItem(chiave(eventId));
    } else {
      sessionStorage.setItem(chiave(eventId), JSON.stringify(esito));
    }
    return true;
  } catch {
    return false;
  }
}

export function readCreation(eventId: string): CreationOutcome {
  try {
    const raw = sessionStorage.getItem(chiave(eventId));
    const v = (raw ? JSON.parse(raw) : {}) as Partial<CreationOutcome>;
    return {
      unsaved: Array.isArray(v.unsaved)
        ? v.unsaved.filter((x): x is UnsavedResource => TIPI.includes(x as UnsavedResource))
        : [],
      publishFailed: v.publishFailed === true,
    };
  } catch {
    return { unsaved: [], publishFailed: false };
  }
}

export function forgetCreation(eventId: string): void {
  try {
    sessionStorage.removeItem(chiave(eventId));
  } catch {
    // niente da fare
  }
}
