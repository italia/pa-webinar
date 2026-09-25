# ADR-005: Live interaction lives in the portal

**Status:** Accepted

## Context

PA Webinar embeds Jitsi Meet through the IFrame API ([ADR-001](001-jitsi-iframe-api.md)). Jitsi ships its own
chat and reactions, carried over XMPP by Prosody. For a public event they fall short in five ways:

- **They disappear with the conference.** An event needs the chat history for late joiners, an archive, an
  export for anyone who may read the chat (moderators and registrants keep it after the event), and the
  material for the event recap and event analytics afterwards.
- **The portal cannot see them.** The portal and the conference run in separate browser contexts and exchange
  only IFrame API commands and events. The portal could not rate-limit, moderate or audit what travels inside
  Jitsi.
- **Read rules depend on portal credentials.** Who may see a dismissed question or a poll's running counts
  depends on the moderator link, named grants, registrations and the guest window
  ([identity and access](../architecture/identity-and-access.md)). Inside the conference, a participant is an
  endpoint ID and a display name, not one of those credentials.
- **Interaction data is personal data.** It has retention and erasure duties ([GDPR](../GDPR.md)), so it has to
  live where the GDPR cleanup can reach it.
- **The video may run elsewhere.** An installation can point the portal at an external Jitsi
  (`jitsi.enabled: false`). The interaction features must not depend on that Jitsi's configuration.

The portal also runs as several stateless replicas with no session affinity
([ADR-002](002-nextjs-fullstack.md)). A change written through one pod has to reach browsers whose streams are
held by other pods.

## Decision

**Live interaction is a first-class portal feature. PostgreSQL holds its state. Redis only fans changes out to
the pods that hold open streams.**

### The features belong to the portal

Chat, Q&A with upvotes, polls, the word cloud, the agenda checklist, materials, post-event feedback and the
app's reaction bar are built in the portal. Each has its own UI in the live room, route handlers under
`app/src/app/api/events/[param]/`, and its own Prisma models (for example `ChatMessage`, `Question`, `Poll` and
`WordCloudRound`). The native toolbar buttons for functions that the portal owns are removed
([ADR-001](001-jitsi-iframe-api.md#the-native-toolbar-stays-trimmed)).

Jitsi keeps what belongs to the conference: media, the roster and raised hands. The portal builds the
raised-hand queue from Jitsi's events and relays a moderator's **Lower hand** to the raiser's browser over its
own channel, because the IFrame API can lower only the local participant's hand. Jitsi's whiteboard, when an
event enables it, also stays in Jitsi and is not stored.

### One write path

Every stored feature follows the same path. A route handler validates the request with Zod, checks the
caller's credential and writes to PostgreSQL, which holds the only copy of the state. After the commit it
publishes a message on the event's Redis channel. It does not await that publish, and it gives up at once
unless the Redis connection is `ready`, so a slow or missing Redis never fails a write. Every app pod that
holds a Server-Sent Events (SSE) stream for the event forwards the message to its browsers. The path is drawn
step by step in
[live interaction](../architecture/live-interaction.md#principle-postgresql-holds-the-state-redis-fans-it-out).

Reads go through the same route family, and each read route applies its own read rule to the caller's
credential. These are also the routes the browser polls when push is unavailable.

A few features leave the path on purpose:

- **Materials and feedback stop at the write.** Materials change rarely and are polled, and feedback is not
  shown live.
- **Lower hand has no state to store.** Its route skips the write and publishes on `control:<eventId>`. It is
  the only publish a request waits for, capped at one second (`app/src/lib/live-control/pubsub.ts`).
- **The timer and the live counters of the reaction bar** keep their state in process memory. They are the
  exceptions listed under [what it costs](#what-it-costs).

### Redis carries fan-out only

Each event has one Redis channel per concern:

- `chat:<eventId>` carries chat envelopes: new messages, and edit, delete, reaction and question operations.
- `live:<eventId>` carries snapshots of the live flags and "re-read this panel" pokes. It also carries an
  event-status snapshot, but only when the status changes through the event `PUT`. The room does not act on
  it and follows the status by polling `/lifecycle` ([event lifecycle](../architecture/event-lifecycle.md)).
- `control:<eventId>` carries targeted control signals (`lowerHand`).

The channels are separate on purpose. A panel listener receives no chat traffic, and the chat contract never
changes because of a panel or control feature. Publishers, stream routes and stream gates are listed in
[channels](../architecture/live-interaction.md#channels).

Three rules govern what travels on `live:<eventId>`:

- **Snapshot only where every viewer gets the same answer.** The live flags travel as snapshots. The panels
  travel as pokes: the channel names the changed panel, and the browser re-reads it through REST with its own
  credential. Q&A and polls depend on the caller's role, and the agenda response carries the caller's own
  answer. A snapshot there would need a second copy of the authorization rules in the publisher, and a
  divergence would raise no error: it would show one person another person's state. The word cloud is also a
  poke, although its response carries no per-caller data: its read route aggregates the words and closes a
  round whose duration has expired, so the browser re-reads it. A boundary test in
  `app/src/lib/live-state/publish.test.ts` fails if an envelope carries a per-user or role-dependent field.
- **Always a full snapshot, never a delta.** Nothing is persisted or replayed, so the first message a late
  joiner receives has to be enough to correct it.
- **SSE, not WebSocket.** The traffic is one-way broadcast plus ordinary POST requests. `EventSource` is native
  and reconnects on its own, and SSE passes the ingress without upgrade headers.

The waiting-room square also uses Redis, under the `garden:` prefix, for presence. Presence is not a
PostgreSQL write: positions live in a short-lived Redis hash, and each client receives its peers in the
response of its presence ping ([the square's presence](../architecture/waiting-room.md#presence)).

Outside interaction, Redis holds one more short-lived key: the JVB snapshot `jvb:replicas:snapshot`, which the
app writes, with an expiry, when the JVB scaler calls it on each tick
([scaling](../architecture/scaling.md#the-redis-snapshot)).

### Reactions: native by default, the app's bar on request

`SiteSetting.reactionsMode` is a `String` column. Its default in `app/prisma/schema.prisma` is `NATIVE`, and it
takes the values `NATIVE` and `CUSTOM`. The site-settings API accepts only those two
(`app/src/lib/validation/site-settings.ts`), and the live page treats any value other than `CUSTOM` as `NATIVE`.
Administrators set it under **Reactions (emoji)** in the site settings
([runtime settings](../configuration/runtime-settings.md)).

| Value | What the room shows | What the portal stores |
|---|---|---|
| `NATIVE` | **Jitsi native (in the toolbar, ephemeral)**: Jitsi's own reactions button, phones included | Nothing. Reactions are ephemeral and absent from event analytics |
| `CUSTOM` | **App custom (left-hand bar, with stats)**: the app's reaction bar at the bottom left of the room. Jitsi's reactions stay disabled | One `Reaction` row per click (emoji and timestamp only, capped per event) for event analytics, plus an in-process counter for the live display |

The default keeps reactions inside the conference and stores nothing. An installation that wants reactions
counted in event analytics switches to `CUSTOM`. The mode is read when a live page renders, so the change
reaches a room the next time it is opened ([ADR-001](001-jitsi-iframe-api.md#what-it-costs)).

## Consequences

### What the decision buys

- **Persistence and control.** Chat history, a chat export behind the same read gate as the history,
  soft-delete moderation (a hidden message keeps its row, marked with `hiddenAt` and `hiddenBy`), rate limits,
  and shared read rules (`authorizePanelRead` for Q&A and polls, `authorizeChatRead` for the chat).
- **A life after the event.** The event recap and event analytics are built from the same rows. The AI
  post-production summary job receives the agenda items ([POSTPROD](../POSTPROD.md)).
- **Independence from Jitsi.** No interaction feature needs Prosody modules or Jitsi configuration, and all of
  them work with an external Jitsi.
- **Horizontal scaling without coordination.** Each pod subscribes to the channels its own clients need, so any
  replica can serve any browser.
- **Losing a message costs latency, never data.** The next read goes to PostgreSQL.

### What it costs

- **Redis is required for realtime delivery and for a healthy status, but holds no canonical data.** The chart
  runs it as a single standalone node with no persistence, and Docker Compose does the same. `/api/status`
  reports Redis, and the overall status, as `outage` when `REDIS_URL` is unset or Redis does not answer. Without
  Redis the chat still works, with a delay, through its backfill watchdog, the panels keep polling, and
  **Lower hand** signals are not delivered
  ([Redis availability](../architecture/live-interaction.md#redis-availability)).
- **Live state degrades to polling, so polling is permanent code.** The `live:` stream opens with a `hello`
  that says whether push is available. The browser turns its polling off only while the stream delivers, and
  turns it back on after a stream error or a period of silence. Every panel has to stay correct with push off.
  A Redis outage that starts after a stream opened is not signaled, because the keepalive comes from the app
  pod: pokes published during the outage are lost, and the panels catch up at the next change or on reload
  ([polling fallback](../architecture/live-interaction.md#polling-fallback)).
- **The four-place flag rule.** A flag that a moderator can toggle during the event has to agree in four
  places in the code, plus the push channel's copy of the flag list. Miss one and the flag works only at mount
  ([live-toggleable flags](../architecture/live-interaction.md#live-toggleable-flags); the recipe is in
  [extending PA Webinar](../development/extending.md#a-live-toggleable-flag)).
- **Stream code is maintained in the portal.** Subscribing, keepalive, cleanup on abort and a single dispatcher
  per process for `live:` are portal code. Open SSE connections are held by the processes that render pages, so
  app-tier sizing has to count them ([ADR-002](002-nextjs-fullstack.md)).
- **Two features are exceptions to the principle.** The presentation timer and the live counters of the app's
  reaction bar live in the memory of one app process, so with several replicas two browsers can see different
  values, and a pod restart resets them
  ([known limitations](../architecture/live-interaction.md#known-limitations)).
- **Every interaction model enters the GDPR cleanup explicitly.** The GDPR cleanup archives an event instead of
  deleting it, so foreign-key cascades never fire for the events it processes. The cleanup therefore deletes
  each interaction table by name, and a guard test (`app/src/lib/gdpr/cleanup-coverage.test.ts`) fails when a
  model with an `eventId` column is not classified in `app/src/lib/gdpr/cleanup-coverage.ts`. A model that
  points to a blob must delete the blob too ([GDPR](../GDPR.md#rules-for-developers)).
- **Jitsi's own chat is not fully gone.** Removing the chat button does not remove private messages from the
  participant tile menu. Those travel over XMPP, and the portal neither stores nor moderates them
  ([ADR-001](001-jitsi-iframe-api.md#what-it-costs)).

## Alternatives considered

### Jitsi's built-in features over XMPP

Using Jitsi's chat and reactions as they are would need no portal code. The messages would disappear with the
conference, stay invisible to moderation, rate limits and the GDPR cleanup, and ignore the portal's read rules.
They would also tie interaction to the Jitsi deployment, including when an installation uses an external Jitsi.
Rejected.

### A dedicated messaging server

| Option | Why it was not chosen |
|---|---|
| ejabberd or another XMPP server | The web client would have to be built and maintained |
| Matrix (Synapse) | A second messaging platform to operate, heavier than a per-event room chat needs |
| Socket.IO with a Redis adapter | A client library in the bundle, plus WebSocket upgrades through the ingress |
| Centrifugo | One more service to deploy, secure and upgrade |

SSE over Redis pub/sub has the fewest moving parts. The browser API is native, the protocol is plain HTTP,
and the only extra component, Redis, is small and replaceable by any compatible service through `REDIS_URL`.
The cost is the stream code the portal maintains, and the chat has no server-side presence.

## Related

- [Live interaction and realtime](../architecture/live-interaction.md): every feature, its read and write rules,
  the channels, the fallbacks and the flag rule in detail
- [Event lifecycle](../architecture/event-lifecycle.md): how the room follows the event status
- [The waiting room and the square](../architecture/waiting-room.md): presence under the `garden:` prefix
- [Identity, access and tokens](../architecture/identity-and-access.md): the credentials behind the read rules
- [Monitoring and health](../operations/monitoring.md): how `/api/status` reports Redis
- [ADR-001: Embed Jitsi Meet through the IFrame API](001-jitsi-iframe-api.md)
- [ADR-002: A single Next.js full-stack application](002-nextjs-fullstack.md)
- [ADR-010: A SiteSetting singleton for runtime configuration](010-site-settings-singleton.md)
- [ADR-012: An optional 2D social waiting room](012-garden-waiting-room.md)
