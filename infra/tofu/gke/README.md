# GKE reference infrastructure

This folder is an OpenTofu root module that creates what PA Webinar needs on
Google Kubernetes Engine (GKE): the network, a Standard cluster, node pools,
Cloud Storage buckets with an HMAC key, static IP addresses and, optionally,
the DNS records. The application itself is then installed with the Helm
chart, using `infra/helm/pa-webinar/examples/values-gke.yaml` on top of the
full profile.

**Status: not yet verified.** Nobody has applied this module to a real Google
Cloud project or run an event on it. What has been checked, without a
project:

- `tofu init -backend=false && tofu validate` with OpenTofu 1.11 and the
  `hashicorp/google` provider 8.4, and the same with Terraform 1.16;
- `tofu test`, which applies the module against a mocked provider in three
  combinations of choices and checks the pools, the firewall rule, the
  addresses and TLS names in the chart values, the log settings and the
  ingress manifest it produces (`tests/offline.tftest.hcl`);
- `trivy config`, with no open finding: the accepted ones are commented in
  the code (flow logs, bucket versioning, access logs and customer-managed
  keys are off on purpose, see [Known limitations](#known-limitations));
- `helm template` of the full profile with `values-gke.yaml` and the values
  this module outputs, for the variants described below: GKE Ingress,
  ingress-nginx with a public IP per bridge node, and TURN on, with and
  without UDP.

Everything about GKE behavior on this page comes from Google's documentation,
not from an installation.

## What it creates

| Resource | Purpose |
|---|---|
| VPC and one subnet, with secondary ranges for pods and Services | A VPC-native cluster. The custom VPC has none of the default network's open rules (SSH, RDP, ICMP) |
| Cloud Router and Cloud NAT, with static egress IPs | Outbound traffic of the private nodes: image pulls, email, external calls. The static IPs are the ones to allowlist on an SMTP relay |
| GKE Standard cluster, regional, Dataplane V2 | Private nodes, control plane API reachable only from `master_authorized_networks`, Workload Identity pool, Shielded Nodes, a daily maintenance window |
| Node pool `apps` | Label `workload=applications`, no taint, always on. Portal, CronJobs, JVB scaler, recorder controller, Jitsi signaling, coturn, in-cluster Redis |
| Node pool `jvb` | Label and taint `workload=jitsi-jvb`, from zero nodes, regular (not spot) VMs, gVNIC. One bridge per node |
| Node pool `jibri` (optional) | Label and taint `workload=jitsi-jibri`, from zero nodes |
| Node pool `gpu` (optional) | Label and taint `workload=ai-gpu`, from zero nodes, GPU driver installed by GKE |
| Node service account | Replaces the Compute Engine default account, which has Editor on the project |
| Two Cloud Storage buckets | `files` and `recordings`, in the cluster's region, uniform access, public access prevented, CORS for browser uploads on `recordings`, incomplete multipart uploads aborted after 7 days |
| Storage service account and HMAC key | What the portal signs its S3 requests with. Access to the two buckets only |
| Static IPs | Two global IPs for the GKE Ingress, or one regional IP for ingress-nginx; one regional IP for the bridge's load balancer; one for coturn, with `turn_enabled` |
| SSL policy | TLS 1.2 or later on the GKE Ingress |
| Firewall rule | Only with `jvb_exposure = "node_public_ip"`: UDP 10000 to the bridge nodes |
| DNS records (optional) | A records in an existing Cloud DNS zone |
| Log exclusion | Keeps the access lines of the in-cluster HTTP proxies out of Cloud Logging: see [Logs](#logs) |

It does **not** create:

- **PostgreSQL.** The full profile expects an external database. Use Cloud SQL
  for PostgreSQL with a private IP (it needs Private Service Access on this
  VPC) and put its `DATABASE_URL` in the application Secret, or turn the
  in-cluster database back on with `postgresql.enabled: true`, which uses the
  cluster's default `standard-rwo` storage class.
- cert-manager, ingress-nginx, a Prometheus stack, the Cloud DNS zone, a
  registry mirror, or any Kubernetes Secret.

## Checklist

Before `tofu apply`:

- [ ] A Google Cloud project with billing, dedicated to this installation if
      possible.
- [ ] Quotas in the region: CPUs for the machine families you choose (E2 and
      N2 by default, G2 for the GPU pool), static external IPs, and GPUs if
      `gpu_enabled`. A pool that cannot get a VM leaves its pods `Pending` at
      the start of an event. The module reserves up to four regional IPs
      (NAT egress, bridge, TURN and, with ingress-nginx, the ingress) and,
      with the GKE Ingress, two global ones.
- [ ] Permissions for whoever runs OpenTofu: Owner on a dedicated project, or
      Kubernetes Engine Admin, Compute Network Admin, Compute Security Admin,
      Service Account Admin, Project IAM Admin, Storage Admin, Storage HMAC
      Key Admin, Service Usage Admin, Logs Configuration Writer (for the log
      exclusion), and DNS Administrator with `dns_managed_zone`.
- [ ] Organization policies that would block this design, common in
      public-sector landing zones: external IPs on VMs
      (`constraints/compute.vmExternalIpAccess`, only for
      `jvb_exposure = "node_public_ip"`), HMAC keys
      (`constraints/storage.restrictAuthTypes`), and load balancer types
      (`constraints/compute.restrictLoadBalancerCreationForTypes`).
- [ ] A remote state backend: the state holds the HMAC secret (see
      [State and secrets](#state-and-secrets)).
- [ ] Two DNS names, portal and conference, and a third one, `turn.<domain>`,
      if you turn TURN on.
- [ ] The admin networks that may reach the cluster API
      (`master_authorized_networks`).
- [ ] The three choices below. TURN is off by default, but participants on
      networks that block UDP get no audio or video without it: decide
      before the first event.

After `tofu apply`, in order: credentials, Secrets, ingress objects, DNS,
chart. See [Install](#install).

## Minimum requirements

The module's defaults, which are a starting point and not a measurement:

| Pool | Default machine | Nodes | Notes |
|---|---|---|---|
| `apps` | `e2-standard-4` (4 vCPU, 16 GiB) | 2 to 4, across zones | Two nodes, so that losing one does not take the portal, the scheduled jobs and the Jitsi signaling down together. Size it from the chart's resource requests |
| `jvb` | `n2-standard-4` (4 vCPU, 16 GiB) | 0 to 4 | The same shape as the AKS reference pool. Size one bridge for your largest single event: see [Sizing](../../../docs/INFRASTRUCTURE.md#sizing) |
| `jibri` | `n2-standard-4` | 0 to 2 | Only if you do not want Jibri on the bridge nodes |
| `gpu` | `g2-standard-16` (16 vCPU, 64 GB) with one NVIDIA L4 (24 GB) | 0 to 1 | Enough for transcription and diarization, not for the default language model, which needs about 48 GB: use `a2-ultragpu-1g` with `nvidia-a100-80gb` for that, where the region has it. The node must hold the chart's worker requests (8 CPU, 32Gi): a `g2-standard-8` never does, so the pool never scales up for it, unless you lower `postprod.worker.resources` (commented block in `values-gke.yaml`) |

The bridge nodes need the bandwidth of the events, not only CPU: in tile view
the bridge's outbound traffic grows with the square of the cameras (see
[Sizing](../../../docs/INFRASTRUCTURE.md#sizing)).

The Jibri image of the Jitsi version the chart pins does not need the
`snd-aloop` kernel module on the host (the Jitsi Docker guide requires it
only before release 7439), so Jibri can run on the default Container-Optimized
OS nodes. It does need shared memory for Chromium: `values-gke.yaml` sets
`jitsi-meet.jibri.shm` to 2Gi, the size the Jitsi Docker guide uses, which
counts against Jibri's memory limit.

## Choices

### 1. HTTP ingress: `ingress_mode`

| | `gce` (default) | `nginx` |
|---|---|---|
| What | GKE Ingress: a global external Application Load Balancer per Ingress, managed by Google | ingress-nginx, installed by you, behind a regional passthrough load balancer |
| IPs | Two global IPs, one per name | One regional IP for both names |
| Certificates | Google-managed (`ManagedCertificate`) | cert-manager with HTTP-01, as on the other platforms |
| Chart values | `values-gke.yaml` as it is | Remove the blocks marked `[Ingress GCE]` from your copy of `values-gke.yaml`: the full profile already carries the ingress-nginx values. The module's `helm_values` then also carries the TLS entries of both Ingresses, with the real names and the Secrets `videocall-tls` and `jitsi-tls` that cert-manager fills |
| `TRUSTED_PROXY_HOPS` | `1`: the load balancer appends `<client>,<load-balancer>` to `X-Forwarded-For` | `0` |
| Lost | The redirect of the conference host's root to the portal and the rate limits of the full profile, which are ingress-nginx annotations. Use Cloud Armor for limits at the edge | Nothing in the chart. The ingress-nginx project has announced its retirement, so plan for another controller |

**Why the GKE Ingress needs a BackendConfig.** Google's load balancer closes
every request when the backend service timeout expires, 30 seconds unless you
set it. The timeout counts the whole response, not idle time. That cuts the
live room's event streams (Server-Sent Events that stay open for the whole
event) and the conference's BOSH requests, which the server holds for up to a
minute. The `gce_ingress_manifest` output sets `timeoutSec: 3600` on both
backends: each stream is then closed once an hour and the browser's
`EventSource` reopens it on its own. If you turn
on the conference's WebSocket (`websockets.xmpp.enabled` in the Jitsi
subchart), the same timeout is the maximum lifetime of each WebSocket.

**The Ingress class.** GKE picks an Ingress only by the
`kubernetes.io/ingress.class` annotation. An Ingress with
`ingressClassName: gce` and no annotation is served by no controller, and the
portal does not answer. `values-gke.yaml` sets both, with the same value: the
chart requires them to match, and with the class `gce` it drops the
ingress-nginx annotations of the full profile.

### 2. Bridge exposure: `jvb_exposure`

Read [The single-IP pitfall](../../../docs/architecture/scaling.md#the-single-ip-pitfall)
first.

- **`load_balancer` (default).** One bridge behind a passthrough network load
  balancer with a reserved IP. The bridge advertises that IP (`publicIPs`), so
  it needs no STUN server. All nodes stay private, and GKE creates the
  firewall rules for the load balancer. The platform is capped at one bridge,
  that is one event at a time: `JVB_MAX_REPLICAS: "1"`. This is the topology
  that runs real events on AKS.
- **`node_public_ip`.** Each bridge node gets a public IP and the bridge binds
  UDP 10000 as a host port, so there can be one bridge per node and several
  events at once. The public IP is a one-to-one NAT that the node's network
  interface does not carry, so each bridge discovers it with STUN, from a
  server outside the cluster (`jvb_stun_servers`, by default the Jitsi
  project's third-party server; the in-cluster coturn would see the private
  address). The host port needs the `privileged` Pod Security level in the
  Jitsi namespace. With Dataplane V2, a host port inside the NodePort range
  (30000-32767) may receive no traffic, which is why `jvb_udp_port` refuses
  it. This topology has not been verified on any platform.

### 3. TURN: `turn_enabled`

Participants on networks that block UDP need TURN over TLS on port 443. TURN
is off by default, both here and in `values-gke.yaml`: turn it on in both
places together. `turn_enabled = true` reserves an IP for the chart's
coturn and, with `turn_hostname`, its DNS record; the commented TURN block of
`values-gke.yaml` turns coturn on.

The reserved IP reaches the coturn Service only through the annotation
`networking.gke.io/load-balancer-ip-addresses`, which `helm_values` sets: the
Jitsi subchart has no other way to pass it. On an external Service, GKE reads
that annotation only with
`loadBalancerClass: networking.gke.io/l4-regional-external`, from GKE
1.33.1-gke.1779000. Keep that class in every case; without it the Service
gets a temporary IP and the DNS record points at nothing. Carrying UDP 3478
and TCP 443 on one address also needs the mixed-protocol load balancer,
generally available from GKE 1.36.2-gke.1498000. Between the two versions,
keep the class and set `coturn.turn.transport: tcp`, so the Service carries
TCP only. On a version older than 1.33.1-gke.1779000 the reserved IP cannot
reach coturn through the chart.

The certificate for the TURN name cannot be obtained with HTTP-01, because
that name points at coturn and not at the ingress: use cert-manager with a
DNS-01 solver on Cloud DNS (it can use the cluster's Workload Identity) or a
TLS Secret of your own. The keys are in the commented TURN block of
`values-gke.yaml` and in
[coturn (TURN and TURNS)](../../../docs/DEPLOYMENT.md#coturn-turn-and-turns).

### Optional pools

- `jibri_enabled = true` creates a dedicated Jibri pool. Without it, Jibri
  runs on the bridge pool, as the full profile places it, and competes with
  the bridge for CPU while recording. With it, use the commented Jibri
  placement in `values-gke.yaml`.
- `gpu_enabled = true` creates the pool for AI post-production. GKE installs
  the NVIDIA driver and taints GPU nodes with `nvidia.com/gpu`, which pods
  that request a GPU tolerate automatically. Do not install the GPU Operator
  with its driver on top. Set `gpu_pool.zones` to zones where the GPU type
  exists (`gcloud compute accelerator-types list`). The models volume needs
  a `ReadWriteMany` class: `enable_filestore_csi = true` turns on Filestore.
  See [Provisioning a GPU node pool](../../../docs/POSTPROD.md#provisioning-a-gpu-node-pool).

## Install

From the repository root.

1. Write `infra/tofu/gke/terraform.tfvars` from `terraform.tfvars.example`,
   configure a backend in `versions.tf`, then:

   ```bash
   tofu -chdir=infra/tofu/gke init
   tofu -chdir=infra/tofu/gke plan -out=gke.tfplan
   tofu -chdir=infra/tofu/gke apply gke.tfplan
   ```

2. Get the cluster credentials (needs `gke-gcloud-auth-plugin`):

   ```bash
   $(tofu -chdir=infra/tofu/gke output -raw get_credentials_command)
   ```

3. Create the namespace and the two Secrets listed at the top of
   `examples/values-full.yaml` (their keys are in
   [Secrets](../../../docs/DEPLOYMENT.md#secrets)), then add the storage keys
   to the application Secret (needs `jq`). The secret travels through a pipe
   only: it is not printed, and it never appears on a command line, where
   other users of the machine could read it in the process list.

   ```bash
   ACCESS_ID="$(tofu -chdir=infra/tofu/gke output -raw storage_hmac_access_id)"
   tofu -chdir=infra/tofu/gke output -json storage_hmac_secret \
     | jq --arg id "$ACCESS_ID" 'if . == null then error("no HMAC key in the state")
         else {stringData: {
           STORAGE_FILES_S3_ACCESS_KEY_ID: $id, STORAGE_FILES_S3_SECRET_ACCESS_KEY: .,
           RECORDING_S3_ACCESS_KEY_ID: $id,     RECORDING_S3_SECRET_ACCESS_KEY: .}} end' \
     | kubectl -n videocall patch secret videocall-secrets --type merge --patch-file /dev/stdin
   ```

   This works with `create_hmac_key = true`, the default. With `false` the
   state holds no key: both commands stop with an error and the Secret is
   left as it was. Put the key you created (see
   [State and secrets](#state-and-secrets)) in the same four keys yourself.

   The Jitsi images of the chart's defaults include a patched web image on a
   registry that may require credentials: see
   [Web image and pull secrets](../../../docs/DEPLOYMENT.md#web-image-and-pull-secrets).

4. With `ingress_mode = "gce"`, apply the BackendConfigs, the FrontendConfig
   and the managed certificates before the chart, so that the load balancer
   starts with the right timeout:

   ```bash
   tofu -chdir=infra/tofu/gke output -raw gce_ingress_manifest \
     | kubectl -n videocall apply -f -
   ```

   With `ingress_mode = "nginx"`, install ingress-nginx on the reserved IP
   instead. `externalTrafficPolicy: Local` keeps the client address for the
   portal's per-IP limits:

   ```bash
   helm upgrade --install ingress-nginx ingress-nginx \
     --repo https://kubernetes.github.io/ingress-nginx --version 4.15.1 \
     -n ingress-nginx --create-namespace \
     --set controller.service.loadBalancerIP="$(tofu -chdir=infra/tofu/gke output -raw ingress_nginx_ip)" \
     --set controller.service.externalTrafficPolicy=Local \
     --set controller.nodeSelector.workload=applications
   ```

   Pin the chart version, and change it only as a deliberate upgrade. Keep
   the namespace `ingress-nginx`: the log exclusion (see [Logs](#logs)) finds
   the controller by it. Then install cert-manager with a ClusterIssuer
   named `letsencrypt-prod` (see
   [DNS and TLS](../../../docs/INFRASTRUCTURE.md#dns-and-tls)).

5. Point the DNS names at the addresses in `tofu output dns_records`, unless
   the module created the records (`dns_managed_zone`). Google-managed
   certificates are issued only once the name resolves to its Ingress, which
   can take up to an hour.

6. Install the chart. Keep your installation's files in a folder outside
   the repository, here `~/pa-webinar-config`, so that they cannot end up in
   a commit:

   ```bash
   mkdir -p ~/pa-webinar-config
   tofu -chdir=infra/tofu/gke output -raw helm_values > ~/pa-webinar-config/gke-infra.yaml
   helm upgrade --install videocall ./infra/helm/pa-webinar -n videocall \
     -f infra/helm/pa-webinar/examples/values-full.yaml \
     -f infra/helm/pa-webinar/examples/values-gke.yaml \
     -f ~/pa-webinar-config/gke-infra.yaml \
     -f ~/pa-webinar-config/secrets.yaml \
     --wait --timeout 15m
   ```

   `gke-infra.yaml` holds names, IPs and bucket names, no secret, but they
   describe your installation. `secrets.yaml` holds the pinned internal XMPP
   passwords listed in `examples/values-full.yaml`, and the coturn secret if
   you turn TURN on.

7. Check:

   ```bash
   kubectl -n videocall get managedcertificate   # Status: Active
   kubectl -n videocall get ingress              # the reserved addresses
   kubectl -n videocall get svc -l app.kubernetes.io/component=jvb
   kubectl -n videocall describe ingress videocall-pa-webinar | grep -i backend
   ```

   Then go through the [checklist](../../../docs/install/gke.md#checklist) before the first real event.

## How scaling works here

- **Portal.** The chart's HorizontalPodAutoscaler adds portal replicas on CPU
  and memory; the cluster autoscaler adds `apps` nodes, up to
  `apps_pool.max_nodes`, when they no longer fit.
- **Bridges.** The chart's JVB scaler raises the bridge Deployment from zero
  before an event, within its pre-scale window. The new bridge pod stays
  `Pending`, and the cluster autoscaler creates a `jvb` node for it: booting
  the VM and pulling the bridge image takes minutes, which is what the
  pre-scale window absorbs (see
  [Cold start and the pre-scale window](../../../docs/architecture/scaling.md#cold-start-and-the-pre-scale-window)).
  After the event the scaler takes the bridge back to zero, and the empty node
  is removed after it has been unneeded for about ten minutes (the `BALANCED`
  autoscaling profile). The bridge pods carry
  `cluster-autoscaler.kubernetes.io/safe-to-evict: "false"`, so the autoscaler
  does not move a bridge to consolidate nodes during an event.
- **One bridge per node, one conference per bridge.** More bridges add
  concurrent events, not participants per event. With `load_balancer` there is
  one bridge in total; with `node_public_ip` one per node, up to
  `jvb_pool.max_nodes`, and `JVB_MAX_REPLICAS` must not exceed it (see
  [One bridge per node](../../../docs/architecture/scaling.md#one-bridge-per-node)).
- **GPU.** The post-production queue, not the JVB scaler, creates worker Jobs;
  each one brings up a `gpu` node, which goes away when the Jobs are done.
- **Node upgrades are not autoscaling.** GKE upgrades and repairs nodes on its
  own; an upgrade drains a bridge node and drops its conference. The
  maintenance window (`maintenance_window`, daily 01:00-05:00 UTC by default)
  keeps upgrades away from office hours; add a maintenance exclusion in the
  console around an important event.

## State and secrets

- The state contains the HMAC secret. Use a remote backend with restricted
  access and versioning, such as a dedicated Cloud Storage bucket, and turn on
  OpenTofu's client-side state encryption if your policy asks for it.
- To keep the secret out of the state, set `create_hmac_key = false` and
  create the key yourself:
  `gcloud storage hmac create <storage_service_account>`.
- Rotating the key: create a second key for the same service account, update
  the four storage keys in the application Secret, restart the portal pods,
  then deactivate and delete the old key. With `create_hmac_key = true`,
  `tofu apply -replace=google_storage_hmac_key.storage[0]` does the first
  step, but deletes the old key at once: restart the portal right after.
- Nothing in `tofu output helm_values` is secret.

## Logs

Access logs carry credentials. The moderator link, the participant links
and the chat stream carry `?token=`, and the conference address carries
`?jwt=`, whose payload includes the participant's name. An access log line
holds the client address and the whole URL, query included (see "Tokens in
query strings" in [Logging](../../../docs/architecture/security.md#logging)).
The module keeps these lines out of Cloud Logging:

- **GKE Ingress.** GKE turns load balancer request logging on for every
  Ingress unless the BackendConfig says otherwise. Both BackendConfigs of
  `gce_ingress_manifest` set `logging.enable: false`. To diagnose a problem,
  turn it on for a short time with a low `sampleRate`, knowing what the lines
  contain.
- **Proxies in the cluster.** `logging_config` sends container logs to Cloud
  Logging. With `exclude_proxy_access_logs = true` (the default) an exclusion
  on the project's `_Default` sink drops every line of the ingress-nginx
  controller (namespace `ingress-nginx`) and of the conference web server
  (pods named `<release>-jitsi-meet-web-…`) of this cluster, errors
  included. `kubectl logs` still shows them, from the node.

What remains your decision:

- **Where the other logs live.** The portal, the Jitsi components and coturn
  still log to the project's `_Default` log bucket. The application log has
  no client addresses and no query strings, but other components can log
  addresses (coturn logs its sessions, for example). The `_Default` bucket's
  location is fixed when the project is created, and it is global unless
  your organization sets a default location for Cloud Logging. For a
  regional store, route the `_Default` sink to a log bucket you create in
  the region, and set a retention that matches your privacy notes (30 days
  by default).
- **Sinks above the project.** An organization or folder sink, common in
  landing zones, receives the lines regardless of the project's exclusions:
  add the same exclusion there.

## Known limitations

- **Not verified on Google Cloud.** See the status at the top.
- **Storage keys are static.** The portal reaches Cloud Storage only through
  its S3-compatible XML API, signed with an HMAC key. Workload Identity is not
  supported by the application for storage: its S3 client is always built
  with a static key pair (see
  [S3-compatible services](../../../docs/configuration/storage.md#s3-compatible-services)).
  An organization policy that restricts HMAC authentication therefore
  disables the portal's storage. The module still enables the cluster's
  Workload Identity, for cert-manager or External Secrets Operator.
- **One bridge with the default exposure.** See
  [Bridge exposure](#2-bridge-exposure-jvb_exposure).
- **`node_public_ip` depends on a STUN server outside the cluster**, a
  third-party one by default. Record the choice in your privacy notes.
- **The GKE Ingress drops what only ingress-nginx does**: the conference
  root redirect and the ingress rate limits. Streams are reopened once an
  hour.
- **TURN is off by default and needs a recent GKE**: 1.33.1-gke.1779000 for
  its reserved IP, 1.36.2-gke.1498000 for UDP and TCP on one address (see
  [TURN](#3-turn-turn_enabled)), and a DNS-01 certificate. That coturn relays
  correctly to a bridge behind the load balancer, or to a bridge node's
  public IP from a private node through Cloud NAT, has not been checked.
- **Monitoring.** The chart renders `ServiceMonitor` objects for the
  Prometheus Operator, which a new GKE cluster does not have: `values-gke.yaml`
  turns them off. Google Cloud Managed Service for Prometheus
  (`enable_managed_prometheus`) reads `PodMonitoring` objects, which the chart
  does not render, and its query API needs Google credentials, while the
  portal's `PROMETHEUS_URL` expects an unauthenticated PromQL endpoint.
- **Logs and data residency.** See [Logs](#logs). Subnet flow logs, bucket
  versioning and bucket access logs are off by default: they would keep
  participants' IP addresses, or copies of recordings that the portal has
  deleted under its retention rules.
- **Network policies.** Dataplane V2 enforces the chart's NetworkPolicy. With
  the GKE Ingress, traffic reaches the portal pods from Google's front ends
  and health checks (`35.191.0.0/16`, `130.211.0.0/22`), which must be allowed
  with `ipBlock` rules: see the commented block in `values-gke.yaml`. Not
  tested.
- **Shared VPC.** This module creates its own VPC. In a Shared VPC, GKE may
  lack the permission to create load-balancer firewall rules in the host
  project, and container-native load balancing is not the default there
  (`values-gke.yaml` requests it explicitly).
- **Admission webhooks on private nodes.** If the ingress-nginx admission
  webhook times out (`failed calling webhook`), allow TCP 8443 from the
  control plane to the `apps` nodes, as described in GKE's firewall
  documentation, or turn the webhook off. Not observed, since nothing was
  installed.
- **Autopilot is not supported.** The bridge pool needs its own label, taint
  and scale to zero, and the `node_public_ip` topology a host port.

## Destroying

`deletion_protection` is on by default and the buckets have
`force_destroy = false`: `tofu destroy` stops at the cluster and at any bucket
that still holds objects. Set `deletion_protection = false` and apply before
destroying a test environment, and empty the buckets yourself, knowingly.

## Related pages

- [Installing on GKE](../../../docs/install/gke.md): the installation from an
  empty project to a first event.
- [Infrastructure reference](../../../docs/INFRASTRUCTURE.md): sizing,
  networking, network policies and images.
- [Deploying with Helm](../../../docs/DEPLOYMENT.md): profiles, Secrets,
  walkthroughs.
- [Object storage](../../../docs/configuration/storage.md): providers, CORS,
  permissions.
- [Running the JVB scaler](../../../docs/operations/jvb-scaler.md).
