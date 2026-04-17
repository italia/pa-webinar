import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { jwtVerify } from 'jose';

import { prisma } from '@/lib/db';
import { getPublicEnv } from '@/lib/env';
import { getSettings } from '@/lib/settings';
import { isJibriAvailable } from '@/lib/infrastructure';
import LiveEventClient from '@/components/live/live-event-client';
import ProvisioningScreen from '@/components/live/provisioning-screen';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';

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
  const { token } = await searchParams;
  const locale = await getLocale();

  const event = await prisma.event.findUnique({
    where: { slug },
    include: { _count: { select: { registrations: true } } },
  });

  if (!event) {
    notFound();
  }

  // Intercept IDLE / PROVISIONING before doing any Jitsi setup: the bridge
  // isn't ready, handing out a JWT or embedding Jitsi now would dump the
  // user onto a cold pod. ProvisioningScreen calls /wake and polls until
  // the scaler brings the bridge up, then reloads this page.
  if (event.status === 'IDLE' || event.status === 'PROVISIONING') {
    const title = getLocalized(event.title as LocalizedField, locale);
    return (
      <ProvisioningScreen
        slug={event.slug}
        title={title}
        initialStatus={event.status}
        camefromIdle={event.status === 'IDLE'}
      />
    );
  }

  const settings = await getSettings();
  const jibriAvailable = await isJibriAvailable();

  const watermark = {
    url: settings.jitsiWatermarkUrl || settings.logoUrl || '/images/default-watermark.svg',
    enabled: settings.jitsiWatermarkEnabled,
    opacity: settings.jitsiWatermarkOpacity,
    position: settings.jitsiWatermarkPosition,
  };

  const isInstant = event.eventType === 'INSTANT';

  // No token: guest access or redirect. Password-protected events
  // require a cleared join-grant cookie before we issue the guest JWT.
  if (!token) {
    if (event.joinPasswordHash && !(await hasJoinGrant(event.id))) {
      redirect(`/${locale}/events/${slug}/password`);
    }
    if (event.status === 'LIVE') {
      const title = getLocalized(event.title as LocalizedField, locale);
      return (
        <LiveEventClient
          event={{
            id: event.id,
            slug: event.slug,
            title,
            startsAt: event.startsAt.toISOString(),
            endsAt: event.endsAt.toISOString(),
            status: event.status,
            eventType: event.eventType,
            recordingEnabled: isInstant ? false : event.recordingEnabled,
            qaEnabled: event.qaEnabled,
            chatEnabled: event.chatEnabled,
            waitingRoomAudioUrl: event.waitingRoomAudioUrl,
            participantsCanUnmute: event.participantsCanUnmute,
            participantsCanStartVideo: event.participantsCanStartVideo,
            participantsCanShareScreen: event.participantsCanShareScreen,
            timezone: event.timezone,
            registrationCount: event._count.registrations,
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
    }
    if (isInstant) {
      notFound();
    }
    redirect(`/${locale}/events/${slug}/registration`);
  }

  const isPrimaryModerator = event.moderatorToken === token;

  // Co-moderator path: token matches an EventModerator row for this
  // event (and isn't revoked). Resolved in a single query so we get the
  // co-moderator's own display name to propagate to the pre-join flow.
  const coMod = isPrimaryModerator
    ? null
    : await prisma.eventModerator.findUnique({ where: { token } });
  const isCoModerator =
    !!coMod && coMod.eventId === event.id && coMod.revokedAt === null;
  const isModerator = isPrimaryModerator || isCoModerator;

  let participantInfo: { displayName: string } | null = null;
  if (!isModerator) {
    const registration = await prisma.registration.findUnique({
      where: { accessToken: token },
      select: { displayName: true, eventId: true },
    });

    if (!registration || registration.eventId !== event.id) {
      notFound();
    }
    participantInfo = { displayName: registration.displayName };
  }

  const title = getLocalized(event.title as LocalizedField, locale);

  return (
    <LiveEventClient
      event={{
        id: event.id,
        slug: event.slug,
        title,
        startsAt: event.startsAt.toISOString(),
        endsAt: event.endsAt.toISOString(),
        status: event.status,
        eventType: event.eventType,
        recordingEnabled: event.recordingEnabled,
        qaEnabled: event.qaEnabled,
        chatEnabled: event.chatEnabled,
        waitingRoomAudioUrl: event.waitingRoomAudioUrl,
        participantsCanUnmute: event.participantsCanUnmute,
        participantsCanStartVideo: event.participantsCanStartVideo,
        participantsCanShareScreen: event.participantsCanShareScreen,
        timezone: event.timezone,
      }}
      token={token}
      isModerator={isModerator}
      isGuest={false}
      displayName={
        isCoModerator && coMod
          // Named co-moderator via EventModerator row — greet them by
          // name in the pre-join input (still editable).
          ? coMod.name
          : isModerator
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
