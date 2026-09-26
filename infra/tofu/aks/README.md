# AKS reference infrastructure

This OpenTofu configuration creates the Azure infrastructure for a full-profile
PA Webinar installation on Azure Kubernetes Service (AKS). It creates the
cluster and its node pools, the network rules and fixed public addresses for
media and TURN, and the storage account with its two containers. It then
prints the Helm values that match what it created. The application itself is
installed afterwards with the Helm chart.

It is written for operators who install PA Webinar on Azure and keep the
infrastructure as code. The installation, from an empty subscription to a
first event, is in [Installing on AKS](../../../docs/install/aks.md); choosing
between minikube, k3s and a managed cluster is in
[Installing PA Webinar](../../../docs/install/README.md). The chart itself is
covered in [Deploying with Helm](../../../docs/DEPLOYMENT.md).

**Status.** The topology that this configuration encodes is the one that the
reference installation runs on AKS: one bridge behind a fixed load-balancer
address, coturn on an address of its own, Azure Blob storage with an account
key, ingress-nginx and cert-manager. The configuration itself has been
validated statically and has not been applied to a subscription. See
[What has been verified](#what-has-been-verified).

## What it creates

| Resource | Details | Notes |
|---|---|---|
| Resource group | `<name_prefix>-rg`, or an existing one (`create_resource_group = false`) | The cluster's own node resource group is created by AKS |
| Virtual network | One address space, a subnet for the nodes and a subnet for the bridge nodes | Skipped when you pass existing subnets |
| Network security group | On both subnets, with the inbound rules in [Network rules](#network-rules) | Skipped when you pass existing subnets |
| Public IP addresses | Static, Standard SKU, zone-redundant: ingress, bridge (with `jvb_exposure = "load_balancer"`), TURN (with `turn_enabled`) | Created outside AKS, so they survive the deletion of a Service or of the cluster, and DNS records stay valid |
| Managed identity | User-assigned identity for the AKS control plane, with Network Contributor on the resource group | AKS needs it to attach the subnets and the fixed addresses. See [Known limitations](#known-limitations) |
| AKS cluster | Azure CNI Overlay, Calico network policy, Standard tier, Entra ID with Azure RBAC and local accounts disabled, OIDC issuer and workload identity, weekly maintenance window, autoscaler profile | See [Cluster settings](#cluster-settings) |
| Node pools | `system`, `applications`, `jvb`, and optionally `jibri` and `aigpu` | See [Node pools](#node-pools) |
| Storage account | StorageV2, zone-redundant, HTTPS and TLS 1.2 only, no public containers, CORS for browser uploads, soft delete | See [Storage](#storage) |
| Storage containers | `files` and `recordings`, private | The app's two storage domains |
| Role assignments | Cluster admin and cluster user for the administrators; `AcrPull` for the nodes if you give a registry | |

## What it leaves to you

- **The database.** The full profile expects an external PostgreSQL, such as
  Azure Database for PostgreSQL flexible server, with `DATABASE_URL` in the
  application Secret. Redis runs in the cluster.
- **DNS records.** Three names: the portal and the conference point to the
  ingress address, and the TURN name points to the TURN address.
- **Cluster add-ons**: ingress-nginx, cert-manager with a `ClusterIssuer`,
  Stakater Reloader, and, for AI post-production, the NVIDIA device plugin.
  The commands are below.
- **Secrets**, a Key Vault, a Log Analytics workspace, a container registry,
  backups of the storage account, and the state backend of this configuration.

## Before you start

- **Tools.** OpenTofu 1.8 or later, or Terraform 1.8 or later; the Azure CLI
  and `kubelogin`; `kubectl`; Helm 3 or 4.
- **Permissions.** The configuration creates role assignments, so the identity
  that runs it needs Owner, or Contributor together with Role Based Access
  Control Administrator, on the subscription or on the resource group.
- **Resource providers** registered in the subscription:
  `Microsoft.ContainerService`, `Microsoft.Network`, `Microsoft.Compute`,
  `Microsoft.Storage` and `Microsoft.ManagedIdentity`.
- **vCPU quota** in the region for each machine family you use, at the pools'
  maximum sizes. With the defaults (Dsv5 family): up to 3 × 2 vCPU for the
  system pool, 6 × 4 for the applications pool and 2 × 4 for the bridge pool.
  A GPU pool needs GPU quota: see [AI post-production](../../../docs/POSTPROD.md#provisioning-a-gpu-node-pool).
- **Three hostnames** under a domain you control, for example
  `webinar.example.com`, `meet.webinar.example.com` and
  `turn.webinar.example.com`.
- **A state backend.** The state holds the storage account key. Keep it in a
  remote backend with restricted access and encryption, such as a dedicated
  Azure Storage container; OpenTofu can also encrypt the state itself. Never
  commit it. The `.gitignore` in this folder keeps state, plans,
  `terraform.tfvars`, and any values or key file generated into this folder
  out of the repository.
  `.terraform.lock.hcl` is committed: it pins the provider versions that the
  configuration was validated with, with hashes for Linux, macOS and Windows,
  for OpenTofu's registry.
- **A folder for your installation's files, outside the repository.** The
  generated values carry your public addresses and resource group, and the
  private values carry passwords. The commands below keep them in `$CONF`:

  ```bash
  CONF=~/pa-webinar-conf   # any path outside the repository
  mkdir -p "$CONF" && chmod 700 "$CONF"
  ```

## Install

The commands run from this folder unless stated otherwise, and use the
namespace and release name `pa-webinar`.

### 1. Create the infrastructure

```bash
cp terraform.tfvars.example terraform.tfvars   # set subscription_id and cors_allowed_origins
tofu init
tofu plan -out aks.tfplan
tofu apply aks.tfplan
```

`cors_allowed_origins` must contain the portal's origin
(`https://webinar.example.com`). Without it the plan shows a warning, and
browser uploads to the storage account fail.

The cluster is created after its identity's role assignments. Azure can take a
minute or two to propagate them: if the first apply stops with an
authorization error on the subnet or on a public address, run the plan and
apply again.

### 2. Get cluster access

```bash
$(tofu output -raw get_credentials_command)
kubelogin convert-kubeconfig -l azurecli
kubectl get nodes -L agentpool,workload
```

With local accounts disabled, access goes through Entra ID. The identity that
ran `tofu apply` is cluster administrator unless you listed others in
`cluster_admin_object_ids`. At rest you see the system node and two
application nodes; the bridge pool has no nodes until an event needs one.

### 3. Point DNS at the fixed addresses

```bash
tofu output ingress_public_ip    # portal and conference names
tofu output turn_public_ip       # TURN name
```

### 4. Install the cluster add-ons

```bash
tofu output -raw ingress_nginx_values > "$CONF/ingress-nginx.values.yaml"

helm upgrade --install ingress-nginx ingress-nginx \
  --repo https://kubernetes.github.io/ingress-nginx --version 4.15.1 \
  -n ingress-nginx --create-namespace \
  -f "$CONF/ingress-nginx.values.yaml"

helm upgrade --install cert-manager cert-manager \
  --repo https://charts.jetstack.io --version v1.21.2 \
  -n cert-manager --create-namespace \
  --set crds.enabled=true

helm upgrade --install reloader reloader \
  --repo https://stakater.github.io/stakater-charts --version 2.2.17 \
  -n reloader --create-namespace
```

The versions are the ones these instructions were written against: the
generated ingress-nginx values render with that chart version. Pin the
versions you test, and change them deliberately.

The ingress-nginx values attach its Service to the ingress address, keep the
client's address (`externalTrafficPolicy: Local`) for the portal's per-address
limits, and set the health-probe path that the Azure load balancer needs. The
chart's annotations target ingress-nginx, whose upstream project has been
retired; see [Ingress controllers](../../../docs/INFRASTRUCTURE.md#ingress-controllers).

coturn reads its TLS certificate only when it starts. The subchart annotates
the coturn pods for Reloader, which restarts them when cert-manager renews the
certificate. Without Reloader, coturn keeps the old certificate until
something restarts it, and TURN over TLS fails once that certificate expires.
If you do not install Reloader, restart coturn after each renewal, outside
events:
`kubectl -n pa-webinar rollout restart deployment/pa-webinar-jitsi-meet-coturn`.
cert-manager renews at a time of its choosing, which can fall during an
event. A restart replaces one coturn pod at a time; participants relayed by
the replaced pod lose media until the conference reconnects them.

Create the issuer that the chart's Ingresses name:

```yaml
# letsencrypt-prod.yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: <operator-email>
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
      - http01:
          ingress:
            ingressClassName: nginx
```

```bash
kubectl apply -f letsencrypt-prod.yaml
```

HTTP-01 needs Let's Encrypt to reach TCP 80 on the ingress address and on the
TURN address from the Internet. With `inbound_source_address_prefixes` set,
port 80 is closed to it and no certificate is issued or renewed, for the
portal, the conference or TURN. A restricted installation needs a DNS-01
solver in this issuer, with
`jitsi-meet.coturn.turns.certificate.acmeProxy.enabled: false`, or existing
certificates.

### 5. Create the Secrets

Follow step 1 of the
[standard walkthrough](../../../docs/DEPLOYMENT.md#standard-profile) in the
namespace `pa-webinar`, and add the two storage keys to the application Secret.
Write the connection string, which contains the account key, to a temporary
file outside the repository rather than to the command line, so that it does
not end up in the shell history, in the process list or in a commit:

```bash
kubectl create namespace pa-webinar
conn="$(mktemp)"                 # readable only by you
trap 'rm -f "$conn"' EXIT        # removed when this shell exits
tofu output -raw storage_connection_string > "$conn"
```

Run the walkthrough's `kubectl create secret generic videocall-secrets`
command with these two flags added, then delete the file:

```text
  --from-file=AZURE_STORAGE_CONNECTION_STRING="$conn" \
  --from-file=RECORDING_AZURE_CONNECTION_STRING="$conn" \
```

```bash
rm -f "$conn"
```

Create `videocall-jitsi-jwt` and `videocall-datastore` as in the walkthrough.
In the private overrides file, kept in `$CONF`, pin the conference passwords
as the walkthrough shows, plus the coturn secret:

```yaml
# $CONF/pa-webinar.private.yaml (in addition to the walkthrough's keys)
jitsi-meet:
  coturn:
    staticAuth:
      secret: "<random>"   # openssl rand -hex 32, kept and passed on every upgrade
```

### 6. Install the chart

From the repository root:

```bash
tofu -chdir=infra/tofu/aks output -raw helm_values > "$CONF/aks-infra.values.yaml"

helm upgrade --install pa-webinar ./infra/helm/pa-webinar -n pa-webinar \
  -f infra/helm/pa-webinar/examples/values-full.yaml \
  -f infra/helm/pa-webinar/examples/values-aks.yaml \
  -f "$CONF/aks-infra.values.yaml" \
  -f "$CONF/pa-webinar.values.yaml" \
  -f "$CONF/pa-webinar.private.yaml" \
  --wait --timeout 15m
```

The order matters. `values-aks.yaml` holds the AKS choices, with placeholders
for the values that depend on this infrastructure. `aks-infra.values.yaml`
replaces those placeholders with the real addresses, resource group,
containers and node pools. `pa-webinar.values.yaml` holds your hostnames
(`ingress.hosts`, `jitsi-meet.web.ingress.hosts`, `jitsi-meet.publicURL`,
`jitsi-meet.turnHost`, `app.env.NEXT_PUBLIC_*`), as in
[The values file for your installation](../../../docs/DEPLOYMENT.md#the-values-file-for-your-installation).

### 7. Check

```bash
kubectl -n pa-webinar get svc -o wide   # the bridge and coturn Services show their fixed addresses
kubectl -n pa-webinar get cronjob pa-webinar-jvb-scaler
kubectl -n pa-webinar get certificate
```

Then follow [First-run checks](../../../docs/DEPLOYMENT.md#first-run-checks).
Before the first real event, align the bridge sizing with the pool's machines
(`jvbCpuCoresPerPod` in the site settings): see
[Align the defaults with your bridges](../../../docs/architecture/scaling.md#align-the-defaults-with-your-bridges).

## Node pools

| Pool | Runs | Label and taint | Size |
|---|---|---|---|
| `system` | AKS components only (`CriticalAddonsOnly` taint, `system_pool.critical_addons_only`) | – | `Standard_D2s_v5`, 1 to 3 nodes |
| `applications` | Portal, CronJobs and the bridge scaler, the recorder controller and per-participant recorder bots, Prosody, Jicofo, the Jitsi web frontend, coturn, Redis | None; the chart selects it with `agentpool: applications` | `Standard_D4s_v5`, 2 to 6 nodes |
| `jvb` | Bridges, and Jibri unless it has its own pool | `workload=jitsi-jvb`, taint `workload=jitsi-jvb:NoSchedule` | `Standard_D4s_v5`, 0 to 2 nodes, regular priority |
| `jibri` (optional) | Jibri | `workload=jitsi-jibri`, taint `workload=jitsi-jibri:NoSchedule` | `Standard_D4s_v5`, 0 to 1 node |
| `aigpu` (optional) | AI post-production worker, and a vLLM server that you deploy | `workload=ai-gpu`, `accelerator=nvidia`, taint `workload=ai-gpu:NoSchedule` | `Standard_NC24ads_A100_v4`, 0 to 2 nodes |

The labels and taints are the contract with the chart:
[The JVB pool contract](../../aks/node-pools.md#the-jvb-pool-contract) explains
it, and the `helm_values` output carries the matching node selectors and
tolerations.

How the pools scale: outside events the JVB scaler keeps the bridge Deployment
at zero replicas and the cluster autoscaler removes the bridge nodes. When an
event enters its pre-scale window, the scaler raises the replica count, the
new bridge pod waits `Pending` until the autoscaler adds a node, and the event
opens once the bridge answers. The pre-scale window must cover node
provisioning; see [Scaling the media plane](../../../docs/architecture/scaling.md).
The applications pool grows with the portal's autoscaler and with the
per-participant recorder bots, each of which asks for one CPU. The GPU pool
follows the post-production queue.

**GPU pool.** AKS installs the NVIDIA drivers (`gpu_pool.gpu_driver =
"Install"`). Install the NVIDIA device plugin, or the GPU Operator with its
driver component off; with `gpu_driver = "None"` the GPU Operator installs the
drivers. Everything that must run on the pool tolerates its taints: the
device plugin's (or the GPU Operator's) DaemonSets, the post-production
worker and the vLLM server. The `gpu_tolerations` output lists them:
`workload=ai-gpu` and, with `gpu_pool.spot = true`, AKS's spot taint
`kubernetes.azure.com/scalesetpriority=spot`. The `helm_values` output already
adds them to the worker; add them to the device plugin and to the vLLM
Deployment yourself. A device plugin without the spot toleration never runs on
the spot nodes, so no node advertises `nvidia.com/gpu`: the worker stays
`Pending` while the autoscaler keeps the GPU nodes running. The pipeline's
other requirements are in
[AI post-production](../../../docs/POSTPROD.md#operational-checklist).

## Media: bridges and TURN

`jvb_exposure` chooses how participants reach the bridges over UDP. Read
[The single-IP pitfall](../../../docs/architecture/scaling.md#the-single-ip-pitfall)
before you choose.

| | `load_balancer` (default) | `node_public_ip` |
|---|---|---|
| Address | One fixed public address, created by this configuration, in front of the bridge Service | A public address on every bridge node, optionally from a prefix (`jvb_node_public_ip_prefix_length`) so that the addresses are known in advance |
| Bridges | One: `JVB_MAX_REPLICAS: "1"` | Up to `jvb_pool.max_count`, one per node |
| What the bridge announces | The fixed address (`jitsi-meet.jvb.publicIPs`), with no STUN lookup, and its pod address | Its node's public address, learned from a STUN server (`jvb_stun_servers`), and its pod address |
| Chart keys set by `helm_values` | `useHostPort: false`, a `LoadBalancer` Service with `externalTrafficPolicy: Local` | `useHostPort: true`, no bridge Service |
| Status | Runs in the reference installation | Not yet verified |

In both topologies the bridge also announces its pod address. Participants
cannot reach it, and ICE moves on to the other candidates. In-cluster peers use it: the recorder
bots, Jibri, and coturn when it relays a participant's media. Without it they
would have to reach the public address from the cluster's outbound address,
which the rules of `inbound_source_address_prefixes` do not admit.

With `node_public_ip`, the STUN server must be outside this cluster. A request
from a bridge to an address served by this cluster's own load balancer, such
as the chart's coturn, is redirected inside the cluster by the node's service
proxy, and the answer carries a private address. The default of
`jvb_stun_servers` is the Jitsi project's public server, which is a third
party: record the choice in your privacy notes, or run your own STUN server
elsewhere.

coturn (`turn_enabled`, on by default) relays media for participants whose
networks block UDP. It listens on UDP 3478 and on TCP 443 for TURN over TLS,
on its own fixed address. `values-aks.yaml` runs two replicas, spread over two
nodes when possible; see [Cluster settings](#cluster-settings) for why. Its
certificate is for the TURN name, which points at coturn rather than at the
ingress. `values-aks.yaml` therefore turns on the subchart's ACME proxy, which
forwards the HTTP-01 challenge from coturn's port 80 to ingress-nginx. A
DNS-01 issuer or an existing certificate avoids the proxy. The proxy has not
been verified on AKS. Renewed certificates reach coturn through Reloader
([step 4](#4-install-the-cluster-add-ons)). `allowedPeerIPs` lists the pod
range only, so that coturn can relay to the bridge's pod address. The node
subnets stay denied, as in the subchart: every participant receives TURN
credentials, and no topology announces a node address.

## Network rules

AKS opens the ports of `LoadBalancer` Services in the network security group
that it manages, but not in a group attached to a subnet. The configuration
therefore adds these inbound rules to the group on both subnets:

| Rule | Protocol and ports | Destination | Purpose |
|---|---|---|---|
| `ingress-https` | TCP 80, 443 | The ingress address and the node subnet | Portal and conference; HTTP for certificate validation and the redirect |
| `jvb-media` | UDP 10000 (`jvb_udp_port`) | The bridge address, if any, and the bridge subnet | Media |
| `turn-udp` | UDP 3478 | The TURN address and the node subnet | STUN and TURN |
| `turn-tcp` | TCP 80, 443 | The TURN address and the node subnet | TURN over TLS; port 80 only for the ACME proxy |

There is no TURN over TCP on 3478: the chart's coturn uses UDP transport, and
its Service does not publish TCP 3478.

The source is `Internet`, or the ranges in `inbound_source_address_prefixes`
for an installation reached only from known networks. Azure's default rules
still allow traffic inside the virtual network and the load balancer's health
probes, and deny the rest. Restricting the source also closes port 80 to
Let's Encrypt: see [step 4](#4-install-the-cluster-add-ons) for the
certificates.

When your network team manages the subnets, pass `existing_nodes_subnet_id`
and `existing_jvb_subnet_id`, and set `nodes_subnet_prefix` and
`jvb_subnet_prefix` to their address prefixes. The configuration then creates
no network and no security group; the `required_inbound_rules` output lists
the rules to add, with those prefixes as destinations, and the control-plane
identity gets Network Contributor on both subnets.

## Storage

One storage account holds both of the app's storage domains
([Object storage](../../../docs/configuration/storage.md)): the `files`
container (`AZURE_STORAGE_CONTAINER_NAME`) and the `recordings` container
(`RECORDING_AZURE_CONTAINER`). The `storage_connection_string` output is the
value of both `AZURE_STORAGE_CONNECTION_STRING` and
`RECORDING_AZURE_CONNECTION_STRING`.

- **Private containers, public endpoint.** No container can be read without a
  signature. The account accepts connections from anywhere, because
  participants play recordings and staff upload videos straight to it through
  signed URLs.
- **CORS** allows `PUT` from `cors_allowed_origins`, with the `x-ms-*` and
  `Content-Type` headers that the browser uploads send.
- **Soft delete** keeps a deleted object recoverable for `blob_soft_delete_days`
  (7 by default). That extends how long recordings and materials exist after
  the app deletes them: state it in your privacy notice, or set `0`.
  Versioning is off, so no earlier version survives a deletion.
- **Replication** is zone-redundant (`storage_replication_type = "ZRS"`) and
  keeps the data in the region; use `LRS` where ZRS is not offered.
- **Key rotation.** Regenerate the account key in Azure, update both keys in
  the application Secret, and restart the portal
  (`kubectl -n pa-webinar rollout restart deployment/pa-webinar`). Signed URLs
  issued with the old key stop working.

## Cluster settings

| Setting | Default | Variable |
|---|---|---|
| Kubernetes version | AKS default; patch versions follow the upgrade channel | `kubernetes_version`, `automatic_upgrade_channel` (`patch`) |
| Node image upgrades | Weekly | `node_os_upgrade_channel` (`NodeImage`) |
| Maintenance window | Sunday 01:00 UTC, 4 hours, for both | `maintenance_window` |
| Control-plane tier | Standard, with an SLA | `sku_tier` |
| Access | Entra ID and Azure RBAC, local accounts disabled | `cluster_admin_object_ids`, `local_account_disabled` |
| API server network access | Unrestricted | `api_server_authorized_ip_ranges` |
| Network policy engine | Calico | `network_policy` |
| Container Insights | Off | `log_analytics_workspace_id` |
| Autoscaler | An emptied node is removed after 10 minutes; no removal within 10 minutes of a scale-up | `cluster.tf` |

An upgrade drains nodes, bridges included, so the maintenance window must fall
outside your events. `values-aks.yaml` marks bridge and Jibri pods as not safe
to evict, so that the autoscaler does not move them to consolidate nodes.

coturn runs two replicas in `values-aks.yaml`. The chart gives coturn a
disruption budget (`coturnPodDisruptionBudget`, at least one pod available).
With a single replica the budget allows no eviction: the drain of every
automatic upgrade, the weekly node-image one included, waits for coturn until
it times out, the upgrade fails, and the node that runs coturn is never
patched; the cluster autoscaler cannot remove that node either. With two
replicas the drain moves one pod at a time, and the Azure load balancer keeps
each client's flow on the same pod. Participants relayed by the moved pod lose
media until the conference reconnects them, which is one more reason to keep
the window outside events. If you run a single replica, set
`coturnPodDisruptionBudget.maxUnavailable: 1` instead, and accept that a drain
interrupts TURN.

## Main variables

All variables, with their descriptions, are in `variables.tf`.

| Variable | Default | Meaning |
|---|---|---|
| `subscription_id` | required | Target subscription |
| `location` | `italynorth` | Region |
| `name_prefix` | `pa-webinar` | Prefix of every resource name |
| `create_resource_group`, `resource_group_name` | `true`, `<name_prefix>-rg` | Create the resource group, or use an existing one |
| `zones` | `["1", "2", "3"]` | Availability zones; `[]` in regions without zones |
| `cors_allowed_origins` | `[]` | The portal's origin; needed for browser uploads |
| `jvb_exposure` | `load_balancer` | Bridge topology |
| `turn_enabled` | `true` | coturn's address and rules |
| `system_pool`, `apps_pool`, `jvb_pool` | see [Node pools](#node-pools) | Machine sizes and limits |
| `jibri_pool`, `gpu_pool` | disabled | Optional pools |
| `existing_nodes_subnet_id`, `existing_jvb_subnet_id` | `null` | Use subnets you already have |
| `vnet_address_space`, `nodes_subnet_prefix`, `jvb_subnet_prefix`, `pod_cidr`, `service_cidr` | `10.224.0.0/16`, `10.224.0.0/20`, `10.224.16.0/24`, `10.244.0.0/16`, `10.0.0.0/16` | Address plan; the pod and service ranges must not overlap networks you peer with |
| `storage_account_name` | derived from `name_prefix` with a random suffix | Globally unique name |
| `blob_soft_delete_days` | `7` | Soft delete of objects and containers |

## Outputs

| Output | Use |
|---|---|
| `helm_values` | YAML for the chart, passed after `examples/values-aks.yaml` |
| `ingress_nginx_values` | YAML for the ingress-nginx chart |
| `storage_connection_string` | Sensitive: both storage keys of the application Secret |
| `ingress_public_ip`, `turn_public_ip`, `jvb_public_ip`, `jvb_node_public_ip_prefix` | DNS records and allow-lists for participants' firewalls |
| `get_credentials_command`, `cluster_name`, `resource_group_name`, `node_resource_group`, `oidc_issuer_url` | Cluster access and workload identity |
| `storage_account_name`, `storage_blob_endpoint`, `files_container_name`, `recordings_container_name` | Storage |
| `node_pools`, `coturn_allowed_peer_ips` | The labels, taints and relay range that `helm_values` uses |
| `gpu_tolerations` | The tolerations for the GPU pool: the device plugin, the worker and vLLM |
| `required_inbound_rules` | With existing subnets: the rules to add to their security group |

## What has been verified

| Check | Result |
|---|---|
| `tofu validate` with OpenTofu 1.11 and azurerm 5.7; `terraform validate` with Terraform 1.16 | Valid |
| `tofu test` and `terraform test` (`tests/module.tftest.hcl`), with mocked providers: both topologies, existing subnets, GPU spot pool, Jibri pool, and the two input errors the configuration rejects | Pass. No Azure access needed |
| `trivy config` on this folder | No open findings. The accepted ones are annotated in `cluster.tf` and `storage.tf` with their reasons |
| `helm template` of `values-full.yaml`, `values-aks.yaml` and the `helm_values` of each topology, run by hand | Renders; bridge and coturn Services carry the fixed-address annotations, placement matches the pools, coturn has two replicas and a disruption budget that allows one eviction |
| `scripts/validate-chart.sh` | Passes, but has no AKS profile: it renders `values-full.yaml` alone, so it does not cover the layering above |
| `helm template` of the add-on charts at the versions in [step 4](#4-install-the-cluster-add-ons), ingress-nginx with the `ingress_nginx_values` output | Renders; the ingress-nginx Service carries the address and health-probe annotations. Not installed on AKS |
| `tofu apply` against a subscription | Not done |
| The `node_public_ip` topology, the Jibri pool, the GPU pool created from here, the ACME proxy for the TURN certificate | Not verified |

To run the tests: `tofu init -backend=false && tofu test`.

## Known limitations

- **Storage needs the account key.** The app signs every URL with the account
  key from the connection string. Managed identities and workload identity are
  not supported for storage, so a tenant whose policy disables shared-key
  access cannot use this storage account. Workload identity is enabled on the
  cluster for other components. National Azure clouds are not supported either
  ([Azure Blob Storage](../../../docs/configuration/storage.md#azure-blob-storage)).
- **Network Contributor on the resource group.** The control-plane identity
  needs it to attach the fixed addresses, because AKS lists the addresses of
  the group before using one. In a resource group shared with other resources,
  the cluster can change their network resources too: prefer a dedicated
  group.
- **One bridge with the default topology.** A chart upgrade that changes the
  bridge pod rolls the Deployment, and for a moment two bridges answer on the
  same address. Apply such upgrades outside events.
- **ingress-nginx** has been retired upstream. The chart's defaults still
  target it.
- **Restricted sources and certificates.** With
  `inbound_source_address_prefixes`, Let's Encrypt's HTTP-01 validation cannot
  reach port 80; use DNS-01 or existing certificates.
- **Not included**: the database, DNS records, a Key Vault or External Secrets
  setup, monitoring, backups.
- **Destroying** the configuration deletes the storage account with every
  recording, and releases the fixed addresses: DNS records and participants'
  allow-lists then point nowhere.

## Related pages

- [AKS reference node pools](../../aks/node-pools.md): the pool contract and
  how to add the bridge pool to an existing cluster.
- [Installing on AKS](../../../docs/install/aks.md): the installation from an
  empty subscription to a first event.
- [Infrastructure reference](../../../docs/INFRASTRUCTURE.md): sizing,
  networking, network policies and images.
- [Deploying with Helm](../../../docs/DEPLOYMENT.md): Secrets, profiles and the
  chart's keys.
- [Scaling the media plane](../../../docs/architecture/scaling.md) and
  [Running the JVB scaler](../../../docs/operations/jvb-scaler.md).
- [Object storage](../../../docs/configuration/storage.md).
- [AI post-production](../../../docs/POSTPROD.md).
