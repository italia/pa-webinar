# PA Webinar on k3s, on your own VMs

Scripts and configuration to install PA Webinar with [k3s](https://docs.k3s.io/)
on one server, with one command, or on three nodes by hand. **The procedure is
[Installing on your own VMs with k3s](../../../docs/install/k3s.md)**: support
level, requirements, the one ports table, certificates, images, backups,
upgrades, removal and measurements. The checklists are in
[Checklists](../../../docs/install/checklists.md). This page is the reference
for each script. Each script also has a `--help`, which is authoritative, and
prints its messages in Italian.

| File | Runs on | What it does |
|---|---|---|
| `pa-webinar-up.sh` | The workstation (`--host`), or the server (`--local`) | Installs or upgrades PA Webinar on one server: preflight, k3s, secrets, certificates, images, add-ons, the chart, the checks |
| `pa-webinar-down.sh` | Same | Removes an installation made with `pa-webinar-up.sh`, and optionally k3s and the state folder |
| `install-server.sh` | The server node (the only node, with one VM) | Installs k3s at the tested version and verifies the binary's checksum. Configures Traefik (with its ACME resolver, on request), the bridge's UDP buffers, a proxy or a registry mirror, SELinux on RHEL-family systems, encryption of Secrets at rest, and a join token for agents only |
| `install-agent.sh` | Each further node | Joins the node to the server with a token read from a file. `--jvb` reserves it for the bridge from the first boot |
| `preload-images.sh` | A machine that reaches the registries (`list`, `save`, `build`, `fetch-k3s`), then each node (`import`) | Lists every image the chart renders with your values, bundles them into one archive (building the application images from the checkout with `build`), imports the archive on the node and pins it against image garbage collection. Downloads the k3s air-gap files |
| `label-jvb-node.sh` | The workstation, with the kubeconfig | Three nodes: reserves the bridge node and chooses the node that serves ports 80 and 443 |
| `common.sh` | Sourced by the scripts above | The tested k3s version, the image tags derived from the checkout, the image build. Not run alone |
| `traefik-config.yaml` | Installed by `install-server.sh` | Traefik sees the real client address (`externalTrafficPolicy: Local`) and redirects HTTP to HTTPS. Commented: trusted front proxies, Traefik pinned to the ingress node. To change it, copy it out of the repository and pass the copy with `--traefik-config` |
| `90-pa-webinar-jvb.conf` | Installed by both install scripts | `net.core.rmem_max` and `wmem_max` at 10 MiB, the buffer the bridge asks for |
| `registries.yaml.example` | Passed with `--registries` | A registry mirror inside your network, with its credentials or certificate authority |
| `addons/` | The workstation, or the server | Object storage (`storage.sh`, Garage) and TURN (`turn.sh`) for one server: see [the add-ons' reference](addons/README.md) |
| `../../helm/pa-webinar/examples/values-k3s.yaml` | Helm, on top of `values-simple.yaml` | Traefik ingress classes, the conference Ingress rendered by the chart, the NetworkPolicy peers for Traefik in `kube-system`, local-path storage, the bridge without third-party STUN, pinned conference credentials required |

Run the node scripts from a copy of this whole directory: they read
`common.sh` and the configuration files next to them. `pa-webinar-up.sh` copies
what it needs to the server by itself.

## pa-webinar-up.sh

```text
pa-webinar-up.sh --portal FQDN --meet FQDN (--host USER@SERVER | --local) [options]
pa-webinar-up.sh --portal FQDN [--state-dir DIR]        # a later run: upgrade or change
```

Run it from a checkout of the release you install: the chart, the example
files and both image tags (`X.Y.Z`, `vX.Y.Z-migrate`) come from it; on any
other commit it builds images tagged `local-<commit>`. Options given once are
remembered in `install.conf` in the state folder
(`~/.config/pa-webinar/k3s/<portal>` by default). The secrets are generated once
into `secrets.env` there, never overwritten, and the Kubernetes Secrets are
created from it in the chart's `existing` mode.

| Group | Options |
|---|---|
| Server | `--host USER@SERVER` or `--local`; `--ssh-key FILE`, `--ssh-port N`, `--ssh-option OPTION`; `--tunnel-port N` (default 6443) |
| Names and network | `--portal FQDN`, `--meet FQDN`, `--public-ip IP` or `none`, `--node-ip IP` |
| Installation | `--name NAME`, `--state-dir DIR`, `--namespace NAME`, `--release NAME` |
| Certificates | `--tls acme` with `--acme-email EMAIL` [`--acme-server URL`] [`--acme-server-ca FILE`]; `--tls private-ca`; `--tls own` with `--cert FILE --key FILE` or `--cert-dir DIR`; `--ca-file FILE` |
| Images | `--images registry`, `local`, or `archive` with `--archive FILE`; `--tag X.Y.Z` or `local-<commit>` |
| Email | `--smtp-file FILE` (mode 0600), `--mailpit`, `--no-mailpit` |
| Add-ons | `--storage garage` or `none`, `--storage-host FQDN`; `--turn`, `--no-turn`, `--turn-host FQDN`; `--backup`, `--no-backup` |
| Node | `--proxy URL` or `none`, `--no-proxy LIST`, `--proxy-scope containerd` or `all`, `--registries FILE`, `--airgap-dir DIR`, `--reinstall-k3s` |
| Run | `--timeout 15m`, `--dry-run`, `--yes`, `--ignore-preflight`, `--recover-secrets` |
| Call test | `--verify-call`, `--no-verify-call`; `--verify-browser FILE` or `none` |

Only `--tag`, `--timeout`, `--dry-run`, `--yes`, `--ignore-preflight`,
`--recover-secrets` and `--reinstall-k3s` apply to the run that has them;
every other option, `--verify-call` included, is remembered. The script
writes `kubeconfig` and `kubeconfig.tunnel` into the state folder, and its
summary prints the ssh tunnel to the API, the installation check and the
encrypted backup, each with the real paths. What it does, step by step, and
what each option means:
[Install with one command](../../../docs/install/k3s.md#install-with-one-command).

## pa-webinar-down.sh

```text
pa-webinar-down.sh --portal FQDN [--name NAME] [--state-dir DIR] [--k3s] [--purge] [--purge-images] [--yes|-y]
```

Removes the Helm release and the namespace, with the database, the volumes,
the test mailbox and the add-ons: the data is deleted. `--k3s` also
uninstalls k3s from the server, `--purge` also deletes the files of the state
folder (its `backups/` stays), and `--purge-images` the images that
`pa-webinar-up.sh` built on the workstation. The server, the ssh user, the
namespace and the release come from `install.conf`
([Remove the installation](../../../docs/install/k3s.md#remove-the-installation)).

## install-server.sh

```text
sudo ./install-server.sh [options]
```

| Group | Options |
|---|---|
| Server | `--tls-san NAME` (repeatable), `--traefik-config FILE`, `--no-traefik-config` |
| ACME | `--acme-email EMAIL`, `--acme-server URL`, `--acme-server-ca FILE`: Traefik's resolver `pa-webinar`, TLS-ALPN-01 on port 443 |
| Node network | `--node-ip IP`, `--flannel-iface NAME`, `--cluster-cidr CIDR`, `--service-cidr CIDR`, `--node-label K=V`, `--node-taint K=V:EFFECT` |
| Proxy, registry, no Internet | `--proxy URL`, `--no-proxy LIST`, `--proxy-scope containerd` or `all`, `--registries FILE`, `--airgap-dir DIR` |
| Other | `--version V`, `--no-sysctl`, `--no-wait` |

Running it again with the same options rewrites its configuration and
restarts k3s; running pods keep running, and running it without `--proxy`
removes the proxy. Each run replaces the Traefik configuration that k3s reads
in `/var/lib/rancher/k3s/server/manifests/`; an in-place edit of that copy is
kept as `/var/lib/rancher/k3s/server/traefik-config.yaml.precedente`. The
details are in
[Proxy, registry mirror or no Internet](../../../docs/install/k3s.md#proxy-registry-mirror-or-no-internet),
[RHEL, Rocky Linux and AlmaLinux](../../../docs/install/k3s.md#rhel-rocky-linux-and-almalinux)
and [Certificates](../../../docs/install/k3s.md#certificates).

## install-agent.sh

```text
sudo ./install-agent.sh --server URL --token-file FILE [--jvb] [options]
```

The same node, proxy and registry options as `install-server.sh`. The agent
token is read from a file created with `umask 077`, never from the command
line ([Install on three nodes](../../../docs/install/k3s.md#install-on-three-nodes)).

## preload-images.sh

```text
./preload-images.sh list [--chart DIR] [-- <helm template arguments>]
./preload-images.sh save --out FILE [--arch amd64] [--list FILE] [--from-docker] [--chart DIR] [-- <arguments>]
./preload-images.sh build --out FILE [--tag TAG] [--chart DIR] [-- <arguments>]
sudo ./preload-images.sh import FILE
./preload-images.sh fetch-k3s --out DIR [--version V] [--arch amd64]
```

- `list` prints every image the chart renders with the values you pass, the
  same `-f` files as the install.
- `save` bundles them into one OCI archive, with the credentials of the
  machine that runs it; images that no registry gives and that the local
  Docker has, such as local builds, come from Docker (`--from-docker` takes
  every tagged image from there). `--list FILE` adds images outside the chart,
  such as Mailpit's and Garage's.
- `build` builds the application images from the checkout (`X.Y.Z` and
  `vX.Y.Z-migrate` on a release tag, `local-<commit>` otherwise) and bundles
  them with every other image. It writes `<archive>.values.yaml` with the
  image block for Helm.
- `import` loads an archive into k3s on the node, pins the images against the
  kubelet's image cleanup and checks every reference the chart uses.
- `fetch-k3s` downloads the k3s binary, installer, checksums and system
  images for `--airgap-dir`.

`list`, `save`, `build` and `fetch-k3s` run on Linux or macOS with bash 3.2 or
later and `helm`; `save` and `build` also need `skopeo` and `python3`, and
`build` Docker. Every archive comes with `<archive>.images.txt`, the digest and
reference of each image
([Images without registry access](../../../docs/install/k3s.md#images-without-registry-access)).

## label-jvb-node.sh

```text
./label-jvb-node.sh <bridge-node> [--ingress-node <node>] [--evict] [--context CTX]
./label-jvb-node.sh <bridge-node> --undo [--ingress-node <node>] [--context CTX]
```

Labels and taints the bridge node `workload=jitsi-jvb`, the selector and
toleration that the three-node values file gives the bridge. `--evict`
deletes the pods already there that a controller recreates elsewhere, never
those with a local volume. `--ingress-node` gives a node the ServiceLB label
`svccontroller.k3s.cattle.io/enablelb=true`, so that only it serves 80 and
443. Neither `--evict` nor serving 80 and 443 from an agent has been tested.

## What was tested

In labs of KVM VMs with the k3s version that `common.sh` pins, and images from
the development branch.

**`pa-webinar-up.sh`**, from a Linux workstation to fresh 4 vCPU / 8 GiB
Debian 12 VMs with no direct Internet access, through an HTTP proxy:

- First installs in 2 min 40 s to 3 min 50 s with Docker's build cache warm;
  re-runs and upgrades in 30 to 54 s; `pa-webinar-down.sh` in 32 to 54 s.
- The certificate modes `private-ca`, `own` and `acme` (against a test ACME
  server in the cluster), locally built images over ssh, an archive of
  `preload-images.sh` with `--local` on the server, the test mailbox (a
  sign-in email received), the nightly dump, the object store and TURN
  add-ons. `scripts/backup.sh` and `scripts/restore.sh` from the workstation,
  with the object store (under 1 MiB in the lab): a deleted event, its
  material and a deleted object came back, and the installation check with
  its two-browser call passed.
- After each install, re-run and upgrade, `scripts/verify-install.sh` with its
  two-browser call: moderator and participant roles, 720p video, audio and
  video both ways over UDP.

**The node scripts by hand, one node**, a fresh 4 vCPU / 8 GiB Debian 12 VM
with no Internet access:

- `install-server.sh` ran through an HTTP proxy in 47 s. Then the proxy was
  removed.
- The chart was installed from the image archive (10 images, 1.6 GB,
  imported in 29 s) plus the k3s air-gap images; without the air-gap images
  the database volume stays `Pending`, because the local-path helper image is
  missing. The install took 38 s, and an upgrade left Prosody, Jicofo and the
  bridge running.
- Five participants on camera: every connection went directly over UDP to
  the node address, with no packet loss at 180p. The node peaked at 0.65 of
  its 4 cores and 2.5 GiB.
- The bridge got the full 10 MiB UDP buffer. The portal recorded the real
  client address, and the email job completed with the NetworkPolicy on.
- The air-gap path of `install-server.sh` ran as a re-run on the same node,
  and a tampered binary was refused.

**Two nodes**: a Rocky Linux 9 server with SELinux enforcing and an
upper-case host name, and a Debian 12 agent reserved for the bridge. Neither
had direct Internet access. The lab host drops traffic between VMs on its
bridge, so the nodes reached each other over a second, private link, with
each node's address routed through it.

- With `--airgap-dir` and no policy installed, the server script stopped
  before changing anything.
- Through the proxy, with `dnf` using its own proxy setting,
  `install-server.sh` installed `container-selinux` and `k3s-selinux`, and
  k3s ran with its binary labelled `container_runtime_exec_t`. The full run
  took 103 s. The script found the node by its address, although Kubernetes
  registers the upper-case host name in lowercase.
- With the Traefik `nodeSelector` on and no `--node-label`, the script
  stopped. With `--node-label`, Traefik came up on the server at first boot.
- The agent joined with the agent token from a file, and a proxy with a user
  and password preserved by `sudo`. Every process's command line was sampled
  during the install: neither the token nor the password appeared.
- `preload-images.sh import` ran under `sudo` on Rocky, where `k3s` is not
  on `sudo`'s path, in 32 s, and on the agent, which has no kubeconfig, in
  29 s. Both warned about the missing local-path helper image and finished.
- The chart installed in 60 s, with the node placement of the three-node layout: portal,
  database and Redis on the server, the bridge on the agent. SELinux logged
  no denials.
- Three participants on camera had audio and video over direct UDP to the
  agent. Port 80 answered with a redirect to HTTPS, and the portal recorded
  the real client address.
- Re-runs of `install-server.sh`: one replaced an edited Traefik
  configuration and kept the previous copy. With the policy installed and no
  network, a re-run with `--airgap-dir` finished in 9 s and labelled the
  binary itself.
- On a cluster installed without a separate agent token, `agent-token` was a
  link to the server token, and a re-run of the script did not add one.

**Three nodes** were measured in an earlier lab with the same k3s version: 20
participants on camera, and a node powered off during a call (see
[Measured numbers](../../../docs/install/k3s.md#measured-numbers) and
[What is not highly available](../../../docs/install/k3s.md#what-is-not-highly-available)).

`preload-images.sh list`, and `save` up to its first download, ran with
bash 3.2, the version macOS ships, on Linux.

Not tested: macOS itself, arm64, `--proxy-scope all`, a registry mirror,
`--flannel-iface`, a first installation with `--airgap-dir` on a node that
never had network, `label-jvb-node.sh --evict`, certificates from Let's
Encrypt itself, delivery through a real SMTP relay, and cert-manager with the
redirect on port 80. The full list is in
[Not tested](../../../docs/install/k3s.md#not-tested).
