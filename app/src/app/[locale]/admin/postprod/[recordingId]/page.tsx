import { notFound } from 'next/navigation';
import { getLocale } from 'next-intl/server';

import { staffOLogin } from '@/lib/auth/staff-page';
import { canManageEvent } from '@/lib/auth/staff-session';
import AccessDenied from '@/components/admin/access-denied';
import { prisma } from '@/lib/db';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import RecordingManageClient from '@/components/admin/recording-manage-client';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ recordingId: string }>;
}

/**
 * Pagina dedicata di gestione di UNA registrazione: trascrizione (testo +
 * diarization), sintesi AI e traduzioni in un unico posto. Linkata da
 * lista registrazioni, dettaglio evento e dashboard postprod.
 */
export default async function RecordingManagePage({ params }: PageProps) {
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
      event: { select: { title: true, slug: true, createdById: true } },
    },
  });
  if (!recording) notFound();
  // La registrazione e' dell'evento: la gestisce chi gestisce l'evento.
  if (!canManageEvent(session, { createdById: recording.event?.createdById ?? null })) {
    return <AccessDenied />;
  }

  const eventTitle = getLocalized(recording.event?.title as LocalizedField, locale) || '—';

  return (
    <RecordingManageClient
      recordingId={recording.id}
      eventTitle={eventTitle}
      eventSlug={recording.event?.slug ?? null}
      status={recording.status}
      durationSec={recording.durationSec}
      sourceLanguage={recording.sourceLanguage ?? 'it'}
      createdAt={recording.createdAt.toISOString()}
    />
  );
}
