import { notFound } from 'next/navigation';
import { getLocale } from 'next-intl/server';

import { staffOLogin } from '@/lib/auth/staff-page';
import { puoGestire } from '@/lib/auth/staff-session';
import AccessDenied from '@/components/admin/access-denied';
import { prisma } from '@/lib/db';
import { confermaVociNecessaria } from '@/lib/ai/voice-consent';
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

  const eventTitle = getLocalized(recording.event?.title as LocalizedField, locale) || '—';
  // Il video completo di un evento con il consenso voce per voce si trascrive
  // solo con la conferma che tutte le voci hanno acconsentito: la si chiede
  // una volta, al posto della conferma generica.
  const sito = await prisma.siteSetting.findUnique({
    where: { id: 'singleton' },
    select: { liveCaptionsEnabled: true, aiPipelineEnabled: true },
  });
  const confermaVoci =
    !!recording.event && (await confermaVociNecessaria(prisma, recording, recording.event, sito ?? {}));
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
      // Il motivo per cui non e' partita, solo se senza quella conferma
      // sarebbe partita (AI accesa per l'evento e per il sito).
      avvisoConfermaVoci={confermaVoci && !!recording.event?.aiTranscriptEnabled && !!sito?.aiPipelineEnabled}
      eventId={recording.eventId}
      initialTab={initialTab}
    />
  );
}
