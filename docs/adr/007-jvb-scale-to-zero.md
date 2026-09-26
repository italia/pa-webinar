# ADR-007: Scale bridges to zero, driven by events

**Status:** Accepted

## Context

Jitsi Videobridge (JVB) is the expensive tier of PA Webinar. Every participant's audio and video
passes through a bridge, which forwards each incoming stream to every receiver. A bridge needs CPU in
proportion to its senders and receivers, and it needs a publicly reachable UDP port. With the chart's
`jitsi-meet.jvb.useHostPort: true`, each bridge also takes a node of its own. The portal, by
comparison, serves pages and API calls on ordinary nodes.

Four facts about the demand shaped this decision:

- **Demand is scheduled.** An event has a `startsAt`, an `endsAt` and a declared size in the database
  before anyone joins. The events of a public administration (PA) usually fill a few hours of a week,
  so a bridge fleet kept running around the clock would sit idle most of the time.
- **Demand arrives all at once.** Participants join in the minutes around the start time. A bridge on a
  fresh node needs several minutes: the node is provisioned, the image is pulled, and the bridge starts
  and registers with Jicofo. A signal that reacts to load arrives after the people it should serve.
- **One conference stays on one bridge.** The chart does not enable Octo, Jitsi's bridge cascading, so
  Jicofo places each conference on a single bridge. More bridges add room for more events, not for a
  bigger one ([capacity is two numbers](../architecture/scaling.md#capacity-is-two-numbers)).
- **The portal already owns the event clock.** Event statuses have to move at the right time anyway:
  from `PUBLISHED` to `LIVE` at the start, to `IDLE` when a room empties, to `ENDED` after the grace
  period. The component that knows when a room is needed is the one that also knows how big it is.

The installation constraints come from reuse. Administrations run PA Webinar on different clouds and on
their own premises. The chart should not require an extra operator in the cluster. Small installations
(Docker Compose, the Helm simple and standard profiles) must keep working with a bridge that is always
on.

## Decision

In the Helm full profile, **the portal decides how many bridges run from the event lifecycle, a
CronJob applies that number, and the bridges live on a dedicated node pool that can shrink to zero
nodes.** The mechanism is described in full in
[Scaling the media plane](../architecture/scaling.md).

### A dedicated node pool with a minimum of zero

The bridges run on a node pool of their own, with node autoscaling and a minimum of 0 nodes. The
reference modules in `infra/tofu/aks`, `infra/tofu/gke` and `infra/tofu/eks` create such a pool. It
carries the taint `workload=jitsi-jvb:NoSchedule` and the label `workload=jitsi-jvb`.
The taint keeps every other workload off the pool, so the pool can empty.

The bridges reach the pool through `jitsi-meet.jvb.nodeSelector` and `jitsi-meet.jvb.tolerations`, which
the full-profile example (`infra/helm/pa-webinar/examples/values-full.yaml`) sets together with
`jitsi-meet.jvb.replicaCount: 0`. From then on, the cluster autoscaler follows the replica count. It adds
a node for each `Pending` bridge and removes the nodes that bridges have left. The pool must be regular
capacity, not spot, because an eviction would drop every participant on that bridge
([the dedicated pool](../architecture/scaling.md#the-dedicated-pool)).

### A CronJob applies, the portal decides

The scaler is a Kubernetes CronJob rendered from
`infra/helm/pa-webinar/templates/cronjob-jvb-scaler.yaml`. It runs on the schedule in
`jvbScaler.schedule` (`*/2 * * * *` in `infra/helm/pa-webinar/values.yaml`; the full-profile example
uses `*/5 * * * *`). It takes the app's node selector and tolerations, not the bridges' toleration, so
it never lands on the bridge pool and cannot keep it awake.

Each tick, the job collects the bridge Deployment's replica counts and the per-bridge
`/colibri/stats`, and calls `GET /api/internal/jvb-desired-replicas`
(`app/src/app/api/internal/jvb-desired-replicas/route.ts`) with `x-api-key: $CRON_API_KEY`. The route
applies the automatic status changes in one database transaction: it moves events into `PROVISIONING`
inside the pre-scale window, promotes them to `LIVE` once a bridge answers and the start time has
passed, and demotes or ends the rooms that emptied or ran out of time
([Event lifecycle](../architecture/event-lifecycle.md#automatic-transitions-the-scaler-tick)). It then
sizes the `LIVE` and `PROVISIONING` events, writes the Redis snapshot and returns `desired` and
`jibriDesired`, which the job applies with `kubectl scale`
([one scaler tick](../architecture/scaling.md#one-scaler-tick)).

Sizing is predictive first: it follows what organizers declared, before anyone joins. Measured load
only adds a margin on top
([sizing](../architecture/scaling.md#sizing-from-an-event-to-a-number-of-bridges)).

The work is split by what each side can safely hold. The job has the Kubernetes rights, bound to a
namespaced Role on its own ServiceAccount: read Deployments, StatefulSets and pods, patch their `scale`
subresource, and create `pods/exec`. The portal has the event data and the sizing settings, which
administrators change at runtime ([ADR-010](010-site-settings-singleton.md)). The app pod has no
Kubernetes rights and does not even mount a ServiceAccount token.

### Opt-in, full profile only

The CronJob renders only when all three conditions hold: `jitsi.enabled` is `true`, `jitsi.mode` is
`full`, and `jvbScaler.enabled` is `true`. `jvbScaler.enabled` defaults to `false` in `values.yaml`, and
the full-profile example turns it on.

| Installation | Bridges | Who moves event statuses |
|---|---|---|
| Helm full profile with `jvbScaler.enabled: true` | From zero up to the caps, following events | The scaler tick, plus manual actions |
| Helm full profile with the scaler disabled | Fixed `jitsi-meet.jvb.replicaCount` (the full-profile example sets `0`: raise it to at least `1`), or scaled by another tool such as KEDA | The lifecycle cron, plus manual actions |
| Helm simple and standard profiles | Fixed `jitsi-meet.jvb.replicaCount` (`1` in `values.yaml`) | The lifecycle cron, plus manual actions |
| Docker Compose | One bridge, always on | The lifecycle cron (the `cron` service), plus manual actions |
| External Jitsi (`jitsi.enabled: false`) | Run by whoever operates that Jitsi | The lifecycle cron, plus manual actions |

Manual actions are taken by moderators in the room, or by staff from the event's page in the
administration area. The lifecycle cron (`GET /api/cron/lifecycle`, every minute) applies the same time
rules as the scaler tick, without pre-scale and `IDLE`. In every installation, the daily GDPR cleanup
also moves events to `ARCHIVED` once their retention has passed.

`jitsi.mode: full` alone does not scale anything, and it does not move the bridges to a dedicated pool.
Both come from the values described above.

## Consequences

### Cold starts are covered by pre-scaling

A scheduled event enters `PROVISIONING` when its start is less than `jvbPreScaleMinutes` away (default
`15` in `app/prisma/schema.prisma`), and from then on it counts toward `desired`. That window must cover
one tick interval, node provisioning, the image pull and the bridge start. Visitors who arrive in the
meantime wait in the waiting room, which shows **Room warming up...**.

Demand that is not scheduled pays the whole cold start when it arrives. This covers instant calls,
which are created directly in `LIVE`, and rooms woken from `IDLE` by a visitor through
`POST /api/events/<slug>/wake`. The wake route only records the intent, and the next tick does the
scaling ([cold start and the pre-scale window](../architecture/scaling.md#cold-start-and-the-pre-scale-window)).

### Activity is not measured per room

`/colibri/stats` reports per bridge, not per conference, so the job reads every bridge and sums the
figures: a single request to the JVB Service would reach one bridge only. Activity is still counted
across the platform: while one event has people in it, another event's empty room does not go `IDLE`
and keeps a bridge node running. When the count cannot be trusted, the route skips the transitions that
depend on it. The rules err toward keeping a bridge up for longer than needed rather than toward
closing a room that has people in it ([known limitations](../architecture/scaling.md#known-limitations)).

### Lifecycle and scaling are separate concerns

The scaler tick drives the live statuses only where it runs, and it adds the two statuses that exist
for scale-to-zero: the pre-scale to `PROVISIONING` and the demotion of an empty room to `IDLE`. Every
other installation, including bridges scaled by another tool such as KEDA, runs the lifecycle cron
instead: it opens a room at `startsAt`, ends it at `endsAt` plus its grace period, and ends inactive
open-ended rooms and abandoned instant calls, with the same time rules and without the two
scale-to-zero statuses. The two drivers never run together: the scaler writes a heartbeat to Redis on
every tick, and the lifecycle cron stands down while it is fresh. Without the scaler, a visitor's wake
does not move a `PUBLISHED` event to `PROVISIONING`, because nothing would warm it
([running without the scaler](../architecture/event-lifecycle.md#running-without-the-scaler)).

While the scaler CronJob is suspended, the lifecycle stops: the chart renders the lifecycle cron only
where it does not render the scaler. Moderators then open the room with **Start event** and close it
with **End for everyone**
([pausing the scaler](../operations/jvb-scaler.md#pausing-for-maintenance-or-load-tests)). Retention
does not depend on the lifecycle: the cleanup also deletes the data of events that were never ended.

### Failures freeze the bridge count

When the portal or the database does not answer, or the answer has no `desired`, the job keeps the
current replica count and exits successfully. A live event is never scaled to zero by accident, but idle
bridges are not released either. Most failures therefore do not fail the Job, so monitoring watches the
freshness of the snapshot as well as Job failures
([check the snapshot](../operations/jvb-scaler.md#check-the-snapshot)).

### More than one bridge needs one address per bridge

A participant's browser sends media to the address that its bridge advertises. When several bridges
advertise one load-balancer IP, some UDP flows reach a bridge that does not host the participant's
conference, ICE fails, and the participant drops out. Scaling beyond one bridge is safe only when every
bridge is reachable on an address of its own. Until then, operators set the global cap
`JVB_MAX_REPLICAS` to `1`. It is an app environment variable (`app.env.JVB_MAX_REPLICAS` in the chart),
and it is `6` when unset (`app/src/lib/jvb-sizing.ts`)
([the single-IP pitfall](../architecture/scaling.md#the-single-ip-pitfall)).

### Other costs

- **A strong permission in the namespace.** `pods/exec` lets the scaler's ServiceAccount run commands
  in any pod of the release namespace, not only in the bridges. The Role is namespaced and bound to that
  one ServiceAccount, and the job runs as a non-root user on a read-only root filesystem.
- **Scale-down does not choose the bridge.** Kubernetes picks the bridge pod to remove, so scaling down
  while several bridges are in use can interrupt a live conference
  ([known limitations](../architecture/scaling.md#known-limitations)).
- **Reaction time is coarse.** A decision waits up to one tick interval, and a new node then takes the
  cloud's provisioning time. The design relies on the pre-scale window, not on fast reactions.

## Alternatives considered

### A static fleet

A fixed number of bridges, sized for the peak, has no cold start and no moving parts. It is what the
simple and standard profiles do, and it remains the right choice for a small installation or a single
VM. It was rejected as the model of the full profile. For a platform whose events fill a few hours a
week, it pays for bridge nodes around the clock, and a fleet sized for today's peak still needs someone
to resize it by hand. It also leaves the event lifecycle without a clock.

### KEDA

KEDA can scale a Deployment to zero from a database query, and an example ScaledObject ships in
`infra/helm/pa-webinar/examples/keda-jvb-scaler.yaml`. It was rejected as the chart's mechanism for
these reasons:

- **An extra operator.** Every reusing administration would have to install and upgrade KEDA. The
  CronJob needs nothing beyond Kubernetes itself.
- **Scaling is only half of the tick.** The same call runs the event lifecycle, closes call sessions,
  writes the snapshot and notifies the recorder controller. With KEDA, a job would still be needed for
  all of that.
- **Bridge statistics.** Reading `/colibri/stats` on every bridge needs `pods/exec`. A database
  trigger sees no bridge load and cannot add a stress margin.
- **Sizing belongs to the portal.** Per-event sizing, both caps and the settings that administrators
  change at runtime would have to be duplicated in a query.
- **One owner for the replica count.** KEDA drives its target through an HPA. Next to the CronJob, two
  controllers would set the same number.

The example is kept as a starting point and is not supported. Its known issues are listed in
[why not KEDA](../architecture/scaling.md#why-not-keda).

### A HorizontalPodAutoscaler on CPU

A standard HPA keeps at least one replica: `minReplicas: 0` needs the `HPAScaleToZero` feature gate,
which clusters do not enable by default. The pool would therefore never empty. CPU is also a lagging
signal. It rises after participants have joined, when a new node is still minutes away, and scheduled
demand is known well before that. A new replica does not relieve a busy bridge either, because Jicofo keeps each conference
on the bridge where it started. Rejected for the bridges. An HPA remains the right tool for the
stateless portal, which the chart scales from `autoscaling` in `values.yaml`
([the app tier in brief](../architecture/scaling.md#the-app-tier-in-brief)).

## Related

- [Scaling the media plane](../architecture/scaling.md): the capacity model, the sizing formula, one
  tick step by step, the snapshot and the node pools.
- [Event lifecycle](../architecture/event-lifecycle.md): the statuses that the tick moves, grace,
  overtime, wake, and the lifecycle cron that replaces the tick without the scaler.
- [Running the JVB scaler](../operations/jvb-scaler.md): enabling, tuning, validating and pausing it.
- [Installing PA Webinar](../install/README.md): choosing a platform and sizing the bridge pool.
- [Runtime settings](../configuration/runtime-settings.md): the sizing and lifecycle settings with
  their defaults.
- [ADR-006: Optional recording paths on provider-agnostic storage](006-recording-and-storage.md): the
  Jibri replica that the same tick scales.
- [ADR-010: A SiteSetting singleton for runtime configuration](010-site-settings-singleton.md): where
  the sizing settings live.
