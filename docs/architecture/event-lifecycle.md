# Event lifecycle

Every event in PA Webinar carries a single `status` (Prisma enum `EventStatus`). The status decides whether the event has a public page, whether people can register, whether anyone can enter the live room, whether a Jitsi Videobridge (JVB) is paid for, and when participant data is deleted. This page owns that state machine: what each status means, who moves an event from one status to the next in each kind of installation, which joins each status admits, how grace, overtime and revival work, how call sessions are recorded, and how an ended event is handed over to archiving.

It does not repeat the neighboring mechanisms:

- how the JVB scaler computes bridge capacity, aggregates bridge statistics and scales node pools: [scaling.md](scaling.md);
- every runtime setting with its default and where it is edited: [runtime-settings.md](../configuration/runtime-settings.md);
- what the waiting room contains and how the optional square works: [waiting-room.md](waiting-room.md);
- credentials, tokens and the Jitsi JWT: [identity-and-access.md](identity-and-access.md);
- enabling, tuning and pausing the scaler on a cluster: [operations/jvb-scaler.md](../operations/jvb-scaler.md).

Two drivers move events automatically, never both at once: the JVB scaler in the Helm `full` profile, and the lifecycle cron everywhere else. How the portal chooses between them is in [Running without the scaler](#running-without-the-scaler).

## Quick answers

For organizers and moderators who need to predict when a room opens and closes:

| Question | Helm `full` profile with the JVB scaler | Any other installation (Docker Compose, Helm `simple` or `standard`, an external Jitsi, bridges scaled by KEDA) |
|---|---|---|
| When can people enter? | At the first scaler tick at or after `startsAt` once a bridge answers, or earlier if a moderator pressed **Start event** | At the first lifecycle tick (every minute) at or after `startsAt`, provided the bridge answers when `JVB_HEALTH_URL` is set, or earlier if a moderator pressed **Start event** (instant calls are open from creation) |
| When does the room close? | At `endsAt` plus the grace period, when a moderator chooses **End for everyone**, or when an open-ended room has been empty long enough | At `endsAt` plus the grace period, when a moderator chooses **End for everyone** or **End event**, or, for an open-ended room past `endsAt` and for an instant call, after `jvbInactiveGraceMinutes` without activity |
| What happens during a long break with nobody connected? | Before `endsAt`, the room goes `IDLE` and its bridge is released; the first person to come back wakes it (a few minutes on a cold node) | Nothing: a scheduled room stays `LIVE` until its end, because there is no `IDLE` without the scaler |
| When is participant data deleted? | After `endsAt` plus the event's retention days, by the cleanup job, whether or not the event was ended | Same |

## Statuses

| Status | Meaning | Waiting room, in brief |
|---|---|---|
| `DRAFT` | Created but not published. Only staff and moderator-link holders can see it. New events, duplicates and events saved with **Save as draft** start here. | Entry disabled with a valid link; without one, the live URL redirects to registration, which answers 404 |
| `PUBLISHED` | Announced: the public page and the listings show it, and registration is open until `endsAt`. No bridge is reserved. | Countdown, then an about-to-start notice; **Start event** for moderators. Past `endsAt`: **The scheduled time for this event has passed**, no entry |
| `PROVISIONING` | A bridge is being brought up for the event, set by the scaler's pre-scale or by a wake. Nobody can enter yet. | **Room warming up** banner, or **The room opens at the start time** when the scaler is not driving the lifecycle; entry disabled; **Start event** for moderators |
| `LIVE` | The room is open. It is the only status in which the waiting room lets anyone into the Jitsi conference and the only one that admits guests. | **Enter now** |
| `IDLE` | The room was `LIVE`, stayed empty for the inactivity grace and its bridge was scaled to zero. Only the scaler sets it. | As `PROVISIONING`; opening the page wakes the room; **Start event** for moderators |
| `ENDED` | The event is over. With the scaler, bridges are released on the next tick. The post-event page stays public unless it was turned off (`postEventPublic`, on by default for scheduled events and off for instant calls) or `postEventPublicUntil` has passed. | Closing view: recording and feedback |
| `ARCHIVED` | Hidden from every public surface. The event row (title, description, dates) is kept as a record; participant data is deleted once retention expires. | Entry disabled with a valid link; without one, a redirect to the event page, which is not public |

The exact screen for each combination of status, time and bridge readiness, with every label, is described in [waiting-room.md](waiting-room.md#what-each-state-shows).

Historical events imported from an external video source (event type `LEGACY`) are created directly as `ENDED` and never enter the live flow.

### Public visibility and registration by status

The rules live in `app/src/lib/events/visibility.ts`.

| Status | Public page and listings | Registration |
|---|---|---|
| `DRAFT` | No | Closed |
| `PUBLISHED` | Yes. The home page and the public calendar list it only until `endsAt` | Open until `endsAt` |
| `LIVE` | Yes, also past `endsAt` (instant calls never get a public page while running) | Open, also past `endsAt`: the grace period and open-ended rooms keep a room legitimately running |
| `PROVISIONING`, `IDLE` | Scheduled events only, until `endsAt` | Open on the same terms |
| `ENDED` | Only while the post-event page is enabled (`postEventPublic`) and `postEventPublicUntil`, if set, is in the future | Closed |
| `ARCHIVED` | No | Closed |

"Open" means open to anyone while the site setting `publicRegistrationEnabled` is on. With it off, only the addresses on the event's invitation list can register, and an event without invitations accepts no new registrations ([Invitation-only registration](event-journey.md#invitation-only-registration)).

The home page and the public calendar ask for upcoming events only (`publicEventStatusWhere({ includeEnded: false })`): they list `LIVE` events always and `PUBLISHED`, `PROVISIONING` and `IDLE` events only before `endsAt`. The other listings, the sitemap and the public API list `PUBLISHED` events whatever their `endsAt`. Registration is refused with `409` once a `PUBLISHED` event is past its end, and its registration page answers 404. Its public page shows it as ended, with no registration button, room link or add-to-calendar links: the page asks `isEventOpenForRegistration()` on the server rather than deciding from the status.

Page visibility after the event and the event journey around it are described in [event-journey.md](event-journey.md).

## The state machine

Each transition is labeled with the actor that performs it:

- `staff:` an administrator or organizer session in the administration area;
- `moderator:` anyone holding a moderator credential (the event's moderator link or a named `MODERATOR` grant); the administration area uses the event's moderator token on the staff member's behalf;
- `scaler:` the JVB scaler tick, which runs only in the Helm `full` profile with the scaler enabled;
- `lifecycle:` the lifecycle cron (`GET /api/cron/lifecycle`, every minute), which runs in every installation without the scaler;
- `wake:` the unauthenticated `POST /api/events/<slug>/wake` endpoint, called by the event and waiting-room pages;
- `cleanup:` the GDPR cleanup job (daily in the Helm chart, hourly in Compose).

```mermaid
stateDiagram-v2
  classDef human fill:#E6F0FA,stroke:#0066CC,stroke-width:2px,color:#17324D
  classDef auto fill:#E0F5F5,stroke:#00A3A3,stroke-width:2px,color:#17324D
  classDef live fill:#E3F2EC,stroke:#008055,stroke-width:2px,color:#17324D
  classDef terminal fill:#EEF1F4,stroke:#5C6F82,stroke-width:2px,color:#17324D
  classDef cron fill:#FFF3E0,stroke:#CC7A00,stroke-width:2px,color:#17324D

  [*] --> DRAFT : staff: create or duplicate
  [*] --> LIVE : staff: instant call
  DRAFT --> PUBLISHED : moderator: Publish
  PUBLISHED --> DRAFT : moderator: Unpublish
  PUBLISHED --> PROVISIONING : scaler: pre-scale<br/>wake: early arrival, with the scaler
  PROVISIONING --> PUBLISHED : moderator: Publish
  PUBLISHED --> LIVE : moderator: Start event<br/>lifecycle: start reached
  PROVISIONING --> LIVE : scaler: bridge up, start passed<br/>moderator: Start event
  LIVE --> IDLE : scaler: room empty
  IDLE --> PROVISIONING : wake: someone arrives
  IDLE --> LIVE : moderator: Start event
  LIVE --> ENDED : moderator: End for everyone<br/>scaler or lifecycle: grace over or inactive
  PUBLISHED --> ENDED : scaler or lifecycle: endsAt passed
  PROVISIONING --> ENDED : scaler or lifecycle: endsAt passed
  IDLE --> ENDED : scaler or lifecycle: endsAt passed
  ENDED --> LIVE : moderator: revive, start passed
  ENDED --> PUBLISHED : moderator: revive, start ahead
  ENDED --> ARCHIVED : cleanup: retention over
  ARCHIVED --> PUBLISHED : moderator: Publish (management page)

  class DRAFT,PUBLISHED human
  class PROVISIONING,IDLE auto
  class LIVE live
  class ENDED terminal
  class ARCHIVED cron
```

Blue statuses are set by people, teal ones only by automation, green is the open room, gray is the end of the live phase and amber is the retention hand-off. Instant calls are created directly as `LIVE`. Three actions are left out of the drawing to keep it readable: bulk archive moves any status to `ARCHIVED`, **Publish** on the management page also moves an `IDLE` event to `PUBLISHED`, and the cleanup job archives an event that was never ended once its retention has passed. The lifecycle cron also opens `PROVISIONING` and `IDLE` events it finds, although it never sets either status. The diagram shows the transitions the user interface offers; the events API itself accepts an explicit `DRAFT`, `PUBLISHED`, `LIVE` or `ENDED` from any status (see [Manual transitions](#manual-transitions)). With the scaler there are no `lifecycle:` edges; without it there are no `scaler:` edges, a wake leaves a `PUBLISHED` event unchanged and `IDLE` never occurs: see [Running without the scaler](#running-without-the-scaler).

## Who moves an event

### Transition reference

"Compose" is the single-VM Docker Compose installation. The Helm columns follow `jitsi.mode`; the scaler CronJob renders only when `jitsi.enabled` is true, `jitsi.mode` is `full` and `jvbScaler.enabled` is true (`infra/helm/pa-webinar/templates/cronjob-jvb-scaler.yaml`; `jvbScaler.enabled` is `false` in `infra/helm/pa-webinar/values.yaml`). Whenever it does not render, the chart renders the lifecycle CronJob instead (`<fullname>-lifecycle`, `cronjobs.lifecycle` in `values.yaml`, `templates/cronjob-lifecycle.yaml`), and Compose's `cron` service calls the same route every minute. A `full` installation with the scaler disabled, or with an external Jitsi, behaves like the middle column.

| Transition | Trigger | Actor | Compose | Helm `simple` / `standard` | Helm `full` with scaler |
|---|---|---|---|---|---|
| create → `DRAFT` | Event wizard, **Duplicate for next time** on the management page, or **Duplicate as next occurrence** in the event card menu | Administrator or organizer | Yes | Yes | Yes |
| create → `LIVE` | **New call** under **Instant calls** | Administrator or organizer | Yes | Yes | Yes |
| `DRAFT` → `PUBLISHED` | **Publish event** in the wizard, or **Publish** on the management page or in the event card menu | Moderator credential | Yes | Yes | Yes |
| `PUBLISHED` → `DRAFT` | **Unpublish** | Moderator credential | Yes | Yes | Yes |
| `PROVISIONING`, `IDLE`, `ARCHIVED` → `PUBLISHED` | **Publish** on the management page | Moderator credential | Yes (`ARCHIVED` only) | Yes (`ARCHIVED` only) | Yes |
| `PUBLISHED`, `PROVISIONING`, `IDLE` → `LIVE` | **Start event** on the management page or in the waiting room | Moderator credential | Yes (`PUBLISHED` only) | Yes (`PUBLISHED` only) | Yes |
| `LIVE` → `ENDED` | **End for everyone** (after **Leave room**) or **End event** in the moderator bar | Moderator credential | Yes | Yes | Yes |
| `ENDED` → `PUBLISHED` or `LIVE` | Saving the event with a future `endsAt` (revival) | Moderator credential | Yes | Yes | Yes |
| any → `ARCHIVED` | Bulk **Archive** in the event list | Administrator, or organizer for their own events | Yes | Yes | Yes |
| `PUBLISHED` → `PROVISIONING` | Scaler pre-scale at `startsAt` minus `jvbPreScaleMinutes` | Scaler | No | No | Yes |
| `PUBLISHED` → `PROVISIONING` | `POST /wake` inside the wake window | Any visitor | No: `/wake` answers `200` and leaves the status unchanged | No: same | Yes |
| `PROVISIONING` → `LIVE` | Bridge reachable and `startsAt` passed | Scaler | No | No | Yes |
| `PUBLISHED`, `PROVISIONING`, `IDLE` → `LIVE` | `startsAt` passed and `endsAt` ahead, while the bridge answers `JVB_HEALTH_URL` (or `JVB_HEALTH_URL` is not set) | Lifecycle cron | Yes (the bridge is assumed present) | Yes | No |
| `LIVE` → `IDLE` | Room empty for `jvbInactiveGraceMinutes`, before `endsAt` | Scaler | No | No | Yes |
| `IDLE` → `PROVISIONING` | `POST /wake` | Any visitor | Does not occur (no `IDLE`) | Does not occur | Yes |
| `LIVE` → `ENDED` | `endsAt` plus grace elapsed | Scaler or lifecycle cron | Yes | Yes | Yes |
| `LIVE` → `ENDED` | Opt-in empty close (`jvbEmptyCloseMinutes`) | Scaler or lifecycle cron | No (no `JVB_HEALTH_URL`) | Yes, if enabled and the bridge answers | Yes, if enabled |
| `LIVE` → `ENDED` | Open-ended room (grace `-1`) past `endsAt` and without activity for `jvbInactiveGraceMinutes` | Scaler or lifecycle cron | Yes | Yes | Yes |
| `LIVE` → `ENDED` | Instant call without activity for `jvbInactiveGraceMinutes`, before its `endsAt` | Lifecycle cron | Yes | Yes | No (the scaler moves it to `IDLE`) |
| `PUBLISHED`, `PROVISIONING`, `IDLE` → `ENDED` | `endsAt` passed | Scaler or lifecycle cron | Yes | Yes | Yes |
| `ENDED` → `ARCHIVED`; `PUBLISHED`, `PROVISIONING`, `IDLE`, `LIVE` → `ARCHIVED` | Retention expired | Cleanup job | Yes (hourly) | Yes (daily) | Yes (daily) |

### Manual transitions

All manual changes to an existing event's status, except bulk archive, go through `PUT /api/events/<id>`, authenticated with a moderator credential (the primary moderator link or a non-revoked named `MODERATOR` grant; `SPEAKER` grants are refused). The request schema accepts an explicit `status` of `DRAFT`, `PUBLISHED`, `LIVE` or `ENDED`; `PROVISIONING`, `IDLE` and `ARCHIVED` cannot be set this way. The endpoint does not check the current status before applying an explicit one: the user interface is what limits the choices, by showing only the buttons that make sense. Every status change through this endpoint is written to the administration audit log (`EVENT_UPDATE`) and announced on the room's live channel. The scaler and the lifecycle cron announce theirs on the same channel after their transaction commits. Waiting rooms and live rooms also poll `GET /api/events/<slug>/lifecycle` (every 3 seconds in the waiting room and every 5 seconds in the call, in `app/src/components/live/live-event-client.tsx`), so they notice every change even when an announcement is lost. A request that moves the event out of `LIVE`, or moves an event still in service to `ENDED`, closes its open call sessions in the same transaction (see [Call sessions](#call-sessions)).

- **Publish.** The wizard always creates the event as `DRAFT` (`POST /api/events`). If the organizer chose **Publish event**, the wizard then sends a second request that sets `PUBLISHED`. The event card menu offers **Publish** or **Unpublish** only for scheduled events in `DRAFT` or `PUBLISHED`, and toggles between the two. The management page button reads **Unpublish** on a `PUBLISHED` event, which it sends back to `DRAFT`, and **Publish** on any other status, which it sets to `PUBLISHED`. It is disabled only while the event is `LIVE` or `ENDED`, so it also moves `PROVISIONING`, `IDLE` and `ARCHIVED` events to `PUBLISHED`.
- **Start event.** Shown on the management page and, to moderators only, in the waiting room, while the event is `PUBLISHED`, `PROVISIONING` or `IDLE` (`canStartManually()` in `app/src/lib/events/lifecycle.ts`), in every installation. It sets `LIVE` immediately. When the start is more than 30 minutes away (`app/src/components/admin/event-management-client.tsx`), the management page adds a warning that the video servers may take a couple of minutes to come up. In the `full` profile the scaler moves the event to `PROVISIONING` `jvbPreScaleMinutes` before the start and to `LIVE` by itself at `startsAt`; the button stays available meanwhile. The waiting room shows no **Start event** on a `PUBLISHED` event past its `endsAt`.
- **End.** A moderator who clicks **Leave room** chooses between **Just leave** (the call continues for everyone else) and **End for everyone**. The latter asks what should happen to the event page afterwards (**Keep it public**, **Publish to the library** or **Archive (private)**, plus an option to generate an AI transcript and summary once the recording is processed) and then sets `ENDED` together with those choices. **Archive (private)** only hides the post-event page: the status is `ENDED`, not `ARCHIVED`. The moderator bar also has an **End event** button that sets `ENDED` after a confirmation, without the follow-up questions.
- **Revival.** See [Revival](#revival).
- **Bulk archive.** `POST /api/admin/events/bulk-archive` sets `ARCHIVED` on the selected events whatever their status, restricted to the organizer's own events when the caller is an organizer, and closes the open call sessions of those that were not already `ENDED` or `ARCHIVED`, in the same transaction. It deletes nothing; see [After the event](#after-the-event-hand-off-archiving-and-retention).

### Automatic transitions: the scaler tick

The scaler is a CronJob (every two minutes by default, `jvbScaler.schedule` in `infra/helm/pa-webinar/values.yaml`) that collects bridge statistics and calls `GET /api/internal/jvb-desired-replicas`. That route applies every lifecycle transition in one database transaction, in this order, and then computes the number of bridges to run. The rules live in `app/src/lib/events/lifecycle-tick.ts` (`scaler` mode), next to those of the lifecycle cron. How the statistics are gathered and how capacity is computed is in [scaling.md](scaling.md).

1. **Activity refresh.** If a bridge is reachable and reports at least one participant, every `LIVE` event gets `lastActiveAt` set to now. The participant count is bridge-wide, so a room is seen as empty only when the whole bridge is.
2. **Opt-in empty close** (`LIVE` → `ENDED`, before `endsAt`). Only when `jvbEmptyCloseMinutes` is not `-1`: a room that had traffic and has been empty for that many minutes is closed for good. It runs before the demotion below, so when both match the terminal close wins.
3. **Idle demotion** (`LIVE` → `IDLE`, before `endsAt`). See [Inactivity grace](#inactivity-grace-live-to-idle).
4. **Timeouts** (`PUBLISHED`, `PROVISIONING`, `IDLE` → `ENDED`). Any of these whose `endsAt` has passed ends immediately, without grace.
5. **Overtime close** (`LIVE` → `ENDED`, past `endsAt`). See [Grace period and overtime](#grace-period-and-overtime).
6. **Pre-scale** (`PUBLISHED` → `PROVISIONING`). Events whose `startsAt` is within `jvbPreScaleMinutes` from now, or already past, and whose `endsAt` is still ahead. `provisioningStartedAt` is stamped.
7. **Promotion** (`PROVISIONING` → `LIVE`). Only if a bridge is reachable, `startsAt` has passed and `endsAt` has not. `provisioningStartedAt` is stamped again, because the room became usable now. Because steps 6 and 7 run in the same tick, an event published after its start time goes `LIVE` within one tick once a bridge answers.

Steps 2 and 3 are skipped when the participant count cannot be trusted: more than one bridge replica and no cross-pod aggregation from the scaler. Step 2 also needs a reachable bridge. Every transition to `IDLE` or `ENDED` made by the scaler closes the event's open call sessions in the same transaction (see [Call sessions](#call-sessions)). When at least one event was promoted to `LIVE`, the route also notifies the recorder controller, if `RECORDER_CONTROLLER_URL` is set, so that multitrack recording starts without waiting for the controller's own reconcile loop ([recording.md](recording.md)).

Each tick also:

- writes the heartbeat `lifecycle:driver:scaler` to Redis, valid for 600 seconds, which tells the lifecycle cron and `/wake` that the scaler drives the lifecycle ([Which driver runs](#which-driver-runs));
- announces each status change on the room's live channel;
- closes the call sessions still open on `ENDED` and `ARCHIVED` events ([Call sessions](#call-sessions)).

Only `LIVE` and `PROVISIONING` events count toward the number of bridges; `IDLE` contributes zero. Suspending the scaler CronJob therefore pauses the whole automatic lifecycle, not only scaling: events stay `PUBLISHED` past their start, `LIVE` rooms are not closed after their grace and nothing goes `IDLE`, while every manual action keeps working. The chart renders the lifecycle CronJob only when it does not render the scaler, so nothing takes over during the pause. Three minutes after the last tick the heartbeat expires: from then on `/wake` no longer moves `PUBLISHED` events to `PROVISIONING`, and the waiting room of a `PROVISIONING` or `IDLE` event shows **The room opens at the start time** instead of the warm-up. Moderators can open any `PUBLISHED`, `PROVISIONING` or `IDLE` event with **Start event** ([operations/jvb-scaler.md](../operations/jvb-scaler.md)).

### Wake

`POST /api/events/<slug>/wake` records the intent to use a room; the scaler does the actual scaling on its next tick. It has no authentication, so it is bounded by a per-IP, per-event rate limit (60 requests per minute, `app/src/app/api/events/[param]/wake/route.ts`) and by a time window:

- `IDLE` → `PROVISIONING` at any time before `endsAt`. This is the only way out of `IDLE`: the scaler never promotes an `IDLE` event directly.
- `PUBLISHED` → `PROVISIONING` only while the scaler drives the lifecycle, and only once the start is closer than the larger of `jvbPreScaleMinutes` and `waitingRoomLeadMinutes`. Earlier calls get `409`. Instant calls are exempt from the window. Without the scaler, a `PUBLISHED` event stays `PUBLISHED`: the call answers `200` with the same response shape, before the window is checked, so it never answers `409` for being too early. The lifecycle cron opens the event at its start.
- `PROVISIONING` or `LIVE`: no change, `200`.
- `DRAFT`, `ENDED`, `ARCHIVED`, or any event past its `endsAt`: `409`.

The live page calls it once per page load, as soon as the status it shows is `IDLE`, whether on load or after a waiting-room poll: a visitor already waiting when the room goes `IDLE` wakes it at once. The event page calls it when a registrant presses the link to enter the room, so that the bridge starts a few seconds earlier. Both transitions stamp `provisioningStartedAt`.

### Instant calls

An instant call is created directly as `LIVE` by `POST /api/events/instant` (staff only). It gets (`app/src/app/api/events/instant/route.ts`):

- `endsAt` four hours after creation, a cosmetic upper bound;
- `gracePeriodMinutes` set to `-1`, so it never closes on the clock;
- `lastActiveAt` and `provisioningStartedAt` stamped at creation, so the inactivity rules have a starting point;
- `dataRetentionDays` set to 7 and `postEventPublic` off.

With the scaler, an empty instant call goes `IDLE` after the inactivity grace while its `endsAt` is ahead. Past `endsAt` an `IDLE` instant call ends, and a `LIVE` one ends once it has been empty for the inactivity grace. Anyone with the link can wait in the room while it is `LIVE`, `IDLE` or `PROVISIONING`, and enters when it is `LIVE`. Without the scaler an instant call ends after `jvbInactiveGraceMinutes` with no activity, before or after its `endsAt`. Activity means the headcount reports of the clients in the call, plus the bridge's participant count when `JVB_HEALTH_URL` answers (see [Inactivity grace](#inactivity-grace-live-to-idle)).

## Running without the scaler

Docker Compose, the Helm `simple` and `standard` profiles, a `full` installation with `jvbScaler.enabled: false` (bridges fixed or scaled by KEDA), and any installation that uses an external Jitsi (`jitsi.enabled: false`) run no scaler. PA Webinar does not start or stop the bridges there: they run with the fixed replicas of the chart or of Compose, or are managed by the external Jitsi deployment or by KEDA. The lifecycle cron moves the events instead, on the same time rules as the scaler, with no pre-scale and no `IDLE`.

### Which driver runs

The two drivers never work together, because the scaler warms and pauses rooms around the starting and stopping of bridges. The signal is a heartbeat that the scaler route writes to Redis on every tick, `lifecycle:driver:scaler`, valid for 600 seconds: two scaler runs plus the longest one, so a skipped or slow run does not hand over (`app/src/lib/events/lifecycle-driver.ts`). After the scaler is removed, the lifecycle cron takes over within ten minutes. `JVB_SCALER_ENABLED` alone is not enough: it says that the bridges scale by themselves, not that something moves the events, and with KEDA nothing does. It is the fallback when Redis is missing or does not answer within a second. Each app process keeps the answer for 5 seconds.

- `GET /api/cron/lifecycle` (protected by `CRON_API_KEY`) runs every minute: the chart's `<fullname>-lifecycle` CronJob (`cronjobs.lifecycle`), rendered whenever the scaler CronJob is not, and Compose's `cron` service. While the heartbeat is fresh it answers `{"skipped":"scaler"}` and changes nothing; otherwise it runs the fixed tick below.
- `POST /wake` moves a `PUBLISHED` event to `PROVISIONING` only while the heartbeat is fresh ([Wake](#wake)).
- `GET /api/events/<slug>/lifecycle` reports the phase `scheduled` for a `PROVISIONING` or `IDLE` event when the heartbeat is absent, and the waiting room then shows **The room opens at the start time** with a clock, instead of the warm-up phases and their timer ([waiting-room.md](waiting-room.md#what-each-state-shows)).

The chart's post-install notes name the lifecycle CronJob, and warn when neither driver is rendered (`cronjobs.lifecycle.enabled: false` without the scaler). In that case events move only by hand, with **Start event** and **End for everyone**, unless another tool calls `/api/cron/lifecycle`.

```mermaid
flowchart TB
  classDef job fill:#FFF3E0,stroke:#CC7A00,stroke-width:2px,color:#17324D
  classDef check fill:#E0F5F5,stroke:#00A3A3,stroke-width:2px,color:#17324D
  classDef live fill:#E3F2EC,stroke:#008055,stroke-width:2px,color:#17324D
  classDef terminal fill:#EEF1F4,stroke:#5C6F82,stroke-width:2px,color:#17324D

  CRON["Every minute<br/>GET /api/cron/lifecycle"]:::job
  HB{"Heartbeat<br/>lifecycle:driver:scaler<br/>in Redis?"}:::check
  ENV{"JVB_SCALER_ENABLED<br/>is true?"}:::check
  SKIP["skipped: scaler<br/>nothing changes"]:::terminal
  TICK["Fixed tick<br/>open, end,<br/>repair sessions"]:::live

  CRON --> HB
  HB -->|"yes: the scaler ticked<br/>in the last 3 minutes"| SKIP
  HB -->|"no"| TICK
  HB -->|"Redis missing<br/>or silent"| ENV
  ENV -->|"yes"| SKIP
  ENV -->|"no"| TICK
```

### The fixed tick

The fixed tick applies these rules in one database transaction (`app/src/lib/events/lifecycle-tick.ts`, `fixed` mode):

1. **Activity refresh.** When `JVB_HEALTH_URL` is set, answers and reports at least one participant, every `LIVE` event gets `lastActiveAt` set to now. As with the scaler, the count is bridge-wide, and it only ever keeps rooms alive. Rooms also report their own activity through the clients' headcount reports ([Call sessions](#call-sessions)).
2. **Opt-in empty close** (`LIVE` → `ENDED`, before `endsAt`). As with the scaler, only when `jvbEmptyCloseMinutes` is not `-1`, and only while `JVB_HEALTH_URL` answers: without a bridge reading there is no proof that a room is empty.
3. **Abandoned instant calls** (`LIVE` → `ENDED`, before their placeholder `endsAt`). An instant call ends when the latest of `lastActiveAt`, `provisioningStartedAt` and its creation is older than `jvbInactiveGraceMinutes`. A scheduled room before its `endsAt` is never ended for inactivity: an empty scheduled room is a break, and ending it would be final.
4. **Timeouts** (`PUBLISHED`, `PROVISIONING`, `IDLE` → `ENDED`). An event never opened ends as soon as its `endsAt` has passed.
5. **Overtime close** (`LIVE` → `ENDED`, past `endsAt`). At `endsAt` plus the grace period, or, for an open-ended room (grace `-1`), once its latest sign of activity is older than `jvbInactiveGraceMinutes` ([Grace period and overtime](#grace-period-and-overtime)).
6. **Opening** (`PUBLISHED`, `PROVISIONING`, `IDLE` → `LIVE`). Events whose `startsAt` has passed and whose `endsAt` is still ahead, provided the bridge answers `/colibri/stats` at `JVB_HEALTH_URL`. Without `JVB_HEALTH_URL` (an external Jitsi) there is nothing to ask and the bridge is assumed present. `provisioningStartedAt` is stamped, as with the scaler's promotion.

Every event that leaves `LIVE` closes its open call sessions in the same transaction. After the commit, the tick announces each status change on the room's live channel, notifies the recorder controller when it opened a room and `RECORDER_CONTROLLER_URL` is set, and closes the sessions still open on `ENDED` and `ARCHIVED` events. The route answers with the counts of each transition (`liveRefreshed`, `liveEmptyClosed`, `toLive`, `toEnded`), the number of sessions repaired and whether the bridge was probed and answered, and writes one log line per tick that changed something.

```mermaid
flowchart LR
  classDef human fill:#E6F0FA,stroke:#0066CC,stroke-width:2px,color:#17324D
  classDef live fill:#E3F2EC,stroke:#008055,stroke-width:2px,color:#17324D
  classDef terminal fill:#EEF1F4,stroke:#5C6F82,stroke-width:2px,color:#17324D
  classDef cron fill:#FFF3E0,stroke:#CC7A00,stroke-width:2px,color:#17324D

  D["DRAFT"]:::human
  P["PUBLISHED"]:::human
  L["LIVE<br/>bridge already running"]:::live
  E["ENDED"]:::terminal
  A["ARCHIVED"]:::cron

  D -->|"moderator: Publish"| P
  P -->|"lifecycle: start reached,<br/>bridge answers<br/>moderator: Start event"| L
  P -->|"lifecycle: endsAt passed,<br/>never opened"| E
  L -->|"lifecycle: endsAt plus grace,<br/>or inactive when open-ended<br/>or an instant call<br/>moderator: End for everyone"| E
  E -->|"cleanup job after<br/>endsAt plus dataRetentionDays"| A
```

What never happens without the scaler:

- `PUBLISHED` → `PROVISIONING`: there is no pre-scale, and `/wake` leaves a `PUBLISHED` event unchanged. The room opens at `startsAt`, not earlier, unless a moderator presses **Start event**.
- `IDLE`: an empty scheduled room stays `LIVE` until its end. Only instant calls and open-ended rooms past `endsAt` are ended for inactivity.

Transitions lag their nominal time by up to one lifecycle interval (one minute). An event that should open stays `PUBLISHED` while the bridge does not answer `JVB_HEALTH_URL`; a moderator can still open it with **Start event**.

## Which joins each status admits

Two layers decide whether someone gets into the conference: the waiting room, and the Jitsi token endpoint `POST /api/events/<slug>/jitsi/token`.

- **The waiting room** enables its join button only when the event is `LIVE`, for every role. Moderators reach `LIVE` from `PUBLISHED`, `PROVISIONING` or `IDLE` with **Start event**.
- **The token endpoint** mints a JWT only when the event is `PUBLISHED` or `LIVE`, and only when the event is `LIVE` for guests without a token. Any other status gets `409`. Guests also need guest access to be allowed: always for instant calls, and for scheduled events only while the `guestAccessEnabled` site setting is on (otherwise `403`).

| Status | Moderator or speaker link | Registrant | Guest (no token) |
|---|---|---|---|
| `DRAFT` | `409` | `409` | `409` |
| `PUBLISHED` | Token issued; the waiting room still waits for `LIVE` | Token issued; the waiting room still waits for `LIVE` | `409`; the live URL redirects to registration |
| `PROVISIONING`, `IDLE` | `409` | `409` | `409`; scheduled events redirect to registration (so tokenless guests cannot wake an `IDLE` room); instant calls show the waiting room |
| `LIVE` | Token issued | Token issued | Token issued when guest access is allowed, rate-limited per IP |
| `ENDED`, `ARCHIVED` | `409` | `409` | `409`; the live URL redirects to the event page (instant calls answer 404) |

When the token endpoint answers `409` to a client that tries to enter or rejoin, the client reads `/lifecycle`: an `ENDED` event takes it to the closing screen, and a `PUBLISHED`, `PROVISIONING` or `IDLE` one back to the waiting room.

A registrant is recognized from the personal link or from the signed per-event cookie set at registration, or, while public registration is off, by the signed entry link in the email. A forwarded personal link still gets in, but under the typed name and a fresh guest identity. On a password-protected event, the live page asks visitors without a token for the password before showing the waiting room. These rules, and the JWT claims themselves, are described in [identity-and-access.md](identity-and-access.md).

## Timing semantics

```mermaid
flowchart TB
  classDef human fill:#E6F0FA,stroke:#0066CC,stroke-width:2px,color:#17324D
  classDef auto fill:#E0F5F5,stroke:#00A3A3,stroke-width:2px,color:#17324D
  classDef live fill:#E3F2EC,stroke:#008055,stroke-width:2px,color:#17324D
  classDef terminal fill:#EEF1F4,stroke:#5C6F82,stroke-width:2px,color:#17324D
  classDef cron fill:#FFF3E0,stroke:#CC7A00,stroke-width:2px,color:#17324D

  A["PUBLISHED<br/>registration open,<br/>countdown in the waiting room"]:::human
  B["startsAt minus jvbPreScaleMinutes<br/>scaler: PROVISIONING<br/>bridge node starts"]:::auto
  C["startsAt and a bridge answers<br/>scaler: LIVE<br/>everyone can enter"]:::live
  D["endsAt passed<br/>still LIVE: overtime banner"]:::live
  E["endsAt plus grace<br/>scaler: ENDED<br/>bridges released"]:::terminal
  F["endsAt plus dataRetentionDays<br/>cleanup: ARCHIVED<br/>participant data deleted"]:::cron

  I["IDLE<br/>bridge scaled to zero"]:::auto
  W["PROVISIONING<br/>bridge restarts"]:::auto

  A -->|"pre-scale window opens"| B
  B -->|"wait for start"| C
  C -->|"scheduled end"| D
  D -->|"grace elapses"| E
  E -->|"cleanup job"| F

  C -.->|"room empty for<br/>jvbInactiveGraceMinutes"| I
  I -.->|"wake: someone arrives"| W
  W -.->|"scaler: bridge up"| C
  I -.->|"scaler: endsAt passed"| E
```

A scheduled event in the `full` profile with the scaler: solid arrows are the usual path, dotted arrows the detour a room takes when it empties before its end time. Teal marks statuses that only the scaler and wake set, green the open room, amber the cleanup job. Every automatic step happens on the first tick after its condition becomes true, so transitions lag their nominal time by up to one `jvbScaler.schedule` interval (two minutes by default in `infra/helm/pa-webinar/values.yaml`). Without the scaler the path skips the teal statuses: the lifecycle cron opens the room at `startsAt` and closes it at `endsAt` plus grace, with a lag of up to one lifecycle interval (one minute, `cronjobs.lifecycle.schedule`, and the Compose `cron` service).

### Lifecycle settings

These `SiteSetting` columns, edited in the administration area without a restart, drive the transitions on this page:

| Setting | Transition it drives |
|---|---|
| `jvbPreScaleMinutes` | `PUBLISHED` → `PROVISIONING` by the scaler ([Pre-scale window](#pre-scale-window)); with `waitingRoomLeadMinutes`, how early a visitor can [wake](#wake) a `PUBLISHED` room. Nothing without the scaler |
| `waitingRoomLeadMinutes` | How early a visitor can [wake](#wake) a `PUBLISHED` room, with the scaler (the larger of the two settings applies) |
| `jvbInactiveGraceMinutes` | `LIVE` → `IDLE` with the scaler ([Inactivity grace](#inactivity-grace-live-to-idle)); the close of an inactive open-ended room past `endsAt` ([Grace period and overtime](#grace-period-and-overtime)); without the scaler, the close of an abandoned instant call ([Instant calls](#instant-calls)) |
| `eventGracePeriodMinutes`, overridden per event by `Event.gracePeriodMinutes` | `LIVE` → `ENDED` after `endsAt` ([Grace period and overtime](#grace-period-and-overtime)) |
| `jvbEmptyCloseMinutes` | Opt-in `LIVE` → `ENDED` before `endsAt` ([Opt-in empty close](#opt-in-empty-close)); without the scaler, only while `JVB_HEALTH_URL` answers |
| `jvbProvisioningTimeoutMinutes` | None: a status-page signal only ([The provisioning timeout is only a signal](#the-provisioning-timeout-is-only-a-signal)) |

Their defaults, accepted ranges and panel labels, and why the `JVB_PRE_SCALE_MINUTES` and `JVB_INACTIVE_GRACE_MIN` environment variables have no effect, are in [runtime-settings.md](../configuration/runtime-settings.md#event-lifecycle-and-bridge-timing).

### Pre-scale window

The pre-scale window exists because a scale-to-zero node pool needs a few minutes to provide a bridge (node creation plus bridge start). The scaler starts the bridge `jvbPreScaleMinutes` before `startsAt`, but promotes the event to `LIVE` only once `startsAt` has passed, so a pre-warmed room still opens on time rather than early. A moderator who wants to open earlier presses **Start event**, which is offered before and during the pre-scale window. Without the scaler there is no pre-scale window: the lifecycle cron opens the room at `startsAt`. Choosing the value against the node pool's cold-start time is covered in [INFRASTRUCTURE.md](../INFRASTRUCTURE.md) and [scaling.md](scaling.md).

### Grace period and overtime

The effective grace is `Event.gracePeriodMinutes` when set, otherwise `SiteSetting.eventGracePeriodMinutes`.

| Effective grace | Behavior of a `LIVE` room once `endsAt` has passed |
|---|---|
| `0` | Ended on the first tick after `endsAt` |
| `N` > 0 | Stays `LIVE`, with the overtime banner, until `endsAt` plus `N` minutes, then ended whether or not people are still connected |
| `-1` | Never ended on the clock. Once the room has been empty for `jvbInactiveGraceMinutes` it is ended to free its bridge. With the scaler this reclaim needs a reachable bridge and a reliable count (aggregated across pods, or a single replica). Without it, the lifecycle cron ends the room once its latest sign of activity is older than `jvbInactiveGraceMinutes`, when that silence is reliable (see [Inactivity grace](#inactivity-grace-live-to-idle) for the signs and when they are) |

The time-based close with a finite grace does not depend on the participant count or on bridge reachability. A room with a finite grace is not reclaimed early when it empties past `endsAt`: it keeps its promised overtime window.

`Event.gracePeriodMinutes` accepts `-1` to `240`, or `null` to inherit (`app/src/lib/validation/schemas.ts`). The event wizard does not expose it: it is set through the events API, copied when an event is duplicated, and set to `-1` for instant calls. The site default is edited in the administration settings.

### Inactivity grace (`LIVE` to `IDLE`)

A `LIVE` room whose `endsAt` is still ahead goes `IDLE` when the latest sign of life is older than `jvbInactiveGraceMinutes`. Signs of life are:

- `lastActiveAt`, set by the last tick in which the bridge reported traffic, and by the headcount reports of the clients in the call (`POST /analytics/peak`, only with at least one participant, at most once a minute per event);
- `provisioningStartedAt`, the last time the room was provisioned or promoted;
- `startsAt`, but only once it has passed. An event cannot have been idle for longer than it has been scheduled to run, and a start date moved into the future does not keep a room alive.

Not every client can report the headcount: guests without a token on a scheduled event that has registrations are refused (`401`). Silence therefore proves an empty room only where every attendee can report, or where the bridge is read. On an installation without `JVB_HEALTH_URL`, the lifecycle cron ends an open-ended room past `endsAt` for inactivity only if it is an instant call or an event without registrations; any other such room stays `LIVE` until a moderator ends it or retention archives it (`inactivityIsReliable()` in `app/src/lib/events/lifecycle-tick.ts`).

A room with neither `lastActiveAt` nor `provisioningStartedAt` is never demoted, because there is no evidence of inactivity. This is the case, for example, for an event that a moderator started with **Start event** before any pre-scale or wake and that nobody has joined yet, or for one that was never provisioned (no pre-scale and no wake), never joined and was then revived by moving `endsAt` forward. A room that the scaler promoted and nobody joins goes `IDLE` `jvbInactiveGraceMinutes` after its promotion. The scaler's pre-scale stamps `provisioningStartedAt` on every scheduled event it reaches, so an event that was pre-scaled before it ended keeps that old stamp: if it is revived to `LIVE`, it can go `IDLE` on the next tick and is woken by the first visitor.

`IDLE` is reversible: `/wake` sends it to `PROVISIONING` and the scaler promotes it to `LIVE` once a bridge answers. The wake re-stamps `provisioningStartedAt`, which protects the woken room from being demoted again before people have had time to rejoin. An `IDLE` room whose `endsAt` passes is ended.

### Opt-in empty close

`jvbEmptyCloseMinutes` (off by default with `-1`) ends a `LIVE` room before its `endsAt` once it had traffic and has then been completely empty, moderator included, for that many minutes (`0` closes on the first empty tick). Unlike `IDLE`, the result is terminal: people who come back find an ended event. It is off by default because a stale `participants=0` reading from a degraded bridge could end a room that is still in use, and because a break in which even the moderator leaves would end a room the moderator meant to come back to. It requires a reachable bridge and a reliable count.

### The provisioning timeout is only a signal

There is no automatic return from `PROVISIONING` to `PUBLISHED`. A `PROVISIONING` event whose bridge never becomes reachable stays `PROVISIONING` until a bridge answers or `endsAt` passes. `jvbProvisioningTimeoutMinutes` only drives the status pages: an event waiting for a bridge for longer than that, counted from `provisioningStartedAt` (or `startsAt` when unset), while fewer bridges are ready than needed, turns the bridge component to `degraded` with a "stale" message ([operations/monitoring.md](../operations/monitoring.md)).

## Overtime, leaving and revival

### The overtime banner

In the live room, once `endsAt` has passed, participants see a banner computed in the browser from `endsAt` and the effective grace, refreshed every 30 seconds (`app/src/components/live/live-event-client.tsx`):

- with a finite grace: "The scheduled end time has passed. The event will close automatically in N minutes", then "End time reached. The event is about to close.";
- with grace `-1`: "The scheduled end time has passed. The event will stay open while participants are connected.";
- with grace `0`: no banner.

The banner does not ask the server. The close itself is made by the scaler or the lifecycle cron on its next tick.

### Leaving and ending

**Leave room** is the single exit for every role; the native Jitsi hang-up button is not shown. Participants simply leave. Moderators choose between **Just leave** and **End for everyone**, described under [Manual transitions](#manual-transitions).

Someone who leaves on their own (**Leave room**, **Just leave**, or giving up a lost connection) sees **You left the room** with the note that the event is still in progress, and a **Rejoin** button. Moderators are also reminded that the event stays open until someone chooses **End for everyone**. The closing screen appears only when the event really is `ENDED`. For instant calls, the links on the closing, leaving and error screens go to the home page, because an instant call has no event page.

When an event becomes `ENDED`, whoever set it, clients notice from the announcement on the live channel or on their next poll of `/lifecycle`: people in the call are taken to the closing screen (everyone except moderators is offered the post-event feedback form) and people in the waiting room see its closing view. The scaler releases the bridges on its next tick, because `ENDED` events no longer count toward capacity.

### Revival

Saving an `ENDED` event with an `endsAt` in the future revives it, without recreating any resource (`reviveStatus` in `app/src/lib/events/lifecycle.ts`):

- revival applies only to `ENDED` events, and only when the request does not set `status` explicitly;
- the new status is `LIVE` if the effective `startsAt` (the new one if sent, otherwise the stored one) has passed, `PUBLISHED` otherwise;
- the wizard always sends both dates and never a status, so editing and saving an ended event with a later end time is enough.

With the scaler, a revived `LIVE` event that was never provisioned (no pre-scale and no wake) and never joined has no activity signal and is not demoted before someone joins. One that already ran keeps its old `lastActiveAt`, and one that was pre-scaled or woken before it ended keeps its old `provisioningStartedAt`: either can go `IDLE` on the next tick and is then woken by the first visitor (see [Inactivity grace](#inactivity-grace-live-to-idle)).

## Call sessions

A `CallSession` row records a span of real use of a room, independently of recording. It feeds the **Statistics** tab and the monitoring analytics.

- **Opening.** When a client joins the Jitsi conference (`videoConferenceJoined`), it calls `POST /api/events/<slug>/sessions`. The call needs no authentication, is rate-limited per IP (30 per minute, `app/src/app/api/events/[param]/sessions/route.ts`) and is accepted only while the event is `LIVE` or `PROVISIONING` (`409` otherwise). It is idempotent: if the event already has an open session (no `endedAt`), that one is returned.
- **Peak headcount.** Clients in the call report the room's participant count every 30 seconds (`app/src/components/live/live-event-client.tsx`) to `POST /api/events/<slug>/analytics/peak`, accepted only while the event is `LIVE`. A client reports only while it is in the conference, and stops on `401`, `403` or `404` and when it leaves. The value is clamped to the event capacity plus a margin and only ever increases; it updates `Event.peakParticipants` and the newest open session. The scaler does not write it. A report with at least one participant also stamps `Event.lastActiveAt`, at most once a minute per event, which is the room's own sign of activity for the inactivity rules.
- **Live telemetry.** Dominant-speaker changes and raised hands are appended to the newest open session during the call ([live-interaction.md](live-interaction.md); the speaker log also serves speaker attribution, see [recording.md](recording.md)).
- **Closing.** Every transition out of `LIVE` closes the event's open sessions in the same transaction: the scaler's and the lifecycle cron's, a status change through the events API (including **End for everyone** and **End event**), and bulk archive. So does the GDPR cleanup when it archives an event that was never ended. `endedAt` is the time of the change and `duration` is computed from it (`app/src/lib/events/call-sessions.ts`). If a session never received a peak, it inherits the event's peak. A later wake and rejoin opens a new session, so a room that empties and refills produces several sessions.
- **Repair.** Every tick of the scaler or the lifecycle cron also closes the sessions still open on `ENDED` and `ARCHIVED` events, for at most 100 events per tick. There, "now" would stretch the duration by days, so the close time is estimated: the event's last update, capped by the latest plausible end of the room (`endsAt` plus the grace, or the last activity if later), and never before the session started (`staleSessionCloseTime()`).
- **Recording sessions.** The recording finalize webhook creates its own, already closed session together with the `Recording` row. A multitrack event instead gets an open placeholder session as soon as the recorder controller first asks for its desired state while the event is `LIVE`. Because `/sessions` reuses any open session, live clients may attach to that placeholder rather than open a separate one; the scaler's close ends it like any other open session, and the finalize webhook completes it. Details are in [recording.md](recording.md#when-a-recorder-is-wanted).

The GDPR cleanup scrubs the personal data held in sessions (participants, speaker and raised-hand logs) but keeps the rows and their counts ([GDPR.md](../GDPR.md)).

## After the event: hand-off, archiving and retention

`ENDED` is where the live lifecycle hands over to the post-event machinery:

- **The post-event page** is public only while `postEventPublic` is on and `postEventPublicUntil` has not passed. **End for everyone** sets `postEventPublic` from the moderator's choice (off only for **Archive (private)**) and `libraryListed` for **Publish to the library**; `postEventPublicUntil` is set only in the event's post-event settings or through the events API ([event-journey.md](event-journey.md)).
- **Follow-up emails** are sent at most once per event by the reminders job, for `ENDED` events that opted in (`postEventEmailEnabled`) and whose `endsAt` is within the last seven days (`app/src/lib/events/post-event-finalize.ts`). `ARCHIVED` events are skipped. Events reach `ENDED` by themselves wherever the scaler or the lifecycle cron runs, so no manual end is needed; an event that is never ended gets none ([email.md](email.md), [background-jobs.md](background-jobs.md)).
- **The recording and AI post-production** start from the recording finalize path, not from the status change ([recording.md](recording.md), [POSTPROD.md](../POSTPROD.md)).

**`ENDED` to `ARCHIVED`.** The GDPR cleanup job (`GET /api/cron/cleanup`) selects `ENDED` and `ARCHIVED` events whose `endsAt` plus `dataRetentionDays` is strictly in the past. For each one it deletes participant data and sets `ARCHIVED` in the same transaction. Retention is counted from `endsAt`, not from the moment the event was ended. The job also selects events that were never ended (`PUBLISHED`, `PROVISIONING`, `IDLE`, `LIVE`) once the later of `endsAt` and `lastActiveAt`, plus `dataRetentionDays`, has passed: it archives them, closes their open call sessions with the estimated close time and cleans them in the same run. `DRAFT` events are never cleaned: they hold no registrations, and their configuration is what copies inherit. It runs daily in the Helm chart (`cronjobs.cleanup.schedule`, 03:00 by default in `infra/helm/pa-webinar/values.yaml`) and hourly in the Compose `cron` service. `Event.dataRetentionDays` is 30 by default in `app/prisma/schema.prisma` and 7 for instant calls (`app/src/app/api/events/instant/route.ts`). What exactly is deleted, what is kept and why is in [GDPR.md](../GDPR.md).

**Bulk archive** hides events from every public surface immediately but deletes nothing. Because `ARCHIVED` events are still processed by the cleanup job, their participant data is deleted when retention expires, as for `ENDED` events.

`ARCHIVED` is not locked: an explicit status change through the events API, including **Publish** on the management page, moves an archived event like any other.

## Related pages

- [scaling.md](scaling.md): capacity model, scaler tick and Redis snapshot, node-pool scale-to-zero.
- [operations/jvb-scaler.md](../operations/jvb-scaler.md): enabling, tuning, validating and pausing the scaler.
- [background-jobs.md](background-jobs.md): the lifecycle cron and the other scheduled jobs.
- [runtime-settings.md](../configuration/runtime-settings.md): every `SiteSetting` knob and per-event override.
- [waiting-room.md](waiting-room.md): the front door that renders each status.
- [identity-and-access.md](identity-and-access.md): moderator links, grants, registrant and guest identities, JWT claims.
- [event-journey.md](event-journey.md): creating, publishing, registering and the post-event page.
- [GDPR.md](../GDPR.md): retention, cleanup and data-subject rights.
- [DEPLOYMENT.md](../DEPLOYMENT.md): the Helm profiles (`jitsi.mode`), the `jvbScaler` keys and `cronjobs.lifecycle`.
