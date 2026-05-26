/**
 * Per-placement questionnaire endpoints (admin only).
 *
 * GET    — full questionnaire at (event, placement) or 404 if not configured.
 * PUT    — upsert. Replaces templates + ad-hoc items wholesale. Refuses to
 *          edit once responses exist (admins must DELETE to reset) so
 *          respondents don't silently lose answers when items are removed.
 * DELETE — remove the questionnaire; cascades to responses and answers.
 */

import { cookies } from 'next/headers';

import { Prisma } from '@prisma/client';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError, UnauthorizedError, ValidationError } from '@/lib/errors';
import {
  upsertEventQuestionnaireSchema,
  QUESTIONNAIRE_PLACEMENTS,
  type UpsertEventQuestionnaireInput,
} from '@/lib/validation/schemas';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Placement = (typeof QUESTIONNAIRE_PLACEMENTS)[number];

function normalizePlacement(raw: string): Placement {
  if ((QUESTIONNAIRE_PLACEMENTS as readonly string[]).includes(raw)) {
    return raw as Placement;
  }
  throw new AppError(
    `placement must be one of: ${QUESTIONNAIRE_PLACEMENTS.join(', ')}`,
    400,
    'BAD_REQUEST',
  );
}

function adhocItemCreate(item: UpsertEventQuestionnaireInput['adhocItems'][number]) {
  return {
    prompt: item.prompt,
    type: item.type,
    options: item.options ?? Prisma.JsonNull,
    scaleMin: item.scaleMin ?? null,
    scaleMax: item.scaleMax ?? null,
    scaleMinLabel: item.scaleMinLabel ?? Prisma.JsonNull,
    scaleMaxLabel: item.scaleMaxLabel ?? Prisma.JsonNull,
    required: item.required,
    sortOrder: item.sortOrder,
  };
}

export const GET = withErrorHandling(async (_request, context) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const { id, placement: rawPlacement } = await context.params;
  if (!UUID_RE.test(id)) {
    throw new AppError('Event ID must be a UUID', 400, 'BAD_REQUEST');
  }
  const placement = normalizePlacement(rawPlacement);

  const q = await prisma.eventQuestionnaire.findUnique({
    where: { eventId_placement: { eventId: id, placement } },
    include: {
      templates: {
        orderBy: { sortOrder: 'asc' },
        include: { template: { select: { id: true, name: true } } },
      },
      adhocItems: { orderBy: { sortOrder: 'asc' } },
      _count: { select: { responses: true } },
    },
  });
  if (!q) throw new NotFoundError('EventQuestionnaire');

  return Response.json(
    {
      id: q.id,
      eventId: q.eventId,
      placement: q.placement,
      title: q.title,
      description: q.description,
      required: q.required,
      allowEdit: q.allowEdit,
      templates: q.templates.map((l) => ({
        id: l.template.id,
        name: l.template.name,
        sortOrder: l.sortOrder,
      })),
      adhocItems: q.adhocItems,
      responseCount: q._count.responses,
      createdAt: q.createdAt.toISOString(),
      updatedAt: q.updatedAt.toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});

export const PUT = withErrorHandling(async (request, context) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const { id, placement: rawPlacement } = await context.params;
  if (!UUID_RE.test(id)) {
    throw new AppError('Event ID must be a UUID', 400, 'BAD_REQUEST');
  }
  const placement = normalizePlacement(rawPlacement);

  const body = await parseJsonBody(request);
  const parsed = upsertEventQuestionnaireSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }
  const data = parsed.data;

  if (data.placement !== placement) {
    throw new AppError('placement in body must match URL', 400, 'BAD_REQUEST');
  }

  const event = await prisma.event.findUnique({ where: { id }, select: { id: true } });
  if (!event) throw new NotFoundError('Event');

  if (data.templateIds.length > 0) {
    const found = await prisma.questionTemplate.count({
      where: { id: { in: data.templateIds } },
    });
    if (found !== data.templateIds.length) {
      throw new AppError('One or more template IDs do not exist', 400, 'BAD_REQUEST');
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.eventQuestionnaire.findUnique({
      where: { eventId_placement: { eventId: id, placement } },
      include: { _count: { select: { responses: true } } },
    });

    if (existing && existing._count.responses > 0) {
      throw new AppError(
        'Cannot modify a questionnaire with submitted responses. Delete it first to reset.',
        409,
        'QUESTIONNAIRE_IN_USE',
      );
    }

    const templatesCreate = data.templateIds.map((tid, i) => ({
      templateId: tid,
      sortOrder: i,
    }));
    const adhocCreate = data.adhocItems.map(adhocItemCreate);

    if (existing) {
      await tx.questionnaireTemplateLink.deleteMany({
        where: { questionnaireId: existing.id },
      });
      await tx.questionItem.deleteMany({
        where: { questionnaireId: existing.id },
      });
      return tx.eventQuestionnaire.update({
        where: { id: existing.id },
        data: {
          title: data.title,
          description: data.description,
          required: data.required,
          allowEdit: data.allowEdit,
          ...(templatesCreate.length > 0 && { templates: { create: templatesCreate } }),
          ...(adhocCreate.length > 0 && { adhocItems: { create: adhocCreate } }),
        },
        include: {
          templates: {
            orderBy: { sortOrder: 'asc' },
            include: { template: { select: { id: true, name: true } } },
          },
          adhocItems: { orderBy: { sortOrder: 'asc' } },
        },
      });
    }

    return tx.eventQuestionnaire.create({
      data: {
        eventId: id,
        placement,
        title: data.title,
        description: data.description,
        required: data.required,
        allowEdit: data.allowEdit,
        ...(templatesCreate.length > 0 && { templates: { create: templatesCreate } }),
        ...(adhocCreate.length > 0 && { adhocItems: { create: adhocCreate } }),
      },
      include: {
        templates: {
          orderBy: { sortOrder: 'asc' },
          include: { template: { select: { id: true, name: true } } },
        },
        adhocItems: { orderBy: { sortOrder: 'asc' } },
      },
    });
  });

  await logAdminAction({
    request,
    action: 'EVENT_QUESTIONNAIRE_UPSERT',
    target: result.id,
    details: { eventId: id, placement },
  });

  return Response.json(result);
});

export const DELETE = withErrorHandling(async (request, context) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const { id, placement: rawPlacement } = await context.params;
  if (!UUID_RE.test(id)) {
    throw new AppError('Event ID must be a UUID', 400, 'BAD_REQUEST');
  }
  const placement = normalizePlacement(rawPlacement);

  const q = await prisma.eventQuestionnaire.findUnique({
    where: { eventId_placement: { eventId: id, placement } },
    select: { id: true, _count: { select: { responses: true } } },
  });
  if (!q) throw new NotFoundError('EventQuestionnaire');

  await prisma.eventQuestionnaire.delete({ where: { id: q.id } });

  await logAdminAction({
    request,
    action: 'EVENT_QUESTIONNAIRE_DELETE',
    target: q.id,
    details: { eventId: id, placement, deletedResponses: q._count.responses },
  });

  return Response.json({
    deleted: true,
    deletedResponses: q._count.responses,
  });
});
