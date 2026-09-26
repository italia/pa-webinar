# ADR-010: A SiteSetting singleton for runtime configuration

**Status:** Accepted

## Context

PA Webinar is reusable software for public administrations (PAs). Each public body installs its own instance and needs the platform to look and behave like its own service: its name, its parent body, its logo and color, its privacy notice and accessibility statement, the languages it offers, and the switches that match how it runs events.

The portal ships as one image for every installation and every environment ([ADR-002](002-nextjs-fullstack.md)). Nothing that differs between installations may be fixed at build time.

Configuration falls into two kinds, owned by different people:

- **Deployment configuration.** Secrets, hostnames, the SMTP transport, object storage, the Jitsi endpoints and the limits of the cluster. The operator sets it, it changes with the infrastructure, and much of it must stay secret.
- **Runtime settings.** Branding, legal texts in several languages, the home page layout, which public features are offered, event-lifecycle timings, the coefficients that size Jitsi Videobridge (JVB) capacity for the hardware at hand, and the defaults of AI post-production. The public body that runs events decides these. They change while the platform runs, often more than once, and the people who change them usually have no access to the cluster. Several of them are long, multilingual texts.

Environment variables fit the first kind. For the second, every change would be a redeploy, done by someone else, with no validation at the moment of editing and no record in the application of who changed what.

## Decision

### One typed row in the database

Runtime settings live in one database row: the `SiteSetting` model in `app/prisma/schema.prisma`, mapped to the table `site_settings`.

- The primary key defaults to `singleton`, and every writer addresses the row by that id. No other model refers to it.
- Each setting is a typed column with a `@default` in the schema. The schema is therefore the single authority for defaults, and the generated Prisma type is what the panel and every reader share.
- The row is created on first use. `getSettings()` in `app/src/lib/settings.ts` creates it with the schema defaults. When several requests race on a fresh installation, the ones that hit the unique constraint re-read the row that the first one created. The Docker Compose `setup` profile also creates it from `app/prisma/seed.ts`, with a few different starting values.

### What the row holds

The main groups are these. The full list, with defaults and ranges, is in [runtime settings](../configuration/runtime-settings.md).

- **Identity and branding:** names of the organization and its parent body, logo, favicon, primary color, tagline, search-engine metadata, the shared-link preview card, the Jitsi watermark, and the source-code and support contact links.
- **Home page and pages:** the home layout (`homePageMode`), custom home content, footer links, and the privacy-notice and accessibility-statement texts per language.
- **Languages and time zone:** the default time zone, the default language, the active languages, their display names and the translation overrides ([ADR-008](008-eu-languages.md)).
- **Public features and defaults:** whether guests may join scheduled events without registering (instant calls stay open to anyone with the link), whether registration is open or by invitation only, whether the public status page is published, the public calendar, the title kicker, Gravatar avatars, the reactions mode, the default waiting-room engine and the default video-quality preset.
- **Email sender:** the display name and the Reply-To address.
- **Event lifecycle and bridge timing:** the inactivity grace period, the pre-scale window, the overtime grace after `endsAt`, the optional early close of an empty room, the provisioning timeout and the waiting-room lead time.
- **Bridge sizing:** the per-core and per-pod coefficients, the per-event bridge cap, the default sender ratio and the stress thresholds that add bridges during an event ([ADR-007](007-jvb-scale-to-zero.md)).
- **AI post-production:** the pipeline kill switch `aiPipelineEnabled`, the default translation languages, the engines (restricted to the in-cluster ones), concurrency and attempt limits, artifact retention, and the notice shown in the waiting room.
- **Operations:** the status-page refresh interval and the grace period before unreferenced recording blobs are deleted.

### What stays in the environment

A value stays out of the row when it is secret, when it describes the deployment, or when it depends on the cluster rather than on the public body's choices. Examples:

- every secret and signing key;
- hostnames and public URLs;
- the SMTP transport and the sender address `SMTP_FROM`, which must match what the relay is allowed to send as;
- storage credentials, and the AI endpoints and their credentials;
- the total bridge cap `JVB_MAX_REPLICAS`. The row's `jvbMaxReplicas` caps each event, and the environment caps the sum.

The rule matters because the whole row reaches the browser (see [consequences](#what-it-costs)). The environment variables are listed in the [configuration reference](../CONFIGURATION.md).

### Administrators edit it in the administration area

- Administrators edit the row under **Settings**. The **Site settings** page is organized in tabs, and the **Language management** page holds the language fields.
- Only administrators can open or save these pages: the instance API key or a named administrator account ([ADR-009](009-admin-session.md), [ADR-015](015-named-administrators.md)). Organizers cannot.
- A save goes through `PUT /api/admin/settings`. The body is checked against `updateSettingsSchema` in `app/src/lib/validation/site-settings.ts`, a strict Zod schema, so an unknown field fails the whole request. Every save writes the administrator audit entry `SITE_SETTINGS_UPDATE` with the names of the saved fields. Translation overrides are saved through `PUT /api/admin/languages`.

### Readers go through a per-process cache

- Most code reads the row through `getSettings()` in `app/src/lib/settings.ts`, which keeps a short-lived copy in each app process.
- A save clears that copy only in the process that served it (`invalidateSettingsCache()`). Every other replica keeps its copy until it expires.
- Some readers skip the cache and query the row each time, among them the i18n request configuration and the AI post-production routes and jobs.
- Server-rendered pages hand the row to a client-side settings context (`useSettings()`), which the header, the footer and the live room read.
- Anonymous callers of `GET /api/admin/settings` receive a public projection of the row, and shared HTTP caches may keep that answer.

The cache lifetime, the full list of direct readers and the cache headers are in [how a change reaches the platform](../configuration/runtime-settings.md#how-a-change-reaches-the-platform) and [who can read them](../configuration/runtime-settings.md#who-can-read-them).

### Events inherit and may override

Some settings are site-wide defaults for events. An event column overrides one of them when it is not `null`: for example the video-quality preset, the waiting-room engine and the grace period after `endsAt`. A `null` column is resolved every time it is read, so changing the site setting also changes every event that inherits it. The precedence rules are in [which value wins](../configuration/runtime-settings.md#which-value-wins).

## Consequences

### What the decision buys

- **No rebuild and no redeploy** for branding, legal texts, feature switches, lifecycle timings or sizing. The same image runs in every installation ([ADR-002](002-nextjs-fullstack.md)).
- **White-labeling.** A public body brands its own installation from the panel, within the limits described in [branding and white-labeling](../configuration/branding.md).
- **Tuning for the hardware.** Public bodies that reuse the platform run on different node types. The sizing coefficients change in the panel, not in code.
- **The right people own the right knobs.** The operator owns the environment, the public body's administrators own the row, and each change to the row leaves an audit entry.
- **Typed columns.** The generated Prisma type reaches the panel, every server-side reader and the client-side settings context (`useSettings()`). The authoritative defaults live in one file.

### What it costs

- **Changes propagate with a delay.** The replica that served a save sees the change at once. Other replicas see it when their cached copy expires. The JVB scaler reads its knobs through the portal, so it applies a change on its first tick after that. A shared HTTP cache in front of the app may keep serving the old public answer for several minutes longer. Participants already in the live room keep the values their page loaded, such as the reactions mode or the video-quality preset, until they reload. The intervals are in [how a change reaches the platform](../configuration/runtime-settings.md#how-a-change-reaches-the-platform).
- **Concurrent saves overwrite each other.** The API accepts partial updates, but the **Site settings** page sends the whole row, so the last save wins for every field. The page itself loads through the cache. With more than one replica, a page opened on another replica soon after a save can show the old values, and saving it writes them back. There is no version check or lock. The save rules are in [who can write them](../configuration/runtime-settings.md#who-can-write-them).
- **No history.** The audit entry records field names, not values. The platform offers no export or import. The row lives in the database, so it is backed up with the database, is not part of the operator's configuration repository, and differs between environments unless someone copies it by hand.
- **The whole row is public.** The anonymous answer of `GET /api/admin/settings` leaves out `customHomeHtml` and `emailReplyTo`, which `NON_PUBLIC_SETTING_FIELDS` in `app/src/lib/settings/public-projection.ts` withholds. The root layout, `app/src/app/[locale]/layout.tsx`, still passes the full row to the client-side settings context, so every column, those two included, travels in the data of every rendered page. The row must never hold a secret or personal data, and `emailReplyTo` should be a role mailbox rather than a person's address. The guard test `app/src/lib/settings/public-projection.test.ts` reads the generated Prisma data model and fails when a column is classified neither as public nor as withheld.
- **Defaults act once.** A column's default applies when the row is created. A migration that adds a column fills the existing row with that column's default. A later change to an existing `@default` does not change a value already stored. A literal fallback in reading code is a second default that can drift from the schema, and some already do.
- **A column is not proof of behavior.** Some saved settings are read by no code. [Known limitations](../configuration/runtime-settings.md#known-limitations) lists them.
- **Every new setting is a code change.** It needs a column and a migration, a field in `updateSettingsSchema`, a classification in the public projection, and a form field with its labels in all 24 languages. The whole-row save and the strict schema combine badly here: a column missing from the schema makes every save of the page fail. The recipe is in [adding a setting](../configuration/runtime-settings.md#for-developers-adding-a-setting).

## Alternatives considered

### Environment variables only

All settings as environment variables, set in Helm values or in the Compose `.env` file. This was rejected for these reasons:

- **Every change is a deployment.** A new logo or a corrected privacy notice would need a values change and a rollout, done by someone with access to the cluster.
- **The wrong owner.** The people who write the legal texts and choose the features belong to the public body that runs events, not to the operator.
- **Long multilingual text does not fit.** The privacy notice, the accessibility statement, custom home content and translation overrides are text per language, some of it long.
- **No checks and no record.** A typo reaches the running app without validation at edit time, and the application keeps no trace of who changed what.

The environment keeps what belongs to the deployment, as described in [what stays in the environment](#what-stays-in-the-environment).

### A generic key-value table

A table of key and value pairs, with keys defined in code. It would let a new setting ship without a migration, and it would allow updates key by key. It was rejected for these reasons:

- **Types and defaults move into code.** Values would be text or JSON, parsed and checked by each reader. Defaults would be scattered across those readers, which is the drift that schema defaults avoid.
- **The guard loses its list.** The public-or-withheld check needs a closed list of settings. The Prisma model is that list, and a key-value table has none.
- **The saving is small.** A new setting still needs validation, a form field and 24 translations. The migration is the smallest part of the work.

The narrower conflicts of per-key updates do not need a key-value table. The API already accepts partial bodies, so a page that sent only the changed fields would get the same benefit.

## Related

- [Runtime settings](../configuration/runtime-settings.md): setting groups, defaults, per-event overrides, precedence and known limitations
- [Branding and white-labeling](../configuration/branding.md): what a public body can brand and its limits
- [Configuration reference](../CONFIGURATION.md): the environment variables that stay outside the row
- [Languages and localization](../architecture/i18n.md): the language settings in use
- [Data model](../architecture/data-model.md): schema conventions and the migration policy
- [ADR-002](002-nextjs-fullstack.md), [ADR-007](007-jvb-scale-to-zero.md), [ADR-008](008-eu-languages.md), [ADR-009](009-admin-session.md), [ADR-015](015-named-administrators.md)
