import { isEventModerator } from '@/lib/auth/moderator';
import { prisma } from '@/lib/db';
import { UnauthorizedError } from '@/lib/errors';
import { readOwnedEventAccessToken } from '@/lib/event-session';
import { hasJoinGrant } from '@/lib/events/join-grant';

import { materialPhase, materialVisibilityWhere } from './material-visibility';

/**
 * Chi vede TUTTI i materiali di un evento, senza il filtro di fase di
 * `material-visibility.ts`: chi conduce la sala, cioè il token moderatore
 * primario o un co-moderatore non revocato. Relatori, iscritti e ospiti vedono
 * la vista del pubblico.
 *
 * Decide solo il token, come per il ruolo in sala (`events/[slug]/live`): una
 * sessione di amministrazione aperta nello stesso browser NON allarga
 * l'elenco. Chi amministra vede tutti i materiali nell'area admin
 * (`/api/admin/events/[id]/materials`); se apre la sala da iscritto o da
 * ospite per controllare cosa vede il pubblico, deve ricevere esattamente
 * quello, non l'elenco completo senza i contrassegni che la sala mostra solo
 * ai moderatori.
 *
 * A differenza dei pannelli live, un token che non risolve NON è un errore:
 * l'elenco dei materiali è pubblico, e un link scaduto deve continuare a
 * mostrare quello che vede chiunque, non un 403.
 */
export async function seesAllMaterials(
  event: { id: string; moderatorToken: string },
  token: string | null | undefined,
): Promise<boolean> {
  // Senza cache: il pannello della sala manda il token solo a chi conduce
  // (components/materials/material-panel), quindi la lookup co-moderatore gira
  // per i pochi moderatori e non per ogni partecipante a ogni giro di polling;
  // e una revoca vale dalla richiesta successiva.
  return isEventModerator(event, token);
}

/** I campi dell'evento che servono a `materialsWhereFor`. */
export const MATERIAL_ACCESS_EVENT_SELECT = {
  id: true,
  moderatorToken: true,
  status: true,
  startsAt: true,
  endsAt: true,
  joinPasswordHash: true,
} as const;

/**
 * I campi per leggere l'elenco dal lato pubblico: quelli di
 * `materialsWhereFor` più quelli di `isEventPubliclyVisible`
 * (lib/events/visibility), che decide se l'evento ha una pagina pubblica.
 */
export const MATERIAL_LIST_EVENT_SELECT = {
  ...MATERIAL_ACCESS_EVENT_SELECT,
  eventType: true,
  postEventPublic: true,
  postEventPublicUntil: true,
} as const;

/**
 * Evento protetto da password: i materiali sono quelli della stanza (anche i
 * file caricati in diretta), e chi ha solo l'indirizzo non entra nella stanza,
 * quindi non li elenca — come per domande, sondaggi e nuvola
 * (lib/events/panel-read-access). Passa chi mostra un token di sala valido per
 * l'evento (iscritto o relatore; chi conduce è già passato), chi ha inserito la
 * password in questo browser, o l'iscritto riconosciuto dal cookie d'accesso.
 * Un token che non risolve non è un errore: vale come nessun token.
 */
async function entraNellaStanza(
  event: { id: string; joinPasswordHash: string | null },
  token: string | null | undefined,
): Promise<boolean> {
  if (await isRoomToken(event, token)) return true;
  if (await hasJoinGrant(event.id)) return true;
  return (await readOwnedEventAccessToken(event.id)) !== null;
}

/**
 * Se `token` è il token di sala di un iscritto o di un relatore (o di un
 * co-moderatore) di QUESTO evento, non revocato. Il token moderatore primario
 * non passa di qui: lo riconosce già `seesAllMaterials`.
 */
export async function isRoomToken(
  event: { id: string },
  token: string | null | undefined,
): Promise<boolean> {
  if (!token) return false;
  const [registrazione, grant] = await Promise.all([
    prisma.registration.findUnique({ where: { accessToken: token }, select: { eventId: true } }),
    prisma.eventModerator.findUnique({
      where: { token },
      select: { eventId: true, revokedAt: true },
    }),
  ]);
  if (registrazione?.eventId === event.id) return true;
  return !!grant && grant.eventId === event.id && grant.revokedAt === null;
}

interface MaterialAccessEvent {
  id: string;
  moderatorToken: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  joinPasswordHash: string | null;
}

export interface MaterialAccess {
  /** Il `where` Prisma dei materiali che il chiamante può vedere adesso. */
  where: { eventId: string; visibility?: { in: string[] } };
  /**
   * Chi conduce la sala: vede ogni fase e, solo lui, i dati di chi conduce
   * (la fase di ogni voce, quante volte è stata aperta).
   */
  seesAll: boolean;
}

/**
 * Cosa vede questo chiamante dei materiali dell'evento: nessun filtro per chi
 * conduce, il filtro di fase per tutti gli altri. Per un evento protetto da
 * password, chi non può entrare nella stanza riceve 401.
 *
 * Una regola sola per l'elenco (GET .../materials, .../files) e per ciò che
 * dall'elenco si raggiunge (il conteggio delle aperture): un materiale conta
 * solo se il chiamante lo vedrebbe elencato.
 */
export async function materialAccessFor(
  event: MaterialAccessEvent,
  token: string | null | undefined,
): Promise<MaterialAccess> {
  if (await seesAllMaterials(event, token)) {
    return { where: { eventId: event.id }, seesAll: true };
  }
  if (event.joinPasswordHash && !(await entraNellaStanza(event, token))) {
    throw new UnauthorizedError('Token required');
  }
  return {
    where: { eventId: event.id, ...materialVisibilityWhere(materialPhase(event)) },
    seesAll: false,
  };
}

/** Il solo `where` di `materialAccessFor`. */
export async function materialsWhereFor(
  event: MaterialAccessEvent,
  token: string | null | undefined,
): Promise<{ eventId: string; visibility?: { in: string[] } }> {
  return (await materialAccessFor(event, token)).where;
}
