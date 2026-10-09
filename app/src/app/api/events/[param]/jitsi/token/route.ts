import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
  RateLimitError,
  ValidationError,
  AppError,
} from '@/lib/errors';
import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { jitsiTokenRequestSchema } from '@/lib/validation/schemas';
import { EventModeratorRole, verifyGrantToken } from '@/lib/auth/moderator';
import {
  generateJitsiJwt,
  mediaLockOf,
  moderatorJitsiId,
  participantJitsiId,
  guestJitsiId,
} from '@/lib/auth/jwt';
import { decryptPII, encryptPII, tryDecryptPII } from '@/lib/crypto/pii';
import { findPhotoByEmailHash, profilePhotoUrl } from '@/lib/profile-photo';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { readOwnedEventAccess } from '@/lib/event-session';
import { guestAccessAllowed } from '@/lib/events/guest-window';
import { hasJoinGrant } from '@/lib/events/join-grant';

export const dynamic = 'force-dynamic';

/**
 * Registra il consenso alla registrazione per partecipante dato in sala
 * d'attesa (prova del consenso, art. 7.1 GDPR), quando l'evento registra una
 * traccia per partecipante e il consenso c'e'. Il posto e' lo stesso
 * identificativo che entra nel JWT della conferenza.
 *
 * Al meglio: un errore di scrittura si registra nel log e non toglie il JWT a
 * chi sta entrando o rientrando. Un'iscrizione che ha gia' la sua prova non ne
 * aggiunge un'altra a ogni rientro.
 */
async function registraConsensoMultitraccia(
  event: { id: string; multitrackRecordingEnabled: boolean },
  data: { multitrackConsent?: boolean; locale?: string },
  posto: { jitsiUserId: string; displayName: string; registrationId?: string },
): Promise<void> {
  if (!event.multitrackRecordingEnabled || data.multitrackConsent !== true) return;
  try {
    if (posto.registrationId) {
      const gia = await prisma.multitrackConsent.findFirst({
        where: { eventId: event.id, registrationId: posto.registrationId },
        select: { id: true },
      });
      if (gia) return;
    }
    await prisma.multitrackConsent.create({
      data: {
        eventId: event.id,
        jitsiUserId: posto.jitsiUserId,
        displayName: encryptPII(posto.displayName),
        registrationId: posto.registrationId ?? null,
        locale: data.locale ?? null,
      },
    });
  } catch (err) {
    console.error('[jitsi/token] multitrack consent not recorded', {
      eventId: event.id,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

export const POST = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;

  const body = await parseJsonBody(request);
  const parsed = jitsiTokenRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Validation failed', parsed.error.issues.map((i) => ({ path: i.path, message: i.message })));
  }

  const { accessToken, moderatorToken, guestName, displayNameOverride } = parsed.data;

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event) throw new NotFoundError('Event');

  // JWT is minted only when the bridge is ready (LIVE) or the event is still
  // in the pre-start window (PUBLISHED). For PROVISIONING/IDLE the frontend
  // must first transition through the ProvisioningScreen; handing out a JWT
  // now would drop the user on a cold JVB.
  if (!['PUBLISHED', 'LIVE'].includes(event.status)) {
    throw new ConflictError('Event is not active', { currentStatus: event.status });
  }

  // In ogni token dell'evento: chi entra per primo accende il blocco nella
  // sala (mod_pa_media_lock), e i limiti sono gli stessi per tutti.
  const mediaLock = mediaLockOf(event);

  // ── Grant flow (primary moderator, co-moderator, or speaker) ──
  if (moderatorToken) {
    const grant = await verifyGrantToken(event.slug, moderatorToken);
    if (!grant) {
      throw new ForbiddenError('Invalid moderator token');
    }

    const isSpeaker = grant.role === EventModeratorRole.SPEAKER;

    // The PRIMARY moderator magic link is SHARED: every moderator opening
    // it would otherwise mint a JWT under the same generic
    // event.moderatorName ("Moderatore"), so they all collapse into one
    // identity in chat / the participant list. Require the client-supplied
    // name (the waiting room forces it) instead of silently falling back.
    // Per-row grants (named co-moderator / speaker) keep their own
    // decrypted grant.displayName.
    const trimmedOverride = displayNameOverride?.trim();
    let name: string;
    if (grant.isPrimaryShared) {
      if (!trimmedOverride) {
        throw new ValidationError('Display name is required for moderators');
      }
      name = trimmedOverride;
    } else {
      name = trimmedOverride || grant.displayName || (isSpeaker ? 'Relatore' : 'Moderatore');
    }

    // Un identificativo per ingresso (con suffisso casuale): lo stesso nel
    // consenso e nel JWT.
    const postoModeratore = moderatorJitsiId(event.id);
    await registraConsensoMultitraccia(event, parsed.data, {
      jitsiUserId: postoModeratore,
      displayName: name,
    });
    const jwt = await generateJitsiJwt({
      roomName: event.jitsiRoomName,
      displayName: name,
      uniqueId: postoModeratore,
      isModerator: !isSpeaker,
      mediaLock,
      mediaExempt: isSpeaker,
      // Chi sta sullo schermo è soprattutto chi modera e chi parla: se l'avatar
      // Gravatar valesse solo per il pubblico, la funzione si vedrebbe dove
      // conta meno. `grant.email` è null per il link primario — condiviso da
      // tutto il team, nessuna persona dietro — e lì restano le iniziali.
      email: grant.email ?? undefined,
      useGravatar: (await getSettings()).gravatarEnabled,
    });

    return Response.json({
      jwt,
      roomName: event.jitsiRoomName,
      displayName: name,
      role: isSpeaker ? 'speaker' : 'moderator',
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  // ── Participant flow ──
  if (accessToken) {
    const registration = await prisma.registration.findUnique({
      where: { accessToken },
    });

    if (!registration || registration.eventId !== event.id) {
      throw new ForbiddenError('Invalid access token');
    }

    // The accessToken lives in the personal join link, so a FORWARDED link would
    // otherwise let the opener mint the registrant's identity. Bind identity
    // to the browser that registered: the signed `event_access` cookie must carry
    // this same token. A non-owner still gets in (possessing the shared token
    // authorizes entry), but under THEIR OWN typed name and a fresh guest
    // identity — never the registrant's name, slot, or recording consent.
    const accesso = await readOwnedEventAccess(event.id);
    const ownsToken = accesso?.token === accessToken;

    if (!ownsToken) {
      const typedName = displayNameOverride?.trim();
      if (!typedName) {
        throw new ValidationError('Display name is required');
      }
      // This branch mints a GUEST JWT (fresh identity), so rate-limit it per IP
      // exactly like the pure-guest path below — a forwarded link shouldn't be a
      // faster route to bulk JWT minting than an anonymous one.
      const ip = getClientIp(request);
      const limit = parseInt(process.env.GUEST_JWT_RATE_LIMIT_PER_MINUTE || '120', 10);
      const rl = rateLimit(`guest-jwt:${ip}`, { limit, windowMs: 60_000 });
      if (!rl.allowed) {
        throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
      }
      const postoOspite = guestJitsiId();
      await registraConsensoMultitraccia(event, parsed.data, {
        jitsiUserId: postoOspite,
        displayName: typedName,
      });
      const guestJwt = await generateJitsiJwt({
        roomName: event.jitsiRoomName,
        displayName: typedName,
        uniqueId: postoOspite,
        isModerator: false,
        mediaLock,
        expiresInSeconds: 2 * 60 * 60,
      });
      return Response.json(
        {
          jwt: guestJwt,
          roomName: event.jitsiRoomName,
          displayName: typedName,
          role: 'participant',
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    // Record the join, set-once. Kept write-free on rejoin so the reconnect
    // path never depends on a DB write (a write failure here would 500 the
    // token fetch and eject a reconnecting participant). leftAt is best-effort
    // and may be stale after a rejoin — the retention signal tolerates that via
    // its minimum-sample guard.
    if (!registration.joinedAt) {
      await prisma.registration.update({
        where: { id: registration.id },
        data: { joinedAt: new Date() },
      });
    }

    const name = tryDecryptPII(registration.displayName) ?? registration.displayName;
    let email: string | undefined;
    try {
      email = decryptPII(registration.email);
    } catch {
      // PII decryption failure — skip Gravatar, use SVG fallback
    }

    const postoIscritto = participantJitsiId(registration.id);
    await registraConsensoMultitraccia(event, parsed.data, {
      jitsiUserId: postoIscritto,
      displayName: name,
      registrationId: registration.id,
    });
    // La foto vale per l'indirizzo in tutti gli eventi: si mostra solo a chi
    // ha provato che l'indirizzo e' suo aprendo il link dell'email. Iscriversi
    // con l'indirizzo di un altro non ne fa indossare la foto.
    const fotoIscritto = accesso?.emailVerified
      ? await findPhotoByEmailHash(registration.emailHash)
      : null;
    const jwt = await generateJitsiJwt({
      roomName: event.jitsiRoomName,
      displayName: name,
      uniqueId: postoIscritto,
      isModerator: false,
      mediaLock,
      email,
      photoUrl: fotoIscritto ? profilePhotoUrl(fotoIscritto) : null,
      // La scelta è dell'amministratore, e la legge il chiamante: il minter del
      // token resta puro (vedi JitsiTokenPayload.useGravatar).
      useGravatar: (await getSettings()).gravatarEnabled,
    });

    return Response.json({
      jwt,
      roomName: event.jitsiRoomName,
      displayName: name,
      role: 'participant',
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  // ── Guest flow (no registration, LIVE events only) ──
  if (guestName) {
    // Sugli eventi a calendario l'ingresso senza iscrizione e' una scelta
    // dell'amministrazione; la chiamata rapida resta aperta a chi ha il link
    // (lib/events/guest-window). La pagina live non offre l'ingresso da
    // ospite quando e' spento: qui si chiude la porta a chi chiama la rotta
    // direttamente, o a chi era gia' in sala d'attesa quando e' stato spento.
    if (!guestAccessAllowed(event, (await getSettings()).guestAccessEnabled)) {
      throw new AppError('Guest access is disabled', 403, 'GUEST_ACCESS_DISABLED');
    }

    if (event.status !== 'LIVE') {
      throw new ConflictError('Guest access is only available during live events');
    }

    // Evento protetto da password: la pagina live pretende il cookie di
    // accesso prima di mostrare l'ingresso da ospite, e la chat lo pretende
    // prima di farsi leggere. Senza lo stesso controllo qui, bastava chiamare
    // la rotta col solo nome per avere il JWT della sala.
    if (event.joinPasswordHash && !(await hasJoinGrant(event.id))) {
      throw new AppError('Join password required', 403, 'JOIN_PASSWORD_REQUIRED');
    }

    // Default 120/min per IP to accommodate bursts of participants joining
    // from a shared corporate NAT (common scenario: announcing the link
    // during an MS Teams call where 100+ colleagues click simultaneously).
    // Tunable per-deploy via GUEST_JWT_RATE_LIMIT_PER_MINUTE; the in-memory
    // limiter is per-pod, so the effective ceiling is N_replicas × limit.
    const ip = getClientIp(request);
    const limit = parseInt(process.env.GUEST_JWT_RATE_LIMIT_PER_MINUTE || '120', 10);
    const rl = rateLimit(`guest-jwt:${ip}`, { limit, windowMs: 60_000 });
    if (!rl.allowed) {
      throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
    }

    const postoOspite = guestJitsiId();
    await registraConsensoMultitraccia(event, parsed.data, {
      jitsiUserId: postoOspite,
      displayName: guestName,
    });
    const jwt = await generateJitsiJwt({
      roomName: event.jitsiRoomName,
      displayName: guestName,
      uniqueId: postoOspite,
      isModerator: false,
      mediaLock,
      expiresInSeconds: 2 * 60 * 60,
    });

    return Response.json({
      jwt,
      roomName: event.jitsiRoomName,
      displayName: guestName,
      role: 'guest',
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  throw new AppError('No token provided', 400, 'BAD_REQUEST');
});
