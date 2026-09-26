# ADR-009: Administration by instance key and signed session cookie

**Status:** Accepted; extended by [ADR-014](014-organizer-role.md) (organizers) and
[ADR-015](015-named-administrators.md) (named administrators)

## Context

A new installation of PA Webinar needs an administration area from the moment it starts. That area
holds the site settings, event creation and publishing, registrations, recordings and the GDPR
registers. When this decision was taken, the only people who used it were the few operators of one
installation.

Several forces shaped how they sign in:

- **Every installation is different.** The public administrations (PAs) that reuse PA Webinar have
  different identity infrastructure, and some have none that the cluster can reach. If sign-in needed
  an external system configured first, a new installation could not be used until that integration
  worked.
- **No passwords.** The platform avoids storing passwords and running reset flows, the same choice
  [ADR-003](003-moderator-magic-links.md) makes for the people who run a room.
- **One image, one deployable** ([ADR-002](002-nextjs-fullstack.md)). The sign-in mechanism has to
  come from the environment, never from the build.
- **Scripts need a way in.** Smoke tests and operational scripts create events and read state through
  the same API as the browser.
- **The session is checked in more than one place.** The middleware decides whether an administration
  page may render, and it does not read the database. The page then checks the session again, and
  the route handlers under `/api/admin` decide whether a call may run. Mutations are route handlers
  called with `fetch` from the portal's own pages, not Server Actions.

## Decision

**A single instance API key, `ADMIN_API_KEY`, opens the administration area. The browser exchanges
it once for a signed session cookie. There is no OAuth and there are no user accounts.**

### The key

The operator sets `ADMIN_API_KEY` in the portal's environment (the application Secret on
Kubernetes). Whoever knows the key administers the whole instance. The key has no owner and no
expiry.

### The exchange

The login page posts `{ "key": "…" }` to `POST /api/admin/login`, and the route compares the value
with `ADMIN_API_KEY` in constant time. On a mismatch it answers 401. On a match it signs an HS256 JWT
with `APP_SECRET`. The token has the payload `{ "role": "admin" }` and a fixed lifetime, and the
route returns it in the `admin_session` cookie.

The key crosses the network once per sign-in. The browser does not keep it, and no route accepts it
as a bearer. After sign-in, the browser authenticates with the cookie, and so does any script.

### The cookie

| Attribute | Value | Why |
|---|---|---|
| `HttpOnly` | Always | Page script cannot read the token |
| `SameSite` | `Lax` | Browsers leave the cookie off cross-site subrequests and cross-site `POST`, `PUT` and `DELETE` requests |
| `Secure` | When `NODE_ENV=production` | The token never travels over plain HTTP in production |
| `Path` | `/` | Pages and the API both receive it |

The session is stateless. A request is authenticated when the token's signature verifies against
`APP_SECRET` and its expiry has not passed. There is no session table. The middleware runs this check
for pages under `/admin`, each page runs it again, and each route handler runs it for its own call.

### No CSRF tokens

The platform has no CSRF tokens and does not check `Origin`. Forged cross-site requests are stopped by
how callers authenticate. Seat tokens and machine keys travel in `Authorization` or `x-api-key`
headers, or in a `?token=` parameter that the caller must already know. The browser never attaches
them on its own. Cookies are `SameSite=Lax`, so a cross-site `POST` form or a `fetch` does not carry
them. Top-level `GET` navigations do, which is why a cookie-authenticated `GET` must never change
state. The full stance and its limits are in
[Security architecture](../architecture/security.md#csrf-stance).

## Consequences

### What the decision buys

- **Nothing to integrate before first use.** A new installation has an administrator as soon as its
  configuration holds a key. This is also the way in when every other sign-in path is broken.
- **The key stays out of the page.** It is typed once and never stored in the browser, and page
  script cannot read the session token that replaces it.
- **A key session needs no database.** A signature and an expiry are enough to check it, so the
  middleware can gate pages without reading the database.
- **Automation uses the same door.** A script posts the key, keeps the cookie and calls the API like
  the browser does.

### What it costs

- **A shared secret identifies nobody.** Everyone who holds the key is the same administrator. The
  audit log can record only a fingerprint of the session cookie, and that fingerprint changes each
  time the session is refreshed ([audit actor format](../architecture/identity-and-access.md#audit-actor-format)).
  Removing one person's access means changing the key for everyone, and ending the session they
  already hold means changing `APP_SECRET` as well (see below). This is the gap that
  [ADR-015](015-named-administrators.md) closes.
- **All or nothing.** The key opens configuration, every event and every participant's data. A person
  who only runs their own events cannot be given less. [ADR-014](014-organizer-role.md) adds that
  lesser role.
- **Key sessions cannot be revoked one at a time.** Logout clears the cookie in one browser but does
  not blocklist the token. Changing `ADMIN_API_KEY` refuses new sign-ins with the old key, but it does
  not end the sessions already open, and the refresh keeps extending a session that is in use. Only
  changing `APP_SECRET` ends every session at once. That change also voids the other cookies and values that `APP_SECRET`
  signs ([keys behind the credentials](../architecture/identity-and-access.md#keys-behind-the-credentials)).
- **The CSRF defense follows `SameSite` rules.** Browsers decide "same site" by the registrable
  domain, so a sibling host on the portal's domain, such as the conference host, is inside the
  boundary. A cookie-authenticated `GET` must never change state, and no ingress may add permissive
  CORS headers to `/api` ([CSRF stance](../architecture/security.md#csrf-stance)).
- **The key's strength is the defense against guessing.** Sign-in attempts are rate-limited per IP
  address, but the limiter keeps its counts in memory in each portal pod, so replicas do not share
  them. Use a long random value, for example `openssl rand -hex 32`.

### What later records changed

The exchange, the cookie and its attributes, the HS256 signature with `APP_SECRET`, and the absence
of OAuth and CSRF tokens all stand as decided here. Later records added people to the same cookie:

- [ADR-014](014-organizer-role.md) adds staff accounts with the `ORGANIZER` role. They sign in with a
  one-time sign-in link sent by email, and their token carries the account id as `sub`. The
  middleware admits both the `admin` and `organizer` roles.
- [ADR-015](015-named-administrators.md) adds accounts with the `ADMIN` role, so that administrators
  can act under their own names. The key remains for the first sign-in of a new installation, for
  emergencies and for automation. For account sessions, the role is read from the account on every
  request, not from the token.

## Alternatives considered

### OAuth 2.0 or OpenID Connect with an external identity provider

This would give personal accounts and central revocation. It would also require every reusing
administration to have an identity provider that the cluster can reach and to register a client. The
chart would have to carry a redirect flow and its configuration. A new installation would still need
a local credential for its first sign-in and for scripts. At the time, the few operators of one
installation did not justify that dependency. Not chosen, and not on the [roadmap](../ROADMAP.md).

### SPID or CIE

SPID and CIE, the Italian public digital identity systems, prove who a citizen is. They do not say
who belongs to the staff of an installation, so a local list of authorized people would still be
needed. Each installation would also have to join the national schemes as a service provider before
its first sign-in. The roadmap lists SPID/CIE sign-in for participants among its
[conditional items](../ROADMAP.md#conditional). Staff sign-in through SPID/CIE is not planned.

### Accounts with passwords

Password accounts bring hashing, reset flows, a password policy and more stored personal data. These
are the costs that [ADR-003](003-moderator-magic-links.md) avoids for moderators. When per-person
access came, it came without passwords, as one-time sign-in links
([ADR-014](014-organizer-role.md), [ADR-015](015-named-administrators.md)).

### The key as a bearer on every request

A stateless header with no session would be simpler. But the browser would then have to keep a
long-lived, non-expiring secret where page script can reach it, and the secret would travel on every
request. Exchanging the key once for a short-lived `HttpOnly` cookie keeps it out of the page. Not
chosen.

### CSRF tokens

A synchronizer token, a double-submit token signed and bound to the session, or an `Origin` check
would cover one case that `SameSite=Lax` does not: requests from sibling hosts on the same
registrable domain. (A plain double-submit cookie would not, because a sibling host can set cookies
for the parent domain.) A token would add machinery to every mutation and every client. The project
accepts that gap and requires that no host on the portal's domain runs content the operator does not
control. Not chosen.

## Implementation notes

- **Sign-in.** `app/src/app/api/admin/login/route.ts` rate-limits attempts per IP address and
  compares the key with `constantTimeEqual` (`app/src/lib/auth/moderator.ts`), which hashes both
  values before `timingSafeEqual`. When `ADMIN_API_KEY` is empty or unset, every attempt gets 401
  `invalid_key`, so key sign-in is effectively off, and `app/src/instrumentation.ts` logs a start-up
  warning. A successful sign-in signs `{ "role": "admin" }` with no `sub` and writes an
  `ADMIN_LOGIN` audit row.
- **Cookie and lifetime.** `app/src/lib/auth/admin-session.ts` sets the cookie attributes and holds
  the token lifetime (`ADMIN_SESSION_TTL_SECONDS`) and the longer cookie `Max-Age`
  (`ADMIN_COOKIE_MAX_AGE_SECONDS`). The cookie outlives the token only so that an expired session is
  recognizable as expired, and an expired token grants nothing. Current values are in
  [Sessions](../architecture/identity-and-access.md#sessions).
- **Signing key.** `app/src/lib/auth/app-secret.ts` requires `APP_SECRET` to be at least 32
  characters. Signing throws in production with a shorter value. Verification (`tryGetAppSecret`)
  fails closed in every environment. `app/src/instrumentation.ts` refuses to start in production
  when `APP_SECRET` is set but shorter than 32 characters. A missing value only logs an error, and
  key sign-in then fails with 500 `server_misconfigured`.
- **Refresh and logout.** `AdminSessionKeepAlive` (`app/src/components/admin/admin-session-keepalive.tsx`)
  calls `POST /api/admin/refresh` while the tab is visible and in use. The refresh re-mints the token
  with the session's current role and writes no audit row. `POST /api/admin/logout` clears the cookie
  and writes `ADMIN_LOGOUT`.
- **Page gate.** `app/src/middleware.ts` applies to pages only, because its matcher excludes `/api`.
  Under `/{locale}/admin` it verifies the signature and expiry, admits the roles `admin` and
  `organizer`, and redirects everything else to `/{locale}/admin/login`. Two cases pass without a
  session: the sign-in pages, and the event management page opened from a moderator link
  (`?token=`, [ADR-003](003-moderator-magic-links.md)).
- **Page guards.** Each administration page also checks the session itself with `staffOLogin` or
  `soloAdmin` (`app/src/lib/auth/staff-page.ts`), both through `getStaffSession`. This is the layer
  that re-reads a staff account, because the middleware checks only the signature and the role. The
  event management page resolves either the moderator link or the staff session itself, and the edit
  page opens only from the moderator link
  ([Page guards](../architecture/identity-and-access.md#page-guards)).
- **API guards.** Route handlers enforce access themselves, with `isAdminAuthenticated`
  (`app/src/lib/auth/admin-session.ts`) or the guards in `app/src/lib/auth/staff-session.ts`. Both
  resolve the session through `getStaffSession`. `app/src/lib/auth/staff-access.test.ts` fails if a
  route or page of the administration area does not declare who may use it.
- **Audit.** `app/src/lib/audit/admin-audit.ts` records a key session as the first 16 hex characters
  of the SHA-256 of its cookie. The `ADMIN_LOGIN` row carries no actor of its own. It records the
  cookie the request brought, which is usually none (`unknown`) or the expired previous session, so a
  key sign-in cannot be linked to the session it opens.

## Related

- [Identity, access and tokens](../architecture/identity-and-access.md): staff sign-in, sessions, where authorization is enforced, the cookie inventory
- [Security architecture](../architecture/security.md): the CSRF stance and rate limits
- [Configuration reference](../CONFIGURATION.md): `ADMIN_API_KEY`, `APP_SECRET` and the secrets map
- [ADR-003: Moderators and speakers by magic link, no accounts](003-moderator-magic-links.md)
- [ADR-014: The organizer role](014-organizer-role.md)
- [ADR-015: Named administrators alongside the instance key](015-named-administrators.md)
