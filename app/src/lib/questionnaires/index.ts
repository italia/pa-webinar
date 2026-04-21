/**
 * Questionnaire domain helpers — fase A.
 *
 * Responsibilities:
 *   - Compose a "rendered" questionnaire (linked template items + ad-hoc
 *     items) in the correct display order.
 *   - Validate a submitted answer payload against the item types, so
 *     routes don't have to hand-roll per-type checks.
 *   - Persist a response with all its answers atomically.
 *
 * What lives **outside** this module: authentication, route shape, and
 * localization of error messages. Those are the caller's responsibility.
 */

import { Prisma, type QuestionItemType } from '@prisma/client';

import { prisma } from '@/lib/db';
import { AppError, ValidationError } from '@/lib/errors';
import type {
  QuestionnaireAnswerInput,
  QuestionItemInput,
} from '@/lib/validation/schemas';

export type RenderedItem = {
  id: string;
  prompt: Record<string, string>;
  type: QuestionItemType;
  options: Record<string, string>[] | null;
  scaleMin: number | null;
  scaleMax: number | null;
  scaleMinLabel: Record<string, string> | null;
  scaleMaxLabel: Record<string, string> | null;
  required: boolean;
  source: 'template' | 'adhoc';
  templateId: string | null;
};

export type RenderedQuestionnaire = {
  id: string;
  eventId: string;
  placement: 'PRE_REGISTRATION' | 'POST_EVENT';
  title: Record<string, string>;
  description: Record<string, string>;
  required: boolean;
  allowEdit: boolean;
  items: RenderedItem[];
};

/**
 * Load an EventQuestionnaire with all its items (from linked templates
 * and ad-hoc), flattened in display order.
 *
 * Display order:
 *   1. templates in QuestionnaireTemplateLink.sortOrder ascending
 *      → within each template: items by sortOrder ascending
 *   2. ad-hoc items by sortOrder ascending (always after templates)
 */
export async function loadRenderedQuestionnaire(
  id: string,
): Promise<RenderedQuestionnaire | null> {
  const q = await prisma.eventQuestionnaire.findUnique({
    where: { id },
    include: {
      templates: {
        orderBy: { sortOrder: 'asc' },
        include: {
          template: {
            include: {
              items: { orderBy: { sortOrder: 'asc' } },
            },
          },
        },
      },
      adhocItems: { orderBy: { sortOrder: 'asc' } },
    },
  });
  if (!q) return null;

  const items: RenderedItem[] = [];
  for (const link of q.templates) {
    for (const it of link.template.items) {
      items.push(toRenderedItem(it, 'template', link.template.id));
    }
  }
  for (const it of q.adhocItems) {
    items.push(toRenderedItem(it, 'adhoc', null));
  }

  return {
    id: q.id,
    eventId: q.eventId,
    placement: q.placement,
    title: (q.title ?? {}) as Record<string, string>,
    description: (q.description ?? {}) as Record<string, string>,
    required: q.required,
    allowEdit: q.allowEdit,
    items,
  };
}

function toRenderedItem(
  raw: {
    id: string;
    prompt: Prisma.JsonValue;
    type: QuestionItemType;
    options: Prisma.JsonValue | null;
    scaleMin: number | null;
    scaleMax: number | null;
    scaleMinLabel: Prisma.JsonValue | null;
    scaleMaxLabel: Prisma.JsonValue | null;
    required: boolean;
  },
  source: 'template' | 'adhoc',
  templateId: string | null,
): RenderedItem {
  return {
    id: raw.id,
    prompt: (raw.prompt ?? {}) as Record<string, string>,
    type: raw.type,
    options: raw.options as Record<string, string>[] | null,
    scaleMin: raw.scaleMin,
    scaleMax: raw.scaleMax,
    scaleMinLabel: raw.scaleMinLabel as Record<string, string> | null,
    scaleMaxLabel: raw.scaleMaxLabel as Record<string, string> | null,
    required: raw.required,
    source,
    templateId,
  };
}

/**
 * Find the questionnaire attached to an event at a given placement.
 * Returns null if not configured — the form UI then skips the section.
 */
export async function findEventQuestionnaireByPlacement(
  eventId: string,
  placement: 'PRE_REGISTRATION' | 'POST_EVENT',
): Promise<RenderedQuestionnaire | null> {
  const q = await prisma.eventQuestionnaire.findUnique({
    where: { eventId_placement: { eventId, placement } },
    select: { id: true },
  });
  if (!q) return null;
  return loadRenderedQuestionnaire(q.id);
}

/**
 * Validate a list of submitted answers against the rendered items.
 *
 * Throws ValidationError with per-item issues if anything is off. On
 * success returns a normalized array of Prisma.createMany payloads.
 */
export function validateAnswers(
  questionnaire: RenderedQuestionnaire,
  answers: QuestionnaireAnswerInput[],
): Array<{
  itemId: string;
  valueText: string | null;
  valueChoices: number[] | null;
  valueScale: number | null;
}> {
  const byId = new Map(questionnaire.items.map((i) => [i.id, i]));
  const submitted = new Map(answers.map((a) => [a.itemId, a]));
  const issues: Array<{ path: (string | number)[]; message: string }> = [];
  const normalized: ReturnType<typeof validateAnswers> = [];

  for (const it of questionnaire.items) {
    const ans = submitted.get(it.id);
    if (!ans) {
      if (it.required) {
        issues.push({
          path: ['answers', it.id],
          message: 'required answer missing',
        });
      }
      continue;
    }

    switch (it.type) {
      case 'OPEN_TEXT': {
        const text = ans.valueText?.trim() ?? '';
        if (it.required && text.length === 0) {
          issues.push({ path: ['answers', it.id, 'valueText'], message: 'required' });
          break;
        }
        if (text.length > 2000) {
          issues.push({
            path: ['answers', it.id, 'valueText'],
            message: 'text too long (max 2000)',
          });
          break;
        }
        normalized.push({ itemId: it.id, valueText: text || null, valueChoices: null, valueScale: null });
        break;
      }
      case 'SINGLE_CHOICE': {
        const choices = ans.valueChoices ?? [];
        if (choices.length !== 1) {
          issues.push({
            path: ['answers', it.id, 'valueChoices'],
            message: 'SINGLE_CHOICE requires exactly 1 choice',
          });
          break;
        }
        const idx = choices[0]!;
        const len = it.options?.length ?? 0;
        if (idx < 0 || idx >= len) {
          issues.push({ path: ['answers', it.id, 'valueChoices', 0], message: 'option out of range' });
          break;
        }
        normalized.push({ itemId: it.id, valueText: null, valueChoices: [idx], valueScale: null });
        break;
      }
      case 'MULTI_CHOICE': {
        const choices = ans.valueChoices ?? [];
        const len = it.options?.length ?? 0;
        if (it.required && choices.length === 0) {
          issues.push({ path: ['answers', it.id, 'valueChoices'], message: 'required' });
          break;
        }
        if (choices.some((c) => c < 0 || c >= len)) {
          issues.push({ path: ['answers', it.id, 'valueChoices'], message: 'option out of range' });
          break;
        }
        const unique = [...new Set(choices)].sort((a, b) => a - b);
        if (unique.length !== choices.length) {
          issues.push({ path: ['answers', it.id, 'valueChoices'], message: 'duplicate choices' });
          break;
        }
        normalized.push({ itemId: it.id, valueText: null, valueChoices: unique, valueScale: null });
        break;
      }
      case 'YES_NO': {
        const v = ans.valueScale;
        if (v !== 0 && v !== 1) {
          issues.push({ path: ['answers', it.id, 'valueScale'], message: 'YES_NO requires 0 or 1' });
          break;
        }
        normalized.push({ itemId: it.id, valueText: null, valueChoices: null, valueScale: v });
        break;
      }
      case 'LIKERT': {
        const min = it.scaleMin ?? 1;
        const max = it.scaleMax ?? 5;
        const v = ans.valueScale;
        if (v == null || v < min || v > max) {
          issues.push({
            path: ['answers', it.id, 'valueScale'],
            message: `LIKERT requires ${min}-${max}`,
          });
          break;
        }
        normalized.push({ itemId: it.id, valueText: null, valueChoices: null, valueScale: v });
        break;
      }
    }
  }

  // Reject answers to items not in the questionnaire (would hint at
  // stale clients or tampering).
  for (const a of answers) {
    if (!byId.has(a.itemId)) {
      issues.push({ path: ['answers', a.itemId], message: 'unknown item' });
    }
  }

  if (issues.length > 0) {
    throw new ValidationError('Questionnaire answers invalid', issues);
  }
  return normalized;
}

/**
 * Persist a response + its answers atomically. Idempotent: if the
 * respondent already submitted and `allowEdit` is true, we overwrite
 * their previous answers within the same transaction. If `allowEdit`
 * is false and a response exists, we throw a 409.
 */
export async function submitResponse(opts: {
  questionnaire: RenderedQuestionnaire;
  registrationId: string | null;
  guestId: string | null;
  respondentName: string | null;
  respondentEmailHash: string | null;
  answers: ReturnType<typeof validateAnswers>;
}): Promise<{ id: string; created: boolean }> {
  const { questionnaire, registrationId, guestId } = opts;
  if (!registrationId && !guestId) {
    throw new AppError('Respondent identity missing', 400, 'BAD_REQUEST');
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.questionnaireResponse.findFirst({
      where: {
        questionnaireId: questionnaire.id,
        ...(registrationId ? { registrationId } : { guestId }),
      },
    });

    if (existing && !questionnaire.allowEdit) {
      throw new AppError(
        'Response already submitted for this questionnaire',
        409,
        'ALREADY_SUBMITTED',
      );
    }

    const response = existing
      ? await tx.questionnaireResponse.update({
          where: { id: existing.id },
          data: {
            respondentName: opts.respondentName,
            respondentEmailHash: opts.respondentEmailHash,
          },
        })
      : await tx.questionnaireResponse.create({
          data: {
            questionnaireId: questionnaire.id,
            registrationId,
            guestId,
            respondentName: opts.respondentName,
            respondentEmailHash: opts.respondentEmailHash,
          },
        });

    if (existing) {
      await tx.questionnaireAnswer.deleteMany({ where: { responseId: response.id } });
    }

    if (opts.answers.length > 0) {
      await tx.questionnaireAnswer.createMany({
        data: opts.answers.map((a) => ({
          responseId: response.id,
          itemId: a.itemId,
          valueText: a.valueText,
          valueChoices: a.valueChoices ?? Prisma.JsonNull,
          valueScale: a.valueScale,
        })),
      });
    }

    return { id: response.id, created: !existing };
  });
}

/**
 * Shape Prisma nested-write for items when creating or updating a
 * QuestionTemplate. Handles: new items (no id), updated items (id
 * present), and deleted items (id in `existingIds` but not in `inputs`).
 */
export function shapeTemplateItemsWrite(
  inputs: QuestionItemInput[],
  existingIds: string[] = [],
): {
  create: Prisma.QuestionItemCreateWithoutTemplateInput[];
  update: Prisma.QuestionItemUpdateWithWhereUniqueWithoutTemplateInput[];
  deleteIds: string[];
} {
  const create: Prisma.QuestionItemCreateWithoutTemplateInput[] = [];
  const update: Prisma.QuestionItemUpdateWithWhereUniqueWithoutTemplateInput[] = [];
  const inputIds = new Set<string>();

  for (const input of inputs) {
    const data: Prisma.QuestionItemCreateWithoutTemplateInput = {
      prompt: input.prompt,
      type: input.type,
      options: input.options ?? Prisma.JsonNull,
      scaleMin: input.scaleMin ?? null,
      scaleMax: input.scaleMax ?? null,
      scaleMinLabel: input.scaleMinLabel ?? Prisma.JsonNull,
      scaleMaxLabel: input.scaleMaxLabel ?? Prisma.JsonNull,
      required: input.required,
      sortOrder: input.sortOrder,
    };
    if (input.id) {
      inputIds.add(input.id);
      update.push({ where: { id: input.id }, data });
    } else {
      create.push(data);
    }
  }

  const deleteIds = existingIds.filter((id) => !inputIds.has(id));
  return { create, update, deleteIds };
}
