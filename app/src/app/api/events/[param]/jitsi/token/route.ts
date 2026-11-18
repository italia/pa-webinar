// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

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
import { VERSIONE_TESTO_TRASCRIZIONE } from '@/lib/registration/consents';
import { getSettings } from '@/lib/settings';
import { chiedeConsensoPerVoce, type EventoConsensoVoce } from '@/lib/ai/voice-consent';
import { jitsiTokenRequestSchema } from '@/lib/validation/schemas';
import { EventModeratorRole, verifyGrantToken } from '@/lib/auth/moderator';
import { staffDietroIlPrimario } from '@/lib/auth/staff-seat';
import {
  generateJitsiJwt,
  moderatorJitsiId,
  participantJitsiId,
  postoDaTokenSala,
  guestJitsiId,
} from '@/lib/auth/jwt';
import { decryptPII, encryptPII, hashEmail, tryDecryptPII } from '@/lib/crypto/pii';
import { findPhotoByEmailHash, profilePhotoUrl } from '@/lib/profile-photo';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { limiteTokenOspiti } from '@/lib/room-rate-limit';
import { readOwnedEventAccess } from '@/lib/event-session';
import { guestAccessAllowed } from '@/lib/events/guest-window';
import { registrazioneDellIscrizione, trascrizioneInVigore } from '@/lib/live/consents-in-force';
import type { PartecipantiNelVideo } from '@/lib/live/consent-rule';
import { mediaDelToken, regolaConsenso } from '@/lib/live/listen-only';
import { elencoVisibileAlPubblico } from '@/lib/live/participant-list';
import { pseudonimo } from '@/lib/live/pseudonym';
import { guestSenderId } from '@/lib/chat/sender-key';
import { partecipantiNelVideo, recordingAvailableFor } from '@/lib/recording/availability';
import {
  consensoOra,
  destinazioneDelTesto,
  provaCopre,
  testoLetto,
  versioneLetta,
  type Destinazione,
  type PeriodoConsenso,
} from '@/lib/recording/destination';
import { hasJoinGrant } from '@/lib/events/join-grant';
import type { JitsiTokenRequest } from '@/lib/validation/schemas';

export const dynamic = 'force-dynamic';

/**
 * Registra i consensi dati ora con un clic (prova del consenso, art. 7.1
 * GDPR): alla registrazione dell'evento, da chi non l'aveva dato
 * all'iscrizione, e alla trascrizione dei propri interventi. Il posto e' lo
 * stesso identificativo che entra nel JWT della conferenza: una prova per posto,
 * scritta a JWT emesso, cosi' un posto che non entra non ne lascia.
 *
 * Solo un clic da' un consenso, o lo ridà dopo un ritiro. Una replica, il
 * consenso che la pagina riporta da sola a un nuovo ingresso, non fa rivivere
 * una prova ritirata e non ne scrive una al suo posto: se la prova non c'e' piu',
 * il consenso non vale (`provaDellaReplica`). Se c'e', il posto nuovo porta la
 * stessa prova, con la data e il testo di quando e' stata data.
 *
 * Al meglio: un errore di scrittura si registra nel log e non toglie il JWT a
 * chi sta entrando o rientrando; la risposta dice quali prove sono state
 * salvate, e la sala richiede il consenso a chi non ne ha. Un'iscrizione che
 * ha gia' la sua prova non ne aggiunge un'altra a ogni rientro (per la
 * registrazione lo garantisce il vincolo unico, anche con due richieste
 * insieme).
 *
 * La prova della registrazione dice a quale testo si e' acconsentito: la
 * destinazione letta (`testoLetto`), anche se quella in vigore e' piu' stretta.
 * Un consenso che il testo in vigore non copre non si salva (`consensoOra`).
 */
/** Quali prove di consenso la richiesta ha lasciato (o trovato gia' salvate). */
interface ConsensiSalvati {
  recording: boolean;
  multitrack: boolean;
}

/**
 * Le prove ancora valide su cui poggia una replica. Null: non ne resta nessuna,
 * o la pagina non ha riportato quel consenso.
 */
interface ReplicaValida {
  registrazione: {
    consentedAt: Date;
    locale: string | null;
    destination: Destinazione;
    textVersion: number | null;
  } | null;
  tracce: { consentedAt: Date; locale: string | null; textVersion: number } | null;
}

const NESSUNA_REPLICA: ReplicaValida = { registrazione: null, tracce: null };

/**
 * I consensi che la pagina riporta da sola a un nuovo ingresso. Un ospite e chi
 * entra da una concessione hanno un posto nuovo a ogni ingresso: la replica vale
 * se resta una prova non ritirata sui posti provati dai token della sala di
 * questa visita, o sull'account di chi conduce dal link primario. Quella della
 * registrazione deve coprire il testo in vigore. L'iscritto che apre il proprio
 * link non passa da qui: la sua prova sta sull'iscrizione.
 */
async function provaDellaReplica(
  event: { id: string; jitsiRoomName: string },
  replica: JitsiTokenRequest['consentReplay'],
  destinazione: Destinazione,
  partecipanti: PartecipantiNelVideo,
  staffAccountId?: string,
): Promise<ReplicaValida> {
  if (!replica?.recording && !replica?.multitrack) return NESSUNA_REPLICA;
  const prove = await Promise.all(
    (replica.roomTokens ?? []).map((t) =>
      postoDaTokenSala(t, event.jitsiRoomName, { ancheChiModera: true }),
    ),
  );
  const posti = [...new Set(prove.filter((p) => p !== null).map((p) => p.posto))];
  const dove = [
    ...(posti.length > 0 ? [{ jitsiUserId: { in: posti } }] : []),
    ...(staffAccountId ? [{ staffAccountId }] : []),
  ];
  const [registrazione, tracce] = await Promise.all([
    replica.recording && dove.length > 0
      ? prisma.recordingConsent.findMany({
          where: { eventId: event.id, withdrawnAt: null, OR: dove },
          orderBy: { consentedAt: 'desc' },
          select: { consentedAt: true, locale: true, destination: true, textVersion: true },
        })
      : [],
    replica.multitrack && dove.length > 0
      ? prisma.multitrackConsent.findFirst({
          where: { eventId: event.id, withdrawnAt: null, OR: dove },
          orderBy: { textVersion: 'desc' },
          select: { consentedAt: true, locale: true, textVersion: true },
        })
      : null,
  ]);
  return {
    registrazione: registrazione.find((p) => provaCopre(p, destinazione, partecipanti)) ?? null,
    tracce,
  };
}

/**
 * Senza consenso alla registrazione la trascrizione non vale: la voce non viene
 * registrata e il testo non si tiene (lib/captions/room). Non se ne salva la
 * prova, e il posto nuovo non la porta.
 */
function conVoce<T extends { multitrackConsent?: boolean }>(
  data: T,
  media: { voiceExcluded?: boolean },
): T {
  return media.voiceExcluded ? { ...data, multitrackConsent: false } : data;
}

function replicaConVoce(
  replica: ReplicaValida,
  media: { voiceExcluded?: boolean },
): ReplicaValida {
  return media.voiceExcluded ? { ...replica, tracce: null } : replica;
}

/**
 * I consensi che valgono per il posto dopo questa richiesta: la sala li mette al
 * posto di cio' che ha letto all'apertura, perche' nel frattempo la persona puo'
 * averli ritirati altrove o l'evento puo' aver cambiato il testo richiesto. Al
 * meglio come le prove: un errore di lettura non toglie il JWT, e la sala tiene
 * l'ultimo stato noto.
 */
async function consensiInVigore(
  event: EventoConsensoVoce & { id: string },
  posto: string,
  registrazione: boolean,
  /** La trascrizione gia' letta per questo posto in questa richiesta, se nessuna
   *  prova e' stata scritta dopo: non si rilegge. Null: la lettura non e'
   *  riuscita, e il token l'ha trattata come assente; la sala riceve lo stesso,
   *  e la puo' ridare. */
  trascrizioneLetta?: boolean | null,
): Promise<{ recording: boolean; transcription: boolean } | undefined> {
  if (trascrizioneLetta !== undefined) {
    return { recording: registrazione, transcription: trascrizioneLetta === true };
  }
  try {
    return {
      recording: registrazione,
      transcription: await trascrizioneInVigore(event, posto),
    };
  } catch (err) {
    console.error('[jitsi/token] consents in force not read', {
      eventId: event.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

async function registraConsensi(
  event: EventoConsensoVoce & { id: string; recordingEnabled: boolean },
  data: {
    recordingConsent?: boolean;
    recordingConsentDestination?: Destinazione;
    recordingConsentVersion?: number;
    multitrackConsent?: boolean;
    locale?: string;
  },
  posto: {
    jitsiUserId: string;
    displayName: string;
    registrationId?: string;
    /** Chi conduce o interviene: a chi si lega la prova della registrazione. */
    eventModeratorId?: string;
    staffAccountId?: string;
    /** L'impronta dell'indirizzo di una concessione nominale. */
    emailHash?: string;
  },
  /** La destinazione del testo in vigore (`destinazioneDelTesto`). */
  destinazione: Destinazione,
  /** Come compaiono nel video i partecipanti: decide quale testo copre e quale
   *  versione si salva (`provaCopre`, `versioneDellaProva`). */
  partecipanti: PartecipantiNelVideo,
  /** Le prove che il posto nuovo porta con se': mai a posto di un clic. */
  replica: ReplicaValida = NESSUNA_REPLICA,
): Promise<ConsensiSalvati> {
  const registrazione = event.recordingEnabled && consensoOra(data, destinazione, partecipanti);
  // La trascrizione dei propri interventi, dalla traccia audio per persona, dai
  // sottotitoli o dal video. La prova serve al registratore e alla trascrizione
  // per sapere, voce per voce, chi l'ha data (lib/captions/room).
  const trascrizione = chiedeConsensoPerVoce(event, await getSettings());
  const tracce = trascrizione && data.multitrackConsent === true;
  const registrazionePortata = event.recordingEnabled && !registrazione ? replica.registrazione : null;
  const traccePortate = tracce ? null : replica.tracce;
  if (!registrazione && !tracce && !registrazionePortata && !traccePortate) {
    return { recording: false, multitrack: false };
  }
  const { registrationId } = posto;
  // L'impronta di chi conduce sta sulla prova: resta anche quando la concessione
  // o l'account se ne vanno, e la cancellazione chiesta dalla persona la trova.
  const account = posto.staffAccountId
    ? await prisma.staffAccount.findUnique({
        where: { id: posto.staffAccountId },
        select: { emailHash: true },
      })
    : null;
  const emailHash = posto.emailHash ?? account?.emailHash ?? null;
  const prova = () => ({
    eventId: event.id,
    jitsiUserId: posto.jitsiUserId,
    displayName: encryptPII(posto.displayName),
    registrationId: registrationId ?? null,
    eventModeratorId: posto.eventModeratorId ?? null,
    staffAccountId: posto.staffAccountId ?? null,
    emailHash,
    locale: data.locale ?? null,
  });
  const destinazioneLetta = testoLetto(data.recordingConsentDestination, destinazione);
  const testoDellaProva = {
    destination: destinazioneLetta,
    textVersion: versioneLetta(data.recordingConsentVersion, partecipanti),
  };
  const alMeglio = async (quale: string, scrivi: () => Promise<unknown>): Promise<boolean> => {
    try {
      await scrivi();
      return true;
    } catch (err) {
      console.error(`[jitsi/token] ${quale} consent not recorded`, {
        eventId: event.id,
        err: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  };
  // Due prove indipendenti: si scrivono insieme, sul percorso d'ingresso.
  const [recordingPortata, recording, multitrack, multitrackPortata] = await Promise.all([
    registrazionePortata &&
      alMeglio('recording', () =>
        prisma.recordingConsent.createMany({
          data: [
            {
              ...prova(),
              ...registrazionePortata,
              eventModeratorId: posto.eventModeratorId ?? null,
              staffAccountId: posto.staffAccountId ?? null,
            },
          ],
          skipDuplicates: true,
        }),
      ),
    registrazione &&
      alMeglio('recording', async () => {
        // La prova dell'iscrizione e' una sola (vincolo unico). Torna valida con
        // l'ora nuova se il consenso e' ridato dopo un ritiro dalla sala
        // (lib/live/consent-withdrawal), o dato sul testo di una destinazione che
        // la prova non copre. Il consenso di prima resta nel registro GDPR
        // dell'evento, senza dati personali. Il `where` non trova piu' la riga
        // se un'altra richiesta l'ha gia' aggiornata.
        const esistente = registrationId
          ? await prisma.recordingConsent.findFirst({
              where: { eventId: event.id, registrationId },
              select: {
                consentedAt: true,
                withdrawnAt: true,
                earlierPeriods: true,
                destination: true,
                textVersion: true,
              },
            })
          : null;
        if (
          registrationId &&
          esistente &&
          (esistente.withdrawnAt || !provaCopre(esistente, destinazione, partecipanti))
        ) {
          const ridata = await prisma.recordingConsent.updateMany({
            where: {
              eventId: event.id,
              registrationId,
              ...(esistente.withdrawnAt
                ? { withdrawnAt: { not: null } }
                : {
                    withdrawnAt: null,
                    destination: esistente.destination,
                    textVersion: esistente.textVersion,
                  }),
            },
            data: {
              withdrawnAt: null,
              consentedAt: new Date(),
              // Il periodo di prima resta nella prova (lib/gdpr/consent-proofs).
              // Con `withdrawnAt` nullo e' stato sostituito, non ritirato.
              earlierPeriods: [
                ...(Array.isArray(esistente.earlierPeriods) ? esistente.earlierPeriods : []),
                {
                  consentedAt: esistente.consentedAt.toISOString(),
                  withdrawnAt: esistente.withdrawnAt?.toISOString() ?? null,
                  destination: esistente.destination,
                  textVersion: esistente.textVersion,
                } satisfies PeriodoConsenso,
              ],
              ...testoDellaProva,
              jitsiUserId: posto.jitsiUserId,
              displayName: encryptPII(posto.displayName),
              locale: data.locale ?? null,
            },
          });
          if (ridata.count > 0) {
            await prisma.gdprAuditLog.create({
              data: {
                eventId: event.id,
                action: 'CONSENT_RECORDED',
                recordCount: 1,
                details: JSON.stringify({
                  source: 'room',
                  kind: 'recording',
                  givenAgain: true,
                  previousConsentedAt: esistente.consentedAt.toISOString(),
                  withdrawnAt: esistente.withdrawnAt?.toISOString() ?? null,
                  previousDestination: esistente.destination ?? null,
                  destination: destinazioneLetta,
                }),
              },
            });
          }
        }
        await prisma.recordingConsent.createMany({
          data: [
            {
              ...prova(),
              ...testoDellaProva,
            },
          ],
          skipDuplicates: true,
        });
      }),
    tracce &&
      alMeglio('multitrack', async () => {
        // Una prova per iscrizione e per testo: chi l'aveva data con il testo
        // precedente (la sola traccia audio) e la ridà con quello attuale ne
        // ha una nuova accanto, e quella di prima resta come era.
        const gia = registrationId
          ? await prisma.multitrackConsent.findFirst({
              where: {
                eventId: event.id,
                registrationId,
                textVersion: { gte: VERSIONE_TESTO_TRASCRIZIONE },
                withdrawnAt: null,
              },
              select: { id: true },
            })
          : null;
        if (!gia) {
          await prisma.multitrackConsent.create({
            data: { ...prova(), textVersion: VERSIONE_TESTO_TRASCRIZIONE },
          });
        }
      }),
    traccePortate &&
      alMeglio('multitrack', () =>
        prisma.multitrackConsent.create({ data: { ...prova(), ...traccePortate } }),
      ),
  ]);
  return {
    recording: !!recording || !!recordingPortata,
    multitrack: !!multitrack || !!multitrackPortata,
  };
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

  // JWT is minted only when the bridge is ready (LIVE) or, for moderators and
  // speakers, in the pre-start window (PUBLISHED). For PROVISIONING/IDLE the
  // frontend must first transition through the ProvisioningScreen; handing
  // out a JWT now would drop the user on a cold JVB.
  if (!['PUBLISHED', 'LIVE'].includes(event.status)) {
    throw new ConflictError('Event is not active', { currentStatus: event.status });
  }

  // Il consenso alla registrazione di chi partecipa e i limiti dei mezzi nel
  // token (lib/live/listen-only): chi entra per primo accende il blocco nella
  // sala (mod_pa_media_lock), con gli stessi tipi per tutti.
  const partecipanti = partecipantiNelVideo();
  const registrabile = recordingAvailableFor(event);
  const regola = regolaConsenso(event, registrabile, partecipanti);
  // Le prove seguono la regola della rotta d'iscrizione: dove non si registra
  // niente non c'e' un consenso da dare, nemmeno da una pagina aperta da prima.
  const eventoConsensi = {
    ...event,
    recordingEnabled: event.recordingEnabled && registrabile,
    multitrackRecordingEnabled: event.multitrackRecordingEnabled && registrabile,
  };
  // La destinazione del testo in vigore: si confronta con i consensi, dati ora o
  // prima, e torna in ogni risposta, cosi' una pagina aperta da prima mostra il
  // testo giusto e non rimanda un consenso dato su quello vecchio. Dove non c'e'
  // un video vale null, mai la colonna dell'evento.
  const destinazione = destinazioneDelTesto(event.recordingDestination, partecipanti);
  const consensoDato = consensoOra(parsed.data, destinazione, partecipanti);
  // Vale da quando si entra: chi aspetta da prima non ha una scelta vecchia.
  const participantListVisible = elencoVisibileAlPubblico(event);
  // Il token di chi partecipa: il consenso non e' mai una condizione per
  // entrare, decide cosa si puo' fare in sala.
  const mediaPartecipante = (consenso: boolean) =>
    mediaDelToken(event, regola, 'partecipante', consenso);
  // Il consenso che decide il segno della voce di chi partecipa: quello alla
  // registrazione, o dove chi partecipa non entra mai nel video ('esclusi') quello
  // alla trascrizione, dato ora o ancora valido (lib/live/listen-only). Il secondo
  // si legge solo li'.
  const trascrizioneOra =
    regola.voceDallaTrascrizione &&
    parsed.data.multitrackConsent === true &&
    chiedeConsensoPerVoce(eventoConsensi, await getSettings());
  const consensoVoce = (registrazione: boolean, trascrizioneValida: boolean): boolean =>
    regola.voceDallaTrascrizione ? trascrizioneOra || trascrizioneValida : registrazione;
  // La trascrizione dell'iscritto, letta per il segno della voce. Null: la
  // lettura non e' riuscita. Non toglie il JWT, e la voce resta fuori.
  const trascrizioneDelPosto = async (posto: string): Promise<boolean | null> => {
    try {
      return await trascrizioneInVigore(event, posto);
    } catch (err) {
      console.error('[jitsi/token] transcription consent not read', {
        eventId: event.id,
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  };
  // Li' il consenso alla registrazione di chi partecipa non si chiede: uno che
  // arriva lo stesso, da una pagina aperta da prima o da una replica, non lascia
  // una prova.
  const senzaRegistrazione = <T extends { recordingConsent?: boolean }>(data: T): T =>
    regola.voceDallaTrascrizione ? { ...data, recordingConsent: false } : data;
  const replicaSenzaRegistrazione = (replica: ReplicaValida): ReplicaValida =>
    regola.voceDallaTrascrizione ? { ...replica, registrazione: null } : replica;

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
    // Chi apre il link primario con la sessione dello staff che gestisce
    // l'evento e' una persona nota (lib/auth/staff-seat).
    const staff = grant.isPrimaryShared ? await staffDietroIlPrimario(event.id) : null;
    let name: string;
    if (grant.isPrimaryShared) {
      // Il suo nome vale anche senza quello scritto in sala d'attesa.
      const nome = trimmedOverride || staff?.nome;
      if (!nome) throw new ValidationError('Display name is required for moderators');
      name = nome;
    } else {
      name = trimmedOverride || grant.displayName || (isSpeaker ? 'Relatore' : 'Moderatore');
    }

    // Un identificativo per ingresso (con suffisso casuale): lo stesso nel
    // consenso e nel JWT.
    const postoModeratore = moderatorJitsiId(event.id);
    // Chi conduce o interviene e' sempre nel video, con nome e immagine, e il
    // suo token lo dice (`paInVideo`, lib/live/listen-only): non da' il consenso
    // alla registrazione, e un consenso che una pagina manda lo stesso non lascia
    // una prova. Resta suo il consenso alla trascrizione dei propri interventi,
    // con la prova legata alla concessione o all'account. Un link e' un posto,
    // non una persona: quello dato da un altro con lo stesso link non si eredita.
    const replicaConduce = await provaDellaReplica(
      event,
      parsed.data.consentReplay && { ...parsed.data.consentReplay, recording: false },
      destinazione,
      partecipanti,
      staff?.accountId,
    );
    const mediaConduce = mediaDelToken(event, regola, isSpeaker ? 'relatore' : 'moderatore', true);
    const jwt = await generateJitsiJwt({
      roomName: event.jitsiRoomName,
      displayName: name,
      uniqueId: postoModeratore,
      isModerator: !isSpeaker,
      ...mediaConduce,
      // Chi sta sullo schermo è soprattutto chi modera e chi parla: se l'avatar
      // Gravatar valesse solo per il pubblico, la funzione si vedrebbe dove
      // conta meno. `grant.email` è null per il link primario — condiviso da
      // tutto il team, nessuna persona dietro — e lì restano le iniziali.
      email: grant.email ?? undefined,
      useGravatar: (await getSettings()).gravatarEnabled,
    });
    const consentsRecorded = await registraConsensi(
      eventoConsensi,
      { ...parsed.data, recordingConsent: false },
      {
        jitsiUserId: postoModeratore,
        displayName: name,
        eventModeratorId: grant.grantId ?? undefined,
        staffAccountId: staff?.accountId,
        emailHash: grant.email ? hashEmail(grant.email) : undefined,
      },
      destinazione,
      partecipanti,
      replicaConduce,
    );

    return Response.json({
      jwt,
      roomName: event.jitsiRoomName,
      displayName: name,
      role: isSpeaker ? 'speaker' : 'moderator',
      consentsRecorded,
      consentsInForce: await consensiInVigore(event, postoModeratore, false),
      voiceExcluded: !!mediaConduce.voiceExcluded,
      participantListVisible,
      recordingDestination: destinazione,
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

    // Chi partecipa entra a evento iniziato: prima la sala d'attesa lo fa
    // aspettare, e il token non deve aprirgli la conferenza direttamente.
    // Chi modera o interviene entra anche prima (ramo sopra), gli ospiti solo
    // in diretta (ramo sotto).
    if (event.status !== 'LIVE') {
      throw new ConflictError('Event is not live yet', { currentStatus: event.status });
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
      const limit = limiteTokenOspiti();
      const rl = rateLimit(`guest-jwt:${ip}`, { limit, windowMs: 60_000 });
      if (!rl.allowed) {
        throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
      }
      const postoOspite = guestJitsiId();
      // Il consenso dell'iscritto non passa a chi ha il suo link: vale quello
      // dato da chi ha aperto il link, ora o a un ingresso di questa visita.
      const replicaInoltro = await provaDellaReplica(
        event,
        parsed.data.consentReplay,
        destinazione,
        partecipanti,
      );
      const mediaInoltro = mediaPartecipante(
        consensoVoce(consensoDato || !!replicaInoltro.registrazione, !!replicaInoltro.tracce),
      );
      // Pubblico anonimo: lo pseudonimo del posto (lo stesso della chat).
      const nomeInoltro = event.audienceAnonymous
        ? await pseudonimo(event.id, `reg-${registration.id}`)
        : typedName;
      const guestJwt = await generateJitsiJwt({
        roomName: event.jitsiRoomName,
        displayName: nomeInoltro,
        uniqueId: postoOspite,
        isModerator: false,
        ...mediaInoltro,
        expiresInSeconds: 2 * 60 * 60,
      });
      const consentsRecorded = await registraConsensi(
        eventoConsensi,
        senzaRegistrazione(conVoce(parsed.data, mediaInoltro)),
        { jitsiUserId: postoOspite, displayName: typedName },
        destinazione,
        partecipanti,
        replicaSenzaRegistrazione(replicaConVoce(replicaInoltro, mediaInoltro)),
      );
      return Response.json(
        {
          jwt: guestJwt,
          roomName: event.jitsiRoomName,
          displayName: nomeInoltro,
          role: 'participant',
          consentsRecorded,
          consentsInForce: await consensiInVigore(
            event,
            postoOspite,
            consentsRecorded.recording || !!replicaInoltro.registrazione,
          ),
          participantListVisible,
          listenOnly: !!mediaInoltro.listenOnly,
          voiceExcluded: !!mediaInoltro.voiceExcluded,
          recordingDestination: destinazione,
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    // Il consenso dell'iscritto: dato all'iscrizione, con un clic ora o in una
    // visita precedente (la prova resta legata all'iscrizione). Le repliche della
    // pagina non contano: decide cio' che il server trova. La lettura serve solo
    // a chi non l'ha dato ne' ora ne' all'iscrizione, e si fa anche dove il
    // consenso non cambia il token: la sala deve sapere che c'e', per poterlo
    // ritirare. Un consenso ritirato non vale piu' (lib/live/consent-withdrawal),
    // e uno dato su un testo che non copre il testo in vigore non vale per
    // questo video: la sala lo richiede.
    const consensoIscritto =
      consensoDato ||
      (await registrazioneDellIscrizione(event, registration, destinazione, partecipanti));
    const postoIscritto = participantJitsiId(registration.id);
    // Dove decide il segno della voce si legge una volta sola, e la stessa
    // lettura torna alla sala: in questa richiesta l'iscritto non da' la
    // trascrizione, quindi nessuna prova nuova la cambia.
    const trascrizioneIscritto =
      regola.voceDallaTrascrizione && !trascrizioneOra
        ? await trascrizioneDelPosto(postoIscritto)
        : undefined;
    const mediaIscritto = mediaPartecipante(
      consensoVoce(consensoIscritto, trascrizioneIscritto === true),
    );

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

    // La foto vale per l'indirizzo in tutti gli eventi: si mostra solo a chi
    // ha provato che l'indirizzo e' suo aprendo il link dell'email. Iscriversi
    // con l'indirizzo di un altro non ne fa indossare la foto.
    const fotoIscritto = accesso?.emailVerified
      ? await findPhotoByEmailHash(registration.emailHash)
      : null;
    // Pubblico anonimo: in sala lo pseudonimo del posto, senza indirizzo ne'
    // foto (niente che porti alla persona). Chi e' in solo ascolto ha
    // rifiutato la registrazione: in sala con le iniziali, senza la sua foto.
    // Chi resta fuori dalla registrazione tiene la sua: non entra nel video.
    const anonimo = event.audienceAnonymous;
    const nomeInSala = anonimo ? await pseudonimo(event.id, `reg-${registration.id}`) : name;
    const conVolto = !anonimo && !mediaIscritto.listenOnly;
    const jwt = await generateJitsiJwt({
      roomName: event.jitsiRoomName,
      displayName: nomeInSala,
      uniqueId: postoIscritto,
      isModerator: false,
      ...mediaIscritto,
      email: anonimo ? undefined : email,
      photoUrl: fotoIscritto && conVolto ? profilePhotoUrl(fotoIscritto) : null,
      // La scelta è dell'amministratore, e la legge il chiamante: il minter del
      // token resta puro (vedi JitsiTokenPayload.useGravatar).
      useGravatar: conVolto && (await getSettings()).gravatarEnabled,
    });
    const consentsRecorded = await registraConsensi(
      eventoConsensi,
      senzaRegistrazione(conVoce(parsed.data, mediaIscritto)),
      { jitsiUserId: postoIscritto, displayName: name, registrationId: registration.id },
      destinazione,
      partecipanti,
    );

    return Response.json({
      jwt,
      roomName: event.jitsiRoomName,
      displayName: nomeInSala,
      role: 'participant',
      consentsRecorded,
      consentsInForce: await consensiInVigore(
        event,
        postoIscritto,
        consentsRecorded.recording || (!consensoDato && consensoIscritto),
        trascrizioneIscritto,
      ),
      participantListVisible,
      listenOnly: !!mediaIscritto.listenOnly,
      voiceExcluded: !!mediaIscritto.voiceExcluded,
      recordingDestination: destinazione,
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

    // 120 al minuto per indirizzo: chi entra dalla stessa rete di un ente arriva
    // tutto insieme (un link annunciato in una riunione e cento colleghi che
    // lo aprono). Si regola con GUEST_JWT_RATE_LIMIT_PER_MINUTE e scala con
    // gli altri limiti della sala (lib/room-rate-limit); il conto e' per pod,
    // quindi il tetto vero e' il numero di pod per il limite.
    const ip = getClientIp(request);
    const limit = limiteTokenOspiti();
    const rl = rateLimit(`guest-jwt:${ip}`, { limit, windowMs: 60_000 });
    if (!rl.allowed) {
      throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
    }

    const postoOspite = guestJitsiId();
    const replicaOspite = await provaDellaReplica(
      event,
      parsed.data.consentReplay,
      destinazione,
      partecipanti,
    );
    const mediaOspite = mediaPartecipante(
      consensoVoce(consensoDato || !!replicaOspite.registrazione, !!replicaOspite.tracce),
    );
    // Pubblico anonimo: lo pseudonimo del posto in chat (la chiave dell'ospite).
    const nomeOspite = event.audienceAnonymous
      ? await pseudonimo(event.id, guestSenderId(ip, guestName))
      : guestName;
    const jwt = await generateJitsiJwt({
      roomName: event.jitsiRoomName,
      displayName: nomeOspite,
      uniqueId: postoOspite,
      isModerator: false,
      ...mediaOspite,
      expiresInSeconds: 2 * 60 * 60,
    });
    const consentsRecorded = await registraConsensi(
      eventoConsensi,
      senzaRegistrazione(conVoce(parsed.data, mediaOspite)),
      { jitsiUserId: postoOspite, displayName: guestName },
      destinazione,
      partecipanti,
      replicaSenzaRegistrazione(replicaConVoce(replicaOspite, mediaOspite)),
    );

    return Response.json({
      jwt,
      roomName: event.jitsiRoomName,
      displayName: nomeOspite,
      role: 'guest',
      consentsRecorded,
      consentsInForce: await consensiInVigore(
        event,
        postoOspite,
        consentsRecorded.recording || !!replicaOspite.registrazione,
      ),
      participantListVisible,
      listenOnly: !!mediaOspite.listenOnly,
      voiceExcluded: !!mediaOspite.voiceExcluded,
      recordingDestination: destinazione,
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  throw new AppError('No token provided', 400, 'BAD_REQUEST');
});
