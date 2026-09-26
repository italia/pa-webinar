# ADR-014: The organizer role

**Status:** Accepted; extended by [ADR-015](015-named-administrators.md) (named administrators)

**Extends:** [ADR-009](009-admin-session.md)

## Context

The administration area had two ways in:

- **The instance API key** (`ADMIN_API_KEY`, [ADR-009](009-admin-session.md)). It opens everything:
  platform configuration, the data of every event, the address book and the GDPR log.
- **An event's primary moderator link** ([ADR-003](003-moderator-magic-links.md)). It runs one
  existing event. It cannot create an event, and most of the administration area stays closed to it:
  the event list, questionnaires and AI post-production.

Some people organize events without administering the platform. An example is an office that runs
its own webinars on an installation that someone else operates. These people had no way in of their
own. To let them create an event, an administrator had to hand over the instance key. With the key
they could also change the configuration, delete other people's events and read the personal data
of every participant.

The data model did not help either. `Event` had no owner, so nothing could say "this event belongs to
this person".

## Decision

**A third way into the administration area: a named staff account with the role `ORGANIZER`.** An
organizer creates events and manages only the events they created. Anything that concerns the whole
installation stays with administrators.

### Identity

- **The account.** An organizer is a `StaffAccount` row (table `staff_accounts`) with `role`
  `ORGANIZER`. The name and the email address are encrypted at rest (`encryptPII`). The address is
  looked up through `emailHash`, a keyed HMAC-SHA256 computed by `hashEmail` in
  `app/src/lib/crypto/pii.ts`. The account also has an `active` flag and a last sign-in time.
- **No password.** Organizers sign in with a one-time link sent by email. This follows the choice
  already made for moderators: nobody who uses the platform keeps a password on it.
- **Only the token's hash is stored.** A link carries a random token. The `StaffLoginToken` row
  (table `staff_login_tokens`) keeps only its SHA-256, so a copy of the database cannot be used to
  sign in as anyone.
- **Twenty minutes, one use, one explicit click.** The link expires after 20 minutes
  (`DURATA_LINK_MINUTI` in `app/src/lib/auth/staff-link-config.ts`). It is consumed once, with an
  atomic conditional update. The page that the link opens, `/admin/access`, consumes nothing. Only
  its **Sign in** button posts the token to `POST /api/staff/login-link/verify`. Mail scanners that
  follow links therefore cannot burn a sign-in.
- **No enumeration.** On the sign-in page, **Send me the link** calls `POST /api/staff/login-link`.
  That route gives the same answer whether or not the address belongs to an active account.
- **Delivery.** The email goes through the email outbox, like every other platform email. The full
  flow is in [The one-time email link](../architecture/identity-and-access.md#the-one-time-email-link).

### Ownership

- **`Event.createdById`** is a nullable, indexed reference to `StaffAccount`. It uses
  `onDelete: SetNull`.
- **An event that an organizer creates belongs to that organizer.** This covers events from the
  wizard (`POST /api/events`) and instant calls (`POST /api/events/instant`).
- **Events with no owner belong to the administration.** This covers events created with the
  instance key. On an upgraded installation, the events that existed before the column also have no
  owner. [ADR-015](015-named-administrators.md) adds one case: an event that a named administrator
  creates through the wizard, as an instant call or by duplication is owned by that administrator's
  account. Events created from the publications library (**New publication**,
  `POST /api/admin/publications`, administrators only) have no owner, whoever creates them.
- **Duplicates and series.** A duplicated event belongs to whoever duplicates it. A new event can
  join a recurrence series only if its creator may manage the series' first event. Otherwise the
  request fails with `series_not_manageable`.
- **Deleting an account keeps its events.** `createdById` becomes null, and the events return to the
  administration.
- **One owner per event.** No screen or route transfers or shares ownership.

### Session

- **One cookie for all staff.** Organizers use the same signed cookie as administrators,
  `admin_session`. It is an HS256 JWT. For an organizer, it carries `role: "organizer"` and the
  account id as `sub`. The lifetime and the sliding refresh are those of
  [ADR-009](009-admin-session.md), described in
  [Sessions](../architecture/identity-and-access.md#sessions).
- **The account decides, not the token.** On every request, `getStaffSession` in
  `app/src/lib/auth/staff-session.ts` re-reads the account's `active` flag and `role`, once per
  request. Deactivation therefore takes effect on the next request, not when the cookie expires.
- **The refresh keeps the role.** `POST /api/admin/refresh` re-mints the token with the account's
  current role. A refresh never turns an organizer session into an administrator session.
- **The middleware checks only the signature.** The middleware cannot read the database. It lets a
  validly signed `admin` or `organizer` session into the pages under `/admin`. Each page then decides
  what that session may see.

### Authorization

- **`isAdminAuthenticated` stays true only for administrators.** A route that nobody has reviewed for
  the new role keeps refusing organizers. It does not open to them by mistake.
- **Reviewed routes use explicit staff guards.** These are `requireStaff`, `requireEventManager`,
  `requireRecordingManager` and `requireSpeakerManager` in `app/src/lib/auth/staff-session.ts`.
  The last three resolve the owning event, directly or through a recording or a transcript speaker
  label. For an organizer, an unknown id answers 403, the same as someone else's event, so the answer
  does not reveal which ids exist. A malformed event id answers 400 for every role. Administrators
  pass these guards without an ownership check, and the handler answers.
- **Lists are filtered.** `eventScope(session)` gives `{}` for administrators and
  `{ createdById: <account> }` for organizers.
- **Pages declare their audience.** Each page calls `soloAdmin` or `staffOLogin` from
  `app/src/lib/auth/staff-page.ts`. The event management page instead calls `getStaffSession` and
  checks ownership itself with `puoGestire`; it also opens with the event's primary moderator token.
  The sign-in page, the link landing page and the edit page, which opens only with the primary
  moderator token, are the listed exceptions. A signed-in organizer on an administrator-only page
  sees **This section is not available for your role** and a link back to their events. A redirect to
  the sign-in page would send them around in a loop.
- **Edits go through the event's token.** Editing, publishing and deleting an event go through the
  token-authenticated event API ([ADR-003](003-moderator-magic-links.md)). The event page therefore
  gives the event's primary moderator token to any staff member who may manage the event. An
  organizer knows the primary link of every event they own. This is why
  [deactivation](#deactivation-and-deletion) rotates those links.

The guard table and the request flow are in
[Where authorization is enforced](../architecture/identity-and-access.md#where-authorization-is-enforced).

### What organizers can and cannot do

| Organizers can | Organizers cannot |
|---|---|
| Create events, starting from the shared event templates, and instant calls | Change platform settings, languages, GDPR and email templates, or manage tags, event templates and the question library |
| Manage their own events: editing, publishing, materials, questionnaires, invitations, tags, duplication, bulk archive and delete, event analytics | See infrastructure or monitoring, or query metrics |
| Manage the publication fields of their own events and upload their recordings | Use the address book |
| See the recordings of their own events and run AI post-production on them, including naming transcript speaker labels | See sign-ups, questionnaire responses or feedback across all events, instance analytics or the GDPR log |
| Read the shared tag and question libraries to compose their own events | Use the publications library, the orphaned recording files, the **Moderators** directory or staff accounts. They cannot rotate a moderator link, even for their own events |

The organizer's menu shows **Events** (**Event list**, **New event**, **Instant calls**,
**Calendar**) and **Video & sessions** (**Video recordings**, **Transcripts / AI**).

### Deactivation and deletion

Administrators manage accounts on **Accounts** (`/admin/organizers`, page title **Staff accounts**).

**Deactivating** an account (`PATCH /api/admin/organizers/{id}` with `active: false`) sets `active`
to false and, in the same transaction, deletes the account's unused sign-in links and **rotates the
primary moderator link of every event the account owns** to a new random token. Because the session
re-reads the account, it stops working on its next request.

The organizer has seen all of those primary links. Without the rotation, they would stay out of the
administration area but could still edit, publish or delete their events through the links. People
who used a link legitimately find the new one on the event page.

**Deleting** an account rotates the same links and then removes the account. Its sign-in links go
with it. Its events stay and return to the administration.

What deactivation and deletion do not do:

- **Named grants stay valid.** The `EventModerator` grants on the account's events are not revoked,
  because each belongs to the person it was given to. A `MODERATOR` grant can still edit, publish and
  delete the event through the event API, like the primary link
  ([What each seat can do](../architecture/identity-and-access.md#what-each-seat-can-do)). When an
  organizer leaves, review the grants on their events and revoke, from the event page, any that the
  organizer holds.
- **Jitsi tokens already issued stay valid** until they expire
  ([Seats, identifiers and lifetimes](../architecture/identity-and-access.md#seats-identifiers-and-lifetimes)).
- **Reactivation does not restore access by itself.** Reactivating an account sends no link. An
  administrator sends a new one with **Send link**. The rotated moderator links stay rotated.

Role changes, and the rule that nobody acts on their own account, belong to
[ADR-015](015-named-administrators.md).

### The address book stays with administrators

The address book (`Person`, [ADR-011](011-person-rubrica.md)) holds people across events, so it stays
with administrators. An organizer manages the invitations of their own events and names the transcript
speaker labels of their own recordings. They cannot:

- **Link an address-book entry.** The invitation and speaker routes answer 403 when an organizer sends
  a `personId`.
- **See entries.** The address-book pages are administrator-only.
- **Search the address book in the wizard.** The event wizard hides the address-book search from
  organizers (`canUseRubrica`).

### Moderators do not become accounts

Moderators and speakers keep their per-event magic links ([ADR-003](003-moderator-magic-links.md)).
The per-event link already does that job. A second identity model for the same thing would add little
and cost a lot. An organizer who runs the room of their own event uses the event's links like anyone
else.

## Safeguards

Two mechanisms make it deliberate to open something to organizers:

- **The guard test.** `app/src/lib/auth/staff-access.test.ts` fails in three cases:
  - a route under `app/src/app/api/admin` calls neither an administrator guard nor a staff guard.
    Sign-in, sign-out and refresh are the only exceptions, each listed with its reason;
  - the set of administration routes that call a staff guard differs from the allowlist in the test.
    Each allowlist entry states why organizers need the route;
  - a page under `app/src/app/[locale]/admin` calls `isAdminAuthenticated` or `requireAdmin` (the old
    check-and-redirect pattern), or calls none of `soloAdmin`, `staffOLogin` or `getStaffSession`.
    The sign-in page, the link landing page and the token-only edit page are the listed exceptions.

  The test reads each file as a whole, not each HTTP method. A route file whose `GET` calls
  `requireStaff` and whose `POST` stays administrator-only counts as open, and its reason in the
  allowlist says which part organizers use, for example "read-only".
  `POST /api/events` and `POST /api/events/instant` sit outside `app/src/app/api/admin`, so the test
  does not cover them. They call `requireStaff` directly. The staff calendar feed
  (`GET /api/events/calendar` in admin mode) is in the same position: it reads the staff session
  and filters with `eventScope`.
- **The allowlisted menu.** `VOCI_ORGANIZZATORE` in `app/src/components/admin/admin-nav.tsx` lists the
  menu entries that organizers see. It is an allowlist, so a new section starts as administrator-only
  until someone decides otherwise. Pages follow the same rule: without an explicit staff guard, an
  organizer gets the access-denied page.

To open a route or a page to organizers, see
[Adding an API route](../development/extending.md#adding-an-api-route) and
[Adding a page](../development/extending.md#adding-a-page).

## Consequences

- **Every administration route and page has an explicit audience.** A signed-in staff member who
  lacks the role sees an explanation, not the sign-in page.
- **New features start as administrator-only.** Giving organizers a feature takes a guard with an
  ownership check, an allowlist entry with a reason and, if needed, a menu entry. The project accepts
  that cost.
- **The sign-in email uses the platform's email languages**, like every other platform email
  ([The one-time email link](../architecture/identity-and-access.md#the-one-time-email-link)).
- **Account actions are audited.** The administrative audit log (`AdminAuditLog`, table
  `admin_audit_logs`) records `STAFF_LOGIN`, `ORGANIZER_CREATE`, `ORGANIZER_INVITE`,
  `ORGANIZER_UPDATE`, `ORGANIZER_DEACTIVATE` and `ORGANIZER_DELETE`. An organizer's own actions carry
  the actor `organizer:<accountId>`. The actor format is in
  [Audit actor format](../architecture/identity-and-access.md#audit-actor-format).
- **A departing organizer is contained, except for named grants and already-issued Jitsi tokens.**
  Deactivation closes the session and rotates the primary links of the events they own. It does not
  revoke the named grants on those events, and Jitsi tokens already issued stay valid until they
  expire.
- **Staff personal data is minimal.** An account stores an encrypted name and email address, a keyed
  email hash, a role, an active flag, its creation time and its last sign-in time, and no password.
  Accounts stay until an administrator deletes them ([Staff accounts](../GDPR.md#staff-accounts)).
  Staff actions are also recorded in `AdminAuditLog` with the IP address and user agent, and no job
  deletes those rows ([Audit trails](../GDPR.md#audit-trails)).

## Alternatives considered

- **Give organizers the instance key.** This was rejected. The key opens the whole installation:
  configuration, other people's events and every participant's personal data.
- **Let `isAdminAuthenticated` admit organizers and block the administrator-only routes.** This was
  rejected. A deny-list fails open: any route that nobody reviewed for the new role would admit
  organizers. Keeping the administrator guard strict and allowlisting the reviewed routes fails
  closed.
- **Accounts with passwords.** This was rejected for the same reasons as for moderators
  ([ADR-003](003-moderator-magic-links.md)): password storage, reset flows and lockout rules add
  risk without adding assurance. An email link proves control of the work mailbox, which is the
  identity that the account records.
- **Accounts for moderators.** This was rejected. See
  [Moderators do not become accounts](#moderators-do-not-become-accounts).

## Implementation notes

| Concern | Where |
|---|---|
| Account, role and sign-in link models | `StaffAccount`, `StaffRole`, `StaffLoginToken` and `Event.createdById` in `app/prisma/schema.prisma` |
| Session, guards, ownership and list scope | `app/src/lib/auth/staff-session.ts` |
| Owner assignment at creation, and the series check (`series_not_manageable`) | `app/src/app/api/events/route.ts`, `app/src/app/api/events/instant/route.ts`, `app/src/app/api/admin/events/[id]/duplicate/route.ts` |
| Page gate (signature only) | `isValidAdminSession` in `app/src/middleware.ts` |
| Page audience helpers | `app/src/lib/auth/staff-page.ts`, `app/src/components/admin/access-denied.tsx` |
| Sign-in link issue and consumption | `app/src/lib/auth/staff-login.ts`, `app/src/app/api/staff/login-link/`, `app/src/app/[locale]/admin/access/` |
| Sign-in UI (**Send me the link**, **Sign in**) | `app/src/app/[locale]/admin/login/page.tsx`, `app/src/components/admin/staff-access.tsx` |
| Link lifetime | `app/src/lib/auth/staff-link-config.ts` |
| Account management | `app/src/app/api/admin/organizers/`, `app/src/components/admin/organizers-management.tsx` |
| Sign-in email text | `staffLoginEmail` in `app/src/lib/email/templates.ts` |
| Organizer menu | `VOCI_ORGANIZZATORE` in `app/src/components/admin/admin-nav.tsx` |
| Guard test | `app/src/lib/auth/staff-access.test.ts` |

## Related

- [Identity, access and tokens](../architecture/identity-and-access.md): staff sign-in, sessions,
  guards and the audit actor format
- [ADR-003](003-moderator-magic-links.md): seats and magic links, which this record builds on
- [ADR-009](009-admin-session.md): the instance key and the session cookie, which this record extends
- [ADR-011](011-person-rubrica.md): the address book, which stays administrator-only
- [ADR-015](015-named-administrators.md): named administrators, which extend this record
- [Privacy and data protection](../GDPR.md#staff-accounts): staff data and its retention
- [Security architecture](../architecture/security.md#rate-limits-and-abuse-controls): rate limits
  on the sign-in routes
- [Extending PA Webinar](../development/extending.md) and [Testing](../development/testing.md):
  opening a route or a page to organizers
