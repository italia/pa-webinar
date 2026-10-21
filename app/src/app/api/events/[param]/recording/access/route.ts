/**
 * GET /api/events/[slug]/recording/access?t=<token>&lang=<lingua>
 * POST /api/events/[slug]/recording/access  { email, locale? }
 *
 * L'arrivo dal link personale dell'avviso «registrazione disponibile» per una
 * registrazione riservata agli iscritti (lib/recording/viewing): con un token
 * valido di un'iscrizione esistente posa il cookie della visione, poi porta
 * alla pagina dell'evento. Con un token non valido porta alla pagina e basta:
 * li' chi non puo' vedere la registrazione legge che e' riservata agli iscritti.
 *
 * La POST rimanda il link a chi l'ha perso, o non l'ha mai ricevuto (avviso
 * spento, registrazione riservata dopo l'avviso): con l'email di un'iscrizione
 * a un evento la cui registrazione e' riservata e pubblicata, accoda l'avviso
 * con il link personale. Risponde sempre uguale, cosi' non dice chi e'
 * iscritto; limitata per indirizzo IP.
 */
import { defaultLocale } from '@/i18n/config';
import { parseJsonBody, withErrorHandling } from '@/lib/api-handler';
import { decryptPII, hashEmail } from '@/lib/crypto/pii';
import { prisma } from '@/lib/db';
import { lingueIscrizione, linguaPagina } from '@/lib/email/lingua';
import { enqueueEmail } from '@/lib/email/outbox';
import { recordingPublishedEmail } from '@/lib/email/templates';
import { getPublicEnv } from '@/lib/env';
import { NotFoundError, RateLimitError } from '@/lib/errors';
import { getClientIp, rateLimit } from '@/lib/rate-limit';
import { pubblicazioneAperta } from '@/lib/recording/audience';
import {
  buildViewingSetCookie,
  issueViewingToken,
  verifyViewingToken,
  viewingLinkUrl,
} from '@/lib/recording/viewing';
import { getSettings } from '@/lib/settings';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import { localizedUrl } from '@/lib/utils/localized-url';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;
  const url = new URL(request.url);
  const token = url.searchParams.get('t') ?? '';

  const event = await prisma.event.findUnique({ where: { slug }, select: { id: true } });
  if (!event) throw new NotFoundError('Event');

  const registrationId = verifyViewingToken(token, event.id);
  const registration = registrationId
    ? await prisma.registration.findFirst({
        where: { id: registrationId, eventId: event.id },
        select: { locale: true },
      })
    : null;

  const locale =
    linguaPagina(url.searchParams.get('lang')) ??
    linguaPagina(registration?.locale) ??
    defaultLocale;
  const headers = new Headers({
    Location: localizedUrl(
      getPublicEnv('NEXT_PUBLIC_APP_URL'),
      `/events/${slug}`,
      locale
    ),
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  });
  if (registration) headers.append('Set-Cookie', buildViewingSetCookie(event.id, token));
  return new Response(null, { status: 303, headers });
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;
  const rl = rateLimit(`recording-access:${getClientIp(request)}`, {
    limit: 5,
    windowMs: 60_000,
  });
  if (!rl.allowed) throw new RateLimitError((rl.resetAt - Date.now()) / 1000);

  const event = await prisma.event.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      recordingPublished: true,
      transcriptPublished: true,
      recordingAudience: true,
      postEventPublic: true,
      postEventPublicUntil: true,
    },
  });
  if (!event) throw new NotFoundError('Event');

  const ok = () =>
    Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  const body = (await parseJsonBody(request)) as { email?: unknown };
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const riservata =
    event.status === 'ENDED' &&
    event.recordingAudience === 'REGISTRANTS' &&
    pubblicazioneAperta(event);
  if (!riservata || !EMAIL_RE.test(email)) return ok();

  const registration = await prisma.registration.findUnique({
    where: { eventId_emailHash: { eventId: event.id, emailHash: hashEmail(email) } },
    select: { id: true, email: true, locale: true },
  });
  const token = registration ? issueViewingToken(event.id, registration.id) : null;
  if (!registration || !token) return ok();

  const settings = await getSettings();
  const { pagina, testi } = lingueIscrizione(registration.locale, settings.defaultLocale);
  const mail = recordingPublishedEmail({
    locale: testi,
    eventTitle: getLocalized(event.title as LocalizedField, pagina),
    eventPageUrl: viewingLinkUrl(
      getPublicEnv('NEXT_PUBLIC_APP_URL'),
      event.slug,
      token,
      pagina
    ),
    siteName: settings.siteName || 'PA Webinar',
  });
  await enqueueEmail({
    to: decryptPII(registration.email),
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    metadata: {
      kind: 'recording_access_link',
      eventId: event.id,
      registrationId: registration.id,
    },
  });
  return ok();
});
