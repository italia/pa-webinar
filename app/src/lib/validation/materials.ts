/**
 * Validation schemas for event materials (attachments).
 *
 * Shared between the public moderator-token API
 * (`/api/events/[param]/materials`) and the admin-session API
 * (`/api/admin/events/[id]/materials`). Keep these schemas in sync with
 * the `EventMaterial` Prisma model.
 */

import { z } from 'zod';

export const MATERIAL_TYPES = ['LINK', 'FILE'] as const;
export const MATERIAL_VISIBILITIES = ['ALWAYS', 'BEFORE', 'DURING', 'AFTER'] as const;

export type MaterialType = (typeof MATERIAL_TYPES)[number];
export type MaterialVisibility = (typeof MATERIAL_VISIBILITIES)[number];

export const materialBaseSchema = z.object({
  title: z.string().min(1).max(300),
  url: z.string().url(),
  description: z.string().max(500).nullable().optional(),
  type: z.enum(MATERIAL_TYPES).default('LINK'),
  fileName: z.string().max(500).nullable().optional(),
  // Prisma stores fileSize as BigInt; the JSON wire format is a number.
  // Keep the validation generous (up to ~Number.MAX_SAFE_INTEGER bytes)
  // and let the DB bound it.
  fileSize: z.number().int().nonnegative().nullable().optional(),
  mimeType: z.string().max(200).nullable().optional(),
  blobPath: z.string().max(1000).nullable().optional(),
  visibility: z.enum(MATERIAL_VISIBILITIES).default('ALWAYS'),
});

export const createMaterialAdminSchema = materialBaseSchema;
export const updateMaterialAdminSchema = materialBaseSchema.partial();

export type CreateMaterialAdminInput = z.infer<typeof createMaterialAdminSchema>;
export type UpdateMaterialAdminInput = z.infer<typeof updateMaterialAdminSchema>;
