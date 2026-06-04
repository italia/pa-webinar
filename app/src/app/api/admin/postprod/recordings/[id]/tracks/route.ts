/**
 * GET /api/admin/postprod/recordings/[id]/tracks
 *
 * Admin/moderatore only. Dati per il player multi-audio di riascolto
 * per-relatore (ADR-013): il mix video + una traccia audio isolata per
 * partecipante (etichettata col nome + offset di ingresso) + lo stato
 * dell'archivio scaricabile.
 *
 * L'audio isolato per-partecipante è PII sensibile (voce isolata,
 * quasi-biometrica) → questo endpoint è gated SOLO sulla sessione admin
 * e NON è mai esposto pubblicamente. Le URL audio sono signed e
 * short-lived.
 *
 * Nota offset: usiamo `RecordingTrack.startOffsetMs` (offset wall-clock
 * del manifest). L'allineamento fine via cross-correlazione è applicato
 * nell'archivio MKV scaricabile; per il riascolto in-app l'offset del
 * manifest è sufficiente (tipicamente entro ~1s).
 */

import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { prisma } from '@/lib/db';
import { NotFoundError, UnauthorizedError } from '@/lib/errors';
import {
  isPostprodStorageConfigured,
  presignArtifactDownload,
} from '@/lib/storage/postprod';
import { tryDecryptPII } from '@/lib/crypto/pii';

export const dynamic = 'force-dynamic';

const AUDIO_SAS_EXPIRY_MINUTES = 120;

export const GET = withErrorHandling(async (_request, context) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const { id } = await (context as { params: Promise<{ id: string }> }).params;

  const recording = await prisma.recording.findUnique({
    where: { id },
    select: {
      id: true,
      sourceLanguage: true,
      tracks: {
        where: { audioPurgedAt: null },
        orderBy: { startOffsetMs: 'asc' },
        select: {
          id: true,
          participantId: true,
          displayName: true,
          blobKey: true,
          startOffsetMs: true,
        },
      },
      artifacts: {
        where: { type: { in: ['ARCHIVE_MKV', 'TRANSCRIPT_VTT'] } },
        orderBy: { createdAt: 'desc' },
        select: { type: true, blobKey: true, language: true, inlineBody: true, sizeBytes: true },
      },
      jobs: {
        where: { kind: 'ARCHIVE' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { status: true },
      },
    },
  });
  if (!recording) throw new NotFoundError('Recording');
  if (!isPostprodStorageConfigured()) throw new NotFoundError('Recording storage');

  const tracks = await Promise.all(
    recording.tracks.map(async (tr) => ({
      id: tr.id,
      participantId: tr.participantId,
      displayName: tr.displayName ? tryDecryptPII(tr.displayName) : null,
      offsetSec: (tr.startOffsetMs ?? 0) / 1000,
      audioUrl: await presignArtifactDownload({
        blobKey: tr.blobKey,
        expiresInMinutes: AUDIO_SAS_EXPIRY_MINUTES,
      }),
    })),
  );

  // Sottotitoli sorgente: serviamo il testo inline (same-origin Blob lato
  // client) per evitare problemi CORS sul SAS Azure col <track>.
  const vttArtifact = recording.artifacts.find((a) => a.type === 'TRANSCRIPT_VTT');
  const subtitleVtt = vttArtifact?.inlineBody
    ? tryDecryptPII(vttArtifact.inlineBody)
    : null;

  // Archivio scaricabile.
  const archiveArtifact = recording.artifacts.find((a) => a.type === 'ARCHIVE_MKV');
  const archiveJob = recording.jobs[0];
  let archiveStatus: 'none' | 'pending' | 'running' | 'done' | 'failed' = 'none';
  let archiveUrl: string | null = null;
  if (archiveArtifact) {
    archiveStatus = 'done';
    archiveUrl = await presignArtifactDownload({
      blobKey: archiveArtifact.blobKey,
      expiresInMinutes: AUDIO_SAS_EXPIRY_MINUTES,
      downloadFilename: `archivio-${recording.id}.mkv`,
    });
  } else if (archiveJob) {
    if (archiveJob.status === 'FAILED') archiveStatus = 'failed';
    else if (archiveJob.status === 'RUNNING' || archiveJob.status === 'CLAIMED') archiveStatus = 'running';
    else archiveStatus = 'pending';
  }

  return Response.json({
    mixUrl: `/api/admin/postprod/recordings/${recording.id}/media`,
    tracks,
    subtitleVtt,
    subtitleLang: vttArtifact?.language ?? recording.sourceLanguage ?? 'it',
    archive: { status: archiveStatus, url: archiveUrl },
  });
});
