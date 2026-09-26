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

/**
 * I file che si possono caricare come materiale dell'evento, e quanto possono
 * pesare. Una sola regola per i due punti di caricamento: l'area admin
 * (`/api/admin/assets/upload-url?type=document`) e il pannello della sala
 * (`/api/events/[param]/materials/upload`). Un file accettato da una parte e
 * rifiutato dall'altra si scoprirebbe solo in diretta.
 *
 * Solo documenti: niente immagini SVG né archivi, e ogni tipo deve avere una
 * firma riconoscibile da `contentMatchesDeclaredMime` (lib/utils/mime-sniff),
 * che il server controlla sui byte veri.
 */
export const MATERIAL_FILE_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'text/plain',
] as const;

/** 25 MiB: il file passa dal server, che lo tiene in memoria per verificarlo. */
export const MATERIAL_FILE_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Quanti file, e quanti byte in tutto, un evento può avere fra i materiali
 * perché la sala ne accetti un altro. Il caricamento dalla sala si fa con il
 * link moderatore, che è condiviso e senza scadenza: se esce dalla sala, questo
 * è il tetto a ciò che chi lo trova può depositare nello storage e servire dal
 * dominio dell'ente. Un webinar ne usa una manciata; il tetto sta molto sopra.
 * Contano anche i file caricati dall'area admin, che però non ne è limitata.
 */
export const MATERIAL_FILES_PER_EVENT_MAX = 50;
export const MATERIAL_FILES_PER_EVENT_MAX_BYTES = 500 * 1024 * 1024;

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
