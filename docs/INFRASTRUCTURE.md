# Infrastructure reference

This page is the technical reference behind the installation guides. It keeps
what every platform shares and what the guides build on: how the lab measured
capacity and what it measured, the node pools and bridge exposure that a
cluster with dedicated pools needs, the network design in depth, the chart's
NetworkPolicy, the published images, and the chart issues that the lab
installs found. It is for the IT staff and architects of a public body who
adapt an installation, or who want the evidence behind a recommendation.

It does not choose a platform or walk through an installation. Start from
[Installing PA Webinar](install/README.md): the decision tree, the checklist,
the requirements, how scaling works and the known limitations. Then follow the
guide for your platform:

- <a id="choosing-a-setup"></a><a id="before-you-install"></a>**Choosing**:
  [Installing PA Webinar](install/README.md), with its
  [decision tree](install/README.md#choose-a-platform) and
  [checklists](install/checklists.md).
- <a id="evaluation-minikube"></a>**Evaluation on a workstation**:
  [Try PA Webinar on minikube](install/minikube.md).
- <a id="single-node-k3s-on-one-vm"></a><a id="three-nodes-k3s-on-three-vms"></a>**Your own VMs**:
  one or three, in [Installing on your own VMs with k3s](install/k3s.md).
- <a id="managed-kubernetes-aks-gke-eks"></a>**Managed Kubernetes**:
  [AKS](install/aks.md), [GKE](install/gke.md) and [EKS](install/eks.md). On
  another conformant cluster, apply [Node pools and bridge exposure](#node-pools-and-bridge-exposure)
  on top of [Deploying with Helm](DEPLOYMENT.md).
- <a id="development-docker-compose"></a>**Changing the code**: Docker Compose,
  in [Local development](DEVELOPMENT.md). It is not an installation.

The statuses used here (**exercised**, **tested in lab**, **not yet
verified**) are defined in [Installing PA Webinar](install/README.md). Other
pages own the rest:

- [Deploying with Helm](DEPLOYMENT.md): the chart's keys, profiles, Secrets and first-run checks;
- [Configuration](CONFIGURATION.md): environment variables, email, object storage;
- [Load testing](LOAD-TESTING.md): how to measure capacity, and the measurement of a real event;
- [Scaling the media plane](architecture/scaling.md): how bridges are counted and scaled.

On this page:

- [Sizing](#sizing)
- [Node pools and bridge exposure](#node-pools-and-bridge-exposure)
- [Networking](#networking)
- [Network policies](#network-policies)
- [Images](#images)
- [Known gaps](#known-gaps)

## Sizing

The minimum and recommended size of each platform is in
[Requirements](install/README.md#requirements), and the guides carry the
tables measured on each platform:
[minikube](install/minikube.md#measured-usage) and
[k3s](install/k3s.md#measured-numbers). This section keeps the method behind
those figures, what each component and each participant costs, and how the
recommendations were derived from the measurements.

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
- Each level ran at steady state for about 120 s on k3s, and for 105 to 135 s
  on minikube. On k3s, resource use comes from `kubectl top` every 15 s and
  `free -m` inside the VM. On minikube, a sampler read each container's working
  set from its cgroup, with `kubectl top` as a cross-check. Bridge traffic
  comes from the bridge's own statistics (`/colibri/stats`).
- Servers were KVM virtual machines running Debian 12 (and, for the two-node
  check of the k3s scripts, a Rocky Linux 9 server), or a minikube node, on
  the same physical host as the browsers.
- Software: k3s v1.36 with its bundled Traefik, local-path storage and
  NetworkPolicy controller; minikube v1.38 (Docker driver, ingress-nginx
  add-on; Kubernetes v1.32, and v1.35 for the runs in
  [Try PA Webinar on minikube](install/minikube.md#measured-usage)); Helm 4;
  the simple profile; Jitsi `stable-10741` with the standard `jitsi/web`
  image.

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
  so there was no WAN latency, loss or bandwidth limit, and no run reached an
  uplink limit.
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

<a id="recommended-sizes"></a>

### From the measurements to the recommended sizes

The sizes in [Requirements](install/README.md#requirements) follow from the
measurements above. Where a figure is extrapolated from the cost model rather
than measured, it says so.

- **minikube.** With `examples/values-minikube.yaml`, 20 participants on camera
  held at the limit on 2 CPU / 3 GB (2.88 of 3 GiB), 10 on camera used under
  half of 4 CPU / 6 GB, and 2 CPU / 2 GB collapsed at 20. Without the overlay,
  2 CPU / 4 GB collapsed at 20 on camera with the chart defaults and held them
  with the bridge heap capped
  ([Bridge memory on small nodes](#bridge-memory-on-small-nodes)). On
  4 CPU / 8 GB, 40 participants with six videos per receiver peaked at 2.75 of
  4 cores and 5.1 GiB (5214 MiB).
- **k3s on one VM.** 20 participants on camera used 1.84 cores, 3.4 GiB and
  46.9 Mbps out, with 180p thumbnails only: that is the measured floor for the
  uplink at that load, and the basis of the 4 vCPU / 8 GiB minimum. The
  recommendation of 8 vCPU / 16 GiB and 200 Mbps or more is for webinar-shaped
  events of about 50 people (1–5 cameras, muted audience), estimated at about
  130 Mbps out with real 720p speakers. Also estimated: a 40-person webinar
  with three real 720p speakers needs about 100 Mbps out (33 Mbps was measured
  with the synthetic ~1 Mbps stage stream), and 50 people all on camera would
  need 250–300 Mbps out and 5–6 bridge cores.
- **k3s on three VMs.** At 20 on camera the bridge node used 2616 MiB
  (2.6 GiB) of its 4 GiB. The bridge requests 2 GiB and its heap can grow to
  about 3 GiB, which leaves no headroom on 4 GiB: hence 8 GiB for the bridge
  node. The portal and database node stayed under 0.2 core and 1 GiB.
- **Managed bridge pool.** Not measured on a managed pool. In
  [Load testing](LOAD-TESTING.md#small-bridge-3-cpus), a bridge limited to
  3 CPU and 2 GiB on a 4 vCPU / 16 GiB VM carried about 25 participants all on
  camera, or 60 webinar viewers at about half its stress budget, and some 60
  to 80-participant webinar runs ended with it killed for exceeding its memory
  limit. The real 65-participant event ran on a 16-vCPU bridge. One conference
  always runs on one bridge, so size one bridge for your largest single event.
- **Managed application pool.** At 20 participants the portal, PostgreSQL and
  Redis together used about 0.25 core at most (253m in one run, during the
  join ramp) and under 300 MiB. Two nodes carry the two app replicas of the
  standard and full profiles; size the pool from the resource requests.
- **Docker Compose.** Not measured. On minikube, the Kubernetes layer (control
  plane, ingress, system pods) took about 0.8 GiB and 40–60m CPU that Compose
  does not need.

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

With the heap capped, the bridge process reached 1275 MiB at 20 participants
on this node, and 1464 MiB on a 2 CPU / 3 GB node: 95% of the 1536 MiB limit,
and it keeps that memory after the event. A limit reserves nothing on the
node, so leave it room. `examples/values-minikube.yaml` keeps the 1 GB heap
and the 1 GiB request, and sets the limit to 2 GiB
([What the overlay changes](install/minikube.md#what-the-overlay-changes)).

On a larger node shared with the portal and database, the cap above takes
away headroom that the bridge can use: the 8 GiB single-node VM carried 20
cameras uncapped, with the bridge at 1442 MiB. There, keep the 4 GiB limit and
match the heap to it instead, for example `VIDEOBRIDGE_MAX_MEMORY: "2560m"`.
This has not been tested.

Whether a 2-vCPU node can take the simple profile depends on the platform. On
minikube, the chart's requests plus minikube's control plane and ingress added
up to 2.5 CPU and 3180 MiB; the pods were scheduled only because the node
reported the host's capacity, which the Docker driver does. With
`examples/values-minikube.yaml`, which lowers the requests, the pods on the
node request 1580m and 2604 MiB in total. On k3s, the chart's 1.5 CPU plus
k3s's own pods came to about 1.7 CPU, so a 2-vCPU VM would schedule them with
almost no headroom. This is derived from the requests and was not tried on a
real 2-vCPU VM. At 20 cameras the 4-vCPU k3s node peaked at 1.84 cores, and
minikube with 2 CPUs and the heap capped at 1.51 cores. Use 2 CPU / 4 GB to
click through the application, or for small calls with the bridge heap
capped.

On a shared or overloaded host, an idle bridge was also restarted by its
liveness probe when the probe gave up after 1 s and three failures, and a
bridge restart drops every conference on it. The chart's default probe is
more tolerant: `/about/health` on port 8080, every 10 s, with a 5 s timeout
and six failures (`jitsi-meet.jvb.livenessProbe`). In the minikube run on
2 CPU / 2 GB, where most other pods restarted, the bridge did not.

## Node pools and bridge exposure

The full profile, and any installation with more than one bridge, needs a
cluster with dedicated node pools. The [AKS](install/aks.md),
[GKE](install/gke.md) and [EKS](install/eks.md) guides apply what follows
through their reference modules and example values. On another conformant
cluster, apply it yourself on top of
[Install walkthroughs](DEPLOYMENT.md#install-walkthroughs). Status: AKS
exercised with one bridge behind a fixed address; everything else in this
section not yet verified.

### Node pools

| Pool | Runs | Label and taint | Scaling | Notes |
|---|---|---|---|---|
| Applications | Portal, every CronJob (email outbox, reminders, GDPR cleanup, retention, recording reconciliation, post-production orchestration), the bridge scaler, the recorder controller and the recorder bots, Jitsi signaling, in-cluster PostgreSQL and Redis if used | None needed; a label you choose if you set `app.nodeSelector` | Fixed or autoscaled, at least two nodes across zones for the two app replicas | The CronJobs, the scaler and the recorder controller inherit `app.nodeSelector`. If no node carries that label, the portal and every job stay `Pending`. The recorder bots take `recorder.nodeSelector` instead, empty by default |
| Bridges | JVB | Label and taint `workload=jitsi-jvb` | 0 to N with the full profile; fixed otherwise | Regular capacity, never spot: an eviction drops everyone on the bridge. One bridge per node with the default host port. The complete contract is in [The JVB pool contract](../infra/aks/node-pools.md#the-jvb-pool-contract) |
| Recording | Jibri, in the full profile, on the bridge pool (`workload=jitsi-jvb`) or on a pool of its own | Same as the bridges | Scaled up only while recording | The chart renders Jibri's upload script but does not mount it: see [Mount the finalize script](operations/recording-setup.md#mount-the-finalize-script). The per-participant audio recorder is separate: see [Recording](architecture/recording.md) |
| GPU | AI post-production worker, and a vLLM server that you deploy | Label and taint `workload=ai-gpu` | 0 to N | The GPU device plugin must tolerate the pool's taint, and on spot capacity the spot taint too; otherwise no node advertises a GPU, the worker stays `Pending` and the GPU nodes keep running. A node's allocatable CPU and memory must exceed the worker's requests (`postprod.worker.resources` in `values.yaml`), or the autoscaler never scales the pool up. See [AI post-production](POSTPROD.md#provisioning-a-gpu-node-pool) |

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

<a id="installing-on-a-managed-cluster"></a>

### Settings for autoscaled pools

Follow the standard or full walkthrough in
[Deploying with Helm](DEPLOYMENT.md#install-walkthroughs). It creates the
Prosody token Secret, `videocall-jitsi-jwt`
([The Prosody JWT secret](DEPLOYMENT.md#the-prosody-jwt-secret)), and pins
every internal conference credential, Jibri's included. On a cluster whose
pools scale, also:

1. **Full profile: fix the known issues of `examples/values-full.yaml`** in
   your copy, as listed in
   [Profiles and values files](DEPLOYMENT.md#profiles-and-values-files): the
   scaler's schedule and the ServiceMonitor's scrape token.
2. **Protect bridges from the node autoscaler.** Consolidation can evict a
   bridge or a recorder in the middle of an event. `values-aks.yaml` and
   `values-gke.yaml` set the Cluster Autoscaler annotation on the bridge and
   Jibri pods, and `values-eks.yaml` sets it, with the Karpenter one, on the
   bridge. Elsewhere, set them yourself:

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
4. **Keep pods away from the instance metadata service.** A pod that reaches it
   can use the node's cloud identity. The EKS module requires IMDSv2 with a hop
   limit of 1 for this reason, so every controller there gets its region from
   its own settings ([Installing on Amazon EKS](install/eks.md)). Apply the
   same rule on any cloud with a metadata service.

### Exposing the bridges over UDP

A participant's browser sends media to the address that the bridge advertises.
That address must lead to that bridge and to no other. Read
[The single-IP pitfall](architecture/scaling.md#the-single-ip-pitfall) before
you choose a topology. The AKS, GKE and EKS modules offer both topologies
through their `jvb_exposure` variable, and their `helm_values` output writes
the keys below for you.

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

On EKS the in-tree controller creates a Classic Load Balancer, which carries no
UDP: the Network Load Balancer comes from AWS Load Balancer Controller, and its
managed security group admits the Service's source ranges, or every address
when none is set ([Installing on Amazon EKS](install/eks.md)). An upgrade that rolls the bridge
pod briefly leaves two bridges behind the same address: upgrade outside
events.

**B. One public IP per bridge node.** This topology keeps the default
`hostPort` and lets you run more than one bridge. It needs a public IP on every
bridge node and UDP 10000 open to it: AKS node-pool public IPs and allowed host
ports or a network security group rule, a GKE non-private pool with a firewall
rule on the pool's network tag, EKS public subnets and a security-group rule.
The default `useNodeIP` advertises the node's internal address, which is
private on these clouds, so each bridge has to learn its node's public address
through STUN instead. Set `jitsi-meet.jvb.useNodeIP: false`, and point STUN at
a server you trust: your own server in `jitsi-meet.jvb.stunServers`, or the
chart's coturn, which serves as STUN only with `jitsi-meet.coturn.enabled:
true`, `jitsi-meet.turnHost` and `jitsi-meet.jvb.useInternalStun: true` all
set. The chart's coturn works only where a bridge's request to coturn's public
address leaves the cluster: where the cluster answers its own load-balancer
address from inside, as the AKS and GKE guides assume, coturn sees a private
source and reports it, so those modules point `stunServers` at a server
outside the cluster ([Bridge and TURN exposure](install/aks.md#bridge-and-turn-exposure)).
Leave private candidates on, as
[Advertised addresses and NAT](#advertised-addresses-and-nat) explains. This
topology is not yet verified. It is the prerequisite for raising
`JVB_MAX_REPLICAS` above 1.

## Networking

### Ports and firewall

| Port | Protocol | From | To | Purpose |
|---|---|---|---|---|
| 443 | TCP | Internet | Ingress | Portal and conference: HTTPS, the conference WebSocket and BOSH, the live-room event streams |
| 80 | TCP | Internet | Ingress | Only for HTTP-01 certificate validation and the redirect to HTTPS |
| 10000 | UDP | Internet | Each bridge node, or the bridge load balancer | Media, directly between browsers and the bridge |
| 3478 | UDP | Internet | coturn, on its own IP; on one k3s server, the server | STUN and TURN. TCP instead of UDP only with `jitsi-meet.coturn.turn.transport: tcp` |
| 443 | TCP | Internet | coturn, on its own IP; on one k3s server, the ingress's 443, shared by name | TURN over TLS, for networks that allow only 443 |
| 80 | TCP | Internet | coturn, on its own IP | Only for the subchart's ACME proxy, when coturn's certificate comes from HTTP-01 |
| 6443 | TCP | Administrators and k3s agents only | k3s server | Kubernetes API. Never from the Internet |
| 8472 and 10250 | UDP and TCP | Every k3s node | Every k3s node | Pod network (flannel VXLAN, UDP 8472) and kubelet (TCP 10250), with more than one node |
| 587 (465) | TCP | Cluster | SMTP relay | Email |
| 443 | TCP | Cluster | Object storage | Recordings, materials, AI outputs |
| 443 | TCP | Browsers | Object storage | Video uploads from the administration area, and playback through signed URLs. On one k3s server with the Garage add-on, the ingress's 443 on `s3.<portal>` |

Media never passes through the portal. It passes through the ingress only
with the TURN add-on of one k3s server, where Traefik carries TURN over TLS:

```text
Open network:        browser --UDP 10000--> bridge
UDP blocked:         browser --TLS 443--> coturn --UDP--> bridge
UDP blocked, k3s:    browser --TLS 443--> Traefik --TCP 3478--> coturn --UDP--> bridge
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
- **Private candidates.** The bridge also announces its pod address, the
  default of the Jitsi image (`advertise-private-candidates`). In-cluster peers
  use it: the recorder bot, Jibri, and coturn when it relays a participant.
  Leave it on. With `JVB_ADVERTISE_PRIVATE_CANDIDATES: "false"` in
  `jitsi-meet.jvb.extraEnvs`, their media has to go out and back in through
  the node's public address, which fails as soon as inbound sources are
  restricted; and a bridge whose announced address is private, as on an
  intranet or in a lab, then announces no address at all, so people join and
  nobody hears or sees anyone. Turning private candidates off has not been
  exercised on any cloud. `values-gke.yaml` still turns them off for its
  load-balancer topology: see its entry in
  [Known limitations](install/gke.md#known-limitations).
- STUN: the Jitsi subchart's default STUN server is a third-party service
  (`meet-jit-si-turnrelay.jitsi.net:443`), and Docker Compose uses Google's. In
  the lab, even with `useNodeIP`, the bridge used that server to advertise the
  host's public address as an extra candidate. The post-install notes warn
  while it is in use. For a sovereign installation, choose one of these:
  - `jitsi-meet.jvb.stunServers: ""`, together with `publicIPs`, or on a node
    whose network interface carries the public address. The minikube and k3s
    overlays do this, and topology A above as well. Without STUN and without
    `publicIPs`, a bridge behind NAT announces its private address, and
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
[coturn (TURN and TURNS)](DEPLOYMENT.md#coturn-turn-and-turns). The AKS
reference installation runs it, and the k3s add-on was tested in lab.

**On one k3s server**, `infra/onprem/k3s/addons/turn.sh` needs no second
address: coturn listens on UDP 3478 through ServiceLB, and TURN over TLS
shares port 443 with the portal. Traefik routes `turn.<domain>` by name
(`IngressRouteTCP` with `HostSNI`), ends TLS with the same certificate mode as
the portal, and forwards TURN over TCP to coturn, which holds no certificate
and needs no restart on renewal. The script sets the relay address
(`REAL_EXTERNAL_IP`), and limits coturn's outbound traffic to the bridge. In
the lab, with the server's firewall dropping UDP 10000, two browsers relayed
through TURN on UDP 3478; dropping UDP 10000 and 3478 as well, they relayed
through TURN over TLS on 443. Both had audio and video
([Object storage and TURN](install/k3s.md#object-storage-and-turn)).

**On a managed cluster** the topology needs:

- **Its own address and a third DNS name** (`turn.webinar.example.com`). The
  certificate cannot be validated with plain HTTP-01 through the ingress,
  because that name points at the coturn load balancer. Use DNS-01, an
  existing certificate, or the subchart's ACME proxy described in the same
  section, which has not been verified.
- **Two replicas, or a relaxed disruption budget, on nodes that are drained.**
  The chart renders a disruption budget for coturn with one pod always
  available. With a single replica, it blocks every drain of that node: on AKS
  automatic node upgrades fail and the autoscaler cannot remove the node,
  while GKE evicts the pod anyway after up to an hour
  ([Upgrades and maintenance](install/gke.md#upgrades-and-maintenance)).
  `values-aks.yaml` runs two replicas spread across nodes; the alternative is
  one replica with `coturnPodDisruptionBudget.maxUnavailable: 1`, accepting a
  TURN interruption.
- **A restart after each certificate renewal.** coturn reads its certificate
  only when it starts. The subchart annotates the pod for Stakater Reloader;
  without it, restart coturn yourself outside events. Every coturn restart
  cuts the media of the participants it relays until the conference
  reconnects them.
- **Per platform.** On EKS, coturn's UDP needs a Network Load Balancer, and
  `values-eks.yaml` refuses to render an unpinned shared secret. On GKE, the
  reserved address and UDP with TCP on one Service need recent GKE versions
  ([TURN on GKE](install/gke.md#turn-turn_enabled)).
- **The relay address.** Without an Internet lookup from the pod, coturn
  announces its relays as `0.0.0.0`, and relay-only participants get no media:
  set `jitsi-meet.coturn.extraEnvs.REAL_EXTERNAL_IP`. The AKS, GKE and EKS
  examples rely on coturn reaching the Internet.

### DNS and TLS

- Two names are needed even in the simple profile: the portal and the
  conference are served by separate Ingresses. TURN over TLS needs a third.
- The chart annotates both Ingresses for cert-manager with a ClusterIssuer named
  `letsencrypt-prod`, except where the k3s and minikube overlays remove the
  annotation. If you use cert-manager, create an issuer with that name.
  HTTP-01 needs port 80 reachable from the Internet. Otherwise use DNS-01 with
  your DNS provider. Use DNS-01 as well where inbound sources are restricted,
  which closes port 80 to the certificate authority, and on k3s while
  `traefik-config.yaml` redirects port 80 to HTTPS, the challenge included.
- On one k3s server, `pa-webinar-up.sh --tls acme` has Traefik ask for the
  certificates itself, validated on port 443 (TLS-ALPN-01), with no
  cert-manager and no DNS API ([Certificates](install/k3s.md#certificates)).
- To use your own certificates, create TLS Secrets and reference them in
  `ingress.tls` and `jitsi.conferenceIngress.tls` (or
  `jitsi-meet.web.ingress.tls` with the subchart's Ingress):

  ```bash
  kubectl -n pa-webinar create secret tls pa-webinar-portal-tls --cert=<portal.crt> --key=<portal.key>
  kubectl -n pa-webinar create secret tls pa-webinar-meet-tls --cert=<jitsi.crt> --key=<jitsi.key>
  ```

- Browsers must trust both certificates. A participant whose device does not
  trust the conference's certificate sees **The video call service is not
  responding** in the room, with a link to the conference host where the
  warning can be accepted; external participants on their own devices will
  not trust an internal authority, so public events need a publicly trusted
  certificate on the conference host.
- With the conference installed by the chart, the portal's status page checks
  the conference's components at their in-cluster addresses, so the
  certificate plays no part there. With an external Jitsi it checks the public
  host, and a certificate the portal does not trust shows as `degraded` with
  the TLS error code, not as an outage
  ([Monitoring and health](operations/monitoring.md#get-apistatus)).
- For the portal's own outbound calls to names behind an internal certificate
  authority (an SMTP relay, object storage, an external Jitsi), mount the
  authority with `app.extraCaCerts`; the chart sets `NODE_EXTRA_CA_CERTS`
  ([Configuration reference](CONFIGURATION.md#extra-certificate-authorities)).
- The minikube script, and the k3s installer with `--tls private-ca`, sign
  the certificates with a certificate authority of the installation, which
  browsers must be told to trust. That suits an intranet or a trial, not
  external participants.

### Ingress controllers

| Controller | Status | What to set | What is lost |
|---|---|---|---|
| ingress-nginx | Supported: the chart defaults. Exercised on AKS; tested in lab (minikube add-on) | Nothing | Nothing. Its upstream project has announced its retirement, so plan for another controller |
| Traefik (bundled with k3s) | Tested in lab | `ingress.className: traefik` and `jitsi-meet.web.ingress.ingressClassName: traefik`, as `examples/values-k3s.yaml` sets them ([Installing on your own VMs with k3s](install/k3s.md)) | HSTS, the redirect of the conference host's root to the portal, and the rate limits of the full profile and the production example. Traefik has no default body-size limit, and a live-room event stream stayed open for 200 s with Traefik's defaults |
| Other controllers that serve `Ingress` (Contour, HAProxy, Istio's gateway, cloud controllers) | Not yet verified | The two class keys, as for Traefik, and your class in `ingress.nonNginxClassNames` if it is not listed. Translate the annotations | See [Other ingress controllers](DEPLOYMENT.md#other-ingress-controllers) |
| GKE default (GCE) | Not yet verified | A BackendConfig or GCPBackendPolicy with `timeoutSec` of 3600 or more, and `app.env.TRUSTED_PROXY_HOPS: "1"`: the Google load balancer appends `<client>,<load-balancer>` to `X-Forwarded-For`. `values-gke.yaml` sets the proxy hops, and the GKE module's BackendConfig sets the timeout and turns the load balancer's request logs off ([Installing on GKE](install/gke.md)) | Without the timeout, the conference's signaling connections (BOSH long polls, or the WebSocket if enabled) and the live-room event streams are cut every 30 s. With it, the streams still reopen once an hour |
| AWS ALB | Not yet verified | The class `alb` and `alb.ingress.kubernetes.io/*` annotations. The 60 s idle timeout is compatible with the event streams' 25 s keepalive | – |
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

Moderator and participant links carry `?token=`, and the conference address
carries `?jwt=` with the participant's name. A cloud load balancer or log agent
that stores full URLs keeps them: check what yours stores
([Logging](architecture/security.md#logging)).

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

The k3s scripts ship `externalTrafficPolicy: Local` in
`infra/onprem/k3s/traefik-config.yaml`, and the three-node layout pins Traefik
to the node that DNS points at
([Behind a load balancer, reverse proxy or WAF](install/k3s.md#behind-a-load-balancer-reverse-proxy-or-waf)).
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
- A device in front of the ingress that translates source addresses without
  appending to the header hides the clients, whatever you set.
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
| Egress | DNS on port 53 to `egress.dns.to` (default: `k8s-app: kube-dns` pods); PostgreSQL and Redis pods; the Jitsi pods on 5222 and 5280 (Prosody), 8080 (the bridge statistics), 2222 (Jibri health), 80 (the web container) and 8888 (Jicofo's REST API), the last two for the status page's in-cluster probes; the recorder controller when it is enabled; the ingress controller's namespaces on 443 and 8443, for the portal's calls to its own public hostnames; TCP 587 anywhere (465 with `allowImplicitTlsSmtp`); TCP 443 anywhere except `169.254.0.0/16` (`httpsExcept`); anything in `egress.extraRules` |

[NetworkPolicy](DEPLOYMENT.md#networkpolicy) in Deploying with Helm describes
each key. The PostgreSQL and Redis subcharts render their own permissive
policies, and these did not interfere.

### Which platforms enforce them

| Platform | Enforcement | Tested |
|---|---|---|
| k3s | Yes, by the embedded kube-router. Blocked connections are rejected, so failures are immediate | Lab, one and three nodes |
| minikube | Not with the default network plugin. Start with `--cni=calico` | No |
| AKS | Only with a policy engine: Azure Network Policy Manager, Calico or Cilium. The AKS module sets Calico | No |
| GKE | With Dataplane V2, which the GKE module enables, or the network policy add-on | No |
| EKS | With the VPC CNI network policy feature (`enableNetworkPolicy: "true"`), which the EKS module enables, or Calico or Cilium | No |

### What the lab found

The lab ran the policy on k3s, with `fromNamespaceSelectors` set to the Traefik
namespace:

- **Worked:** ingress to the portal; the portal to PostgreSQL, Redis and
  Prosody; conferences joined with tokens issued by the portal; migrations run
  from the init container; with the scripted installs, the email outbox job
  completed with the policy on.
- **Needed a path of its own:** the scheduled jobs, the configuration-reload
  hook's calls to the Kubernetes API (on k3s they arrive on `<server-ip>:6443`
  after address translation), the portal's check of its own conference
  hostname, which loops back through the ingress and arrives on port 8443, and
  the portal's reads of the bridge statistics on 8080. A policy that selects
  every pod of the release blocks them. The chart's policy selects only the app
  pods, admits every pod of the release on 3000, and allows the ingress
  controller's namespaces on 443 and 8443 and the Jitsi pods on 8080 and 2222,
  so these paths need no extra rule.
- With the default `fromNamespaceSelectors` (`ingress-nginx`), Traefik in
  `kube-system` got 502 from the portal.
- **Not exercised under an enforcing policy:** the status page's in-cluster
  probes of the conference's web container (port 80) and of Jicofo (8888),
  which the chart's egress rule allows by default. `scripts/validate-chart.sh`
  checks on every profile that each in-cluster address points to a rendered
  Service and that the egress rule allows its port.

### What you still set

- **Your ingress controller's namespace**, in `fromNamespaceSelectors`:

  | Controller | Namespace label |
  |---|---|
  | ingress-nginx, including the minikube add-on | `kubernetes.io/metadata.name: ingress-nginx` (the default) |
  | Traefik on k3s | `kubernetes.io/metadata.name: kube-system`, as `examples/values-k3s.yaml` sets it |
  | AKS application routing | `kubernetes.io/metadata.name: app-routing-system` |
  | Any other | The namespace where the controller's pods run |
  | Cloud load balancers that send traffic straight to pods (GKE container-native, ALB IP targets) | Not a namespace: add an `ipBlock` rule for their ranges in `networkPolicy.ingress.extraRules` (not tested) |

- **The recorder bots**, if you record per participant: their pods do not
  carry the release's selector labels and need a `networkPolicy.ingress.extraRules` entry
  ([Before enabling the NetworkPolicy](architecture/background-jobs.md#before-enabling-the-networkpolicy)).
- **Services the portal calls inside the cluster**: an in-cluster Prometheus
  (`PROMETHEUS_URL`) or S3 endpoint, in `networkPolicy.egress.extraRules`; NodeLocal DNSCache
  or Cloud DNS in `egress.dns.to`.
- **The Jitsi egress ports**, if you replace `egress.jitsi.ports`: keep 80 and
  8888, or the status page reports the conference's web page and Jicofo as
  down while calls work.

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
`ImagePullBackOff` unless you give the cluster credentials, a mirror or local
builds ([Registry access](install/README.md#registry-access-to-the-published-images)):

| Image | Used for | Tags |
|---|---|---|
| `ghcr.io/italia/pa-webinar` | Portal | `X.Y.Z` per release, plus `X.Y` and `sha-<commit>`. From the development branch, the floating `dev` and an immutable `dev-<sha>` |
| `ghcr.io/italia/pa-webinar` | Migration init container | `X.Y.Z-migrate` and `vX.Y.Z-migrate` per release. Releases published before both forms existed carry only `vX.Y.Z-migrate` ([Migration image tags](development/ci-and-release.md#migration-image-tags)). From the development branch, `dev-migrate` and `dev-migrate-<sha>` |
| `ghcr.io/italia/pa-webinar-jitsi-web` | Jitsi web with the noise-suppression patch | One immutable tag per patch revision, named after the Jitsi release it patches (`stable-<jitsi-release>-rnnoise`, with a suffix for later revisions on the same release). The chart's default can lag behind the latest published tag: pin the one you pull ([Web image and pull secrets](DEPLOYMENT.md#web-image-and-pull-secrets)) |
| `ghcr.io/italia/pa-webinar-recorder`, `-recorder-controller`, `-postprod-worker` | Per-participant recorder, its controller, AI post-production | Development tags only: the floating `:dev`, which is the chart's default, and an immutable `:dev-<sha>` for each build of that component. No release tags |

The development tags are for evaluation, as in the minikube guide; an
installation that serves events pins a release. The published images are
built for `linux/amd64` only. Public images are tracked as **Images that can
be pulled, verified and pinned to a version** in
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

- minikube: `scripts/minikube-up.sh` pulls the development images with a pull
  Secret when it has credentials, and otherwise builds your checkout and loads
  it into the node
  ([Choose how the images arrive](install/minikube.md#choose-how-the-images-arrive)).
- k3s: `pa-webinar-up.sh` builds the application images from the checkout and
  imports them into the server over ssh. For servers with no Internet,
  `infra/onprem/k3s/preload-images.sh build` builds them and bundles every
  other image the chart renders into one archive, which `import` loads on each
  node ([Images without registry access](install/k3s.md#images-without-registry-access)).
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

The limitations that decide the design of an installation are in
[Known limitations](install/README.md#known-limitations), and what the project
still has to deliver for installations is tracked in
[Installation and operations](ROADMAP.md#installation-and-operations) on the
roadmap. **Distributed rate limiting** is under [Later](ROADMAP.md#later).

### Chart issues found by the lab installs

The chart still has the issues below. The last column gives the workaround,
where there is one. The requests of Jicofo, Prosody and Jitsi web, and a
tolerant liveness probe for the bridge, are chart defaults on every profile.

| Issue | Effect | Workaround |
|---|---|---|
| Internal Jitsi credentials left empty (Jicofo, bridge, and Jibri, the recorder and coturn when enabled) are random on every render | Every `helm upgrade` drops live conferences | Pin them. The post-install notes list the unpinned ones, and `jitsi.requirePinnedCredentials: true` makes the render fail ([Pin the conference's internal credentials](DEPLOYMENT.md#pin-the-conferences-internal-credentials)). The minikube, k3s, GKE and EKS overlays set it; on AKS it goes in your private values file |
| `annotations: {}` clears nothing, including in the simple profile: Helm merges maps | Default annotations remain | Set each key to `null`: on the portal Ingress and on `jitsi.conferenceIngress` that removes it with any Helm. On the subchart's `jitsi-meet.web.ingress.annotations`, Helm 3.16 removes a key-level `null` and Helm 4.2 keeps it as `null` (the notes warn): use `jitsi.conferenceIngress`, as the k3s and minikube overlays do, or `annotations: null` for the whole map. For classes in `ingress.nonNginxClassNames` the chart drops the ingress-nginx annotations itself |
| The recorder bot's pods are not admitted by the NetworkPolicy | With the policy on, per-participant recording captures nothing | A `networkPolicy.ingress.extraRules` entry ([Before enabling the NetworkPolicy](architecture/background-jobs.md#before-enabling-the-networkpolicy)) |
| The bridge heap is not capped | A 4 GiB node thrashes and drops the conference | [Bridge memory on small nodes](#bridge-memory-on-small-nodes). `examples/values-minikube.yaml` caps it |
| The bridge's default STUN server is a third-party service | An outbound dependency, and an extra advertised address. The post-install notes warn | [Advertised addresses and NAT](#advertised-addresses-and-nat) |
| `db-migrate` starts before PostgreSQL is ready | A few restarts on the first install; early jobs end in `Error` | Wait: it resolves on its own |
| Jibri is enabled by the standard and full profiles, but the chart renders its finalize script without mounting it | Composite recordings are neither uploaded nor registered | [Mount the finalize script](operations/recording-setup.md#mount-the-finalize-script) |
| The conference-root redirect is an ingress-nginx annotation | No redirect with other controllers; the notes warn when the redirect's class is in `ingress.nonNginxClassNames` | None |
| Object storage accepts only static keys | IRSA, EKS Pod Identity and GKE or Azure workload identity cannot be used | Static keys |
| `REDIS_URL` ends in `svc.cluster.local` | Chat fan-out fails on clusters with a custom cluster domain | Keep the default domain |
| Without an Internet lookup, coturn announces its relays as `0.0.0.0` | Participants who can use only TURN get no media | Set `jitsi-meet.coturn.extraEnvs.REAL_EXTERNAL_IP`; the k3s TURN add-on does ([TURN](#turn)) |
| With `backup.enabled` on a storage class that binds volumes on first use (local-path), the backup volume stays `Pending` until the first nightly run | `helm upgrade --wait` hangs until its timeout | Install without `--wait` and wait with `kubectl rollout status`, as the k3s installer does ([Database backups](DEPLOYMENT.md#database-backups)) |
