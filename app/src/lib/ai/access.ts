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
 *      iscritti secondo `recordingAudience`; oppure lo staff che gestisce
 *      l'evento, anche prima della pubblicazione (l'anteprima della pagina).
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
import { accessoRegistrazione, pubblicazioneAperta } from '@/lib/recording/audience';

export interface PostprodAccessOk {
  eventId: string;
  ambito: 'tutto' | 'trascrizione';
  /** Vale solo la trascrizione dai sottotitoli live (la pipeline AI e' spenta). */
  soloSottotitoli: boolean;
}

export async function assertPostprodAccessible(slug: string): Promise<PostprodAccessOk> {
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
      },
    }),
  ]);

  if (!event) throw new NotFoundError('Event');
  const aiAccesa = !!site?.aiPipelineEnabled;
  if (!aiAccesa && !event.captionsTranscriptEnabled) throw new NotFoundError('Postprod');
  const accesso = await accessoRegistrazione(event, await cookies());
  if (!accesso) throw new NotFoundError('Postprod');
  // Lo staff vede cio' che vedra' il pubblico; prima della pubblicazione,
  // l'anteprima del video pubblicato.
  const anteprima = accesso === 'staff' && !pubblicazioneAperta(event);

  return {
    eventId: event.id,
    ambito: (event.recordingPublished || anteprima) && aiAccesa ? 'tutto' : 'trascrizione',
    soloSottotitoli: !aiAccesa,
  };
}
