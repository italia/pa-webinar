import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';

import { prisma } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { UnauthorizedError, ValidationError } from '@/lib/errors';

const templateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullish(),
  icon: z.string().max(50).optional(),
  qaEnabled: z.boolean().optional(),
  chatEnabled: z.boolean().optional(),
  recordingEnabled: z.boolean().optional(),
  autoStartRecording: z.boolean().optional(),
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
  sortOrder: z.number().int().optional(),
});

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
      ...result.data,
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
    data: result.data,
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
  if (existing.isSystem) {
    return NextResponse.json(
      { error: 'Cannot delete system templates' },
      { status: 403 },
    );
  }

  await prisma.eventTemplate.delete({ where: { id } });

  await logAdminAction({
    request,
    action: 'EVENT_TEMPLATE_DELETE',
    target: id,
  });

  return NextResponse.json({ success: true });
});
