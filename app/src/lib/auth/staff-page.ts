import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createElement, type ReactElement } from 'react';

import AccessDenied from '@/components/admin/access-denied';
import { localizedPath } from '@/lib/utils/localized-url';

import { getStaffSession, type StaffSession } from './staff-session';

/**
 * Le due domande che ogni pagina dell'amministrazione fa, sempre nello
 * stesso modo (ADR-014).
 *
 * Senza sessione si va al login. Con una sessione che non basta si mostra
 * «accesso non consentito»: chi e' gia' entrato e viene rimandato al login
 * ci ritorna in un giro senza fine.
 */

/** Pagina per tutto lo staff: restituisce la sessione, con cui filtrare. */
export async function staffOLogin(locale: string): Promise<StaffSession> {
  const session = await getStaffSession(await cookies());
  if (!session) redirect(localizedPath('/admin/login', locale));
  return session;
}

/** Pagina della sola amministrazione dell'istanza. `null` = si prosegue. */
export async function soloAdmin(locale: string): Promise<ReactElement | null> {
  const session = await staffOLogin(locale);
  return session.role === 'admin' ? null : createElement(AccessDenied);
}
