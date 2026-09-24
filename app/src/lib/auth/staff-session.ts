import { cache } from 'react';
import { jwtVerify, SignJWT } from 'jose';
import type { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies';

import { prisma } from '@/lib/db';
import { AppError, ForbiddenError, UnauthorizedError } from '@/lib/errors';

import { requireAppSecretKey, tryGetAppSecret } from './app-secret';
import { ADMIN_SESSION_TTL_SECONDS } from './admin-session';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Chi sta usando l'area di amministrazione (ADR-014).
 *
 * - `admin` — la chiave dell'istanza: tutto.
 * - `organizer` — un account dello staff: i propri eventi e cio' che serve
 *   a crearli, niente configurazione dell'istanza ne' dati di tutti.
 *
 * Entrambi viaggiano nello stesso cookie firmato (`admin_session`), con il
 * ruolo nel token. `isAdminAuthenticated` resta vera SOLO per l'admin: le
 * rotte che non sono state riviste per il nuovo ruolo continuano a
 * rifiutare l'organizzatore, invece di aprirsi per errore.
 */
export type StaffSession = { role: 'admin' } | { role: 'organizer'; accountId: string };

/**
 * La sessione corrente, o `null`. Per l'organizzatore rilegge l'account:
 * disattivarlo deve valere subito, non alla scadenza del cookie. Memorizzata
 * per richiesta (`cache`): layout e pagina la chiedono entrambi, e basta
 * leggerla una volta.
 */
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

  if (payload.role === 'admin') return { role: 'admin' };
  if (payload.role !== 'organizer' || typeof payload.sub !== 'string') return null;

  const account = await prisma.staffAccount.findUnique({
    where: { id: payload.sub },
    select: { id: true, active: true },
  });
  if (!account?.active) return null;
  return { role: 'organizer', accountId: account.id };
});

/** Un token di sessione per l'organizzatore. */
export async function signOrganizerSession(accountId: string): Promise<string> {
  return new SignJWT({ role: 'organizer' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(accountId)
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_SESSION_TTL_SECONDS}s`)
    .sign(requireAppSecretKey());
}

/** Qualunque persona dello staff; altrimenti 401. */
export async function requireStaff(cookies: ReadonlyRequestCookies): Promise<StaffSession> {
  const session = await getStaffSession(cookies);
  if (!session) throw new UnauthorizedError();
  return session;
}

/**
 * Chi puo' gestire un evento: l'admin sempre, l'organizzatore solo se l'ha
 * creato lui. Un evento senza proprietario e' dell'amministrazione.
 */
export function canManageEvent(
  session: StaffSession,
  event: { createdById: string | null },
): boolean {
  if (session.role === 'admin') return true;
  return event.createdById !== null && event.createdById === session.accountId;
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

/** Il filtro Prisma sugli eventi visibili a questa sessione. */
export function eventScope(session: StaffSession): { createdById?: string } {
  return session.role === 'admin' ? {} : { createdById: session.accountId };
}

/** Come `canManageEvent`, leggendo il proprietario dal database. */
export async function puoGestire(session: StaffSession, eventId: string): Promise<boolean> {
  if (session.role === 'admin') return true;
  if (!UUID_RE.test(eventId)) return false;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { createdById: true },
  });
  return !!event && canManageEvent(session, event);
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
    select: { event: { select: { createdById: true } } },
  });
  if (!recording || !canManageEvent(session, recording.event)) throw new ForbiddenError();
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
    select: { recording: { select: { event: { select: { createdById: true } } } } },
  });
  if (!speaker || !canManageEvent(session, speaker.recording.event)) throw new ForbiddenError();
  return session;
}
