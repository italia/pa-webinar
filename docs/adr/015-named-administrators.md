# ADR-015: Named administrators alongside the instance key

**Status:** Accepted

**Extends:** [ADR-014](014-organizer-role.md) (organizers), and through it
[ADR-009](009-admin-session.md) (the instance key and the session cookie)

## Context

[ADR-014](014-organizer-role.md) gave organizers named staff accounts that sign in with a one-time
sign-in link sent by email. Administration stayed as it was: the only way in was the instance API key
(`ADMIN_API_KEY`), shared by everyone who administered the installation
([ADR-009](009-admin-session.md)). That left three problems. Each one weighs more on a public body
that reuses the platform, because the people who administer an installation change over time.

- **The audit log told sessions apart, not people.** A key session is recorded only as a
  fingerprint of its session cookie, and that fingerprint changes every time the session is
  refreshed.
- **Nobody could be removed alone.** Excluding a person who left the public body meant changing the
  key for everyone, and even that does not end the key sessions that are already open.
- **The key is a long credential** that has to be stored safely and handed from person to person.

## Decision

### A second role on staff accounts

`StaffRole` is `ORGANIZER` or `ADMIN`, with `ORGANIZER` as the default (`app/prisma/schema.prisma`).
An `ADMIN` account signs in exactly like an organizer, with a one-time sign-in link sent to its email
address and no password. It has the same powers as the key: site settings, every event and its data,
the address book, the **GDPR audit** page and the staff accounts themselves.

Administrators manage staff accounts on the **Accounts** page (`/admin/organizers`, titled **Staff
accounts**). There they create an account with either role, promote an organizer, demote an
administrator, and deactivate, reactivate or delete an account. Only administrators reach that page
and its API under `/api/admin/organizers`, whether they signed in with the key or with an account.

### The role is read from the account, not from the token

For an account session, `getStaffSession` (`app/src/lib/auth/staff-session.ts`) verifies the cookie
and then reads the `StaffAccount` row on every request, using its `role` and its `active` flag. The
lookup is memoized for the duration of a server render (React `cache`), so a layout and its page
share one database read. Promoting, demoting or deactivating someone therefore takes effect
on that person's next request, not when their cookie expires.

The role written in the token serves only the middleware. The middleware cannot read the database,
and it decides only whether a staff member may enter the administration area at all. The session
refresh re-mints the token with the account's current role, so the token catches up after a change.

`isAdminAuthenticated` (`app/src/lib/auth/admin-session.ts`) goes through the same session. It is
true for the key and for active `ADMIN` accounts, and it stays false for organizers. Every route that
was already reserved to administrators opens to named administrators without any change, and the
rule of ADR-014 still holds: a route that was not reviewed for organizers keeps refusing them.

### The key stays

The instance API key remains for three uses:

- the first sign-in of a new installation;
- emergencies;
- automation, where a script exchanges the key for a session through `POST /api/admin/login`.

Whoever signs in with the key creates the named administrators on `/admin/organizers`. From then on
the key can stay locked away.

### Nobody acts on themselves

An administrator cannot demote, deactivate or delete their own account. The API answers 403
`not_on_self`, and the interface replaces the actions on the administrator's own row with **Your
account is managed by another administrator**. Without this rule, one mistake could leave the
installation with nobody to administer it and the key as the only way back in.

A key session has no account, so the rule does not restrict it. Any administrator can manage the
accounts of the other administrators.

### Audit log

The actor of an audited action is `admin:<accountId>` or `organizer:<accountId>`. The role prefix
comes from the account at the time of the action, not from the token. The key has no holder, so key
sessions are still recorded by the fingerprint of the session cookie
([audit actor format](../architecture/identity-and-access.md#audit-actor-format)). A role change is
recorded under its own action, `STAFF_ROLE_CHANGE`, so a promotion never looks like a name
correction.

### Event ownership

An event that a named administrator creates is owned by that administrator (`Event.createdById`).
The same holds for instant calls and for the copy of a duplicated event. A legacy publication added
under **Publications** (`POST /api/admin/publications`, event type `LEGACY`) is created without an
owner, whoever creates it. If the administrator is later demoted to organizer, the events they own
stay theirs, and they keep managing them as an organizer. Events created with the key have no owner
and belong to the administration, as before.

## Consequences

- **Someone leaves.** Deactivating or deleting an administrator works as it does for an organizer.
  The session stops working on its next request, and unused sign-in links stop working too. The
  primary moderator link of every event the account owns is rotated. The links of other events are
  not rotated, although an administrator may have seen them: rotating them all would break the
  moderator link of every event on the installation. Treat those links as known to someone who no
  longer has access: regenerate the links of the events that matter with **Regenerate** on the
  **Moderators** page (`/admin/moderators`).
- **Demotion does not rotate links.** Demoting an administrator to organizer changes what the
  administration area shows them from their next request. It rotates no moderator link, although as
  an administrator they could read the primary moderator link of every event on the **Moderators**
  page, and a moderator link still lets its holder edit, publish or delete its event. If the demotion
  is meant to withdraw trust, regenerate the links of the events that matter on that page.
  Deactivating the account instead ends its session, but it too rotates only the links of the events
  the account owns.
- **A deleted administrator's events stay.** `createdById` becomes null, and the events return to
  the administration.
- **Promotion is a wide grant.** An administrator can read the data of every event and the address
  book. Changing an account's role to administrator asks for explicit confirmation (**Make
  administrator?**). The creation form offers both roles with a help text that says what an
  administrator can manage, and it has no separate confirmation step.
- **Accountability survives refreshes.** A named administrator keeps the same actor in the audit log
  across refreshes and sign-ins. A key session still appears as a fingerprint that changes, which is
  one more reason to keep the key out of daily use.
- **The key is still a shared secret.** Named accounts reduce how often it is used, not what it can
  do. Changing `ADMIN_API_KEY` stops new key sign-ins but does not end the key sessions already open.
  [ADR-009](009-admin-session.md) describes how sessions end.
- **Sign-in and sessions are unchanged.** The sign-in flow, the session lifetime and its renewal are
  those of ADR-014.

## Alternatives considered

- **Keep only the key, and change it when someone leaves.** This was rejected. Changing
  `ADMIN_API_KEY` stops new key sign-ins but does not end the key sessions already open
  ([ADR-009](009-admin-session.md)), so the person who left could keep working until their session
  lapsed. Everyone who stays also has to learn the new key, and the audit log still could not tell
  the people apart.
- **An external identity provider.** This was rejected for the reasons given in
  [ADR-009](009-admin-session.md#oauth-20-or-openid-connect-with-an-external-identity-provider):
  every reusing administration would need a reachable identity provider and a registered client,
  and a new installation would still need a local credential for its first sign-in and for scripts.
- **Trust the role written in the token.** This was rejected. A promotion, demotion or deactivation
  would take effect only when the token expired, and the sliding refresh, which keeps an active
  session alive, would keep extending the old role for as long as the person kept working. Reading
  the account on every request makes each change take effect on the next request.
- **Rotate every event's moderator link when an administrator leaves.** This was rejected. An
  administrator may have seen every link, but rotating them all would break the moderator link of
  every event on the installation. Only the links of the events the account owns are rotated, and
  the rest are regenerated by choice (see [Consequences](#consequences)).

## Implementation notes

- **Role.** `StaffRole` (`ORGANIZER`, `ADMIN`) and `StaffAccount.role`, with `ORGANIZER` as the
  default, are in `app/prisma/schema.prisma`. `Event.createdById` points to `StaffAccount` with
  `onDelete: SetNull`.
- **Session and guards.** `getStaffSession` in `app/src/lib/auth/staff-session.ts` verifies the
  `admin_session` cookie and, for an account session, reads the account's `role` and `active` flag.
  It is wrapped in React `cache`. `requireAdmin` in the same file admits the key and active `ADMIN`
  accounts, and returns the session's `accountId` (null for the key), which the account routes use
  for the self rule. `isAdminAuthenticated` in `app/src/lib/auth/admin-session.ts` goes through
  `getStaffSession`. `signStaffSession` writes the role claim that the middleware reads, and
  `POST /api/admin/refresh` (`app/src/app/api/admin/refresh/route.ts`) re-mints it with the
  account's current role.
- **Account management.** `app/src/app/api/admin/organizers/route.ts` lists accounts and creates
  them with either role. `app/src/app/api/admin/organizers/[id]/route.ts` changes the name, the role
  and the `active` flag, and deletes accounts. It answers 403 `not_on_self` when an administrator
  demotes, deactivates or deletes their own account. A role change is logged as `STAFF_ROLE_CHANGE`
  with the new role in its details.
- **Link rotation.** `ruotaTokenEventi` in `app/src/app/api/admin/organizers/[id]/route.ts` gives
  every event the account owns a new `moderatorToken`. Deactivation calls it after deleting the
  account's unused `StaffLoginToken` rows, and deletion calls it before deleting the account. A role
  change alone does not call it.
- **Sign-in links.** `POST /api/admin/organizers/{id}/invite` sends a new sign-in link to an active
  account. An earlier unused link stays valid until it expires.
- **Interface.** `app/src/components/admin/organizers-management.tsx` shows the **Make
  administrator?** confirmation and, on the administrator's own row, **Your account is managed by
  another administrator**.
- **Audit actor.** `deriveActor` in `app/src/lib/audit/admin-audit.ts` reads the account's role at
  the time of the action to write `admin:<accountId>` or `organizer:<accountId>`. A key session is
  written as the first 16 hex characters of the SHA-256 of its cookie.
- **Ownership.** `app/src/app/api/events/route.ts`, `app/src/app/api/events/instant/route.ts` and
  `app/src/app/api/admin/events/[id]/duplicate/route.ts` set `createdById` from the session's
  `accountId`. `app/src/app/api/admin/publications/route.ts` does not set it.
- **Guard test.** `app/src/lib/auth/staff-access.test.ts` fails if a route or page of the
  administration area does not declare who may use it.

## Related

- The organizer role, ownership and the guards this record builds on:
  [ADR-014](014-organizer-role.md)
- The instance key, the session cookie and what they cost: [ADR-009](009-admin-session.md)
- The moderator link as a seat, and why it is rotated: [ADR-003](003-moderator-magic-links.md)
- Account management, sign-in and sessions in detail:
  [managing staff accounts](../architecture/identity-and-access.md#managing-staff-accounts),
  [staff sign-in](../architecture/identity-and-access.md#staff-sign-in),
  [sessions](../architecture/identity-and-access.md#sessions)
- Where each guard is enforced:
  [where authorization is enforced](../architecture/identity-and-access.md#where-authorization-is-enforced)
- Staff personal data and the audit trail:
  [staff and guest data](../GDPR.md#staff-and-guest-data), [audit trails](../GDPR.md#audit-trails)
