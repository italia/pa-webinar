# ADR-001: Embed Jitsi Meet through the IFrame API

**Status:** Accepted

## Context

PA Webinar is an event platform, not a video-conferencing product. Registration, the waiting room,
live interaction, moderation, recording and AI post-production are what it adds. The conference itself
(media capture, encoding, simulcast, ICE, layouts, device handling) is a large and security-sensitive
body of code that the project does not want to own.

Jitsi Meet provides that conference as a complete, maintained web UI. Every public administration (PA)
that reuses PA Webinar also inherits its Jitsi upgrades, so whatever integration is chosen has to keep a
Jitsi upgrade cheap: ideally an image bump followed by a checklist, never a merge project.

Jitsi offers three ways to build on it:

- embed its complete UI through the IFrame API (`external_api.js`) and drive it with commands and events;
- build a new client on `lib-jitsi-meet`, the low-level library underneath that UI;
- fork `jitsi-meet` and change its source.

## Decision

**The portal embeds Jitsi Meet through the IFrame API**, keeps Jitsi's native toolbar in trimmed form,
and builds its own wrapper around the iframe.

### The native toolbar stays, trimmed

Every role gets Jitsi's native toolbar, and it stays visible. The participant toolbar is not empty: on
desktop it carries the essential media controls (microphone, camera, screen sharing, background, device
settings, layout and raised hand), so nobody depends on the portal to reach them. An event's participant
policies can take the microphone, camera or screen-sharing button away from participants. Moderators get
a larger set with Jitsi's own room-management buttons. Narrow screens (below 768 px, in practice phones)
get a shorter set, chosen once when the room opens.

Buttons are removed where the portal owns the function or where the native one works against the
event:

- no native hangup for any role: every exit goes through a portal control. **Leave room** serves every
  role and asks a moderator whether to **Just leave** or **End for everyone**; **End event** in the
  moderator control bar ends the event for all;
- no native chat button: the portal's chat panel is the chat;
- no native fullscreen: it would cover only the iframe and hide the drawer, so the portal offers its own
  **Fullscreen** for the whole live area;
- the native reactions button only when the `reactionsMode` site setting selects Jitsi's reactions
  (the default) instead of the portal's reaction bar.

Jitsi's pre-join page is off: the portal's waiting room and device check come first. On desktop their
camera and microphone choices become the room's start state (narrow screens always join muted), and
the chosen background is applied on join.

### The portal builds the wrapper

Around the iframe the portal draws what an event needs and a meeting tool does not have: the top bar,
the moderator control bar (mute all, audio and video moderation, recording, the raised-hand queue,
the presentation timer), the drawer with the live panels, and the participants panel. The live panels
keep their data in the portal, not in Jitsi (see
[ADR-005](005-live-interaction-in-portal.md)).

### JitsiRoom is the single instantiation point

`JitsiRoom` is the only code that creates a `JitsiMeetExternalAPI`. It is a Client Component that loads
`external_api.js` from the conference host, merges the static configuration with the per-role,
per-device and per-event values, creates the iframe with the portal-signed JWT, and calls `dispose()` on
unmount.

It then hands the API object to the live room. The moderator control bar, the raised-hand queue and the
participants panel send their commands on that same object and register their own listeners on it. None
of them creates a second one. There is one conference per page and one owner of its lifecycle.

### Sanctioned extension points

The IFrame API is the first rung of a ladder. A change uses the least invasive rung that works:

| Rung | Used for |
|---|---|
| 1. IFrame API commands and events | Quality, backgrounds, moderation, recording, raised hands, leaving |
| 2. Configuration overrides (`configOverwrite`, `interfaceConfigOverwrite`) | Toolbars, disabled features, quality presets, start state. What the IFrame API ignores, such as theming, is set in the official images' server-side configuration instead |
| 3. JWT authentication, verified by Prosody | Who may join which room |
| 4. A Prosody module | The room role taken from the token |
| 5. A patched web bundle | Fixes that have no configuration point |

Two rungs are recorded in their own decisions: the JWT in [ADR-004](004-jitsi-jwt.md) and the patched
bundle in [ADR-017](017-patched-jitsi-web-image.md). The mechanics of every rung, the Prosody module
included, are in [the extension ladder](../architecture/jitsi-integration.md#the-extension-ladder).

The per-participant recorder bot is not a rung of this ladder. It is the deliberate exception recorded
in [ADR-013](013-multitrack-speaker-attribution.md): see
[where lib-jitsi-meet still appears](#where-lib-jitsi-meet-still-appears).

## Consequences

### What the decision buys

- **WebRTC stays in Jitsi's client.** Tracks, simulcast, ICE and codecs are maintained upstream. No
  media code runs in the portal.
- **The API always matches the conference.** The conference host serves `external_api.js` together
  with the UI it drives. The portal has no npm dependency on Jitsi: it declares the part of the API it
  uses as local types.
- **Upgrades follow a checklist, not a merge.** Bumping Jitsi means bumping the subchart and the
  images, rebuilding the patched web image on the same release, and re-checking the keys and events the
  portal relies on. The steps are in the
  [Jitsi upgrade checklist](../architecture/jitsi-integration.md#jitsi-upgrade-checklist).

### What it costs

Each cost is detailed in [limits of the boundary](../architecture/jitsi-integration.md#limits-of-the-boundary).

- **Two browser contexts.** The portal (for example `webinar.example.com`) and the conference
  (`meet.webinar.example.com`) run on separate origins and talk only through the IFrame API's messages,
  so the portal cannot read or clear what Jitsi stores in the browser. The portal's Content Security
  Policy and Permissions-Policy must allow the conference host and delegate camera, microphone and
  screen capture to it ([SECURITY-CSP](../SECURITY-CSP.md)).
- **Identity does not cross the boundary.** Inside the iframe a participant is an endpoint ID and a
  display name, not the portal user in the JWT. Headcounts therefore de-duplicate people by normalized
  display name, and the recorder bot is recognized by its reserved display name. The participants panel
  still lists every connection.
- **Features stop at the API surface.** A remote command can set an image background but not blur, and
  can toggle only your own raised hand, so a moderator's **Lower hand** travels over the portal's
  realtime channel. The look inside the conference changes only on the server
  ([branding limits](../architecture/jitsi-integration.md#branding-limits)).
- **Configuration is fixed when the iframe is created.** Changing the role, a participant policy, the
  quality preset or the reactions mode means a new iframe and a rejoin. The UI language is deliberately
  left out, so switching language does not disconnect anyone.
- **Removing a button does not remove the feature.** Jitsi's chat stays reachable through private
  messages, which the portal neither stores nor moderates. An action that must be refused is refused by
  Jitsi's server-side roles, which the JWT sets ([ADR-004](004-jitsi-jwt.md)), not merely hidden from the
  toolbar.

### Where lib-jitsi-meet still appears

`lib-jitsi-meet` never runs in the portal. It runs only where there is no UI to embed: the recorder bot,
which needs every remote audio track separately, and test harnesses. Both run headless Chrome and load
the library from the conference host, so they follow the served Jitsi version too.

The recorder bot is a separate headless client. It joins on a hidden XMPP domain when
`recorder.hiddenDomain` is set; otherwise it joins with a portal JWT under a reserved display name, and
Jitsi still shows it ([the hidden domain](../architecture/jitsi-integration.md#the-hidden-domain-for-the-recorder-bot)).

## Alternatives considered

### lib-jitsi-meet with a custom UI

This alternative gives complete control over layout and behavior. It also means rebuilding every
control, layout and media state in the portal, and handling tracks, simulcast and ICE in portal code.
The library version would be fixed at portal build time while the server moves on, and media code would
run in the portal's origin. The control it adds is not needed for events, and its maintenance cost
would fall on every reuser. Rejected for the portal, and kept for headless clients.

### Forking jitsi-meet

A fork allows any change, including theming inside the conference. It also turns every upstream
release, security fixes included, into a merge that each reusing administration would have to repeat.
Rejected. The one sanctioned change to a Jitsi artifact is narrower than a fork: two fixes to the
minified bundle, each located by its shape and required to match exactly once, and one CSS rule
appended to the stylesheet. The image build fails when any of their targets is missing
([ADR-017](017-patched-jitsi-web-image.md)).

## Implementation notes

- **Instantiation.** `JitsiRoom` is `app/src/components/jitsi/jitsi-room.tsx`. The conference host is the
  runtime value of `NEXT_PUBLIC_JITSI_DOMAIN`, read on the server with `getPublicEnv()`. At mount it
  picks the narrow-screen toolbar with the viewport query `(max-width: 767.98px)` and, on narrow
  screens, forces `startWithAudioMuted` and `startWithVideoMuted`. It applies the waiting-room
  background with the `setVirtualBackground` command on `videoConferenceJoined`, and retries when the
  camera is turned on if the image could not be delivered yet.
- **Consumers of the API object.** The moderator control bar
  (`app/src/components/jitsi/moderator-controls.tsx`), the raised-hand queue
  (`app/src/components/jitsi/raised-hands-panel.tsx`), the participants panel
  (`app/src/components/participants/participant-panel.tsx`) and the live room
  (`app/src/components/live/live-event-client.tsx`) call `addListener` on the object they receive. The
  shared hook `app/src/hooks/use-jitsi-events.ts` exposes the participant count, recording state and
  mute state.
- **Configuration and guard tests.** The toolbar sets (`baseToolbarButtons`, `moderatorToolbarButtons`,
  `mobileBaseToolbarButtons`, `mobileModeratorToolbarButtons`) and the static overrides, including
  `prejoinConfig: { enabled: false }`, live in `app/src/lib/jitsi/config.ts`. The guard tests in
  `app/src/lib/jitsi/config.test.ts` and `app/src/lib/jitsi/theme.test.ts` fail if a rule such as
  "no native hangup" is undone. The current lists are in
  [toolbars by role and device](../architecture/jitsi-integration.md#toolbars-by-role-and-device).
- **Reactions mode.** `reactionsMode` is a `SiteSetting` field whose default is in
  `app/prisma/schema.prisma`.
- **Types.** The part of the IFrame API the portal uses is declared in `app/src/types/jitsi.ts`.
- **Identity across the boundary.** `app/src/lib/jitsi/participants.ts` holds the de-duplicating
  headcount (`humanParticipantCount`) and the recorder bot's reserved display name
  (`RECORDER_DISPLAY_NAME`).
- **Authentication.** The portal signs the JWT in `app/src/lib/auth/jwt.ts`. The Prosody module is
  `infra/jitsi/prosody-plugins/mod_token_affiliation_custom.lua`.
- **Patched image.** `infra/jitsi-web-patched/`: `patch-bundle.mjs` patches `app.bundle.min.js`, and the
  `Dockerfile` appends the CSS rule to `css/all.css`.
- **Headless clients.** The recorder bot is `infra/recorder`; the hidden-domain wiring is in
  `infra/helm/pa-webinar/templates/cronjob-recorder.yaml`, and `recorder.hiddenDomain` defaults to empty
  in `infra/helm/pa-webinar/values.yaml`. A test harness that uses `lib-jitsi-meet` is
  `scripts/load-test/coherence-bots.mjs`.

## Related

- [How PA Webinar extends Jitsi Meet](../architecture/jitsi-integration.md)
- [Live interaction and realtime](../architecture/live-interaction.md)
- [ADR-004: Portal-signed Jitsi JWT with no personal data](004-jitsi-jwt.md)
- [ADR-005: Live interaction lives in the portal](005-live-interaction-in-portal.md)
- [ADR-013: Per-participant multitrack recording for speaker attribution](013-multitrack-speaker-attribution.md)
- [ADR-017: Patch the jitsi/web bundle by shape for fixes with no configuration point](017-patched-jitsi-web-image.md)
