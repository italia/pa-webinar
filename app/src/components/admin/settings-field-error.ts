/**
 * Da un salvataggio delle impostazioni rifiutato (422) al campo da
 * correggere: in quale scheda sta, quale elemento prende il fuoco e che cosa
 * dire. Fuori dal componente perché si possa verificare da solo.
 *
 * Il server descrive ogni problema con il percorso del campo e il tipo di
 * controllo fallito (lib/validation/site-settings, rotta api/admin/settings).
 */

export type SettingsTab =
  | 'branding'
  | 'header'
  | 'seo'
  | 'homepage'
  | 'pages'
  | 'footer'
  | 'features'
  | 'scaling'
  | 'postprod';

export interface SettingsIssue {
  path: (string | number)[];
  code?: string;
  validation?: string;
  type?: string;
  minimum?: number;
  maximum?: number;
}

export type SettingsFieldProblem = 'required' | 'url' | 'email' | 'tooLong' | 'min' | 'max' | 'invalid';

export interface SettingsFieldError {
  /** Il campo delle impostazioni: correggerlo toglie l'errore. */
  field: string;
  tab: SettingsTab;
  /** L'id dell'elemento del modulo (o il prefisso, per i campi file-o-indirizzo). */
  inputId: string;
  /** La lingua del valore, per i campi tradotti che mostrano una lingua per volta. */
  locale?: string;
  problem: SettingsFieldProblem;
  limit?: number;
}

/** Dove sta ogni campo: la scheda e l'id dell'elemento nel modulo. */
const POSTO: Record<string, [SettingsTab, string]> = {
  siteName: ['branding', 'siteName'],
  primaryColor: ['branding', 'primaryColor'],
  defaultTimezone: ['branding', 'defaultTimezone'],
  waitingRoomEngine: ['branding', 'waitingRoomEngine'],
  siteDescription: ['branding', 'siteDescription'],
  organizationName: ['branding', 'organizationName'],
  organizationNameShort: ['branding', 'organizationNameShort'],
  organizationUrl: ['branding', 'organizationUrl'],
  parentOrganization: ['branding', 'parentOrganization'],
  parentOrganizationUrl: ['branding', 'parentOrganizationUrl'],
  logoUrl: ['branding', 'logoUrl'],
  faviconUrl: ['branding', 'faviconUrl'],
  jitsiWatermarkUrl: ['branding', 'jitsiWatermarkUrl'],
  jitsiWatermarkOpacity: ['branding', 'jitsiWatermarkOpacity'],
  jitsiWatermarkPosition: ['branding', 'jitsiWatermarkPosition'],
  seoTitle: ['seo', 'seoTitle'],
  seoDescription: ['seo', 'seoDescription'],
  seoImage: ['seo', 'seoImage'],
  homeShowProject: ['homepage', 'home-show-project'],
  customHomeHtml: ['homepage', 'customHomeHtml'],
  siteTagline: ['header', 'hdr-tagline'],
  githubUrl: ['features', 'githubUrl'],
  supportEmail: ['features', 'supportEmail'],
  gravatarEnabled: ['features', 'gravatarEnabled'],
  liveCaptionsEnabled: ['features', 'liveCaptionsEnabled'],
  emailFromName: ['features', 'emailFromName'],
  emailReplyTo: ['features', 'emailReplyTo'],
  jvbInactiveGraceMinutes: ['features', 'jvbInactiveGraceMinutes'],
  jvbPreScaleMinutes: ['features', 'jvbPreScaleMinutes'],
  jvbEmptyCloseMinutes: ['features', 'jvbEmptyCloseMinutes'],
  waitingRoomLeadMinutes: ['features', 'waitingRoomLeadMinutes'],
  reactionsMode: ['features', 'reactionsMode'],
  jvbStressWarnPercent: ['features', 'jvbStressWarnPercent'],
  jvbStressCriticalPercent: ['features', 'jvbStressCriticalPercent'],
  jvbProvisioningTimeoutMinutes: ['features', 'jvbProvisioningTimeoutMinutes'],
  statusPollIntervalSeconds: ['features', 'statusPollIntervalSeconds'],
  videoQuality: ['scaling', 'videoQuality'],
  jvbCpuCoresPerPod: ['scaling', 'jvbCpuCoresPerPod'],
  jvbReceiversPerCore: ['scaling', 'jvbReceiversPerCore'],
  jvbSendersPerCore: ['scaling', 'jvbSendersPerCore'],
  jvbMaxReplicas: ['scaling', 'jvbMaxReplicas'],
  jibriCpuCoresPerPod: ['scaling', 'jibriCpuCoresPerPod'],
  defaultSenderRatioPct: ['scaling', 'defaultSenderRatioPct'],
  eventGracePeriodMinutes: ['scaling', 'eventGracePeriodMinutes'],
  eventOvertimeEmptyMinutes: ['scaling', 'eventOvertimeEmptyMinutes'],
  aiAsrProvider: ['postprod', 'aiAsrProvider'],
  aiLlmProvider: ['postprod', 'aiLlmProvider'],
  aiTtsEngine: ['postprod', 'aiTtsEngine'],
  aiDefaultTargetLocales: ['postprod', 'aiDefaultTargetLocales'],
  aiMaxConcurrentJobs: ['postprod', 'aiMaxConcurrentJobs'],
  aiJobMaxAttempts: ['postprod', 'aiJobMaxAttempts'],
  aiArtifactRetentionDays: ['postprod', 'aiArtifactRetentionDays'],
};

/**
 * I testi legali: la scheda Pagine ha un campo per l'italiano e uno per
 * l'inglese. Un errore in un'altra lingua non ha un campo nel modulo.
 */
const PER_LINGUA: Record<string, string> = {
  privacyPolicy: 'privacy',
  accessibility: 'accessibility',
};
const LINGUE_DEI_TESTI_LEGALI: Record<string, string> = { it: 'It', en: 'En' };

/** Le lingue dell'informativa sull'AI che la scheda mostra, una per campo. */
const LINGUE_INFORMATIVA_AI = new Set(['it', 'en', 'fr']);

function dove(path: (string | number)[]): Omit<SettingsFieldError, 'problem' | 'limit'> | null {
  const [campo, secondo, terzo] = path;
  if (typeof campo !== 'string') return null;
  if (campo === 'footerLinks') {
    // ['footerLinks', i, 'url'|'title'|'section']: il campo di quel link.
    if (typeof secondo === 'number' && typeof terzo === 'string') {
      return { field: campo, tab: 'footer', inputId: `link-${terzo}-${secondo}` };
    }
    return { field: campo, tab: 'footer', inputId: 'link-url-0' };
  }
  if (PER_LINGUA[campo]) {
    const lingua = typeof secondo === 'string' ? LINGUE_DEI_TESTI_LEGALI[secondo] : undefined;
    return lingua ? { field: campo, tab: 'pages', inputId: `${PER_LINGUA[campo]}${lingua}` } : null;
  }
  if (campo === 'aiConsentDisclosure') {
    return typeof secondo === 'string' && LINGUE_INFORMATIVA_AI.has(secondo)
      ? { field: campo, tab: 'postprod', inputId: `aiConsentDisclosure-${secondo}` }
      : null;
  }
  if (campo === 'siteTagline') {
    // Un campo solo, con la scelta della lingua: il modulo la porta su quella
    // che ha l'errore.
    return {
      field: campo,
      tab: 'header',
      inputId: 'hdr-tagline',
      ...(typeof secondo === 'string' && { locale: secondo }),
    };
  }
  const posto = POSTO[campo];
  return posto ? { field: campo, tab: posto[0], inputId: posto[1] } : null;
}

function problema(issue: SettingsIssue): Pick<SettingsFieldError, 'problem' | 'limit'> {
  if (issue.code === 'too_small' && issue.type === 'string' && (issue.minimum ?? 0) >= 1) {
    return { problem: 'required' };
  }
  if (issue.code === 'invalid_string' && issue.validation === 'url') return { problem: 'url' };
  if (issue.code === 'invalid_string' && issue.validation === 'email') return { problem: 'email' };
  if (issue.code === 'too_big' && issue.type === 'string') return { problem: 'tooLong', limit: issue.maximum };
  if (issue.code === 'too_small' && issue.type === 'number') return { problem: 'min', limit: issue.minimum };
  if (issue.code === 'too_big' && issue.type === 'number') return { problem: 'max', limit: issue.maximum };
  return { problem: 'invalid' };
}

/**
 * Il primo problema che il modulo sa mostrare su un campo, o null se nessuno
 * dei problemi riguarda un campo del modulo (allora si dice solo che il
 * salvataggio non e' riuscito).
 */
export function settingsFieldError(details: unknown): SettingsFieldError | null {
  if (!Array.isArray(details)) return null;
  for (const d of details as SettingsIssue[]) {
    if (!d || !Array.isArray(d.path)) continue;
    const posto = dove(d.path);
    if (!posto) continue;
    return { ...posto, ...problema(d) };
  }
  return null;
}
