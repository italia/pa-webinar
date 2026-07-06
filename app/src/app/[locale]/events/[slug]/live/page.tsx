import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { jwtVerify } from 'jose';

import { prisma } from '@/lib/db';
import { getPublicEnv } from '@/lib/env';
import { getSettings } from '@/lib/settings';
import { isJibriAvailable } from '@/lib/infrastructure';
import LiveEventClient from '@/components/live/live-event-client';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import { resolveKickerEnabled } from '@/lib/utils/title-kicker';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { eventAccessCookieName, verifyEventAccess } from '@/lib/event-session';

async function hasJoinGrant(eventId: string): Promise<boolean> {
  const appSecret = process.env.APP_SECRET;
  if (!appSecret) return false;
  const cookieStore = await cookies();
  const cookie = cookieStore.get(`join_granted_${eventId}`)?.value;
  if (!cookie) return false;
  try {
    const secret = new TextEncoder().encode(appSecret);
    const { payload } = await jwtVerify(cookie, secret);
    return payload.eventId === eventId;
  } catch {
    return false;
  }
}

export const dynamic = 'force-dynamic';

interface LivePageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ token?: string }>;
}

export default async function LivePage({ params, searchParams }: LivePageProps) {
  const { slug } = await params;
  // Mutable: a registered participant returning without `?token=` can be
  // re-identified from the per-event access cookie (see below).
  let { token } = await searchParams;
  const locale = await getLocale();

  const event = await prisma.event.findUnique({
    where: { slug },
    include: { _count: { select: { registrations: true } } },
  });

  if (!event) {
    notFound();
  }

  // IDLE / PROVISIONING used to redirect users to a dedicated
  // "Sala in allestimento" spinner. Demo feedback: by the time the
  // bridge is ready and we redirect into the waiting room, the user
  // only sees the waiting-room garden for a few seconds — the value
  // of the room (chat preview, netiquette, device check, garden
  // lobby) is wasted. We now let every joinable state flow into the
  // waiting room and warm the bridge in the background; the room
  // shows a "preparing" indicator and disables "Entra ora" until the
  // scaler flips status to LIVE. The /wake call is fired from
  // LiveEventClient on mount when the initial status is IDLE.

  const settings = await getSettings();
  const jibriAvailable = await isJibriAvailable();

  const watermark = {
    url: settings.jitsiWatermarkUrl || settings.logoUrl || '/images/default-watermark.svg',
    enabled: settings.jitsiWatermarkEnabled,
    opacity: settings.jitsiWatermarkOpacity,
    position: settings.jitsiWatermarkPosition,
  };

  // Video/audio quality: per-event override (Event.videoQuality) inherits the
  // site default (SiteSetting.videoQuality) when null. Flows down to JitsiRoom.
  const videoQuality = event.videoQuality ?? settings.videoQuality;

  // Informativa AI per la sala d'attesa (AI Act / GDPR trasparenza): la
  // mostriamo quando il master switch è attivo E l'evento ha almeno una
  // feature AI. Il testo è il custom per-locale dell'admin
  // (SiteSetting.aiConsentDisclosure) oppure null → la WaitingRoom usa il
  // fallback i18n `waiting.aiNotice`.
  const aiPostprodEnabled =
    !!settings.aiPipelineEnabled &&
    (event.aiTranscriptEnabled ||
      event.aiSummaryEnabled ||
      event.aiTranslationEnabled ||
      event.aiDubbingEnabled);
  const aiConsentDisclosure =
    ((settings.aiConsentDisclosure as Record<string, string> | null) ?? {})[
      locale
    ] ?? null;

  const isInstant = event.eventType === 'INSTANT';

  // No token: guest access or redirect. Password-protected events
  // require a cleared join-grant cookie before we issue the guest JWT.
  if (!token) {
    if (event.joinPasswordHash && !(await hasJoinGrant(event.id))) {
      redirect(`/${locale}/events/${slug}/password`);
    }
    // Re-establish a registered participant from the signed per-event access
    // cookie (set at registration) BEFORE falling back to guest access or the
    // registration redirect. This is what keeps a refresh / shared link that
    // dropped the `?token=` out of the /registration → 409 loop.
    const cookieStore = await cookies();
    const cookieToken = await verifyEventAccess(
      event.id,
      cookieStore.get(eventAccessCookieName(event.id))?.value,
    );
    if (cookieToken) {
      // Fall through to the participant-resolution path below with this token.
      token = cookieToken;
    } else if (
      // INSTANT calls: anyone with the link can walk in. Allow guest access
      // for any joinable status (LIVE / IDLE / PROVISIONING) so the user lands
      // on the waiting room even while the bridge warms up. SCHEDULED events
      // still require a personal token for any non-LIVE status — via
      // /registration.
      (isInstant ? ['LIVE', 'IDLE', 'PROVISIONING'] : ['LIVE']).includes(
        event.status,
      )
    ) {
      const title = getLocalized(event.title as LocalizedField, locale);
      return (
        <LiveEventClient
          event={{
            id: event.id,
            slug: event.slug,
            title,
            parseTitleKicker: resolveKickerEnabled(event, settings.parseTitleKicker),
            waitingRoomEngine: event.waitingRoomEngine ?? settings.waitingRoomEngine,
            videoQuality,
            startsAt: event.startsAt.toISOString(),
            endsAt: event.endsAt.toISOString(),
            status: event.status,
            eventType: event.eventType,
            recordingEnabled: isInstant ? false : event.recordingEnabled,
            autoStartRecording: isInstant ? false : event.autoStartRecording,
            qaEnabled: event.qaEnabled,
            chatEnabled: event.chatEnabled,
            agendaEnabled: event.agendaEnabled,
            waitingRoomAudioUrl: event.waitingRoomAudioUrl,
            participantsCanUnmute: event.participantsCanUnmute,
            participantsCanStartVideo: event.participantsCanStartVideo,
            participantsCanShareScreen: event.participantsCanShareScreen,
            organizerName: event.organizerName,
            moderatorName: event.moderatorName,
            imageUrl: event.imageUrl,
            coverImageUrl: event.coverImageUrl,
            maxParticipants: event.maxParticipants,
            recordingUrl: event.recordingUrl,
            tempRecordingUrl: event.tempRecordingUrl,
            feedbackEnabled: event.feedbackEnabled,
            timezone: event.timezone,
            registrationCount: event._count.registrations,
            effectiveGraceMinutes:
              event.gracePeriodMinutes ?? settings.eventGracePeriodMinutes ?? 15,
            aiPostprodEnabled,
            aiConsentDisclosure,
            multitrackRecordingEnabled: isInstant
              ? false
              : event.multitrackRecordingEnabled,
          }}
          token=""
          isModerator={false}
          isGuest={true}
          displayName=""
          locale={locale}
          jitsiDomain={getPublicEnv('NEXT_PUBLIC_JITSI_DOMAIN')}
          watermark={watermark}
          jibriAvailable={jibriAvailable}
        />
      );
    } else if (isInstant) {
      notFound();
    } else if (event.status === 'ENDED' || event.status === 'ARCHIVED') {
      // Evento concluso senza token (link della sala salvato, cookie scaduto):
      // manda alla pagina evento — registrazione video, archivio Q&A, feedback —
      // invece che a /registration, che per stati ≠ PUBLISHED/LIVE fa 404.
      redirect(`/${locale}/events/${slug}`);
    } else {
      redirect(`/${locale}/events/${slug}/registration`);
    }
  }

  const isPrimaryModerator = event.moderatorToken === token;

  // Magic-link path: token may be a co-moderator (role=MODERATOR) or
  // a speaker (role=SPEAKER). Resolved once so we get the grant's own
  // display name for the pre-join greeting and the role for JWT + UI.
  const grant = isPrimaryModerator
    ? null
    : await prisma.eventModerator.findUnique({ where: { token } });
  const isValidGrant =
    !!grant && grant.eventId === event.id && grant.revokedAt === null;
  const isCoModerator = isValidGrant && grant.role === 'MODERATOR';
  const isSpeaker = isValidGrant && grant.role === 'SPEAKER';
  const isModerator = isPrimaryModerator || isCoModerator;

  let participantInfo: { displayName: string } | null = null;
  // Consenso multitrack già prestato alla registrazione → non lo si richiede di
  // nuovo in sala d'attesa (evita il doppio consenso). Vedi WaitingRoom.
  let hasMultitrackConsent = false;
  if (!isModerator && !isSpeaker) {
    const registration = await prisma.registration.findUnique({
      where: { accessToken: token },
      select: { displayName: true, eventId: true, consentMultitrack: true },
    });

    if (!registration || registration.eventId !== event.id) {
      // Token personale non valido/scaduto (refuso nel link email, o registrazione
      // rimossa dal retention cron mentre l'email col link sopravvive): niente 404
      // secco. Torniamo alla pagina evento con un avviso contestuale e le CTA giuste
      // (ri-registrazione, oppure guarda la registrazione se l'evento è concluso).
      // Solo per stati in cui la pagina evento è raggiungibile: per DRAFT/ARCHIVED
      // fa notFound() a sua volta, e un redirect verso un 404 è peggio del 404.
      if (['PUBLISHED', 'LIVE', 'ENDED'].includes(event.status)) {
        redirect(`/${locale}/events/${slug}?invalidToken=1`);
      }
      notFound();
    }
    participantInfo = {
      displayName: tryDecryptPII(registration.displayName) ?? registration.displayName,
    };
    hasMultitrackConsent = registration.consentMultitrack ?? false;
  }

  const title = getLocalized(event.title as LocalizedField, locale);

  return (
    <LiveEventClient
      event={{
        id: event.id,
        slug: event.slug,
        title,
        parseTitleKicker: resolveKickerEnabled(event, settings.parseTitleKicker),
        waitingRoomEngine: event.waitingRoomEngine ?? settings.waitingRoomEngine,
        startsAt: event.startsAt.toISOString(),
        endsAt: event.endsAt.toISOString(),
        status: event.status,
        eventType: event.eventType,
        recordingEnabled: event.recordingEnabled,
        autoStartRecording: event.autoStartRecording,
        qaEnabled: event.qaEnabled,
        chatEnabled: event.chatEnabled,
        agendaEnabled: event.agendaEnabled,
        waitingRoomAudioUrl: event.waitingRoomAudioUrl,
        participantsCanUnmute: event.participantsCanUnmute,
        participantsCanStartVideo: event.participantsCanStartVideo,
        participantsCanShareScreen: event.participantsCanShareScreen,
        organizerName: event.organizerName,
        moderatorName: event.moderatorName,
        imageUrl: event.imageUrl,
        coverImageUrl: event.coverImageUrl,
        maxParticipants: event.maxParticipants,
        recordingUrl: event.recordingUrl,
        tempRecordingUrl: event.tempRecordingUrl,
        feedbackEnabled: event.feedbackEnabled,
        timezone: event.timezone,
        registrationCount: event._count.registrations,
        effectiveGraceMinutes:
          event.gracePeriodMinutes ?? settings.eventGracePeriodMinutes ?? 15,
        aiPostprodEnabled,
        aiConsentDisclosure,
        multitrackRecordingEnabled: event.multitrackRecordingEnabled,
      }}
      token={token}
      isModerator={isModerator}
      isPrimaryModerator={isPrimaryModerator}
      isSpeaker={isSpeaker}
      isGuest={false}
      hasMultitrackConsent={hasMultitrackConsent}
      displayName={
        isValidGrant && grant
          // Named co-moderator or speaker via EventModerator row —
          // greet them by name in the pre-join input (still editable).
          ? grant.name
          : isPrimaryModerator
            // Primary moderator magic-link (shared): keep the input
            // empty so anyone opening the link types their own name
            // rather than inheriting the configured moderatorName.
            ? ''
            : participantInfo?.displayName ?? 'Partecipante'
      }
      locale={locale}
      jitsiDomain={getPublicEnv('NEXT_PUBLIC_JITSI_DOMAIN')}
      watermark={watermark}
      jibriAvailable={jibriAvailable}
    />
  );
}
