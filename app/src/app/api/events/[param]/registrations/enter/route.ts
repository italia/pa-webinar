import { defaultLocale } from '@/i18n/config';
import { withErrorHandling } from '@/lib/api-handler';
import { NotFoundError } from '@/lib/errors';
import { prisma } from '@/lib/db';
import { getPublicEnv } from '@/lib/env';
import { linguaPagina } from '@/lib/email/lingua';
import { verifyRegistrationEntry } from '@/lib/events/registration-link';
import { localizedUrl } from '@/lib/utils/localized-url';
import {
  buildEventAccessSetCookie,
  eventAccessTtlSeconds,
  signEventAccess,
} from '@/lib/event-session';

export const dynamic = 'force-dynamic';

// ── GET /api/events/[slug]/registrations/enter?token=…&sig=…&lang=… ──
//
// Il link personale dell'email quando l'iscrizione pubblica è spenta
// (lib/events/registration-link). Con la firma giusta il browser che lo apre
// diventa quello della persona iscritta — lo stesso cookie `event_access` che
// altrimenti si riceve iscrivendosi — e va nella sala. Senza, o con una firma
// sbagliata, va nella sala con il solo token: un posto, senza identità, come
// un link inoltrato. Qui non si risponde mai con un errore che distingua un
// token esistente da uno inventato: decide la sala, come per ogni link.

export const GET = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;
  const url = new URL(request.url);
  const token = url.searchParams.get('token') ?? '';
  const sig = url.searchParams.get('sig') ?? '';

  const event = await prisma.event.findUnique({
    where: { slug },
    select: { id: true, endsAt: true },
  });
  if (!event) throw new NotFoundError('Event');

  const registration = token
    ? await prisma.registration.findUnique({
        where: { accessToken: token },
        select: { eventId: true, locale: true },
      })
    : null;
  const identita =
    registration?.eventId === event.id && verifyRegistrationEntry(event.id, token, sig);

  const locale =
    linguaPagina(url.searchParams.get('lang')) ??
    linguaPagina(registration?.locale) ??
    defaultLocale;
  const baseUrl = getPublicEnv('NEXT_PUBLIC_APP_URL');
  const destinazione = token
    ? localizedUrl(baseUrl, `/events/${slug}/live?token=${encodeURIComponent(token)}`, locale)
    : localizedUrl(baseUrl, `/events/${slug}`, locale);

  const headers = new Headers({
    Location: destinazione,
    'Cache-Control': 'no-store',
    // La firma sta solo in questo indirizzo: non deve seguire la persona
    // come intestazione Referer verso la pagina successiva.
    'Referrer-Policy': 'no-referrer',
  });
  if (identita) {
    const ttl = eventAccessTtlSeconds(event.endsAt);
    headers.append(
      'Set-Cookie',
      buildEventAccessSetCookie(event.id, await signEventAccess(event.id, token, ttl), ttl),
    );
  }
  return new Response(null, { status: 303, headers });
});
