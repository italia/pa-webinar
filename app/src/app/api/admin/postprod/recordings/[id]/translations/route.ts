/**
 * GET/POST /api/admin/postprod/recordings/[id]/translations
 *
 * Per-recording translation language management for the admin UI.
 *
 *   GET  — report which languages the recording is already translated
 *          into (an artifact TRANSLATION_MD or TRANSLATION_VTT exists),
 *          plus the set of locales the admin may still add (site-enabled
 *          locales minus the source language minus already-translated).
 *
 *   POST — body { targetLanguage }: enqueue a SINGLE on-demand TRANSLATE
 *          job for that language. Verifies the master kill-switch and
 *          that a TRANSCRIPT_JSON already exists ("transcribe first").
 *          Idempotent: re-adding a queued/translated language is a
 *          no-op that returns 200.
 *
 * Auth: admin session cookie (same as the rest of /api/admin/postprod).
 */

import { z } from 'zod';
import { cookies } from 'next/headers';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { enqueueTranslateLanguage } from '@/lib/ai/enqueue';
import { prisma } from '@/lib/db';
import { NotFoundError, UnauthorizedError, ValidationError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/** Site-enabled locales (mirrors GET /api/admin/languages fallback). */
async function loadEnabledLocales(): Promise<string[]> {
  const settings = await prisma.siteSetting.findUnique({
    where: { id: 'singleton' },
    select: { availableLocales: true },
  });
  const locales = settings?.availableLocales;
  if (Array.isArray(locales)) {
    const cleaned = locales.filter(
      (l): l is string => typeof l === 'string' && l.length >= 2,
    );
    if (cleaned.length > 0) return cleaned;
  }
  return ['it', 'en'];
}

export const GET = withErrorHandling(async (_request, context) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const { id } = await (context as { params: Promise<{ id: string }> }).params;

  const recording = await prisma.recording.findUnique({
    where: { id },
    select: {
      id: true,
      sourceLanguage: true,
      event: { select: { slug: true } },
      artifacts: {
        where: { type: { in: ['TRANSLATION_MD', 'TRANSLATION_VTT', 'DUBBED_AUDIO'] } },
        select: { language: true, type: true },
      },
    },
  });
  if (!recording) throw new NotFoundError('Recording');

  const sourceLanguage = recording.sourceLanguage ?? 'it';

  // Lingue con almeno un artefatto di traduzione (MD o VTT). Per ogni lingua
  // riportiamo COSA esiste (sintesi/sottotitoli/doppiaggio) così la tab mostra
  // contenuto reale e link di download, non solo un badge.
  const langSet = new Set(
    recording.artifacts
      .filter((a) => a.type !== 'DUBBED_AUDIO')
      .map((a) => a.language)
      .filter((l): l is string => Boolean(l)),
  );
  const has = (lang: string, type: string) =>
    recording.artifacts.some((a) => a.language === lang && a.type === type);
  const translated = Array.from(langSet)
    .sort()
    .map((lang) => ({
      lang,
      hasSummary: has(lang, 'TRANSLATION_MD'),
      hasSubtitle: has(lang, 'TRANSLATION_VTT'),
      hasDub: has(lang, 'DUBBED_AUDIO'),
    }));

  const enabledLocales = await loadEnabledLocales();
  const available = enabledLocales
    .filter((l) => l !== sourceLanguage && !langSet.has(l))
    .sort();

  return Response.json({
    sourceLanguage,
    eventSlug: recording.event?.slug ?? null,
    translated,
    available,
  });
});

const bodySchema = z.object({
  targetLanguage: z.string().min(2).max(8),
});

export const POST = withErrorHandling(async (request, context) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const { id } = await (context as { params: Promise<{ id: string }> }).params;
  const { targetLanguage } = bodySchema.parse(await parseJsonBody(request));

  // Master kill-switch upfront, so we don't enqueue an orphan job while
  // the orchestrator is paused (mirrors the rerun route).
  const site = await prisma.siteSetting.findUnique({
    where: { id: 'singleton' },
    select: { aiPipelineEnabled: true },
  });
  if (!site?.aiPipelineEnabled) {
    throw new ValidationError(
      'AI pipeline is currently disabled (SiteSetting.aiPipelineEnabled=false). Enable it in admin settings before adding a translation.',
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const recording = await tx.recording.findUnique({
      where: { id },
      select: { id: true, sourceLanguage: true },
    });
    if (!recording) throw new NotFoundError('Recording');

    const sourceLanguage = recording.sourceLanguage ?? 'it';
    if (targetLanguage === sourceLanguage) {
      throw new ValidationError(
        'La lingua di destinazione coincide con la lingua sorgente.',
      );
    }

    // Translation needs the source transcript as input.
    const transcript = await tx.postprodArtifact.findFirst({
      where: { recordingId: recording.id, type: 'TRANSCRIPT_JSON' },
      select: { id: true },
    });
    if (!transcript) {
      throw new ValidationError(
        'Trascrivi prima questa registrazione: manca il transcript sorgente.',
      );
    }

    return enqueueTranslateLanguage(tx, {
      recordingId: recording.id,
      targetLanguage,
    });
  });

  await logAdminAction({
    request,
    action: 'POSTPROD_TRANSLATE_ADD',
    target: id,
    details: {
      targetLanguage,
      enqueued: result.enqueued,
      dubEnqueued: result.dubEnqueued ?? false,
    },
  });

  return Response.json({ ok: true, targetLanguage, ...result });
});
