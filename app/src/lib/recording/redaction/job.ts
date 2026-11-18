// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Il lavoro che toglie una persona dal video (PostprodJob di tipo REDACT).
 *
 * Il worker senza GPU scarica il video, copre ogni intervallo con il cartello
 * «contenuto rimosso su richiesta» a schermo pieno e ne azzera l'audio, a
 * durata invariata, e carica il risultato accanto all'originale. La consegna
 * (api/internal/recording-redaction) sostituisce il video e completa la
 * rimozione (lib/recording/redaction/apply).
 *
 * E' un lavoro dell'evento, come il resoconto: la registrazione sta nel
 * payload, lo chiude solo la consegna (lib/report/job), e non cambia lo stato
 * della pipeline della registrazione.
 */
import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';
import type { z } from 'zod';

import type { redactPayloadSchema } from '@/lib/ai/schemas';
import { locales, defaultLocale } from '@/i18n/config';

import type { Intervallo } from './intervals';

type Db = Prisma.TransactionClient;

export type PayloadRimozione = z.infer<typeof redactPayloadSchema>;

/** Il lavoro si chiude senza fare niente: la registrazione ha un altro video, o non c'e' piu'. */
export const MOTIVO_VIDEO_CAMBIATO =
  'The recording no longer has the video this removal started from';

/**
 * Quanto durano gli indirizzi firmati del lavoro: piu' del lease, perche' il
 * caricamento arriva dopo la ricodifica di tutto il video. La scadenza del Job
 * del worker (activeDeadlineSeconds) e' piu' corta.
 */
export const URL_RIMOZIONE_MINUTI = 180;

/** Dove va il video ripulito: accanto agli altri video, mai sopra l'originale. */
export function chiaveVideoRipulito(
  eventId: string,
  recordingId: string,
  requestId: string
): string {
  return `recordings/redacted/${eventId}/${recordingId}/${requestId}.mp4`;
}

/** La lingua del cartello: quella parlata nella registrazione, se l'interfaccia la conosce. */
export function linguaDelCartello(sourceLanguage: string | null | undefined): string {
  const lingua = (sourceLanguage ?? '').toLowerCase().slice(0, 2);
  return (locales as readonly string[]).includes(lingua) ? lingua : defaultLocale;
}

/** Accoda il lavoro di rimozione del video. Restituisce l'id del lavoro. */
export async function accodaRimozione(
  tx: Db,
  richiesta: { id: string; eventId: string },
  registrazione: { id: string; blobKey: string; sourceLanguage: string | null },
  intervalli: readonly Intervallo[]
): Promise<string> {
  const payload: PayloadRimozione = {
    eventId: richiesta.eventId,
    recordingId: registrazione.id,
    requestId: richiesta.id,
    sourceKey: registrazione.blobKey,
    targetKey: chiaveVideoRipulito(richiesta.eventId, registrazione.id, richiesta.id),
    intervals: intervalli.map((i) => ({ start: i.start, end: i.end })),
    language: linguaDelCartello(registrazione.sourceLanguage),
  };
  const lavoro = await tx.postprodJob.create({
    data: {
      eventId: richiesta.eventId,
      kind: 'REDACT',
      payload: payload as unknown as Prisma.InputJsonValue,
      // Un invio nuovo dopo un fallimento e' un lavoro nuovo: la richiesta
      // passa in elaborazione una volta sola per invio (lib/recording/redaction).
      idempotencyKey: `redact:${richiesta.id}:${randomUUID()}`,
    },
    select: { id: true },
  });
  return lavoro.id;
}
