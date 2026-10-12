/**
 * La struttura dell'area di amministrazione, in un posto solo: la leggono il
 * menu, le briciole e i titoli delle pagine. Una pagina ha cosi' lo stesso
 * nome nel menu, nelle briciole, nel titolo della scheda del browser e
 * nell'intestazione.
 *
 * Ogni sezione raccoglie le pagine di un'attivita' (gli eventi, chi partecipa,
 * i video...), anche quando i loro indirizzi non condividono la radice: e' la
 * sezione, non l'indirizzo, a dire dove ci si trova. Le etichette sono chiavi
 * dello spazio `admin.nav`.
 */
import type { PercorsoInterno, PercorsoStatico } from '@/i18n/percorsi';

export type StaffRole = 'admin' | 'organizer';

export interface NavItem {
  href: PercorsoStatico;
  icon: string;
  labelKey: string;
  /** Attiva solo sul proprio indirizzo, non sulle pagine sotto. */
  exact?: boolean;
}

export interface NavSection {
  href: PercorsoStatico;
  icon: string;
  labelKey: string;
  /** Gli indirizzi che appartengono alla sezione, con le pagine sotto. */
  radici: readonly PercorsoStatico[];
  voci: readonly NavItem[];
}

/**
 * Le voci che l'organizzatore vede (ADR-014). Un elenco di ammessi, non di
 * esclusi: una pagina aggiunta domani nasce riservata all'amministrazione
 * finche' qualcuno non decide il contrario — com'e' per le pagine, che senza
 * guardia esplicita mostrano «accesso non consentito».
 */
export const VOCI_ORGANIZZATORE: ReadonlySet<PercorsoStatico> = new Set<PercorsoStatico>([
  '/admin/events',
  '/admin/events/new',
  '/admin/events/calls',
  '/admin/calendar',
  '/admin/recordings',
  '/admin/postprod',
  // Il glossario comune della post-produzione: chi organizza lo arricchisce.
  '/admin/glossary',
]);

/**
 * Le sezioni, nell'ordine del menu. Nessuna icona si ripete fra intestazione,
 * barra delle sezioni e voci di una stessa sezione (lo verifica il test).
 */
export const SEZIONI: readonly NavSection[] = [
  {
    href: '/admin/events',
    icon: 'it-presentation',
    labelKey: 'events',
    radici: ['/admin/events', '/admin/calendar'],
    voci: [
      { href: '/admin/events', icon: 'it-list', labelKey: 'eventsList', exact: true },
      { href: '/admin/events/new', icon: 'it-plus', labelKey: 'newEvent' },
      { href: '/admin/events/calls', icon: 'it-telephone', labelKey: 'instantCalls' },
      // Non l'icona del calendario pubblico dell'intestazione: e' un'altra pagina.
      { href: '/admin/calendar', icon: 'it-clock', labelKey: 'calendar' },
      { href: '/admin/events/template', icon: 'it-folder', labelKey: 'templates' },
      { href: '/admin/events/statistics', icon: 'it-chart-line', labelKey: 'analytics' },
    ],
  },
  {
    // Chi partecipa: iscrizioni, rubrica, registro GDPR.
    href: '/admin/registrations',
    icon: 'it-user',
    labelKey: 'people',
    radici: ['/admin/registrations', '/admin/rubrica', '/admin/gdpr-audit'],
    voci: [
      { href: '/admin/registrations', icon: 'it-list', labelKey: 'registrationsList', exact: true },
      { href: '/admin/rubrica', icon: 'it-card', labelKey: 'rubrica' },
      { href: '/admin/gdpr-audit', icon: 'it-file-signed', labelKey: 'gdprAudit' },
    ],
  },
  {
    href: '/admin/questionnaires',
    icon: 'it-note',
    labelKey: 'questionnaires',
    radici: ['/admin/questionnaires'],
    voci: [
      { href: '/admin/questionnaires', icon: 'it-folder', labelKey: 'questionnairesLibrary', exact: true },
      { href: '/admin/questionnaires/responses', icon: 'it-chart-line', labelKey: 'questionnairesResponses' },
      { href: '/admin/questionnaires/feedback', icon: 'it-star-outline', labelKey: 'feedbackDashboard' },
    ],
  },
  {
    // Tutto cio' che esce da un evento in video: registrazioni, la loro
    // post-produzione, il glossario che la guida, le pubblicazioni in libreria.
    href: '/admin/recordings',
    icon: 'it-file-video',
    labelKey: 'video',
    radici: ['/admin/recordings', '/admin/postprod', '/admin/glossary', '/admin/publications'],
    voci: [
      { href: '/admin/recordings', icon: 'it-list', labelKey: 'recordingsList', exact: true },
      { href: '/admin/postprod', icon: 'it-file-audio', labelKey: 'recordingsPostprod' },
      { href: '/admin/glossary', icon: 'it-file-txt', labelKey: 'glossary' },
      { href: '/admin/publications', icon: 'it-share', labelKey: 'publicationsList', exact: true },
      { href: '/admin/publications/new', icon: 'it-upload', labelKey: 'publicationsNew' },
    ],
  },
  {
    // Chi lavora sulla piattaforma e con quali chiavi.
    href: '/admin/organizers',
    icon: 'it-key',
    labelKey: 'staffAccess',
    radici: ['/admin/organizers', '/admin/moderators'],
    voci: [
      { href: '/admin/organizers', icon: 'it-card', labelKey: 'staffAccounts', exact: true },
      { href: '/admin/moderators', icon: 'it-link', labelKey: 'moderatorLinks' },
    ],
  },
  {
    // Viste operative, non configurazione.
    href: '/admin/monitoring',
    icon: 'it-piattaforme',
    labelKey: 'monitoring',
    radici: ['/admin/monitoring', '/admin/infrastructure'],
    voci: [
      { href: '/admin/monitoring', icon: 'it-check-circle', labelKey: 'monitoringDashboard', exact: true },
      { href: '/admin/infrastructure', icon: 'it-plug', labelKey: 'infrastructure' },
    ],
  },
  {
    href: '/admin/settings',
    icon: 'it-settings',
    labelKey: 'settings',
    radici: ['/admin/settings'],
    voci: [
      { href: '/admin/settings', icon: 'it-list', labelKey: 'settingsGeneral', exact: true },
      { href: '/admin/settings/languages', icon: 'it-flag', labelKey: 'settingsLanguages' },
      { href: '/admin/settings/gdpr-templates', icon: 'it-file-signed', labelKey: 'settingsGdprTemplates' },
      { href: '/admin/settings/email-templates', icon: 'it-mail', labelKey: 'settingsEmailTemplates' },
      { href: '/admin/settings/tags', icon: 'it-bookmark', labelKey: 'settingsTags' },
    ],
  },
];

/** Le pagine di dettaglio sotto una voce, con il loro nome. */
const DETTAGLI: Partial<Record<PercorsoInterno, string>> = {
  '/admin/events/[id]': 'eventDetail',
  '/admin/events/[id]/edit': 'eventEdit',
  '/admin/events/[id]/materials': 'eventMaterials',
  '/admin/events/[id]/questionnaires': 'eventQuestionnaires',
  '/admin/rubrica/[id]': 'rubricaDetail',
  '/admin/postprod/[recordingId]': 'postprodDetail',
};

export function vocePerRuolo(role: StaffRole) {
  return (item: NavItem) => role === 'admin' || VOCI_ORGANIZZATORE.has(item.href);
}

/** Le sezioni che un ruolo vede, ciascuna con le sole voci che puo' aprire. */
export function sezioniPerRuolo(role: StaffRole): NavSection[] {
  const visibile = vocePerRuolo(role);
  return SEZIONI.map((s) => ({ ...s, voci: s.voci.filter(visibile) })).filter(
    (s) => s.voci.length > 0,
  );
}

function sotto(pathname: string, radice: string): boolean {
  return pathname === radice || pathname.startsWith(`${radice}/`);
}

/** La sezione di un percorso interno (`usePathname`: senza lingua). */
export function sezioneDi(pathname: string, role: StaffRole = 'admin'): NavSection | null {
  return sezioniPerRuolo(role).find((s) => s.radici.some((r) => sotto(pathname, r))) ?? null;
}

/** La voce di una sezione che contiene il percorso: la piu' specifica. */
export function voceDi(pathname: string, sezione: NavSection): NavItem | null {
  let migliore: NavItem | null = null;
  for (const v of sezione.voci) {
    if (!sotto(pathname, v.href)) continue;
    if (!migliore || v.href.length > migliore.href.length) migliore = v;
  }
  return migliore;
}

export function voceAttiva(pathname: string, item: NavItem): boolean {
  return item.exact ? pathname === item.href : sotto(pathname, item.href);
}

export interface Anello {
  labelKey: string;
  /** Il percorso interno, anche con segnaposto (si riempie coi parametri). */
  href: PercorsoInterno;
}

/**
 * Le briciole di una pagina: sezione, voce (se diversa dalla pagina d'ingresso
 * della sezione), dettagli. Una pagina d'ingresso di sezione ne ha una sola,
 * e le briciole non servono.
 */
export function catena(pathname: string, role: StaffRole = 'admin'): Anello[] {
  const sezione = sezioneDi(pathname, role);
  if (!sezione) return [];
  const anelli: Anello[] = [{ labelKey: sezione.labelKey, href: sezione.href }];
  const voce = voceDi(pathname, sezione);
  if (voce && voce.href !== sezione.href) anelli.push({ labelKey: voce.labelKey, href: voce.href });
  const segmenti = pathname.split('/').filter(Boolean);
  for (let i = 1; i <= segmenti.length; i += 1) {
    const prefisso = `/${segmenti.slice(0, i).join('/')}` as PercorsoInterno;
    const labelKey = DETTAGLI[prefisso];
    if (labelKey) anelli.push({ labelKey, href: prefisso });
  }
  return anelli;
}

/**
 * Il nome della pagina: il dettaglio, o la voce del menu (anche quando e' la
 * pagina d'ingresso della sezione: «Tutti gli eventi», non «Eventi»).
 */
export function nomePagina(pathname: string, role: StaffRole = 'admin'): string | null {
  const c = catena(pathname, role);
  if (c.length === 0) return null;
  if (c.length > 1) return c[c.length - 1]!.labelKey;
  const sezione = sezioneDi(pathname, role);
  const voce = sezione ? voceDi(pathname, sezione) : null;
  return voce?.labelKey ?? c[0]!.labelKey;
}
