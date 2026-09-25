# Glossary

This page defines each term used in the PA Webinar documentation and user
interface, once, and links to the page that owns the mechanism behind it. It
describes no behavior of its own: when a definition here and its owner page
disagree, the owner page is right, and the code is right over both.

How to read it:

- Terms in `code font` are identifiers exactly as they appear in the code, in
  the database schema (`app/prisma/schema.prisma`), in Helm values or in
  environment variables. They stay verbatim even when they are Italian
  (`PiazzaMap`, `percorso()`, `/admin/rubrica`).
- Each entry opens with its term, or pair of terms, in bold. Inside an entry,
  **bold** marks a UI label quoted verbatim from the English UI catalog,
  `app/src/i18n/messages/en.json`. The default UI language is Italian:
  [Italian UI labels](#italian-ui-labels) maps the Italian labels visible in
  screenshots to their English counterparts and to the terms these docs use.
- Abbreviations are expanded in [Abbreviations](#abbreviations).

> **One Italian word, two meanings.** *Registrazione* means both a
> *registration* (signing up for an event: `Registration`) and a
> *recording* (captured audio or video: `Recording`). The Italian UI uses
> the same words for both: "Registrazione in corso" is **Registering...** on
> the sign-up form and **Recording in progress** in the live room. These docs
> always resolve the ambiguity: *registration* for sign-ups, *recording* for
> media. The administration area calls registrations **Sign-ups** (Italian:
> *Iscrizioni*).

## Roles and credentials

**Administration area** (`/admin`, UI **Administration**): the staff interface
of an installation. Staff enter it with the instance API key or a one-time
sign-in link; the session lives in the signed `admin_session` cookie. A
moderator link also opens that one event's management pages
(`/admin/events/<id>?token=…`) without a staff session.
[Identity, access and tokens](architecture/identity-and-access.md)

**Administrator** (staff role `ADMIN`, UI **Administrator**): a named staff
account with the same powers over the whole installation as the instance API
key. It signs in with a one-time sign-in link, and the audit log records the
account that acted. [ADR-015](adr/015-named-administrators.md)

**Guest** (UI **Guest**): a person who joins a live event with only a typed
name, without registering (seat `guest-…`). Guests enter a scheduled event
only while it is `LIVE`, and only while the site setting **Guest access
enabled** is on; an instant call admits them whatever the setting, also while
it warms up. Two other things share the word: the role `GUEST` on an
invitation-list entry, and the `GUEST` column of the permission matrix, which
stands for the whole audience.
[Identity, access and tokens](architecture/identity-and-access.md)

**Instance API key** (`ADMIN_API_KEY`, UI **Sign in with the instance key**):
the installation-wide secret that opens the entire administration area. Once
named administrators exist it remains for first access, emergencies and
automation. [ADR-009](adr/009-admin-session.md),
[Identity, access and tokens](architecture/identity-and-access.md)

**Machine key** (`CRON_API_KEY`): the shared secret, set by the operator,
that scheduled jobs and in-cluster services (the JVB scaler, the recorder bot
and controller, the AI worker) present to the portal's `/api/cron/*` and
`/api/internal/*` routes.
[Identity, access and tokens](architecture/identity-and-access.md#machine-credentials)

**Magic link**: a link whose token is the credential. No PA Webinar role has
an account password: moderators, speakers and registrants reach an event
through magic links, and staff through one-time sign-in links.
[ADR-003](adr/003-moderator-magic-links.md)

**Moderator** (role `MODERATOR`, UI **Moderator**): a person with full control
of the live room: muting and removing participants, recording control, chat
and Q&A moderation, starting and ending the event. A moderator holds either
the moderator link or a named `MODERATOR` grant, and their Jitsi JWT carries
the moderator flag. [ADR-003](adr/003-moderator-magic-links.md)

**Moderator link** (UI **Moderator link**): the event's primary magic link,
carrying `Event.moderatorToken` as `?token=`. It is a UUID with no expiry,
shared by everyone who holds it, that can be rotated but not revoked: a
durable credential.
[Identity, access and tokens](architecture/identity-and-access.md#moderator-and-speaker-links)

**Named grant** (`EventModerator`, role `MODERATOR` or `SPEAKER`): a
per-person access grant to one event, with its own magic-link token, that can
be revoked on its own (`revokedAt`). Co-moderators and speakers added in the
wizard's **People** step each receive one. The table is `event_moderators`
even though it also holds speakers.
[Identity, access and tokens](architecture/identity-and-access.md)

**One-time sign-in link**: the emailed, single-use link a staff account uses
to enter the administration area (`StaffLoginToken`).
[Identity, access and tokens](architecture/identity-and-access.md#the-one-time-email-link),
[ADR-014](adr/014-organizer-role.md)

**Organizer** (staff role `ORGANIZER`, UI **Organiser**): a staff account that
creates events and manages only its own (`Event.createdById`), with no access
to installation settings, the address book or other events' data. Do not
confuse it with the *co-organizing organizations* listed on an event page
(`EventOrganizer`, wizard step **People**, section **Organizers**): those are
display metadata only (name, logo, website), with no access rights, no link
and no email. [ADR-014](adr/014-organizer-role.md),
[From creation to recap](architecture/event-journey.md)

**Participant** (UI **Participant**): a registrant in the live room, joined
through their personal link (`Registration.accessToken`, seat
`reg-<registrationId>`). In prose, "participant" also means anyone in the room.
[Identity, access and tokens](architecture/identity-and-access.md)

**Registrant**: a person with a `Registration` for an event (admin UI
**Sign-ups**). A registrant receives the confirmation email, the reminders and
a personal join link. [From creation to recap](architecture/event-journey.md)

**Seat**: what a token identifies, which is a place in the room, not a
person. Everyone who holds the shared moderator link occupies the same
moderator seat, and a forwarded registration link keeps the same `reg-<id>`
seat. Any action taken *as* a specific author, such as editing someone's chat
message, therefore needs a per-person identity, not just possession of a
token. [Identity, access and tokens](architecture/identity-and-access.md)

**Speaker** (grant role `SPEAKER`, UI **Speaker**): an invited panelist with
full microphone, camera and screen-share rights and no moderation powers. In
transcripts, "speaker label" means something else: see
[AI post-production](#ai-post-production).
[ADR-003](adr/003-moderator-magic-links.md)

**Staff account** (`StaffAccount`, admin nav **Accounts**, route
`/admin/organizers`): a named, passwordless account with role `ORGANIZER` or
`ADMIN`. The session re-reads the account on every request, so deactivating it
takes effect immediately. [ADR-014](adr/014-organizer-role.md)

## Events

### Types and statuses

**Call session** (`CallSession`): one continuous run of an event's conference,
with its start and end, peak participants, telemetry, and the logs of dominant
speakers and raised hands. A recording belongs to exactly one call session.
[Event lifecycle](architecture/event-lifecycle.md)

**Event** (`Event`): the unit everything hangs off: public page, registrations,
live room, interaction data, recordings and post-event content.
[Data model](architecture/data-model.md)

**Event status** (`EventStatus`): where an event is in its lifecycle. The
state machine and who moves it are in
[Event lifecycle](architecture/event-lifecycle.md).

| Value | Term | Meaning |
|---|---|---|
| `DRAFT` | draft | Being written; not public. |
| `PUBLISHED` | published | Public and open for registration; its room is not open yet. |
| `PROVISIONING` | being prepared | A bridge is starting for the event; visitors see the warm-up band and a disabled **Room warming up...** button. |
| `LIVE` | live | The room admits participants. |
| `IDLE` | idle | A live room that stayed empty past the inactivity grace, so its bridge can be scaled down (only with the JVB scaler). |
| `ENDED` | ended | The live part is over; the post-event page takes the place of the room. |
| `ARCHIVED` | archived | Hidden from every public surface: either the GDPR cleanup archived it after removing personal data at the end of retention, or staff archived it from the event list (an administrator, or an organizer for their own events), which deletes nothing by itself. |

**Event type** (`EventType`): `SCHEDULED` for an ordinary event with a
schedule, `INSTANT` for an instant call, and `LEGACY` for a past recording
published without any live room, either an uploaded video or a YouTube link
(admin **Publications**, tab **Uploaded archive**).
[From creation to recap](architecture/event-journey.md)

**Grace period** (`gracePeriodMinutes` per event, site default
`eventGracePeriodMinutes`): the minutes after `endsAt` during which a live
event stays open before it is closed to `ENDED`. `-1` means no time-based
close. The close is applied by the JVB scaler; without it, the event stays
`LIVE` until a moderator ends it.
[Event lifecycle](architecture/event-lifecycle.md#grace-period-and-overtime)

**Inactivity grace** (`jvbInactiveGraceMinutes`): how long a `LIVE` room may
stay empty before the JVB scaler marks it `IDLE` so its bridge can be scaled
down. It is a different setting from the grace period.
[Event lifecycle](architecture/event-lifecycle.md#inactivity-grace-live-to-idle),
[Runtime settings](configuration/runtime-settings.md)

**Instant call** (`INSTANT`, admin **Instant calls**): an ad-hoc room created
on demand. It starts directly as `LIVE` and has no meaningful schedule. With
the JVB scaler it closes through inactivity rather than at an end time;
without it, when a moderator ends it.
[From creation to recap](architecture/event-journey.md),
[Event lifecycle](architecture/event-lifecycle.md#instant-calls)

**Overtime**: the part of a live event that runs past `endsAt`, inside the
grace period. Participants see a notice with the time left, or a note that the
room stays open while people are connected; only the JVB scaler actually
closes the room. [Event lifecycle](architecture/event-lifecycle.md#overtime-leaving-and-revival)

**Pre-scaling** (`jvbPreScaleMinutes`): the lead time before `startsAt` at
which the JVB scaler moves a `PUBLISHED` event to `PROVISIONING` and starts
its bridge. [Scaling the media plane](architecture/scaling.md)

**Revival**: saving an `ENDED` event with a future `endsAt`, which brings it
back to `PUBLISHED` or `LIVE` without recreating any resource.
[Event lifecycle](architecture/event-lifecycle.md#revival)

**'Room being prepared' screen** (UI **Preparing room...**, Italian *Sala in
preparazione...*): the banner visitors see when the event is `LIVE` but its
bridge is not yet reported ready. It maps to the square's schedule state
`preparing`, which also covers an event past its start time whose room is not
open yet. [The waiting room and the square](architecture/waiting-room.md#what-each-state-shows)

**Wake**: the transition `IDLE` to `PROVISIONING`, requested by
`POST /api/events/<slug>/wake` when someone opens an idle room, which shows
the same warm-up band as a `PROVISIONING` one. Inside the wake window, the
same request also starts a bridge early for a `PUBLISHED` event.
[Event lifecycle](architecture/event-lifecycle.md#wake)

### Organizing an event

**Duplicate for next time** (UI **Duplicate for next time**): creates a
`DRAFT` copy of an event with its whole configuration. If the event has a
recurrence rule, the copy's date moves to the next occurrence.
[From creation to recap](architecture/event-journey.md)

**Event template** (`EventTemplate`, UI **Event templates**): a reusable set
of defaults (features, recording and AI flags, permission matrix, duration,
retention, description) that pre-fills the event wizard. Every field stays
editable, and an event keeps no link to the template it came from.
[From creation to recap](architecture/event-journey.md#templates)

**Event wizard**: the five-step form that creates or edits an event:
**Basics**, **Permissions**, **People**, **Content** and **Review**.
[From creation to recap](architecture/event-journey.md)

**Fixed-cadence series** and **moving-date series**: the two ways recurring
events are used in practice. A fixed-cadence series meets on a stable day,
with each date confirmed in turn. A moving-date series is periodic but often
rescheduled by a few days. Both are built from occurrences, and neither is a
separate entity in the data model. [Roadmap](ROADMAP.md)

**Invitation** (`EventInvitation`, UI **Invitations**): an entry in an
event's invitation list, staged in the wizard's **People** step with role
`GUEST` or `SPEAKER` and optionally linked to an address-book person. The
platform sends no invitation email. With **Public registration enabled** off,
the list is the set of addresses allowed to register (invitation-only
registration).
[From creation to recap](architecture/event-journey.md#invitations-and-named-grants)

**Join password** (`joinPasswordHash`): an optional per-event password asked
of visitors who arrive without a personal link. Only its scrypt hash is
stored.
[Identity, access and tokens](architecture/identity-and-access.md#password-protected-events)

**Kicker** (`parseTitleKicker`): the optional editorial convention (off by
default; a site setting with a per-event override) that renders the part of a
title before a `|` as a small label above the main title.
[Branding and white-labeling](configuration/branding.md#editorial-title-kicker)

**Materials** (`EventMaterial`, UI **Materials**): links and files attached to
an event. Each has a visibility (**Always**, **Before the event**, **During the
event**, **After the event**) that decides which public lists show it: the
event page before the start, the live room's drawer, the concluded event's
page. It does not restrict who can open a file's URL.
[From creation to recap](architecture/event-journey.md)

**Occurrence**: one event of a recurring series. Every occurrence is a
separate `Event`, usually created with **Duplicate for next time**. The API
can link an occurrence to the first event of its series through
`recurrenceSeriesId`; the administration UI does not set this link.
[From creation to recap](architecture/event-journey.md)

**Permission matrix** (`permissionMatrix`, wizard step **Permissions**): the
role-by-feature table (chat, Q&A, microphone, camera, screen share, recording
control) for `GUEST` (the audience), `SPEAKER` and `MODERATOR`. Moderators can
always do everything.
[From creation to recap](architecture/event-journey.md#the-five-wizard-steps)

**Questionnaire** (`EventQuestionnaire`, UI **Questionnaires**): questions
attached to an event, either inside the registration form (`PRE_REGISTRATION`)
or on the post-event page (`POST_EVENT`). A questionnaire is built from
reusable question templates (`QuestionTemplate`) plus questions specific to
the event. [From creation to recap](architecture/event-journey.md)

**Recurrence rule** (`recurrenceRule`, wizard field **Recurrence**): an RFC
5545 RRULE describing an event's cadence. It proposes dates; nothing schedules
events from it on its own.
[From creation to recap](architecture/event-journey.md)

**Reminders** (`EventReminder`, UI **Notifications**): emails sent to
registrants at chosen offsets before the start.
[Email and calendar](architecture/email.md)

**Sender ratio** (`expectedSenderRatioPct`, UI **Estimated active share**):
the share of participants expected to send audio or video. It drives bridge
sizing. [Scaling the media plane](architecture/scaling.md)

**Video quality preset** (`VideoQuality`: `SAVE_DATA`, `BALANCED`, `HIGH`,
`MAX`): the resolution and bitrate profile applied to the conference, set per
installation and overridable per event.
[How PA Webinar extends Jitsi Meet](architecture/jitsi-integration.md)

### The waiting room and the square

**Classic view** (UI **Classic view**): the waiting-room layout without the
square: static, accessible and complete. A participant's choice of it is
remembered. [The waiting room and the square](architecture/waiting-room.md)

**Consent gate**: the part of the waiting room that blocks entry until
required consents are given, such as consent to per-participant recording
when an event uses it.
[The waiting room and the square](architecture/waiting-room.md)

**Device check**: the camera preview, microphone level and speaker test in
the waiting room. The virtual-background picker sits next to it.
[The waiting room and the square](architecture/waiting-room.md)

**The square** (UI **Step into the square**): the optional full-screen 2D
waiting-room map where avatars wander before the event, built with Phaser in
the `lobby/` workspace (`PiazzaMap`). "Piazza" and "garden" appear only in
identifiers: the engine value `GARDEN`, the Redis keys `garden:…`, the route
`/api/events/<slug>/garden/ping`. [ADR-012](adr/012-garden-waiting-room.md),
[The waiting room and the square](architecture/waiting-room.md)

**Virtual backgrounds** (UI **Virtual background**): background images a
participant picks in the device check and that are applied on entering the
room. The images live in `app/public/images/virtual-backgrounds/`.
[The waiting room and the square](architecture/waiting-room.md)

**Waiting room**: the single front door to every event, the page that comes
before the live room. It holds the countdown, name, device check, consents,
chat preview and, optionally, the square.
[The waiting room and the square](architecture/waiting-room.md)

**Waiting-room engine** (`waitingRoomEngine`): the per-installation setting,
overridable per event, that decides which view the waiting room opens with.
`GAME` (UI **Videogame (Phaser lobby)**) offers the square; `CLASSIC` (UI
**Classic (static)**) opens the classic view, from which a visitor can still
bring the square back. `GARDEN` is a legacy value treated as `GAME`.
[The waiting room and the square](architecture/waiting-room.md#engines-classic-view-and-the-square)

**Waiting-room music** (`waitingRoomAudioUrl`, UI **Waiting-room audio
(optional)**): audio a visitor can switch on in the waiting room while the
event is `PUBLISHED`. It is offered only when the event has its own audio
(upload or URL in the wizard's **Basics** step), and nothing plays until the
visitor presses **Enable music**.
[The waiting room and the square](architecture/waiting-room.md#waiting-room-music)

### The live room

**Agenda** (`agendaEnabled`, UI **Notes / Checklist**): a checklist of points
that moderators tick off during the event. Participants can mark agreement or
disagreement on each point (`AgendaItemReaction`).
[Live interaction and realtime](architecture/live-interaction.md)

**Chat** (`ChatMessage`): the room's text chat. Messages are stored in
PostgreSQL and fanned out through Redis. A message can be marked as a question
(`isQuestion`) and filtered in a questions view.
[Live interaction and realtime](architecture/live-interaction.md)

**Control bar and drawer**: the live room's floating buttons over the video,
and the side panel they open (chat, Q&A, polls, word cloud, agenda,
materials, participants). [Live interaction and realtime](architecture/live-interaction.md)

**End for everyone** and **Just leave** (UI **End for everyone**, **Just
leave**): the two choices a moderator gets when leaving: end the call for all
participants, or leave while it continues.
[Event lifecycle](architecture/event-lifecycle.md)

**Live room**: the event page that embeds the conference and the app's
interaction panels around it. On the Jitsi side, the same object is the
*conference*. [How PA Webinar extends Jitsi Meet](architecture/jitsi-integration.md)

**Live-toggleable feature**: an event feature a moderator can switch on or
off during the event (Q&A, chat, agenda, word cloud), with the change reaching
everyone already in the room.
[Live interaction and realtime](architecture/live-interaction.md)

**Poll** (`Poll`, UI **Polls**): a single question with options, opened by a
moderator, then closed, and optionally published with its results.
[Live interaction and realtime](architecture/live-interaction.md)

**Q&A** (`Question`, UI **Q&A**): the questions panel. Participants post
questions and upvote them; moderators highlight, answer or dismiss them. It is
controlled by `qaEnabled` and is distinct from a chat message marked as a
question. [Live interaction and realtime](architecture/live-interaction.md)

**Raised hand** (UI **Raised hands**): Jitsi's native raise-hand. Moderators
see the queue of raised hands in the app.
[Live interaction and realtime](architecture/live-interaction.md)

**Reactions** (`reactionsMode`): emoji reactions, either Jitsi's native button
(`NATIVE`: ephemeral, not counted) or the app's reaction bar (`CUSTOM`: stored
as `Reaction` rows and counted in event analytics).
[Live interaction and realtime](architecture/live-interaction.md)

**Start event** (UI **Start event**): the moderator action that moves a
`PUBLISHED` event to `LIVE`. [Event lifecycle](architecture/event-lifecycle.md)

**Temporary recording** (`tempRecordingUrl`, UI **Watch from the start**): an
optional catch-up recording offered while the event is live, before any
recording is published. [Recording](architecture/recording.md)

**Timer** (UI **Timer**): a countdown a moderator can show to the whole room.
[Live interaction and realtime](architecture/live-interaction.md)

**Whiteboard** (`whiteboardEnabled`, UI **Whiteboard**): Jitsi's built-in
shared whiteboard. It is enabled per event and needs the whiteboard backend on
the Jitsi side. [How PA Webinar extends Jitsi Meet](architecture/jitsi-integration.md)

**Word cloud** (`WordCloudRound`, UI **Word cloud**): a timed round in which
participants answer a prompt with short words, shown as a cloud.
[Live interaction and realtime](architecture/live-interaction.md)

### After the event

**Event analytics** (UI tab **Statistics** on an event): the per-event figures
for attendance, interaction and engagement. The instance-wide page is
**Analytics** in the admin navigation; both are *Statistiche* in Italian.
[From creation to recap](architecture/event-journey.md)

**Event recap** (`postEventRecap`, UI **Event recap**): an anonymized,
aggregate snapshot of an ended event (headcount, top questions, published poll
results, word-cloud words, feedback average). It is stored so it outlives the
retention cleanup of the underlying rows.
[From creation to recap](architecture/event-journey.md)

**Post-event feedback** (`EventFeedback`): a 1 to 5 rating with an optional
comment, collected on the post-event page. It is separate from the post-event
questionnaire. [From creation to recap](architecture/event-journey.md)

**Post-event page**: what an event's page becomes once it has `ENDED`:
recording, recap, Q&A, polls, materials, feedback and AI outputs, each shown
or hidden per event. [From creation to recap](architecture/event-journey.md)

**Publications** (UI **Publications**): the administration hub for every
published video: scheduled events, instant calls, uploaded archive videos,
and recordings still waiting to be promoted.
[From creation to recap](architecture/event-journey.md)

**Video library** (`/video-library`, UI **Video library**): the public list of
events whose recordings are published and listed (`libraryListed`).
[From creation to recap](architecture/event-journey.md)

## Media and Jitsi

**colibri stats** (`/colibri/stats`): the statistics endpoint of each Jitsi
Videobridge. The JVB scaler reads it pod by pod, adds the figures up and sends
them to the portal, which keeps them as a snapshot in Redis for the status
pages. [Scaling the media plane](architecture/scaling.md)

**Composite recording**: a single video of the whole conference as everyone
saw it, produced by Jibri as an MP4. Compare *multitrack recording*.
[Recording](architecture/recording.md)

**Conference**: the Jitsi-side room of an event, an XMPP multi-user chat
named after `Event.jitsiRoomName`.
[How PA Webinar extends Jitsi Meet](architecture/jitsi-integration.md)

**coturn / TURN**: the relay server for clients that cannot reach the bridge
directly over UDP. TURNS carries the relay over TLS on TCP port 443 for
restrictive networks. [Infrastructure guide](INFRASTRUCTURE.md),
[Deploying with Helm](DEPLOYMENT.md)

**Dominant speaker**: Jitsi's running notion of who is speaking
(`dominantSpeakerChanged`). The app logs it per call session to help name
voices in transcripts. [ADR-013](adr/013-multitrack-speaker-attribution.md),
[How PA Webinar extends Jitsi Meet](architecture/jitsi-integration.md#events-the-app-listens-to)

**Endpoint**: Jitsi's term for one participant connection on a bridge. An
*endpoint id* identifies it within a conference.
[How PA Webinar extends Jitsi Meet](architecture/jitsi-integration.md)

**Extension ladder**: the ordered ways PA Webinar extends Jitsi, from the
least to the most invasive: IFrame API, configuration overrides, JWT
authentication, a Prosody module, and the patched web bundle. Forking Jitsi is
not on it. [How PA Webinar extends Jitsi Meet](architecture/jitsi-integration.md#the-extension-ladder)

**Hidden domain**: a Prosody virtual host whose members Jitsi clients do not
show: no tile, no entry in the participant list, no join notification, no
count. Jibri uses it, and so does the recorder bot when `recorder.hiddenDomain`
is set. [Recording](architecture/recording.md)

**IFrame API** (`JitsiMeetExternalAPI`): Jitsi's official embedding API. The
portal instantiates it in one place only, the `JitsiRoom` component
(`app/src/components/jitsi/jitsi-room.tsx`).
[ADR-001](adr/001-jitsi-iframe-api.md)

**Jibri**: Jitsi's recording component. It joins a conference in a headless
browser and records the composite video.
[Setting up recording](operations/recording-setup.md)

**Jicofo**: the Jitsi conference focus. It manages each conference and
assigns it to a bridge.
[How PA Webinar extends Jitsi Meet](architecture/jitsi-integration.md)

**Jitsi JWT**: the token the portal signs for each join. It carries the
display name, a per-session id (`mod-…` for moderator and speaker grants,
`reg-…` for a registrant in the browser that registered, `guest-…` for guests
and forwarded personal links, `rec-bot-…` for the recorder), an avatar, an
`owner` (moderator) or `member` affiliation, the room and an expiry. It never
carries an email address or a readable email hash.
[ADR-004](adr/004-jitsi-jwt.md),
[Identity, access and tokens](architecture/identity-and-access.md#the-jitsi-jwt)

**Jitsi Meet**: the open-source videoconferencing suite that PA Webinar embeds
for its live room: the web frontend, Prosody, Jicofo, the Videobridge and,
optionally, Jibri. PA Webinar extends it through its APIs and configuration,
plus one patched web image for fixes that have no configuration point.
[How PA Webinar extends Jitsi Meet](architecture/jitsi-integration.md)

**Jitsi Videobridge (JVB), bridge**: the Jitsi media server, a selective
forwarding unit that relays audio and video between participants. It is the
component that scales with events and can scale to zero.
[Scaling the media plane](architecture/scaling.md)

**Octo**: Jitsi's bridge cascading, which spreads one conference across
several bridges. The bundled `jitsi-meet` subchart ships it disabled and PA
Webinar does not enable it, so each conference runs on a single bridge.
[Scaling the media plane](architecture/scaling.md)

**Patched jitsi/web image** (`infra/jitsi-web-patched/`): the Jitsi web image
with a small set of fixes applied to its built bundle, for problems that have
no configuration point. The patches match code by shape, not by minified
identifier. [ADR-017](adr/017-patched-jitsi-web-image.md)

**Prosody**: the XMPP server of a Jitsi deployment. It checks the portal's JWT,
hosts the conferences and announces TURN servers to clients. PA Webinar's own
Prosody module is in `infra/jitsi/prosody-plugins/`.
[How PA Webinar extends Jitsi Meet](architecture/jitsi-integration.md)

**XEP-0215** (External Service Discovery): the XMPP extension through which
Prosody tells clients which STUN and TURN servers to use, with credentials.
[How PA Webinar extends Jitsi Meet](architecture/jitsi-integration.md)

## Platform and operations

**.italia design system**: the Italian public-sector design system (Bootstrap
Italia and design-react-kit) that the portal UI is built with.
[Extending PA Webinar](development/extending.md)

**Accessibility statement** (`/accessibility`, UI **Accessibility
statement**): the page a public body publishes about the accessibility of its
service. Its text comes from site settings.
[Branding and white-labeling](configuration/branding.md)

**Control channel** (`control:<eventId>`): the per-event realtime channel for
targeted control signals, such as a moderator lowering someone else's raised
hand, kept apart from chat and panel updates.
[Live interaction and realtime](architecture/live-interaction.md#channels)

**Docker Compose stack**: the `docker-compose.yml` at the repository root. It
runs the portal, PostgreSQL, Redis, a single-node Jitsi, Mailpit and a `cron`
service, for local development and for single-VM installations.
[Local development](DEVELOPMENT.md), [Infrastructure guide](INFRASTRUCTURE.md)

**Email outbox** (`EmailOutbox`): the durable queue of outgoing email.
Features call `enqueueEmail()`, and a scheduled job
(`/api/cron/email-outbox`) sends the queued messages over SMTP.
[Email and calendar](architecture/email.md)

**Email templates** (`EmailTemplate`, UI **Email templates**): per-language
overrides of the subject and text of system emails, edited in the
administration area. [Email and calendar](architecture/email.md)

**Installation, instance**: one running deployment of PA Webinar, with its own
database, settings and domain. [Reusing PA Webinar](REUSE.md)

**JVB scaler** (`jvbScaler`): the Kubernetes CronJob that, on each tick, asks
the portal (`/api/internal/jvb-desired-replicas`) how many bridges are needed
and scales the JVB Deployment to match. It is rendered only in the `full`
profile and only when `jvbScaler.enabled` is true (off by default in
`infra/helm/pa-webinar/values.yaml`).
[Scaling the media plane](architecture/scaling.md),
[Running the JVB scaler](operations/jvb-scaler.md)

**Node pool**: a group of Kubernetes nodes of the same machine size. The
`full` profile expects a dedicated pool for bridges, and AI post-production a
GPU pool. Either can scale to zero.
[Infrastructure guide](INFRASTRUCTURE.md)

**Object storage**: where recordings, tracks, AI outputs and uploaded files
live. PA Webinar supports Azure Blob Storage and S3-compatible services;
nothing is stored in the database as video.
[Object storage](configuration/storage.md)

**Operator**: the organization that installs and runs an installation. It may
or may not be the public body that runs the events.
[Reusing PA Webinar](REUSE.md)

**Orphan recording** (`OrphanRecording`): a file in recording storage that no
event or call session references. A reconciliation job finds orphan
recordings, and they are deleted after a grace period unless an administrator
decides otherwise. [Recording](architecture/recording.md)

**Profile** (`jitsi.mode`: `simple`, `standard`, `full`): the Helm setting
that selects how much of the media stack the chart deploys: bridge placement,
Jibri, and readiness for scale-to-zero.
[Deploying with Helm](DEPLOYMENT.md)

**Realtime channel**: a per-event Redis pub/sub channel (for example
`chat:<eventId>`) that the portal relays to browsers as server-sent events.
Redis carries the fan-out; PostgreSQL holds the data.
[Live interaction and realtime](architecture/live-interaction.md)

**Release notes** (`/changelog`, UI **What's new & changelog**): the public
page of changes per release, written by hand in
`app/src/content/changelog/` in every UI language. `CHANGELOG.md` is generated
from the same source. [CI, images and releases](development/ci-and-release.md)

**Reuse** (Italian *riuso*): the Italian framework under which public
administrations adopt software that other administrations publish, described
by the guidelines of AgID (Agenzia per l'Italia Digitale, the Italian
digital-government agency) on the acquisition and reuse of software. PA
Webinar declares itself through `publiccode.yml` for the Developers Italia
catalog (the national catalog of open-source software for the Italian public
sector). [Reusing PA Webinar](REUSE.md)

**SBOM**: the software bill of materials attached to each release: SPDX for
the container image, CycloneDX for the npm dependencies. The **What's new &
changelog** page can display a release's SBOM.
[Security policy](../SECURITY.md)

**Scale to zero**: running no bridge, and eventually no bridge node, while no
event needs one, and starting them again ahead of the next event.
[ADR-007](adr/007-jvb-scale-to-zero.md),
[Scaling the media plane](architecture/scaling.md)

**Scheduled jobs**: the periodic tasks behind email, reminders, cleanup,
retention, reconciliation, scaling and post-production. They run as Kubernetes
CronJobs in the chart; the Compose `cron` service runs only the email outbox,
reminders and GDPR cleanup.
[Scheduled and background jobs](architecture/background-jobs.md)

**Service inventory** (`/service-inventory`, UI **Service inventory**): a
public page listing the services and providers an installation runs on, read
from a CycloneDX 1.6 document at `SERVICE_INVENTORY_URL`.
[Service inventory: publishing](SERVICE-INVENTORY.md)

**Site settings** (`SiteSetting`, table `site_settings`, UI **Site
settings**): the single-row runtime configuration of an installation
(branding, languages, features, scaling and AI knobs), changed without a
rebuild. [ADR-010](adr/010-site-settings-singleton.md),
[Runtime settings](configuration/runtime-settings.md)

**Snapshot-or-reload rule**: what a realtime message may carry. A full
snapshot is sent only where every viewer gets the same answer (the live flags,
the event status); otherwise the message is only a notice, and each client
re-reads the panel through its own authorized request.
[Live interaction and realtime](architecture/live-interaction.md#snapshot-or-reload)

**Status page** (`/status`, UI **System status**) and **infrastructure page**
(`/admin/infrastructure`, UI **Infrastructure**): the public view of service
health, which an administrator can withdraw with **Status page enabled**, and
the administrators' view of how the installation is deployed.
[Monitoring and health](operations/monitoring.md)

**Translation overrides** (`translationOverrides`, UI **Custom
translations**): per-installation replacements for individual UI strings in
any language, applied on top of the catalogs.
[Languages and localization](architecture/i18n.md)

## AI post-production

**AI post-production** (UI **Automatic post-production**): the in-cluster
pipeline that turns an event recording into transcripts, summaries,
translations, subtitles and dubbed audio. It is opt-in per event, has a
master switch (`aiPipelineEnabled`), and calls no external AI service.
[AI post-production](POSTPROD.md),
[ADR-016](adr/016-in-cluster-ai-postproduction.md)

**Artifact** (`PostprodArtifact`): one output of the pipeline for one
recording, with one row per type and language, for example a transcript in
WebVTT or a summary in Markdown. The types are listed in
`PostprodArtifactType`. [AI post-production](POSTPROD.md)

**Data sovereignty**: the rule that every model runs inside the installation's
cluster and no recording or transcript leaves it for an external AI API. It is
enforced in `app/src/lib/ai/providers.ts`. [AI post-production](POSTPROD.md)

**Diarization**: splitting a mixed audio track into anonymous voice clusters
(speaker labels). It applies only to composite recordings; multitrack
recordings do not need it. [AI post-production](POSTPROD.md)

**Dubbing** (UI **Dubbing**): synthetic speech in a target language generated
from a translated transcript, using catalog voices only and never voice
cloning. [Recordings, voice data and AI outputs](privacy/recordings-and-ai.md)

**Job, job kind** (`PostprodJob`, `PostprodJobKind`): one unit of pipeline
work in the PostgreSQL queue, and its type (transcription, summary,
translation and so on). The enum in `app/prisma/schema.prisma` is
authoritative. [AI post-production](POSTPROD.md#job-graph)

**Machine version** and **revised version**: a transcript as the speech
recognizer produced it, and the same transcript after a person corrected it
(`revisedAt`). When a transcript is corrected for the first time, the machine
version is preserved (`PostprodOriginalBody`), and the editor can show it
under each corrected line (UI **Show original text**).
[AI post-production](POSTPROD.md)

**Multitrack recording** (`multitrackRecordingEnabled`, UI **Per-participant
recording**): capturing one separate audio track per participant, so the
transcript knows exactly who said what and handles people talking over each
other. It requires each participant's explicit consent.
[ADR-013](adr/013-multitrack-speaker-attribution.md),
[Recording](architecture/recording.md)

**Orchestrator and worker**: the orchestrator is a CronJob that asks the
portal how many workers are wanted and starts one-shot worker Jobs on the GPU
node pool up to that number, counting those already running, using a
suspended CronJob as their template. Each worker (`infra/ai/worker`) claims a
job from the queue, runs the models and uploads the artifacts.
[AI post-production](POSTPROD.md#orchestrator-and-worker)

**Per-participant audio track** (`RecordingTrack`): one participant's
isolated audio in a multitrack recording. It is deleted after transcription
unless the event keeps tracks (`retainParticipantTracks`, UI **Keep
per-participant tracks**).
[Recordings, voice data and AI outputs](privacy/recordings-and-ai.md)

**Pipeline snapshot** (`Recording.pipelineSnapshot`, UI **AI processing
transparency**): the record of which engines, models, voices and languages
produced a recording's outputs, as they were when processing finished. Viewers
can open it next to the video. [AI post-production](POSTPROD.md)

**Recorder bot and recorder controller** (`infra/recorder`,
`infra/recorder-controller`): the bot joins a conference in headless Chrome and
records one audio track per participant; the controller is a reconciling
service that starts a recorder Job for each event that needs one.
[Recording](architecture/recording.md)

**Recording** (`Recording`): one capture of an event, tied one-to-one to a
call session: the composite video, the per-participant tracks when multitrack
recording is on, and everything derived from them (jobs, artifacts, speaker
labels). Its status (`RecordingStatus`) follows post-production.
[Recording](architecture/recording.md)

**Speaker label** (`Speaker.diarLabel`, for example `SPEAKER_00`): the
anonymous voice cluster that diarization assigns, which an administrator maps
to a name or to a person in the address book. It is unrelated to the speaker
role. [AI post-production](POSTPROD.md)

**Synthetic marking**: how AI outputs declare themselves. Every artifact is
flagged as synthetic (`isSynthetic`) and shown with the badge **AI-generated
content**; dubbed audio also carries an AudioSeal watermark when watermarking
succeeds (`watermarkType`).
[Recordings, voice data and AI outputs](privacy/recordings-and-ai.md)

**Transcript** and **transcription**: the artifact (text with timestamps and
speakers) and the process that produces it. The summary, translations and
subtitles are all derived from the transcript.
[AI post-production](POSTPROD.md)

## Privacy and data protection

**Address book** (`Person`, UI **Address book**, route `/admin/rubrica`): the
cross-event record of people who explicitly opted in to be invited again. It
has its own retention and a self-service opt-out.
[ADR-011](adr/011-person-rubrica.md),
[Privacy and data protection](GDPR.md)

**Administration audit log** (`AdminAuditLog`): the record of privileged
administrative writes, with the actor recorded as `admin:<accountId>`,
`organizer:<accountId>` or, for the instance key, a session fingerprint.
[Identity, access and tokens](architecture/identity-and-access.md#audit-actor-format)

**Consent**: a data subject's specific agreement, recorded per purpose in its
own field. At registration, participation, recording, per-participant
recording, future communications and the address book are separate choices;
AI post-production is announced with a notice in the waiting room.
[Privacy and data protection](GDPR.md)

**Consent snapshot** (`Recording.consentSnapshot`): the event's AI and
per-participant recording settings as they were when a recording was queued
for post-production, so a later change to the event does not silently alter
what governs outputs already produced.
[Recordings, voice data and AI outputs](privacy/recordings-and-ai.md)

**Controller** (GDPR Art. 4(7)): the body that decides why and how personal
data is processed. For an installation this is normally the public body that
runs the events. [Privacy notice checklist for controllers](privacy/privacy-notice-checklist.md)

**Data subject**: the person the personal data is about: a registrant, guest,
speaker, staff member or address-book entry.
[Privacy and data protection](GDPR.md)

**Email hash** (`emailHash`): a keyed hash (HMAC-SHA-256 with `APP_SECRET`) of
a normalized email address, used to find duplicates without decrypting
anything. [Security architecture](architecture/security.md)

**Encryption at rest**: personal fields (names, email addresses, chat text,
transcripts held in the database) are stored encrypted with AES-256-GCM under
`PII_ENCRYPTION_KEY`. [Security architecture](architecture/security.md)

**Erasure** (right to erasure, GDPR Art. 17): deleting a data subject's
personal data on request, alongside the automatic deletion at the end of
retention. [Privacy and data protection](GDPR.md)

**GDPR audit log** (`GdprAuditLog`, UI **GDPR audit**): per-event records of
personal-data operations such as consents, exports and deletions. It records
no actor. [Privacy and data protection](GDPR.md)

**GDPR cleanup**: the scheduled job (`/api/cron/cleanup`; daily in the Helm
chart, hourly in Compose) that deletes or scrubs personal data of events past
their retention and marks those events `ARCHIVED`.
[Privacy and data protection](GDPR.md)

**Privacy notice** (UI **Privacy policy**) and **privacy notice template**
(`GdprTemplate`, UI **GDPR templates**): the information text a controller
gives data subjects, set per installation and per event. Templates let the
same text be reused across events.
[Privacy and data protection](GDPR.md)

**Processor** (GDPR Art. 4(8)): a body that processes personal data on the
controller's behalf, for example an operator or hosting provider that runs the
installation for a public body.
[Privacy notice checklist for controllers](privacy/privacy-notice-checklist.md)

**Retention**: how long each kind of personal data is kept before deletion.
Events (`dataRetentionDays`), the address book, recordings, per-participant
tracks and AI artifacts each follow their own regime.
[Privacy and data protection](GDPR.md)

**Right of access** (Art. 15) and **right to object** (Art. 21): a data
subject's right to obtain their data, and to object to further processing,
such as staying in the address book.
[Privacy and data protection](GDPR.md)

## Development process

**Code review**: the review every non-trivial change gets before it is
committed or merged, in which each confirmed finding is fixed or accepted on
purpose. [How we develop PA Webinar](development/methodology.md#code-review)

**Coverage ratchet**: the rule that the unit-test coverage thresholds in
`app/vitest.config.ts` sit just below the measured value, rise with it and are
never lowered to let a change pass.
[How we develop PA Webinar](development/methodology.md#the-coverage-ratchet),
[Testing](development/testing.md#coverage)

**Guard test**: a test or lint rule that encodes a project rule, such as
translation parity or route declarations, by reading the repository and
failing when the rule is broken.
[Testing](development/testing.md#guard-tests-that-encode-rules)

**Pre-commit gates** and **CI parity**: the lint, type check and unit tests
run locally before every commit, and the practice of running the same
commands as the CI workflow before every push.
[Local gates](development/methodology.md#local-gates-before-every-commit),
[CI parity](development/methodology.md#ci-parity-before-every-push)

## Italian UI labels

The default UI language is Italian, so screenshots and live installations
often show Italian labels. The tables below give, for each label, the English
label from `en.json` and the term these docs use. Labels come verbatim from
`app/src/i18n/messages/it.json` and `en.json`; if a label changes there, the
catalogs win. The English UI writes **Organiser** for the staff role, while
these docs and the code use *organizer*.

### Roles and access

| Italian UI | English UI | Term in these docs |
|---|---|---|
| Amministrazione | **Administration** | administration area |
| Utenze | **Accounts** | staff accounts (`StaffAccount`) |
| Amministratore | **Administrator** | administrator (`ADMIN`) |
| Organizzatore | **Organiser** | organizer (`ORGANIZER`) |
| Organizzatori | **Organizers** | co-organizing organizations (`EventOrganizer`) |
| Accesso con la chiave dell’istanza | **Sign in with the instance key** | instance API key |
| Moderatore | **Moderator** | moderator (`MODERATOR`) |
| Moderatore principale | **Primary moderator** | primary moderator (the event's contact for the moderator link) |
| Link da moderatore | **Moderator link** | moderator link |
| Moderatori | **Moderators** | moderator links of all events |
| Relatore | **Speaker** | speaker (grant role `SPEAKER`) |
| Partecipante | **Participant** | participant (a registrant in the room) |
| Ospite | **Guest** | guest |

### Event statuses and types

| Italian UI | English UI | Term in these docs |
|---|---|---|
| Bozza | **Draft** | draft (`DRAFT`) |
| Pubblicato | **Published** | published (`PUBLISHED`) |
| Sala in allestimento... | **Room warming up...** | `PROVISIONING` / `IDLE` warm-up |
| Sala in preparazione... | **Preparing room...** | 'room being prepared' screen |
| In corso | **Live** | live (`LIVE`) |
| In pausa | **Idle** | idle (`IDLE`), in the instant-call list |
| Concluso | **Ended** | ended (`ENDED`) |
| Archiviato | **Archived** | archived (`ARCHIVED`) |
| Chiamate rapide | **Instant calls** | instant call (`INSTANT`) |
| Archivi caricati | **Uploaded archive** | legacy event (`LEGACY`) |

### Organizing an event

| Italian UI | English UI | Term in these docs |
|---|---|---|
| Template eventi | **Event templates** | event template (`EventTemplate`) |
| Base | **Basics** | event wizard, step 1 |
| Permessi | **Permissions** | event wizard, step 2 (permission matrix) |
| Persone | **People** | event wizard, step 3 |
| Contenuti | **Content** | event wizard, step 4 |
| Riepilogo | **Review** | event wizard, step 5 |
| Ricorrenza | **Recurrence** | recurrence rule (`recurrenceRule`) |
| Duplica per la prossima | **Duplicate for next time** | duplicate as the next occurrence |
| Iscrizioni | **Sign-ups** | registrations (`Registration`) |
| Registrazione all'evento | **Event registration** | registration (never "recording") |
| Inviti | **Invitations** | invitations (`EventInvitation`) |
| Notifiche | **Notifications** | reminders (`EventReminder`) |
| Questionari | **Questionnaires** | questionnaires |
| Questionario di pre-registrazione | **Pre-registration questionnaire** | pre-registration questionnaire (`PRE_REGISTRATION`) |
| Questionario post-evento | **Post-event questionnaire** | post-event questionnaire (`POST_EVENT`) |
| Materiali | **Materials** | materials (`EventMaterial`) |

### Waiting room

| Italian UI | English UI | Term in these docs |
|---|---|---|
| Entra nella piazza | **Step into the square** | the square |
| Vista classica | **Classic view** | classic view |
| Videogame (lobby Phaser) | **Videogame (Phaser lobby)** | waiting-room engine `GAME` (also shown for `GARDEN`) |
| Classica (statica) | **Classic (static)** | waiting-room engine `CLASSIC` |
| Sfondo virtuale | **Virtual background** | virtual backgrounds |
| Audio sala d'attesa (facoltativo) | **Waiting-room audio (optional)** | waiting-room music (`waitingRoomAudioUrl`) |
| Elaborazione AI dopo l'evento | **AI processing after the event** | AI post-production notice |

### Live room

| Italian UI | English UI | Term in these docs |
|---|---|---|
| Avvia evento | **Start event** | Start event (`PUBLISHED` to `LIVE`) |
| Termina per tutti | **End for everyone** | End for everyone |
| Esci solo tu | **Just leave** | Just leave |
| Domande e Risposte | **Questions & Answers** | Q&A (`Question`) |
| Sondaggi | **Polls** | polls (`Poll`) |
| Nuvola di parole | **Word cloud** | word cloud (`WordCloudRound`) |
| Reazioni | **Reactions** | reactions |
| Mani alzate | **Raised hands** | raised-hand queue |
| Note / Checklist | **Notes / Checklist** | agenda (`agendaEnabled`) |
| Lavagna | **Whiteboard** | whiteboard (`whiteboardEnabled`) |
| Registrazione in corso | **Recording in progress** | recording (never "registration") |
| Guarda dall'inizio | **Watch from the start** | temporary recording (catch-up) |

### After the event

| Italian UI | English UI | Term in these docs |
|---|---|---|
| Riepilogo dell'evento | **Event recap** | event recap (`postEventRecap`) |
| Feedback | **Feedback** | post-event feedback (`EventFeedback`) |
| Libreria video | **Video library** | video library |
| Pubblicazioni | **Publications** | publications |
| Statistiche | **Statistics** | event analytics |
| Statistiche | **Analytics** | instance-wide analytics |
| Video & sessioni | **Video & sessions** | recordings and call sessions |

### AI post-production

| Italian UI | English UI | Term in these docs |
|---|---|---|
| Post-produzione automatica | **Automatic post-production** | AI post-production |
| Trascrizioni / AI | **Transcripts / AI** | AI post-production (administration list) |
| Registrazione per-partecipante | **Per-participant recording** | multitrack recording |
| Conserva le tracce per-partecipante | **Keep per-participant tracks** | retained per-participant tracks (`retainParticipantTracks`) |
| Trascrizione | **Transcript** | transcript |
| Sintesi | **Summary** | summary |
| Sottotitoli | **Subtitles** | subtitles |
| Doppiaggio | **Dubbing** | dubbing |
| Contenuto generato da AI | **AI-generated content** | synthetic marking (`isSynthetic`) |
| Trasparenza del processing AI | **AI processing transparency** | pipeline snapshot (`pipelineSnapshot`) |
| Mostra testo originale | **Show original text** | machine version of a transcript |

### Platform and privacy

| Italian UI | English UI | Term in these docs |
|---|---|---|
| Impostazioni sito | **Site settings** | site settings (`SiteSetting`) |
| Traduzioni personalizzate | **Custom translations** | translation overrides (`translationOverrides`) |
| Template email | **Email templates** | email templates (`EmailTemplate`) |
| Rubrica | **Address book** | address book (`Person`) |
| Stato del sistema | **System status** | status page (`/status`) |
| Infrastruttura | **Infrastructure** | infrastructure page (`/admin/infrastructure`) |
| Monitoraggio | **Monitoring** | monitoring |
| Inventario servizi | **Service inventory** | service inventory (`/service-inventory`) |
| Novità e changelog | **What's new & changelog** | release notes (`/changelog`) |
| Sicurezza e trasparenza | **Security and transparency** | security and transparency page (`/security`) |
| Dichiarazione di accessibilità | **Accessibility statement** | accessibility statement |
| Informativa privacy | **Privacy policy** | privacy notice |
| Template GDPR | **GDPR templates** | privacy notice template (`GdprTemplate`) |
| Audit GDPR | **GDPR audit** | GDPR audit log (`GdprAuditLog`) |

## Abbreviations

| Abbreviation | Expansion |
|---|---|
| ADR | Architecture Decision Record. The index is in [adr/README.md](adr/README.md). |
| AgID | Agenzia per l'Italia Digitale (Agency for Digital Italy), the Italian digital-government agency. |
| AI Act | Regulation (EU) 2024/1689 on artificial intelligence. Its Art. 50 sets the transparency duties for AI-generated content. |
| ASR | Automatic speech recognition. |
| CSP | Content Security Policy. See [SECURITY-CSP.md](SECURITY-CSP.md). |
| DPO | Data protection officer (Italian *RPD*). |
| DTD | Dipartimento per la Trasformazione Digitale (Italian Department for Digital Transformation). |
| EUPL | European Union Public Licence. PA Webinar is released under EUPL-1.2. |
| GDPR | General Data Protection Regulation, Regulation (EU) 2016/679. |
| HPA | Horizontal Pod Autoscaler, the Kubernetes object that scales the portal's replicas (`autoscaling.enabled`). |
| ICE | Interactive Connectivity Establishment, how a browser and a bridge find a working network path (direct UDP, or a TURN relay). |
| JVB | Jitsi Videobridge. |
| JWT | JSON Web Token. |
| LLM | Large language model. |
| MUC | Multi-user chat, the XMPP room behind a Jitsi conference. |
| PA | *Pubblica amministrazione*: public administration. |
| PII | Personally identifiable information. |
| SBOM | Software bill of materials. |
| SFU | Selective forwarding unit, a media server that forwards streams without mixing them. The JVB is one. |
| SSE | Server-sent events, the one-way HTTP stream the portal uses for realtime updates. |
| STUN | Session Traversal Utilities for NAT. |
| TTS | Text-to-speech. |
| TURN / TURNS | Traversal Using Relays around NAT; TURNS is TURN over TLS. |
| WCAG | Web Content Accessibility Guidelines, the basis of the accessibility requirements that Italian law (*Legge Stanca*, the Italian accessibility law) sets for public administrations. |
| XMPP | Extensible Messaging and Presence Protocol, Jitsi's signaling protocol. |
