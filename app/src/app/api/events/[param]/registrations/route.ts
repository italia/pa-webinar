import { nanoid } from 'nanoid';

import { defaultLocale } from '@/i18n/config';
import { linguaDaIntestazione, linguaPagina } from '@/lib/email/lingua';
import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import {
  NotFoundError,
  ConflictError,
  AlreadyRegisteredError,
  RateLimitError,
  ValidationError,
} from '@/lib/errors';
import { prisma } from '@/lib/db';
import { createRegistrationSchema } from '@/lib/validation/schemas';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { encryptPII, hashEmail } from '@/lib/crypto/pii';
import { sendConfirmationEmail } from '@/lib/email/confirmation';
import { getPublicEnv } from '@/lib/env';
import { upsertPersonOnRegistration } from '@/lib/persons';
import { isEventOpenForRegistration } from '@/lib/events/visibility';
import { isInvited, publicRegistrationFor } from '@/lib/events/registration-access';
import { registrationJoinUrl } from '@/lib/events/registration-link';
import { consensiRichiesti, VERSIONE_TESTO_TRASCRIZIONE } from '@/lib/registration/consents';
import { getSettings } from '@/lib/settings';
import { captionsTranscriptActive } from '@/lib/captions/availability';
import { localizedUrl } from '@/lib/utils/localized-url';
import {
  buildEventAccessSetCookie,
  eventAccessTtlSeconds,
  signEventAccess,
} from '@/lib/event-session';

export const dynamic = 'force-dynamic';

interface IscrizioneTrovata {
  id: string;
  accessToken: string;
  locale: string | null;
}

/** Cosa ha fatto la transazione con l'indirizzo ricevuto. */
type EsitoIscrizione =
  | { tipo: 'nuova'; registrazione: IscrizioneTrovata }
  | { tipo: 'esistente'; registrazione: IscrizioneTrovata }
  | { tipo: 'nonInvitato' };

// ── POST /api/events/[slug]/registrations ────────────────────

export const POST = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;

  const ip = getClientIp(request);
  const rl = rateLimit(`register:${ip}`, { limit: 10, windowMs: 60_000 });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  const event = await prisma.event.findUnique({
    where: { slug },
    include: { _count: { select: { registrations: true } } },
  });

  if (!event) throw new NotFoundError('Event');

  // Include PROVISIONING/IDLE degli eventi schedulati non finiti
  // (pre-warm/pausa): registrarsi 10 minuti prima dell'inizio deve
  // funzionare. Le instant call restano fuori dagli stati di warm-up
  // (link-only; per LIVE il comportamento è quello storico).
  if (!isEventOpenForRegistration(event)) {
    throw new ConflictError('Event is not open for registration');
  }

  // maxParticipants is an expected-attendance estimate (used for
  // capacity planning), not a hard cap. Registrations beyond it are
  // accepted — the platform scales horizontally, refusing sign-ups
  // would only damage participation.

  const body = await parseJsonBody(request);
  const parsed = createRegistrationSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Validation failed', parsed.error.issues.map((i) => ({ path: i.path, message: i.message })));
  }

  const {
    displayName, email, consentGiven, organization, organizationRole, organizationType,
    consentRecording, consentMultitrack, consentFutureCommunications, consentAddressBook,
  } = parsed.data;

  // La lingua della pagina da cui ci si iscrive; l'intestazione del browser
  // solo se la richiesta non la dice. Vale per questa email e per quelle che
  // seguiranno (promemoria, avvisi, post-evento).
  const pageLocale =
    linguaPagina(parsed.data.locale) ??
    linguaDaIntestazione(request.headers.get('Accept-Language')) ??
    defaultLocale;

  // I consensi obbligatori dipendono dal formato dell'evento: la stessa regola
  // del modulo (lib/registration/consents).
  const richiesti = consensiRichiesti({
    ...event,
    captionsTranscript: captionsTranscriptActive(event, await getSettings()),
  });
  if (richiesti.registrazione && consentRecording !== true) {
    throw new ValidationError('Validation failed', [{ path: ['consentRecording'], message: 'registration.errors.recordingConsentRequired' }]);
  }

  // La trascrizione dei propri interventi (traccia audio per persona o
  // sottotitoli salvati) e' facoltativa: senza, ci si iscrive lo stesso e la
  // voce non si registra ne' si trascrive (lib/captions/room).

  // L'ente, quando l'evento lo chiede: la regola del modulo vale anche per chi
  // chiama la rotta direttamente. Ruolo e tipo di ente restano facoltativi.
  if (event.requireOrganization && !organization?.trim()) {
    throw new ValidationError('Validation failed', [{ path: ['organization'], message: 'registration.errors.organizationRequired' }]);
  }

  const emailHash = hashEmail(email);
  const encryptedEmail = encryptPII(email);
  const accessToken = nanoid(24);
  // Iscrizione non aperta (l'evento e' solo su invito, o lo dice il sito): si
  // iscrive solo chi e' fra gli invitati dell'evento
  // (lib/events/registration-access), e il link personale lo consegna solo
  // l'email (lib/events/registration-link).
  const soloInvitati = !publicRegistrationFor(event, (await getSettings()).publicRegistrationEnabled);

  const esito: EsitoIscrizione = await prisma.$transaction(async (tx) => {
    // Check for duplicates inside transaction
    const existing = await tx.registration.findUnique({
      where: { eventId_emailHash: { eventId: event.id, emailHash } },
      select: { id: true, accessToken: true, locale: true },
    });
    if (existing) {
      // Solo su invito si risponde come a tutti gli altri e il link torna
      // nella casella dell'iscritto: «gia' iscritto» direbbe a chiunque che
      // quell'indirizzo e' fra gli invitati.
      if (soloInvitati) return { tipo: 'esistente', registrazione: existing };
      throw new AlreadyRegisteredError();
    }

    if (soloInvitati && !(await isInvited(tx, event.id, email))) {
      return { tipo: 'nonInvitato' };
    }

    const personId = await upsertPersonOnRegistration(tx, {
      emailHash,
      displayName,
      organization: organization || null,
      organizationRole: organizationRole || null,
      organizationType: organizationType || null,
      optedIn: consentAddressBook === true,
    });

    const reg = await tx.registration.create({
      data: {
        eventId: event.id,
        displayName: encryptPII(displayName),
        email: encryptedEmail,
        emailHash,
        organization: organization || null,
        organizationRole: organizationRole || null,
        organizationType: organizationType || null,
        consentGiven,
        consentTimestamp: new Date(),
        consentRecording: richiesti.registrazione ? (consentRecording ?? false) : null,
        consentMultitrack: richiesti.tracce ? (consentMultitrack ?? false) : null,
        consentMultitrackVersion: richiesti.tracce && consentMultitrack ? VERSIONE_TESTO_TRASCRIZIONE : null,
        consentFutureCommunications: consentFutureCommunications ?? false,
        locale: pageLocale,
        accessToken,
        personId,
      },
    });

    // GDPR audit: record consent
    await tx.gdprAuditLog.create({
      data: {
        eventId: event.id,
        action: 'CONSENT_RECORDED',
        recordCount: 1,
        details: JSON.stringify({
          consentGiven: true,
          consentRecording: richiesti.registrazione ? (consentRecording ?? false) : null,
          // Il fatto lato server: la regola dell'evento chiedeva o no il
          // consenso alla registrazione (altrimenti l'iscrizione informa).
          recordingConsentRequired: richiesti.registrazione,
          consentMultitrack: richiesti.tracce ? (consentMultitrack ?? false) : null,
          consentMultitrackVersion: richiesti.tracce && consentMultitrack ? VERSIONE_TESTO_TRASCRIZIONE : null,
          consentFutureCommunications: consentFutureCommunications ?? false,
          consentAddressBook: consentAddressBook === true,
        }),
      },
    });

    return { tipo: 'nuova', registrazione: reg };
  });

  const baseUrl = getPublicEnv('NEXT_PUBLIC_APP_URL');

  if (soloInvitati) {
    // Stessa risposta che l'indirizzo sia invitato, gia' iscritto o nessuno
    // dei due, come per il rinvio del link (registrations/resend): niente
    // token, niente link, niente cookie. Chi ha compilato il modulo non ha
    // provato di possedere l'indirizzo; chi apre l'email si'.
    if (esito.tipo !== 'nonInvitato') {
      const { registrazione } = esito;
      // Chi era gia' iscritto riceve il link nella lingua dell'iscrizione,
      // come dal rinvio: chi conosce un indirizzo non ne cambia la lingua.
      const locale =
        esito.tipo === 'esistente'
          ? (linguaPagina(registrazione.locale) ?? pageLocale)
          : pageLocale;
      const link = {
        baseUrl,
        slug,
        eventId: event.id,
        accessToken: registrazione.accessToken,
        locale,
      };
      await sendConfirmationEmail({
        registrationId: registrazione.id,
        locale,
        joinUrl: registrationJoinUrl({ ...link, viaEmailEntry: true, bindsIdentity: true }),
        calendarJoinUrl: registrationJoinUrl({ ...link, viaEmailEntry: false }),
        eventPageUrl: localizedUrl(baseUrl, `/events/${slug}`, locale),
      });
    }
    return Response.json(
      { eventSlug: slug, delivery: 'email' },
      { status: 202, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Iscrizione aperta: la transazione ha creato l'iscrizione, oppure ha gia'
  // risposto «gia' iscritto».
  if (esito.tipo !== 'nuova') throw new AlreadyRegisteredError();
  const registration = esito.registrazione;

  const joinUrl = localizedUrl(baseUrl, `/events/${slug}/live?token=${accessToken}`, pageLocale);
  const eventPageUrl = localizedUrl(baseUrl, `/events/${slug}`, pageLocale);
  const link = { baseUrl, slug, eventId: event.id, accessToken, locale: pageLocale };

  // Nell'email il link firmato: aperto da questo browser, prova anche che
  // l'indirizzo e' suo (lib/events/registration-link). La risposta qui sotto
  // resta senza firma: il modulo non prova niente sull'indirizzo.
  await sendConfirmationEmail({
    registrationId: registration.id,
    locale: pageLocale,
    joinUrl: registrationJoinUrl({ ...link, viaEmailEntry: true }),
    calendarJoinUrl: registrationJoinUrl({ ...link, viaEmailEntry: false }),
    eventPageUrl,
  });

  // Per-event access cookie: lets the browser return to /live after losing
  // the `?token=` (refresh, bookmark, back via the event page) without being
  // bounced into the /registration → 409 loop.
  const ttl = eventAccessTtlSeconds(event.endsAt);
  const eventCookie = buildEventAccessSetCookie(
    event.id,
    await signEventAccess(event.id, accessToken, ttl),
    ttl,
  );

  return Response.json(
    {
      id: registration.id,
      // displayName is encrypted at rest; return the plaintext we received
      // so the caller (registration confirmation UI) sees a readable name.
      displayName,
      eventSlug: slug,
      accessToken,
      joinUrl,
    },
    { status: 201, headers: { 'Cache-Control': 'no-store', 'Set-Cookie': eventCookie } },
  );
});
