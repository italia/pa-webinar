import type { Prisma, StaffRole } from '@prisma/client';
import { cache } from 'react';
import { jwtVerify, SignJWT } from 'jose';
import type { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies';

import { prisma } from '@/lib/db';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { AppError, ForbiddenError, UnauthorizedError } from '@/lib/errors';

import { requireAppSecretKey, tryGetAppSecret } from './app-secret';
import { ADMIN_SESSION_TTL_SECONDS } from './admin-session';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Chi sta usando l'area di amministrazione (ADR-014).
 *
 * - `admin` — tutta l'istanza. Con un account nominale (`accountId`) o con
 *   la chiave dell'istanza (`accountId: null`), che resta come accesso di
 *   emergenza e per l'automazione.
 * - `organizer` — un account dello staff: gli eventi che ha creato o in cui
 *   è organizzatore (eventScope) e cio' che serve a crearli, niente
 *   configurazione dell'istanza ne' dati di tutti.
 *
 * Tutti viaggiano nello stesso cookie firmato (`admin_session`). Per gli
 * account il ruolo NON si prende dal token ma dall'account, riletto a ogni
 * richiesta: nominare, degradare o disattivare qualcuno vale subito.
 * `isAdminAuthenticated` resta vera SOLO per l'admin: le rotte che non sono
 * state riviste per l'organizzatore continuano a rifiutarlo.
 */
export type StaffSession =
  | { role: 'admin'; accountId: string | null }
  | {
      role: 'organizer';
      accountId: string;
      /** L'impronta dell'indirizzo dell'account: riconosce le concessioni da
       *  organizzatore con lo stesso indirizzo (`eventScope`). */
      emailHash: string;
    };

/**
 * La sessione corrente, o `null`. Per l'organizzatore rilegge l'account:
 * disattivarlo deve valere subito, non alla scadenza del cookie. Memorizzata
 * per richiesta (`cache`): layout e pagina la chiedono entrambi, e basta
 * leggerla una volta.
 */
/**
 * L'account dello staff, letto una volta per richiesta: la sessione e
 * l'intestazione (che ne mostra il nome) lo chiedono entrambe.
 */
const leggiAccount = cache(async (id: string) =>
  prisma.staffAccount.findUnique({
    where: { id },
    select: { id: true, active: true, role: true, emailHash: true, name: true },
  }),
);

export const getStaffSession = cache(async function getStaffSession(
  cookies: ReadonlyRequestCookies,
): Promise<StaffSession | null> {
  const appSecret = tryGetAppSecret();
  if (!appSecret) return null;
  const token = cookies.get('admin_session')?.value;
  if (!token) return null;

  let payload: { role?: unknown; sub?: unknown };
  try {
    ({ payload } = await jwtVerify(token, new TextEncoder().encode(appSecret)));
  } catch {
    return null;
  }

  // La chiave dell'istanza: nessun account dietro.
  if (typeof payload.sub !== 'string') {
    return payload.role === 'admin' ? { role: 'admin', accountId: null } : null;
  }
  if (payload.role !== 'admin' && payload.role !== 'organizer') return null;
  if (!UUID_RE.test(payload.sub)) return null;

  const account = await leggiAccount(payload.sub);
  if (!account?.active) return null;
  return account.role === 'ADMIN'
    ? { role: 'admin', accountId: account.id }
    : { role: 'organizer', accountId: account.id, emailHash: account.emailHash };
});

/**
 * Un token di sessione per un account dello staff. Il ruolo nel token serve
 * solo al middleware, che non legge il database; chi decide e' l'account.
 */
export async function signStaffSession(account: {
  id: string;
  role: StaffRole;
}): Promise<string> {
  return new SignJWT({ role: account.role === 'ADMIN' ? 'admin' : 'organizer' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(account.id)
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_SESSION_TTL_SECONDS}s`)
    .sign(requireAppSecretKey());
}

/** Un amministratore, con la chiave o con un account; altrimenti 401. */
export async function requireAdmin(
  cookies: ReadonlyRequestCookies,
): Promise<{ role: 'admin'; accountId: string | null }> {
  const session = await getStaffSession(cookies);
  if (session?.role !== 'admin') throw new UnauthorizedError();
  return session;
}

/** Qualunque persona dello staff; altrimenti 401. */
export async function requireStaff(cookies: ReadonlyRequestCookies): Promise<StaffSession> {
  const session = await getStaffSession(cookies);
  if (!session) throw new UnauthorizedError();
  return session;
}

/**
 * Staff con diritto sull'evento indicato; altrimenti 401 (nessuna sessione)
 * o 403. L'evento inesistente risponde come quello altrui: 403, cosi' non si
 * sonda quali identificativi esistono. Un identificativo malformato e' 400
 * per tutti, admin e organizzatore: la risposta non dipende dal ruolo.
 */
export async function requireEventManager(
  cookies: ReadonlyRequestCookies,
  eventId: string,
): Promise<StaffSession> {
  if (!UUID_RE.test(eventId)) throw new AppError('id must be a UUID', 400, 'BAD_REQUEST');
  const session = await requireStaff(cookies);
  if (!(await puoGestire(session, eventId))) throw new ForbiddenError();
  return session;
}

/**
 * Il filtro Prisma sugli eventi che questa sessione gestisce: tutti per
 * l'admin; per l'organizzatore quelli che ha creato e quelli in cui il suo
 * indirizzo ha una concessione da organizzatore ancora valida. È la regola
 * unica: `puoGestire` la applica al singolo evento.
 *
 * La condizione sta dentro `AND`, non in un `OR` di primo livello: chi la
 * aggiunge a un filtro con un proprio `OR` (una ricerca) non la sovrascrive.
 * Non assegnare `AND` dopo averla sparsa in un filtro.
 */
export function eventScope(session: StaffSession): Prisma.EventWhereInput {
  if (session.role === 'admin') return {};
  return {
    AND: [
      {
        OR: [
          { createdById: session.accountId },
          {
            additionalMods: {
              some: { organizer: true, revokedAt: null, emailHash: session.emailHash },
            },
          },
        ],
      },
    ],
  };
}

/**
 * Se la sessione gestisce l'evento indicato (la regola di `eventScope`).
 * Memorizzata per richiesta: metadati e pagina la chiedono per lo stesso
 * evento con la stessa sessione.
 */
export const puoGestire = cache(async function puoGestire(
  session: StaffSession,
  eventId: string,
): Promise<boolean> {
  if (session.role === 'admin') return true;
  if (!UUID_RE.test(eventId)) return false;
  const trovati = await prisma.event.count({ where: { id: eventId, ...eventScope(session) } });
  return trovati > 0;
});

/**
 * Se chi chiama è lo staff che gestisce l'evento (`puoGestire`), senza
 * rifiutare chi non lo è: per le rotte aperte anche al link di conduzione,
 * dove la sessione dello staff permette qualcosa in più.
 */
export async function isEventManager(
  cookies: ReadonlyRequestCookies,
  eventId: string,
): Promise<boolean> {
  const session = await getStaffSession(cookies);
  return !!session && (await puoGestire(session, eventId));
}

/** Staff con diritto sull'evento della registrazione; altrimenti 401/403. */
export async function requireRecordingManager(
  cookies: ReadonlyRequestCookies,
  recordingId: string,
): Promise<StaffSession> {
  const session = await requireStaff(cookies);
  if (session.role === 'admin') return session;
  if (!UUID_RE.test(recordingId)) throw new ForbiddenError();
  const recording = await prisma.recording.findUnique({
    where: { id: recordingId },
    select: { eventId: true },
  });
  if (!recording || !(await puoGestire(session, recording.eventId))) throw new ForbiddenError();
  return session;
}

/** Staff con diritto sull'evento della registrazione di questo relatore. */
export async function requireSpeakerManager(
  cookies: ReadonlyRequestCookies,
  speakerId: string,
): Promise<StaffSession> {
  const session = await requireStaff(cookies);
  if (session.role === 'admin') return session;
  if (!UUID_RE.test(speakerId)) throw new ForbiddenError();
  const speaker = await prisma.speaker.findUnique({
    where: { id: speakerId },
    select: { recording: { select: { eventId: true } } },
  });
  if (!speaker || !(await puoGestire(session, speaker.recording.eventId))) throw new ForbiddenError();
  return session;
}

/**
 * Chi e' entrato, per l'intestazione: il ruolo e il nome dell'account (null
 * con la chiave dell'istanza, che non ha un nome). Solo per mostrarli: un
 * permesso si decide con getStaffSession.
 */
export const staffPerIntestazione = cache(async function staffPerIntestazione(
  cookies: ReadonlyRequestCookies,
): Promise<{ ruolo: 'admin' | 'organizer'; nome: string | null } | null> {
  const session = await getStaffSession(cookies);
  if (!session) return null;
  if (!session.accountId) return { ruolo: session.role, nome: null };
  const account = await leggiAccount(session.accountId);
  let nome: string | null = null;
  try {
    nome = account ? tryDecryptPII(account.name) : null;
  } catch {
    // Una chiave PII sbagliata non deve rompere ogni pagina: il nome e' solo
    // da mostrare, e l'area utente (con «Esci») resta.
    nome = null;
  }
  return { ruolo: session.role, nome };
});

