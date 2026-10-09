# The waiting room and the square

Every arrival on an event's live page lands in the waiting room first: participants, guests, moderators and speakers alike, whatever the event status. The waiting room is an ordinary page built with the .italia design system (Bootstrap Italia + design-react-kit). It holds everything a person needs before entering the live room: name, device check, notices, consent and the entry button.

The **square** is optional. It is a 2D place built with Phaser where people who are waiting can walk around as avatars and see each other. A visitor opens it by choice and can leave it at any time. Nothing needed to take part in the event lives only in the square.

This page is written for front-end developers, accessibility reviewers, and administrators choosing the waiting-room engine. It covers what the page shows in each state, what it contains, how the engine is chosen, how the square is built, how presence works, and the accessibility contract that keeps the square optional.

## One front door

The live page (internal path `/events/[slug]/live`, localized through `app/src/i18n/routing.ts`) is a Server Component. It works out who the visitor is and renders `LiveEventClient`, which starts in its `waiting` phase and renders `WaitingRoom` (`app/src/components/live/waiting-room.tsx`). The waiting room only presents. Credentials, consent steps and the Jitsi JWT stay in `LiveEventClient`, and the waiting room reports back through callbacks: `onEnterLive(name, prefs)`, `onStartEvent()` and `onLeaveFeedback()`.

### Who reaches the page

| Visitor | How they are recognized | Statuses that reach the waiting room |
|---|---|---|
| Registrant | Personal link `?token=<accessToken>`, or the signed per-event access cookie set at registration (or by an email entry link signed with `sig`, which the emails built while public registration is off carry) | Any status. If the link was forwarded and opened in another browser, the name field starts empty and per-participant consent is asked again |
| Moderator or speaker | Magic link `?token=` (the primary moderator link or a named grant) | Any status |
| Guest, scheduled event | No token | `LIVE` only, and only while the site setting `guestAccessEnabled` is on. Otherwise the page redirects to the registration page, or to the event page when `ENDED` or `ARCHIVED` |
| Guest, instant call | No token | `LIVE`, `IDLE`, `PROVISIONING`. Any other status returns not found |

A password-protected event sends a visitor without a token to its password page first. Registering close to the start time leads straight into the waiting room: when the event begins within `SiteSetting.waitingRoomLeadMinutes` (default in `app/prisma/schema.prisma`), the registration page redirects to the personal link. Someone who registers twice is offered **Resend my access link** on the registration page; while public registration is off, the form emails the link instead. Whether the Jitsi token is then issued for each status is covered in [the event lifecycle](event-lifecycle.md#which-joins-each-status-admits). Registration, invitations and access modes are covered in [the event journey](event-journey.md). Credentials are covered in [identity, access and tokens](identity-and-access.md).

### How the page stays current

- As soon as it opens, and then every 3 seconds, the waiting room polls `GET /api/events/[param]/lifecycle`. It accepts a new status only if it is one the page can render (`PUBLISHED`, `PROVISIONING`, `IDLE`, `LIVE`, `ENDED`). During `IDLE` and `PROVISIONING` the response also carries warm-up telemetry: phase and a timer anchor. When the scaler is not driving the lifecycle ([Running without the scaler](event-lifecycle.md#running-without-the-scaler)), nothing is warming up: the phase is `scheduled` and there is no timer anchor. A phase the client does not know is dropped, and the room shows the generic waiting message (`app/src/components/live/lifecycle-warmup.ts`).
- The first time the page sees the event `IDLE` (on load or from the status poll), the client sends `POST /api/events/[param]/wake` once, so the bridge starts while the visitor waits.
- While the event is `LIVE`, the client polls `/api/status` every 3 seconds to learn whether the bridge is ready (`app/src/lib/jitsi/bridge-readiness.ts`).

Statuses, wake and overtime are owned by [the event lifecycle](event-lifecycle.md). How bridges are started is owned by [scaling the media plane](scaling.md).

### What each state shows

| Event status | Wall clock and bridge | What the visitor sees |
|---|---|---|
| `PUBLISHED` | `startsAt` in the future | Countdown (it pulses during the last minute) and a disabled button **Opens at {time}**. Moderators also get **Start event** |
| `PUBLISHED` | `startsAt` has passed | "The event is about to start, please wait for the organizer…" (not shown to moderators), above the same disabled **Opens at {time}** button, which still shows the scheduled time. Moderators also see **Start event** |
| `PUBLISHED` | `endsAt` has passed | **The scheduled time for this event has passed**, with the badge **Time passed** and a pointer to the event page. Like the ended view, it has no name field, device check or entry button, and no **Start event** |
| `IDLE` | Bridge scaled to zero | Same as `PROVISIONING`. The page sends the wake request once |
| `PROVISIONING` | Bridge starting | Warm-up banner with a phase (**Request received**, **Starting the video server…**, **Provisioning a dedicated video server** after 75 seconds, **Video server up: almost there**) and an elapsed-time counter. Disabled button **Room warming up...** |
| `PROVISIONING`, `IDLE` | The scaler is not driving the lifecycle | **The room opens at the start time**, with a clock instead of the spinner and no timer: the room opens at the start time or when the organizer starts it |
| `LIVE` | Bridge reported as starting, for less than 60 seconds | Banner **Preparing room...** and a disabled button **The room is getting ready…**; the square stays available in the side column |
| `LIVE` | Bridge ready or unknown | **Enter now**, which can always be pressed. With an incomplete form, pressing it marks the first missing field (the name, then the email, then the per-participant recording consent when it is asked), shows why and moves focus there. While the name is missing, **To enter, type your name (at least 2 characters).** already shows next to the field and above the button |
| `LIVE` | Bridge still reported as starting after 60 seconds | **Enter now** behaves the same way, but the **Preparing room...** banner stays and the room is not announced as ready |
| `ENDED` | Any | **Event ended**, with **Watch the recording** when a recording exists and, when feedback is on, **Leave feedback** for everyone except moderators, which opens the end-of-event rating in a dialog ([Post-event feedback](live-interaction.md#post-event-feedback)). There is no name field, device check or entry button |

Any other status (`DRAFT`, `ARCHIVED`) reached with a valid link shows the disabled **Opens at {time}** button.

**Start event** is available to moderators while the event is `PUBLISHED`, `PROVISIONING` or `IDLE`, until `endsAt` (`canStartManually()` in `app/src/lib/events/lifecycle.ts`). It sends `PUT /api/events/[id]` with `status: LIVE` and the moderator token. Entry still waits for the bridge as described below.

```mermaid
flowchart TD
    ARRIVE(["Visitor opens the live page<br/>/events/[slug]/live"]) --> STATUS{"Event status?"}

    STATUS -->|PUBLISHED| TIME{"startsAt still<br/>in the future?"}
    TIME -->|yes| COUNTDOWN["Countdown<br/>disabled 'Opens at {time}'"]
    TIME -->|"no, endsAt ahead"| SOON["'The event is about to start…'<br/>+ disabled 'Opens at {time}'"]
    TIME -->|"no, endsAt passed"| NOTHELD["'The scheduled time for<br/>this event has passed'<br/>no entry, no 'Start event'"]
    STATUS -->|"PUBLISHED, PROVISIONING<br/>or IDLE, moderator"| START["'Start event' button<br/>(until endsAt)"]

    STATUS -->|IDLE| WAKE["POST /wake sent once,<br/>the first time IDLE is seen"]
    WAKE --> WARM
    STATUS -->|PROVISIONING| WARM["Warm-up banner with phase and timer,<br/>or 'The room opens at the start time'<br/>without the scaler<br/>disabled 'Room warming up...'"]

    STATUS -->|LIVE| BRIDGE{"Bridge reported<br/>as starting?"}
    BRIDGE -->|yes, under 60 s| PREP["'The room is getting ready…'<br/>(disabled)"]
    BRIDGE -->|"yes, after 60 s<br/>(banner stays)"| ENTER
    BRIDGE -->|no or unknown| ENTER["'Enter now'<br/>(incomplete form: flags and<br/>focuses the missing field)"]

    STATUS -->|ENDED| ENDED["Ended card:<br/>'Watch the recording', 'Leave feedback'"]

    classDef entry fill:#E6F0FA,stroke:#17324D,color:#17324D
    classDef decision fill:#FFFFFF,stroke:#17324D,color:#17324D
    classDef wait fill:#E6F0FA,stroke:#0066CC,color:#17324D
    classDef prep fill:#FDF1E0,stroke:#CC7A00,color:#17324D
    classDef go fill:#E6F4EE,stroke:#008055,color:#17324D
    classDef done fill:#EEF1F4,stroke:#5C6F82,color:#17324D

    class ARRIVE entry
    class STATUS,TIME,BRIDGE decision
    class COUNTDOWN,SOON wait
    class WAKE,WARM,PREP prep
    class START,ENTER go
    class ENDED,NOTHELD done
```

### Bridge readiness: "no" is different from "don't know"

The bridge value has three states. It is `false` only when the status page reports the bridge as scaling. It is `null` when the snapshot is stale, missing or in error, and `true` when the bridge is ready or already carrying participants. Only `false` closes the door. A stale snapshot does not lock people out of a healthy conference. Only the scaler reports a bridge as scaling: with fixed bridges the value is `true` while `JVB_HEALTH_URL` answers and `null` otherwise, and without `JVB_HEALTH_URL` it is always `null`, so the door never waits there ([Monitoring and health](../operations/monitoring.md#get-apistatus)).

The door does not stay closed forever. After 60 seconds of "starting", the normal entry button returns. The **Preparing room...** banner stays, and the page does not announce that the room is ready, because the only evidence it has says otherwise.

### From "Enter now" to the live room

When a visitor presses **Enter now**, the page saves the name in the browser and hands the name and the camera and microphone choice to `LiveEventClient`. On an event with recording, participants and guests then see the recording-consent step. Moderators and speakers skip it. After that the client fetches the Jitsi JWT and mounts the conference. The recording-consent step is described in [recording](recording.md), the JWT in [identity, access and tokens](identity-and-access.md), and the room itself in [how PA Webinar extends Jitsi Meet](jitsi-integration.md).

## What the page contains

All of these pieces live in one React tree. The classic view and the open square show the same tree, laid out differently (see [Layout and controls](#layout-and-controls)).

| Element | Shown when | Behavior |
|---|---|---|
| Header | Always | Event image or cover when set, title (with the optional kicker line) and a badge, **The event is live!** or **Event ended** |
| Who's here | Every status except `ENDED`, when the presence count answers | **N people live** (only once the event is live) and **N in the waiting room**. See [Who is live and who is waiting](#who-is-live-and-who-is-waiting) |
| **The call at a glance** | Always | Facts with an icon each: **When** (date, times in the event's time zone and duration), **Organized by** (the organizing bodies, or `organizerName`), **Hosts** and **Speakers** (only the people published on the event page, built by `entiEPersonePubblici` in `app/src/lib/events/public-people.ts` like the event page; a host who is not published is not named, and **Speakers** falls back to the event's free-text `speakers` field), and **Recording** when the recording notice applies. Below, the event description (Markdown), cut to three lines with **Read more** when it is longer; then **Event page** (not for instant calls) and **Share**, the same popover as in the room, with the moderator link for moderators only |
| Status banners | `IDLE`, `PROVISIONING`, or `LIVE` with the bridge starting | See [What each state shows](#what-each-state-shows) |
| **Your name** | Every status except `ENDED` | At least 2 characters. Pre-filled for a registrant on the browser that registered and for a named grant. Empty for the shared primary moderator link, so each person types their own name. While it is empty the field pulses in blue with **Enter your name to join** under it; after an attempt to enter it pulses in amber and is marked invalid for screen readers. It is never shown in red: a missing name is a step to take, not an error |
| **Your photo** | Every status except `ENDED`, for a registrant whose browser has opened the personal link from an email. Named grants, the shared moderator link and guests never see it. The page asks `GET /api/events/{slug}/profile-photo`, and shows nothing when the answer is `canUpload: false`. In the browser that registered, before the emailed link has been opened there (`needsEmailProof: true`), it shows the initials and **To add a photo, open the personal link you received by email in this browser: that shows the address is yours.** | Optional. A preview with the photo or the initials, **Choose a photo** or **Change photo**, and **Remove**, which asks for a second click to confirm. The browser crops the image to a square and reduces it to a 256×256 JPEG before sending it; the server re-encodes whatever it receives. Others see the photo instead of the initials from the next entry into the room, also at later events with the same email address. See [Avatars](identity-and-access.md#avatars) |
| **Email (optional)** | Guests only | Validated if filled in. It stays in the browser and is never sent to the server |
| **Insecure address** | The page was opened over `http://` other than `localhost`, which is not a secure context | The browser gives such a page no microphone or camera, so the video call cannot start. The notice says so, above the name field, and links to the same page over `https://`. The link text shows only the host, never the personal token in the address. The room shows the same notice instead of loading Jitsi ([How PA Webinar extends Jitsi Meet](jitsi-integration.md)) |
| Device check | Every status except `ENDED` | See [Device check and virtual backgrounds](#device-check-and-virtual-backgrounds) |
| Music toggle | `PUBLISHED`, and only if the event has its own waiting-room audio | See [Waiting-room music](#waiting-room-music) |
| Per-participant recording consent | When the event records per-participant audio and this visitor has not consented yet | A required checkbox. See [Consent and transparency notices](#consent-and-transparency-notices) |
| Primary button | Every status except `ENDED` | **Start event**, **Enter now**, or a disabled state, as described above |
| **Watch from the start** | The event has a temporary recording (`tempRecordingUrl`) | Plays the partial recording inline, with **Join LIVE** and **Switch to live** buttons to return |
| **Leave the waiting room** | Every status except `PUBLISHED` and `ENDED` | Goes to the event page, or to the home page for an instant call. During `PUBLISHED` a **Back** link to the event page is shown instead |
| Square card, under **While you wait** | See [Engines](#engines-classic-view-and-the-square) | **Or: Step into the square**, presented as another place to wait, not as a step before entering |
| **How to take part** | Always | A short etiquette list from the i18n catalogs, collapsed until opened |
| Recording notice | Recording is enabled, the installation can record (Jibri is expected, or the per-participant recorder is configured: `app/src/lib/recording/availability.ts`) and the event has not ended | "This event is being recorded.", as an information line of **The call at a glance**, not as a warning |
| AI notice | AI post-production is on for the event | See [Consent and transparency notices](#consent-and-transparency-notices) |
| **Event chat**, under **While you wait** | `LIVE`, `IDLE` or `PROVISIONING`, with chat enabled and readable | In the side column, as tall as the screen allows. Readable before `LIVE` only with a token or on an instant call, the same rule the server applies. It unlocks once the name has 2 characters. See [live interaction](live-interaction.md) |

### Who is live and who is waiting

Every live page tells the server where it is: `POST /api/events/{slug}/presence` with a random identifier generated for that page load (a duplicated tab counts on its own) and `luogo` set to `attesa` (waiting room, every 15 seconds) or `diretta` (in the call, every 30 seconds). The hook is `app/src/hooks/use-presence.ts`, mounted once in `LiveEventClient`: entering the call moves the same identifier from one count to the other. The answer carries the two counts, which the waiting room shows. Closing the page, leaving the room or the end of the event sends a leave signal; otherwise a page stops counting 75 seconds after its last signal. Nothing is sent once the event has ended.

Only someone with access to the room counts and receives the counts: the same rule as the live panels (`authorizePanelRead`: a moderator, speaker or registration token, or a guest while the room admits guests), and only while the event is `PUBLISHED`, `IDLE`, `PROVISIONING` or `LIVE`. Knowing the event address is not enough to inflate the numbers others see. The per-address rate limit is wide (2,400 requests a minute), for many people behind one organization's network.

The server keeps two Redis sorted sets per event (`presenza:<eventId>:attesa` and `:diretta`), scored with the time of the last signal, in `app/src/lib/live/presence.ts`. Nothing goes to PostgreSQL, no name, token or address is stored, and the keys expire ten minutes after the last signal. Without Redis the counts are unknown and the waiting room shows none. The recorder bot is not counted, because it never opens the page.

### Device check and virtual backgrounds

`app/src/components/live/device-check.tsx` is the **Audio and video** section: two switches, **Camera** and **Microphone**, off for everyone the first time. Nothing asks for permission while both are off; the hint says the person enters with them off and can turn them on in the room. Turning one on opens the test below, with an animation: the camera preview and the virtual backgrounds for the camera, the microphone picker and level meter for the microphone, and a speaker test chime. Only what is on is requested from the browser, and a device switched off is released, so the camera light goes off. The switches are handed to the conference: they set the state the person has on entering. Choosing devices inside the room is left to Jitsi's own settings. The last choice is remembered separately for those who host or speak and for those who attend, so turning the microphone on while hosting does not carry over to attending another event.

The device check also offers the virtual backgrounds bundled with the platform (`SFONDI_VIRTUALI` in `app/src/lib/jitsi/virtual-background.ts`). The choice is stored in the browser. `JitsiRoom` applies it when the person joins, with `setVirtualBackground` and the image as a data URI. A data URI is used because a cross-origin URL would taint the canvas Jitsi draws on. "No background" is sent explicitly, so a background left over from an earlier session on the conference origin does not come back. Two limits:

- The Jitsi remote command sets image backgrounds only. Blur is available only through Jitsi's own backgrounds button inside the room, which the narrow-screen toolbars leave out (see [Toolbars by role and device](jitsi-integration.md#toolbars-by-role-and-device)).

The preview shows the chosen background behind the person. `app/src/hooks/use-background-preview.ts` cuts the person out of the camera video with MediaPipe's Image Segmenter and draws the result on a canvas over the video, at about 20 frames a second. Both the engine and the model are served by the portal: the WebAssembly files of `@mediapipe/tasks-vision` under `/vendor/mediapipe/` (copied from `node_modules` at install time and by the `Dockerfile`, not committed) and the landscape selfie model under `/models/selfie-segmentation/` (see [its README](../../app/public/models/selfie-segmentation/README.md)). They download only when a background is chosen and the camera is on (a choice remembered from an earlier visit counts), about 12 MB uncompressed, and the browser caches them. The engine segments a frame scaled down to the model's size (256 pixels on the long side), runs on the graphics card when it can and falls back to the processor when the card fails, and stays loaded until the device check goes away, so switching backgrounds or devices does not reload it; inside the room the effect is Jitsi's own. No camera frame leaves the device, and the engine sends nothing anywhere: the package is pinned to a 0.10 release, because the 1.x releases send usage metrics to Google, and `app/src/lib/live/background-preview.test.ts` fails if the installed package contains a Google network address. Where the engine cannot start, the hint says so and the background is still applied on entry. The live page's CSP, and only that page's, allows WebAssembly with `'wasm-unsafe-eval'` (see [the CSP page](../SECURITY-CSP.md)).

### Waiting-room music

`app/src/components/live/audio-player.tsx` is a toggle, **Enable music** / **Disable music**. Nothing plays until the visitor presses it, because browsers block autoplay and the page never tries. Once started, the track loops and fades in to 30 percent volume. Pressing the toggle again fades it out.

The toggle appears only while the event is `PUBLISHED` and only if the event has its own audio: **Waiting-room audio (optional)** in the event wizard's **Basics** step, as an upload or a URL (`Event.waitingRoomAudioUrl`). The bundled `app/public/audio/waiting-room-default.mp3` is the player's fallback, but the waiting room never renders the player without an event audio. So an event without its own audio has no music toggle.

### Consent and transparency notices

- **Recording notice.** Shown whenever recording is enabled, before and during the event. It is informative only. The consent that gates entry for participants and guests is the separate recording-consent step after **Enter now**.
- **Per-participant recording consent** (**Per-participant recording**). On an event with `multitrackRecordingEnabled`, entry is blocked until the visitor ticks the consent checkbox. The text comes from `gdpr.consent.multitrack`. Moderators are exempt. So are registrants who gave this consent at registration, when they open their link in the browser that registered. Speakers and guests are not exempt, because their isolated voice track is exactly what the consent protects. For guests of an instant call, the page turns recording and per-participant recording off. The privacy side is covered in [recordings, voice data and AI outputs](../privacy/recordings-and-ai.md).
- **AI notice** (**AI processing after the event**). Shown when the site-wide AI pipeline switch is on and the event has transcription, summary, translation or dubbing enabled. The text is the administrator's per-language `SiteSetting.aiConsentDisclosure`, or the i18n default when that is empty. See [AI post-production](../POSTPROD.md).

### The moment the room opens

The move from waiting to entering often happens while the visitor is looking at something else: the square, the chat, or their own preview. Two cues mark it. Neither one ever enters the room automatically, because the click is still needed for browser media permissions and for consent.

- When the status changes to `LIVE` while a participant or guest is waiting, a 3-2-1 panel labeled **The room is open** is shown. It is announced assertively.
- When the room opens (`LIVE` and the bridge not reported as starting), the button reads **The room is ready — come in** for the next 10 seconds. A visually hidden status message announces the same thing. Entry allowed by the 60-second fallback is not announced.
- For as long as pressing it would really let the person in (room open, name and consent in place), **Enter now** is green, with a halo that breathes around it, a light sweep across it and an arrow that points; while something is missing it stays blue and says what. The halo is a layer of its own, so the keyboard focus ring stays visible. All of this stops under `prefers-reduced-motion`.

### What stays in the browser

The waiting room keeps a few conveniences in `localStorage`. Every access is wrapped so that private browsing or blocked storage falls back to the defaults. None of these values is sent to the server, with two exceptions: the name, which goes into the Jitsi JWT request on entry and into presence pings while the square is open, and the avatar look, which also travels in presence pings.

| Key | Holds |
|---|---|
| `pawebinar.participant.name`, `pawebinar.participant.email` | Last name and email typed, restored on the next visit (the name only when the server has none) |
| `pawebinar.deviceCheck.<group>.cameraOn`, `.micOn` | Camera and microphone on/off choice: one pair for visitors whose devices start on (moderators, speakers, instant calls), one for audience participants |
| `paw_sfondo_virtuale` | Chosen virtual background |
| `pawebinar.arcade.classic` | The saved classic-view preference |
| `pawebinar.lobby.profile`, `pawebinar.lobby.onboardingDismissed` | The square's local profile (name, avatar color, accessories) |
| `pawebinar.piazza.suoni` | Whether the square's sounds are on (`1`) or off |
| `pawebinar.piazza.aspetto` | The character's look (random on the first visit) |
| `pawebinar.piazza.pozzo`, `pawebinar.piazza.corona` | Wishes made at the well, and whether the crown is unlocked |

Cookies and data retention are owned by [privacy and data protection](../GDPR.md).

## Engines: classic view and the square

The waiting-room engine is the enum `WaitingRoomEngine` in `app/prisma/schema.prisma`:

| Value | Admin label | Effect |
|---|---|---|
| `GAME` | **Videogame (Phaser lobby)** | The square is available |
| `GARDEN` | Not offered | Legacy value, treated as `GAME`. It is the schema default of `SiteSetting.waitingRoomEngine`, and admin forms display it as **Videogame (Phaser lobby)** |
| `CLASSIC` | **Classic (static)** | The page opens in the classic view |

The engine can be set in three places:

- **Site settings**, which sets `SiteSetting.waitingRoomEngine`. The labels of this field are in Italian only.
- **Event templates** (**Waiting room (template default)**). The value is copied into the event when the wizard is pre-filled from the template. It is not read at runtime.
- The event wizard's **Basics** step (**Waiting room (this event)**, with **Site default** as the empty choice), which sets `Event.waitingRoomEngine`.

The live page resolves `event.waitingRoomEngine ?? settings.waitingRoomEngine`. The browser then applies the precedence in `app/src/lib/waiting-room/resolve-engine.ts`, which is unit-tested:

1. A `?engine=` query parameter wins over everything. `phaser` makes the square available, `svg` is a legacy alias for the same, and `classic` forces the classic view. Unknown values are ignored.
2. Otherwise, on a phone (`(pointer: coarse) and (max-width: 768px)`) or when the browser has the saved classic preference, the result is the classic view. Tablets and desktops keep the square.
3. Otherwise the configured value decides: `CLASSIC` gives the classic view, and anything else makes the square available.

"Available" means the page offers the invitation **Step into the square**. The square never opens by itself.

```mermaid
flowchart TD
    URL{"?engine= in the URL?"}
    URL -->|"phaser or svg"| SQUARE
    URL -->|classic| CLASSIC
    URL -->|"absent or unknown"| DEVICE{"Phone (coarse pointer and<br/>width 768 px or less)<br/>or saved classic preference?"}
    DEVICE -->|yes| CLASSIC
    DEVICE -->|no| EVENT{"Event.waitingRoomEngine<br/>set?"}
    TEMPLATE["EventTemplate.waitingRoomEngine<br/>(copied into the event by the wizard)"] -.->|pre-fills| EVENT
    EVENT -->|yes| VALUE{"Configured value"}
    EVENT -->|"no (null)"| SITE["SiteSetting.waitingRoomEngine<br/>(default GARDEN)"]
    SITE --> VALUE
    VALUE -->|CLASSIC| CLASSIC
    VALUE -->|"GAME or legacy GARDEN"| SQUARE

    SQUARE["Mode: square available"]
    CLASSIC["Classic view<br/>(no square until the visitor<br/>presses 'Show the square')"]

    classDef decision fill:#FFFFFF,stroke:#17324D,color:#17324D
    classDef config fill:#E0F5F5,stroke:#00A3A3,color:#17324D
    classDef square fill:#E6F4EE,stroke:#008055,color:#17324D
    classDef classic fill:#E6F0FA,stroke:#0066CC,color:#17324D

    class URL,DEVICE,EVENT,VALUE decision
    class TEMPLATE,SITE config
    class SQUARE square
    class CLASSIC classic
```

### When the square is not offered

Even with the square available, the page does not offer it in these cases:

- The event is `ENDED`.
- The event records per-participant audio and this visitor must give consent on the page (see [Consent and transparency notices](#consent-and-transparency-notices)). The square stays unavailable for the rest of the visit, even after the box is ticked.
- The page is in the classic view.

The invitation is a card in the side column, under the chat: **Or: Step into the square**, another place to wait rather than a step before entering. It stays there while the bridge is starting too.

### `CLASSIC` is a starting point, not a switch-off

In the classic view, the page shows **Show the square** whenever the event has not ended and the visitor is not asked for per-participant consent on this page. Pressing it clears the saved preference and brings back the invitation. This happens even when the configured engine is `CLASSIC`. An administrator can make the classic view the default, but cannot remove the square from an event.

### Failure falls back to the classic view

The square is loaded lazily and wrapped in an error boundary (`PhaserLobbyBoundary` in `waiting-room.tsx`). If the chunk fails to load (for example on a restrictive network) or mounting the game throws, the boundary closes the square and switches to the classic view. It also saves the classic preference, so that browser keeps the classic view on later visits until the person presses **Show the square**.

## The square

### How it is built

The square is the npm workspace `lobby/` (package `@pa-webinar/lobby`, listed in the root `package.json` workspaces). It is a self-contained Phaser game that never fetches a backend or imports Jitsi. All of its input and output goes through four injected ports. The app consumes it as TypeScript source (`transpilePackages` in `app/next.config.ts`). `waiting-room.tsx` loads it through `next/dynamic` with `ssr: false`, so Phaser stays out of the main bundle and never runs on the server. CI type-checks the workspace in its own job. The workspace's harness, public API and internals are documented in [`lobby/README.md`](../../lobby/README.md).

```mermaid
flowchart TB
    WR["waiting-room.tsx<br/>the page: controls, validation, entry"]
    PL["components/live/garden/phaser-lobby.tsx<br/>loaded with next/dynamic, ssr: false,<br/>inside an error boundary"]
    AD["Four adapters in app/src/lib/lobby/<br/>GardenPresenceClient · EnterLiveConference<br/>EventStatusSchedule · BrowserMediaDevices"]
    MOUNT["@pa-webinar/lobby (lobby/ workspace)<br/>mountLobby(el, config, deps)<br/>embed mode, map: piazza"]
    PING["POST /api/events/[param]/garden/ping"]

    WR -->|"status, typed name, bridge readiness"| PL
    PL -->|"creates once"| AD
    AD -->|"injected as the four ports"| MOUNT
    AD -->|"presence: about every 200 ms"| PING
    MOUNT -.->|"avatar at the open gate:<br/>join() calls the page's validated entry"| WR

    classDef app fill:#E6F0FA,stroke:#0066CC,color:#17324D
    classDef adapter fill:#E0F5F5,stroke:#00A3A3,color:#17324D
    classDef lobby fill:#E6F4EE,stroke:#008055,color:#17324D
    classDef api fill:#FDF1E0,stroke:#CC7A00,color:#17324D

    class WR,PL app
    class AD adapter
    class MOUNT lobby
    class PING api
```

`app/src/components/live/garden/phaser-lobby.tsx` mounts the game once, calling `mountLobby` with the default `piazza` map theme (`lobby/src/lobby/systems/PiazzaMap.ts`). After that it pushes changes in: the event status and bridge readiness go to the schedule adapter, and name edits go to the profile. It turns on `embed` mode (the `hostOwnsEntry` prop), which removes the game's own onboarding, top bar, personalization bar, device panel and status badge. Only the world and the touch joystick remain. This matters for three reasons:

- There is one set of controls, in the visitor's language, validated once.
- A name typed inside the game cannot get lost outside it.
- The game has no entry path that bypasses the `LIVE` check.

| Port | App adapter | What it does in the product |
|---|---|---|
| `PresenceClient` | `GardenPresenceClient` | Runs the presence loop described below |
| `ConferenceState` | `EnterLiveConference` | `join()` calls the page's own entry handler. It reports no call members, so everyone in the square is shown as waiting |
| `EventSchedule` | `EventStatusSchedule` | Maps status, start time and bridge readiness to four gate states: `scheduled` (countdown), `preparing` (start time passed, or `LIVE` with the bridge starting), `live`, `ended`. It sets a timer for the start time so the gate changes without a status change |
| `MediaDevices` | `BrowserMediaDevices` | With the in-game device panel hidden, only its `stop()` runs, on teardown. The page's device check keeps the camera |

### Layout and controls

The open square is not a separate page. It is the waiting room laid out differently. The shell becomes a full-window region labeled **Waiting-room square**, with the scene beside a 380-pixel column holding the same controls, with the event chat at the top of the column (the waiting-room card follows it). The card lays itself out by its own width (a container query), so its summary and switches stack in one column there. Below 992 pixels the scene takes a 45vh band on top and the controls sit underneath. Because the React tree is never unmounted, the camera preview keeps running and a chat draft survives opening and closing the square.

- **Movement.** WASD or the arrow keys, or the touch joystick. Space jumps.
- **Gestures.** A toolbar at the bottom of the scene, and a key each: wave (E), heart (H), clap (C), laugh (R) and idea (I). The keys do nothing with Ctrl, Cmd or Alt held (so copying with Ctrl+C is not a clap) and do not repeat while held. Each gesture has its own sound. Clicking a toolbar button does not take the keyboard focus from the scene, so walking with the keys goes on; with the keyboard the buttons are reached with Tab, and each declares its key (`aria-keyshortcuts`). The glyphs and keys live in one place, `lobby/src/lobby/emotes.ts`.
- **Chat bubbles.** Every new message of the event chat appears for at least 20 seconds (up to 30 for long ones) in a bubble above the avatar of the person who wrote it, and a newer message from the same person replaces it; opening the square shows the chat messages of the last 20 seconds, for the time they have left. Ages are measured from when a message reached this page, not from the server's clock, so a wrong computer clock does not shorten or drop the bubbles of live messages; only messages recovered after the chat stream stalls use an estimated age. A message that already had its bubble does not get a new one when the chat panel reloads its history, and a message hidden while the stream was down is removed when the chat re-reads the conversation. Your own messages go on your avatar. Everyone else's are matched by display name between the chat and the square (two people with the same name both get it; see [Known limitations](#known-limitations)). The square connects to the chat once its scene has started, and gets the recent messages then. While someone is typing, three pulsing dots show above their avatar. The bubbles come from the event chat, so the chat's rules apply to them: a message hidden by a moderator disappears from its bubble at once, a corrected message shows its new text, and nothing is stored beyond the chat itself (the page remembers the last 30 seconds of messages in memory, for the square). `ChatPanel` reports new, corrected and removed messages and the typing names through `onMessaggioNuovo`, `onMessaggioModificato`, `onMessaggioRimosso` and `onScrittura` to a bridge (`app/src/lib/lobby/chat-bridge.ts`); `PhaserLobby` connects to the bridge when the square opens and calls `showChatMessage`, `editChatMessage`, `clearChatMessage` and `setTyping` on the lobby handle. Messages go one by one, outside React state, so several arriving together (a recovery after the stream stalls) all become bubbles, with a single pop.
- **Gate.** The gate shows the schedule state: a padlock and **Starts in {time}**, a rope and **The room is getting ready…**, **Entrance open**, or **Event ended**. For moderators the gate is drawn open early with **Early entry (host)**, but that is visual only.
- **Entering from the square.** Walking into the gate requests entry only when the state is `live`. The request goes through the same validated handler as **Enter now**, with the page's name, email, consent and device choice. If the form is incomplete, the page marks the first missing field and moves focus there, as **Enter now** does, and the game resets its entry attempt.
- **Stage bar.** **Back to the waiting room** closes the square. So does Esc, except while typing in a field. **Classic version** closes it and saves the classic preference. While the bridge is starting, the bar shows **The room is getting ready…**, and after 60 seconds **Enter anyway**. Once the room is ready it shows **You can join from here, or walk your avatar to the gate.**, or **To enter, type your name (at least 2 characters).** while the name is missing.
- **Sound.** All synthesized in the browser, with no audio files: a low chiptune loop, the fountain's murmur, the occasional bird, footsteps, a sound per gesture, a soft pop when a bubble appears in view and a short jingle when the gate opens. The **Square sounds** button in the gesture toolbar (a toggle, with its state in `aria-pressed`) switches it all; sound starts off and the choice is remembered (`pawebinar.piazza.suoni`). While it is off nothing runs: the audio context stays suspended and no loop, fountain or bird timer is started. The browser allows sound only after a gesture, so the square retries on every click, tap or key until the audio is actually running, and plays nothing while the system has suspended it (an incoming call, another app in front).
- **Signs.** The gate sign and the names of the four spaces (**Café**, **Notice board**, **Gallery**, **Lab**) come from the page's language catalogs, like the gate texts. The gate's state label sits above the sign.
- **The map.** The square keeps the flat style of the design system (`lobby/src/lobby/systems/PiazzaMap.ts`): light paving with walkways from the fountain to the gate and to the four spaces, trees, flower beds, lamps and benches. In the middle is a four-lobed fountain with a raised basin and jets. Each space has its own shape and colour from the `.italia` palette, so it can be told apart from a distance: the café is a kiosk with a green striped awning, the notice board a blue-roofed newsstand, the gallery a facade with columns and a red pediment, the lab a navy workshop with a sawtooth roof. A wishing well sits in a quiet corner.
- **Characters.** Every character is drawn flat in code (`lobby/src/lobby/avatar/`): skin tone, hairstyle and colour, top, bottom, shoes, hat, glasses, each with its colours, facing four directions with a walk cycle. On a first visit the character is random, and it is saved in this browser (`pawebinar.piazza.aspetto`); someone arriving from an older version, without a chosen look, gets a random one derived from their identifier, the same each time. So no two people look alike unless they choose to. **Character** in the toolbar opens the editor: a live preview that turns and walks, three starting points (masculine, feminine, not stated) that fill in the parts and can then be changed freely, a random button, and a control for each part. The starting point chosen does not travel: others see only the drawing.
- **Places.** Walking near a space, the fountain or the well shows a blue marker on it and an action button above the toolbar; **Enter** does the same. The café gives the character a cup (☕) that everyone sees, and messages between people who are both at the café stay up for 50 seconds, like a conversation at the table. The notice board opens the event's title, time, organizers, hosts, speakers and description, the programme (the agenda's light read, when the agenda is on) and the materials visible now. The gallery shows the event's images and the organizers' logos, and a portrait of everyone in the square. The lab holds the square's mood and the wardrobe (the character editor). The fountain takes a coin; the well takes wishes, and the third one unlocks a crown for the character (`pawebinar.piazza.corona`, with the count in `pawebinar.piazza.pozzo`).
- **The square's mood.** In the lab each person can say how they arrive (good mood, curiosity, sleepy, energy). A sign next to the lab, and the lab's window, show only how many chose each one, never who. The choice travels on the presence ping; the server keeps it only in that person's presence record (gone 10 seconds after the last ping) and answers everyone with the counts alone, never with anyone's mood.
- **Controls and secrets.** **Controls** in the toolbar opens a legend with the keys and the secrets to try: up, up, down, down, left, right, left, right, B, A throws confetti; typing `boom` sets off fireworks in the national colours over the gate; `polo` makes it snow for a minute; three wishes at the well bring a surprise. The secret words use only keys that are neither gestures nor movement, and the codes live in `lobby/src/lobby/segreti.ts`, which the legend also reads. Fireworks also go off when the gate opens, and it snows by itself from 1 December to 6 January. With reduced motion there is no snow and there are no fireworks.

## Presence

Presence is how people in the square see each other. It is short-lived by design: positions live in Redis for seconds and nothing is written to PostgreSQL.

```mermaid
sequenceDiagram
    autonumber
    box rgba(0,102,204,0.12) Browser
        participant Lobby as Square (Phaser)
        participant Client as GardenPresenceClient
    end
    box rgba(0,128,85,0.12) Portal
        participant Route as POST /api/events/[param]/garden/ping
        participant DB as PostgreSQL
    end
    box rgba(204,122,0,0.12) Redis
        participant Hash as hash garden:[eventId]:pos
        participant Chan as channel garden:[eventId]
    end

    Lobby->>Client: move(x, y, facing), emote(type)
    loop about every 200 ms, one request in flight
        Client->>Route: userId, displayName, avatarId, x%, y%, facing, emote?<br/>Authorization: room token, if any
        Route->>Route: per-IP rate limit (in-memory, per pod) and schema check
        Route->>DB: read event id and status
        alt status DRAFT, IDLE or ENDED
            Route-->>Client: peers empty, active false
        else no access to the room
            Route->>Hash: HGETALL
            Route-->>Client: positions without names, anonymous true
        else any other status
            Route->>Hash: HSET userId, EXPIRE 10 s
            Route->>Chan: PUBLISH (no subscriber)
            Route->>Hash: HGETALL, drop entries older than 10 s
            alt Redis answered
                Route-->>Client: peers snapshot, active true
                Client->>Lobby: peerJoin, peerMove, peerEmote, peerLeave (diff)
            else Redis slow or not ready
                Route-->>Client: peers empty, degraded true
                Note over Client: keeps the current avatars
            end
        end
    end
    Client->>Route: sendBeacon with leave true (square closed)
    Route->>Hash: HDEL userId
```

- **One loop, one route.** While the square is open, `GardenPresenceClient` (`app/src/lib/lobby/presence-adapter.ts`) sends `POST /api/events/[param]/garden/ping` about every 200 ms. Only one request is in flight at a time, with a 2-second timeout. The response carries the snapshot of everyone in the square. There is no stream: the snapshot in the response is how peers arrive.
- **What a ping carries.** A random `userId` generated each time the square opens (`self_` plus 8 characters), the display name (at most 80 characters), and the position as a percentage of the world. `avatarId` carries the character's look in at most 16 characters (`codificaLook` in `lobby/src/lobby/avatar/look.ts`: a version digit and one base-36 character per part). The earlier encoding (a colour and accessory flags) is still read, as a random look derived from the sender's identifier. Emotes ride on the ping when present, and so does the mood said at the lab (`umore`): the server accepts only the moods in its own list (`app/src/lib/garden/umori.ts`, kept equal to the square's by a test) and drops any other without rejecting the ping. The answer carries the counts (`umori`), and the peers in it have no mood.
- **Where it lives.** `app/src/lib/garden/pubsub.ts` writes a Redis hash `garden:<eventId>:pos`, one field per user. It refreshes a 10-second expiry on the whole hash and drops entries older than 10 seconds when reading. Each Redis command is capped at 500 ms. When Redis is not ready or too slow, the route answers `degraded: true`, and the client keeps its current avatars instead of treating the answer as an empty square.
- **Who appears and who sees names.** The client sends the room token it already holds (moderator, speaker or registration) as `Authorization: Bearer`. The route applies the same rule as the live panels (`app/src/lib/events/panel-read-access.ts`): a valid token, or no token while the room is open to people arriving by link and the event has no password (or its password cookie is present). With access, the person appears in the square and sees the others' names. Without it, nothing is written for them and the answer carries `anonymous: true` and the others' positions with empty names and opaque identifiers (stable, but not the real ones, which would let them send `leave` on someone else's behalf), so they only see how many are there. A token that does not resolve counts as no access. The decision for a token is kept in memory for 5 seconds on each pod, like the moderator check, so the rule does not read the database on every ping and a revoked grant stops counting within seconds.
- **Status gate.** For `DRAFT`, `IDLE` and `ENDED` the route answers `{ peers: [], active: false }` without writing. So during `IDLE` a visitor walks alone until the wake moves the event to `PROVISIONING`. The route records pings for every other status.
- **Leaving.** Closing the square, or entering the room (which unmounts it), sends a final ping with `leave: true` via `navigator.sendBeacon`, and the entry is deleted. Otherwise it ages out within 10 seconds.
- **Emotes and jumps.** A gesture (`wave`, `heart`, `clap`, `laugh` or `idea`) is attached to the next pings for 1.5 seconds, at most once every 600 ms. The server relays only the gestures in its own list (`app/src/lib/garden/emotes.ts`, kept equal to the square's by a test): an unknown one is dropped, but the ping, position included, still counts, so a newer client during a rolling update does not freeze. Receivers use the sender's timestamp to avoid replaying it. Others see it about one ping later. Jumps are local animations and are not sent.
- **The published channel.** Each ping is also published on the `garden:<eventId>` channel, and a leave publishes a leave message there. Nothing subscribes: `subscribeGarden()` in `pubsub.ts` has no caller, so each ping costs one unused Redis `PUBLISH`.

### Cost, limits and exposure

- **Load.** Each person in the square generates about five requests per second to the app tier. Each request does one PostgreSQL read (the event status) and two Redis round trips; checking a room token adds up to three more reads once every 5 seconds per token and pod. A hundred people in the square means about 500 requests per second. App-tier scaling is covered in [scaling the media plane](scaling.md).
- **Rate limit.** 600 pings per minute per client IP, counted in memory on each pod (`app/src/lib/rate-limit.ts`). One browser uses about 300. Two browsers behind the same NAT address reach the limit on a pod, and a third starts getting `429` responses: its avatar stops updating and disappears for others after 10 seconds.
- **Exposure.** Knowing an event's slug is not enough to read names: without access to the room, the route returns positions only. Anyone with access sees the names of the people in the square while they are there, which is the same audience as the room itself. The name shown is whatever is in the page's name field. An empty name appears as `Ospite`, a literal Italian placeholder.

## Accessibility contract

A 2D canvas game cannot be made fully accessible. Italian public-sector software must meet WCAG 2.1 AA and the Legge Stanca (Italian accessibility law). The waiting room therefore treats the square as an extra that no one depends on. The contract is:

1. **Nothing requires the square.** Name, email, device check, consent, notices, chat and the entry button are all on the page. The square shows the same tree, so a control cannot exist in one view and be missing from the other.
2. **The square is opt-in.** It opens only when the visitor presses the invitation. It never starts over the page, and it is never offered on phones by default.
3. **The classic view is always reachable and remembered.** Use **Classic version** in the stage bar, which saves the choice in the browser for later events, or add `?engine=classic` to a link, which applies to that visit only. **Show the square** clears the saved choice.
4. **Keyboard.** The invitation is a button. Opening the square moves focus to the scene, which has `role="application"`, is reachable with Tab, and is labeled by the gate hint. The game gives up its keys whenever another control has focus. Tab reaches the stage bar and every page control. Esc closes the square, except while typing in a field. Closing returns focus to the button that opened the square, or to **Show the square** if that button has gone.
5. **Not a trap.** The open square is a named region, not a modal dialog, and no focus trap is used. The site header and footer stay in the Tab order, so focus can always leave the square; while the square is open they are covered by it, so focus can move onto links hidden behind it.
6. **Announcements are deliberate.** The warm-up banner is a polite live region, and its per-second timer is `aria-hidden` so it is not read out every second. The 3-2-1 cue is assertive. The "room is ready" change is announced through a visually hidden status message, because a label change inside an unfocused button is not read. When the room opens with the form incomplete, the message says **The room is open: type your name to enter.** or **The room is open** instead, and the button's description names what is missing.
7. **Motion and sound.** The invitation's breathing animation and the button's pulse stop under `prefers-reduced-motion`. The last-minute countdown pulse and the music toggle's equalizer animation do not respect it (see [Known limitations](#known-limitations)). The square's sound starts off, and turning it on is an explicit button. Waiting-room music plays only after the visitor presses its toggle.
8. **Failure degrades to the accessible view.** See [Failure falls back to the classic view](#failure-falls-back-to-the-classic-view).

The canvas itself does not read `prefers-reduced-motion`, and a screen reader gets nothing from it. Clause 1 is what makes that acceptable: the only information in the square is who else is waiting.

## Customizing

| What | How | Where to read more |
|---|---|---|
| Default engine | **Site settings**, **Event templates**, or the event wizard | [Runtime settings](../configuration/runtime-settings.md) |
| Waiting-room music | **Waiting-room audio (optional)** per event (upload or URL) | [`app/public/audio/README.md`](../../app/public/audio/README.md) |
| Virtual backgrounds | Add a 1280×720 JPEG to `app/public/images/virtual-backgrounds/`, an entry in `SFONDI_VIRTUALI`, and its name under `deviceCheck.background` in all 24 catalogs | [`app/public/images/virtual-backgrounds/README.md`](../../app/public/images/virtual-backgrounds/README.md) |
| Header image | The event's image or cover | [The event journey](event-journey.md) |
| Texts (etiquette, notices, labels) | The i18n catalogs, or translation overrides without a rebuild | [Languages and localization](i18n.md), [branding](../configuration/branding.md) |
| AI notice text | `SiteSetting.aiConsentDisclosure`, per language | [AI post-production](../POSTPROD.md) |
| Map art | Code in `lobby/src/lobby/systems/PiazzaMap.ts`. The map is drawn in code. `AssetConfig` (tilemap, tileset, sprite sheet URLs) is declared in the lobby's public types, but nothing loads it yet | [`lobby/README.md`](../../lobby/README.md) |

## Known limitations

- Chat bubbles find their author by display name. If the name in the chat differs from the one in the square (a registrant who changed the name field, or a shared moderator link that writes as "Moderator"), the bubble does not show, or shows over someone in the square with that same name. Your own messages always go on your avatar.
- `CLASSIC` does not remove the square. See [`CLASSIC` is a starting point, not a switch-off](#classic-is-a-starting-point-not-a-switch-off).
- Presence is rate-limited per IP per pod, which penalizes offices behind one NAT address.
- The square shows no one as "in the call": the app adapter reports no call members.
- The error boundary saves the classic preference, so one failed load keeps that browser in the classic view on later visits.
- Errors raised later inside the running game loop are not caught by the React error boundary, so they do not trigger the fallback.
- While the square is open it covers the site header and footer, which stay in the Tab order: keyboard focus can land on links hidden behind the square.
- The last-minute countdown pulse and the music toggle's equalizer animation do not respect `prefers-reduced-motion`.
- An empty name appears in the square as the untranslated `Ospite`.
- The canvas cannot be exercised by headless browser tests. Automated coverage is unit tests (engine precedence, presence adapter, schedule adapter, ping route) plus end-to-end tests (`app/e2e/live-flow.spec.ts`) that reach the waiting room and its entry button. Canvas behavior is checked by hand in the lobby harness (`npm run lobby:dev`). See [testing](../development/testing.md).

## Where the code lives

| Concern | File |
|---|---|
| The page | `app/src/components/live/waiting-room.tsx` |
| Phase handling, polling, wake, entry | `app/src/components/live/live-event-client.tsx` |
| Who reaches the page | `app/src/app/[locale]/events/[slug]/live/page.tsx` |
| Engine precedence | `app/src/lib/waiting-room/resolve-engine.ts` |
| Square mount | `app/src/components/live/garden/phaser-lobby.tsx` |
| Square adapters | `app/src/lib/lobby/` |
| Presence route and Redis helpers | `app/src/app/api/events/[param]/garden/ping/route.ts`, `app/src/lib/garden/pubsub.ts` |
| Profile photo | `app/src/components/live/profile-photo-field.tsx`, `app/src/lib/profile-photo.ts` |
| Device check, backgrounds, music | `app/src/components/live/device-check.tsx`, `app/src/lib/jitsi/virtual-background.ts`, `app/src/components/live/audio-player.tsx` |
| The game | `lobby/` |
| Characters: look, drawing, editor | `lobby/src/lobby/avatar/`, `app/src/components/live/garden/character-editor.tsx` |
| Places, mood, legend | `lobby/src/lobby/systems/Luoghi.ts`, `lobby/src/lobby/umori.ts`, `lobby/src/lobby/segreti.ts`, `app/src/components/live/garden/piazza-luoghi.tsx` |
| Chat bubbles | `app/src/lib/lobby/chat-bridge.ts` |

## Related pages

- [Event lifecycle](event-lifecycle.md): statuses, wake, grace and overtime.
- [Scaling the media plane](scaling.md): how the bridge the waiting room waits for is started.
- [Live interaction and realtime](live-interaction.md): the chat shown under **While you wait**.
- [Identity, access and tokens](identity-and-access.md): the links and cookies that identify a visitor.
- [Recording](recording.md) and [recordings, voice data and AI outputs](../privacy/recordings-and-ai.md): what the consent gate protects.
- [ADR-012](../adr/012-garden-waiting-room.md): the decision, the options considered, and what was proposed but not built.
