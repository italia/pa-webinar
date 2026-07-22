/**
 * What `GET /api/admin/settings` may return to a caller who is NOT an admin.
 *
 * That route is served to anonymous clients (the public site reads its branding
 * from it) AND cached with `Cache-Control: public, s-maxage=300`, so anything
 * left in the payload is world-readable and scrapeable. The projection used to
 * be a one-field blacklist — `const { customHomeHtml, ...rest } = settings` —
 * which means every column added afterwards became public by default. That is
 * how `emailReplyTo`, a staffed mailbox an operator types in precisely because
 * the From address is a no-reply, would have been published.
 *
 * The lists below are exhaustive over the model and enforced by a test against
 * Prisma's own schema: a new column that nobody classifies fails the suite
 * instead of silently going public.
 */

/** Columns withheld from non-admin callers, each with the reason. */
export const NON_PUBLIC_SETTING_FIELDS: Record<string, string> = {
  customHomeHtml:
    'operator-authored HTML for the home page; not needed by any public consumer',
  emailReplyTo:
    'a real, usually staffed mailbox — publishing it hands it to scrapers, and it is only ever needed server-side when sending',
};

/**
 * Columns reviewed as safe to serve publicly. Most are branding, copy or
 * client-side behaviour the public pages genuinely need; the scaling and AI
 * numbers are operational parameters that reveal nothing about a person and are
 * already visible on the public status page.
 */
export const PUBLIC_SETTING_FIELDS = [
  'id', 'siteName', 'siteDescription',
  'organizationName', 'organizationNameShort', 'organizationUrl',
  'parentOrganization', 'parentOrganizationUrl',
  'logoUrl', 'faviconUrl', 'primaryColor', 'defaultTimezone',
  'seoTitle', 'seoDescription', 'seoImage',
  'homePageMode', 'footerLinks', 'privacyPolicy', 'accessibility',
  'statusPageEnabled', 'guestAccessEnabled', 'publicRegistrationEnabled',
  'calendarPublic', 'parseTitleKicker', 'waitingRoomEngine',
  'jitsiWatermarkUrl', 'jitsiWatermarkEnabled', 'jitsiWatermarkOpacity',
  'jitsiWatermarkPosition', 'videoQuality',
  // Contact points the site publishes on purpose.
  'githubUrl', 'supportEmail',
  // The sender NAME appears in every message we send: it is public by nature.
  'emailFromName',
  'defaultLocale', 'availableLocales', 'localeNames', 'translationOverrides',
  'jvbInactiveGraceMinutes', 'jvbPreScaleMinutes', 'waitingRoomLeadMinutes',
  'jvbEmptyCloseMinutes', 'reactionsMode',
  'jvbStressWarnPercent', 'jvbStressCriticalPercent',
  'jvbProvisioningTimeoutMinutes', 'statusPollIntervalSeconds',
  'orphanRecordingGraceDays',
  'jvbCpuCoresPerPod', 'jvbReceiversPerCore', 'jvbSendersPerCore',
  'jvbMaxReplicas', 'jibriCpuCoresPerPod', 'defaultSenderRatioPct',
  'eventGracePeriodMinutes',
  'aiPipelineEnabled', 'aiDefaultTargetLocales', 'aiLlmProvider',
  'aiAsrProvider', 'aiTtsEngine', 'aiMaxConcurrentJobs', 'aiJobMaxAttempts',
  'aiArtifactRetentionDays', 'aiConsentDisclosure',
  'updatedAt',
] as const;

/** Strip the non-public columns from a settings row. */
export function publicSettings<T extends Record<string, unknown>>(
  settings: T,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (key in NON_PUBLIC_SETTING_FIELDS) continue;
    out[key] = value;
  }
  return out;
}
