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
    '/events/[slug]/live': '/events/[slug]/live',

    '/calendar': { it: '/calendario', en: '/calendar' },
    '/accessibility': { it: '/accessibilita', en: '/accessibility' },
    '/legal-notice': { it: '/note-legali', en: '/legal-notice' },
    '/privacy': '/privacy',
    '/privacy/my-data': { it: '/privacy/i-miei-dati', en: '/privacy/my-data' },
    '/status': '/status',

    '/admin/login': '/admin/login',
    '/admin/events': { it: '/admin/eventi', en: '/admin/events' },
    '/admin/events/new': { it: '/admin/eventi/nuovo', en: '/admin/events/new' },
    '/admin/events/template': '/admin/events/template',
    '/admin/events/statistics': { it: '/admin/eventi/statistiche', en: '/admin/events/statistics' },
    '/admin/events/[id]': { it: '/admin/eventi/[id]', en: '/admin/events/[id]' },
    '/admin/events/[id]/edit': { it: '/admin/eventi/[id]/modifica', en: '/admin/events/[id]/edit' },
    '/admin/settings': { it: '/admin/impostazioni', en: '/admin/settings' },
    '/admin/settings/languages': { it: '/admin/impostazioni/lingue', en: '/admin/settings/languages' },
    '/admin/calendar': { it: '/admin/calendario', en: '/admin/calendar' },
    '/admin/infrastructure': { it: '/admin/infrastruttura', en: '/admin/infrastructure' },
    '/admin/monitoring': '/admin/monitoring',
    '/admin/statistics': { it: '/admin/statistiche', en: '/admin/statistics' },
  },
});
