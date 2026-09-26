/**
 * Chiusura delle CallSession rimaste aperte.
 *
 * Una sessione si apre quando il primo client entra in conferenza
 * (POST /api/events/[slug]/sessions) e nessuno sa con precisione quando esce
 * l'ultimo: la chiude chi porta l'evento fuori da LIVE. Sono tre strade — il
 * giro del ciclo di vita (lifecycle-tick), la modifica di stato manuale
 * (PUT /api/events/[id], archiviazione in blocco) e il cleanup GDPR — e
 * devono chiudere nello stesso modo, nella stessa transazione del cambio di
 * stato: una sessione aperta su un evento concluso fa riportare alle
 * statistiche la finestra programmata al posto della durata vera.
 */

import type { Prisma } from '@prisma/client';

/** Il client di una transazione interattiva di Prisma. */
export type SessionTx = Prisma.TransactionClient;

interface OpenSession {
  id: string;
  eventId: string;
  startedAt: Date;
  peakParticipants: number;
}

/**
 * Chiude le sessioni ancora aperte degli eventi indicati, all'istante `now`.
 *
 * Il `peakParticipants` della sessione lo scrive in diretta la rotta
 * analytics/peak. Qui lo si RIEMPIE solo se la sessione non ne ha mai ricevuto
 * uno (una riga vecchia, o una sessione per cui nessuno ha riferito), con il
 * picco dell'evento come stima migliore disponibile: sovrascriverlo
 * sostituirebbe un dato vero della sessione con il massimo di tutte le
 * sessioni dell'evento.
 *
 * Restituisce il numero di sessioni chiuse.
 */
export async function closeOpenSessions(
  tx: SessionTx,
  eventIds: string[],
  now: Date,
): Promise<number> {
  return closeOpenSessionsWith(tx, eventIds, () => now);
}

async function closeOpenSessionsWith(
  tx: SessionTx,
  eventIds: string[],
  closeAt: (session: OpenSession) => Date,
): Promise<number> {
  if (eventIds.length === 0) return 0;
  const openSessions = await tx.callSession.findMany({
    where: { eventId: { in: eventIds }, endedAt: null },
    select: { id: true, eventId: true, startedAt: true, peakParticipants: true },
  });
  if (openSessions.length === 0) return 0;

  const events = await tx.event.findMany({
    where: { id: { in: openSessions.map((s) => s.eventId) } },
    select: { id: true, peakParticipants: true },
  });
  const peakById = new Map(events.map((e) => [e.id, e.peakParticipants]));

  await Promise.all(
    openSessions.map((s) => {
      const endedAt = closeAt(s);
      const durationSeconds = Math.max(
        0,
        Math.floor((endedAt.getTime() - s.startedAt.getTime()) / 1000),
      );
      return tx.callSession.update({
        where: { id: s.id },
        data: {
          endedAt,
          duration: durationSeconds,
          // Solo RIEMPIRE, mai sovrascrivere: il picco dell'evento è il
          // massimo su tutte le sessioni, e una sala che ha toccato 6 e poi si
          // è riempita con 2 diventerebbe «6 partecipanti» anche nella seconda.
          ...(s.peakParticipants > 0
            ? {}
            : { peakParticipants: peakById.get(s.eventId) ?? 0 }),
        },
      });
    }),
  );
  return openSessions.length;
}

export interface StaleSessionCloseInput {
  /** Inizio della sessione da chiudere. */
  startedAt: Date;
  /** Ultima modifica dell'evento: per un evento concluso a mano, è la fine. */
  updatedAt: Date;
  endsAt: Date;
  /** Ultimo segnale di attività della sala (può mancare). */
  lastActiveAt: Date | null;
  /** Grace dell'evento; null eredita quella del sito. */
  gracePeriodMinutes: number | null;
  siteGraceMinutes: number;
  now: Date;
}

/**
 * Quando far finire una sessione rimasta aperta su un evento GIÀ concluso.
 *
 * La base è l'ultima modifica dell'evento: per un evento chiuso dal
 * moderatore coincide con la chiusura. Ma `updatedAt` si sposta anche con le
 * modifiche successive (pubblicazione della registrazione, pagina post-evento,
 * archiviazione), quindi da solo gonfierebbe la durata. Lo si limita con la
 * fine più tarda plausibile della sala: `endsAt` più la grace (per le sale a
 * tempo indefinito, grace negativa, `endsAt` stesso), o l'ultima attività se
 * è più recente.
 *
 * Il limite non vale per una sessione cominciata DOPO di esso — una sala
 * rimasta aperta oltre il previsto e poi chiusa a mano — che altrimenti
 * finirebbe prima di cominciare: lì resta `updatedAt`. E una sessione non
 * finisce mai prima di cominciare.
 */
export function staleSessionCloseTime(input: StaleSessionCloseInput): Date {
  const base = Math.min(input.updatedAt.getTime(), input.now.getTime());
  const grace = input.gracePeriodMinutes ?? input.siteGraceMinutes;
  const scheduledEnd = input.endsAt.getTime() + Math.max(grace, 0) * 60_000;
  const bound = Math.max(scheduledEnd, input.lastActiveAt?.getTime() ?? 0);
  const start = input.startedAt.getTime();
  const end = bound >= start ? Math.min(base, bound) : base;
  return new Date(Math.max(end, start));
}

/** Quanti eventi ripara al massimo un giro: il resto al giro dopo. */
const REPAIR_BATCH = 100;

/**
 * Chiude le sessioni rimaste aperte su eventi già ENDED o ARCHIVED.
 *
 * Sono le righe lasciate dalle chiusure che non chiudevano le sessioni (la
 * modifica di stato manuale, l'archiviazione in blocco) e quelle aperte da un
 * client un istante dopo la chiusura. L'orario di fine è stimato da
 * `staleSessionCloseTime`.
 *
 * Restituisce il numero di sessioni chiuse.
 */
export async function closeSessionsOfEndedEvents(
  tx: SessionTx,
  now: Date,
  siteGraceMinutes: number,
): Promise<number> {
  const open = await tx.callSession.findMany({
    where: { endedAt: null, event: { status: { in: ['ENDED', 'ARCHIVED'] } } },
    select: { eventId: true },
    distinct: ['eventId'],
    take: REPAIR_BATCH,
  });
  return closeStaleSessions(
    tx,
    open.map((s) => s.eventId),
    now,
    siteGraceMinutes,
  );
}

/**
 * Chiude le sessioni aperte degli eventi indicati con l'orario stimato da
 * `staleSessionCloseTime`, invece che adesso: per eventi finiti da tempo
 * (riparazione, archiviazione per retention) «adesso» gonfierebbe la durata
 * di giorni.
 */
export async function closeStaleSessions(
  tx: SessionTx,
  eventIds: string[],
  now: Date,
  siteGraceMinutes: number,
): Promise<number> {
  if (eventIds.length === 0) return 0;
  const events = await tx.event.findMany({
    where: { id: { in: eventIds } },
    select: {
      id: true,
      updatedAt: true,
      endsAt: true,
      lastActiveAt: true,
      gracePeriodMinutes: true,
    },
  });
  const byId = new Map(events.map((e) => [e.id, e]));

  return closeOpenSessionsWith(
    tx,
    events.map((e) => e.id),
    (s) => {
      const ev = byId.get(s.eventId);
      if (!ev) return now;
      return staleSessionCloseTime({
        startedAt: s.startedAt,
        updatedAt: ev.updatedAt,
        endsAt: ev.endsAt,
        lastActiveAt: ev.lastActiveAt,
        gracePeriodMinutes: ev.gracePeriodMinutes,
        siteGraceMinutes,
        now,
      });
    },
  );
}
