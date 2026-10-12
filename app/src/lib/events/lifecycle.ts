/**
 * Pure helpers for event lifecycle decisions — the logic factored out
 * of the JVB scaler route and the events PUT handler so each branch
 * can be unit-tested without mocking Prisma/next/request.
 *
 * These functions are stateless and take the minimum inputs needed;
 * prod code wires them to DB rows + `new Date()`.
 */

export interface GraceCheckInput {
  /** Event's configured endsAt. */
  endsAt: Date;
  /** Per-event override; null = inherit site default. */
  gracePeriodMinutes: number | null;
  /** Site default grace from SiteSetting.eventGracePeriodMinutes. */
  siteGraceMinutes: number;
  /** Reference "now" used for comparison. */
  now: Date;
}

/**
 * Una sala LIVE oltre il suo `endsAt` va chiusa per orario? È il tetto del
 * fuori orario di una sala ancora OCCUPATA: la sala vuota si chiude prima, con
 * {@link shouldReclaimEmptyOvertime}.
 *
 *   - tetto < 0 (-1) → nessuna chiusura per orario: la sala resta aperta
 *                      finché c'è qualcuno, e si chiude quando si svuota;
 *   - tetto = 0      → chiusura al passaggio di `endsAt`;
 *   - tetto > 0      → chiusura a `endsAt` + tetto, anche con persone dentro.
 *
 * Il tetto è `Event.gracePeriodMinutes`, o quello del sito se è null.
 */
export function shouldEndLiveEvent(input: GraceCheckInput): boolean {
  const grace = input.gracePeriodMinutes ?? input.siteGraceMinutes;
  if (grace < 0) return false;
  const closeAt = new Date(input.endsAt.getTime() + grace * 60_000);
  return input.now.getTime() >= closeAt.getTime();
}

export interface OvertimeReclaimInput {
  /** Ultimo giro in cui il bridge ha segnalato traffico, o ultimo resoconto
   *  dei client della sala (null = nessuno è mai entrato). */
  lastActiveAt: Date | null;
  /** Ultima (ri)apertura della sala. È anche un segno di vita: una sala
   *  riaperta da pochi secondi non è vuota da tempo, anche se `lastActiveAt` è
   *  vecchio (il ciclo /wake → LIVE non lo azzera). */
  provisioningStartedAt: Date | null;
  /** Fine programmata, già passata. Il vuoto si conta al più presto da qui:
   *  una sala in pausa al momento della fine ha comunque la sua finestra. */
  endsAt: Date;
  /** now − minuti di sala vuota ammessi oltre la fine
   *  (`SiteSetting.eventOvertimeEmptyMinutes`). */
  emptyCutoff: Date;
  /** Il bridge risponde E il conteggio è affidabile (una sola replica, o
   *  aggregato su tutti i pod). Senza questa prova la sala NON si dà per
   *  vuota: `lastActiveAt` si ferma anche quando il bridge non risponde, e un
   *  inciampo non deve chiudere una sala piena. Resta il tetto per orario. */
  canReclaimEmpty: boolean;
}

/**
 * Una sala LIVE oltre il suo `endsAt` è vuota da abbastanza tempo per
 * chiuderla? Vale per ogni sala, qualunque sia il suo tetto: il fuori orario
 * serve a chi è ancora dentro, e una sala che nessuno usa più tiene acceso un
 * bridge per niente.
 *
 * «Viva fino a» è il più recente tra `lastActiveAt`, `provisioningStartedAt` e
 * `endsAt` (il massimo, non il primo disponibile: dopo un /wake `lastActiveAt`
 * conserva il valore vecchio e chiuderebbe una sala in cui le persone sono
 * appena rientrate). `endsAt` fa partire il conto non prima della fine: una
 * sala vuota per una pausa cominciata prima della fine non si chiude al primo
 * giro dopo, e una riga LIVE senza nessun segno di vita si chiude comunque.
 *
 * Granularità: il conteggio dello scaler è per bridge, e con traffico rinfresca
 * `lastActiveAt` di TUTTE le sale LIVE. Una sala svuotata che divide il bridge
 * con un altro evento attivo non risulta vuota finché il bridge non si svuota:
 * in quel caso la chiude il tetto per orario.
 */
export function shouldReclaimEmptyOvertime(input: OvertimeReclaimInput): boolean {
  if (!input.canReclaimEmpty) return false;
  const signals = [input.endsAt.getTime()];
  if (input.lastActiveAt) signals.push(input.lastActiveAt.getTime());
  if (input.provisioningStartedAt) signals.push(input.provisioningStartedAt.getTime());
  return Math.max(...signals) < input.emptyCutoff.getTime();
}

/**
 * Stati da cui chi conduce può avviare l'evento a mano («Avvia evento»).
 *
 * Non solo PUBLISHED: un evento rimasto in preparazione (PROVISIONING) o in
 * pausa (IDLE) senza nessuno che lo porti a LIVE — lo scaler fermo, o assente
 * — altrimenti non si aprirebbe più, e il token di sala verrebbe rifiutato a
 * tutti. PUT /api/events/[id] accetta LIVE da ciascuno di questi stati.
 */
export const MANUALLY_STARTABLE_STATUSES = ['PUBLISHED', 'PROVISIONING', 'IDLE'] as const;

export function canStartManually(status: string): boolean {
  return (MANUALLY_STARTABLE_STATUSES as readonly string[]).includes(status);
}

export interface AbandonedInstantCallInput {
  eventType: string;
  /** Ultimo segnale di attività della sala (resoconti dei client, bridge). */
  lastActiveAt: Date | null;
  /** Quando la sala è stata aperta o riaperta l'ultima volta. */
  provisioningStartedAt: Date | null;
  /** Per una chiamata istantanea, il momento della creazione. */
  startsAt: Date;
  /** now - jvbInactiveGraceMinutes. */
  inactiveCutoff: Date;
}

/**
 * Una chiamata istantanea LIVE, ancora prima del suo `endsAt`, è stata
 * abbandonata?
 *
 * Vale solo senza scaler (giro a bridge fisso). Lo scaler mette una sala vuota
 * in pausa (IDLE) e la riaccende alla visita successiva; senza scaler la pausa
 * non esiste e una chiamata lasciata aperta resterebbe LIVE per tutto il suo
 * `endsAt`, che per le istantanee è solo un segnaposto di quattro ore: il link
 * condiviso continuerebbe ad ammettere ospiti in una stanza che nessuno
 * presidia. Si chiude quando la sala non dà segni di vita per tutta la finestra
 * di inattività.
 *
 * Gli eventi a calendario sono esclusi di proposito: prima della loro fine
 * programmata una sala vuota è una pausa, non un abbandono, e chiuderla
 * sarebbe definitivo.
 *
 * «Viva fino a» è il più recente dei segnali: ultima attività, ultima apertura
 * e creazione.
 */
export function shouldCloseAbandonedInstantCall(input: AbandonedInstantCallInput): boolean {
  if (input.eventType !== 'INSTANT') return false;
  const signals = [input.startsAt.getTime()];
  if (input.lastActiveAt) signals.push(input.lastActiveAt.getTime());
  if (input.provisioningStartedAt) signals.push(input.provisioningStartedAt.getTime());
  return Math.max(...signals) < input.inactiveCutoff.getTime();
}

export interface WakeWindowInput {
  /** Scheduled start of the event. */
  startsAt: Date;
  /** INSTANT rooms are opened on demand and have no meaningful schedule. */
  eventType: string;
  /** SiteSetting.jvbPreScaleMinutes — when the scaler warms the bridge itself. */
  preScaleMinutes: number;
  now: Date;
}

/**
 * When does `/wake` become allowed for this event?
 *
 * `/wake` starts a JVB. Until now it accepted a call at ANY time, from anyone
 * (the route is unauthenticated), so a single visitor opening an event page the
 * day before could pin a bridge — and did: on 22 July a visitor warmed the room
 * an hour early, which cost a bridge-hour AND, because the inactivity window was
 * measured from that timestamp, got the event demoted three minutes after it
 * went live.
 *
 * The room is allowed to warm up exactly when the scaler would warm it anyway:
 * `jvbPreScaleMinutes` before the start. Earlier than that there is nothing to
 * gain — the bridge would just sit idle — and the scaler still brings it up on
 * schedule without anyone asking.
 *
 * INSTANT calls are exempt: they exist to be opened on demand, and their
 * `startsAt` is only a creation timestamp.
 */
export function wakeWindowOpensAt(input: WakeWindowInput): Date | null {
  if (input.eventType === 'INSTANT') return null;
  return new Date(input.startsAt.getTime() - input.preScaleMinutes * 60_000);
}

/** True when `/wake` may warm the bridge for this event right now. */
export function canWakeNow(input: WakeWindowInput): boolean {
  const opensAt = wakeWindowOpensAt(input);
  return opensAt === null || input.now.getTime() >= opensAt.getTime();
}

export interface IdleDemotionInput {
  /** Last tick at which the bridge reported participants for this event. */
  lastActiveAt: Date | null;
  /** When the room started warming up (set by /wake and by the pre-scale). */
  provisioningStartedAt: Date | null;
  /** Scheduled start. */
  startsAt: Date;
  /** now - jvbInactiveGraceMinutes. */
  inactiveCutoff: Date;
  /** Current time, to tell a start that has happened from one still ahead. */
  now: Date;
}

/**
 * Should a LIVE event (still before its end time) be demoted to IDLE for
 * inactivity, freeing its bridge?
 *
 * The rule is "no activity for the whole grace window", measured from the LATEST
 * meaningful signal.
 *
 * Including `startsAt` is the point. In production an event was demoted three
 * minutes after going LIVE, killing the bridge exactly as people were arriving:
 * nobody had joined yet, so `lastActiveAt` was null and the check fell back to
 * `provisioningStartedAt` alone — already 65 minutes old, because a registrant
 * had opened the event page (and `/wake` warmed the room) long before the start.
 * An event cannot have been idle for longer than it has been running.
 *
 * Two guards keep that term from creating the opposite leak:
 *
 *  • `startsAt` counts only once it has PASSED. A LIVE row whose start is in the
 *    future — an already-live event postponed by an admin, or a mistyped date —
 *    would otherwise be undemotable for as long as the start stays ahead, and
 *    would pin a JVB node (and Jibri) for the whole postponement, against the
 *    scale-to-zero this scaler exists for (ADR-007).
 *
 *  • With NEITHER `lastActiveAt` NOR `provisioningStartedAt` we have no evidence
 *    of inactivity at all, so we leave the room alone — as the SQL this replaced
 *    did, where both OR-branches required one of the two to be non-null. That
 *    state is reachable: an event revived by pushing `endsAt` forward, which
 *    never entered PROVISIONING and that nobody has rejoined yet, would
 *    otherwise be demoted on the first tick — the very outage this fixes.
 */
export function shouldDemoteLiveToIdle(input: IdleDemotionInput): boolean {
  if (!input.lastActiveAt && !input.provisioningStartedAt) return false;

  const signals: number[] = [];
  if (input.lastActiveAt) signals.push(input.lastActiveAt.getTime());
  if (input.provisioningStartedAt) signals.push(input.provisioningStartedAt.getTime());
  if (input.startsAt.getTime() <= input.now.getTime()) {
    signals.push(input.startsAt.getTime());
  }

  return Math.max(...signals) < input.inactiveCutoff.getTime();
}

export interface RevivalInput {
  currentStatus: string;
  /** Existing event startsAt (DB row). */
  currentStartsAt: Date;
  /** New endsAt from PUT payload — undefined means caller didn't pass one. */
  newEndsAt: Date | undefined;
  /** New startsAt from PUT payload — undefined means caller kept the old one. */
  newStartsAt: Date | undefined;
  /** Whether the caller explicitly set a status (we only revive if they didn't). */
  statusExplicitlySet: boolean;
  now: Date;
}

/**
 * Decide whether a PUT on an event should "revive" it — i.e. flip
 * ENDED back to LIVE or PUBLISHED because the moderator extended
 * endsAt into the future.
 *
 * Returns the revived status, or null when no revival applies.
 *
 * Rule:
 *   - Only applies to ENDED events (others keep their current status).
 *   - newEndsAt must be defined AND > now.
 *   - Caller must NOT have set status explicitly (we don't override
 *     an intentional DRAFT/PUBLISHED/etc.).
 *   - effectiveStart = newStartsAt ?? currentStartsAt.
 *   - If effectiveStart <= now → LIVE (the event should already be in
 *     progress), otherwise PUBLISHED (scheduled but not yet started).
 */
export function reviveStatus(input: RevivalInput): 'LIVE' | 'PUBLISHED' | null {
  if (input.currentStatus !== 'ENDED') return null;
  if (input.newEndsAt === undefined) return null;
  if (input.newEndsAt.getTime() <= input.now.getTime()) return null;
  if (input.statusExplicitlySet) return null;

  const effectiveStart = input.newStartsAt ?? input.currentStartsAt;
  return effectiveStart.getTime() <= input.now.getTime() ? 'LIVE' : 'PUBLISHED';
}

/**
 * Compute the "empty since" cutoff for the authoritative empty-conference
 * close. A LIVE room whose `lastActiveAt` is non-null AND
 * older than this cutoff is considered abandoned and flipped straight to
 * ENDED, separately from (and typically shorter than) the scale-to-zero
 * inactivity grace.
 *
 *   minutes < 0  → feature disabled, returns null (caller skips the close).
 *   minutes = 0  → cutoff == now (closes on the first poll with no traffic).
 *   minutes > 0  → cutoff == now - minutes.
 */
export function emptyCloseCutoff(now: Date, minutes: number): Date | null {
  if (minutes < 0) return null;
  return new Date(now.getTime() - minutes * 60_000);
}
