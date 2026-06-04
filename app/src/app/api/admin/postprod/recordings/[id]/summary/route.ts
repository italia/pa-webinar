/**
 * GET/PUT /api/admin/postprod/recordings/[id]/summary
 *
 * Editing admin della SINTESI AI del video (finora completamente assente).
 *
 *   GET — ritorna, per lingua, il markdown della sintesi (SUMMARY_MD per
 *         la lingua sorgente, TRANSLATION_MD per le tradotte) e la
 *         versione strutturata (SUMMARY_JSON: overall_summary,
 *         key_decisions[], action_items[], topics[{title,start_mmss,
 *         summary}]) che alimenta la hero post-evento.
 *
 *   PUT — aggiorna md e/o structured per una lingua: riscrive l'inlineBody
 *         cifrato + content_hash + size dell'artifact giusto. Audit log.
 *
 * Auth: sessione admin.
 */

import { z } from 'zod';
import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { prisma } from '@/lib/db';
import { NotFoundError, UnauthorizedError, ValidationError } from '@/lib/errors';
import { encryptPII, tryDecryptPII } from '@/lib/crypto/pii';
import { sha256Hex } from '@/lib/ai/transcript-format';

export const dynamic = 'force-dynamic';

async function loadRecording(id: string) {
  return prisma.recording.findUnique({
    where: { id },
    select: {
      id: true,
      sourceLanguage: true,
      artifacts: {
        where: { type: { in: ['SUMMARY_MD', 'TRANSLATION_MD', 'SUMMARY_JSON'] } },
        select: { id: true, type: true, language: true, inlineBody: true },
      },
    },
  });
}

export const GET = withErrorHandling(async (_request, context) => {
  if (!(await isAdminAuthenticated(await cookies()))) throw new UnauthorizedError();
  const { id } = await (context as { params: Promise<{ id: string }> }).params;

  const recording = await loadRecording(id);
  if (!recording) throw new NotFoundError('Recording');

  // Raggruppa per lingua: { md, structured }.
  const byLang: Record<string, { md: string | null; structured: unknown | null }> = {};
  for (const a of recording.artifacts) {
    if (!a.language || !a.inlineBody) continue;
    const decoded = tryDecryptPII(a.inlineBody);
    if (!decoded) continue;
    byLang[a.language] ??= { md: null, structured: null };
    if (a.type === 'SUMMARY_MD' || a.type === 'TRANSLATION_MD') {
      byLang[a.language]!.md = decoded;
    } else if (a.type === 'SUMMARY_JSON') {
      try {
        byLang[a.language]!.structured = JSON.parse(decoded);
      } catch {
        /* payload corrotto: lascia null */
      }
    }
  }

  return Response.json({
    recordingId: recording.id,
    sourceLanguage: recording.sourceLanguage ?? 'it',
    languages: Object.keys(byLang).sort(),
    summaries: byLang,
  });
});

const structuredSchema = z
  .object({
    overall_summary: z.string().max(20_000).optional(),
    key_decisions: z.array(z.string().max(2_000)).max(100).optional(),
    action_items: z.array(z.string().max(2_000)).max(100).optional(),
    topics: z
      .array(
        z.object({
          title: z.string().max(500).optional(),
          start_mmss: z.string().max(12).optional(),
          summary: z.string().max(5_000).optional(),
        }),
      )
      .max(200)
      .optional(),
  })
  .passthrough();

const bodySchema = z
  .object({
    language: z.string().min(2).max(8),
    md: z.string().max(100_000).optional(),
    structured: structuredSchema.optional(),
  })
  .refine((b) => b.md !== undefined || b.structured !== undefined, {
    message: 'Provide md and/or structured',
  });

export const PUT = withErrorHandling(async (request, context) => {
  if (!(await isAdminAuthenticated(await cookies()))) throw new UnauthorizedError();
  const { id } = await (context as { params: Promise<{ id: string }> }).params;
  const body = bodySchema.parse(await request.json());

  const recording = await loadRecording(id);
  if (!recording) throw new NotFoundError('Recording');

  const isSource = body.language === (recording.sourceLanguage ?? 'it');
  // Il markdown vive in SUMMARY_MD per la lingua sorgente, in
  // TRANSLATION_MD per le tradotte. Lo structured è SUMMARY_JSON.
  const mdType = isSource ? 'SUMMARY_MD' : 'TRANSLATION_MD';

  const updates: Array<{ artifactId: string; body: string }> = [];

  if (body.md !== undefined) {
    const art = recording.artifacts.find(
      (a) => a.type === mdType && a.language === body.language,
    );
    if (!art) {
      throw new ValidationError(
        `Nessun artifact ${mdType} per la lingua ${body.language} (rigenera la pipeline prima)`,
      );
    }
    updates.push({ artifactId: art.id, body: body.md });
  }

  if (body.structured !== undefined) {
    const art = recording.artifacts.find(
      (a) => a.type === 'SUMMARY_JSON' && a.language === body.language,
    );
    if (!art) {
      throw new ValidationError(
        `Nessun artifact SUMMARY_JSON per la lingua ${body.language}`,
      );
    }
    updates.push({ artifactId: art.id, body: JSON.stringify(body.structured) });
  }

  await prisma.$transaction(async (tx) => {
    for (const u of updates) {
      await tx.postprodArtifact.update({
        where: { id: u.artifactId },
        data: {
          inlineBody: encryptPII(u.body),
          contentHash: sha256Hex(u.body),
          sizeBytes: BigInt(Buffer.byteLength(u.body, 'utf8')),
        },
      });
    }
  });

  await logAdminAction({
    request,
    action: 'POSTPROD_SUMMARY_EDIT',
    target: id,
    details: { language: body.language, md: body.md !== undefined, structured: body.structured !== undefined },
  });

  return Response.json({ ok: true, language: body.language, updated: updates.length });
});
