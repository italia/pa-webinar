import { cookies } from 'next/headers';

import { ForbiddenError } from '@/lib/errors';

import { getStaffSession, puoGestire } from './staff-session';

/**
 * Segnare una persona come organizzatrice dà all'account dello staff con lo
 * stesso indirizzo la gestione dell'evento (eventScope). Il link principale
 * non basta: è un posto condiviso, e chi lo ha potrebbe dare a sé stesso
 * poteri che il link non ha (i dati degli iscritti, le azioni in blocco).
 * Lo decide solo chi l'evento lo gestisce già: l'amministrazione, chi l'ha
 * creato, un altro organizzatore con account.
 */
export async function requireOrganizerMarkRight(eventId: string): Promise<void> {
  const session = await getStaffSession(await cookies());
  if (!session || !(await puoGestire(session, eventId))) {
    throw new ForbiddenError('Only staff who manage the event can name an organizer');
  }
}
