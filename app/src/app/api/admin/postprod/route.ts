/**
 * GET /api/admin/postprod
 *
 * Lists recordings + their postprod state for the admin dashboard.
 * Output is paginated and includes per-recording job counts so the
 * UI can render status pills without N+1 fetches.
 *
 * Query params:
 *   limit?   (default 50, max 200)
 *   offset?  (default 0)
 *   status?  comma-separated RecordingStatus values for filtering
 *   eventId? scope to a single event
 *
 * Auth: admin session cookie (no API key — same as the rest of
 * /admin/* endpoints).
 */

import { cookies } from 'next/headers';
import type { Prisma } from '@prisma/client';

import { withErrorHandling } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { prisma } from '@/lib/db';
import { UnauthorizedError } from '@/lib/errors';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import { tryDecryptPII } from '@/lib/crypto/pii';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const GET = withErrorHandling(async (request) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const url = new URL(request.url);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(url.searchParams.get('limit')) || DEFAULT_LIMIT),
  );
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  const statusParam = url.searchParams.get('status');
  const eventId = url.searchParams.get('eventId') ?? undefined;
  const statuses = statusParam
    ? statusParam
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  const where: Prisma.RecordingWhereInput = {
    ...(eventId && { eventId }),
    ...(statuses && {
      status: {
        in: statuses as Prisma.RecordingWhereInput['status'] extends infer T
          ? T extends { in: infer U }
            ? U
            : never
          : never,
      },
    }),
  };

  const [rows, total] = await Promise.all([
    prisma.recording.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        event: { select: { id: true, slug: true, title: true } },
        jobs: {
          select: {
            id: true,
            kind: true,
            status: true,
            attempts: true,
            lastError: true,
            createdAt: true,
            completedAt: true,
          },
        },
        artifacts: {
          select: {
            id: true,
            type: true,
            language: true,
            sizeBytes: true,
            modelId: true,
            inlineBody: true,
            createdAt: true,
          },
        },
        speakers: {
          select: {
            id: true,
            diarLabel: true,
            displayName: true,
            personId: true,
            totalSpeechSec: true,
          },
        },
      },
    }),
    prisma.recording.count({ where }),
  ]);

  return Response.json({
    total,
    limit,
    offset,
    rows: rows.map((r) => ({
      id: r.id,
      eventId: r.eventId,
      eventSlug: r.event.slug,
      eventTitle: getLocalized(r.event.title as LocalizedField, 'it'),
      blobKey: r.blobKey,
      durationSec: r.durationSec,
      fileSizeBytes: r.fileSizeBytes ? r.fileSizeBytes.toString() : null,
      sourceLanguage: r.sourceLanguage,
      status: r.status,
      runCount: r.runCount,
      retentionUntil: r.retentionUntil?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      jobs: r.jobs.map((j) => ({
        id: j.id,
        kind: j.kind,
        status: j.status,
        attempts: j.attempts,
        lastError: j.lastError,
        createdAt: j.createdAt.toISOString(),
        completedAt: j.completedAt?.toISOString() ?? null,
      })),
      artifacts: r.artifacts.map((a) => ({
        id: a.id,
        type: a.type,
        language: a.language,
        sizeBytes: a.sizeBytes ? a.sizeBytes.toString() : null,
        modelId: a.modelId,
        createdAt: a.createdAt.toISOString(),
      })),
      speakers: r.speakers.map((s) => ({
        id: s.id,
        diarLabel: s.diarLabel,
        displayName: s.displayName,
        personId: s.personId,
        totalSpeechSec: s.totalSpeechSec,
        // Estraggo dal TRANSCRIPT_JSON la prima frase pronunciata da
        // questo speaker — serve all'admin per riconoscere chi è
        // (anziché doversi ascoltare la registrazione).
        sampleText: extractSampleText(r.artifacts, s.diarLabel),
      })),
    })),
  });
});

/** Recupera la prima frase pronunciata da `diarLabel` dal TRANSCRIPT_JSON
 *  artifact, se presente, decifrato. Ritorna null se non disponibile. */
function extractSampleText(
  artifacts: Array<{ type: string; inlineBody: string | null }>,
  diarLabel: string,
): string | null {
  const tx = artifacts.find((a) => a.type === 'TRANSCRIPT_JSON');
  if (!tx?.inlineBody) return null;
  const decoded = tryDecryptPII(tx.inlineBody);
  if (!decoded) return null;
  try {
    const parsed = JSON.parse(decoded) as {
      segments?: Array<{ speaker?: string; text?: string }>;
    };
    const segs = parsed.segments ?? [];
    for (const s of segs) {
      if (s.speaker === diarLabel && s.text && s.text.trim().length > 5) {
        const trimmed = s.text.trim();
        return trimmed.length > 140 ? trimmed.slice(0, 140) + '…' : trimmed;
      }
    }
  } catch {
    return null;
  }
  return null;
}
