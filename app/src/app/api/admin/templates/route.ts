import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { UnauthorizedError, ValidationError } from '@/lib/errors';
import { coerceMatrix } from '@/lib/utils/permission-matrix';

const templateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullish(),
  icon: z.string().max(50).optional(),
  qaEnabled: z.boolean().optional(),
  chatEnabled: z.boolean().optional(),
  recordingEnabled: z.boolean().optional(),
  autoStartRecording: z.boolean().optional(),
  agendaEnabled: z.boolean().optional(),
  whiteboardEnabled: z.boolean().optional(),
  // Motore sala d'attesa pre-popolato nel wizard. null = default sito.
  waitingRoomEngine: z.enum(['GARDEN', 'GAME', 'CLASSIC']).nullish(),
  participantsCanUnmute: z.boolean().optional(),
  participantsCanStartVideo: z.boolean().optional(),
  participantsCanShareScreen: z.boolean().optional(),
  maxParticipants: z.number().int().min(2).max(500).optional(),
  // Default wizard (semplificazione utenti meno esperti): pre-popolano i
  // campi alla creazione, restano modificabili.
  defaultDurationMinutes: z.number().int().min(5).max(1440).nullish(),
  aiTranscriptEnabled: z.boolean().optional(),
  aiSummaryEnabled: z.boolean().optional(),
  aiTranslationEnabled: z.boolean().optional(),
  descriptionTemplate: z.record(z.string()).nullish(),
  defaultRetentionDays: z.number().int().min(1).max(3650).nullish(),
  defaultExpectedSpeakers: z.number().int().min(1).max(30).nullish(),
  // Role×feature permission matrix (see lib/utils/permission-matrix.ts).
  // Optional; when set it pre-seeds step 2 of the wizard directly. When
  // absent, the wizard projects the boolean toggles above into a matrix.
  permissionMatrix: z.record(z.string(), z.array(z.string())).nullish(),
  sortOrder: z.number().int().optional(),
});

/**
 * Normalizza il campo JSON nullable `descriptionTemplate` per Prisma:
 * un `null` esplicito (cancellazione) va espresso come `Prisma.DbNull`,
 * non come `null` raw. `undefined` lascia il campo invariato.
 */
function toTemplateData<
  T extends {
    descriptionTemplate?: Record<string, string> | null;
    permissionMatrix?: Record<string, string[]> | null;
  },
>(d: T) {
  const { descriptionTemplate, permissionMatrix, ...rest } = d;
  return {
    ...rest,
    ...(descriptionTemplate !== undefined && {
      descriptionTemplate:
        descriptionTemplate === null ? Prisma.DbNull : descriptionTemplate,
    }),
    // Coerce to a valid matrix (drops unknown keys/roles, clamps the
    // moderator invariant). An explicit null clears the column.
    ...(permissionMatrix !== undefined && {
      permissionMatrix:
        permissionMatrix === null
          ? Prisma.DbNull
          : (coerceMatrix(permissionMatrix) ?? Prisma.DbNull),
    }),
  };
}

export const GET = withErrorHandling(async () => {
  const templates = await prisma.eventTemplate.findMany({
    orderBy: { sortOrder: 'asc' },
  });
  return NextResponse.json(templates);
});

export const POST = withErrorHandling(async (request: NextRequest) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const body = await parseJsonBody(request);
  const result = templateSchema.safeParse(body);
  if (!result.success) {
    throw new ValidationError(
      result.error.issues.map((i) => i.message).join(', '),
    );
  }

  const maxOrder = await prisma.eventTemplate.aggregate({
    _max: { sortOrder: true },
  });

  const template = await prisma.eventTemplate.create({
    data: {
      ...toTemplateData(result.data),
      sortOrder: result.data.sortOrder ?? (maxOrder._max.sortOrder ?? 0) + 1,
    },
  });

  await logAdminAction({
    request,
    action: 'EVENT_TEMPLATE_CREATE',
    target: template.id,
  });

  return NextResponse.json(template, { status: 201 });
});

export const PUT = withErrorHandling(async (request: NextRequest) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const body = await parseJsonBody(request);
  const { id, ...data } = body as { id: string } & Record<string, unknown>;

  if (!id) throw new ValidationError('Missing template id');

  const existing = await prisma.eventTemplate.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  const result = templateSchema.partial().safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      result.error.issues.map((i) => i.message).join(', '),
    );
  }

  const updated = await prisma.eventTemplate.update({
    where: { id },
    data: toTemplateData(result.data),
  });

  await logAdminAction({
    request,
    action: 'EVENT_TEMPLATE_UPDATE',
    target: updated.id,
    details: { fields: Object.keys(result.data) },
  });

  return NextResponse.json(updated);
});

export const DELETE = withErrorHandling(async (request: NextRequest) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) throw new ValidationError('Missing template id');

  const existing = await prisma.eventTemplate.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }
  // System (seeded) templates are deletable too: an admin curating the
  // template list for their PA must be able to remove the generic demos.
  // Deleting a template is non-destructive to existing events (events copy
  // the template's values at creation; they don't reference it afterwards).
  // Note: on local dev the seed re-creates the system templates; test/prod
  // run `migrate deploy` only, so the deletion persists there.
  await prisma.eventTemplate.delete({ where: { id } });

  await logAdminAction({
    request,
    action: 'EVENT_TEMPLATE_DELETE',
    target: id,
  });

  return NextResponse.json({ success: true });
});
