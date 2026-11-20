// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Access gating per gli endpoint pubblici di consumo postprod
 * (transcript JSON, subtitle VTT, dubbed audio, download).
 *
 * Tre cancelli, in ordine:
 *   1. kill-switch globale `SiteSetting.aiPipelineEnabled` → 404 se off
 *      (uniforme con la status card che torna `null`), a meno che l'evento
 *      tenga la trascrizione dai sottotitoli live, che non passa dalla
 *      pipeline AI (lib/captions/transcript).
 *   2. chi chiede puo' vedere la registrazione (lib/recording/audience):
 *      pubblicata — il video (`recordingPublished`) o la sola trascrizione
 *      (`transcriptPublished`), per esempio quella dai sottotitoli di un
 *      evento senza registrazione — nella finestra post-evento
 *      (`postEventPublic`, `postEventPublicUntil`), per chiunque o per i soli
 *      iscritti secondo `recordingAudience`, che su un evento con destinazione
 *      non dipendono da `postEventPublic`; oppure lo staff che organizza
 *      l'evento, anche prima della pubblicazione (l'anteprima della pagina),
 *      con la lettura tracciata (lib/recording/content-access); oppure, in
 *      una chiamata rapida, chi era in sala mentre si registrava.
 *
 * Passati i cancelli, il perimetro (`ambito`) dice che cosa si mostra:
 *   - `tutto`: il video e' pubblicato (o lo guarda lo staff) e la pipeline AI
 *     e' accesa. Trascrizione,
 *     sottotitoli, sintesi, traduzioni e doppiaggio, come sempre;
 *   - `trascrizione`: e' pubblicata la sola trascrizione, oppure la pipeline
 *     AI e' spenta. Solo il testo della trascrizione nella lingua sorgente:
 *     niente sintesi, traduzioni, doppiaggio, che sono prodotti dell'AI e
 *     accompagnano il video. Con la pipeline spenta, solo la trascrizione dai
 *     sottotitoli (`soloSottotitoli`), non quella fatta dall'AI.
 *
 * In tutti i casi di rifiuto torna 404 — non vogliamo distinguere
 * "evento non esiste" da "trascrizione ritirata", per non leakare
 * informazioni operative.
 */
import { cookies } from 'next/headers';

import { prisma } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { accessoRegistrazioneConStaff, pubblicazioneAperta } from '@/lib/recording/audience';
import { tracciaLetturaContenuto, type SuperficieContenuto } from '@/lib/recording/content-access';

export interface PostprodAccessOk {
  eventId: string;
  ambito: 'tutto' | 'trascrizione';
  /** Vale solo la trascrizione dai sottotitoli live (la pipeline AI e' spenta). */
  soloSottotitoli: boolean;
}

export async function assertPostprodAccessible(
  slug: string,
  /** Cosa si legge: entra nel registro delle letture dello staff. */
  superficie: SuperficieContenuto = 'trascrizione',
): Promise<PostprodAccessOk> {
  const [site, event] = await Promise.all([
    prisma.siteSetting.findUnique({
      where: { id: 'singleton' },
      select: { aiPipelineEnabled: true },
    }),
    prisma.event.findUnique({
      where: { slug },
      select: {
        id: true,
        recordingPublished: true,
        postEventPublic: true,
        postEventPublicUntil: true,
        captionsTranscriptEnabled: true,
        transcriptPublished: true,
        recordingAudience: true,
        recordingDestination: true,
      },
    }),
  ]);

  if (!event) throw new NotFoundError('Event');
  const aiAccesa = !!site?.aiPipelineEnabled;
  if (!aiAccesa && !event.captionsTranscriptEnabled) throw new NotFoundError('Postprod');
  const { accesso, staff } = await accessoRegistrazioneConStaff(event, await cookies());
  if (!accesso) throw new NotFoundError('Postprod');
  if (staff) {
    await tracciaLetturaContenuto({ ...staff, eventId: event.id, recordingId: null, superficie });
  }
  // Lo staff vede cio' che vedra' il pubblico; prima della pubblicazione,
  // l'anteprima del video pubblicato. Chi era in sala in una chiamata rapida
  // vede cio' che c'e': la chiamata non si pubblica.
  const anteprima =
    (accesso === 'staff' && !pubblicazioneAperta(event)) || accesso === 'presente';

  return {
    eventId: event.id,
    ambito: (event.recordingPublished || anteprima) && aiAccesa ? 'tutto' : 'trascrizione',
    soloSottotitoli: !aiAccesa,
  };
}
