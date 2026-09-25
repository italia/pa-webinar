# Infrastructure

This page is for the IT staff of a public body who must decide how to run
PA Webinar with what they have: a workstation, one virtual machine, three
virtual machines, or a managed Kubernetes service. For each setup it gives the
resources measured under load, the commands that worked, the network
requirements and the gaps that are still open.

It links to the pages that own the detail and does not repeat them:

- [Deploying with Helm](DEPLOYMENT.md): chart profiles, secrets, install walkthroughs;
- [Configuration](CONFIGURATION.md): environment variables, email, object storage;
- [Development](DEVELOPMENT.md): the local stack;
- [Privacy and data protection](GDPR.md) and [AI post-production](POSTPROD.md);
- [Load testing](LOAD-TESTING.md): how to measure capacity, and the measurement of a real event;
- [Scaling the media plane](architecture/scaling.md): how bridges are counted and scaled.

Every setup on this page has one of three statuses:

- **Exercised**: runs real events.
- **Tested in lab**: installed from scratch on lab machines and loaded with
  synthetic participants.
- **Not yet verified**: nobody has installed it yet. The notes come from
  reading the chart and the provider documentation.

The lab installs ran an earlier revision of the chart, and several of their
workarounds are no longer needed: the chart now selects the conference Ingress
by its class alone, leaves the scheduled jobs out of its NetworkPolicy,
renders a Service for the bridge statistics and pins the images it pulls from
Bitnami. The walkthroughs below are written for the current chart. Where a
step differs from what the lab installed, the step says so, and it was checked
by rendering the chart with `helm template`, not by installing again.

On this page:

- [Choosing a setup](#choosing-a-setup)
- [Sizing](#sizing)
- [Before you install](#before-you-install)
- [Development: Docker Compose](#development-docker-compose)
- [Evaluation: minikube](#evaluation-minikube)
- [Single node: k3s on one VM](#single-node-k3s-on-one-vm)
- [Three nodes: k3s on three VMs](#three-nodes-k3s-on-three-vms)
- [Managed Kubernetes: AKS, GKE, EKS](#managed-kubernetes-aks-gke-eks)
- [Networking](#networking)
- [Network policies](#network-policies)
- [Images](#images)
- [Known gaps](#known-gaps)

## Choosing a setup

| Setup | For whom | Measured capacity | What you give up | Status |
|---|---|---|---|---|
| **Development**: Docker Compose on a workstation | Developers, and a first look at the product | Not measured | TLS on the portal, real secrets, several scheduled jobs, object storage, TURN. Not for events | Used for development |
| **Evaluation**: minikube on one workstation | IT staff trying the Helm chart before committing to a cluster | On 4 CPU / 8 GB, with every browser on the same workstation: 20 participants all on camera, and 40 as a webinar, audio only, or on camera with six videos per receiver | Participants on other machines, trusted certificates, NetworkPolicy enforcement with the default network plugin | Tested in lab |
| **Single-node production**: k3s on one VM | One public body with occasional events | 20 participants all on camera on 4 vCPU / 8 GiB, at 46% CPU peak | High availability (the VM is a single point of failure), autoscaling, Jibri recording. Recording and uploads need object storage that you provide | Tested in lab |
| **Three-node k3s**: three VMs | A body that wants media CPU kept away from the portal and database, or room for more bridges | 20 participants all on camera; bridge node at 1.8 cores peak and 2.6 GiB | Still not highly available (see [What happens when a node is lost](#what-happens-when-a-node-is-lost)); no node autoscaling | Tested in lab |
| **Managed Kubernetes** with dedicated node pools: AKS, GKE, EKS | Bodies with concurrent or large events, recording, AI post-production | One 65-participant webinar on one 16-vCPU bridge, peak bridge stress 0.186, on a managed AKS installation ([A real event](LOAD-TESTING.md#a-real-event)) | Composite recording needs its upload script mounted by hand; object storage works only with static keys; more than one bridge needs a public address per bridge node, which has not been verified | AKS exercised; GKE and EKS not yet verified |

The lab installs used the simple profile
(`infra/helm/pa-webinar/examples/values-simple.yaml`): PostgreSQL and Redis in
the cluster, one bridge, no Jibri. The standard and full profiles add Jibri and
an external database, and the full profile adds a dedicated bridge pool that
scales to zero. [Deploying with Helm](DEPLOYMENT.md) describes the profiles.

Five facts matter more than the table:

- **Plan bandwidth together with CPU.** In tile view every camera goes to
  every other participant, so the bridge's outbound traffic grows with the
  square of the cameras: 2.7, 11.6 and 46.9 Mbps at 5, 10 and 20 participants
  on camera, with 180p thumbnails, on the single-node VM. The lab had no real
  network between clients and servers, so no run reached an uplink limit.
  These figures are what the uplink of the VM or data center must carry, and a
  real 720p speaker adds to them.
- **One conference runs on one bridge.** More bridges add concurrent events,
  not participants per event. See
  [Scaling the media plane](architecture/scaling.md#capacity-is-two-numbers).
- **Three VMs are not high availability.** Losing the VM that held the
  in-cluster database took the portal down for as long as the VM was off.
- **Recording needs object storage, and the chart does not ship any.** On VMs
  you must provide an S3-compatible store. Video uploads from the
  administration area go from the browser straight to the store, on Azure Blob
  or S3-compatible storage, so the store must accept them: CORS for the
  portal's origin and, on S3-compatible storage, an HTTPS endpoint that
  browsers can reach
  ([Browser upload of videos](configuration/storage.md#5-browser-upload-of-videos)).
- **The published images need registry credentials.** Every lab install on this
  page used images built locally. See [Images](#images).

## Sizing

### How the numbers were obtained

- Participants were headless Chrome browsers on a lab host. Each one joined the
  conference with a token issued by the portal's API and sent synthetic media:
  a fake camera, and a fake microphone playing a continuous tone.
- Receivers asked for 180p thumbnails. Some runs also had one 720p "stage"
  stream. In the runs marked "six videos per receiver" (Jitsi's `lastN` set to
  6), each receiver got at most six videos, as with the **Save data — 360p**
  quality preset (`SAVE_DATA`). The default preset, **High — 720p
  (recommended)** (`HIGH`), forwards every video to desktop browsers, which is
  what the tile-view runs measure. The
  preset is the `videoQuality` site setting
  ([Runtime settings](configuration/runtime-settings.md)).
- Each level ran for 120–150 s at steady state. On k3s, resource use comes
  from `kubectl top` every 15 s and `free -m` inside the VM. On minikube, a
  sampler read each container's working set from its cgroup, with `kubectl top`
  as a cross-check. Bridge traffic comes from the bridge's own statistics
  (`/colibri/stats`).
- Servers were KVM virtual machines running Debian 12, or a minikube node, on
  the same physical host as the browsers.
- Software: k3s v1.36 with its bundled Traefik, local-path storage and
  NetworkPolicy controller; minikube v1.38 (Docker driver, Kubernetes v1.32,
  ingress-nginx add-on); Helm 4; the simple profile; Jitsi `stable-10741`
  with the standard `jitsi/web` image.

The limits of these numbers:

- **Synthetic audio is an upper bound.** The fake microphone never stops, so
  every unmuted participant is a permanent speaker. Audio made up 70–85% of the
  forwarded packets in the runs where everyone was unmuted.
- **Synthetic video is a lower bound for the stage stream.** The 180p
  thumbnails hit their ~100 kbps cap, as real ones do, but at 20 fps instead
  of 30. The fake 720p stream is about 1 Mbps. A real camera at the app's
  high-quality cap sends up to 2.2 Mbps, so stage traffic can double.
- **The host was shared.** Other tests ran on the same machine. Read server CPU
  as ±20%: two identical runs gave 1.0 and 1.2 bridge cores.
- **There was no real network.** Clients and servers shared one physical host,
  so there was no WAN latency, loss or bandwidth limit.
- **Clients did not render video.** Their CPU says nothing about participants'
  laptops. If you repeat the tests: each browser client needed about 0.43 core
  and 0.6 GB, one Chrome instance refuses more than 16 fake microphones (run
  one per 10 clients), and large runs need several client machines.
- **The runs were short.** Long events were not tested.

The measurement of a real event in [Load testing](LOAD-TESTING.md#a-real-event)
has real cameras and real clients: a 65-participant webinar on a managed AKS
installation, carried by one bridge of 16 vCPU, with a peak bridge stress of
0.186 and about 66 Mbps of bridge upload.

### Where the resources go

Ranges across the three lab setups. CPU is in millicores (1000m = one core).
Memory is given in MiB as measured, and in GiB (1 GiB = 1024 MiB) above that.

| Component | Idle | 20 participants on camera | Notes |
|---|---|---|---|
| Video bridge (JVB) | 2–7m, 190–300 MiB | 1.0–1.9 cores steady, 2.3–2.8 cores while everyone joins; 1.4–2.0 GiB on k3s | The Java heap grows and is never returned. With the image default (`-Xmx3072m`) it reached 2.9–3.5 GiB on minikube, after earlier runs |
| Jicofo | 2–4m, 165–270 MiB | ≤ 95m, 175–300 MiB | Flat |
| Prosody | 1–12m, 30–60 MiB | ≤ 90m, 75–280 MiB | Grows with participants and does not shrink |
| Jitsi web | 1m, 14–16 MiB | ≤ 33m, 16–18 MiB | |
| Portal (app) | 2–9m (46m peak), 170–220 MiB | 53–99m (up to 203m during a join ramp), 173–183 MiB | |
| PostgreSQL | 5–12m, 50–80 MiB | 23–65m (101m peak at 10 participants), 54–65 MiB | |
| Redis | 8–18m, 4–10 MiB | 14–61m, 6–10 MiB | |
| Traefik (k3s) | 8–15m, 26–80 MiB | 53–91m, 38–90 MiB | |
| ingress-nginx (minikube) | ~2m, ~290 MiB | 5–8m, ~300 MiB | |
| Kubernetes itself | k3s: 1269 MiB (1.24 GiB) used on the VM before the chart. minikube control plane: ~25m, ~410 MiB | minikube control plane: 60–95m, 420–440 MiB | |

Nothing except the bridge went above 0.1 core at 20 participants, apart from
join ramps.

The simple profile's long-running pods request 1.5 CPU and 2688 MiB (2.6 GiB)
in total, as rendered by `helm template`: the portal 200m and 256 MiB, the
bridge 1 CPU and 2 GiB, PostgreSQL 250m and 256 MiB, Redis 50m and 128 MiB.
Each scheduled job adds 50m while its pod runs. The bridge's limits are 3 CPU
and 4 GiB. Jicofo, Prosody and Jitsi web have no requests, so they are the
first to be killed under memory pressure.

### One node under load

Single-node k3s on a 4 vCPU / 8 GiB VM. Node CPU is `kubectl top node`, and
memory is "used" from `free -m` inside the VM. The bridge peaks and the node
peaks come from different samples.

| Load | Node CPU peak (median) | VM memory used | Bridge CPU peak (median) | Bridge memory | Bridge out | Per participant |
|---|---|---|---|---|---|---|
| Idle, no event | 0.21 (0.12) | 2.1 GiB | 6m | 214 MiB | – | – |
| 5 on camera | 0.88 (0.47) | 2.3 GiB | 0.74 (0.42) | 382 MiB | 2.7 Mbps | ~95 kbps up, ~385 kbps down |
| 10 on camera | 0.75 (0.43) | 2.5 GiB | 0.69 (0.45) | 604 MiB | 11.6 Mbps | ~110 kbps up, ~1.0 Mbps down |
| 20 on camera | 1.84 (1.21) | 3.4 GiB | 2.28 (1.42) | 1442 MiB (1.41 GiB) | 46.9 Mbps, 25.5k packets/s | ~2.05 Mbps down, 0 loss, 20 fps |
| 20 audio-only, all unmuted | 1.21 (0.84) | 3.4 GiB | 0.87 (0.61) | 1440 MiB (1.41 GiB), kept from the previous run | 14.0 Mbps | ~24 kbps up, ~445 kbps down |

At 20 participants on camera the node used 46% of its CPU and 44% of its
memory (3465 of the 7953 MiB the VM reports). Every participant received all
19 others.

### Larger rooms and meeting patterns

minikube with 4 CPU and 8 GB. Node memory was 4.0–5.8 GiB of working set,
mostly the bridge heap, which had already grown in earlier runs.

| Pattern | Participants | Bridge CPU mean (peak) | Node CPU peak | Bridge out | Packets/s out |
|---|---|---|---|---|---|
| Tile view, everyone on camera | 16 | 0.62 (0.70) | 0.88 | 38 Mbps | 17.1k |
| Tile view, everyone on camera | 20 | 1.0–1.2 (1.1–1.4) | 1.6–1.8 | 55–57 Mbps | 25–27k |
| Six videos per receiver, everyone on camera and unmuted | 20 | 0.82 (0.96) | 1.31 | 33 Mbps | 20.7k |
| Six videos per receiver, everyone on camera and unmuted | 30 | 1.50 (1.59) | 1.82 | 63 Mbps | 44.3k |
| Six videos per receiver, everyone on camera and unmuted | 40 | 2.32 (2.46) | 2.75 | 97 Mbps | 76.8k |
| Audio only, everyone unmuted | 40 | 1.96 (2.14) | 2.31 | 57 Mbps | 68.8k |
| Webinar: 3 speakers on camera, 37 muted with camera off (the app's default for participants) | 40 | 0.64 (0.72) | 1.18 | 33 Mbps | 10.3k |

Media stayed healthy in every 4 CPU run: no loss, 18–20 fps in tile view, and
every participant saw all the others in the participant list.

### What a participant costs on the bridge

A linear fit over eight runs, within ±15% on seven of them:

> bridge CPU (millicores) ≈ 87 + 19.4 × (thousand packets per second sent) + 7.3 × (Mbit/s in plus out)

Per forwarded stream:

- unmuted audio: ~1.3m;
- 180p thumbnail (~100 kbps): ~1m;
- 720p stage stream: ~9m with the synthetic camera (~1 Mbps). With a real
  camera at the app's high-quality cap (2.2 Mbps, 30 fps), the estimate is
  ~20m.

Per participant, by meeting pattern:

- **Webinar** (a few speakers, muted audience with cameras off): about 14m per
  viewer, measured (0.64 cores for 40). With real 720p speakers the estimate is
  ~25m per viewer. Extrapolated, not measured: 100 viewers need 1.5–2.7 cores
  and ~260 Mbps out; 200 viewers need 3–5.3 cores and ~0.5 Gbps out.
- **Meeting with six videos per receiver**, everyone unmuted:
  0.333 + 0.00128 × N × (N − 1) cores, measured from 20 to 40 participants.
- **Audio only**, everyone unmuted: 1.26m per pair of participants, about 49m
  per participant at 40.
- **Tile view with the default preset**, everyone on camera: 1.0–1.2 cores at
  20, growing with the square of the participants. Extrapolated: ~2.3 cores at
  30 and ~4 cores at 40. That is above the bridge's CPU limit of 3 cores in the
  chart, so a single bridge would be throttled.

### Recommended sizes

| Setup | Minimum that measured sufficient | Recommended | Basis |
|---|---|---|---|
| Development (Compose) | Not measured | – | Compose runs the same services without Kubernetes. On minikube, the Kubernetes layer (control plane, ingress, system pods) took about 0.8 GiB and 40–60m CPU that Compose does not need |
| Evaluation (minikube) | 4 CPU / 8 GB / 30 GB disk | The same, with test browsers on another machine | 40 participants with six videos per receiver peaked at 2.75 of 4 cores and 5.1 GiB (5214 MiB). At 2 CPU / 4 GB the node collapsed at 20 participants on camera with the chart defaults, and held them with the bridge heap capped (see [Bridge memory on small nodes](#bridge-memory-on-small-nodes)) |
| Single node (k3s) | 4 vCPU / 8 GiB / 40 GB disk, public IP with UDP 10000 open | 8 vCPU / 16 GiB, and an uplink of 200 Mbps or more (derived) | 20 participants on camera used 1.84 cores, 3.4 GiB and 46.9 Mbps out, with 180p thumbnails only: that is the measured floor for the uplink at that load. The minimum holds one event of about 20 participants on camera. A 40-person webinar with three speakers was measured on minikube, at 33 Mbps out with a synthetic ~1 Mbps stage stream; with real 720p speakers the estimate is about 100 Mbps. The recommendation is for webinar-shaped events of about 50 people (1–5 cameras, muted audience), estimated at about 130 Mbps out with real 720p speakers. 50 people all on camera would need an estimated 250–300 Mbps out and 5–6 bridge cores. All three estimates are extrapolated from the cost model above |
| Three nodes (k3s) | Server 2 vCPU / 4 GiB / 30 GB; portal and database 2 vCPU / 4 GiB / 30 GB; bridge 4 vCPU / 4 GiB / 20 GB | Bridge node 4 vCPU / 8 GiB, for 20–30 participants on camera (derived) | At 20 on camera the bridge node used 2616 MiB (2.6 GiB) of its 4 GiB. The bridge requests 2 GiB and its heap can grow to about 3 GiB, which leaves no headroom on 4 GiB. The portal and database node stayed under 0.2 core and 1 GiB |
| Managed, bridge pool | Not measured on a managed pool | Size one bridge for your largest single event. The reference pool in `infra/tofu/jvb-nodepool.tf` uses 4 vCPU / 16 GiB machines | In [Load testing](LOAD-TESTING.md#small-bridge-3-cpus), a bridge limited to 3 CPU and 2 GiB on a 4-vCPU / 16 GiB VM carried about 25 participants all on camera, or 60 webinar viewers at about half its stress budget, and some 60 to 80-participant webinar runs ended with it killed for exceeding its memory limit. The real 65-participant event ran on a 16-vCPU bridge. One conference always runs on one bridge |
| Managed, application pool | Not measured separately | At least two nodes, for the two app replicas | At 20 participants the portal, PostgreSQL and Redis together used about 0.25 core at most (253m in one run, during the join ramp) and under 300 MiB. Size the pool from the resource requests |

### Bridge memory on small nodes

The chart does not cap the bridge's Java heap, so the image default
`-Xmx3072m` applies, against a memory limit of 4 GiB. On a node with 4 GiB or
less, cap it. This snippet was tested on minikube with 2 CPU and 4 GB:

```yaml
jitsi-meet:
  jvb:
    extraEnvs:
      VIDEOBRIDGE_MAX_MEMORY: "1024m"
    resources:
      requests:
        cpu: 500m
        memory: 1Gi
      limits:
        cpu: "2"
        memory: 1536Mi
```

Everyone was on camera in tile view:

| Participants | Settings | Bridge CPU mean (peak) | Node | Result |
|---|---|---|---|---|
| 5 | Chart defaults | 0.11 (0.26) | 0.45 cores peak, 2.1 GiB | OK |
| 15 | Chart defaults | 0.61 (0.73) | 1.04 cores peak, 2.9 GiB | OK; memory reclaimed at the limit, no kill |
| 20 | Chart defaults | 1.11 (1.32) | 3899 MiB (3.8 GiB) of 4 GiB | Collapse: memory thrash, then Kubernetes restarted the API server, PostgreSQL, the bridge and Redis. The conference dropped |
| 20 | Heap capped as above | 1.12 (1.25) | 1.51 cores peak, 3.1 GiB | OK, no restarts, everyone saw everyone |

On a larger node shared with the portal and database, the cap above takes
away headroom that the bridge can use: the 8 GiB single-node VM carried 20
cameras uncapped, with the bridge at 1442 MiB. There, keep the 4 GiB limit and
match the heap to it instead, for example `VIDEOBRIDGE_MAX_MEMORY: "2560m"`.
This has not been tested.

Whether a 2-vCPU node can take the simple profile depends on the platform. On
minikube, the chart's requests plus minikube's control plane and ingress added
up to 2.5 CPU and 3180 MiB; the pods were scheduled only because the node
reported the host's capacity (see [Evaluation: minikube](#evaluation-minikube)).
On k3s, the chart's 1.5 CPU plus k3s's own pods came to about 1.7 CPU, so a
2-vCPU VM would schedule them with almost no headroom. This is derived from the
requests and was not tried on a real 2-vCPU VM. At 20 cameras the 4-vCPU k3s
node peaked at 1.84 cores, and minikube with 2 CPUs and the heap capped at
1.51 cores. Use 2 CPU / 4 GB to click through the application, or for small
calls with the bridge heap capped.

On a shared or overloaded host, an idle bridge was also restarted by its
liveness probe (1 s timeout, three failures), and a bridge restart drops every
conference on it. The subchart accepts a more tolerant probe. This has not
been tested:

```yaml
jitsi-meet:
  jvb:
    livenessProbe:
      httpGet:
        path: /about/health
        port: 8080
      periodSeconds: 10
      timeoutSeconds: 5
      failureThreshold: 6
```

### Disk

- Single node: 12 GB used after the install. Of that, 8.5 GB is the container
  image store, and the migration image alone is 2.46 GB.
- Three nodes: 8.7–9.5 GB used on each node after importing the app and
  migration images. The bridge node does not need them: 20 GB left it with
  11 GB free.
- Plan 30–40 GB on every node that can run the portal, plus the database
  volume. The simple profile asks for 5 GiB for PostgreSQL.

## Before you install

These steps apply to every Kubernetes setup on this page.

1. **Get the chart and its subcharts.** The repository does not include the
   subcharts. `helm dependency build` installs exactly the versions pinned in
   `Chart.lock`, the ones CI validates and the lab installs used; `update`
   would resolve newer ones within the ranges of `Chart.yaml`:

   ```bash
   git clone https://github.com/italia/pa-webinar.git
   cd pa-webinar
   helm repo add bitnami https://charts.bitnami.com/bitnami
   helm repo add jitsi-contrib https://jitsi-contrib.github.io/jitsi-helm/
   helm dependency build infra/helm/pa-webinar
   ```

2. **Build the images**, because the published ones cannot be pulled without
   credentials (see [Images](#images)):

   ```bash
   docker build -t pa-webinar:local .
   docker build --target builder -t pa-webinar:local-migrate .
   ```

3. **Generate the secrets once, and keep them.** The walkthroughs on this page
   use the simple profile, in which the chart renders the Secrets from values.
   Write `pa-webinar.secrets.yaml` exactly as in step 1 of
   [Simple profile](DEPLOYMENT.md#simple-profile), and keep it outside the
   repository, readable only by you. It generates the application keys and the
   datastore passwords, holds your SMTP relay, pins the Jicofo and bridge XMPP
   passwords, and sets `jitsi.requirePinnedCredentials: true`. The standard
   and full profiles read Secrets that you create instead, and pin the Jibri
   passwords as well ([Standard profile](DEPLOYMENT.md#standard-profile)).

   Why each value must be kept:

   - `PII_ENCRYPTION_KEY` encrypts personal data at rest. If you lose it, that
     data cannot be read again. Back it up together with every copy of the
     database.
   - The datastore passwords are written into PostgreSQL and Redis on first
     start. The chart does not regenerate them.
   - The conference's internal credentials (the Jicofo and bridge XMPP
     passwords, and Jibri's and coturn's when they are enabled) are drawn at
     random on every render when you leave them empty. Every `helm upgrade`,
     even one that changes an unrelated value, then restarts Prosody, Jicofo
     and the bridge, and every live conference drops. This happened on all
     three lab setups. The post-install notes list the ones that are not
     pinned, and `jitsi.requirePinnedCredentials: true` makes the render fail
     instead ([Pin the conference's internal credentials](DEPLOYMENT.md#pin-the-conferences-internal-credentials)).

   The lab installs passed the generated keys with `--set` flags, except the
   three-node one, which used a values file, and none of them configured SMTP.
   A file is less error-prone, and you pass the same file to every upgrade.

4. **Prepare two DNS names** that point at the ingress: one for the portal
   (`<portal-host>`, for example `webinar.example.com`) and one for the
   conference (`<jitsi-host>`, for example `meet.webinar.example.com`). In a lab
   without DNS, nip.io names resolve to the address they contain:
   `app.<node-ip>.nip.io` and `jitsi.<node-ip>.nip.io`.

## Development: Docker Compose

Status: used for development. Not load-tested.

```bash
git clone https://github.com/italia/pa-webinar.git
cd pa-webinar
docker compose up --build -d
docker compose --profile setup run --rm db-migrate
# Hot reload:
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

The portal is on `http://localhost:3000`, Mailpit on `http://localhost:8025`
and Jitsi on `https://localhost:8443`. [Development](DEVELOPMENT.md) covers
the rest, including troubleshooting.

This stack is not a smaller copy of the chart:

- The portal is served over plain HTTP. The session cookie is `Secure`, so
  sign-in works only on `localhost`.
- The secrets are development placeholders in the tracked `docker-compose.yml`.
- The Jitsi images follow the floating `stable` tag instead of the release that
  the chart pins. The bridge uses a public Google STUN server
  (`stun.l.google.com:19302`). No container has resource limits.
- The `cron` service runs the email outbox, the reminders and the hourly
  cleanup of expired event data. The other retention jobs do not run.
- There is no object storage and no TURN.
- The per-participant audio recorder runs with `--profile recorder` through the
  Docker socket. Its controller starts `ghcr.io/italia/pa-webinar-recorder:dev`,
  which cannot be pulled without credentials: build the image locally
  (`docker build -t pa-webinar-recorder:local infra/recorder`) and set
  `RECORDER_IMAGE` of the `recorder-controller` service to that tag, for
  example in a Compose override file. What else the profile needs to complete
  a recording is in
  [Setting up recording](operations/recording-setup.md#docker-compose-the-recorder-profile).
- Bridge scale-to-zero and AI post-production do not run.

For code work Compose is the better choice: there is no image load after each
rebuild (minikube needed about 96 s per rebuild for the two images), and Mailpit
and the scheduled jobs are included. Use minikube to try the chart itself. The
roadmap item **Single-server installation** in
[Installation and operations](ROADMAP.md#installation-and-operations) tracks
turning a single server into a supported production path.

## Evaluation: minikube

Status: tested in lab.

Use it to try the chart and click through the application. A full conference
works for browsers on the same workstation, because the node's UDP port 10000
is reachable from the host. Participants on other machines need a VM driver
with bridged networking, or UDP 10000 forwarded to the node. That was not
tested.

1. Start a profile with the add-ons:

   ```bash
   minikube start -p pa-webinar --driver=docker --cpus=4 --memory=8g \
     --disk-size=30g --kubernetes-version=v1.32.2
   minikube -p pa-webinar addons enable ingress
   minikube -p pa-webinar addons enable metrics-server
   ```

   On some cgroup v2 hosts, the Docker driver prints "Your kernel does not
   support CPU cfs period/quota" and ignores `--cpus`. If you see that warning,
   set the cap yourself and check it:

   ```bash
   docker update --cpus=4 pa-webinar
   docker exec pa-webinar cat /sys/fs/cgroup/cpu.max   # expect: 400000 100000
   ```

   The memory limit is enforced, but the node reports the host's CPU and memory
   to Kubernetes. Memory pressure then shows up as thrashing instead of
   eviction, and the percentages from `kubectl top node` are meaningless.

2. Load the images. The migration image is about 2.4 GB and took about 81 s:

   ```bash
   minikube -p pa-webinar image load pa-webinar:local
   minikube -p pa-webinar image load pa-webinar:local-migrate
   ```

3. Write `values-minikube.yaml`, with `<node-ip>` from
   `minikube -p pa-webinar ip`:

   ```yaml
   app:
     image:
       repository: pa-webinar
       tag: local
       pullPolicy: Never
     migration:
       image:
         repository: pa-webinar
         tag: local-migrate
         pullPolicy: Never
     env:
       NEXT_PUBLIC_APP_URL: https://app.<node-ip>.nip.io
       NEXT_PUBLIC_JITSI_DOMAIN: jitsi.<node-ip>.nip.io

   ingress:
     className: nginx
     hosts:
       - host: app.<node-ip>.nip.io
         paths:
           - path: /
             pathType: Prefix
     tls: []

   jitsi-meet:
     publicURL: https://jitsi.<node-ip>.nip.io
     imagePullSecrets: []
     web:
       image:
         repository: jitsi/web   # standard image: see Images
         tag: null               # the subchart's Jitsi release, like the other Jitsi images
       ingress:
         ingressClassName: nginx
         hosts:
           - host: jitsi.<node-ip>.nip.io
             paths: ["/"]
         tls: []
   ```

4. Install:

   ```bash
   kubectl --context pa-webinar create namespace pa-webinar
   helm --kube-context pa-webinar upgrade --install pa-webinar infra/helm/pa-webinar \
     -n pa-webinar \
     -f infra/helm/pa-webinar/examples/values-simple.yaml \
     -f values-minikube.yaml \
     -f pa-webinar.secrets.yaml
   ```

   On the first install the portal was ready after about 106 s. Until
   PostgreSQL is up, the `db-migrate` init container restarts a few times (four
   in the lab), and scheduled jobs that start in that window end in `Error`.
   Both resolve on their own.

5. Check:

   ```bash
   IP=$(minikube -p pa-webinar ip)
   curl -sk https://app.$IP.nip.io/api/health                                   # JSON with "status":"ok"
   curl -sk -o /dev/null -w '%{http_code}\n' https://jitsi.$IP.nip.io/config.js   # 200
   ```

Both names use the ingress controller's self-signed certificate. Open
`https://jitsi.<node-ip>.nip.io` once and accept its certificate before you join
a room from the portal. Joining a room embedded in the portal was not tested
with self-signed certificates.

The default minikube network plugin does not enforce NetworkPolicy. To test the
chart's policy, start the profile with `--cni=calico` (not tested).

Remove everything with `minikube delete -p pa-webinar`.

## Single node: k3s on one VM

Status: tested in lab. k3s v1.36 on Debian 12 (4 vCPU, 8 GiB, 40 GB) with its
bundled Traefik, ServiceLB, local-path storage, NetworkPolicy controller and
metrics-server. Simple profile with NetworkPolicy enabled. Up to 20
participants on camera.

You need:

- a VM of at least 4 vCPU, 8 GiB and 40 GB (see [Recommended sizes](#recommended-sizes));
- a public IP on the VM's interface, or NAT that forwards TCP 80 and 443 and
  UDP 10000 without changing the ports (see
  [Advertised addresses and NAT](#advertised-addresses-and-nat));
- two DNS names, and the images from [Before you install](#before-you-install).

### 1. Install k3s

```bash
curl -sfL https://get.k3s.io | sh -
```

### 2. Let Traefik see client addresses

k3s exposes Traefik through ServiceLB with `externalTrafficPolicy: Cluster`.
Incoming connections are then source-NATed, and the portal sees every external
client as the pod-network gateway (10.42.0.1 on a default k3s). All per-IP
limits, such as registration, sign-in and link resend, become a single limit
shared by the whole site. Fix it on the VM:

```bash
sudo tee /var/lib/rancher/k3s/server/manifests/traefik-config.yaml >/dev/null <<'EOF'
apiVersion: helm.cattle.io/v1
kind: HelmChartConfig
metadata:
  name: traefik
  namespace: kube-system
spec:
  valuesContent: |-
    service:
      spec:
        externalTrafficPolicy: Local
EOF
```

With this setting Traefik puts the real client address in `X-Forwarded-For`,
which is where the portal reads it. A device in front of the VM that
translates source addresses (NAT) hides them again, and the portal sees that
device's address.

Behind an HTTP proxy or load balancer that appends to `X-Forwarded-For`, the
setting above is not enough. With its defaults Traefik replaces the header with
the address of the connection, which is the proxy's, so every client behind
the proxy shares one counter, and `TRUSTED_PROXY_HOPS` alone changes nothing.
Do two things, in this order:

1. Make Traefik keep the proxy's entries: trust that proxy, and only that
   proxy, in the same file.

   ```bash
   sudo tee /var/lib/rancher/k3s/server/manifests/traefik-config.yaml >/dev/null <<'EOF'
   apiVersion: helm.cattle.io/v1
   kind: HelmChartConfig
   metadata:
     name: traefik
     namespace: kube-system
   spec:
     valuesContent: |-
       service:
         spec:
           externalTrafficPolicy: Local
       ports:
         web:
           forwardedHeaders:
             trustedIPs: ["<proxy-ip>/32"]
         websecure:
           forwardedHeaders:
             trustedIPs: ["<proxy-ip>/32"]
   EOF
   ```

   Keep `externalTrafficPolicy: Local`: without it Traefik sees the
   pod-network gateway instead of the proxy, and the trusted address never
   matches. Only the proxy that connects to Traefik goes in `trustedIPs`.
2. Set `app.env.TRUSTED_PROXY_HOPS: "1"` in the values of
   [step 5](#5-write-the-values-for-k3s), or one more for each further proxy
   that appends.

The rules and the values for other setups are in
[Client addresses and per-IP limits](#client-addresses-and-per-ip-limits).

### 3. Get the kubeconfig

```bash
ssh <user>@<node-ip> sudo cat /etc/rancher/k3s/k3s.yaml \
  | sed 's#https://127.0.0.1:6443#https://<node-ip>:6443#' > kubeconfig-pa-webinar
export KUBECONFIG=$PWD/kubeconfig-pa-webinar
```

Keep TCP 6443 closed to the Internet.

### 4. Import the images

```bash
docker save pa-webinar:local -o app.tar
docker save pa-webinar:local-migrate -o migrate.tar
scp app.tar migrate.tar <user>@<node-ip>:/tmp/
ssh <user>@<node-ip> 'sudo k3s ctr images import /tmp/app.tar && sudo k3s ctr images import /tmp/migrate.tar'
```

Alternatively, push them to a registry you control and set `app.imagePullSecrets`.

### 5. Write the values for k3s

Save this as `values-k3s.yaml`, with your host names:

```yaml
app:
  image:
    repository: pa-webinar
    tag: local
    pullPolicy: Never
  migration:
    image:
      repository: pa-webinar
      tag: local-migrate
      pullPolicy: Never
  env:
    NEXT_PUBLIC_APP_URL: https://<portal-host>
    NEXT_PUBLIC_JITSI_DOMAIN: <jitsi-host>

# Portal Ingress on Traefik. `traefik` is in ingress.nonNginxClassNames, so the
# chart leaves out the ingress-nginx annotations by itself. The null below
# removes the chart's cert-manager annotation; drop that line only if you
# install cert-manager with a ClusterIssuer named letsencrypt-prod.
ingress:
  className: traefik
  annotations:
    cert-manager.io/cluster-issuer: null
  hosts:
    - host: <portal-host>
      paths:
        - path: /
          pathType: Prefix
  tls: []   # see "DNS and TLS"

# Conference Ingress: the class alone selects the controller. Do not add a
# kubernetes.io/ingress.class annotation: if it differs from the class, the
# chart refuses to render. This Ingress keeps the chart's
# cert-manager.io/cluster-issuer annotation, which has no effect without
# cert-manager or with `tls: []`. Do not set it to null here: through the
# subchart, some Helm versions render the key as null instead of removing it.
jitsi-meet:
  publicURL: https://<jitsi-host>
  imagePullSecrets: []
  web:
    image:
      repository: jitsi/web
      tag: null
    ingress:
      ingressClassName: traefik
      hosts:
        - host: <jitsi-host>
          paths: ["/"]
      tls: []

# See "Network policies". Traefik runs in kube-system on k3s.
networkPolicy:
  enabled: true
  ingress:
    fromNamespaceSelectors:
      - kubernetes.io/metadata.name: kube-system
    allowMonitoring: false
```

The lab installed an earlier revision of the chart, which also needed every
ingress-nginx annotation set to `null`, the annotation
`kubernetes.io/ingress.class: traefik` on the conference Ingress, and extra
NetworkPolicy peers and ports for the scheduled jobs, the configuration-reload
hook and the status checks. The current chart needs none of them. This file was rendered with the
current chart and was not installed again.

### 6. Install

```bash
kubectl create namespace pa-webinar
helm upgrade --install pa-webinar infra/helm/pa-webinar -n pa-webinar \
  -f infra/helm/pa-webinar/examples/values-simple.yaml \
  -f values-k3s.yaml \
  -f pa-webinar.secrets.yaml \
  --wait --timeout 15m
```

If an earlier attempt failed, Helm keeps a failed revision with some objects
created. Running the same command again with corrected values succeeded in
the lab.

### 7. Check

Add `-k` to `curl` while the certificates are self-signed.

```bash
curl -s https://<portal-host>/api/health                                     # JSON with "status":"ok"
curl -s -o /dev/null -w '%{http_code}\n' https://<jitsi-host>/config.js        # 200
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<portal-host>/api/admin/login \
  -H 'Content-Type: application/json' -d '{"key":"<ADMIN_API_KEY>"}'         # 200, with an admin_session cookie
kubectl -n pa-webinar create job --from=cronjob/pa-webinar-email-outbox outbox-check
kubectl -n pa-webinar get job outbox-check                                   # Complete
```

The lab called the sign-in route through `kubectl port-forward` to the portal's
Service, not through the Ingress. Jobs that ran before PostgreSQL was ready may
show `Error`; the job you create by hand should complete.

In the lab the bridge was reachable on the node address: 20 of 20 participants
connected directly over UDP, and none needed a relay.

### Before the first real event

- A publicly trusted certificate on both names (see [DNS and TLS](#dns-and-tls)).
- The Traefik setting from step 2.
- Pinned internal Jitsi credentials, in the secrets file.
- The `networkPolicy.ingress.fromNamespaceSelectors` value from step 5, if the
  policy is on.
- A working SMTP relay. Without it no email is sent: no registration
  confirmation, reminder, date-change notice, post-event follow-up, staff
  sign-in link or verification link for a data-subject request.
- A database backup of your own. The project has no backup procedure yet (see
  [Known gaps](#known-gaps)).

### Behind an HTTP proxy

If the VM reaches the Internet only through a proxy, give the proxy to
containerd only, in `/etc/systemd/system/k3s.service.env` on the server, or
`/etc/systemd/system/k3s-agent.service.env` on an agent, then restart the k3s
service:

```text
CONTAINERD_HTTP_PROXY=http://<proxy-host>:<proxy-port>
CONTAINERD_HTTPS_PROXY=http://<proxy-host>:<proxy-port>
CONTAINERD_NO_PROXY=127.0.0.0/8,10.42.0.0/16,10.43.0.0/16,<node-subnet>,.svc,.cluster.local
```

Running the installer with `sudo -E` copies `http_proxy` and `https_proxy` into
that file instead, and then k3s sends its own API and kubelet traffic through
the proxy. The lab VMs pulled the Jitsi, Bitnami and kubectl images through a
proxy. A VM with no Internet access at all also needs the k3s binary and its
system images, as in the k3s
[air-gap installation](https://docs.k3s.io/installation/airgap), and every
image the chart uses, imported with `k3s ctr images import` as in step 4. That
path was not tested.

## Three nodes: k3s on three VMs

Status: tested in lab. k3s v1.36 with one server and two agents. Simple
profile with NetworkPolicy enabled. 20 participants on camera, and one node
powered off during a call.

| Node | Size in the lab | What ran there |
|---|---|---|
| Server | 2 vCPU / 4 GiB / 30 GB | k3s server (control plane and embedded datastore), Traefik, CoreDNS, metrics-server. The scheduler also placed Prosody, Jicofo and, in some runs, Jitsi web here |
| Agent | 2 vCPU / 4 GiB / 30 GB | Portal, PostgreSQL (local-path volume, bound to this node), Redis, and Jitsi web in the other runs. The scheduler chose this placement |
| Bridge | 4 vCPU / 4 GiB / 20 GB (8 GiB recommended) | Only the bridge. The node is labeled and tainted `workload=jitsi-jvb` |

The k3s documentation requires the nodes to reach each other on TCP 6443 to
the server, UDP 8472 for the flannel VXLAN overlay and TCP 10250 for the
kubelet. The lab did not check that list: its VMs were joined by a link that
let all traffic through.

### Installing the three nodes

1. Install the server, then the two agents:

   ```bash
   # on the server
   curl -sfL https://get.k3s.io | sudo INSTALL_K3S_EXEC='server --node-ip <server-ip> --tls-san <server-ip>' \
     K3S_TOKEN=<generate with openssl rand -hex 32> sh -

   # on each agent, with the same token
   curl -sfL https://get.k3s.io | sudo INSTALL_K3S_EXEC='agent --node-ip <agent-ip>' \
     K3S_URL=https://<server-ip>:6443 K3S_TOKEN=<same token> sh -
   ```

2. Get the kubeconfig as in step 3 of the single-node section, using
   `<server-ip>`.

3. Reserve the bridge node:

   ```bash
   kubectl label node <bridge-node> workload=jitsi-jvb
   kubectl taint node <bridge-node> workload=jitsi-jvb:NoSchedule
   ```

4. Import the app and migration images on the server and the agent. The bridge
   node does not need them: it pulls only the Jitsi images from Docker Hub.

5. Point both DNS names at `<server-ip>`, and add `values-k3s-three.yaml` next
   to `values-k3s.yaml`:

   ```yaml
   jitsi-meet:
     jvb:
       nodeSelector:
         workload: jitsi-jvb
       tolerations:
         - key: workload
           operator: Equal
           value: jitsi-jvb
           effect: NoSchedule
   ```

6. Install with the single-node command plus `-f values-k3s-three.yaml`.

The bridge advertised its own node's address: ICE selected
`<bridge-ip>:10000/udp`. Open UDP 10000 on that node only. ServiceLB answers
on 80 and 443 on every node except the bridge node when that node was tainted
before its ServiceLB pod started: the ServiceLB DaemonSet does not tolerate
the taint.

The lab installed an earlier revision of the chart, whose NetworkPolicy
blocked the scheduled jobs and the configuration-reload hook, and it added two
NetworkPolicies of its own to let them through. The current chart's policy does
not select those pods, so the `networkPolicy` block of `values-k3s.yaml`
applies unchanged and no extra policy is needed (see
[Network policies](#network-policies)).

Nothing pins the portal, PostgreSQL or Redis to a node, so the scheduler chooses
where they run. To make the failure domain predictable, pin them. This is
standard Kubernetes scheduling, but it was not tested here:

```yaml
app:
  nodeSelector:
    kubernetes.io/hostname: <agent-node>   # also applies to every CronJob
postgresql:
  primary:
    nodeSelector:
      kubernetes.io/hostname: <agent-node>
redis:
  master:
    nodeSelector:
      kubernetes.io/hostname: <agent-node>
```

Client addresses behave as on one node, but per node. With the k3s defaults,
the portal saw one gateway address per node through which traffic entered, so
every client entering through the same node shared one per-IP limit. With
`externalTrafficPolicy: Local`, measured on three nodes, the real client
address arrived only for traffic that entered on the node running Traefik;
through another node it was still translated, and the tainted bridge node did
not answer on 443. Traefik ran on the server only because the scheduler put it
there. Pin it to the node that DNS points at, in the HelmChartConfig of the
single-node step 2 (not tested):

```yaml
apiVersion: helm.cattle.io/v1
kind: HelmChartConfig
metadata:
  name: traefik
  namespace: kube-system
spec:
  valuesContent: |-
    nodeSelector:
      kubernetes.io/hostname: <server-node>
    service:
      spec:
        externalTrafficPolicy: Local
```

### What happens when a node is lost

| Node lost | Effect | Source |
|---|---|---|
| Agent (portal, PostgreSQL, Redis) | The portal was down for 9 min 3 s: the 7 min 50 s the VM was off, plus about 75 s to recover. The running conference continued, because signaling was on the server and media on the bridge node | Measured |
| Server | The control plane stops. Traefik and, in this placement, Jitsi signaling run there, so the portal and the conferences stop | Not tested |
| Bridge | All media stops until the node returns | Not tested |

What happened in the measured case:

1. The node was reported `NotReady` after 41 s. The portal answered with
   timeouts for 55 s, then with `503`.
2. After 5 min 49 s Kubernetes evicted the portal pod and recreated it on the
   server. There it stayed in `Init:Error`, because `db-migrate` could not reach
   the database.
3. The PostgreSQL and Redis pods stayed `Terminating`: Kubernetes does not
   replace StatefulSet pods on an unreachable node. After a forced delete, Redis
   started on another node within seconds. PostgreSQL stayed `Pending`, because
   its local-path volume is bound to the lost node.
4. When the node came back it was `Ready` after 11 s, PostgreSQL after 16 s and
   the portal after 75 s.

What to take from it:

- Three VMs with the in-cluster database keep media CPU away from the portal
  and the database. They do not make the service more available. For uptime you
  need an external or replicated PostgreSQL and more than one server node.
- Otherwise, pin PostgreSQL to your most reliable VM and back it up. The project
  has no backup or restore procedure yet (see [Known gaps](#known-gaps)).
- The per-node peaks at 20 participants on camera summed to about 2.3 cores
  and 5.2 GiB. The single-node VM of 4 vCPU and 8 GiB carried the same load,
  at 1.84 cores and 3.4 GiB, with the same availability.

## Managed Kubernetes: AKS, GKE, EKS

Status: AKS exercised. GKE and EKS not yet verified.

### Node pools

| Pool | Runs | Label and taint | Scaling | Notes |
|---|---|---|---|---|
| Applications | Portal, every CronJob (email outbox, reminders, GDPR cleanup, retention, recording reconciliation, post-production orchestration), the bridge scaler, the recorder controller, in-cluster PostgreSQL and Redis if used | None needed; a label you choose if you set `app.nodeSelector` | Fixed, at least two nodes across zones for the two app replicas | The CronJobs, the scaler and the recorder controller inherit `app.nodeSelector`. If no node carries that label, the portal and every job stay `Pending` |
| Bridges | JVB | Label and taint `workload=jitsi-jvb` | 0 to N with the full profile; fixed otherwise | UDP exposure (see below). One bridge per node |
| Recording | Jibri, in the full profile, on the bridge pool (`workload=jitsi-jvb`) | Same as the bridges | Scaled up only while recording | The chart renders Jibri's upload script but does not mount it: see [Mount the finalize script](operations/recording-setup.md#mount-the-finalize-script). The per-participant audio recorder is separate: see [Recording](architecture/recording.md) |
| GPU | AI post-production worker, and a vLLM server that you deploy | See `infra/tofu/ai-gpu-nodepool.tf` | 0 to N | Documented for AKS only: see [AI post-production](POSTPROD.md) |

`examples/values-full.yaml` leaves `app.nodeSelector` empty, so the portal and
every job run on any node without a taint, which keeps them off the tainted
bridge and GPU pools. To pin them to your application pool, use a label that
the pool carries:

- AKS: `agentpool: <pool>`;
- GKE: `cloud.google.com/gke-nodepool: <pool>`;
- EKS: `eks.amazonaws.com/nodegroup: <group>`, on managed node groups only,
  not on Karpenter or self-managed nodes;
- anywhere: a label you add yourself (AKS `--labels`, GKE `--node-labels`,
  eksctl or Karpenter `labels`, `kubectl label node` on k3s).

### Installing on a managed cluster

Follow the standard or full walkthrough in
[Deploying with Helm](DEPLOYMENT.md#install-walkthroughs). It creates the
Prosody token Secret, `videocall-jitsi-jwt`
([The Prosody JWT secret](DEPLOYMENT.md#the-prosody-jwt-secret)), and pins
every internal conference credential, Jibri's included. On a managed cluster,
also:

1. **Full profile: fix the known issues of `examples/values-full.yaml`** in
   your copy, as listed in
   [Profiles and values files](DEPLOYMENT.md#profiles-and-values-files): the
   scaler's schedule and the ServiceMonitor's scrape token.
2. **Protect bridges from the node autoscaler.** Consolidation can evict a
   bridge or a recorder in the middle of an event. This is recommended for
   autoscaled pools, and was not exercised:

   ```yaml
   jitsi-meet:
     jvb:
       podAnnotations:
         cluster-autoscaler.kubernetes.io/safe-to-evict: "false"
         karpenter.sh/do-not-disrupt: "true"
     jibri:
       podAnnotations:
         cluster-autoscaler.kubernetes.io/safe-to-evict: "false"
         karpenter.sh/do-not-disrupt: "true"
   ```

3. **Allow host ports in the Jitsi namespace.** With the default `hostPort`,
   the bridge needs the `privileged` Pod Security level: the `baseline` level
   and many admission policies (Azure Policy, Gatekeeper) reject host ports. The
   Jitsi images run as root.

### Exposing the bridges over UDP

A participant's browser sends media to the address that the bridge advertises.
That address must lead to that bridge and to no other. Read
[The single-IP pitfall](architecture/scaling.md#the-single-ip-pitfall) before
you choose a topology.

**A. One bridge behind a load-balancer IP.** Topology A is the one exercised
on AKS. It needs a reserved public IP and caps the platform at one bridge. The
snippet renders with the current chart and has not been installed as written;
the per-cloud keys come from provider documentation.

```yaml
app:
  env:
    JVB_MAX_REPLICAS: "1"
jitsi-meet:
  jvb:
    useHostPort: false
    useNodeIP: false
    publicIPs:
      - <reserved-public-ip>
    stunServers: ""            # the advertised address is known; no STUN lookup
    service:
      enabled: true
      type: LoadBalancer
      # AKS:     annotations: {service.beta.kubernetes.io/azure-pip-name: <public-ip-name>}
      # GKE:     loadBalancerIP: <reserved-regional-ip>
      # EKS:     loadBalancerClass: service.k8s.aws/nlb
      #          annotations: {service.beta.kubernetes.io/aws-load-balancer-eip-allocations: <eip-allocation-id>}
      # MetalLB: annotations: {metallb.universe.tf/loadBalancerIPs: <ip>}
```

**B. One public IP per bridge node.** This topology keeps the default
`hostPort` and lets you run more than one bridge. It needs a public IP on every
bridge node and UDP 10000 open to it: AKS node-pool public IPs and allowed host
ports or a network security group rule, a GKE non-private pool with a firewall
rule on the pool's network tag, EKS public subnets and a security-group rule.
The default `useNodeIP` advertises the node's internal address, which is
private on these clouds, so each bridge has to learn its node's public address
through STUN instead. Set `jitsi-meet.jvb.useNodeIP: false`, set
`JVB_ADVERTISE_PRIVATE_CANDIDATES: "false"` in `jitsi-meet.jvb.extraEnvs`, and
point STUN at a server you trust: your own server in
`jitsi-meet.jvb.stunServers`, or the chart's coturn, which serves as STUN only
with `jitsi-meet.coturn.enabled: true`, `jitsi-meet.turnHost` and
`jitsi-meet.jvb.useInternalStun: true` all set. This topology is not yet
verified. It is the prerequisite for raising `JVB_MAX_REPLICAS` above 1.

### Per-cloud notes

**AKS** (exercised). The portal, the bridge scaler with an auto-detected
Deployment name, Azure Blob storage with account-key SAS, ingress-nginx with
cert-manager, and the Azure Standard Load Balancer for UDP and mixed UDP/TCP
have all run. Open points:

- Only topology A has run real events. The node-pool example
  `infra/tofu/jvb-nodepool.tf` has no node public IPs or allowed host ports. It
  also references a `data.azurerm_kubernetes_cluster.main` that you must
  declare ([AKS reference node pools](../infra/aks/node-pools.md)).
- Storage needs an account key in the connection string. Managed and workload
  identity are not supported, so tenants whose policy disables Shared Key
  access cannot use it.
- NetworkPolicy needs a policy engine (Azure Network Policy Manager, Calico or
  Cilium).

**GKE** (not yet verified; the target is GKE Standard, not Autopilot):

- Bridges: a non-private pool with a firewall rule for UDP 10000, or topology A
  with a reserved regional IP.
- Ingress: the default GCE Ingress closes a connection after its backend
  timeout (30 s), which cuts the conference's signaling connections (BOSH long
  polls with the chart's defaults, or the WebSocket if you enable it) and the
  live-room event streams. Set `timeoutSec` to 3600 or more with a BackendConfig or
  GCPBackendPolicy, or install ingress-nginx.
- Client addresses: with the GCE Ingress, set `app.env.TRUSTED_PROXY_HOPS: "1"`
  (see [Client addresses and per-IP limits](#client-addresses-and-per-ip-limits)).
- Storage: Cloud Storage only through its S3-compatible API with HMAC keys.
  Workload Identity is not supported by the application. The S3 client computes
  checksums only where the API requires them, which is what that API needs;
  this was not tried against Cloud Storage.
- NetworkPolicy: enforced by Dataplane V2. With Cloud DNS or NodeLocal
  DNSCache, add their address to `networkPolicy.egress.dns.to`. With
  container-native load balancing, traffic reaches the pods from Google's
  front-end and health-check ranges, which need an `ipBlock` entry in
  `networkPolicy.ingress.extraRules`.
- TURN: check that the load balancer accepts mixed UDP and TCP on one Service,
  or split the coturn Service.
- GPU: GKE installs the drivers. Do not let the GPU Operator install them too.
- Monitoring: Managed Prometheus uses `PodMonitoring`, not the `ServiceMonitor`
  that the chart renders.

**EKS** (not yet verified):

- Node autoscaling: EKS ships none. Use Cluster Autoscaler with scale-from-zero
  tags that describe the pool's labels and taint, or a Karpenter NodePool with
  the taint and labels.
- Storage class: clusters created on 1.30 or later have no default. Install the
  EBS CSI add-on and mark `gp3` as default, or set
  `postgresql.primary.persistence.storageClass`.
- metrics-server is not installed by default, and the app's autoscaler needs it.
- UDP load balancers need the AWS Load Balancer Controller
  (`loadBalancerClass: service.k8s.aws/nlb`). The default controller creates a
  Classic Load Balancer, which carries no UDP.
- Security groups: UDP 10000, UDP and TCP 3478, TCP 443. Public subnets or
  Elastic IPs for the bridges.
- Storage: S3 with static keys only. IRSA and EKS Pod Identity are not supported
  by the application ([Object storage](configuration/storage.md#s3-compatible-services)).
- NetworkPolicy: enable the VPC CNI network policy feature
  (`enableNetworkPolicy: "true"`).
- Ingress on ALB: the class `alb`, which is in `ingress.nonNginxClassNames`, and
  `alb.ingress.kubernetes.io/*` annotations. The 60 s idle timeout is
  compatible with the event streams' 25 s keepalive.

## Networking

### Ports and firewall

| Port | Protocol | From | To | Purpose |
|---|---|---|---|---|
| 443 | TCP | Internet | Ingress | Portal and conference: HTTPS, the conference WebSocket and BOSH, the live-room event streams |
| 80 | TCP | Internet | Ingress | Only for HTTP-01 certificate validation and the redirect to HTTPS |
| 10000 | UDP | Internet | Each bridge node, or the bridge load balancer | Media, directly between browsers and the bridge |
| 3478 | UDP and TCP | Internet | coturn | STUN and TURN |
| 443 | TCP | Internet | coturn, on its own IP | TURN over TLS, for networks that allow only 443 |
| 6443 | TCP | Administrators and k3s agents only | k3s server | Kubernetes API. Never from the Internet |
| 587 (465) | TCP | Cluster | SMTP relay | Email |
| 443 | TCP | Cluster | Object storage | Recordings, materials, AI outputs |
| 443 | TCP | Browsers | Object storage | Video uploads from the administration area, and playback through signed URLs |

Media never passes through the portal or the ingress:

```text
Open network:        browser --UDP 10000--> bridge
UDP blocked:         browser --TLS 443--> coturn --UDP--> bridge
```

### Advertised addresses and NAT

- By default the bridge uses a host port and advertises its node's address
  (`useHostPort: true`, `useNodeIP: true`). This works when participants can
  reach that address: a VM whose interface carries the public IP, or a lab
  network. Every lab setup ran this way.
- Behind NAT (a VM with a private address and a port forward), or in a cloud
  where node addresses are private, set the public address explicitly and
  forward UDP 10000 to the same port. This was not tested in the lab:

  ```yaml
  jitsi-meet:
    jvb:
      publicIPs:
        - <public-ip>
  ```

  `publicIPs` replaces the node address. If participants inside the same
  network cannot reach the public address (no NAT hairpin), list the private
  node address as well. The subchart accepts both, but this was not tested.
- STUN: the Jitsi subchart's default STUN server is a third-party service
  (`meet-jit-si-turnrelay.jitsi.net:443`), and Docker Compose uses Google's. In
  the lab, even with `useNodeIP`, the bridge used that server to advertise the
  host's public address as an extra candidate. The post-install notes warn
  while it is in use. For a sovereign installation, choose one of these, none
  of which was tested in the lab:
  - `jitsi-meet.jvb.stunServers: ""`, together with `publicIPs`, or on a node
    whose network interface carries the public address. Without STUN and
    without `publicIPs`, a bridge behind NAT announces its private address, and
    participants outside the network join but hear and see nobody; the notes
    warn about this combination too;
  - your own STUN server in `jitsi-meet.jvb.stunServers`;
  - the chart's coturn, with `jitsi-meet.coturn.enabled: true`,
    `jitsi-meet.turnHost` and `jitsi-meet.jvb.useInternalStun: true` all set.
    With any of the three missing, the bridge keeps `stunServers`.

  Record the choice in your privacy notes ([GDPR](GDPR.md)). The keys are
  described in [Bridge (JVB)](DEPLOYMENT.md#bridge-jvb).
- To check: the bridge log shows
  `StaticMapping(localAddress=<pod-ip>, publicAddress=<advertised-ip>)`, and the
  bridge statistics show participants connected directly, with zero relayed.

### TURN

Participants behind firewalls that block UDP, which is common in public-sector
networks, need TURN over TLS on port 443. The chart includes coturn as an
option of the Jitsi subchart, configured as in
[coturn (TURN and TURNS)](DEPLOYMENT.md#coturn-turn-and-turns). That snippet
renders with the pinned subchart. None of the lab setups ran it. What the
topology needs:

- TURN over TLS needs a third DNS name (`turn.<domain>`). Its certificate cannot
  be validated with plain HTTP-01, because that name points at the coturn load
  balancer rather than the ingress. Use DNS-01, an existing certificate, or the
  subchart's ACME proxy described in the same section.
- On EKS, coturn's UDP needs a Network Load Balancer. On k3s, ServiceLB cannot
  bind 443 on a node where Traefik already holds it: use MetalLB with a second
  IP.

### DNS and TLS

- Two names are needed even in the simple profile: the portal and the
  conference are served by separate Ingresses. TURN over TLS needs a third.
- The chart annotates both Ingresses for cert-manager with a ClusterIssuer named
  `letsencrypt-prod`. If you use cert-manager, create an issuer with that name.
  HTTP-01 needs port 80 reachable from the Internet. Otherwise use DNS-01 with
  your DNS provider.
- To use your own certificates, create TLS Secrets and reference them in
  `ingress.tls` and `jitsi-meet.web.ingress.tls`:

  ```bash
  kubectl -n pa-webinar create secret tls pa-webinar-portal-tls --cert=<portal.crt> --key=<portal.key>
  kubectl -n pa-webinar create secret tls pa-webinar-meet-tls --cert=<jitsi.crt> --key=<jitsi.key>
  ```

- The conference name needs a publicly trusted certificate, and not only for
  browsers. The portal's status page fetches the conference host from inside
  the cluster. With a self-signed certificate that request fails
  (`DEPTH_ZERO_SELF_SIGNED_CERT`), and the status page reports the conference
  as down.
- The lab setups used nip.io names and the ingress controller's self-signed
  default certificate. That is not suitable for real participants.

### Ingress controllers

| Controller | Status | What to set | What is lost |
|---|---|---|---|
| ingress-nginx | Supported: the chart defaults. Exercised on AKS; tested in lab (minikube add-on) | Nothing | Nothing. Its upstream project has announced its retirement, so plan for another controller |
| Traefik (bundled with k3s) | Tested in lab | `ingress.className: traefik` and `jitsi-meet.web.ingress.ingressClassName: traefik`. See [step 5](#5-write-the-values-for-k3s) | HSTS, the redirect of the conference host's root to the portal, and the rate limits of the full profile and the production example. Traefik has no default body-size limit, and a live-room event stream stayed open for 200 s with Traefik's defaults |
| Other controllers that serve `Ingress` (Contour, HAProxy, Istio's gateway, cloud controllers) | Not yet verified | The two class keys, as for Traefik, and your class in `ingress.nonNginxClassNames` if it is not listed. Translate the annotations | See [Other ingress controllers](DEPLOYMENT.md#other-ingress-controllers) |
| GKE default (GCE) | Not yet verified | A BackendConfig or GCPBackendPolicy with `timeoutSec` of 3600 or more, and `app.env.TRUSTED_PROXY_HOPS: "1"`: the Google load balancer appends `<client>,<load-balancer>` to `X-Forwarded-For` | Without the timeout, the conference's signaling connections (BOSH long polls, or the WebSocket if enabled) and the live-room event streams are cut every 30 s |
| AWS ALB | Not yet verified | The class `alb` and `alb.ingress.kubernetes.io/*` annotations | – |
| Controllers that speak only Gateway API | Not supported | – | The chart renders no routes (see [Gateway API](#gateway-api)) |

Three chart details decide whether an install on another controller works:

- **The class selects the controller, on both Ingresses.** The chart sets no
  `kubernetes.io/ingress.class` annotation. If you add one, it must equal the
  class: the chart refuses to render otherwise, because the API server rejects
  such an Ingress on a new install and hands it silently to the class's
  controller on an update.
- **The ingress-nginx annotations follow the portal's class.** With a class in
  `ingress.nonNginxClassNames` (Traefik, HAProxy, Kong, ALB, GCE and others;
  see `values.yaml`), the chart leaves every `nginx.ingress.kubernetes.io/*`
  annotation out of the portal Ingress. With any other class they are rendered,
  because a custom ingress-nginx class cannot be recognized by its name.
- **An empty map removes nothing.** Helm merges maps, so
  `ingress.annotations: {}` in an overlay leaves every default annotation in
  place. Set each key you want removed to `null`.

### Client addresses and per-IP limits

The portal limits registrations, sign-in, link resends and feedback per client
address, and records that address in the administration audit log. It reads
only `X-Forwarded-For`, counted from the right (`getClientIp` in
`app/src/lib/rate-limit.ts`): the entry written by the ingress, or, with
`TRUSTED_PROXY_HOPS=N`, the (N+1)-th entry from the right. `N` counts the
entries that trusted infrastructure adds after the client's own; the ingress
itself is `0`, the default. The values per setup are in
[Configuration](CONFIGURATION.md#client-address-and-rate-limits).

What the lab measured, with an earlier version of the portal that read the
leftmost entry instead:

| Path to the portal | Forged `X-Forwarded-For` | Address the portal sees |
|---|---|---|
| ingress-nginx, default `use-forwarded-headers: false` | Replaced; the limit held (10 accepted, then 429) | Not measured. It depends on the controller Service's `externalTrafficPolicy`: with `Cluster`, the Kubernetes default, the controller would see translated node addresses, as Traefik does below |
| Traefik on k3s, defaults | Replaced; the limit held (5 answered, then 429) | 10.42.0.1 for every client on one node; on three nodes, one address per entry node |
| Traefik on k3s with `externalTrafficPolicy: Local` | Replaced; the limit held | The real client, for traffic that enters on the node running Traefik |
| Traefik trusting a front proxy (`forwardedHeaders.trustedIPs`) | Kept, with Traefik's entry appended after it: 12 of 12 forged requests passed the limit when the portal read the leftmost entry | Now an entry written by trusted infrastructure: the one Traefik appends, or, behind a real front proxy that appends and with `TRUSTED_PROXY_HOPS=1`, the one that proxy wrote. Verified by unit tests, not measured again on a cluster |
| Directly to the app Service | Accepted: 12 of 12 forged requests passed, through `kubectl port-forward` (a NodePort or a LoadBalancer on the Service would behave the same, not measured) | Whatever the client claims |

Rules that follow:

- Never expose the app Service directly. Always go through an ingress, and
  make it the only way in.
- On Traefik, do not set `forwardedHeaders.insecure`. Set `trustedIPs` only to
  your own upstream proxies.
- On ingress-nginx, keep `use-forwarded-headers` off unless a trusted proxy
  sits in front. If you turn it on, restrict `proxy-real-ip-cidr` to that
  proxy.
- `TRUSTED_PROXY_HOPS` counts only the entries that the ingress keeps. With
  their defaults, ingress-nginx and Traefik both replace `X-Forwarded-For` with
  the address of the connection. Behind a proxy, load balancer or firewall that
  appends to the header, that address is the proxy's: every client behind it
  then shares one counter, whatever the value, and the fix is on the ingress.
  Once the ingress keeps the chain, the value is:
  - Traefik with `forwardedHeaders.trustedIPs` set to the front proxies: the
    number of entries they add, `1` for one proxy;
  - ingress-nginx with `use-forwarded-headers: true`, `proxy-real-ip-cidr`
    restricted to the front proxies and `compute-full-forwarded-for` off, the
    recommended setup: `0`, because the controller resolves the client itself
    and writes it as the only entry;
  - ingress-nginx with `compute-full-forwarded-for: true`: the number of
    entries the front proxies add.

  The entries the client wrote on the left are then ignored. A value one too
  high lets a client choose its own key; one too low makes every client share
  the last proxy's counter. The values for each setup are in
  [Configuration](CONFIGURATION.md#client-address-and-rate-limits).
- On the GKE GCE Ingress set `TRUSTED_PROXY_HOPS=1`. The value counts the
  entries added after the client's, as Envoy's `xff_num_trusted_hops` does, not
  the hops including the ingress, as Express's `trust proxy` does.
- The counters live in each process's memory, so every limit is multiplied by
  the number of app replicas. See **Distributed rate limiting** in the
  [roadmap](ROADMAP.md#later).

### Gateway API

The chart renders `Ingress` objects only. With a controller that speaks only
Gateway API, such as Envoy Gateway, nothing is routed: you would have to write
`HTTPRoute` objects by hand outside the chart and keep them in step with every
upgrade. That is not a supported path. See **Ingress beyond ingress-nginx** in
[Installation and operations](ROADMAP.md#installation-and-operations).

## Network policies

### What the chart ships

With `networkPolicy.enabled: true` (default `false`), the chart renders one
policy, named after the chart's full name (`pa-webinar` for the release
`pa-webinar`). It selects only the app pods: the pods with the release's
selector labels and no `app.kubernetes.io/component` label, or, if
`app.podLabels` sets that label, the pods with its value. The scheduled jobs,
the bridge scaler, the configuration-reload hook, the recorder bot and
controller and the post-production jobs carry a component label and are not
selected, so their own traffic is not restricted.

| Direction | Allowed |
|---|---|
| Ingress, on TCP 3000 | The ingress controller: namespaces in `networkPolicy.ingress.fromNamespaceSelectors` (default: `ingress-nginx`) and pods in `fromPodSelectors`; with both lists empty, any source. Every pod carrying the release's selector labels, which admits the scheduled jobs, the scaler, the recorder controller and the post-production worker. The Jibri pods when Jibri is enabled. The `monitoring` namespace when `allowMonitoring` is on. Anything in `ingress.extraRules` |
| Egress | DNS on port 53 to `egress.dns.to` (default: `k8s-app: kube-dns` pods); PostgreSQL and Redis pods; the Jitsi pods on 5222 and 5280 (Prosody), 8080 (the bridge statistics) and 2222 (Jibri health); the recorder controller when it is enabled; the ingress controller's namespaces on 443 and 8443, for the portal's calls to its own public hostnames; TCP 587 anywhere (465 with `allowImplicitTlsSmtp`); TCP 443 anywhere except `169.254.0.0/16` (`httpsExcept`); anything in `egress.extraRules` |

[NetworkPolicy](DEPLOYMENT.md#networkpolicy) in Deploying with Helm describes
each key. The PostgreSQL and Redis subcharts render their own permissive
policies, and these did not interfere.

### Which platforms enforce them

| Platform | Enforcement | Tested |
|---|---|---|
| k3s | Yes, by the embedded kube-router. Blocked connections are rejected, so failures are immediate | Lab, one and three nodes |
| minikube | Not with the default network plugin. Start with `--cni=calico` | No |
| AKS | Only with a policy engine: Azure Network Policy Manager, Calico or Cilium | No |
| GKE | With Dataplane V2, or the network policy add-on | No |
| EKS | With the VPC CNI network policy feature (`enableNetworkPolicy: "true"`), or Calico or Cilium | No |

### What the lab found

The lab installs, on k3s with `fromNamespaceSelectors` set to the Traefik
namespace, ran an earlier revision of the chart, whose policy selected every
pod of the release:

- **Worked:** ingress to the portal; the portal to PostgreSQL, Redis and
  Prosody; conferences joined with tokens issued by the portal; migrations run
  from the init container.
- **Was blocked:** the email outbox and reminder runs (the other scheduled jobs
  carry the same labels and call the same port, so they were blocked too, by
  inference); the configuration-reload hook's calls to the Kubernetes API,
  which on k3s arrive on `<server-ip>:6443` after address translation, and
  which either skipped the restart of Jitsi web silently or failed, depending
  on the run; the portal's check of its own conference hostname, which loops
  back through Traefik and arrives on port 8443; and the portal's reads of the
  bridge statistics on 8080.
- With the default `fromNamespaceSelectors` (`ingress-nginx`), Traefik in
  `kube-system` got 502 from the portal.

The current chart's policy selects only the app pods, admits every pod of the
release on 3000, and allows the ingress controller's namespaces on 443 and
8443 and the Jitsi pods on 8080 and 2222. With it, the jobs, the hook and the
checks have their paths without extra rules; this was checked by rendering the
chart, not on a cluster. What the lab added for them, extra peers and ports and
a rule to the API server on 6443, is no longer needed.

### What you still set

- **Your ingress controller's namespace**, in `fromNamespaceSelectors`:

  | Controller | Namespace label |
  |---|---|
  | ingress-nginx, including the minikube add-on | `kubernetes.io/metadata.name: ingress-nginx` (the default) |
  | Traefik on k3s | `kubernetes.io/metadata.name: kube-system` |
  | AKS application routing | `kubernetes.io/metadata.name: app-routing-system` |
  | Any other | The namespace where the controller's pods run |
  | Cloud load balancers that send traffic straight to pods (GKE container-native, ALB IP targets) | Not a namespace: add an `ipBlock` rule for their ranges in `networkPolicy.ingress.extraRules` (not tested) |

- **The recorder bots**, if you record per participant: their pods do not
  carry the release's selector labels and need an `ingress.extraRules` entry
  ([Before enabling the NetworkPolicy](architecture/background-jobs.md#before-enabling-the-networkpolicy)).
- **Services the portal calls inside the cluster**: an in-cluster Prometheus
  (`PROMETHEUS_URL`) or S3 endpoint, in `egress.extraRules`; NodeLocal DNSCache
  in `egress.dns.to`.
- **A publicly trusted certificate on the conference host.** The policy lets
  the status check through, but with a self-signed certificate the status page
  still reports the conference as down (see [DNS and TLS](#dns-and-tls)).

### Checking a policy

A pod without the app's labels is not selected by the policy, so it proves
nothing. [NetworkPolicy](DEPLOYMENT.md#networkpolicy) in Deploying with Helm
has a probe that carries the app's labels, and a second one that, like a
scheduled job, is not selected. On k3s, a probe pod succeeded in its first
second, before the policy was programmed, and was refused 3 s later: wait a
few seconds before you trust a one-shot probe. Then run one job by hand and
check that it completes:

```bash
kubectl -n pa-webinar create job --from=cronjob/pa-webinar-email-outbox np-check
kubectl -n pa-webinar get job np-check
```

## Images

### What is published

The project publishes to GitHub Container Registry. **None of these images can
be pulled anonymously today**, so an install with the default values ends in
`ImagePullBackOff`:

| Image | Used for | Tags |
|---|---|---|
| `ghcr.io/italia/pa-webinar` | Portal | `X.Y.Z` per release, plus `X.Y` and `sha-<commit>` |
| `ghcr.io/italia/pa-webinar` | Migration init container | `X.Y.Z-migrate` and `vX.Y.Z-migrate` per release. Releases published before both forms existed carry only `vX.Y.Z-migrate` ([Migration image tags](development/ci-and-release.md#migration-image-tags)) |
| `ghcr.io/italia/pa-webinar-jitsi-web` | Jitsi web with the noise-suppression patch | One immutable tag per patch revision, named after the Jitsi release it patches (`stable-<jitsi-release>-rnnoise`, with a suffix for later revisions on the same release). The chart's default can lag behind the latest published tag: pin the one you pull ([Web image and pull secrets](DEPLOYMENT.md#web-image-and-pull-secrets)) |
| `ghcr.io/italia/pa-webinar-recorder`, `-recorder-controller`, `-postprod-worker` | Per-participant recorder, its controller, AI post-production | Development tags only: the floating `:dev`, which is the chart's default, and an immutable `:dev-<sha>` for each build of that component. No release tags |

The published images are built for `linux/amd64` only. Public images are
tracked as **Images that can be pulled, verified and pinned to a version** in
[Installation and operations](ROADMAP.md#installation-and-operations).

### Building locally

From the repository root:

```bash
docker build -t pa-webinar:local .                                 # portal
docker build --target builder -t pa-webinar:local-migrate .        # migrations (about 2.4 GB)
```

The browser-facing settings (`NEXT_PUBLIC_*`) are read at runtime, so one image
serves any host name. The other components build from their own folders:
`infra/recorder`, `infra/recorder-controller`, and `infra/ai` with
`Dockerfile.worker`. Local builds on other architectures were not tested.

To serve Jitsi web without credentials, use the standard image and drop the
pull secrets:

```yaml
jitsi-meet:
  imagePullSecrets: []
  web:
    image:
      repository: jitsi/web
      tag: null
```

With the standard image, the advanced noise suppression must stay off. That is
the application's default, and the chart refuses to render the incoherent
combination. See
[How PA Webinar extends Jitsi Meet](architecture/jitsi-integration.md#noise-suppression-and-the-patched-image).

### Getting images into the cluster

- minikube: `minikube -p <profile> image load <image>`.
- k3s: `docker save`, copy, then `sudo k3s ctr images import <file>` on every
  node that can run the portal.
- Any cluster: push to your own registry, then set `app.imagePullSecrets`, and
  `jitsi-meet.imagePullSecrets` if the Jitsi images come from it too.

### Pinning versions

- **Portal and migrations:** always set both tags. The chart's default for the
  migration image is `X.Y.Z-migrate`, without the `v`, which older releases do
  not carry; `vX.Y.Z-migrate` exists for every release.

  ```yaml
  app:
    image:
      tag: "X.Y.Z"
    migration:
      image:
        tag: "vX.Y.Z-migrate"
  ```

- **Jitsi:** the subchart pins one Jitsi release for all its components. Leave
  the tags empty to follow it.
- **PostgreSQL and Redis:** `values.yaml` pins the in-cluster images by digest
  inside the tag (`postgresql.image.tag` and `redis.image.tag`, in the form
  `latest@sha256:…`), and the comment next to each names the version. Setting
  `tag` replaces the pin, and a mirror that changes the registry or the
  repository must set `tag` as well. A new PostgreSQL major version refuses the
  existing data directory: it needs a dump and restore, not a tag change
  ([Reading the dry run](operations/upgrades.md#reading-the-dry-run)). In
  production, a managed PostgreSQL (Azure Database for PostgreSQL, Cloud SQL,
  RDS) avoids the question.
- **kubectl for hooks and the scaler:** the bridge scaler, the post-production
  orchestrator and the configuration-reload hook fall back to `kubectlImage`, a
  Bitnami kubectl image pinned by digest in `values.yaml`
  ([The kubectl image](operations/jvb-scaler.md#the-kubectl-image)).

## Known gaps

### On the roadmap

These gaps are tracked in [Installation and operations](ROADMAP.md#installation-and-operations)
and are not repeated here:

- **An installation exercised from scratch**: the managed-cloud path has not
  been walked end to end on a clean cluster.
- **Images that can be pulled, verified and pinned to a version**: see
  [Images](#images).
- **Single-server installation**: Docker Compose is not a production path, and
  no object store ships with the chart.
- **Portability across providers**: no test runs against a real storage
  service.
- **Ingress beyond ingress-nginx**: annotations and Gateway API.
- **Backup and restore**: there is no procedure.
- **Noticing when something breaks**: no alert covers the scheduled jobs, the
  email outbox or disk space.
- **Knowing the installation works, and being able to go back**.

**Distributed rate limiting** is under [Later](ROADMAP.md#later).

### Chart issues found by the lab installs

The lab installs found the issues below. Those that the chart has since fixed
are not listed; the others still need the workaround.

| Issue | Effect | Workaround |
|---|---|---|
| Internal Jitsi credentials left empty (Jicofo, bridge, and Jibri, the recorder and coturn when enabled) are random on every render | Every `helm upgrade` drops live conferences | Pin them. The post-install notes list the unpinned ones, and `jitsi.requirePinnedCredentials: true` makes the render fail ([Pin the conference's internal credentials](DEPLOYMENT.md#pin-the-conferences-internal-credentials)) |
| `annotations: {}` clears nothing, including in the simple profile | Default annotations remain | Set each key to `null`. For classes in `ingress.nonNginxClassNames` the chart drops the ingress-nginx annotations itself |
| The recorder bot's pods are not admitted by the NetworkPolicy | With the policy on, per-participant recording captures nothing | An `ingress.extraRules` entry ([Before enabling the NetworkPolicy](architecture/background-jobs.md#before-enabling-the-networkpolicy)) |
| The bridge heap is not capped | A 4 GiB node thrashes and drops the conference | [Bridge memory on small nodes](#bridge-memory-on-small-nodes) |
| Jicofo, Prosody and Jitsi web have no resource requests | First to be killed under memory pressure | Add small requests, for example Jicofo 50m / 384Mi, Prosody 50m / 256Mi, web 10m / 64Mi (not tested) |
| The bridge's default STUN server is a third-party service | An outbound dependency, and an extra advertised address. The post-install notes warn | [Advertised addresses and NAT](#advertised-addresses-and-nat) |
| `db-migrate` starts before PostgreSQL is ready | A few restarts on the first install; early jobs end in `Error` | Wait: it resolves on its own |
| Jibri is enabled by the standard and full profiles, but the chart renders its finalize script without mounting it | Composite recordings are neither uploaded nor registered | [Mount the finalize script](operations/recording-setup.md#mount-the-finalize-script) |
| The status check fetches the conference host with the cluster's trust store | With a self-signed or internal-CA certificate the status page reports the conference as down | A publicly trusted certificate ([DNS and TLS](#dns-and-tls)) |
| The conference-root redirect is an ingress-nginx annotation | No redirect with other controllers; the notes warn when the redirect's class is in `ingress.nonNginxClassNames` | None |
| Object storage accepts only static keys | IRSA, EKS Pod Identity and GKE or Azure workload identity cannot be used | Static keys |
| `REDIS_URL` ends in `svc.cluster.local` | Chat fan-out fails on clusters with a custom cluster domain | Keep the default domain |
| The bridge liveness probe times out after 1 s | An idle bridge restarts on an overloaded host | [Bridge memory on small nodes](#bridge-memory-on-small-nodes) |
