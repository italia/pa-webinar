// Solo lato server (legge next-intl/server, la sessione e il database): i
// componenti client usano admin-nav-model.
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getLocale, getTranslations } from 'next-intl/server';

import { nomePagina } from '@/components/admin/admin-nav-model';
import type { PercorsoInterno } from '@/i18n/percorsi';
import { constantTimeEqual } from '@/lib/auth/moderator';
import { puoGestire, getStaffSession } from '@/lib/auth/staff-session';
import { prisma } from '@/lib/db';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Il nome di una pagina dell'amministrazione, lo stesso del menu e delle
 * briciole: per l'intestazione e per il titolo della scheda del browser
 * (WCAG 2.4.2: ogni pagina ha un titolo che la descrive).
 */
export async function adminPageTitle(pathname: PercorsoInterno): Promise<string> {
  const t = await getTranslations('admin.nav');
  const key = nomePagina(pathname);
  return key ? t(key) : '';
}

/** `generateMetadata` di una pagina dell'amministrazione. */
export async function adminPageMetadata(pathname: PercorsoInterno): Promise<Metadata> {
  const title = await adminPageTitle(pathname);
  return title ? { title } : {};
}

/**
 * Il titolo della scheda per le pagine di un evento: il nome dell'evento (e
 * della pagina, sotto il dettaglio), cosi' due schede aperte su eventi diversi
 * si distinguono. Il nome compare solo a chi la pagina la mostra, con la sua
 * stessa regola: lo staff che gestisce l'evento e, dove la pagina lo accetta
 * (`conToken`: dettaglio e modifica), chi ha il link del moderatore principale.
 * Agli altri resta il nome generico, come la pagina che vedranno.
 */
export async function eventPageMetadata(
  pathname: PercorsoInterno,
  eventId: string,
  opts: { token?: unknown; conToken?: boolean } = {},
): Promise<Metadata> {
  const nome = await adminPageTitle(pathname);
  const generico: Metadata = nome ? { title: nome } : {};
  if (!UUID_RE.test(eventId)) return generico;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { title: true, slug: true, moderatorToken: true },
  });
  if (!event) return generico;
  const session = await getStaffSession(await cookies());
  const token = typeof opts.token === 'string' ? opts.token : '';
  const ammesso =
    (session !== null && (await puoGestire(session, eventId))) ||
    (opts.conToken === true && token !== '' && constantTimeEqual(event.moderatorToken, token));
  if (!ammesso) return generico;
  const titolo = getLocalized(event.title as LocalizedField, await getLocale()) || event.slug;
  return { title: pathname === '/admin/events/[id]' || !nome ? titolo : `${nome} — ${titolo}` };
}
