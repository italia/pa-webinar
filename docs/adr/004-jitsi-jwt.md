# ADR-004: Portal-signed Jitsi JWT with no personal data

**Status:** Accepted

**Related decisions:** [ADR-001](001-jitsi-iframe-api.md) (embedding Jitsi Meet),
[ADR-003](003-moderator-magic-links.md) (seats and magic links),
[ADR-013](013-multitrack-speaker-attribution.md) (the recorder bot)

## Context

PA Webinar embeds Jitsi Meet for audio and video ([ADR-001](001-jitsi-iframe-api.md)) and keeps
everything else in the portal: registration, consent, join passwords, the event's status, and who
moderates or speaks ([ADR-003](003-moderator-magic-links.md)). Jitsi still has to decide, on its own
side, whether a connection may enter a conference and with which role. Prosody, Jitsi's XMPP server,
makes that decision.

Three constraints shape the bridge between the two:

- **The portal is the only gate.** If the conference could be joined without the portal's approval, a
  direct link to the Jitsi host would skip every check the portal makes: registration, join passwords,
  the guest-access setting and the event's status.
- **Whatever Jitsi receives about a participant, the room sees.** Jitsi publishes each participant's
  identity, including the display name and the avatar URL, in XMPP presence to every other participant.
  Anything placed in the token's user context must be treated as published to the audience.
- **Jitsi must not become a second store of personal data.** Otherwise the controller would have to
  describe, secure and purge it separately from the portal.

## Decision

### The portal signs, Prosody verifies

For every entry into a conference, the portal mints a short-lived JSON Web Token and hands it to the
Jitsi IFrame API. Prosody runs token authentication and admits only connections that present a token it
can verify.

- **One signer.** `generateJitsiJwt()` in `app/src/lib/auth/jwt.ts` signs every token with HS256 and
  the shared secret `JITSI_JWT_SECRET`. It refuses to sign when the secret is missing. Two routes call
  it: `POST /api/events/{slug}/jitsi/token` for people, and `POST /api/internal/recorder-claim` for the
  recorder bot, which authenticates with the machine key.
- **One verifier.** Prosody is configured for token authentication (`AUTH_TYPE: jwt`, with
  `jitsi-meet.enableAuth: true` in the chart) and holds the same secret as `JWT_APP_SECRET`.
- **Jitsi's own guests stay off.** Jitsi's anonymous guest access is disabled
  (`jitsi-meet.enableGuests: false` in the chart, `ENABLE_GUESTS=0` in Docker Compose). A PA Webinar
  guest, meaning someone who joins a `LIVE` event without registering, still holds a portal-signed token.

Three values must agree between the two sides: the signing secret, the issuer and the audience. A
fourth, the app ID, is kept aligned by convention, and the subject matters only when Prosody verifies
the domain.

| Value | Portal environment | Prosody environment | Default |
|---|---|---|---|
| Signing secret | `JITSI_JWT_SECRET` | `JWT_APP_SECRET`, the same value. In Docker Compose both read `${JITSI_JWT_SECRET}`. The ways to supply it in the chart are in [The Prosody JWT secret](../DEPLOYMENT.md#the-prosody-jwt-secret) | None in the chart or the portal, and signing fails without it. Docker Compose and `.env.example` use a development-only placeholder |
| Issuer (`iss`) | `JITSI_JWT_ISSUER` | Must appear in `JWT_ACCEPTED_ISSUERS`, a comma-separated list | `pa-webinar` |
| Audience (`aud`) | `JITSI_JWT_AUDIENCE` | Must appear in `JWT_ACCEPTED_AUDIENCES`, a comma-separated list | `jitsi` |
| App ID | `JITSI_JWT_APP_ID` | `JWT_APP_ID`. Kept aligned by convention: the portal uses it only as the prefix of the `jti` claim | `pa_webinar` |
| Subject (`sub`) | `JITSI_JWT_SUBJECT` (an empty value counts as unset) | Prosody requires a non-empty `sub`, and compares it with its XMPP domain only when `JWT_ENABLE_DOMAIN_VERIFICATION` is on, which the chart and Docker Compose leave off. Whoever turns it on sets `JITSI_JWT_SUBJECT` to the XMPP domain or `*` | `localhost:8443` (`DEFAULT_JITSI_JWT_SUBJECT`) |

The defaults come from `app/src/lib/auth/jwt.ts`, `infra/helm/pa-webinar/values.yaml` and
`docker-compose.yml`, and they agree.

### What the token carries

The token carries what Jitsi needs to admit, label and grant permissions to one connection, and
nothing more:

- **A display name**, the one the room shows.
- **An opaque identifier for this entry.** It is different for every entry, including a second tab, and
  it embeds only database keys that mean something to the portal alone.
- **A role.** Moderators are owners of the conference. Everyone else is a member, including speakers
  (`SPEAKER` grants): the portal gives speakers full audio and video controls, but Jitsi's own
  permissions still deny them moderator-only actions.
- **The room.** The token is limited to one conference, the event's `jitsiRoomName`, which contains
  neither the title nor the slug.
- **Features**, the Jitsi functions the seat may use, such as recording or screen sharing.
- **An avatar**, as described [below](#avatars-without-a-third-party-in-the-browser).
- **The standard claims** that Prosody verifies: issuer, audience, subject, token ID, issue time and
  expiry.

The claim table, the identifier formats and an example token are in
[Identity, access and tokens](../architecture/identity-and-access.md#claims).

### What the token never carries

- **No email address and no email hash**, in any claim. That covers the keyed `emailHash` that the
  portal stores for lookups (HMAC-SHA-256 with `APP_SECRET`), and it covers a readable Gravatar MD5. The
  only value derived from an address that can appear is the encrypted Gravatar reference described
  below, which only the portal can read.
- **No registration data**, such as organization, answers or consent state, and **no event title**.

The display name is the only personal data in the token that people in the room can read, and every
other participant sees it on screen anyway. The portal controls where the name comes from:

- A registrant's stored name goes into the token only in the browser that registered, the one holding
  the signed `event_access_<eventId>` cookie. Whoever opens a forwarded personal link joins as a guest,
  under the name they type.
- The shared primary moderator link requires a typed name, so that moderators do not all appear under
  one generic name.
- The client passes Jitsi nothing else about the person. In `app/src/components/jitsi/jitsi-room.tsx`,
  `userInfo` carries only the display name. The portal sets no conference statistics ID, so the logs of
  Jitsi's components, such as Jicofo's and the bridge's, carry a random one.

### Avatars without a third party in the browser

- **By default, initials.** The avatar is an SVG with the person's initials, inlined in the token as a
  data URI. It triggers no request to anyone.
- **Gravatar only by opt-in, and only through the portal.** When an administrator turns Gravatar on in
  the site settings and the seat has an email address, the avatar becomes a link to the portal's own
  proxy. The participant's browser never contacts gravatar.com.
- **The link carries an encrypted reference, never a bare MD5.** Gravatar's protocol needs the MD5 of
  the address, but the whole room receives the avatar URL. Email addresses are easy to guess, so a bare
  MD5 would let any participant test guessed addresses against everyone present. The reference in the link
  is that MD5 encrypted under `PII_ENCRYPTION_KEY`: it reveals nothing, and only the portal can decrypt
  it.

How the proxy works, and which seats can show a Gravatar, are in
[Avatars](../architecture/identity-and-access.md#avatars). What Gravatar receives, and the legal view of
it, are in [Privacy and data protection](../GDPR.md). The toggle is described in
[Runtime settings](../configuration/runtime-settings.md).

### Short lifetimes

Every token is short-lived. People's tokens last a couple of hours at most, and the recorder bot's
token is bounded by the time left in the event. Jitsi keeps no revocation list for these tokens, so
expiry is the only thing that stops a copied token from being used to join. Re-entering through a magic
link mints a fresh token, and the live room's automatic reconnect asks the portal for a fresh token
instead of reusing the old one.

The lifetime of each seat is in
[Seats, identifiers and lifetimes](../architecture/identity-and-access.md#seats-identifiers-and-lifetimes).
The rules on who gets a token and when are in
[When a Jitsi token is issued](../architecture/identity-and-access.md#when-a-jitsi-token-is-issued).

## Consequences

### What the decision buys

- **Jitsi keeps no personal records of its own.** Prosody holds no accounts for people, so the
  no-accounts model of [ADR-003](003-moderator-magic-links.md) reaches into the conference. The identity
  data that Jitsi receives from the portal comes down to a display name and an avatar. Media streams and
  network addresses are outside the scope of this decision.
- **Conference access is decided in the portal.** The token endpoint enforces the status checks, the
  registration-link binding, the guest-access setting for scheduled events and, for guests without a
  registration link, the join password. The recording-consent step is part of the live page, which
  shows it before it requests the token; the endpoint itself does not check consent. The per-seat rules
  are in
  [When a Jitsi token is issued](../architecture/identity-and-access.md#when-a-jitsi-token-is-issued).
- **The rule is tested.** `app/src/lib/auth/jwt.test.ts` asserts that the avatar never carries the
  address, its domain or the bare MD5. It also asserts that the Gravatar link points at the portal's
  proxy and never at gravatar.com.

### What it costs

- **No revocation before expiry.** Revoking a named grant or rotating the primary moderator link stops
  the portal from issuing new tokens. It does not invalidate tokens already issued: a copied token can
  still be used to join until its `exp`. That is why the lifetimes are short.
- **A personal link is an entry credential.** Whoever opens a forwarded registration link gets a token
  under a fresh guest identity and the name they type, while the event is `PUBLISHED` or `LIVE`. The
  join password and the guest-access setting do not apply to that path.
- **One shared secret with full power.** With HS256, whoever holds `JITSI_JWT_SECRET` can mint a token
  for any room, with any role. The load-test tooling in `scripts/load-test/` does exactly that, on
  purpose. The portal checks only that the secret is present, not its strength or whether it is the
  development placeholder: generate a long random value (for example `openssl rand -hex 32`) for every
  installation, and handle it like any production credential. In `generate` and `external` secrets
  modes, the chart can render Prosody's copy into a separate Secret (`secrets.jitsiJwtSecretName`). In
  `external` mode it comes from the same remote entry as `JITSI_JWT_SECRET`. Keeping it separate keeps
  the portal's other keys out of Prosody's environment. Rotate the secret on both sides together,
  outside events: once Prosody runs with the new secret, tokens already issued no longer work for
  joining or reconnecting.
- **A mismatch fails silently.** If the secret, issuer or audience differ, Prosody rejects every token
  and nobody can join. The portal shows a room that never opens, with no error. The chart guard
  `pa-webinar.validateJitsiJwt` catches some misconfigurations at render time: no secret source, the
  same setting supplied two conflicting ways, a Secret name mismatch, and in `generate` mode an issuer
  or audience that Prosody does not accept. It never compares secret values and cannot check an
  external Jitsi. Review these
  values by hand, and join a test room after every change. Details:
  [Deploying with Helm](../DEPLOYMENT.md#the-prosody-jwt-secret).
- **The token states the role; the conference enforces it only with the right wiring.** Whether Jitsi
  turns `affiliation: owner` into conference-level moderator rights depends on Prosody modules and on
  Jicofo assigning no roles of its own. The chart's default values and the Docker Compose stack wire
  them; an external Jitsi, or values that replace the chart's Prosody volumes, must provide them. See
  [Server-side role enforcement](../architecture/jitsi-integration.md#server-side-role-enforcement).
- **The user context is public to the room.** Adding a field to `context.user`, or a parameter to the
  avatar URL, is a privacy decision, and it must respect this record.
- **The recorder bot can join without a token.** When `recorder.hiddenDomain` is set, the bot signs in
  with an XMPP account on Prosody's hidden domain instead of a portal JWT, so that Jitsi hides it from
  the room. That single account is allow-listed through `token_verification_allowlist`, and whoever holds
  its password can enter any room without a token. See
  [The hidden domain for the recorder bot](../architecture/jitsi-integration.md#the-hidden-domain-for-the-recorder-bot).

## Alternatives considered

### Jitsi's internal authentication

Prosody can authenticate against its own accounts, with a password for each user. Every moderator would
then need an account, which contradicts [ADR-003](003-moderator-magic-links.md). Prosody would become a
second user store, with its own lifecycle and its own personal data. An account is also not scoped to
an event. In Jitsi's usual setup, where authenticated users open a room and others join as anonymous
guests, a room that is open lets anyone in, bypassing registration and the portal's other checks.
Rejected.

### Anonymous rooms with unguessable names

Without authentication, the room name would be the only secret. Room names reach every browser, and
links get forwarded, so anyone who reached the Jitsi host could join. They would bypass registration,
join passwords and the status checks. Moderator rights would go to whoever joined first. Rejected.

### OpenID Connect in front of Jitsi

Jitsi can delegate sign-in to an identity provider. Every participant in a public event would then need
an account with that provider, which is a barrier that public webinars cannot impose. The provider's
attributes, such as the email address and other identifiers, would flow toward the conference. And
every public body that reuses PA Webinar would have one more component to operate. Staff sign-in to the
portal is a separate question. An identity provider could be put in front of the portal later without
changing this decision, because the portal would still mint the conference token. Rejected for the
conference.

### Asymmetric signing

Prosody can also verify RS256 tokens against public keys that it fetches from a key server. That would
keep the signing key in the portal alone. It would also add a key server to publish and keep available,
while HS256 keeps an installation to one secret. Not adopted. Revisit it if the signing key must stay
out of the conference infrastructure.

## Related

- Claims, identifiers, lifetimes, avatars and token issuance:
  [Identity, access and tokens](../architecture/identity-and-access.md#the-jitsi-jwt)
- The Prosody side of authentication, role enforcement and the hidden domain:
  [How PA Webinar extends Jitsi Meet](../architecture/jitsi-integration.md#authentication-bridge-the-prosody-side)
- Trust boundaries, rate limits and the secrets map:
  [Security architecture](../architecture/security.md)
- The recorder claim and the bot's credentials: [Recording](../architecture/recording.md)
- Helm keys, secret modes and the render guard:
  [Deploying with Helm](../DEPLOYMENT.md#the-prosody-jwt-secret)
- Personal data and Gravatar: [Privacy and data protection](../GDPR.md)
- Code: `app/src/lib/auth/jwt.ts`, `app/src/lib/gravatar-ref.ts`, `app/src/app/api/avatar/route.ts`,
  `app/src/app/api/events/[param]/jitsi/token/route.ts`,
  `app/src/app/api/internal/recorder-claim/route.ts`,
  `infra/helm/pa-webinar/templates/_guards.tpl`
