// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { notFound } from 'next/navigation';
import { getLocale } from 'next-intl/server';

import { staffOLogin } from '@/lib/auth/staff-page';
import { puoGestire } from '@/lib/auth/staff-session';
import { accessoContenutoStaff } from '@/lib/recording/content-access';
import AccessDenied from '@/components/admin/access-denied';
import { prisma } from '@/lib/db';
import { confermaVociNecessaria } from '@/lib/ai/voice-consent';
import { registrazionePubblica } from '@/lib/captions/transcript';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import RecordingManageClient from '@/components/admin/recording-manage-client';
import { recordingTabFrom } from '@/components/admin/recording-tabs';
import { adminPageMetadata } from '@/components/admin/admin-page-title';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ recordingId: string }>;
  searchParams?: Promise<{ tab?: string }>;
}

/**
 * Pagina dedicata di gestione di UNA registrazione: trascrizione (testo +
 * diarization), sintesi AI e traduzioni in un unico posto. Linkata da
 * lista registrazioni, dettaglio evento e dashboard postprod.
 */
export function generateMetadata() {
  return adminPageMetadata('/admin/postprod/[recordingId]');
}

export default async function RecordingManagePage({ params, searchParams }: PageProps) {
  const locale = await getLocale();
  const session = await staffOLogin(locale);

  const { recordingId } = await params;
  const recording = await prisma.recording.findUnique({
    where: { id: recordingId },
    select: {
      id: true,
      status: true,
      durationSec: true,
      sourceLanguage: true,
      createdAt: true,
      eventId: true,
      blobKey: true,
      transcriptConsentRule: true,
      event: {
        select: {
          title: true,
          slug: true,
          multitrackRecordingEnabled: true,
          captionsTranscriptEnabled: true,
          liveCaptionsEnabled: true,
          aiTranscriptEnabled: true,
        },
      },
    },
  });
  if (!recording) notFound();
  // La registrazione e' dell'evento: la gestisce chi gestisce l'evento.
  if (!(await puoGestire(session, recording.eventId))) {
    return <AccessDenied />;
  }
  // Chi gestisce l'evento senza organizzarlo (l'admin dell'istanza) vede che
  // la registrazione c'e' e come procede, non il contenuto
  // (lib/recording/content-access).
  const contenuto =
    (await accessoContenutoStaff(session, {
      eventId: recording.eventId,
      recordingId: recording.id,
      superficie: 'video',
    })) !== null;

  const eventTitle = getLocalized(recording.event?.title as LocalizedField, locale) || '—';
  // Il video completo soggetto al consenso voce per voce si trascrive solo con
  // la conferma che tutte le voci hanno acconsentito: la si chiede una volta,
  // al posto della conferma generica.
  const sito = await prisma.siteSetting.findUnique({
    where: { id: 'singleton' },
    select: { liveCaptionsEnabled: true, aiPipelineEnabled: true },
  });
  const confermaVoci =
    !!recording.event && (await confermaVociNecessaria(prisma, recording, recording.event, sito ?? {}));
  // Il motivo per cui non e' partita, solo se senza quella conferma sarebbe
  // partita (AI accesa per l'evento e per il sito).
  const avvisoConfermaVoci =
    confermaVoci && !!recording.event?.aiTranscriptEnabled && !!sito?.aiPipelineEnabled;
  // Se la conferma non arriva, una trascrizione dai sottotitoli resta? Ci sono
  // frasi che possono diventarla (di chi non ha dato il consenso restano solo i
  // tempi), o il testo gia' ricavato anche se le frasi non ci sono piu'.
  const restaDaiSottotitoli =
    avvisoConfermaVoci &&
    (!!(await prisma.captionSegment.findFirst({
      where: { eventId: recording.eventId, text: { not: null }, seatId: { not: null } },
      select: { id: true },
    })) ||
      (await registrazionePubblica(recording.eventId, true)) !== null);
  // La scheda chiesta dal link (`?tab=slides` dalla scheda dell'evento), se esiste.
  const initialTab = recordingTabFrom((await searchParams)?.tab);

  return (
    <RecordingManageClient
      recordingId={recording.id}
      eventTitle={eventTitle}
      eventSlug={recording.event?.slug ?? null}
      status={recording.status}
      durationSec={recording.durationSec}
      sourceLanguage={recording.sourceLanguage ?? 'it'}
      createdAt={recording.createdAt.toISOString()}
      // Senza file: la trascrizione e' quella dei sottotitoli live.
      soloSottotitoli={recording.blobKey === ''}
      confermaVoci={confermaVoci}
      avvisoConfermaVoci={avvisoConfermaVoci}
      restaDaiSottotitoli={restaDaiSottotitoli}
      eventId={recording.eventId}
      initialTab={initialTab}
      contenuto={contenuto}
    />
  );
}
