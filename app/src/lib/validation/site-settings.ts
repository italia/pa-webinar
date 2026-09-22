/**
 * Cosa il pannello puo' scrivere nelle impostazioni del sito.
 *
 * Vive fuori dalla rotta per una ragione precisa: un file di rotta non puo'
 * esportare altro che i propri gestori, e uno schema che nessuno puo'
 * importare e' uno schema che nessun presidio puo' confrontare con il modello
 * dati. E' cosi' che un elenco chiuso resta indietro rispetto allo schema —
 * l'opzione compare nel pannello e il salvataggio la rifiuta.
 */
import { z } from 'zod';

import { HomePageMode } from '@prisma/client';

export const updateSettingsSchema = z.object({
  siteName: z.string().min(1).max(200).optional(),
  siteDescription: z.string().max(2000).optional(),
  organizationName: z.string().max(200).optional(),
  organizationNameShort: z.string().max(100).optional(),
  organizationUrl: z.string().url().or(z.literal('')).optional(),
  parentOrganization: z.string().max(200).optional(),
  parentOrganizationUrl: z.string().url().or(z.literal('')).optional(),
  logoUrl: z.string().url().nullish(),
  faviconUrl: z.string().url().nullish(),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  seoTitle: z.string().max(200).optional(),
  seoDescription: z.string().max(2000).optional(),
  seoImage: z.string().url().nullish(),
  // Derivato dall'enum del modello, non riscritto a mano: aggiungere un
  // impianto di home allo schema dati e dimenticarlo qui significa
  // un'opzione che il pannello mostra e il salvataggio rifiuta — e con lo
  // schema in modalita' stretta a cadere e' l'intero salvataggio, non solo
  // quel campo. Un presidio lo verifica (`route.test.ts`).
  homePageMode: z.nativeEnum(HomePageMode).optional(),
  waitingRoomEngine: z.enum(['GARDEN', 'GAME', 'CLASSIC']).optional(),
  customHomeHtml: z.string().max(50000).nullish(),
  footerLinks: z.array(z.object({
    title: z.string().max(100),
    url: z.string().max(500),
    section: z.enum(['main', 'legal']).optional(),
  })).max(20).optional(),
  privacyPolicy: z.record(z.string(), z.string().max(100000)).optional(),
  accessibility: z.record(z.string(), z.string().max(100000)).optional(),
  defaultLocale: z.string().min(2).max(5).optional(),
  defaultTimezone: z.string().min(1).max(64).optional(),
  statusPageEnabled: z.boolean().optional(),
  guestAccessEnabled: z.boolean().optional(),
  publicRegistrationEnabled: z.boolean().optional(),
  calendarPublic: z.boolean().optional(),
  parseTitleKicker: z.boolean().optional(),
  jitsiWatermarkUrl: z.string().url().nullish(),
  jitsiWatermarkEnabled: z.boolean().optional(),
  jitsiWatermarkOpacity: z.number().min(0).max(1).optional(),
  jitsiWatermarkPosition: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']).optional(),
  videoQuality: z.enum(['SAVE_DATA', 'BALANCED', 'HIGH', 'MAX']).optional(),
  // Anteprima dei link condivisi: cosa entra nella scheda generata.
  ogCardEnabled: z.boolean().optional(),
  ogShowPoster: z.boolean().optional(),
  ogShowDate: z.boolean().optional(),
  ogShowSpeakers: z.boolean().optional(),
  ogShowOrganization: z.boolean().optional(),
  githubUrl: z.string().url().nullish(),
  supportEmail: z.string().email().nullish(),
  // Nome mittente mostrato in posta; stringa vuota = torna al default.
  gravatarEnabled: z.boolean().optional(),
  emailFromName: z.string().max(100).nullish(),
  emailReplyTo: z.string().email().nullish(),
  availableLocales: z.array(z.string().min(2).max(5)).optional(),
  localeNames: z.record(z.string().min(2).max(5), z.string().max(50)).optional(),
  translationOverrides: z.record(z.string(), z.record(z.string(), z.string())).optional(),
  jvbInactiveGraceMinutes: z.number().int().min(5).max(240).optional(),
  jvbPreScaleMinutes: z.number().int().min(1).max(60).optional(),
  jvbEmptyCloseMinutes: z.number().int().min(-1).max(240).optional(),
  waitingRoomLeadMinutes: z.number().int().min(0).max(1440).optional(),
  reactionsMode: z.enum(['NATIVE', 'CUSTOM']).optional(),
  jvbStressWarnPercent: z.number().int().min(0).max(100).optional(),
  jvbStressCriticalPercent: z.number().int().min(0).max(100).optional(),
  jvbProvisioningTimeoutMinutes: z.number().int().min(1).max(120).optional(),
  statusPollIntervalSeconds: z.number().int().min(5).max(600).optional(),
  // Per-cluster JVB/Jibri sizing — see docs/CONFIGURATION.md "Scaling".
  jvbCpuCoresPerPod: z.number().int().min(1).max(128).optional(),
  jvbReceiversPerCore: z.number().min(0.1).max(100).optional(),
  jvbSendersPerCore: z.number().min(0.1).max(100).optional(),
  jvbMaxReplicas: z.number().int().min(1).max(50).optional(),
  jibriCpuCoresPerPod: z.number().int().min(1).max(32).optional(),
  defaultSenderRatioPct: z.number().int().min(0).max(100).optional(),
  // Soft-exit grace window applied to LIVE events past endsAt.
  eventGracePeriodMinutes: z.number().int().min(-1).max(240).optional(),
  orphanRecordingGraceDays: z.number().int().min(0).max(365).optional(),
  // ── Postprod AI pipeline ──────────────────────────────────────
  // Kill-switch + provider routing. I provider sono limitati al
  // sottoinsieme "in-cluster" supportato — vedi lib/ai/providers.ts.
  aiPipelineEnabled: z.boolean().optional(),
  aiLlmProvider: z.enum(['vllm']).optional(),
  aiAsrProvider: z.enum(['whisperx']).optional(),
  aiTtsEngine: z.enum(['piper']).optional(),
  // Comma-separated ISO-639-1, gestito come stringa per coerenza
  // con la colonna `text` in DB (parsing fatto in lib/ai/providers).
  aiDefaultTargetLocales: z.string().max(200).optional(),
  aiMaxConcurrentJobs: z.number().int().min(1).max(20).optional(),
  aiJobMaxAttempts: z.number().int().min(1).max(20).optional(),
  aiArtifactRetentionDays: z.number().int().min(0).max(3650).optional(),
  aiConsentDisclosure: z.record(z.string(), z.string().max(2000)).optional(),
}).strict();
