import { defineRouting } from 'next-intl/routing';

import { locales, defaultLocale } from './config';

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: 'always',
  pathnames: {
    '/': '/',

    '/events': { it: '/eventi', en: '/events' },
    '/events/[slug]': { it: '/eventi/[slug]', en: '/events/[slug]' },
    '/events/[slug]/registration': { it: '/eventi/[slug]/registrazione', en: '/events/[slug]/registration' },
    // Must stay in sync with `lib/utils/localized-url.ts`, which
    // rewrites `/events/…` → `/eventi/…` wholesale for IT. That helper
    // builds the join link in the sign-up confirmation email, so the
    // router has to match `/it/eventi/<slug>/live` — if this stays a
    // bare string ('/events/[slug]/live') the email link 404s.
    '/events/[slug]/live': { it: '/eventi/[slug]/live', en: '/events/[slug]/live' },
    // Ogni sottopagina di un percorso localizzato va dichiarata anche lei:
    // non dichiarata, `/it/eventi/<slug>/password` non trova nessuna pagina
    // mentre `/it/events/<slug>/password` si' — due indirizzi, uno rotto.
    '/events/[slug]/password': { it: '/eventi/[slug]/password', en: '/events/[slug]/password' },
    '/events/[slug]/questionnaire/[placement]': {
      it: '/eventi/[slug]/questionario/[placement]',
      en: '/events/[slug]/questionnaire/[placement]',
    },

    '/calendar': { it: '/calendario', en: '/calendar' },
    '/accessibility': { it: '/accessibilita', en: '/accessibility' },
    '/legal-notice': { it: '/note-legali', en: '/legal-notice' },
    '/privacy': '/privacy',
    '/privacy/my-data': { it: '/privacy/i-miei-dati', en: '/privacy/my-data' },
    '/privacy/my-data/erasure': { it: '/privacy/i-miei-dati/cancellazione', en: '/privacy/my-data/erasure' },
    '/security': { it: '/sicurezza', en: '/security' },
    '/status': '/status',
    '/video-library': '/video-library',
    '/service-inventory': '/service-inventory',
    '/changelog': '/changelog',
    '/rubrica/opt-out': '/rubrica/opt-out',

    '/admin': '/admin',
    '/admin/login': '/admin/login',
    '/admin/events': { it: '/admin/eventi', en: '/admin/events' },
    '/admin/events/new': { it: '/admin/eventi/nuovo', en: '/admin/events/new' },
    // Explicit declaration so next-intl doesn't route /admin/events/calls
    // through the /admin/events/[id] wildcard and end up serving the wrong
    // segment under /admin/eventi/calls in Italian.
    '/admin/events/calls': { it: '/admin/eventi/chiamate-rapide', en: '/admin/events/calls' },
    '/admin/events/template': { it: '/admin/eventi/modelli', en: '/admin/events/template' },
    '/admin/events/statistics': { it: '/admin/eventi/statistiche', en: '/admin/events/statistics' },
    '/admin/events/[id]': { it: '/admin/eventi/[id]', en: '/admin/events/[id]' },
    '/admin/events/[id]/edit': { it: '/admin/eventi/[id]/modifica', en: '/admin/events/[id]/edit' },
    '/admin/events/[id]/materials': { it: '/admin/eventi/[id]/materiali', en: '/admin/events/[id]/materials' },
    '/admin/events/[id]/questionnaires': {
      it: '/admin/eventi/[id]/questionari',
      en: '/admin/events/[id]/questionnaires',
    },
    '/admin/registrations': { it: '/admin/iscrizioni', en: '/admin/registrations' },
    '/admin/recordings': { it: '/admin/registrazioni-video', en: '/admin/recordings' },
    '/admin/moderators': { it: '/admin/moderatori', en: '/admin/moderators' },
    '/admin/organizers': { it: '/admin/organizzatori', en: '/admin/organizers' },
    // L'atterraggio del link d'accesso mandato per email (ADR-014).
    '/admin/access': { it: '/admin/accesso', en: '/admin/access' },
    '/admin/gdpr-audit': { it: '/admin/gdpr-audit', en: '/admin/gdpr-audit' },
    '/admin/publications': { it: '/admin/pubblicazioni', en: '/admin/publications' },
    '/admin/publications/new': { it: '/admin/pubblicazioni/nuova', en: '/admin/publications/new' },
    '/admin/settings': { it: '/admin/impostazioni', en: '/admin/settings' },
    '/admin/settings/languages': { it: '/admin/impostazioni/lingue', en: '/admin/settings/languages' },
    '/admin/settings/gdpr-templates': { it: '/admin/impostazioni/modelli-gdpr', en: '/admin/settings/gdpr-templates' },
    '/admin/calendar': { it: '/admin/calendario', en: '/admin/calendar' },
    '/admin/infrastructure': { it: '/admin/infrastruttura', en: '/admin/infrastructure' },
    '/admin/monitoring': { it: '/admin/monitoraggio', en: '/admin/monitoring' },
    '/admin/questionnaires': { it: '/admin/questionari', en: '/admin/questionnaires' },
    '/admin/questionnaires/responses': { it: '/admin/questionari/risposte', en: '/admin/questionnaires/responses' },
    '/admin/questionnaires/feedback': { it: '/admin/questionari/feedback', en: '/admin/questionnaires/feedback' },
    '/admin/rubrica': '/admin/rubrica',
    '/admin/rubrica/[id]': '/admin/rubrica/[id]',
    '/admin/postprod': { it: '/admin/post-produzione', en: '/admin/postprod' },
    '/admin/postprod/[recordingId]': { it: '/admin/post-produzione/[recordingId]', en: '/admin/postprod/[recordingId]' },
    '/admin/settings/tags': { it: '/admin/impostazioni/tag', en: '/admin/settings/tags' },
    '/admin/settings/email-templates': { it: '/admin/impostazioni/modelli-email', en: '/admin/settings/email-templates' },
  },
});
