// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * GET /api/gdpr/export?t=<signed-token>
 *
 * GDPR Art. 15 — right of access (fulfilment step).
 *
 * The caller must present a token issued by POST /api/gdpr/export/request
 * (which is delivered out-of-band to the registered email address). The
 * token carries the emailHash so we never accept a plaintext email here
 * — that closes the unauthenticated enumeration oracle the previous
 * version of this endpoint exposed.
 *
 * Oltre alle iscrizioni consegna cio' che dura piu' di loro, anche a chi non ne
 * ha piu' nessuna: la voce di rubrica (ADR-011) con il token per uscirne e le
 * prove dei consensi conservate (lib/gdpr/retained-consent-proofs), con il token
 * per ritirarli. Lo stesso per le prove di sala date conducendo un evento, che si
 * trovano con gli stessi legami della cancellazione.
 */

import { withErrorHandling } from '@/lib/api-handler';
import { AppError, RateLimitError } from '@/lib/errors';
import { prisma } from '@/lib/db';
import { decryptPII, tryDecryptPII } from '@/lib/crypto/pii';
import { getClientIp, rateLimit } from '@/lib/rate-limit';
import { voceDi } from '@/lib/live/consent-rule';
import { partecipantiNelVideo } from '@/lib/recording/availability';
import { isFinishedEventStatus } from '@/lib/gdpr/cleanup-selection';
import { proveDiSalaDiChiConduce } from '@/lib/gdpr/consent-proofs';
import { CAMPI_EVENTO_CONSENSI, offertaConsensi } from '@/lib/gdpr/consent-giving';
import { consensiDellIscrizione } from '@/lib/gdpr/consent-state';
import { issueGdprToken, verifyGdprToken } from '@/lib/gdpr/request-token';
import { proveConservateDellaPersona } from '@/lib/gdpr/retained-consent-proofs';
import { iscrizioniConRegistrazione, richiesteDellaPersona } from '@/lib/recording/redaction/requests';
import { rubricaProposta } from '@/lib/persons/address-book';
import { issueRubricaOptOutToken } from '@/lib/persons/opt-out-token';
import { scadenzaRubrica } from '@/lib/persons/retention';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request) => {
  const ip = getClientIp(request);
  const rl = rateLimit(`gdpr-export-get:${ip}`, {
    limit: 10,
    windowMs: 3_600_000,
  });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('t');
  if (!token) {
    throw new AppError('Missing token', 400, 'BAD_REQUEST');
  }

  const verified = verifyGdprToken(token, 'export');
  if (!verified) {
    throw new AppError('Invalid or expired token', 401, 'UNAUTHORIZED');
  }

  const { emailHash } = verified;
  const partecipanti = partecipantiNelVideo();

  const sito = await getSettings();
  const registrations = await prisma.registration.findMany({
    where: { emailHash },
    include: {
      event: {
        select: {
          // Cio' che decide quali consensi si possono dare di nuovo da qui.
          ...CAMPI_EVENTO_CONSENSI,
          // Se l'evento accetta nickname nuovi (lib/live/nickname).
          nicknamesEnabled: true,
          slug: true,
          title: true,
          startsAt: true,
        },
      },
      questions: {
        select: {
          id: true,
          text: true,
          status: true,
          createdAt: true,
        },
      },
      pollVotes: {
        select: {
          id: true,
          optionIndex: true,
          createdAt: true,
          poll: {
            select: {
              question: true,
              options: true,
            },
          },
        },
      },
      // Le prove del consenso alla registrazione per partecipante date in sala
      // d'attesa: quando e in quale lingua (il nome e' quello dell'iscrizione).
      multitrackConsents: {
        select: { consentedAt: true, locale: true, withdrawnAt: true, textVersion: true },
        orderBy: { consentedAt: 'asc' },
      },
      // Lo stesso per il consenso alla registrazione dell'evento dato in sala
      // d'attesa da chi non l'aveva dato all'iscrizione.
      recordingConsents: {
        select: {
          consentedAt: true,
          locale: true,
          withdrawnAt: true,
          destination: true,
          textVersion: true,
        },
        orderBy: { consentedAt: 'asc' },
      },
    },
  });

  // La foto profilo e' legata all'indirizzo, non a un'iscrizione: c'e' anche
  // quando le iscrizioni sono gia' state cancellate (la pulizia la tiene un
  // po' di piu'), e per chi ha solo una concessione nominale.
  const foto = await prisma.profilePhoto.findUnique({
    where: { emailHash },
    select: { contentType: true, bytes: true, createdAt: true },
  });
  const profilePhoto = foto
    ? {
        uploadedAt: foto.createdAt.toISOString(),
        dataUrl: `data:${foto.contentType};base64,${Buffer.from(foto.bytes).toString('base64')}`,
      }
    : null;

  // Le concessioni nominali (organizzatore, moderatore, relatore) con lo
  // stesso indirizzo. A quelle nate prima dell'impronta la pulizia
  // giornaliera la aggiunge (lib/events/grant-email-hash).
  const concessioni = await prisma.eventModerator.findMany({
    where: { emailHash },
    select: {
      id: true,
      name: true,
      role: true,
      organizer: true,
      organization: true,
      publicListed: true,
      createdAt: true,
      revokedAt: true,
      event: { select: { title: true, startsAt: true } },
      // La foto che lo staff ha caricato per la persona.
      photo: { select: { contentType: true, bytes: true } },
      // I consensi alla registrazione dati entrando in sala con la concessione.
      recordingConsents: {
        select: { consentedAt: true, withdrawnAt: true },
        orderBy: { consentedAt: 'asc' },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
  const grants = concessioni.map((g) => ({
    name: tryDecryptPII(g.name) ?? g.name,
    role: g.role === 'SPEAKER' ? 'speaker' : g.organizer ? 'organizer' : 'moderator',
    organization: g.organization,
    shownOnPublicPage: g.publicListed,
    photo: g.photo
      ? `data:${g.photo.contentType};base64,${Buffer.from(g.photo.bytes).toString('base64')}`
      : null,
    createdAt: g.createdAt.toISOString(),
    revokedAt: g.revokedAt?.toISOString() ?? null,
    recordingConsentsGivenAt: (g.recordingConsents ?? []).map((c) => c.consentedAt.toISOString()),
    recordingConsentsWithdrawnAt: (g.recordingConsents ?? [])
      .map((c) => c.withdrawnAt?.toISOString())
      .filter((v): v is string => !!v),
    event: { title: g.event.title, startsAt: g.event.startsAt.toISOString() },
  }));

  // La voce di rubrica dura oltre le iscrizioni: resta l'unico modo di uscirne
  // per chi non riceve email da piu' a lungo del link che ha in casella.
  const voce = await prisma.person.findUnique({
    where: { emailHash },
    select: {
      id: true,
      displayName: true,
      email: true,
      organization: true,
      organizationRole: true,
      organizationType: true,
      optedInToAddressBook: true,
      optedInAt: true,
      optedOutAt: true,
      retentionMonths: true,
    },
  });
  const addressBook = voce
    ? {
        name: voce.displayName ? tryDecryptPII(voce.displayName) : null,
        email: voce.email ? tryDecryptPII(voce.email) : null,
        organization: voce.organization,
        organizationRole: voce.organizationRole,
        organizationType: voce.organizationType,
        optedIn: voce.optedInToAddressBook,
        optedInAt: voce.optedInAt?.toISOString() ?? null,
        optedOutAt: voce.optedOutAt?.toISOString() ?? null,
        expiresAt: voce.optedInToAddressBook
          ? (scadenzaRubrica(voce)?.toISOString() ?? null)
          : null,
        // Solo a chi e' in rubrica: fuori non c'e' niente da cui uscire.
        optOutToken: voce.optedInToAddressBook ? issueRubricaOptOutToken(voce.id) : null,
      }
    : null;

  const retainedConsentProofs = await proveConservateDellaPersona(emailHash);
  const account = await prisma.staffAccount.findUnique({
    where: { emailHash },
    select: { id: true },
  });
  const roomConsentProofs = await proveDiSalaDiChiConduce(prisma, {
    emailHash,
    grantIds: concessioni.map((g) => g.id),
    staffAccountIds: account ? [account.id] : [],
  });

  // Audit one row per distinct event, recording only an emailHash prefix
  // (not the address) so the log itself cannot be reversed.
  const eventIds = [
    ...new Set([
      ...registrations.map((r) => r.eventId),
      ...retainedConsentProofs.map((p) => p.eventId),
      ...roomConsentProofs.map((p) => p.eventId),
    ]),
  ];
  for (const eventId of eventIds) {
    await prisma.gdprAuditLog.create({
      data: {
        eventId,
        action: 'DATA_EXPORTED',
        recordCount: 1,
        details: JSON.stringify({ emailHashPrefix: emailHash.substring(0, 8) }),
      },
    });
  }

  if (registrations.length === 0) {
    return Response.json({
      data: [],
      profilePhoto,
      grants,
      addressBook,
      retainedConsentProofs,
      roomConsentProofs,
      ...(retainedConsentProofs.length > 0 && {
        consentsToken: issueGdprToken('consents', emailHash),
      }),
    });
  }

  // Le frasi dei sottotitoli salvate per la trascrizione: il posto della
  // conferenza e' `reg-<id>-<suffisso>`, l'unico legame con l'iscrizione.
  const frasi =
    registrations.length > 0
      ? await prisma.captionSegment.findMany({
          where: {
            OR: registrations.map((r) => ({ eventId: r.eventId, seatId: { startsWith: `reg-${r.id}-` } })),
          },
          select: { seatId: true, text: true, startedAt: true },
          orderBy: { startedAt: 'asc' },
        })
      : [];

  // Le richieste di non comparire in una registrazione: dove l'evento ne ha
  // una, la pagina offre di chiederlo, e mostra lo stato di quelle fatte.
  const conRegistrazione = await iscrizioniConRegistrazione(registrations);
  const richiesteRimozione = await richiesteDellaPersona(emailHash);

  const result = registrations.map((r) => {
    let decryptedEmail: string | null = null;
    try {
      decryptedEmail = decryptPII(r.email);
    } catch {
      decryptedEmail = null;
    }

    return {
      registration: {
        // Serve alla pagina per ritirare un consenso di questa iscrizione.
        id: r.id,
        displayName: tryDecryptPII(r.displayName) ?? r.displayName,
        // Il nickname scelto per l'evento (lib/live/nickname), se c'e', e se
        // l'evento ne accetta di nuovi: la pagina lo fa scegliere o cambiare,
        // e toglierlo resta sempre possibile.
        nickname: tryDecryptPII(r.nickname),
        nicknameEditable: r.event.nicknamesEnabled && !isFinishedEventStatus(r.event.status),
        email: decryptedEmail,
        organization: r.organization,
        organizationRole: r.organizationRole,
        organizationType: r.organizationType,
        consentGiven: r.consentGiven,
        consentTimestamp: r.consentTimestamp.toISOString(),
        consentRecording: r.consentRecording,
        // Il testo letto: dove quel consenso diceva che sarebbe andato il video.
        consentRecordingDestination: r.consentRecordingDestination ?? null,
        consentRecordingVersion: r.consentRecordingVersion ?? null,
        consentMultitrack: r.consentMultitrack,
        // Il ritiro dalla sala dei consensi dati all'iscrizione.
        consentRecordingWithdrawnAt: r.consentRecordingWithdrawnAt?.toISOString() ?? null,
        consentMultitrackWithdrawnAt: r.consentMultitrackWithdrawnAt?.toISOString() ?? null,
        consentFutureCommunications: r.consentFutureCommunications,
        consentFutureCommunicationsWithdrawnAt:
          r.consentFutureCommunicationsWithdrawnAt?.toISOString() ?? null,
        // La spunta della rubrica che aspetta una conferma (lib/persons/spunta-in-attesa).
        addressBookPending: r.addressBookPending,
        // Lo stato di ciascun consenso, dall'iscrizione e dalla sala insieme.
        // Dove la rubrica non si propone piu' la spunta non si conferma: la pagina
        // non offre il pulsante.
        consents: consensiDellIscrizione({
          ...r,
          addressBookPending: r.addressBookPending && rubricaProposta(r.event, sito),
        }),
        // I consensi che la pagina puo' far dare di nuovo, con il testo da
        // mostrare (lib/gdpr/consent-giving).
        consentOffer: offertaConsensi(r.event, sito, r),
        // La lingua delle email, che la piattaforma conserva e usa.
        locale: r.locale,
        registeredAt: r.createdAt.toISOString(),
        joinedAt: r.joinedAt?.toISOString() ?? null,
        multitrackConsentsInRoom: (r.multitrackConsents ?? []).map((c) => ({
          consentedAt: c.consentedAt.toISOString(),
          locale: c.locale,
          withdrawnAt: c.withdrawnAt?.toISOString() ?? null,
        })),
        recordingConsentsInRoom: (r.recordingConsents ?? []).map((c) => ({
          consentedAt: c.consentedAt.toISOString(),
          locale: c.locale,
          withdrawnAt: c.withdrawnAt?.toISOString() ?? null,
          destination: c.destination ?? null,
          textVersion: c.textVersion ?? null,
        })),
        // L'evento ha una registrazione da cui si puo' chiedere di essere tolti,
        // e le richieste gia' fatte per questa iscrizione, con il loro stato.
        recordingRemoval: {
          available: conRegistrazione.has(r.id),
          requests: richiesteRimozione
            .filter((q) => q.registrationId === r.id)
            .map(({ registrationId: _id, ...q }) => q),
        },
      },
      event: {
        title: r.event.title,
        startsAt: r.event.startsAt.toISOString(),
        endsAt: r.event.endsAt.toISOString(),
        status: r.event.status,
      },
      questions: r.questions.map((q) => ({
        text: q.text,
        status: q.status,
        createdAt: q.createdAt.toISOString(),
      })),
      pollVotes: r.pollVotes.map((v) => ({
        question: v.poll.question,
        optionIndex: v.optionIndex,
        createdAt: v.createdAt.toISOString(),
      })),
      liveTranscript: frasi
        .filter((f) => f.seatId?.startsWith(`reg-${r.id}-`))
        .map((f) => ({
          at: f.startedAt.toISOString(),
          text: f.text ? (tryDecryptPII(f.text) ?? null) : null,
        })),
    };
  });

  return Response.json({
    data: result,
    profilePhoto,
    grants,
    addressBook,
    retainedConsentProofs,
    roomConsentProofs,
    // Serve a ritirare un consenso dalla pagina: il link dell'email resta di
    // sola lettura, e questo non finisce negli indirizzi.
    consentsToken: issueGdprToken('consents', emailHash),
    // Come compaiono nel video i partecipanti (lib/recording/availability): la
    // pagina ne ricava cosa cambia ritirando un consenso. `voiceInVideo` e' la
    // stessa cosa vista dalla sola voce, per chi lo leggeva gia'.
    participantsInVideo: partecipanti,
    voiceInVideo: voceDi(partecipanti),
  });
});
