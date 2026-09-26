# Installing on Amazon EKS

This page takes the IT staff of a public body from an empty AWS account to a
first test event with PA Webinar on Amazon Elastic Kubernetes Service (EKS).
It uses two files from the repository:

- [`infra/tofu/eks`](../../infra/tofu/eks/README.md), an OpenTofu module that
  creates the AWS side: network, cluster, node groups, storage class, bucket
  and the identities of the cluster controllers;
- [`infra/helm/pa-webinar/examples/values-eks.yaml`](../../infra/helm/pa-webinar/examples/values-eks.yaml),
  the chart values that go with it, layered on the full profile.

> **Status: not yet verified on AWS.** The module and the values are
> validated offline only: OpenTofu and Terraform validation, module tests
> with mocked providers, a security scan of the configuration, and a render
> of the chart with the values the module produces
> ([What has been verified](#what-has-been-verified)). Nobody has applied the
> module to an AWS account or installed the chart on EKS, and no number on
> this page was measured on EKS. The same chart has run real events on AKS
> and was installed from scratch on minikube and k3s
> ([What has been exercised](README.md#what-has-been-exercised-and-what-is-only-validated)). Plan for a test
> event before the first real one.

The module's [README](../../infra/tofu/eks/README.md) is the reference for
every variable, output and resource. This page gives the order of work, the
decisions, the checks and the limits. How to choose a platform, and the
checklist common to all of them, are in [Installing PA Webinar](README.md);
to try the chart on a workstation first, see
[Try PA Webinar on minikube](minikube.md). The chart itself is described in
[Deploying with Helm](../DEPLOYMENT.md), and environment variables in the
[Configuration reference](../CONFIGURATION.md).

On this page:

- [What you get](#what-you-get)
- [Requirements](#requirements)
- [Decisions to make first](#decisions-to-make-first)
- [Checklist](#checklist)
- [Install](#install)
- [Before the first real event](#before-the-first-real-event)
- [How scaling works on EKS](#how-scaling-works-on-eks)
- [Capacity](#capacity)
- [Network access and security](#network-access-and-security)
- [Costs](#costs)
- [Upgrades](#upgrades)
- [Removing the installation](#removing-the-installation)
- [Known limitations](#known-limitations)
- [What has been verified](#what-has-been-verified)
- [Related pages](#related-pages)

## What you get

```mermaid
flowchart LR
  classDef portal fill:#E6F0FA,stroke:#0066CC,stroke-width:2px,color:#17324D
  classDef media fill:#E0F5F5,stroke:#00A3A3,stroke-width:2px,color:#17324D
  classDef data fill:#E3F2EC,stroke:#008055,stroke-width:2px,color:#17324D
  classDef job fill:#FFF3E0,stroke:#CC7A00,stroke-width:2px,color:#17324D
  classDef ext fill:#EEF1F4,stroke:#5C6F82,stroke-width:1px,color:#17324D
  classDef optional stroke-dasharray:5 4

  USERS(["Participants<br/>and staff"]):::ext

  subgraph VPC["VPC in two or three zones, created by infra/tofu/eks"]
    direction LR
    subgraph PUB["Public subnets"]
      direction TB
      NLBW["NLB for ingress-nginx<br/>TCP 80 and 443"]:::portal
      NLBJ["NLB for the bridge<br/>UDP 10000<br/>fixed Elastic IP"]:::media
      NLBT["NLB for coturn<br/>UDP 3478, TCP 443<br/>second Elastic IP"]:::media
    end
    subgraph PRIV["Private subnets"]
      direction TB
      APPS["applications group, always on<br/>portal, jobs, JVB scaler,<br/>Prosody, Jicofo, Jitsi web, coturn,<br/>PostgreSQL on gp3, Redis,<br/>cluster controllers"]:::portal
      JVBG["jvb group, from zero<br/>the bridge"]:::media
      OPT["jibri and gpu groups<br/>from zero"]:::job
    end
  end
  style VPC fill:#F7F9FB,stroke:#5C6F82,color:#17324D
  style PUB fill:#FFFFFF,stroke:#0066CC,color:#17324D
  style PRIV fill:#FFFFFF,stroke:#00A3A3,color:#17324D

  S3[("S3 bucket<br/>SSE-KMS, CORS<br/>static key")]:::data

  USERS -->|"HTTPS"| NLBW --> APPS
  USERS ==>|"media, UDP"| NLBJ ==> JVBG
  USERS -.->|"UDP blocked"| NLBT -.->|"to coturn"| APPS
  APPS -.->|"relayed media"| JVBG
  USERS -->|"uploads, signed URLs"| S3
  APPS & OPT -->|"S3 gateway endpoint"| S3
  class NLBT,OPT optional
```

Dashed boxes are optional and off by default. Media never passes through the
portal or the ingress: browsers send it over UDP to the bridge's Network Load
Balancer, and to coturn over TLS on port 443 when their network blocks UDP.

| Who provides it | What |
|---|---|
| `infra/tofu/eks` | VPC with public and private subnets, NAT gateway and S3 gateway endpoint; EKS control plane with Secrets encrypted by a KMS key and control-plane logs in CloudWatch; the add-ons `vpc-cni` (with NetworkPolicy enforcement), `kube-proxy`, `coredns`, `eks-pod-identity-agent`, `aws-ebs-csi-driver`, `metrics-server`; a default `gp3` StorageClass; the node groups; Elastic IPs for the bridge and, with TURN, for coturn; an S3 bucket with an IAM user and access key; IAM roles bound with EKS Pod Identity for the controllers. The full table is [What the module creates](../../infra/tofu/eks/README.md#what-the-module-creates) |
| You, with Helm | AWS Load Balancer Controller, Cluster Autoscaler, ingress-nginx, cert-manager with a ClusterIssuer, the NVIDIA device plugin if you add the GPU group, then the PA Webinar chart |
| You, outside the cluster | DNS records, an SMTP relay, registry credentials or an image mirror, and for production a managed database and its backups |

The node groups carry the labels and taints that the chart values select on:

| Group | Label and taint | Size (module default) | Runs |
|---|---|---|---|
| `applications` | label `workload=applications`, no taint | 2 to 4 nodes (`app_min_size`, `app_max_size`) | Everything that is not media or GPU work |
| `jvb` | `workload=jitsi-jvb`, tainted `NoSchedule` | 0 to 2 nodes (`jvb_max_size`) | The bridge |
| `jibri` (optional) | `workload=jitsi-jibri`, tainted | 0 to 2 nodes | Jibri, if you turn it on |
| `gpu` (optional) | `workload=ai-gpu`, tainted, plus the labels the NVIDIA device plugin and Cluster Autoscaler look for | 0 to 1 node | The AI post-production worker |

## Requirements

**Tools on the machine that installs**, which must be inside
`cluster_endpoint_public_access_cidrs`:

- OpenTofu 1.8 or later (`required_version` in `infra/tofu/eks/versions.tf`),
  or Terraform. The committed `.terraform.lock.hcl` pins the provider
  versions for OpenTofu's registry.
- The AWS CLI, `kubectl`, Helm 3 or 4, `openssl`, `git`.

**In AWS:**

- Credentials allowed to create VPC, EC2, EKS, IAM, KMS, S3 and CloudWatch
  Logs resources.
- A region you have enabled, chosen with your data-protection assessment:
  the cluster, the bucket and its key all live in `region`. Milan
  (`eu-south-1`) is an opt-in region: enable it in the account first, and
  check that it offers the instance types below.
- Service quotas for those instance types, and for public IPv4 addresses.
- A remote state backend with encryption. The state holds the storage user's
  secret key; `versions.tf` carries an S3 backend example.

**Outside AWS:**

- Two DNS names that you control, for the portal and the conference (on this
  page `webinar.example.com` and `meet.webinar.example.com`), and a third one
  for TURN if you turn it on. For TURN the zone must be in Route 53, for the
  DNS-01 certificate check.
- An SMTP relay. Without it no email is ever sent
  ([Email delivery](../configuration/email.md)).
- Access to the portal images: a token with `read:packages` for
  `ghcr.io/italia`, or a copy of the images in Amazon ECR
  ([Images](../INFRASTRUCTURE.md#images)).

**Default sizes.** These are the module defaults in
`infra/tofu/eks/variables.tf`, not sizes measured on EKS. The vCPU and memory
figures are AWS's catalog values for each instance type.

| Group | Default instance type | Disk | Basis for the default |
|---|---|---|---|
| `applications` | `m6i.large` (2 vCPU, 8 GiB) | 50 GiB | Two nodes, for the two portal replicas in different zones. On the lab installs, the portal, PostgreSQL and Redis together used about 0.25 core at most and under 300 MiB with 20 participants ([Requirements](README.md#requirements)); the controllers come on top and were not measured |
| `jvb` | `c6i.xlarge` (4 vCPU, 8 GiB) | 30 GiB | Holds the bridge of `values-full.yaml`: request 1 CPU and 2 GiB, limit 3 CPU and 4 GiB. The closest measured bridge is below, in [Capacity](#capacity) |
| `jibri` | `c6i.xlarge` | 50 GiB | One Jibri per node |
| `gpu` | `g5.4xlarge` (16 vCPU, 64 GiB, one 24 GB GPU) | 200 GiB | The worker requests 8 CPU and 32 GiB. A 24 GB GPU covers transcription and diarization; the default language model needs a larger one ([Provisioning a GPU node pool](../POSTPROD.md#provisioning-a-gpu-node-pool)) |

The in-cluster PostgreSQL volume is 10 GiB (`postgresql.primary.persistence.size`
in the chart's `values.yaml`), on `gp3`.

If you have never run the chart, try it first on one workstation with
`scripts/minikube-up.sh` ([Try PA Webinar on minikube](minikube.md)). It
installs the same chart, with the portal, the administration area and a real
conference, without an AWS bill.

## Decisions to make first

| Decision | Default | Options and consequences |
|---|---|---|
| How browsers reach the bridge (`jvb_exposure`) | `nlb` | `nlb`: one bridge behind a UDP Network Load Balancer with a fixed Elastic IP; bridge nodes stay private. Every concurrent event shares that one bridge (`JVB_MAX_REPLICAS=1`). `node-public-ip`: one bridge per node, each node with its own public address; several bridges, but not verified on any cloud and it needs a STUN server ([Choose how browsers reach the bridge](../../infra/tofu/eks/README.md#choose-how-browsers-reach-the-bridge), [The single-IP pitfall](../architecture/scaling.md#the-single-ip-pitfall)) |
| TURN (`turn_enabled`) | Off | On: coturn behind its own Network Load Balancer, for participants whose network blocks UDP, which is common in public-sector networks. Needs a third DNS name, a DNS-01 certificate through Route 53 (`cert_manager_route53_zone_ids`) and a pinned shared secret ([TURN](../INFRASTRUCTURE.md#turn)) |
| Database | PostgreSQL in the cluster, on a `gp3` volume (`values-eks.yaml`) | Amazon RDS for PostgreSQL for production: `postgresql.enabled: false` and a `DATABASE_URL` ending in `?sslmode=require`. The module does not create it. The in-cluster volume is bound to one zone |
| Portal images | `ghcr-secret` pull Secret | Or copy the portal and migration images into ECR, which the nodes can pull without a Secret, and empty `app.imagePullSecrets` |
| Who may connect (`public_ingress_cidrs`) | Everyone | Narrow it only for an installation used inside your own network, and set the same list for ingress-nginx ([Network access and security](#network-access-and-security)) |
| NAT (`one_nat_gateway_per_az`) | One NAT gateway | One per zone survives the loss of a zone and costs more |
| Node autoscaler | Cluster Autoscaler | Karpenter, which you set up yourself ([Karpenter](#karpenter-instead-of-cluster-autoscaler)) |
| Ingress | ingress-nginx behind a Network Load Balancer | Its upstream project has announced its retirement ([Ingress controllers](../INFRASTRUCTURE.md#ingress-controllers)). The alternative is an Application Load Balancer (class `alb`) with an ACM certificate and an idle timeout of 3600 seconds; the bridge and TURN keep their Network Load Balancers. Not verified ([4. Install the cluster controllers](../../infra/tofu/eks/README.md#4-install-the-cluster-controllers)) |
| Composite recording (`jibri_enabled`) | Off | Jibri needs the `snd-aloop` kernel module, not checked on the Amazon Linux 2023 image, and its upload script mounted by hand. The per-participant recorder bot needs neither ([Setting up recording](../operations/recording-setup.md)) |
| AI post-production (`gpu_enabled`) | Off | A GPU group from zero nodes, plus the NVIDIA device plugin ([AI post-production](../POSTPROD.md)) |

## Checklist

Go through the platform-independent
[Checklists](checklists.md) as
well. The items below are specific to EKS.

**Before you start**

- [ ] Region chosen and enabled; quotas for the instance types and public IPv4 addresses.
- [ ] Encrypted remote state backend ready.
- [ ] Administration network range for the Kubernetes API endpoint (never `0.0.0.0/0`).
- [ ] Portal and conference DNS names, and the TURN name if you turn TURN on.
- [ ] SMTP relay, with host, port, user, password and sender.
- [ ] Registry token with `read:packages`, or the images copied into ECR.
- [ ] The release you install, for both image tags (`<version>` and `v<version>-migrate`).
- [ ] The decisions above written down.
- [ ] A folder outside the repository for the installation files, readable only by you.

**Install** ([Install](#install))

- [ ] 1. Subcharts built.
- [ ] 2. `terraform.tfvars` filled in, module applied.
- [ ] 3. Cluster in your kubeconfig; two `applications` nodes Ready.
- [ ] 4. Load Balancer Controller, Cluster Autoscaler, ingress-nginx, cert-manager and the ClusterIssuer installed.
- [ ] 5. DNS records created.
- [ ] 6. Namespace, pull Secret and application Secrets created.
- [ ] 7. Private values written once and kept; chart installed.
- [ ] 8. Post-install checks pass.

**Before the first real event** ([details](#before-the-first-real-event))

- [ ] A test event brought a bridge up from zero, and audio and video flowed from outside the VPC.
- [ ] Cold start measured and **Pre-scale lead time (minutes)** set from it.
- [ ] **vCPU per JVB pod** aligned with the bridge.
- [ ] A video uploaded from the administration area.
- [ ] A registration email received.
- [ ] With TURN: a participant joined from a network that blocks UDP.
- [ ] Database backups arranged, and a [restore drill](checklists.md#restore-drill) done.
- [ ] Privacy notes updated: region, log retention, TURN.

## Install

The steps run from the root of a clone of the repository. The commands follow
the module's README and [Deploying with Helm](../DEPLOYMENT.md#install-walkthroughs),
with two changes: the installation files live outside the repository, and the
storage key never appears on a command line. None of them has run against
AWS. The chart layering of step 7 renders with `helm template`, and the
Secret and private-values commands of steps 6 and 7 were run offline
([What has been verified](#what-has-been-verified)).

```mermaid
flowchart LR
  classDef portal fill:#E6F0FA,stroke:#0066CC,stroke-width:2px,color:#17324D
  classDef data fill:#E3F2EC,stroke:#008055,stroke-width:2px,color:#17324D
  classDef job fill:#FFF3E0,stroke:#CC7A00,stroke-width:2px,color:#17324D
  classDef ext fill:#EEF1F4,stroke:#5C6F82,stroke-width:1px,color:#17324D
  classDef risk fill:#FCE8EC,stroke:#D1344C,stroke-width:2px,color:#17324D
  classDef emph fill:#17324D,stroke:#17324D,stroke-width:2px,color:#FFFFFF

  TFV["terraform.tfvars<br/>region, Kubernetes version,<br/>admin network, portal origin"]:::ext
  APPLY["tofu apply<br/>infra/tofu/eks"]:::job
  STATE[("Remote state<br/>holds the storage key")]:::risk
  CTRL["helm: AWS Load Balancer Controller,<br/>Cluster Autoscaler, ingress-nginx,<br/>cert-manager"]:::job
  INFRA["helm_values output<br/>bucket, region,<br/>bridge port and Elastic IP,<br/>source ranges, bridge cap"]:::portal
  KEYS["storage key outputs<br/>into videocall-secrets"]:::risk
  PROFILE["values-full.yaml<br/>+ values-eks.yaml"]:::portal
  OWN["Your files, outside the repository:<br/>installation values with both image tags,<br/>private values with pinned passwords"]:::data
  CHART(["helm upgrade --install pa-webinar"]):::emph

  TFV --> APPLY --> STATE
  APPLY --> CTRL
  STATE --> INFRA & KEYS
  PROFILE --> CHART
  INFRA --> CHART
  OWN --> CHART
  KEYS --> CHART
  CTRL --> CHART
```

### 1. Get the chart and a folder for your files

```bash
git clone https://github.com/italia/pa-webinar.git
cd pa-webinar
git checkout v<version>                      # the release you install
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo add jitsi-contrib https://jitsi-contrib.github.io/jitsi-helm/
helm dependency build infra/helm/pa-webinar

CONF=~/pa-webinar-conf                       # any folder outside the repository
mkdir -p "$CONF" && chmod 700 "$CONF"
```

`helm dependency build` installs exactly the subchart versions of
`Chart.lock` ([Get the chart](../DEPLOYMENT.md#get-the-chart)). The files you
write into `$CONF` hold passwords or describe your installation, and the
repository's ignore rules do not cover them in the repository root.

### 2. Configure and apply the module

```bash
cp infra/tofu/eks/terraform.tfvars.example infra/tofu/eks/terraform.tfvars   # ignored by git
```

Fill in `region`, `cluster_version` (a minor version in standard support),
`cluster_endpoint_public_access_cidrs`, `cluster_admin_principal_arns` (not
the principal that applies the module: it already has an access entry, and a
second one makes the creation fail) and `portal_origins`, the portal's
`https://` origin for the bucket's CORS rule. Then add your decisions:
`jvb_exposure`, `turn_enabled` with `cert_manager_route53_zone_ids`,
`jibri_enabled`, `gpu_enabled`. Every variable is described in
`infra/tofu/eks/variables.tf`.

Configure the remote backend (the example is in `versions.tf`), then:

```bash
tofu -chdir=infra/tofu/eks init
tofu -chdir=infra/tofu/eks plan -out=eks.tfplan
tofu -chdir=infra/tofu/eks apply eks.tfplan
```

The default bucket name is `<name>-media-<account>-<region>`. S3 accepts at
most 63 characters, so with a long `name` the plan stops and asks for
`s3_bucket_name`.

The apply also creates the `gp3` StorageClass through the Kubernetes API, so
the machine must reach the cluster endpoint. If it cannot, set
`create_default_storage_class = false` and apply the manifest in
[2. Apply](../../infra/tofu/eks/README.md#2-apply) yourself. Without a default
StorageClass the PostgreSQL volume stays `Pending`: EKS clusters created on
Kubernetes 1.30 or later have none.

### 3. Connect

```bash
$(tofu -chdir=infra/tofu/eks output -raw update_kubeconfig_command)
kubectl config current-context
kubectl get nodes -L workload
```

The first command adds the cluster to your kubeconfig and makes it the
current context. Check the context before running anything else. Two
`applications` nodes are expected; the other groups have no nodes until a pod
asks for one.

### 4. Install the cluster controllers

The IAM roles already exist, bound to fixed ServiceAccount names, so each
controller must keep the name used below. Pods cannot reach the instance
metadata service (hop limit 1), so each controller gets its region from its
settings. The chart versions are pinned to the ones the module was checked
against; bump them together when you change the Kubernetes minor version
([Upgrades](#upgrades)).

**AWS Load Balancer Controller** creates the Network Load Balancers for
ingress-nginx, the bridge and coturn. The built-in Kubernetes controller
would create a Classic Load Balancer, which carries no UDP. The IAM policy in
`infra/tofu/eks/policies/aws-load-balancer-controller.json` belongs to this
controller release.

```bash
helm upgrade --install aws-load-balancer-controller aws-load-balancer-controller \
  --repo https://aws.github.io/eks-charts --version 3.5.0 -n kube-system \
  --set clusterName="$(tofu -chdir=infra/tofu/eks output -raw cluster_name)" \
  --set region="$(tofu -chdir=infra/tofu/eks output -raw region)" \
  --set vpcId="$(tofu -chdir=infra/tofu/eks output -raw vpc_id)" \
  --set serviceAccount.name=aws-load-balancer-controller
kubectl -n kube-system rollout status deployment/aws-load-balancer-controller
```

Wait for the rollout before going on. The chart registers an admission
webhook that must answer for every new Service in the cluster: while the
controller is not ready, creating a Service fails, and bridge pods started
in the namespace labeled in step 6 get no readiness gate.

**Cluster Autoscaler** adds a bridge node when the JVB scaler asks for a
bridge, and removes it afterwards. Set `image.tag` to the Cluster Autoscaler
release for your cluster's minor version.

```bash
helm upgrade --install cluster-autoscaler cluster-autoscaler \
  --repo https://kubernetes.github.io/autoscaler --version 9.59.0 -n kube-system \
  --set autoDiscovery.clusterName="$(tofu -chdir=infra/tofu/eks output -raw cluster_name)" \
  --set awsRegion="$(tofu -chdir=infra/tofu/eks output -raw region)" \
  --set rbac.serviceAccount.name=cluster-autoscaler \
  --set extraArgs.balance-similar-node-groups=true \
  --set extraArgs.expander=least-waste \
  --set image.tag=v1.NN.P   # the release for the cluster's minor version 1.NN
```

**ingress-nginx** behind a Network Load Balancer that keeps the client's
address. The portal's per-address limits, and the rate limits of the full
profile's Ingress, count per client address: without `preserve_client_ip`,
every participant arrives from a few load-balancer addresses and shares one
limit.

```bash
cat > "$CONF/ingress-nginx.values.yaml" <<'EOF'
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
EOF

helm upgrade --install ingress-nginx ingress-nginx \
  --repo https://kubernetes.github.io/ingress-nginx --version 4.15.1 \
  -n ingress-nginx --create-namespace -f "$CONF/ingress-nginx.values.yaml"
```

With this path the default `TRUSTED_PROXY_HOPS` (`0`) is the right value
([Client addresses and per-IP limits](../INFRASTRUCTURE.md#client-addresses-and-per-ip-limits)).

**cert-manager**, and the ClusterIssuer that the chart's Ingresses ask for
(`letsencrypt-prod`, HTTP-01 through ingress-nginx):

```bash
helm upgrade --install cert-manager cert-manager \
  --repo https://charts.jetstack.io --version v1.21.2 \
  -n cert-manager --create-namespace \
  --set crds.enabled=true

kubectl apply -f - <<'EOF'
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
EOF
```

With TURN, the TURN name points at coturn's load balancer, not at the
ingress, so HTTP-01 cannot validate it: add the DNS-01 issuer from
[4. Install the cluster controllers](../../infra/tofu/eks/README.md#4-install-the-cluster-controllers).
With the GPU group, install the NVIDIA device plugin with the tolerations in
[Optional pools](../../infra/tofu/eks/README.md#optional-pools): without them
the plugin never runs on the tainted GPU nodes, the worker stays `Pending`,
and Cluster Autoscaler keeps starting and removing a GPU node that is billed
each time.

### 5. DNS

```bash
kubectl -n ingress-nginx get svc ingress-nginx-controller \
  -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
```

- `webinar.example.com` and `meet.webinar.example.com`: CNAME records to that
  hostname (a Route 53 alias record at a zone apex).
- With TURN, `turn.webinar.example.com`: an A record to
  `tofu -chdir=infra/tofu/eks output -raw turn_public_ip`.
- If participants' networks filter outbound traffic, their administrators
  must allow the bridge's UDP port (`jvb_udp_port`, 10000 by default) towards
  `tofu -chdir=infra/tofu/eks output -raw jvb_public_ip`.

### 6. Namespace and Secrets

```bash
kubectl create namespace pa-webinar
kubectl label namespace pa-webinar elbv2.k8s.aws/pod-readiness-gate-inject=enabled
```

The label makes a pod behind a load balancer Ready only once the load
balancer sees it healthy, so a rolling update of the bridge waits for the new
target. Not verified with the bridge.

Create `videocall-secrets` and `videocall-jitsi-jwt` as in
[Standard profile](../DEPLOYMENT.md#standard-profile), and the `ghcr-secret`
pull Secret as in
[The values file for your installation](../DEPLOYMENT.md#the-values-file-for-your-installation),
with the two differences below. Run everything in the same shell.

**The in-cluster database.** `values-eks.yaml` runs PostgreSQL in the cluster
and reads its passwords from `videocall-datastore`. Create that Secret with
this command instead of the standard profile's one, which holds only the
Redis password:

```bash
POSTGRES_PASSWORD="$(openssl rand -hex 24)"
kubectl create secret generic videocall-datastore -n pa-webinar \
  --from-literal=POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  --from-literal=POSTGRES_ADMIN_PASSWORD="$(openssl rand -hex 24)" \
  --from-literal=REDIS_PASSWORD="$(openssl rand -hex 24)"
```

In the `videocall-secrets` command, point `DATABASE_URL` at the in-cluster
service instead of an external database. The hexadecimal password needs no
URL encoding:

```text
--from-literal=DATABASE_URL="postgresql://eventi:${POSTGRES_PASSWORD}@pa-webinar-postgresql.pa-webinar.svc.cluster.local:5432/pa_webinar"
```

The user `eventi` and the database `pa_webinar` are the chart defaults
(`postgresql.auth` in `values.yaml`). With RDS, keep the standard profile's
external URL and set `postgresql.enabled: false`.

**The storage key.** Copy it from the state into files that only you can
read, add them to the `videocall-secrets` command, and delete them:

```bash
keydir="$(mktemp -d)"
tofu -chdir=infra/tofu/eks output -raw s3_access_key_id > "$keydir/id"
tofu -chdir=infra/tofu/eks output -raw s3_secret_access_key > "$keydir/secret"
```

```text
--from-file=STORAGE_FILES_S3_ACCESS_KEY_ID="$keydir/id"
--from-file=STORAGE_FILES_S3_SECRET_ACCESS_KEY="$keydir/secret"
--from-file=RECORDING_S3_ACCESS_KEY_ID="$keydir/id"
--from-file=RECORDING_S3_SECRET_ACCESS_KEY="$keydir/secret"
```

```bash
rm -rf "$keydir"
```

`tofu output -raw` writes the value without a trailing newline, so the
Secret receives it byte for byte, and the key never appears on a command
line. Both storage domains share the bucket; their key prefixes do not
overlap ([Object storage](../configuration/storage.md#s3-compatible-services)).

### 7. Install the chart

Write the two files that belong to your installation, once:

- `$CONF/pa-webinar.values.yaml`, the file of
  [The values file for your installation](../DEPLOYMENT.md#the-values-file-for-your-installation):
  both image tags (`app.image.tag: "<version>"`, and
  `app.migration.image.tag: "v<version>-migrate"` with the leading `v`), the
  two DNS names and the Ingress hosts. Neither example file sets the tags.
  Without them the chart derives a migration tag that not every release
  publishes, and the portal pods stay in `Init:ImagePullBackOff` until
  `--wait` times out.
- `$CONF/pa-webinar.private.yaml`, the conference's internal credentials.
  `values-eks.yaml` sets `jitsi.requirePinnedCredentials`, so the render
  stops while one is missing
  ([Pin the conference's internal credentials](../DEPLOYMENT.md#pin-the-conferences-internal-credentials)).
  Generate them once and pass the same file to every upgrade: new values
  restart Prosody, Jicofo and the bridge, and every live conference drops.

  ```bash
  ( umask 077
    cat > "$CONF/pa-webinar.private.yaml" <<EOF
  jitsi-meet:
    jicofo:
      xmpp:
        password: "$(openssl rand -hex 16)"
    jvb:
      xmpp:
        password: "$(openssl rand -hex 16)"
  EOF
  )
  ```

  With TURN, add coturn's shared secret under `jitsi-meet`
  (`coturn.staticAuth.secret`, or `coturn.staticAuth.existingSecretName` with
  the key `TURN_CREDENTIALS`), and uncomment the TURN block of
  `values-eks.yaml` in your installation values
  ([coturn (TURN and TURNS)](../DEPLOYMENT.md#coturn-turn-and-turns)).

Then generate the infrastructure values and install:

```bash
tofu -chdir=infra/tofu/eks output -raw helm_values > "$CONF/pa-webinar.eks-infra.yaml"

helm upgrade --install pa-webinar ./infra/helm/pa-webinar -n pa-webinar \
  -f infra/helm/pa-webinar/examples/values-full.yaml \
  -f infra/helm/pa-webinar/examples/values-eks.yaml \
  -f "$CONF/pa-webinar.eks-infra.yaml" \
  -f "$CONF/pa-webinar.values.yaml" \
  -f "$CONF/pa-webinar.private.yaml" \
  --wait --timeout 15m
```

The order matters: each file overrides the ones before it.

| File | Holds | Secret? |
|---|---|---|
| `values-full.yaml` | The full profile: bridges from zero on a dedicated pool, the JVB scaler, the HorizontalPodAutoscaler | No |
| `values-eks.yaml` | The EKS layer: `workload=applications` for the portal and its jobs, PostgreSQL on `gp3`, the bridge behind a UDP Network Load Balancer with no STUN lookup, bridges protected from node removal, NetworkPolicy on, ServiceMonitors off, the scaler back to every 2 minutes, the stock Jitsi web image | No |
| `pa-webinar.eks-infra.yaml` | What the module decided: bucket and region, the bridge's UDP port, Elastic IP and subnet, the load balancers' source ranges, `JVB_MAX_REPLICAS`, and with TURN coturn's address and `allowedPeerIPs` | No |
| `pa-webinar.values.yaml` | Your release, host names and pull Secret | No |
| `pa-webinar.private.yaml` | The pinned conference credentials | Yes |

`values-eks.yaml` turns the ServiceMonitors off because they fail the
install without the Prometheus Operator. Turn them on once
kube-prometheus-stack runs, with the scrape credentials
([Metrics](../DEPLOYMENT.md#metrics)).

### 8. Check

- [ ] `kubectl get nodes -L workload` shows the `applications` nodes, and no
      bridge node outside events.
- [ ] `kubectl -n pa-webinar get pvc` shows the PostgreSQL volume `Bound` on
      `gp3`.
- [ ] `kubectl -n pa-webinar get svc pa-webinar-jitsi-meet-jvb` shows a
      load-balancer hostname, and `dig +short` of that hostname returns
      `tofu -chdir=infra/tofu/eks output -raw jvb_public_ip`.
- [ ] `kubectl -n pa-webinar get cronjob pa-webinar-jvb-scaler` exists, and
      the bridge Deployment stays at zero replicas while no event is
      scheduled.
- [ ] `https://webinar.example.com` answers with a valid certificate, and the
      status page reports the conference as reachable.
- [ ] You can sign in to the administration area with the instance API key
      (`ADMIN_API_KEY`), then create a named administrator.

The chart-level checks are in [First-run checks](../DEPLOYMENT.md#first-run-checks),
and symptoms with their fixes in [Troubleshooting](../operations/troubleshooting.md).

## Before the first real event

**Bring a bridge up from zero.** Create a test event that starts within the
next quarter of an hour. The JVB scaler moves it to `PROVISIONING` and sets
the bridge to one replica, a `jvb` node joins, and the bridge pod becomes
Ready. Its log must show
`StaticMapping(localAddress=<pod-ip>, publicAddress=<jvb-public-ip>)`. Join
from a network outside the VPC, and check that audio and video flow both
ways. [End-to-end check](../operations/jvb-scaler.md#end-to-end-check) walks
through it.

**Measure the cold start, then set the lead time.** On EKS the chain is: one
scaler tick, a new EC2 node, the image pull, the bridge start, the target
registration on the load balancer, and one more tick. None of it has been
timed on EKS. After the test, read the gap between the bridge pod's creation
and its Ready time with the command in
[Lead time and cold start](../operations/jvb-scaler.md#lead-time-and-cold-start),
add two tick intervals (4 minutes with the 2-minute schedule of
`values-eks.yaml`), and set **Pre-scale lead time (minutes)**
(`jvbPreScaleMinutes`, default `15` in `app/prisma/schema.prisma`) to at
least that. Participants who arrive earlier wait in the waiting room.

**Align the sizing with your bridge.** The sizing defaults describe a 16-core
bridge (`jvbCpuCoresPerPod` default `16`); the bridge of `values-full.yaml`
has a limit of 3 CPU. Set **vCPU per JVB pod** to the CPU your bridge really
has ([Align the defaults with your bridges](../architecture/scaling.md#align-the-defaults-with-your-bridges)).
With `nlb` the scaler never asks for more than one bridge, but the sizing
still feeds the event wizard's estimates and the status pages.

**Exercise storage and email.** Upload a video from the administration area:
it goes from the browser straight to S3 and exercises the bucket's CORS rule,
the multipart permissions and the KMS key. Register to the test event and
check that the confirmation email arrives. If it does not, see
[Emails are not sent](../operations/troubleshooting.md#emails-are-not-sent).

**Other checks, if they apply.**

- With TURN: join from a network that blocks UDP, and check that the call
  still carries media.
- With the per-participant recorder bot and NetworkPolicy on (the
  `values-eks.yaml` default): add the rule its pods need
  ([Before enabling the NetworkPolicy](../architecture/background-jobs.md#before-enabling-the-networkpolicy)).
- Arrange database backups: RDS snapshots, or `scripts/backup.sh` for the
  in-cluster database. The backup must be kept together with
  `PII_ENCRYPTION_KEY`, without which personal data cannot be read
  ([Restore drill](checklists.md#restore-drill)).
- Update your privacy notes: the AWS region, CloudWatch log retention
  (`cluster_log_retention_days`, 90 days by default, for the control-plane
  `api`, `audit` and `authenticator` logs) and, with TURN, the relay
  ([Privacy and data protection](../GDPR.md#logs-and-external-resources)).

## How scaling works on EKS

```mermaid
sequenceDiagram
  autonumber
  box rgba(204,122,0,0.12) applications group
    participant S as JVB scaler (CronJob)
    participant P as Portal
    participant CA as Cluster Autoscaler
    participant LBC as Load Balancer Controller
  end
  box rgba(0,163,163,0.12) Media path
    participant N as jvb node group
    participant B as Bridge pod
    participant L as UDP NLB (Elastic IP)
  end
  S->>P: tick every 2 minutes: facts from the cluster
  P-->>S: an event starts within jvbPreScaleMinutes: one bridge
  S->>B: scale the bridge Deployment to 1: pod Pending
  CA->>N: reads the group's template tags, adds a node from zero
  N->>B: node joins, image pull, bridge starts
  LBC->>L: registers the pod as target, health check /about/health on 8080
  S->>P: next tick: the bridge answers /colibri/stats
  P-->>S: the room can open, LIVE at the start time
  Note over S,L: Nothing above was timed on EKS: measure it with a test event
  P-->>S: event IDLE or ENDED: zero bridges
  S->>B: scale to 0
  CA->>N: removes the empty node after scale-down-unneeded-time
```

**Bridges.** The JVB scaler decides how many bridges exist; the node groups
follow. A node group at zero nodes has no node from which Cluster Autoscaler
could read labels and taints, so the module tags each group with
`k8s.io/cluster-autoscaler/node-template/*` entries that describe them. After
the event, the scaler sets the replicas back to zero once the event is `IDLE`
(an empty room for **Inactivity minutes before shutdown**, default `45`) or
`ENDED`, and Cluster Autoscaler removes the empty node after
`scale-down-unneeded-time` (ten minutes by default). The bridge pods carry
`cluster-autoscaler.kubernetes.io/safe-to-evict: "false"` and
`karpenter.sh/do-not-disrupt: "true"`, so no node autoscaler removes a node
while a bridge runs on it. The scaler's logic is in
[Scaling the media plane](../architecture/scaling.md), its operation in
[Running the JVB scaler](../operations/jvb-scaler.md).

**Portal.** The portal's HorizontalPodAutoscaler runs 2 to 8 replicas
(`values-full.yaml`) and targets 70% CPU and 80% memory (the chart defaults
in `values.yaml`), fed by the `metrics-server` add-on. Cluster Autoscaler
grows the `applications` group up to `app_max_size` when the replicas do not
fit.

**GPU.** The post-production queue, not the JVB scaler, starts the worker
Jobs; Cluster Autoscaler raises the `gpu` group from zero for them. The
`k8s.amazonaws.com/accelerator` label on the group tells Cluster Autoscaler
that a new node is a GPU node, so it waits for the device plugin instead of
adding another node ([AI post-production](../POSTPROD.md)).

**What does not scale.** With `nlb` the platform has exactly one bridge: every
concurrent event shares it, and adding nodes adds nothing. One Prosody and
one Jicofo serve every conference ([Where the limits are](../architecture/scaling.md#where-the-limits-are-in-the-order-you-meet-them)).

### Karpenter instead of Cluster Autoscaler

The module does not install Karpenter. To use it for the bridge and GPU
nodes, replace those managed node groups with Karpenter NodePools that set
the same labels and taints, with a consolidation policy of `WhenEmpty` for
the bridge pool, and an EC2NodeClass that selects the private subnets (the
public ones for `node-public-ip`) and the module's `jvb` security group next
to the cluster security group. Never use spot capacity for the bridges: an
interruption ends every conference on the bridge
([Not spot](../architecture/scaling.md#not-spot)). EKS Auto Mode manages
Karpenter for you but allows no custom AMI, which Jibri may need. Not
verified ([Karpenter instead of Cluster Autoscaler](../../infra/tofu/eks/README.md#karpenter-instead-of-cluster-autoscaler)).

## Capacity

With the default `nlb` exposure, the whole installation has one bridge. Size
it for the largest set of events that run at the same time, not for the
largest single event. Nothing has been measured on EKS; the figures below
come from other machines, and say how they were obtained.

| Reference | Result | How it was measured |
|---|---|---|
| A bridge limited to 3 CPU and 2 GiB, on a 4-vCPU, 16 GiB VM: the CPU limit of `values-full.yaml` | About 25 participants all on camera at the ceiling (stress 0.83 with 26 senders); 60 participants in a webinar with 6 senders at about half the stress budget (0.47), extrapolated to about 100 to 120 at a stress of 0.8. Some 60 to 80-participant runs ended with the bridge killed for exceeding its 2 GiB memory limit | Full-media bots from one workstation over the public internet, `/colibri/stats` sampled every 30 s ([Small bridge: 3 CPUs](../LOAD-TESTING.md#small-bridge-3-cpus)) |
| A real 44-minute webinar on AKS | 65 participants at the peak, highest bridge stress 0.186, on 16-vCPU bridges | The scaler's cross-bridge snapshot and the bridges' own counters ([A real event](../LOAD-TESTING.md#a-real-event)) |
| Bridge egress per participant | About 0.7 Mbps in a 78-participant synthetic webinar, about 1 Mbps in the real event: roughly 0.3 to 0.45 GB per participant per hour, before TURN and recordings | Same sources |

What follows for the default `c6i.xlarge` bridge node, which has 4 vCPU and
8 GiB: its bridge has the CPU limit of the 3-CPU reference and twice its
memory limit (4 GiB), so the 3-CPU figures are the closest guide. The memory
kills seen at 2 GiB are less likely at 4 GiB, which has not been measured.
To carry more, choose a larger instance type in `jvb_instance_types` and
raise `jitsi-meet.jvb.resources` to match
([Bridge (JVB)](../DEPLOYMENT.md#bridge-jvb)).
Then measure your own installation as described in
[Load testing](../LOAD-TESTING.md) before you publish a capacity figure.

**More than one bridge** needs `jvb_exposure = "node-public-ip"`: bridge
nodes in the public subnets, each with its own public IPv4 address, the
bridge on the node's host port, `JVB_MAX_REPLICAS` set by the module to
`jvb_max_size`, and the commented block of `values-eks.yaml` for the bridge.
EC2 instances do not carry their public address on the network interface, so
each bridge learns it through a STUN server: your own, or the chart's coturn
with `useInternalStun`. That block also turns off the bridge's private
candidates. In-cluster participants such as the recorder bot and Jibri would
then reach the bridge only at its public address, leaving the VPC through
the NAT gateway, so a narrowed `public_ingress_cidrs` must also admit the NAT
gateway's address. This topology has not been verified on any cloud. Before
raising the cap, check it with the in-cluster grid test
([The single-IP pitfall](../architecture/scaling.md#the-single-ip-pitfall)),
with a TURN-relayed participant and with the recorder bot. If you label the
namespace with a Pod Security level, host ports need `privileged`.

## Network access and security

| Traffic | Where it is opened | Filter that decides |
|---|---|---|
| TCP 80 and 443 to the portal and the conference | ingress-nginx's Network Load Balancer | `controller.service.loadBalancerSourceRanges` in `ingress-nginx.values.yaml`; everyone when empty |
| UDP `jvb_udp_port` (10000) to the bridge | The bridge's Network Load Balancer and Elastic IP | The source-ranges annotation that the module writes from `public_ingress_cidrs` |
| UDP 3478 and TCP 443 to coturn, with TURN | coturn's Network Load Balancer and Elastic IP | The same annotation |
| UDP to bridge nodes, with `node-public-ip` | The node security group | The module's rule from `public_ingress_cidrs`, the only filter in this topology |
| Kubernetes API | The EKS endpoint | `cluster_endpoint_public_access_cidrs`; `0.0.0.0/0` is refused |

AWS Load Balancer Controller gives each Network Load Balancer a security group
of its own, built from the Service's source ranges, and opens the cluster
security group to it. That group is the real filter; the module's rules on
the node security groups are a second layer
([Who can reach the load balancers](../../infra/tofu/eks/README.md#who-can-reach-the-load-balancers)).

- **Instance metadata.** Nodes require IMDSv2 with a hop limit of 1, so pods
  reach neither the metadata service nor the node role's credentials.
  Anything else you install that calls AWS APIs needs its region in its
  settings and its own Pod Identity role.
- **Secrets and state.** Kubernetes Secrets are encrypted with a dedicated
  KMS key. The OpenTofu state holds the storage user's secret key: keep it in
  the encrypted remote backend. Rotate the key as described in
  [Object storage](../../infra/tofu/eks/README.md#object-storage).
- **Object storage.** The bucket is private, encrypted with its own KMS key,
  reachable only over TLS, and has no versioning on purpose: the retention
  jobs must be able to delete recordings and personal data for good. The
  application accepts only static S3 keys, not IAM roles for service accounts
  or EKS Pod Identity.
- **NetworkPolicy.** The VPC CNI enforces it (`enable_network_policy`, on by
  default), and `values-eks.yaml` turns the chart's policies on
  ([Network policies](../INFRASTRUCTURE.md#network-policies)).
- **Logs.** The module ships no container logs anywhere. If you add a log
  agent, such as CloudWatch Container Insights, remember that ingress-nginx
  access lines carry the full URL, and conference and room URLs can carry
  `?token=` and `?jwt=`. Filter them, or keep those lines out of long-term
  storage ([Privacy and data protection](../GDPR.md#logs-and-external-resources)).
- **STUN.** With `nlb` the bridge is given its public address and makes no
  STUN lookup (`jitsi-meet.jvb.stunServers: ""`), so the bridge contacts no
  third-party STUN server
  ([Advertised addresses and NAT](../INFRASTRUCTURE.md#advertised-addresses-and-nat)).

The security scan's accepted exceptions, each with its reason, are listed in
[Security checks](../../infra/tofu/eks/README.md#security-checks).

## Costs

Billed while the module's resources exist, whatever the traffic: the EKS
control plane, the `applications` nodes, NAT gateways, public IPv4 addresses
(Elastic IPs, NAT, load balancers), the Network Load Balancers, KMS keys, EBS
volumes and CloudWatch Logs. Billed with use: bridge and other from-zero
nodes, S3 storage and requests, and data transfer out to the Internet, which
dominates during events (see the egress figures in [Capacity](#capacity)).
Pods reach S3 through the gateway endpoint, not the NAT gateway. Keep the
control plane in standard support: extended support is billed per cluster
hour ([Costs to plan for](../../infra/tofu/eks/README.md#costs-to-plan-for)).

## Upgrades

- **PA Webinar releases.** Follow the upgrade procedure in
  [Upgrades and rollback](../operations/upgrades.md#the-upgrade-procedure),
  passing the same five files, with both new image tags. An upgrade that
  changes the bridge's pod template starts the new bridge next to the old one
  behind the same address, and the conferences on the old bridge end when it
  stops: upgrade outside events.
- **Kubernetes versions.** The node groups follow the control plane. Raise
  `cluster_version` by one minor version at a time, outside events: EKS
  upgrades the control plane, then replaces each group's nodes one at a time,
  and a bridge on a replaced node ends its conferences. Then pin the add-on
  versions for the new minor in `addon_versions`, set the Cluster Autoscaler
  image for it, and check the pinned controller charts. With
  `cluster_support_type = "STANDARD"`, EKS upgrades the control plane by
  itself when standard support ends; set `cluster_version` to the version
  the cluster reports before the next apply, or the plan tries a downgrade
  that EKS refuses
  ([Kubernetes upgrades](../../infra/tofu/eks/README.md#kubernetes-upgrades)).
- **AWS Load Balancer Controller.** Replace
  `infra/tofu/eks/policies/aws-load-balancer-controller.json` with the policy
  of the new release, apply, then upgrade the chart.

## Removing the installation

`tofu destroy` does not remove the load balancers that AWS Load Balancer
Controller created, and does not empty the bucket. In this order:

1. `helm uninstall pa-webinar -n pa-webinar` and
   `helm uninstall ingress-nginx -n ingress-nginx`, while the controller
   still runs, so that it deletes their load balancers.
2. Delete the PostgreSQL volume claim (`kubectl -n pa-webinar get pvc`).
3. Empty the bucket. This deletes every recording and file for good.
4. `tofu -chdir=infra/tofu/eks destroy`.

## Known limitations

- **Not applied to any AWS account.** Every AWS behavior on this page comes
  from provider documentation, upstream source code and offline checks.
- **One bridge with `nlb`.** Every concurrent event shares it. More bridges
  need `node-public-ip`, which is not verified and needs a STUN server.
- **One zone for the bridge.** Its Elastic IP, load balancer and nodes live
  in the zone of `jvb_az_index`. If that zone fails, the bridge is
  unreachable until you move it.
- **Bridge upgrades end conferences.** See [Upgrades](#upgrades).
- **The in-cluster database is zonal.** Its EBS volume binds it to one zone,
  and Cluster Autoscaler cannot always add a node in that zone to a
  multi-zone group. Use RDS for production. `scripts/backup.sh` and
  `scripts/restore.sh` cover the in-cluster database, not the object store.
- **Static storage keys only.** The secret key sits in the OpenTofu state.
- **Images.** The portal images need a pull Secret or a copy in ECR. Docker
  Hub limits anonymous pulls per source address, and every private node
  pulls through the same NAT address: use Docker Hub credentials or an ECR
  pull-through cache if installs or scale-ups hit the limit.
- **Jibri** needs `snd-aloop`, not checked on the Amazon Linux 2023 image,
  and its upload script mounted by hand
  ([Mount the finalize script](../operations/recording-setup.md#mount-the-finalize-script)).
- **GPU.** The default `g5` GPU (24 GB) is too small for the default language
  model, and the NVIDIA device plugin has only been rendered, never run on
  EKS. No GPU was started for these checks.
- **Unverified timings.** Node start, image pull and target registration have
  not been timed on EKS; measure them before relying on
  **Pre-scale lead time (minutes)**.
- **Metadata hop limit.** Any add-on that expects the node role or the
  metadata service needs its own configuration.
- **Teardown** needs the manual order in
  [Removing the installation](#removing-the-installation).
- **Chart CI.** `scripts/validate-chart.sh` has no EKS profile, so the
  EKS layering is checked only by hand with `helm template`.

## What has been verified

| Check | How | Result | What it does not prove |
|---|---|---|---|
| Module syntax and types | `tofu fmt -check -recursive`, `tofu init -backend=false -lockfile=readonly`, `tofu validate`, with OpenTofu and with Terraform | Clean and valid | That AWS accepts the resources |
| Module logic | `tofu test`, with mocked AWS and Kubernetes providers | Every run passes, on OpenTofu and Terraform: both bridge topologies with TURN, Jibri and GPU; the input checks (bucket name length, bridge port range, API endpoint ranges, HTTPS portal origin, bridge zone); hop limit 1 on every launch template; node groups on the control plane's version; the GPU labels and Cluster Autoscaler template tags; the bridge port and source ranges reaching the chart values | Any AWS API behavior |
| Configuration security | `trivy config --skip-dirs tests infra/tofu/eks`, from the repository root | No failures; the accepted exceptions are declared inline | Runtime security |
| Chart layering | `helm template` of `values-full.yaml`, `values-eks.yaml`, a module output, an installation values file and pinned passwords | Renders. The bridge Service is a `LoadBalancer` of class `service.k8s.aws/nlb` on UDP 10000 with the Elastic IP, subnet, source-range and health-check annotations; the bridge advertises the Elastic IP; PostgreSQL's volume uses `gp3`; the portal and its jobs select `workload=applications`; the scaler runs every 2 minutes; the migration image uses the `v<version>-migrate` tag | That the Load Balancer Controller creates what the annotations ask for |
| Controller charts | `helm pull` of each pinned chart, reading its values | Every setting used on this page exists in the pinned chart | Behavior on EKS |
| Secret and private-values commands of steps 6 and 7 | The commands as written, with sample values, and `kubectl create secret generic --dry-run=client -o yaml` | The Secret receives the key byte for byte; the private file is valid YAML, readable only by its owner, and the chart renders with it | That the Secrets work in a cluster |
| NVIDIA device plugin | `helm template` with the tolerations of the module README, checked against the GPU group's labels and taint | The plugin's affinity matches and the taint is tolerated | That the plugin runs on the Amazon Linux 2023 NVIDIA image |

Not verified: everything that needs an AWS account. That includes the apply
itself, the load balancers for UDP with fixed Elastic IPs, Cluster
Autoscaler scaling from zero, the hop limit's effect on the add-ons, S3
uploads with SSE-KMS, cert-manager with Route 53, coturn behind a load
balancer, the `node-public-ip` topology, Jibri and the GPU group.

To repeat the offline checks:

```bash
cd infra/tofu/eks
tofu fmt -check -recursive
tofu init -backend=false -lockfile=readonly
tofu validate
tofu test        # mocked providers: no AWS account or credentials used
```

`tofu init` creates `.terraform/` in the module folder, which the module's
`.gitignore` excludes.

## Related pages

- [Installing PA Webinar](README.md): choosing a platform, the common
  checklist and the limits that apply everywhere.
- The other managed clouds: [AKS](aks.md), the platform the chart has run
  real events on, and [GKE](gke.md).
- [Infrastructure reference](../INFRASTRUCTURE.md): sizing, networking, TURN,
  network policies and images, for every platform.
- [`infra/tofu/eks` README](../../infra/tofu/eks/README.md): every variable,
  output and resource of the module.
- [Deploying with Helm](../DEPLOYMENT.md): profiles, Secrets, Jitsi keys and
  first-run checks.
- [Configuration reference](../CONFIGURATION.md) and
  [Object storage](../configuration/storage.md).
- [Scaling the media plane](../architecture/scaling.md) and
  [Running the JVB scaler](../operations/jvb-scaler.md).
- [Upgrades and rollback](../operations/upgrades.md),
  [Monitoring and health](../operations/monitoring.md) and
  [Troubleshooting](../operations/troubleshooting.md).
- [Load testing and reference measurements](../LOAD-TESTING.md).
- [AI post-production](../POSTPROD.md) and
  [Setting up recording](../operations/recording-setup.md).
- [Reusing PA Webinar](../REUSE.md): what an administration takes on as
  operator.
