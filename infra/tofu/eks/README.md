# PA Webinar on Amazon EKS: reference infrastructure

This OpenTofu root module creates the AWS side of a PA Webinar installation on
Amazon Elastic Kubernetes Service (EKS). The Helm values that go with it are in
[`infra/helm/pa-webinar/examples/values-eks.yaml`](../../helm/pa-webinar/examples/values-eks.yaml).

**Status: not yet verified on AWS.** The module has been checked offline only:
`tofu validate`, `tofu test` with mocked providers (both bridge topologies and
the input checks), `trivy config`, and `helm template` of the chart with the
values the module generates. It has not been applied to any AWS account, and
nothing below has been measured on EKS. The chart itself was exercised on AKS,
minikube and k3s ([What has been exercised](../../../docs/install/README.md#what-has-been-exercised-and-what-is-only-validated)).

## What the module creates

| Area | Resources | Notes |
|---|---|---|
| Network | VPC, public and private subnets in two or three zones, internet gateway, NAT gateway (one, or one per zone), S3 gateway endpoint | Nodes live in private subnets, except the bridge nodes with `jvb_exposure = "node-public-ip"`. Subnets carry the tags that AWS Load Balancer Controller uses to find them |
| Cluster | EKS control plane with API access entries, Secrets encrypted with a dedicated KMS key, control-plane logs in CloudWatch with a retention period | `bootstrap_self_managed_addons = false`: VPC CNI, kube-proxy, CoreDNS and the Pod Identity agent are EKS add-ons managed here |
| Add-ons | `vpc-cni` (with NetworkPolicy enforcement), `kube-proxy`, `coredns`, `eks-pod-identity-agent`, `aws-ebs-csi-driver`, `metrics-server` | metrics-server feeds the portal's HorizontalPodAutoscaler |
| Storage class | `gp3`, marked default, encrypted, `WaitForFirstConsumer` | EKS clusters created on Kubernetes 1.30 or later have no default StorageClass; without one the in-cluster PostgreSQL volume stays `Pending` |
| Node groups | `applications` (always on), `jvb` (from zero), optional `jibri` and `gpu` (from zero) | Managed node groups on the cluster's Kubernetes version, AL2023 AMIs, encrypted gp3 root volumes. IMDSv2 required with a hop limit of 1, so pods cannot reach the instance metadata service or the node role's credentials. Labels and taints below |
| Media addresses | An Elastic IP for the bridge's UDP load balancer; with `turn_enabled`, a second one for coturn | The load balancers themselves are created later by AWS Load Balancer Controller, from the chart's Services |
| Security groups | The bridge's UDP port (`jvb_udp_port`, 10000 by default) to bridge nodes, TCP 80 and 443 to application nodes, and with `turn_enabled` UDP 3478 and TCP 443 for coturn | Added next to the cluster security group, which stays on every node. Behind a load balancer they are a second layer ([Who can reach the load balancers](#who-can-reach-the-load-balancers)) |
| Object storage | One private S3 bucket (SSE-KMS with its own key, public access blocked, TLS only, CORS for browser uploads, lifecycle rule for abandoned multipart uploads), an IAM user with an access key | Both portal storage domains share the bucket; their key prefixes do not overlap |
| Controller identities | IAM roles bound with EKS Pod Identity to `kube-system/cluster-autoscaler`, `kube-system/aws-load-balancer-controller`, the EBS CSI controller, and optionally `cert-manager/cert-manager` for Route 53 DNS-01 | The controllers themselves are installed with Helm (step 4) |

Node groups, as the chart expects them:

| Group | Label | Taint | Size | Runs |
|---|---|---|---|---|
| `applications` | `workload=applications` | none | `app_min_size` to `app_max_size` | Portal, scheduled jobs, JVB scaler, Prosody, Jicofo, Jitsi web, in-cluster PostgreSQL and Redis, the controllers |
| `jvb` | `workload=jitsi-jvb` | `workload=jitsi-jvb:NoSchedule` | 0 to `jvb_max_size` | One bridge per node |
| `jibri` | `workload=jitsi-jibri` | `workload=jitsi-jibri:NoSchedule` | 0 to `jibri_max_size` | Jibri, if you enable it |
| `gpu` | `workload=ai-gpu`, `accelerator=nvidia`, `nvidia.com/gpu.present=true`, `k8s.amazonaws.com/accelerator=<gpu_accelerator_type>` | `workload=ai-gpu:NoSchedule` | 0 to `gpu_max_size` | The AI post-production worker (`postprod.worker` defaults). The last two labels are for the NVIDIA device plugin and Cluster Autoscaler ([Optional pools](#optional-pools)) |

The label `workload` is set by the module on purpose. The managed-node-group
label `eks.amazonaws.com/nodegroup` does not exist on Karpenter or
self-managed nodes, so the chart values select on `workload` instead.

## What you still install or decide

- In the cluster: AWS Load Balancer Controller, Cluster Autoscaler,
  ingress-nginx and cert-manager (step 4), with `gpu_enabled` the NVIDIA device
  plugin ([Optional pools](#optional-pools)), then the chart.
- DNS records (step 5). The module manages no Route 53 records.
- For production, a managed database: Amazon RDS for PostgreSQL instead of the
  in-cluster PostgreSQL that `values-eks.yaml` enables. Not created here.
- Backups of the database. The project has no backup procedure yet.
- A registry for the images if you do not want pull secrets (Amazon ECR: the
  node role can already pull from ECR in the account).

## Requirements

- OpenTofu 1.8 or later. The module also validates and passes its tests with
  Terraform. `.terraform.lock.hcl` pins the provider versions for OpenTofu's
  registry, with hashes for Linux, macOS and Windows.
- AWS credentials allowed to create VPC, EC2, EKS, IAM, KMS, S3 and CloudWatch
  Logs resources, and the service quotas for the instance types you choose.
- The AWS CLI (for the kubeconfig), `kubectl` and Helm, on a machine inside
  `cluster_endpoint_public_access_cidrs`.
- A region you have enabled. Milan (`eu-south-1`) is opt-in: enable it in the
  account first, and check that it offers the instance types you set.

## Choose how browsers reach the bridge

A participant's browser sends media to the address that the bridge
advertises, over UDP. That address must lead to that bridge and to no other
([The single-IP pitfall](../../../docs/architecture/scaling.md#the-single-ip-pitfall)).

| `jvb_exposure` | How | Bridges | Status |
|---|---|---|---|
| `nlb` (default) | One bridge behind a Network Load Balancer with a UDP listener and a fixed Elastic IP. The bridge advertises the Elastic IP (`publicIPs`); no STUN lookup. Bridge nodes stay private, in the zone of the load balancer's subnet | One (`JVB_MAX_REPLICAS=1`) | The topology exercised on AKS; on EKS not yet verified |
| `node-public-ip` | Bridge nodes in the public subnets, each with its own public IPv4 and the bridge's UDP port open to them; the bridge keeps the host port and learns its public address through STUN | Up to `jvb_max_size` | Not yet verified on any cloud |

With `node-public-ip`, EC2 instances do not carry their public address on the
network interface, so the bridge cannot advertise its node address. It needs a
STUN server (your own, or the chart's coturn with `useInternalStun`); the
values are in the commented block of `values-eks.yaml`.

## Who can reach the load balancers

`public_ingress_cidrs` (everyone by default) says where participants may
connect from. Narrow it only for an installation used inside your own network.

AWS Load Balancer Controller gives each Network Load Balancer its own
security group. That group admits the Service's source ranges
(`spec.loadBalancerSourceRanges`, or the annotation
`service.beta.kubernetes.io/load-balancer-source-ranges`), and everyone when
none are set. The controller then opens the cluster security group, which
every node carries, to traffic from the load balancer. The load balancer's
group therefore decides who gets through. The module's rules on the node
security groups are only a second layer: narrowing `public_ingress_cidrs`
does not restrict a load balancer on its own.

- Bridge and TURN: the module writes `public_ingress_cidrs` into the
  source-ranges annotation of both Services, through `pa-webinar.eks-infra.yaml`
  (step 7).
- Portal and conference: set `controller.service.loadBalancerSourceRanges` in
  `ingress-nginx.values.yaml` (step 4) to the same list.
- Bridges with `node-public-ip` have no load balancer: there the node rule is
  the only filter.

## Steps

### 1. Configure

```bash
cd infra/tofu/eks
cp terraform.tfvars.example terraform.tfvars   # ignored by git
```

Fill in `region`, `cluster_version` (a minor version in standard support),
`cluster_endpoint_public_access_cidrs` (your administration network, never
`0.0.0.0/0`), `cluster_admin_principal_arns` and `portal_origins` (the
portal's `https://` origin, used for the bucket's CORS rule).

The default bucket name is `<name>-media-<account>-<region>`, and S3 accepts at
most 63 characters. With a long `name` the plan stops and asks for a shorter
`s3_bucket_name`.

The state contains the storage user's secret key. Keep it in an encrypted
remote backend (an S3 backend example is in `versions.tf`), and consider
OpenTofu's state encryption.

### 2. Apply

```bash
tofu init
tofu plan -out=eks.tfplan
tofu apply eks.tfplan
```

The first apply also creates the `gp3` StorageClass through the Kubernetes
API, so the machine running it must reach the cluster endpoint. If it cannot,
set `create_default_storage_class = false` and apply this manifest yourself:

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: gp3
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: ebs.csi.aws.com
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
parameters:
  type: gp3
  encrypted: "true"
  csi.storage.k8s.io/fstype: ext4
```

### 3. Connect

Steps 3 to 6 run from `infra/tofu/eks`, where `tofu output` reads the state.

```bash
$(tofu output -raw update_kubeconfig_command)
kubectl get nodes -L workload
```

Two `applications` nodes are expected. The other groups have no nodes until a
pod asks for them.

### 4. Install the cluster controllers

The IAM roles already exist; each controller must use the ServiceAccount name
the role is bound to. The controllers land on the `applications` nodes, the
only ones without a taint.

Pods cannot reach the instance metadata service (hop limit 1), so no
controller can discover its region there: each one gets it from its settings,
as in the commands below. Anything else you install that calls AWS APIs needs
the same: the region in its settings or `AWS_REGION`, and its own Pod Identity
role.

Each chart is pinned to the version this README was checked against. When you
change the Kubernetes minor version, check each chart's release notes and
bump the pins together
([Kubernetes upgrades](#kubernetes-upgrades)).

**AWS Load Balancer Controller.** It creates the Network Load Balancers for
ingress-nginx, the bridge and coturn. The Kubernetes built-in controller would
create a Classic Load Balancer, which carries no UDP.
`policies/aws-load-balancer-controller.json` is the IAM policy published by
the controller project (`docs/install/iam_policy.json`, Apache-2.0) for
release v3.5.0: install the matching chart version, and replace the file
whenever you upgrade the controller.

```bash
helm upgrade --install aws-load-balancer-controller aws-load-balancer-controller \
  --repo https://aws.github.io/eks-charts --version 3.5.0 -n kube-system \
  --set clusterName="$(tofu output -raw cluster_name)" \
  --set region="$(tofu output -raw region)" \
  --set vpcId="$(tofu output -raw vpc_id)" \
  --set serviceAccount.name=aws-load-balancer-controller
```

**Cluster Autoscaler.** It adds a bridge node when the JVB scaler starts a
bridge, and removes it when the bridge is gone. The node groups carry
`k8s.io/cluster-autoscaler/node-template/*` tags, so a group at zero nodes
still advertises its labels and taints. The chart version does not follow
Kubernetes, but the image does: set `image.tag` to the Cluster Autoscaler
release for the cluster's minor version.

```bash
helm upgrade --install cluster-autoscaler cluster-autoscaler \
  --repo https://kubernetes.github.io/autoscaler --version 9.59.0 -n kube-system \
  --set autoDiscovery.clusterName="$(tofu output -raw cluster_name)" \
  --set awsRegion="$(tofu output -raw region)" \
  --set rbac.serviceAccount.name=cluster-autoscaler \
  --set extraArgs.balance-similar-node-groups=true \
  --set extraArgs.expander=least-waste \
  --set image.tag=v1.NN.P   # the release for the cluster's minor version 1.NN
```

**ingress-nginx** behind a Network Load Balancer that preserves the client's
address. The portal's per-IP limits, and the ingress rate limits of the full
profile, count per client address. Without `preserve_client_ip` every
participant arrives from a few load-balancer addresses and shares one limit.

```yaml
# ingress-nginx.values.yaml
controller:
  replicaCount: 2
  service:
    type: LoadBalancer
    loadBalancerClass: service.k8s.aws/nlb
    # Who may reach the portal: the same list as public_ingress_cidrs.
    # Empty means everyone (0.0.0.0/0).
    loadBalancerSourceRanges: []
    annotations:
      service.beta.kubernetes.io/aws-load-balancer-scheme: internet-facing
      service.beta.kubernetes.io/aws-load-balancer-nlb-target-type: ip
      service.beta.kubernetes.io/aws-load-balancer-target-group-attributes: preserve_client_ip.enabled=true
```

```bash
helm upgrade --install ingress-nginx ingress-nginx \
  --repo https://kubernetes.github.io/ingress-nginx --version 4.15.1 \
  -n ingress-nginx --create-namespace -f ingress-nginx.values.yaml
```

ingress-nginx is the chart's default controller, and its upstream project has
announced its retirement ([Ingress controllers](../../../docs/INFRASTRUCTURE.md#ingress-controllers)).
The alternative on EKS is an Application Load Balancer (class `alb`): the chart
drops the ingress-nginx annotations for that class by itself, and you add the
`alb.ingress.kubernetes.io/*` ones, an ACM certificate (cert-manager does not
issue for an ALB), a shared `group.name` for the two Ingresses and
`idle_timeout.timeout_seconds=3600`. An ALB carries no UDP: the bridge and TURN
still need their Network Load Balancers. Not yet verified.

**cert-manager** and the ClusterIssuer the chart expects (`letsencrypt-prod`,
HTTP-01 through ingress-nginx):

```bash
helm upgrade --install cert-manager cert-manager \
  --repo https://charts.jetstack.io --version v1.21.2 \
  -n cert-manager --create-namespace \
  --set crds.enabled=true
```

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: <operations-mailbox>
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
      - http01:
          ingress:
            ingressClassName: nginx
```

With `turn_enabled`, the TURN name points at coturn's load balancer, not at the
ingress, so HTTP-01 cannot validate it. Set `cert_manager_route53_zone_ids` to
your zone (the module then binds a Route 53 role to cert-manager's
ServiceAccount) and add a DNS-01 issuer:

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-dns01
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: <operations-mailbox>
    privateKeySecretRef:
      name: letsencrypt-dns01
    solvers:
      - dns01:
          route53:
            region: <region>
            hostedZoneID: <zone-id>
```

### 5. DNS

```bash
kubectl -n ingress-nginx get svc ingress-nginx-controller \
  -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
```

- `webinar.example.com` and `meet.webinar.example.com`: CNAME to that hostname.
- With `turn_enabled`, `turn.webinar.example.com`: an A record to
  `tofu output -raw turn_public_ip`.
- In the firewalls of the participants' networks, if they filter outbound
  traffic: the bridge's UDP port (`jvb_udp_port`, 10000 by default) to
  `tofu output -raw jvb_public_ip`.

### 6. Namespace and Secrets

```bash
kubectl create namespace pa-webinar
# Pods behind the controller's target groups become Ready only once the load
# balancer sees them healthy: a rolling update of the bridge then waits for
# the new target. Not yet verified with the bridge.
kubectl label namespace pa-webinar elbv2.k8s.aws/pod-readiness-gate-inject=enabled
```

Create the Secrets of the standard profile
([DEPLOYMENT.md, "Standard profile"](../../../docs/DEPLOYMENT.md#standard-profile)),
with these differences:

- `videocall-datastore` also holds `POSTGRES_PASSWORD` and
  `POSTGRES_ADMIN_PASSWORD`, because `values-eks.yaml` runs PostgreSQL in the
  cluster, and `DATABASE_URL` in `videocall-secrets` points at it:
  `postgresql://eventi:<POSTGRES_PASSWORD>@pa-webinar-postgresql.pa-webinar.svc.cluster.local:5432/pa_webinar`.
- `videocall-secrets` also holds the storage keys. Add these options to its
  `kubectl create secret generic` command, which reads them from the state
  without printing them:

  ```text
  --from-literal=STORAGE_FILES_S3_ACCESS_KEY_ID="$(tofu output -raw s3_access_key_id)"
  --from-literal=STORAGE_FILES_S3_SECRET_ACCESS_KEY="$(tofu output -raw s3_secret_access_key)"
  --from-literal=RECORDING_S3_ACCESS_KEY_ID="$(tofu output -raw s3_access_key_id)"
  --from-literal=RECORDING_S3_SECRET_ACCESS_KEY="$(tofu output -raw s3_secret_access_key)"
  ```

- `ghcr-secret`, a `docker-registry` Secret for the portal images, as long as
  the registry requires credentials to pull
  ([Images](../../../docs/INFRASTRUCTURE.md#images)). Or copy the images into
  ECR and empty `app.imagePullSecrets`.

### 7. Install the chart

From the repository root:

```bash
tofu -chdir=infra/tofu/eks output -raw helm_values > pa-webinar.eks-infra.yaml
helm upgrade --install pa-webinar ./infra/helm/pa-webinar -n pa-webinar \
  -f infra/helm/pa-webinar/examples/values-full.yaml \
  -f infra/helm/pa-webinar/examples/values-eks.yaml \
  -f pa-webinar.eks-infra.yaml \
  -f pa-webinar.values.yaml \
  -f pa-webinar.private.yaml \
  --wait --timeout 15m
```

The three files after the two examples:

- `pa-webinar.eks-infra.yaml` holds what depends on this module, and no
  secret: bucket and region, the bridge's UDP port, Elastic IP and subnet,
  `JVB_MAX_REPLICAS`, the load balancers' source ranges, and with
  `turn_enabled` coturn's address and `allowedPeerIPs`.
- `pa-webinar.values.yaml` is the values file for your installation, as in
  [DEPLOYMENT.md, "The values file for your installation"](../../../docs/DEPLOYMENT.md#the-values-file-for-your-installation).
  It holds both image tags (`app.image.tag: "<version>"`, and
  `app.migration.image.tag: "v<version>-migrate"` with the leading `v`), the
  two DNS names and the Ingress hosts. Neither example sets the tags. Without
  them the chart derives a migration tag that not every release publishes, and
  the portal pods stay in `Init:ImagePullBackOff` until `--wait` times out.
- `pa-webinar.private.yaml`, kept out of the repository, holds the pinned
  conference credentials (see the header of `values-eks.yaml` and
  [Pin the conference's internal credentials](../../../docs/DEPLOYMENT.md#pin-the-conferences-internal-credentials)):
  the XMPP passwords of Jicofo and the bridge, and with TURN coturn's shared
  secret `jitsi-meet.coturn.staticAuth.secret` (or `staticAuth.existingSecretName`,
  key `TURN_CREDENTIALS`). `values-eks.yaml` sets
  `jitsi.requirePinnedCredentials`, so the render stops while one is missing.

### 8. Check

- [ ] `kubectl get nodes -L workload` shows the `applications` nodes, and no
      bridge node outside events.
- [ ] `kubectl -n pa-webinar get pvc` shows the PostgreSQL volume `Bound` on
      `gp3`.
- [ ] `kubectl -n pa-webinar get svc pa-webinar-jitsi-meet-jvb` shows a
      load-balancer hostname, and `dig +short` of that hostname returns
      `tofu output -raw jvb_public_ip`.
- [ ] `https://webinar.example.com` answers with a valid certificate, and the
      status page reports the conference as reachable.
- [ ] Before the first real event, start a test event: the JVB scaler sets
      the bridge to one replica, a `jvb` node joins, the bridge pod becomes
      Ready, and its log shows
      `StaticMapping(localAddress=<pod-ip>, publicAddress=<jvb-public-ip>)`.
      Join from a network outside the VPC and check that audio and video flow.
- [ ] Upload a video from the administration area: it exercises the bucket's
      CORS rule, the multipart permissions and the KMS key.

## How scaling works here

1. Before an event the JVB scaler (a CronJob) sets the bridge Deployment to one
   replica ([JVB scaler](../../../docs/operations/jvb-scaler.md)).
2. The pod is `Pending` on the tainted `jvb` group. Cluster Autoscaler reads
   the group's template tags, sees that a new node would fit, and raises the
   group from zero.
3. The node joins, the bridge starts, and AWS Load Balancer Controller
   registers the pod as the target of the UDP load balancer, health-checked
   on the bridge's `/about/health` (port 8080).
4. After the event the scaler sets the replicas back to zero. Cluster
   Autoscaler removes the empty node after its scale-down delay
   (`scale-down-unneeded-time`, ten minutes by default). The bridge
   pods carry `cluster-autoscaler.kubernetes.io/safe-to-evict: "false"` and
   `karpenter.sh/do-not-disrupt: "true"`, so no autoscaler removes a node
   with a bridge on it.

Node start, image pull and target registration add minutes before a bridge
takes traffic. None of these delays were measured on EKS. The site setting
**Pre-scale lead time (minutes)** (`jvbPreScaleMinutes`) must cover them:
measure the chain with a test event and size it as described in
[Lead time and cold start](../../../docs/operations/jvb-scaler.md#lead-time-and-cold-start).

The portal scales on CPU and memory with its HorizontalPodAutoscaler, fed by
metrics-server, and Cluster Autoscaler grows the `applications` group up to
`app_max_size`.

### Karpenter instead of Cluster Autoscaler

The module does not install Karpenter. To use it for the bridge and GPU
nodes, replace those managed node groups with Karpenter NodePools that set the
same labels and taints, a consolidation policy of `WhenEmpty` for the bridge
pool, and an EC2NodeClass that selects the private subnets (the public ones,
with public IPv4 addresses, for `node-public-ip`) and the module's `jvb`
security group next to the cluster security group. The bridge pods already
carry `karpenter.sh/do-not-disrupt`. EKS Auto Mode manages Karpenter for you,
but does not allow custom AMIs, which Jibri may need (see below).

## Kubernetes upgrades

The node groups follow the control plane's version. Upgrade one minor version
at a time, outside events: a node group upgrade replaces its nodes, and a
bridge on a replaced node ends its conferences.

1. Raise `cluster_version` by one minor version and run `tofu plan` and
   `tofu apply`. EKS upgrades the control plane first, then each node group,
   one node at a time. A group at zero nodes only changes the version its
   next node starts with.
2. Add-ons whose version is not pinned stay on the version already
   installed. For each one, set in `addon_versions` the default version for
   the new minor:
   `aws eks describe-addon-versions --kubernetes-version 1.NN --addon-name <add-on> --query 'addons[].addonVersions[?compatibilities[?defaultVersion]].addonVersion' --output text`.
   Then apply again.
3. Set Cluster Autoscaler's `image.tag` to the release for the new minor.
   Check the pinned chart versions of step 4 and the NVIDIA device plugin
   against their release notes.

With `cluster_support_type = "STANDARD"`, EKS upgrades the control plane on
its own when standard support for its version ends. The node groups do not
move with it, and the next plan tries to set the old version back, which EKS
refuses. Set `cluster_version` to the version the cluster reports
(`aws eks describe-cluster --name <cluster> --query cluster.version`), then
apply: the node groups follow. Then continue from step 2.

## Object storage

- **Static keys only.** The portal builds its S3 client from an access key
  pair (`STORAGE_FILES_S3_*` and `RECORDING_S3_*`); without one the storage
  domain is disabled. IAM roles for service accounts (IRSA) and EKS Pod
  Identity are not supported by the application yet, so the module creates an
  IAM user limited to the bucket and its KMS key.
- **Rotating the key**: create a second key for the user (in the console, or
  add an `aws_iam_access_key`), update the Secret, restart the portal
  (`kubectl -n pa-webinar rollout restart deploy/pa-webinar`), then delete the
  old key.
- **No versioning**, on purpose: the portal deletes recordings and personal
  data when retention expires, and a versioned bucket would keep a
  noncurrent copy that no process removes.
- **Encryption**: SSE-KMS with the module's key and S3 Bucket Keys. The IAM
  user may use the key, which the URLs it signs for browsers, Jibri, the
  recorder bot and the AI worker need. If a policy of your organization
  forbids KMS on this bucket, switch the encryption rule to `AES256` and drop
  the key statement from the user's policy.
- **Traffic**: pods reach S3 through the gateway endpoint, not the NAT
  gateway. Browsers reach it on `https://<bucket>.s3.<region>.amazonaws.com`,
  which the portal's Content Security Policy allows for S3 without a custom
  endpoint.

Details of the storage settings are in
[Object storage](../../../docs/configuration/storage.md).

## Optional pools

**Jibri.** Jibri needs the `snd-aloop` kernel module on its node. Whether the
Amazon Linux 2023 EKS AMI provides it (for example through its
`kernel-modules-extra` package) has not been checked. If `modprobe snd-aloop`
fails on a `jibri` node, you need a custom AMI that has it. Jibri's upload
script also has to be mounted by hand
([Recording setup](../../../docs/operations/recording-setup.md)). The
per-participant recorder bot needs neither.

**GPU.** The `gpu` group uses the AL2023 NVIDIA AMI, which ships the drivers.
Install the NVIDIA device plugin, not the GPU Operator's driver. Without the
plugin the node never offers `nvidia.com/gpu`. The worker then stays
`Pending`, and Cluster Autoscaler keeps starting and removing a GPU node that
is billed each time. The plugin's chart selects nodes labelled
`nvidia.com/gpu.present=true`, which the module sets, but it does not tolerate
the pool's taint. Add the toleration:

```yaml
# nvidia-device-plugin.values.yaml
tolerations:
  - key: nvidia.com/gpu
    operator: Exists
    effect: NoSchedule
  - key: workload
    operator: Equal
    value: ai-gpu
    effect: NoSchedule
```

```bash
helm upgrade --install nvidia-device-plugin nvidia-device-plugin \
  --repo https://nvidia.github.io/k8s-device-plugin --version 0.20.1 \
  -n nvidia-device-plugin --create-namespace -f nvidia-device-plugin.values.yaml
```

The label `k8s.amazonaws.com/accelerator` (from `gpu_accelerator_type`, set it
to the GPU of `gpu_instance_types`) tells Cluster Autoscaler that a new node
is a GPU node, so it waits for the plugin instead of adding another one.
Once a GPU node has started, check that the plugin pod runs on it and that
`kubectl describe node` lists `nvidia.com/gpu: 1` under Allocatable. This has
not been verified on EKS, and no GPU was started for these checks.

The worker requests 8 CPU and 32 GiB, so the instance must offer more than
that allocatable. A 24 GB GPU (the `g5` default) covers transcription and
diarization; the default summary and translation model needs a larger GPU
([AI post-production](../../../docs/POSTPROD.md)). Check which GPU instance
types your region offers.

## Costs to plan for

Billed while the module's resources exist, whatever the traffic: the EKS
control plane, the `applications` nodes, NAT gateways, public IPv4 addresses
(Elastic IPs, NAT, load balancers), the Network Load Balancers, KMS keys, EBS
volumes and CloudWatch Logs.

Billed with use: bridge and other from-zero nodes, S3 storage and requests,
and data transfer out to the Internet, which dominates during events. The
load tests measured about 0.7 to 1 Mbps of bridge egress per participant in
webinar-shaped events ([Load testing](../../../docs/LOAD-TESTING.md)), that is
roughly 0.3 to 0.45 GB per participant per hour, before TURN and recording
uploads. Keep the control plane in standard support (`cluster_support_type`):
extended support is billed per cluster hour.

## Known limitations

- Not applied to any AWS account; every behavior above is from provider
  documentation and offline checks.
- `nlb` caps the platform at one bridge: every concurrent conference shares
  it. Scaling out needs `node-public-ip`, which is not verified.
- A `helm upgrade` that changes the bridge's pod template starts the new
  bridge next to the old one (the subchart uses a rolling update when the host
  port is off). For a moment both sit behind the same address, and the
  conferences on the old bridge end when it stops. Upgrade outside events.
- One bridge Elastic IP in one zone: if that zone fails, the bridge is
  unreachable until you move it (`jvb_az_index`).
- The in-cluster PostgreSQL volume is bound to one zone. Cluster Autoscaler
  cannot always add a node in that zone to a multi-zone group. Use RDS for
  production.
- Docker Hub limits anonymous pulls per source address, and every private node
  pulls through the same NAT address. Use Docker Hub credentials or an ECR
  pull-through cache if installs or scale-ups hit the limit.
- The storage user's secret key is in the OpenTofu state.
- `tofu destroy` does not remove the load balancers that AWS Load Balancer
  Controller created, and the S3 bucket is not emptied: uninstall the chart
  and ingress-nginx and delete the PostgreSQL PVC first, while the controller
  still runs, then empty the bucket, then destroy.

## Security checks

`trivy config` reports no failure on this module. The exceptions are declared
inline, each with its reason:

| Check | Where | Why |
|---|---|---|
| Public API endpoint (AVD-AWS-0040, 0041) | `cluster.tf` | Restricted to `cluster_endpoint_public_access_cidrs`; `0.0.0.0/0` is rejected. Turn the public endpoint off to use only the private one |
| Control-plane log types (AVD-AWS-0038) | `cluster.tf` | Chosen in `cluster_log_types` |
| Log group without a customer key (AVD-AWS-0017) | `cluster.tf` | CloudWatch's own encryption |
| Public ingress on media ports (AVD-AWS-0107) | `nodes.tf` | Participants join from any network |
| Public IP on launch (AVD-AWS-0164) | `network.tf` | Only with `node-public-ip` |
| VPC flow logs (AVD-AWS-0178) | `network.tf` | Volume and cost of media traffic; add `aws_flow_log` if your policy requires them |
| Bucket versioning and access logs (AVD-AWS-0090, 0089) | `storage.tf` | Retention deletions must be final; access logs go to a log bucket of your own |
| Policy on an IAM user (AVD-AWS-0143) | `storage.tf` | The portal accepts only static keys |

## Tests

```bash
cd infra/tofu/eks
tofu init -backend=false
tofu validate
tofu test        # mocked providers: no AWS account or credentials used
```
