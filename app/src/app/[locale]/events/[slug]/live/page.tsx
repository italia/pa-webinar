// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';

import { prisma } from '@/lib/db';
import { chiedeConsensoPerVoce, versioneConsensoTrascrizione } from '@/lib/ai/voice-consent';
import { traccePerPersonaConservate, trascrizioneDalVideo } from '@/lib/registration/consents';
import { anteprimaEventoPubblico } from '@/lib/events/meta-title';
import { getPublicEnv } from '@/lib/env';
import { captionsTranscriptActive, liveCaptionsAvailable } from '@/lib/captions/availability';
import { getSettings } from '@/lib/settings';
import { recordingAvailableFor, voceNelVideo } from '@/lib/recording/availability';
import { accessoRegistrazione, vedeVideo } from '@/lib/recording/audience';
import {
  consensoCopre,
  destinazioneDelTesto,
  recuperoAperto,
} from '@/lib/recording/destination';
import { registraChiConduce } from '@/lib/live/entry-consents';
import { informativaEvento } from '@/lib/events/privacy-notice';
import { schedaPrivacyEvento, testoIaDelSito } from '@/lib/events/privacy-sheet';
import LiveEventClient from '@/components/live/live-event-client';
import AdminSessionKeepAlive from '@/components/admin/admin-session-keepalive';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import { resolveKickerEnabled } from '@/lib/utils/title-kicker';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { eventAccessCookieName, verifyEventAccess } from '@/lib/event-session';
import { resolveGrantForEvent } from '@/lib/auth/moderator';
import { staffDietroIlPrimario } from '@/lib/auth/staff-seat';
import { isEventPageVisible } from '@/lib/events/visibility';
import { hasJoinGrant } from '@/lib/events/join-grant';
import { guestAccessAllowed, guestWindowOpen } from '@/lib/events/guest-window';
import { resolveRnnoiseEnforceOff } from '@/lib/jitsi/rnnoise';
import { resolveWhiteboardInfraReady } from '@/lib/jitsi/whiteboard';
import { localizedPath } from '@/lib/utils/localized-url';
import { OVERTIME_CAP_DEFAULT_MINUTES } from '@/lib/events/overtime-defaults';
import { entiEPersonePubblici, PERSONE_PUBBLICHE_INCLUDE } from '@/lib/events/public-people';
import { elencoVisibileAlPubblico } from '@/lib/live/participant-list';
import { domandePubbliche, domandePubblicabili } from '@/lib/events/post-event-sections';

export const dynamic = 'force-dynamic';

interface LivePageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ token?: string }>;
}

export async function generateMetadata({ params }: LivePageProps): Promise<Metadata> {
  const { slug } = await params;
  // Il link per entrare e' quello che si condivide di piu': chi lo riceve
  // vede l'anteprima dell'evento, non quella generica del sito.
  const anteprima = await anteprimaEventoPubblico(slug, `/events/${slug}/live`);
  return { ...(anteprima ?? {}), robots: { index: false } };
}

export default async function LivePage({ params, searchParams }: LivePageProps) {
  const { slug } = await params;
  // Mutable: a registered participant returning without `?token=` can be
  // re-identified from the per-event access cookie (see below).
  let { token } = await searchParams;
  const locale = await getLocale();

  const event = await prisma.event.findUnique({
    where: { slug },
    include: {
      _count: { select: { registrations: true } },
      gdprTemplate: { select: { body: true } },
      // Per il riepilogo della sala d'attesa: gli stessi enti e le stesse
      // persone che mostra la pagina pubblica (lib/events/public-people).
      ...PERSONE_PUBBLICHE_INCLUDE,
    },
  });

  if (!event) {
    notFound();
  }

  // L'informativa privacy accanto al consenso chiesto in sala d'attesa: la
  // stessa del modulo di iscrizione.
  const privacy = informativaEvento(event, locale);

  // Il riepilogo della sala d'attesa: descrizione, enti e persone.
  const riepilogo = {
    descrizione: getLocalized(event.description as LocalizedField, locale) || null,
    ...entiEPersonePubblici(event, tryDecryptPII),
  };

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
  // Se qualcosa puo' registrare questo evento (il video, o le sue tracce per
  // persona): senza, a chi partecipa non si dice «questo evento puo' essere
  // registrato» e non si chiede il consenso (lib/recording/availability).
  const canRecord = recordingAvailableFor(event);

  const watermark = {
    url:
      settings.jitsiWatermarkUrl || settings.logoUrl || '/images/default-watermark.svg',
    enabled: settings.jitsiWatermarkEnabled,
    opacity: settings.jitsiWatermarkOpacity,
    position: settings.jitsiWatermarkPosition,
  };

  // Video/audio quality: per-event override (Event.videoQuality) inherits the
  // site default (SiteSetting.videoQuality) when null. Flows down to JitsiRoom.
  const videoQuality = event.videoQuality ?? settings.videoQuality;

  // La soppressione rumore avanzata (rnnoise) di Jitsi si accende/spegne QUI,
  // in un Server Component, e scende come prop: la stessa lettura dentro
  // JitsiRoom (client) verrebbe sostituita da webpack a build time e
  // resterebbe congelata nell'immagine, rendendo il flag non modificabile da
  // Helm. Default = forzata OFF: si accende con
  // NEXT_PUBLIC_JITSI_RNNOISE_ENFORCE="false" nell'env del pod, e solo con
  // il jitsi/web patchato a 48 kHz (vedi lib/jitsi/rnnoise.ts).
  const rnnoiseEnforceOff = resolveRnnoiseEnforceOff(
    getPublicEnv('NEXT_PUBLIC_JITSI_RNNOISE_ENFORCE'),
  );

  // Lavagna di Jitsi: il pulsante del moderatore compare solo se
  // l'installazione ne ha il backend. Letto qui a runtime per lo stesso motivo
  // di rnnoise (lib/jitsi/whiteboard.ts).
  const whiteboardInfraReady = resolveWhiteboardInfraReady(
    getPublicEnv('NEXT_PUBLIC_WHITEBOARD_ENABLED'),
  );

  // Informativa AI per la sala d'attesa (AI Act / GDPR trasparenza): la dice
  // la scheda privacy. Sulle chiamate rapide, senza scheda, la mostriamo quando
  // il master switch è attivo E l'evento ha almeno una feature AI. Il testo è
  // il custom per-locale dell'admin oppure null → la WaitingRoom usa il
  // fallback i18n `waiting.aiNotice`.
  const aiPostprodEnabled =
    !!settings.aiPipelineEnabled &&
    (event.aiTranscriptEnabled ||
      event.aiSummaryEnabled ||
      event.aiTranslationEnabled ||
      event.aiDubbingEnabled);
  // Sottotitoli live (ADR-018): servizio installato e acceso nell'istanza.
  // Se l'evento li vuole, lo dice il suo flag, che il moderatore cambia dal vivo.
  const captionsAvailable = liveCaptionsAvailable(settings);
  const aiConsentDisclosure = testoIaDelSito(settings, locale);
  // La scheda dell'evento com'e', una sola per ospiti e iscritti: gli stessi
  // fatti del modulo d'iscrizione. Null sulle chiamate rapide.
  const schedaPrivacy = schedaPrivacyEvento(event, settings);

  const isInstant = event.eventType === 'INSTANT';

  const cookieStore = await cookies();
  const voce = voceNelVideo();
  // La destinazione del testo in vigore: la stessa regola della rotta del token,
  // o la sala non richiederebbe il consenso a chi il token esclude dal video.
  const destinazione = destinazioneDelTesto(event.recordingDestination, voce);
  // La pipeline AI trascrive il video: anche questo chiede il consenso. Mai
  // nelle chiamate rapide.
  const trascrizioneVideo = trascrizioneDalVideo(event, settings, canRecord, voce);

  // Il video non arriva mai alla pagina come indirizzo: il client sa solo se chi
  // guarda puo' vederlo, e il link porta alla rotta che ripete il controllo
  // (lib/recording/audience). Il recupero non ha una rotta propria: esiste solo
  // in diretta, e su una registrazione riservata non si offre a chi e' in sala.
  const accesso =
    event.status === 'ENDED' ? await accessoRegistrazione(event, cookieStore) : null;
  const videoDisponibile = !!event.recordingUrl && vedeVideo(event, accesso);
  const recuperoInDiretta = recuperoAperto(event) ? event.tempRecordingUrl : null;

  // No token: guest access or redirect. Password-protected events
  // require a cleared join-grant cookie before we issue the guest JWT.
  // La password protegge l'ingresso da ospite: se l'amministrazione non
  // ammette ospiti (eventi a calendario, lib/events/guest-window), chiederla
  // sarebbe un passaggio a vuoto prima del rimando all'iscrizione.
  if (!token) {
    if (
      guestAccessAllowed(event, settings.guestAccessEnabled) &&
      event.joinPasswordHash &&
      !(await hasJoinGrant(event.id))
    ) {
      redirect(localizedPath(`/events/${slug}/password`, locale));
    }
    // Re-establish a registered participant from the signed per-event access
    // cookie (set at registration) BEFORE falling back to guest access or the
    // registration redirect. This is what keeps a refresh / shared link that
    // dropped the `?token=` out of the /registration → 409 loop.
    const cookieToken = await verifyEventAccess(
      event.id,
      cookieStore.get(eventAccessCookieName(event.id))?.value
    );
    if (cookieToken) {
      // Fall through to the participant-resolution path below with this token.
      token = cookieToken;
    } else if (
      // INSTANT calls: anyone with the link can walk in. Allow guest access
      // for any joinable status (LIVE / IDLE / PROVISIONING) so the user lands
      // on the waiting room even while the bridge warms up. SCHEDULED events
      // still require a personal token for any non-LIVE status — via
      // /registration — and for LIVE too when the administration turns guest
      // access off. La regola e' la stessa di chat e pannelli.
      guestWindowOpen(event, settings.guestAccessEnabled)
    ) {
      const title = getLocalized(event.title as LocalizedField, locale);
      return (
        <LiveEventClient
          event={{
            id: event.id,
            slug: event.slug,
            title,
            parseTitleKicker: resolveKickerEnabled(event, settings.parseTitleKicker),
            // Pubblico anonimo: niente piazza, dove ci si riconosce dal nome.
            waitingRoomEngine: event.audienceAnonymous ? 'CLASSIC' : (event.waitingRoomEngine ?? settings.waitingRoomEngine),
            audienceAnonymous: event.audienceAnonymous,
            participantListVisible: elencoVisibileAlPubblico(event),
            hostsAlwaysRecorded: event.hostsAlwaysRecorded,
            recordingDestination: event.recordingDestination,
            recordingAudience: event.recordingAudience,
            tracceConservate: traccePerPersonaConservate(event, settings),
            videoQuality,
            startsAt: event.startsAt.toISOString(),
            endsAt: event.endsAt.toISOString(),
            status: event.status,
            eventType: event.eventType,
            postEventPublic: event.postEventPublic,
            postEventShow: {
          recap: event.postEventShowRecap,
          qa: domandePubbliche(event),
          polls: event.postEventShowPolls,
          wordCloud: event.postEventShowWordCloud,
          materials: event.postEventShowMaterials,
          feedback: event.postEventShowFeedback,
        },
            domandePubblicabili: domandePubblicabili(event),
            libraryListed: event.libraryListed,
            recordingEnabled: isInstant ? false : event.recordingEnabled,
            autoStartRecording: isInstant ? false : event.autoStartRecording,
            qaEnabled: event.qaEnabled,
            chatEnabled: event.chatEnabled,
            agendaEnabled: event.agendaEnabled,
            whiteboardEnabled: event.whiteboardEnabled,
            waitingRoomAudioUrl: event.waitingRoomAudioUrl,
            participantsCanUnmute: event.participantsCanUnmute,
            participantsCanStartVideo: event.participantsCanStartVideo,
            participantsCanShareScreen: event.participantsCanShareScreen,
            organizerName: event.organizerName,
            moderatorName: event.moderatorName,
            riepilogo,
            imageUrl: event.imageUrl,
            coverImageUrl: event.coverImageUrl,
            maxParticipants: event.maxParticipants,
            videoDisponibile,
            tempRecordingUrl: recuperoInDiretta,
            feedbackEnabled: event.feedbackEnabled,
            recordingConsentText: isInstant ? null : event.recordingConsentText,
            voceNelVideo: voce,
            privacy,
            schedaPrivacy,
            timezone: event.timezone,
            registrationCount: event._count.registrations,
            effectiveGraceMinutes:
              event.gracePeriodMinutes ?? settings.eventGracePeriodMinutes ?? OVERTIME_CAP_DEFAULT_MINUTES,
            aiPostprodEnabled,
            liveCaptionsAvailable: captionsAvailable,
            liveCaptionsEnabled: event.liveCaptionsEnabled,
            liveCaptionsLanguage: settings.defaultLocale,
            aiConsentDisclosure,
            multitrackRecordingEnabled: isInstant
              ? false
              : event.multitrackRecordingEnabled && canRecord,
            captionsTranscript: captionsTranscriptActive(event, settings),
            trascrizioneVideo,
          }}
          token=""
          isModerator={false}
          isGuest={true}
          displayName=""
          locale={locale}
          jitsiDomain={getPublicEnv('NEXT_PUBLIC_JITSI_DOMAIN')}
          watermark={watermark}
          recordingAvailable={canRecord}
          reactionsMode={settings.reactionsMode === 'CUSTOM' ? 'CUSTOM' : 'NATIVE'}
          rnnoiseEnforceOff={rnnoiseEnforceOff}
          whiteboardInfraReady={whiteboardInfraReady}
        />
      );
    } else if (isInstant) {
      notFound();
    } else if (event.status === 'ENDED' || event.status === 'ARCHIVED') {
      // Evento concluso senza token (link della sala salvato, cookie scaduto):
      // manda alla pagina evento — registrazione video, archivio Q&A, feedback —
      // invece che a /registration, che per stati ≠ PUBLISHED/LIVE fa 404.
      redirect(localizedPath(`/events/${slug}`, locale));
    } else {
      redirect(localizedPath(`/events/${slug}/registration`, locale));
    }
  }

  // Magic-link path: primario condiviso, co-moderatore (role=MODERATOR) o
  // speaker (role=SPEAKER). Risoluzione unica in resolveGrantForEvent —
  // nome del grant GIÀ DECIFRATO (EventModerator.name è cifrato a riposo:
  // la lookup diretta qui mostrava ciphertext base64 nel pre-join).
  const grant = await resolveGrantForEvent(event, token);
  const isPrimaryModerator = !!grant?.isPrimaryShared;
  const isCoModerator = !!grant && !grant.isPrimaryShared && grant.role === 'MODERATOR';
  const isSpeaker = !!grant && grant.role === 'SPEAKER';
  const isModerator = isPrimaryModerator || isCoModerator;

  let participantInfo: { displayName: string } | null = null;
  // Consenso multitrack già prestato alla registrazione → non lo si richiede di
  // nuovo in sala d'attesa (evita il doppio consenso). Vedi WaitingRoom.
  let hasMultitrackConsent = false;
  // Lo stesso per il consenso alla registrazione dell'evento.
  let hasRecordingConsent = false;
  // L'iscritto e' gia' entrato in sala (anche in una visita precedente): la
  // valutazione di fine evento gli si puo' proporre anche senza il token
  // della sala di questa pagina.
  let iscrizioneEntrata = false;
  // Il browser che si e' iscritto apre il proprio link: entra con il nome
  // dell'iscrizione (la rotta del token applica la stessa regola).
  let linkDellIscritto = false;
  if (!isModerator && !isSpeaker) {
    const registration = await prisma.registration.findUnique({
      where: { accessToken: token },
      select: {
        id: true,
        displayName: true,
        eventId: true,
        consentRecording: true,
        consentRecordingDestination: true,
        consentMultitrack: true,
        consentMultitrackVersion: true,
        consentRecordingWithdrawnAt: true,
        consentMultitrackWithdrawnAt: true,
        joinedAt: true,
      },
    });

    if (!registration || registration.eventId !== event.id) {
      // Token personale non valido/scaduto (refuso nel link email, o registrazione
      // rimossa dal retention cron mentre l'email col link sopravvive): niente 404
      // secco. Torniamo alla pagina evento con un avviso contestuale e le CTA giuste
      // (ri-registrazione, oppure guarda la registrazione se l'evento è concluso).
      // Solo per stati in cui la pagina evento è raggiungibile (stesso check
      // della destinazione, lib/events/visibility): per DRAFT/ARCHIVED fa
      // notFound() a sua volta, e un redirect verso un 404 è peggio del 404.
      if (isEventPageVisible(event)) {
        redirect(localizedPath(`/events/${slug}?invalidToken=1`, locale));
      }
      notFound();
    }
    // Only the browser that REGISTERED (matching signed event_access cookie)
    // inherits the registrant's name/consent. A forwarded personal link →
    // blank the pre-join name so the opener types their OWN and enters as a
    // named guest; the JWT route enforces the same rule server-side.
    const ownsToken =
      (await verifyEventAccess(
        event.id,
        cookieStore.get(eventAccessCookieName(event.id))?.value,
      )) === token;
    linkDellIscritto = ownsToken;
    participantInfo = {
      displayName: ownsToken
        ? (tryDecryptPII(registration.displayName) ?? registration.displayName)
        : '',
    };
    // Dati all'iscrizione, o in sala d'attesa a un ingresso precedente (chi si
    // e' iscritto prima che l'evento registrasse): la prova sta legata
    // all'iscrizione solo nel browser che si e' iscritto.
    // Un consenso ritirato dalla sala non vale piu' (lib/live/consent-withdrawal),
    // e uno che il testo in vigore non copre si richiede in sala.
    const prove = { eventId: event.id, registrationId: registration.id, withdrawnAt: null };
    // Vale solo il consenso dato con il testo che comprende la trascrizione
    // dell'evento: a chi aveva dato quello per la sola traccia audio si richiede.
    const versioneMinima = versioneConsensoTrascrizione(event, settings);
    const datoAllIscrizione =
      registration.consentMultitrack === true &&
      !registration.consentMultitrackWithdrawnAt &&
      (registration.consentMultitrackVersion ?? 1) >= versioneMinima;
    const registrazioneAllIscrizione =
      registration.consentRecording === true &&
      !registration.consentRecordingWithdrawnAt &&
      consensoCopre(registration.consentRecordingDestination, destinazione);
    const [proveTracce, provaRegistrazione] = ownsToken
      ? await Promise.all([
          !datoAllIscrizione && chiedeConsensoPerVoce(event, settings)
            ? prisma.multitrackConsent.count({ where: { ...prove, textVersion: { gte: versioneMinima } } })
            : 0,
          !registrazioneAllIscrizione && event.recordingEnabled
            ? prisma.recordingConsent.findFirst({ where: prove, select: { destination: true } })
            : null,
        ])
      : ([0, null] as const);
    hasMultitrackConsent = ownsToken && (datoAllIscrizione || proveTracce > 0);
    hasRecordingConsent =
      ownsToken &&
      (registrazioneAllIscrizione ||
        (!!provaRegistrazione && consensoCopre(provaRegistrazione.destination, destinazione)));
    // Solo per chi ha il proprio link: un link inoltrato non risponde a nome
    // di chi l'ha ricevuto.
    iscrizioneEntrata = ownsToken && registration.joinedAt !== null;
  } else if (isPrimaryModerator) {
    // Chi conduce dal link primario con la sessione del proprio account: i
    // consensi dati a un ingresso precedente non si richiedono, e si possono
    // ritirare da questo. Solo qui, dove dietro il link c'e' una persona: un
    // link nominale puo' essere inoltrato, e chi lo apre non eredita il consenso
    // di un altro (lo da' a ogni visita della pagina).
    const staff = await staffDietroIlPrimario(event.id);
    if (staff) {
      const dellAccount = { eventId: event.id, staffAccountId: staff.accountId, withdrawnAt: null };
      const [proveStaff, tracceStaff] = await Promise.all([
        registraChiConduce(event, canRecord)
          ? prisma.recordingConsent.findMany({ where: dellAccount, select: { destination: true } })
          : [],
        chiedeConsensoPerVoce(event, settings)
          ? prisma.multitrackConsent.count({
              where: {
                ...dellAccount,
                textVersion: { gte: versioneConsensoTrascrizione(event, settings) },
              },
            })
          : 0,
      ]);
      // Una prova per ingresso: basta che una copra il testo in vigore.
      hasRecordingConsent = proveStaff.some((p) => consensoCopre(p.destination, destinazione));
      hasMultitrackConsent = tracceStaff > 0;
    }
  }

  const title = getLocalized(event.title as LocalizedField, locale);

  // Lo staff dietro il link primario ha il suo posto finche' vale la sessione:
  // in sala la si tiene viva come nell'amministrazione.
  const staffInSala = isPrimaryModerator ? await staffDietroIlPrimario(event.id) : null;

  return (
    <>
    {staffInSala && <AdminSessionKeepAlive allaScadenza="resta" />}
    <LiveEventClient
      event={{
        id: event.id,
        slug: event.slug,
        title,
        parseTitleKicker: resolveKickerEnabled(event, settings.parseTitleKicker),
        // Pubblico anonimo: niente piazza, dove ci si riconosce dal nome.
        waitingRoomEngine: event.audienceAnonymous ? 'CLASSIC' : (event.waitingRoomEngine ?? settings.waitingRoomEngine),
        audienceAnonymous: event.audienceAnonymous,
        participantListVisible: elencoVisibileAlPubblico(event),
        hostsAlwaysRecorded: event.hostsAlwaysRecorded,
        recordingDestination: event.recordingDestination,
        recordingAudience: event.recordingAudience,
        tracceConservate: traccePerPersonaConservate(event, settings),
        startsAt: event.startsAt.toISOString(),
        endsAt: event.endsAt.toISOString(),
        status: event.status,
        eventType: event.eventType,
        guestEntryOpen: guestAccessAllowed(event, settings.guestAccessEnabled),
        postEventPublic: event.postEventPublic,
        postEventShow: {
          recap: event.postEventShowRecap,
          qa: domandePubbliche(event),
          polls: event.postEventShowPolls,
          wordCloud: event.postEventShowWordCloud,
          materials: event.postEventShowMaterials,
          feedback: event.postEventShowFeedback,
        },
        domandePubblicabili: domandePubblicabili(event),
        libraryListed: event.libraryListed,
        recordingEnabled: event.recordingEnabled,
        autoStartRecording: event.autoStartRecording,
        qaEnabled: event.qaEnabled,
        chatEnabled: event.chatEnabled,
        agendaEnabled: event.agendaEnabled,
        whiteboardEnabled: event.whiteboardEnabled,
        waitingRoomAudioUrl: event.waitingRoomAudioUrl,
        participantsCanUnmute: event.participantsCanUnmute,
        participantsCanStartVideo: event.participantsCanStartVideo,
        participantsCanShareScreen: event.participantsCanShareScreen,
        organizerName: event.organizerName,
        moderatorName: event.moderatorName,
        riepilogo,
        imageUrl: event.imageUrl,
        coverImageUrl: event.coverImageUrl,
        maxParticipants: event.maxParticipants,
        videoDisponibile,
        tempRecordingUrl: recuperoInDiretta,
        feedbackEnabled: event.feedbackEnabled,
        recordingConsentText: event.recordingConsentText,
        voceNelVideo: voce,
        privacy,
        schedaPrivacy,
        timezone: event.timezone,
        registrationCount: event._count.registrations,
        effectiveGraceMinutes:
          event.gracePeriodMinutes ?? settings.eventGracePeriodMinutes ?? OVERTIME_CAP_DEFAULT_MINUTES,
        aiPostprodEnabled,
        liveCaptionsAvailable: captionsAvailable,
        liveCaptionsEnabled: event.liveCaptionsEnabled,
        liveCaptionsLanguage: settings.defaultLocale,
        aiConsentDisclosure,
        multitrackRecordingEnabled: event.multitrackRecordingEnabled && canRecord,
        captionsTranscript: captionsTranscriptActive(event, settings),
        trascrizioneVideo,
      }}
      token={token}
      isModerator={isModerator}
      isPrimaryModerator={isPrimaryModerator}
      isSpeaker={isSpeaker}
      isGuest={false}
      hasMultitrackConsent={hasMultitrackConsent}
      hasRecordingConsent={hasRecordingConsent}
      registrationJoined={iscrizioneEntrata}
      registrantOwnsLink={linkDellIscritto}
      displayName={
        grant && !grant.isPrimaryShared
          ? // Named co-moderator or speaker via EventModerator row —
            // greet them by name in the pre-join input (still editable).
            (grant.displayName ?? '')
          : isPrimaryModerator
            ? // Primary moderator magic-link (shared): keep the input
              // empty so anyone opening the link types their own name
              // rather than inheriting the configured moderatorName — unless
              // a staff member who manages the event opened it: then it is
              // their own name (lib/auth/staff-seat).
              (staffInSala?.nome ?? '')
            : (participantInfo?.displayName ?? 'Partecipante')
      }
      locale={locale}
      jitsiDomain={getPublicEnv('NEXT_PUBLIC_JITSI_DOMAIN')}
      watermark={watermark}
      recordingAvailable={canRecord}
      reactionsMode={settings.reactionsMode === 'CUSTOM' ? 'CUSTOM' : 'NATIVE'}
      rnnoiseEnforceOff={rnnoiseEnforceOff}
      whiteboardInfraReady={whiteboardInfraReady}
    />
    </>
  );
}
