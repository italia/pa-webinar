/**
 * GET /api/admin/postprod/recordings/[id]/details
 *
 * Vista d'insieme COMPLETA di una registrazione per l'admin: metadati
 * (durata, partecipanti, lingua), conteggio tracce audio, timeline dei job,
 * inventario artefatti con dimensioni REALI (dallo storage, perché il campo
 * DB può essere null per gli artefatti spinti dal pipeline locale), elenco
 * dei file nel blob, metriche dell'output LLM (sintesi per lingua) e lo
 * snapshot di trasparenza dei modelli. URL media firmati e short-lived.
 *
 * Gated SOLO sulla sessione admin: include dati PII (nomi, voce isolata).
 */

import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { prisma } from '@/lib/db';
import { NotFoundError, UnauthorizedError } from '@/lib/errors';
import {
  isPostprodStorageConfigured,
  presignArtifactDownload,
  listPostprodBlobs,
} from '@/lib/storage/postprod';
import { tryDecryptPII } from '@/lib/crypto/pii';

export const dynamic = 'force-dynamic';

const MEDIA_EXPIRY_MIN = 120;

function jobDurationSec(startedAt: Date | null, completedAt: Date | null): number | null {
  if (!startedAt || !completedAt) return null;
  const s = (completedAt.getTime() - startedAt.getTime()) / 1000;
  return s > 0 ? Math.round(s) : null;
}

/** Metriche leggibili dalla sintesi strutturata (decifrata). */
function summaryMetrics(raw: string | null): {
  topics: number;
  decisions: number;
  actionItems: number;
  overallChars: number;
} | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as {
      overall_summary?: string;
      key_decisions?: unknown[];
      action_items?: unknown[];
      topics?: unknown[];
    };
    return {
      topics: Array.isArray(j.topics) ? j.topics.length : 0,
      decisions: Array.isArray(j.key_decisions) ? j.key_decisions.length : 0,
      actionItems: Array.isArray(j.action_items) ? j.action_items.length : 0,
      overallChars: (j.overall_summary ?? '').length,
    };
  } catch {
    return null;
  }
}

export const GET = withErrorHandling(async (_request, context) => {
  if (!(await isAdminAuthenticated(await cookies()))) throw new UnauthorizedError();
  const { id } = await (context as { params: Promise<{ id: string }> }).params;

  const rec = await prisma.recording.findUnique({
    where: { id },
    select: {
      id: true,
      eventId: true,
      status: true,
      runCount: true,
      sourceLanguage: true,
      durationSec: true,
      fileSizeBytes: true,
      blobKey: true,
      createdAt: true,
      updatedAt: true,
      retentionUntil: true,
      pipelineSnapshot: true,
      event: { select: { slug: true, title: true } },
      callSession: { select: { peakParticipants: true } },
      jobs: {
        orderBy: { createdAt: 'asc' },
        select: {
          kind: true, status: true, attempts: true,
          startedAt: true, completedAt: true, lastError: true, createdAt: true,
        },
      },
      artifacts: {
        orderBy: [{ type: 'asc' }, { language: 'asc' }],
        select: {
          type: true, language: true, sizeBytes: true, mimeType: true,
          blobKey: true, inlineBody: true, modelId: true, modelVersion: true,
          watermarkType: true, createdAt: true,
        },
      },
      tracks: {
        orderBy: { startOffsetMs: 'asc' },
        select: {
          participantId: true, displayName: true, sizeBytes: true,
          startOffsetMs: true, durationMs: true, audioPurgedAt: true,
        },
      },
      speakers: {
        orderBy: { totalSpeechSec: 'desc' },
        select: { id: true, diarLabel: true, displayName: true, totalSpeechSec: true },
      },
    },
  });
  if (!rec) throw new NotFoundError('Recording');

  // Dimensioni reali dei blob (il pipeline locale lascia sizeBytes=null nel
  // DB ma il file ESISTE): elenchiamo lo storage e costruiamo una mappa
  // key→size, usata come fallback. Best-effort (lo storage potrebbe non
  // essere configurato in dev).
  let storageFiles: Array<{ key: string; sizeBytes: number | null }> = [];
  const sizeByKey = new Map<string, number | null>();
  if (isPostprodStorageConfigured()) {
    try {
      storageFiles = await listPostprodBlobs(`postprod/${rec.eventId}/${rec.id}`);
      for (const f of storageFiles) sizeByKey.set(f.key, f.sizeBytes);
    } catch {
      /* listing best-effort */
    }
  }
  const realSize = (blobKey: string, dbSize: bigint | null): number | null => {
    if (dbSize != null) return Number(dbSize);
    return sizeByKey.get(blobKey) ?? null;
  };

  // Metriche LLM dalla sintesi strutturata, per lingua.
  const llmByLang: Record<string, ReturnType<typeof summaryMetrics>> = {};
  let llmModel: string | null = null;
  for (const a of rec.artifacts) {
    if (a.type === 'SUMMARY_JSON' && a.language) {
      const m = summaryMetrics(a.inlineBody ? tryDecryptPII(a.inlineBody) : null);
      if (m) llmByLang[a.language] = m;
      if (a.modelId) llmModel = a.modelId;
    }
  }

  // URL media firmati per il player/ download (dub, sottotitoli, archivio).
  const dubbedAudio = await Promise.all(
    rec.artifacts
      .filter((a) => a.type === 'DUBBED_AUDIO' && a.language)
      .map(async (a) => ({
        language: a.language as string,
        url: await presignArtifactDownload({ blobKey: a.blobKey, expiresInMinutes: MEDIA_EXPIRY_MIN }),
        sizeBytes: realSize(a.blobKey, a.sizeBytes),
        watermark: a.watermarkType,
      })),
  );

  return Response.json({
    recording: {
      id: rec.id,
      status: rec.status,
      runCount: rec.runCount,
      sourceLanguage: rec.sourceLanguage,
      durationSec: rec.durationSec,
      fileSizeBytes: rec.fileSizeBytes != null ? Number(rec.fileSizeBytes) : null,
      createdAt: rec.createdAt.toISOString(),
      updatedAt: rec.updatedAt.toISOString(),
      retentionUntil: rec.retentionUntil ? rec.retentionUntil.toISOString() : null,
      eventTitle: rec.event?.title ?? null,
      eventSlug: rec.event?.slug ?? null,
    },
    participants: { peak: rec.callSession?.peakParticipants ?? null },
    tracks: {
      count: rec.tracks.length,
      purged: rec.tracks.filter((t) => t.audioPurgedAt != null).length,
      items: rec.tracks.map((t) => ({
        participantId: t.participantId,
        displayName: t.displayName ? tryDecryptPII(t.displayName) : null,
        startOffsetMs: t.startOffsetMs,
        durationMs: t.durationMs,
        sizeBytes: t.sizeBytes != null ? Number(t.sizeBytes) : null,
        purged: t.audioPurgedAt != null,
      })),
    },
    jobs: rec.jobs.map((j) => ({
      kind: j.kind,
      status: j.status,
      attempts: j.attempts,
      durationSec: jobDurationSec(j.startedAt, j.completedAt),
      lastError: j.lastError,
      createdAt: j.createdAt.toISOString(),
    })),
    artifacts: rec.artifacts.map((a) => ({
      type: a.type,
      language: a.language,
      sizeBytes: realSize(a.blobKey, a.sizeBytes),
      mimeType: a.mimeType,
      blobKey: a.blobKey,
      modelId: a.modelId,
      modelVersion: a.modelVersion,
      watermark: a.watermarkType,
      createdAt: a.createdAt.toISOString(),
    })),
    storageFiles: storageFiles
      .map((f) => ({ key: f.key, sizeBytes: f.sizeBytes }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    llm: { perLanguage: llmByLang, model: llmModel },
    dubbedAudio,
    speakers: rec.speakers.map((s) => ({
      id: s.id,
      diarLabel: s.diarLabel,
      displayName: s.displayName, // Speaker.displayName è in chiaro
      totalSpeechSec: s.totalSpeechSec,
    })),
    pipelineSnapshot: rec.pipelineSnapshot ?? null,
  });
});
