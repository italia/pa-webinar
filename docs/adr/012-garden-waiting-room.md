# ADR-012: An optional 2D social waiting room

**Status:** Accepted

## Context

Every participant enters an event through the waiting room (`app/src/components/live/waiting-room.tsx`). It is a
functional page: the visitor sees the countdown, types a name, tests the camera and microphone, reads the etiquette
and waits. Someone who arrives ten minutes early waits for ten minutes with the optional waiting-room music.

For informal events, such as recurring community meetups or social breaks between work sessions, talking to other
people before the start is half the point of coming. The waiting room gave them no way to do that. The only shared space was the
event chat, which moderators also read.

Participant feedback asked for a 2D social space in pixel-game style, with:

- a customizable avatar;
- a garden with plants, kiosks, fountains and a DJ stand;
- free movement;
- a virtual DJ that plays music the visitor can choose;
- proximity chat, where you talk to whoever is near you;
- group chat for up to five people gathered around a point of interest.

The aim was to make arriving early something people want to do, and to break the ice before the formal part begins.

Four constraints shape any answer:

- **The waiting room is on the critical path.** Every participant passes through it to join. Anything added there
  must not be able to stop someone from entering a webinar.
- **Accessibility is a legal duty.** Italian public-sector software must meet WCAG 2.1 level AA, through EN 301 549
  as required by the accessibility guidelines of AgID (Agenzia per l'Italia Digitale, the Italian digital agency), and
  the Legge Stanca (Italian accessibility law, Law 4/2004).
- **Personal data must stay minimal.** Positions, avatars and conversations are new data about participants.
- **One deployable, one license.** The portal is a single Next.js application
  ([ADR-002](002-nextjs-fullstack.md)), released under the European Union Public Licence (EUPL-1.2).

## Alternatives considered

### Option A: integrate WorkAdventure

[WorkAdventure](https://workadventu.re/) is an open-source project that implements this pattern: tile maps, RPG-style
avatars, proximity conversations and meeting zones. It can be self-hosted and embedded in an iframe.

Pros:

- No game to build.
- A mature product with an existing community.
- Maps are edited with Tiled, a well-known open-source editor.
- Audio and video conversations are built in.

Cons:

- **License.** Its server and client packages are published under the GNU AGPL-3.0 with the Commons Clause added.
  A few client libraries use permissive licenses. Linking the core into the portal would make one combined work.
  EUPL-1.2's compatibility clause (Article 5) allows moving such a work only to a license listed in its appendix, such
  as plain AGPL-3.0. AGPL-3.0 with the Commons Clause is not on that list, and its restriction on selling is not an
  open-source term, so the combined work could not be distributed under EUPL-1.2. Run as a **separate service on its
  own domain, embedded in an iframe**, WorkAdventure stays a separate work, and the combination is legally sound.
- **A second product to operate.** It is another service to deploy, secure, monitor and upgrade, with its own stack.
- **A second store of personal data.** It keeps user state (position, avatar) that would need its own mapping,
  retention and erasure.
- **Look.** The default sprites are 1990s RPG style, not the .italia design system, so a custom tile set would be
  needed anyway.

### Option B: build it in-house on Phaser 3

Build a small game on [Phaser 3](https://phaser.io/) (MIT license), with a custom "Italian garden" tile set and a
WebSocket or Socket.IO channel for multiplayer.

Pros:

- Full control over the look, the features and the personal data.
- One deployable: the game is a client component, and presence runs in the same application.
- MIT is a permissive license, so Phaser can be included in an EUPL-1.2 work.
- Themes per event become possible, for example a garden, a library or a town square.

Cons:

- **The largest effort of the four.** It needs map art, a game loop with keyboard and touch input, network code
  (position sync and interpolation), proximity chat, state persistence and accessibility work.
- **A new attack surface.** A realtime endpoint that participants call many times a second must be rate-limited and
  must not become an unauthenticated write channel.
- **More to operate.** Another connection pattern to size and monitor.

### Option C: a minimal lobby with tables, no game

A static floor plan with named tables, for example "Coffee table" or "Quiet corner". The visitor clicks a table to
join its group, and chat and audio are limited to the people at that table, up to five. There are no moving avatars
and no pixel art.

Pros:

- Most of the social benefit (grouping and proximity conversation) for a fraction of the work.
- Easy to make accessible: it is lists and buttons, usable with a screen reader and a keyboard.
- No game engine and no continuous network traffic, only joining and leaving groups.
- It reuses the streaming infrastructure that the chat already has ([ADR-005](005-live-interaction-in-portal.md)).

Cons:

- Less engaging.
- It is not what participants asked for.

### Option D: keep the status quo

Wait for more feedback before investing. The existing waiting room, with its device check, etiquette and chat
preview, is reasonable for most events.

## Accessibility analysis

A 2D game with real-time movement is hard to make accessible:

| User need | Risk in a canvas game |
|---|---|
| Screen reader | A canvas is opaque. It exposes no structured text (WCAG 1.1.1). |
| Keyboard only | Every action needs a key, a documented mapping, and no keyboard trap (WCAG 2.1.1, 2.1.2). |
| Motor impairments | Steering an avatar in real time is tiring compared with buttons, and a touch joystick needs a continuous drag. Every action must also work without it (WCAG 2.1.1, and 2.5.1 where the gesture depends on the path). |
| Color vision deficiency | Color must not be the only signal, text needs 4.5:1 contrast and meaningful graphics 3:1 (WCAG 1.4.1, 1.4.3, 1.4.11). |
| Photosensitive epilepsy | No more than three flashes per second, and no aggressive animation (WCAG 2.3.1). |
| Vestibular disorders | Moving content that starts automatically must be possible to pause, stop or hide (WCAG 2.2.2). Honoring the reduced-motion preference is good practice (WCAG 2.3.3, level AAA). |

The analysis set one mandatory mitigation: **every event that offers the square must also offer a complete fallback
to the classic waiting room, always reachable.** Nothing in the event may require crossing the square. This doubles
the testing surface, and it is not negotiable for public-sector software.

The implemented answer, clause by clause, is the accessibility contract in
[The waiting room and the square](../architecture/waiting-room.md#accessibility-contract). In short: every control
lives on the page and the square shows the same tree; the square opens only on request and is not offered on phones
by default; the classic choice is remembered; the scene is reachable with Tab, gives up its keys to any focused
control, and closes with Esc except while typing in a field; and the open square is a named region, not a focus trap. The canvas itself does not
read `prefers-reduced-motion` and gives a screen reader nothing. No automated check enforces flash rates or contrast
on the canvas art, so changes to the art are reviewed by hand. The fallback is what makes these gaps acceptable: the
only information in the square is who else is waiting.

## GDPR impact

| Element of the proposal | Analysis | As built |
|---|---|---|
| Persistent avatar | Saving an avatar across events on the server would need consent, like the address-book opt-in ([ADR-011](011-person-rubrica.md)) | No avatar is saved on the server beyond the short-lived presence entry. The game keeps its profile (name, color, accessories) in the browser's local storage under `pawebinar.lobby.profile`, and the page keeps the classic preference under `pawebinar.arcade.classic`. The presence identifier is random and new each time the square opens |
| Position | Transient session telemetry, acceptable if not stored or logged | Presence lives in one Redis hash per event. Each ping refreshes a 10-second expiry on the whole hash, and reads drop entries older than 10 seconds. An entry whose leave ping never arrived stays in the hash, but is not served, until the square has been empty for 10 seconds. Nothing is written to PostgreSQL, and the route logs no positions |
| Proximity chat | Acceptable if messages are not stored. Logging them for moderation would need consent and a retention rule | Not built. The only chat in the waiting room is the event chat, covered by the event's retention |
| Spatial audio and video | Same treatment as the main conference, with a separate JWT scope | Not built |
| Who can see presence | Not analyzed in the proposal | The presence route takes no credential. While people are in the square, anyone who knows the event's slug can read their display names and positions |

The presence row of the data inventory is in [Privacy and data protection](../GDPR.md#data-inventory-and-retention).

## Decision

**Option B, built incrementally, with the square as an optional extra and never as the only front door.**

### The square is an optional overlay on the waiting room

The waiting room stays a page of the .italia design system (Bootstrap Italia + design-react-kit): the event, the
audio and video controls, the name, the notices and the chat. It is the default path and the only one needed to
enter.

The square opens only when the visitor presses its invitation: **Step into the square**, or **Head to the square
meanwhile** while the room is getting ready. It then covers the window, with the same page's controls in a column
beside the scene, or underneath it on narrow screens. It is not a separate page: the React tree is laid out
differently and never unmounted, so the camera preview and a chat draft survive opening and closing it. **Back to the
waiting room** closes it at any time, and so does Esc, except while typing in a field. Entering the event from the
square, by walking the avatar into the open gate, goes through the page's own validated entry handler.

### An isolated workspace behind a dynamic import

The game is a separate npm workspace. It never imports Jitsi and never calls a backend: all of its input and output
goes through four injected ports (presence, conference, schedule, media devices), and the app supplies the adapters.
The waiting room loads the game through a client-only dynamic import, inside an error boundary, so the game engine
stays out of the main bundle and never runs on the server. The portal mounts the game in embed mode, so the page owns
identity, devices and entry, and the game shows none of its own controls except the touch joystick. CI type-checks
the workspace in a job of its own.

### The classic view is always available

**Classic version**, in the square's stage bar, closes the square and saves the choice in the browser. Phones start
in the classic view. If the game's chunk fails to load or the game throws, the error boundary switches to the classic
view and saves that choice too. **Back to the park** reverses the choice.

An installation sets the waiting-room engine site-wide, and each event can override it. The `CLASSIC` engine sets the
default, but it is not a switch-off: in the classic view the page still offers **Back to the park**, so an
installation can make the classic view the default but cannot remove the square from an event.

### Presence by HTTP ping and a short-lived Redis hash

Presence uses no dedicated WebSocket, no stream and no new service. While the square is open, the browser pings one
route of the portal a few times a second. The route records the sender in a short-lived Redis hash for the event and
answers with the snapshot of everyone in the square, which is how peers arrive. The route takes no credential, is
rate-limited, and records nothing for draft, idle or ended events.

Presence is the one piece of live state that lives only in Redis. This does not contradict
[ADR-005](005-live-interaction-in-portal.md), which keeps PostgreSQL canonical for interaction data: presence is
worthless after ten seconds and is never needed afterwards.

## Consequences

### What the decision buys

- The social value arrives without putting a video game on the critical path of someone who only needs to join a
  webinar.
- A broken square cannot take the waiting room down. The game is an isolated workspace behind a dynamic import and an
  error boundary, and a failure lands on the classic view.
- An installation that prefers the classic experience can make it the site default.
- No new service, protocol or credential: presence is one route and a Redis hash.

### What it costs

- **One more workspace to maintain**, with its own dependencies (`phaser`, `mitt`) and type-check job.
- **Presence load scales with people in the square.** Each person sends about five requests per second, and each
  request reads the event status from PostgreSQL and makes two Redis round trips. Each ping also writes one
  access-log line (method, path, status and duration, with no name or position), so a busy square dominates the
  portal's log volume. See [Cost, limits and exposure](../architecture/waiting-room.md#cost-limits-and-exposure).
- **Unauthenticated presence.** Display names in the square are readable by anyone who knows the event's slug, for as
  long as those people are in the square.
- **A per-IP, per-pod rate limit.** One browser uses about half of the 600 pings a minute, so two browsers behind one
  NAT address reach the limit on a pod. From then until the one-minute window resets, every ping from that address
  gets 429, and all of those avatars disappear for others after 10 seconds.
- **The square shows no one as in the call.** The app's conference adapter reports no call members, so everyone
  appears as waiting.
- **The canvas cannot be tested headless.** Automated coverage stops at unit tests (engine precedence, the presence
  adapter, the schedule adapter, the ping route) and an end-to-end test that reaches the waiting room. Canvas behavior
  is checked by hand in the lobby harness (`npm run lobby:dev`). See [Testing](../development/testing.md#the-square).

The limits that affect users are tracked in [The waiting room and the square](../architecture/waiting-room.md#known-limitations)
and in the [roadmap](../ROADMAP.md#known-limitations-of-shipped-features).

## Implementation notes

The current behavior, with its numbers, is owned by
[The waiting room and the square](../architecture/waiting-room.md). The decision lives in these places:

- **Engine.** The enum `WaitingRoomEngine` in `app/prisma/schema.prisma`, stored in `SiteSetting.waitingRoomEngine`
  and `Event.waitingRoomEngine` (null inherits the site value), and copied from `EventTemplate.waitingRoomEngine` when
  the wizard is pre-filled. `GAME` offers the square and `CLASSIC` starts in the classic view. `GARDEN` named an
  earlier minimal SVG scene that no longer exists; it is treated as `GAME` and is still the schema default of
  `SiteSetting.waitingRoomEngine`. The browser applies the precedence (URL override, then phone or saved preference,
  then the configured value) in `app/src/lib/waiting-room/resolve-engine.ts`. See
  [Engines: classic view and the square](../architecture/waiting-room.md#engines-classic-view-and-the-square).
- **Page and game.** `app/src/components/live/waiting-room.tsx` owns the overlay, the classic preference and the
  error boundary. `app/src/components/live/garden/phaser-lobby.tsx` mounts the `lobby/` workspace (package
  `@pa-webinar/lobby`) through `next/dynamic` with `ssr: false`, in embed mode with the `piazza` map theme. The four
  port adapters are in `app/src/lib/lobby/`.
- **Presence.** The client loop is in `app/src/lib/lobby/presence-adapter.ts`, the route is
  `app/src/app/api/events/[param]/garden/ping/route.ts`, and the Redis helpers are in `app/src/lib/garden/pubsub.ts`
  (hash `garden:<eventId>:pos`). Each ping writes the sender into the hash and refreshes a 10-second expiry on the
  whole hash; reads drop entries older than 10 seconds. Closing the square sends a final `leave` ping through
  `navigator.sendBeacon`; otherwise the entry stops being served after 10 seconds. Emotes (wave and heart) travel on
  the ping, and jumps stay local. The cadence, status gate, degraded answers, emote timing and rate limit are in
  [Presence](../architecture/waiting-room.md#presence).
- **Tests.** Unit tests sit next to `resolve-engine.ts`, the presence and schedule adapters and the ping route. The
  `Typecheck (lobby)` job in `.github/workflows/ci.yml` type-checks the workspace.

## What was proposed and not built

The original plan went further than the code does today. These parts do not exist:

- **A dedicated WebSocket** (`/api/ws/garden`) and a presence server. HTTP pings replaced them.
- **A DJ stand** that changes the waiting-room music, and the other interactive points of interest (a fountain, a
  kiosk with a mini-game).
- **Proximity text chat and groups** of up to five with a private zone. The dashed lines the game draws between
  nearby avatars are visual only.
- **Spatial audio and video**, which would have reused the Jitsi Videobridge (JVB).
- **Avatar choice in the product.** The game has a personalization bar for color and accessories, but embed mode
  hides it, and there is no server-side avatar.
- **Map themes per event.** The portal always mounts the `piazza` map theme. Loading Tiled maps and sprite sheets is
  declared in the game's public types (`AssetConfig`) but not wired.

## Related

- [The waiting room and the square](../architecture/waiting-room.md): the owner page for the page states, the engines,
  the square, presence and the accessibility contract
- [`lobby/README.md`](../../lobby/README.md): the game workspace, its harness, public API and ports
- [Live interaction and realtime](../architecture/live-interaction.md): the chat channel and Redis availability
- [Privacy and data protection](../GDPR.md): the data inventory and browser storage
- [Runtime settings](../configuration/runtime-settings.md): the site-wide engine setting
- [Third-party licenses](../../THIRD-PARTY-LICENSES.md): the license of the `lobby/` workspace and its dependencies
- [ADR-002: A single Next.js full-stack application](002-nextjs-fullstack.md)
- [ADR-005: Live interaction lives in the portal](005-live-interaction-in-portal.md)
- [ADR-011: Cross-event person record and opt-in address book](011-person-rubrica.md)
