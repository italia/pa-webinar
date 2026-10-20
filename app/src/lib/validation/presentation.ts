import { z } from 'zod';

import { SLIDE_OFFSET_MAX_SEC } from '@/lib/presentation/recording-slides';
import { PRESENTATION_PAGE_MAX } from '@/lib/presentation/types';

const pagina = z.number().int().min(1).max(PRESENTATION_PAGE_MAX);

/** POST /api/events/[param]/presentation: presenta questo materiale, da questa pagina. */
export const startPresentationSchema = z.object({
  materialId: z.string().uuid(),
  page: pagina.optional(),
});

/**
 * PATCH /api/events/[param]/presentation: vai a questa pagina. Il materiale è
 * quello che il chiamante crede presentato: se nel frattempo un altro ne ha
 * presentato uno diverso, o ha chiuso, il cambio di pagina non vale (409) e
 * non sposta il documento di qualcun altro. `pageCount` lo manda il browser
 * di chi presenta, che il documento l'ha aperto.
 */
export const movePresentationSchema = z.object({
  materialId: z.string().uuid(),
  page: pagina,
  pageCount: pagina.optional(),
});

/** DELETE /api/events/[param]/presentation?materialId=…: il materiale da chiudere, se lo si indica. */
export const stopPresentationQuerySchema = z.object({
  materialId: z.string().uuid().optional(),
});

/** GET /api/events/[param]/presentation/file?m=…: il materiale presentato. */
export const presentationFileQuerySchema = z.object({
  m: z.string().uuid(),
});

/**
 * GET /api/events/[param]/recording/slides?m=… e
 * GET /api/admin/postprod/recordings/[id]/slides/file?m=…: il materiale di una
 * slide accanto alla registrazione.
 */
export const recordingSlidesFileQuerySchema = z.object({
  m: z.string().uuid(),
});

/**
 * PATCH /api/admin/postprod/recordings/[id]/slides: se mostrare le slide
 * accanto al video e lo scarto, in secondi interi, dei cambi di slide sul
 * video (positivo più tardi, negativo prima).
 */
export const recordingSlidesSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    offsetSec: z
      .number()
      .int()
      .min(-SLIDE_OFFSET_MAX_SEC)
      .max(SLIDE_OFFSET_MAX_SEC)
      .optional(),
  })
  .strict()
  .refine((v) => v.enabled !== undefined || v.offsetSec !== undefined, {
    message: 'Nothing to change',
  });
