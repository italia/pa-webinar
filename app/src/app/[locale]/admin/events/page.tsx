// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { getLocale, getTranslations } from 'next-intl/server';
import type { Prisma } from '@prisma/client';

import { staffOLogin } from '@/lib/auth/staff-page';
import { eventScope, type StaffSession } from '@/lib/auth/staff-session';
import { eventiOrganizzati } from '@/lib/recording/content-access';
import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { Link } from '@/i18n/navigation';
import AdminDashboardClient from '@/components/admin/admin-dashboard-client';
import EventCalendar from '@/components/calendar/event-calendar-lazy';
import AdminPageHeader from '@/components/admin/admin-page-header';
import { adminPageMetadata, adminPageTitle } from '@/components/admin/admin-page-title';

interface EventsListPageProps {
  searchParams: Promise<{ token?: string; vista?: string }>;
}

async function loadEvents(session: StaffSession, scope: Prisma.EventWhereInput, token?: string) {
  // Col token si vede l'evento di quel token, chi lo possiede lo modera
  // comunque; senza, quelli che la sessione puo' gestire (ADR-014).
  const where = token ? { moderatorToken: token } : scope;
  const events = await prisma.event.findMany({
    where,
    include: {
      _count: { select: { registrations: true } },
      organizers: { select: { name: true }, orderBy: { sortOrder: 'asc' } },
      tagLinks: { include: { tag: true } },
    },
    orderBy: { startsAt: 'asc' },
  });

  // Le persone con un link valido, contate per ruolo nel database.
  const perRuolo = await prisma.eventModerator.groupBy({
    by: ['eventId', 'role'],
    where: { eventId: { in: events.map((e) => e.id) }, revokedAt: null },
    _count: { _all: true },
  });
  const conteggi = new Map(perRuolo.map((r) => [`${r.eventId}:${r.role}`, r._count._all]));
  const quanti = (eventId: string, role: 'MODERATOR' | 'SPEAKER') =>
    conteggi.get(`${eventId}:${role}`) ?? 0;
  // Il link di conduzione apre la pubblicazione e la cancellazione del video:
  // si consegna solo a chi organizza l'evento, non all'admin che non lo
  // organizza (lib/recording/content-access). Vuoto: chi guarda non conduce.
  // Col token nell'indirizzo, l'evento e' quello del token.
  const organizzati = token
    ? null
    : await eventiOrganizzati(session, events.map((e) => e.id));

  return events.map((e) => ({
    id: e.id,
    title: e.title as Record<string, string>,
    slug: e.slug,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    createdAt: e.createdAt.toISOString(),
    status: e.status,
    eventType: e.eventType,
    registrationCount: e._count.registrations,
    maxParticipants: e.maxParticipants,
    peakParticipants: e.peakParticipants,
    moderatorToken: !organizzati || organizzati.has(e.id) ? e.moderatorToken : '',
    coverImageUrl: e.coverImageUrl,
    imageUrl: e.imageUrl,
    organizerName: e.organizerName,
    parseTitleKicker: e.parseTitleKicker,
    moderatorCount: quanti(e.id, 'MODERATOR'),
    speakerCount: quanti(e.id, 'SPEAKER'),
    organizers: e.organizers,
    tags: e.tagLinks.map((link) => ({
      slug: link.tag.slug,
      name: link.tag.name as Record<string, string>,
      color: link.tag.color,
    })),
  }));
}

async function loadAvailableTags() {
  const tags = await prisma.tag.findMany({
    orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
  });
  return tags.map((t) => ({
    slug: t.slug,
    name: t.name as Record<string, string>,
    color: t.color,
  }));
}

export function generateMetadata() {
  return adminPageMetadata('/admin/events');
}

export default async function EventsListPage({
  searchParams,
}: EventsListPageProps) {
  const { token, vista } = await searchParams;
  const locale = await getLocale();
  const session = await staffOLogin(locale);
  const t = await getTranslations('admin');
  const tList = await getTranslations('admin.eventsList');
  // Due viste degli stessi appuntamenti, elenco e calendario, nella stessa
  // pagina. Col token si vede un evento solo: niente calendario.
  const calendario = vista === 'calendario' && !token;
  const [events, availableTags, settings] = calendario
    ? [[], [], null]
    : await Promise.all([
        loadEvents(session, eventScope(session), token),
        loadAvailableTags(),
        getSettings(),
      ]);
  const vistaCorrente = (attiva: boolean) => (attiva ? ('page' as const) : undefined);
  const schede = !token && (
    <nav aria-label={tList('viewLabel')} className="mb-4">
      <ul className="nav nav-tabs">
        <li className="nav-item">
          <Link
            href="/admin/events"
            className={`nav-link${calendario ? '' : ' active'}`}
            aria-current={vistaCorrente(!calendario)}
          >
            {tList('viewList')}
          </Link>
        </li>
        <li className="nav-item">
          <Link
            href={{ pathname: '/admin/events', query: { vista: 'calendario' } }}
            className={`nav-link${calendario ? ' active' : ''}`}
            aria-current={vistaCorrente(calendario)}
          >
            {tList('viewCalendar')}
          </Link>
        </li>
      </ul>
    </nav>
  );

  return (
    <div className="container py-5">
      <AdminPageHeader
        title={await adminPageTitle('/admin/events')}
        // Le due creazioni, una accanto all'altra: un evento programmato e una
        // chiamata rapida, che porta dritta al suo modulo.
        actions={
          <>
          <Link
            href="/admin/events/new"
            className="btn btn-primary d-inline-flex align-items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
            {t('createEvent')}
          </Link>
          <Link
            href={{ pathname: '/admin/events/new', query: { instant: '1' } }}
            className="btn btn-outline-primary d-inline-flex align-items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M15 10l4.55-2.28A1 1 0 0 1 21 8.62v6.76a1 1 0 0 1-1.45.9L15 14M5 18h8a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2z"/></svg>
            {t('createInstantCall')}
          </Link>
          </>
        }
      />

      {schede}

      {calendario || !settings ? (
        // Gli eventi li filtra la rotta del calendario, come l'elenco (ADR-014).
        <EventCalendar mode="admin" />
      ) : events.length === 0 ? (
        <div
          className="text-center py-5 px-4 rounded-3"
          style={{ backgroundColor: '#F5F7FB' }}
        >
          <div
            className="mx-auto mb-3 d-flex align-items-center justify-content-center rounded-circle"
            style={{
              width: 64,
              height: 64,
              backgroundColor: 'rgba(0,102,204,0.1)',
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#0066CC" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </div>
          <p className="lead text-muted mb-3">{t('noEvents')}</p>
          <Link
            href="/admin/events/new"
            className="btn btn-primary btn-lg"
          >
            {t('createEvent')}
          </Link>
        </div>
      ) : (
        <AdminDashboardClient
          events={events}
          renderedAt={Date.now()}
          token={token}
          availableTags={availableTags}
          siteDefaultParseTitleKicker={settings.parseTitleKicker}
        />
      )}
    </div>
  );
}
