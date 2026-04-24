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

    '/calendar': { it: '/calendario', en: '/calendar' },
    '/accessibility': { it: '/accessibilita', en: '/accessibility' },
    '/legal-notice': { it: '/note-legali', en: '/legal-notice' },
    '/privacy': '/privacy',
    '/privacy/my-data': { it: '/privacy/i-miei-dati', en: '/privacy/my-data' },
    '/security': { it: '/sicurezza', en: '/security' },
    '/status': '/status',

    '/admin/login': '/admin/login',
    '/admin/events': { it: '/admin/eventi', en: '/admin/events' },
    '/admin/events/new': { it: '/admin/eventi/nuovo', en: '/admin/events/new' },
    // Explicit declaration so next-intl doesn't route /admin/events/calls
    // through the /admin/events/[id] wildcard and end up serving the wrong
    // segment under /admin/eventi/calls in Italian.
    '/admin/events/calls': { it: '/admin/eventi/chiamate-rapide', en: '/admin/events/calls' },
    '/admin/events/template': '/admin/events/template',
    '/admin/events/statistics': { it: '/admin/eventi/statistiche', en: '/admin/events/statistics' },
    '/admin/events/[id]': { it: '/admin/eventi/[id]', en: '/admin/events/[id]' },
    '/admin/events/[id]/edit': { it: '/admin/eventi/[id]/modifica', en: '/admin/events/[id]/edit' },
    '/admin/registrations': { it: '/admin/iscrizioni', en: '/admin/registrations' },
    '/admin/recordings': { it: '/admin/registrazioni-video', en: '/admin/recordings' },
    '/admin/moderators': { it: '/admin/moderatori', en: '/admin/moderators' },
    '/admin/gdpr-audit': { it: '/admin/gdpr-audit', en: '/admin/gdpr-audit' },
    '/admin/publications': { it: '/admin/pubblicazioni', en: '/admin/publications' },
    '/admin/publications/new': { it: '/admin/pubblicazioni/nuova', en: '/admin/publications/new' },
    '/admin/settings': { it: '/admin/impostazioni', en: '/admin/settings' },
    '/admin/settings/languages': { it: '/admin/impostazioni/lingue', en: '/admin/settings/languages' },
    '/admin/settings/gdpr-templates': { it: '/admin/impostazioni/modelli-gdpr', en: '/admin/settings/gdpr-templates' },
    '/admin/calendar': { it: '/admin/calendario', en: '/admin/calendar' },
    '/admin/infrastructure': { it: '/admin/infrastruttura', en: '/admin/infrastructure' },
    '/admin/monitoring': '/admin/monitoring',
  },
});
