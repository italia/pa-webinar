/**
 * Ciclo di vita della Recording per il recorder multi-traccia (ADR-013
 * Fase 3, scelta "crea early + Jibri riusa unificato").
 *
 * Problema: il recorder serve un `recordingId` *durante* l'evento, ma il
 * modello `Recording` è 1:1 con `CallSession` ed entrambi oggi nascono a
 * fine evento dal webhook Jibri. Soluzione: creiamo presto una Recording
 * "segnaposto" multi-traccia (su una CallSession dedicata) e rendiamo il
 * webhook Jibri idempotente — se trova questa Recording, la arricchisce col
 * mix invece di crearne una seconda (vedi `isMultitrackPlaceholder` /
 * `app/src/app/api/webhooks/recording/route.ts`).
 *
 * Il rilevamento è keyed sulla `blobKey` che inizia col prefisso multitrack:
 * così il cambiamento al path Jibri (critico) scatta SOLO quando esiste una
 * Recording multitraccia, lasciando intatti tutti i flussi single-track.
 */

import type { Prisma, PrismaClient } from '@prisma/client';

/** Prefisso (marker) delle registrazioni multi-traccia in object storage. */
export const MULTITRACK_PREFIX = 'recordings/multitrack/';

/** True se la Recording è un segnaposto multitraccia (non ancora il mix). */
export function isMultitrackPlaceholder(blobKey: string): boolean {
  return blobKey.startsWith(MULTITRACK_PREFIX);
}

type Tx = PrismaClient | Prisma.TransactionClient;

/**
 * Garantisce che esista una Recording multi-traccia per l'evento e ne
 * ritorna l'id. Idempotente: se c'è già, la riusa. Crea una CallSession
 * dedicata (la Recording richiede `callSessionId` NOT NULL @unique); la
 * CallSession analitica aperta dal client in diretta resta separata.
 */
export async function ensureMultitrackRecording(
  tx: Tx,
  ev: { id: string; jitsiRoomName: string; startsAt: Date },
): Promise<{ recordingId: string; created: boolean }> {
  const existing = await tx.recording.findFirst({
    where: { eventId: ev.id, blobKey: { startsWith: MULTITRACK_PREFIX } },
    select: { id: true },
  });
  if (existing) return { recordingId: existing.id, created: false };

  const callSession = await tx.callSession.create({
    data: {
      eventId: ev.id,
      jitsiRoomName: ev.jitsiRoomName,
      startedAt: ev.startsAt,
      // endedAt resta null finché l'evento non termina (il webhook Jibri o
      // closeOpenSessions lo chiuderanno).
    },
    select: { id: true },
  });

  // blobKey segnaposto a livello evento: sufficiente per il rilevamento;
  // le tracce reali vivono sotto `${MULTITRACK_PREFIX}${eventId}/${recId}/`
  // (vedi infra/recorder/src/paths.ts). Il webhook Jibri sovrascriverà
  // questa blobKey col mix per il playback/waveform.
  const recording = await tx.recording.create({
    data: {
      callSessionId: callSession.id,
      eventId: ev.id,
      blobKey: `${MULTITRACK_PREFIX}${ev.id}/`,
    },
    select: { id: true },
  });
  return { recordingId: recording.id, created: true };
}
