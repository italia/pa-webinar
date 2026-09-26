# ADR-008: 24 EU languages with next-intl

**Status:** Accepted

## Context

PA Webinar is reusable software for public administrations (PAs). The project cannot know in advance which languages an adopting public body needs. Events reach citizens, speakers and partner bodies in other member states, and some Italian regions use German, French or Slovenian alongside Italian.

Language is not only a matter of convenience here. Participants read privacy notices and give consent to recording and to the capture of their own voice before they enter a room. Consent is informed only when the person can read the text. A consent screen in Italian, shown to someone who does not read Italian, does not meet that bar.

The portal is a single Next.js App Router application ([ADR-002](002-nextjs-fullstack.md)). Most pages are Server Components, the live room is a Client Component, and emails and calendar files are built on the server outside any request for a page. The localization layer therefore has to:

- translate in Server Components and Client Components alike;
- handle plurals, which differ between languages;
- give each page a URL in the visitor's language;
- serve every installation from one image, with the choice of languages made at runtime.

## Decision

### All 24 official EU languages, with Italian as the default

The interface ships in the 24 official languages of the European Union, through next-intl.

- **The set.** The codes are `locales` in `app/src/i18n/config.ts`, with each language's own name (its endonym) in `localeNames`. The set is closed: it is the EU's list, not a list the project curates.
- **The default.** `defaultLocale` in the same file is `it`. Italian is the source language: `it.json` defines the set of message keys, it is the runtime fallback for interface text, and it is the language the API requires for event content.
- **The catalogs.** Each language has one nested JSON catalog in `app/src/i18n/messages/`. Messages use ICU MessageFormat, so each language uses the plural categories its grammar needs.
- **The library.** next-intl supplies `getTranslations` for Server Components, `useTranslations` for Client Components, the middleware that detects the language, and the routing definition with per-language paths (`defineRouting` in `app/src/i18n/routing.ts`).

### Administrators choose which languages are offered

The language settings are fields of the `SiteSetting` singleton ([ADR-010](010-site-settings-singleton.md)). Administrators edit them under **Settings** → **Languages** without a rebuild:

- `availableLocales`, the active languages (**Enabled languages**). Its default in `app/prisma/schema.prisma` is `["it","en"]`;
- `defaultLocale`, the default language (**Default language**). Its default in the same file is `"it"`;
- `translationOverrides`, which replaces single messages in one language (**Custom translations**).

The active languages decide what is **offered**:

- the languages in the header's language switcher;
- the content tabs of the event wizard and of the site tagline editor;
- the target languages offered when a recording's transcript is translated by AI post-production.

They do not decide what is **reachable**. Routing is fixed in code and covers all 24 languages, whatever the settings say.

### Localized URLs

- Every page URL carries a language prefix (`localePrefix: 'always'`).
- Page directories are named in English. The `pathnames` map in `app/src/i18n/routing.ts` gives each page its Italian and English form, such as `/it/eventi/<slug>` and `/en/events/<slug>`. The other 22 languages use the English segments under their own prefix.
- Links are built from that map: `percorso()` inside the router, and `localizedPath()` or `localizedUrl()` in emails, calendar files, copied links and redirects. The rule is that no code writes a localized path by hand. The one exception today is the sitemap's static event-list entry in `app/src/app/sitemap.ts`.

### Full parity is required

- **The 24/24 rule.** Every key of `it.json` exists in every catalog, is not empty, and uses the same placeholder names. `app/src/i18n/locale-parity.test.ts` enforces it in the unit suite, and also fails if the number of catalogs is not 24.
- **The fallback is a safety net.** `app/src/i18n/request.ts` fills a missing or empty key with the Italian text so that a page never shows a raw key path. That net is not a permission to ship a language partially.
- **Release notes too.** Each release's notes exist in all 24 languages, with the same number of notes as the Italian original (`app/src/content/changelog/changelog.test.ts`).

## Consequences

The consequences below follow from the decision itself. Current gaps in this area are listed under [Known limitations](../architecture/i18n.md#known-limitations).

### Every string ships in 24 catalogs

- **Every contributor translates.** A change that adds visible text adds it to all 24 catalogs in the same commit, or the suite fails. Write the new key in `it.json` and `en.json` by hand. `scripts/sync-i18n.mjs` then copies it from `en.json` to the other 22 catalogs, using the English text as filler. Translating that filler is still the contributor's job.
- **Filler passes the tests.** The parity test checks presence, emptiness and placeholder names, not whether the text is translated. English filler left in a Polish catalog passes, and only review catches it.
- **Keys are not type-checked.** A key used in code but absent from `it.json` passes TypeScript and the tests, and the page shows the raw dotted path.
- **Pages carry their catalog.** The locale layout passes the whole catalog of the page language to the client provider, so every page ships it to the browser.
- **The installation's own wording needs no fork.** A public body changes its terminology with translation overrides, per language and per key, and the shipped catalogs stay the fallback.

### All prefixes remain routable

- **Links never break.** Turning a language off removes it from the switcher and from the content forms. `/de/…` keeps answering, so a link that someone shared in German still works.
- **Inactive languages stay visible.** Detection on an unprefixed URL (the `NEXT_LOCALE` cookie, then the browser's `Accept-Language` header, then `it`) considers all 24 languages. A visitor whose browser prefers an inactive language lands on it, and the alternate-language `Link` header lists all 24.

### `defaultLocale` does not change the routing default

The runtime setting drives the switcher and the forms, not routing. The routing default is the constant `it` in `config.ts`.

The `defaultLocale` setting decides:

- which content tab the event wizard requires, and which tab the wizard and the tagline editor open on;
- the email language when the recipient's language is unknown, such as a registration that stored no language, or the recap sent to the moderator after the event.

It does not change:

- the language a visitor lands on from `/`;
- the fallback for interface text, which is always `it.json`;
- the fallback for event content, which is always Italian;
- the language the API requires. An event title and description, an instant call title and a questionnaire question are rejected without an Italian version (`app/src/lib/validation/schemas.ts`).

As a result, an installation that switches its default language to English still has to write Italian content. If Italian is not an active language, the wizard shows no Italian tab and events cannot be created. This is listed among the [known limitations in the roadmap](../ROADMAP.md#known-limitations-of-shipped-features).

### Emails in five languages

Parity covers the catalogs. It does not cover email, or the few strings built in code rather than read from a catalog, such as the recurrence summaries in the event wizard, which exist only in Italian and English. Email text exists in five languages: `EMAIL_LOCALES` in `app/src/lib/email/lingua.ts` lists Italian, English, French, German and Spanish.

- **A recipient who uses another language receives English**, as a European lingua franca.
- **Links stay in the registrant's language.** The event title, the links and the calendar files follow the language of the page the person registered from.
- **Extending the set means new templates.** Adding a language means translating every email template, and the templates that administrators can edit cover the same five languages.

See [Email and calendar](../architecture/email.md#languages).

### Outside the portal's catalogs

- **The conference.** The Jitsi Meet interface uses Jitsi's own translations. The portal passes the page language as the IFrame API `lang` option, and the conference keeps that language until the next join.
- **AI outputs.** Transcripts, subtitles, summaries and dubbing follow the source language and the target languages configured for AI post-production, not the interface catalogs. See [AI post-production](../POSTPROD.md).

## Alternatives considered

### Italian and English only

Two catalogs would have been simpler. Every change would carry two translations instead of 24, and review would read two languages.

It was rejected for these reasons:

- **The wrong layer decides.** A product built for reuse would choose the languages for every adopting body, and a body that needs German or Slovenian would have to fork.
- **Consent fails.** Participants who read neither language would give consent to recording and voice capture on a text they cannot read.
- **Language later costs more.** A language added after the fact starts with every key missing, and until the backlog is translated it silently falls back to Italian. That is the failure the parity rule exists to prevent.

An installation that wants two languages still gets them: the default `availableLocales` is `["it","en"]`, and the other 22 languages are a setting away.

### Machine translation at runtime

The portal could have shipped Italian only and translated interface text on request with a machine-translation service.

It was rejected for these reasons:

- **Data would leave.** An external translation API would receive page content, including event content, from every installation. That contradicts the data-sovereignty posture that keeps processing inside the installation, as the AI post-production policy in `app/src/lib/ai/providers.ts` does for its models.
- **Rendering would need a model.** An in-cluster model on the rendering path would add latency and model-serving hardware to every page view.
- **Nobody could review it.** Consent texts, privacy notices and error messages would reach people without anyone having read them in that language.
- **It is not stable.** The same key could render differently from one request to the next. The output could also drop or rename an ICU placeholder, and no test could catch it.

Committed catalogs are versioned, reviewed in pull requests, and checked by the parity test. Machine translation remains in the product where its output is content rather than interface: AI post-production translates transcripts and summaries in-cluster, and labels them as AI-generated.

## Related

- [Languages and localization](../architecture/i18n.md): catalogs, the parity test, localized URLs, runtime settings, content languages and guard tests
- [Email and calendar](../architecture/email.md): email languages, templates and calendar files
- [Runtime settings (SiteSetting)](../configuration/runtime-settings.md): the settings panel and its other groups
- [Branding and white-labeling](../configuration/branding.md): what else a public body can change without a rebuild
- [Extending PA Webinar](../development/extending.md): recipes for adding a string, a page or a language
- [ADR-002](002-nextjs-fullstack.md), [ADR-010](010-site-settings-singleton.md)
