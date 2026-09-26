# PA Webinar on k3s, on your own VMs

Ready-made scripts and configuration to run PA Webinar on one or three VMs with
[k3s](https://docs.k3s.io/), with the Helm chart's simple profile. Use them
when you have no managed Kubernetes and want a production installation for
events of up to about 20 participants on camera per node, or larger webinars
where most of the audience is muted. The procedure, sizing, measurements and
failure behavior are in
[Installing on your own VMs with k3s](../../../docs/install/k3s.md), and the
alternatives in [Installing PA Webinar](../../../docs/install/README.md). This
page is the reference for the scripts.

Run every script from a copy of this whole directory: the install scripts read
`common.sh` and the configuration files next to them. Each script has a
`--help`.

| File | Runs on | What it does |
|---|---|---|
| `install-server.sh` | The server node (the only node, with one VM) | Installs k3s at the tested version and verifies the binary's checksum. Configures Traefik, the bridge's UDP buffers, a proxy or a registry mirror, SELinux on RHEL-family systems, encryption of Secrets in the k3s datastore, and a join token for agents only |
| `install-agent.sh` | Each further node | Joins the node to the server with a token read from a file. `--jvb` reserves it for the bridge from the first boot |
| `preload-images.sh` | A machine that reaches the registries (`list`, `save`, `fetch-k3s`), then each node (`import`) | Lists every image the chart renders with your values, bundles them into one archive, imports it on the node and pins it against image garbage collection. Downloads the k3s air-gap files |
| `label-jvb-node.sh` | Your workstation, with the kubeconfig | Three nodes: reserves the bridge node and chooses the node that serves ports 80 and 443 |
| `traefik-config.yaml` | Installed by `install-server.sh` | Traefik sees the real client address (`externalTrafficPolicy: Local`) and redirects HTTP to HTTPS. Optional: trusted front proxies, Traefik pinned to the ingress node |
| `90-pa-webinar-jvb.conf` | Installed by both install scripts | `net.core.rmem_max` and `wmem_max` at 10 MiB, the buffer the bridge asks for |
| `registries.yaml.example` | Passed with `--registries` | A registry mirror inside your network |
| `../../helm/pa-webinar/examples/values-k3s.yaml` | Helm, on top of `values-simple.yaml` | Traefik ingress classes, the NetworkPolicy peers for Traefik in `kube-system`, local-path storage, the bridge without third-party STUN. The three-node settings are commented blocks |

## Checklist

Before you start:

- [ ] **VMs.** x86_64 with systemd. Tested on Debian 12, and on Rocky Linux 9
  with SELinux enforcing (see [RHEL and SELinux](#rhel-and-selinux)). The
  scripts also handle arm64, which was not tested.

  | Layout | Node | Minimum | Recommended |
  |---|---|---|---|
  | One node | Everything | 4 vCPU, 8 GiB, 40 GB disk | 8 vCPU, 16 GiB for webinars of about 50 people (estimated) |
  | Three nodes | Server (control plane, Traefik) | 2 vCPU, 4 GiB, 30 GB | same |
  | | Portal and database | 2 vCPU, 4 GiB, 30 GB | same |
  | | Bridge | 4 vCPU, 4 GiB, 20 GB | 4 vCPU, 8 GiB |

- [ ] **Network.** Each node that serves clients has a public address on its
  interface, or a 1:1 NAT or port forward that keeps port numbers. Uplink:
  about 50 Mbit/s out for 20 people on camera at thumbnail quality, more with
  720p speakers (see [Measured numbers](../../../docs/install/k3s.md#measured-numbers)).
- [ ] **Firewall** as in [Ports](#ports).
- [ ] **Two DNS names**, one for the portal and one for the conference, both
  pointing at the node that serves 80 and 443.
- [ ] **A TLS certificate** that browsers trust, for both names: your
  organization's certificate, or cert-manager with Let's Encrypt (see the
  note on port 80 in [Ports](#ports)).
- [ ] **An SMTP relay** reachable from the node. Without it no email is
  sent: registration confirmations, reminders, staff sign-in links.
- [ ] **A workstation** with the repository checkout, `helm` (3.16 or later)
  and `kubectl`. The repository does not contain the chart's subcharts: fetch
  them once, from the repository root, before any other step:

  ```bash
  helm repo add bitnami https://charts.bitnami.com/bitnami
  helm repo add jitsi-contrib https://jitsi-contrib.github.io/jitsi-helm/
  helm dependency build infra/helm/pa-webinar
  ```

  Use `build`, not `update`: `build` installs exactly the versions pinned in
  `Chart.lock`.
- [ ] **A machine that prepares the images**, often the workstation itself:
  Linux or macOS, bash 3.2 or later, `helm`, `skopeo` and `python3`, and a
  login to the project's registry (`docker login ghcr.io` or
  `skopeo login ghcr.io`).
- [ ] **A database backup plan.** The database lives on one node's disk
  (local-path), and nothing copies it.

## Ports

| Port | Protocol | From | To | Purpose |
|---|---|---|---|---|
| 443 | TCP | Clients | The ingress node | Portal and conference |
| 80 | TCP | Clients | The ingress node | Redirect to HTTPS only (`traefik-config.yaml`). You can keep it closed |
| 10000 | UDP | Clients | The bridge node | Audio and video. Without it participants join with no media |
| 6443 | TCP | Administrators, agents | Server | Kubernetes API. Never from the Internet |
| 8472 | UDP | Every node | Every node | Pod network (flannel VXLAN). Three nodes only |
| 10250 | TCP | Every node | Every node | Kubelet (logs, exec, metrics). Three nodes only |
| 587 | TCP | Nodes | SMTP relay | Email (465 if your relay uses implicit TLS) |
| 443 | TCP | Nodes | Registries, GitHub | Only if the nodes pull images or k3s themselves |

On port 80 Traefik answers every request with a permanent redirect to
HTTPS (301 for `GET`, 308 for other methods): a browser moves to HTTPS before
any page loads or any form is sent. A script that posts directly to an
`http://` address has already sent its request in clear text, so always
configure clients with `https://`.

The redirect also catches certificate validation requests. With
cert-manager, use the DNS-01 challenge, or remove the
`ports.web.http.redirections` block from your copy of `traefik-config.yaml`
while you use HTTP-01. After a change of k3s version, check that the redirect
is still there (`curl -I http://<portal>/` answers 308): Traefik's chart
ignores keys it does not know, without an error.

The bridge needs no STUN server: it announces the node address (see
`jitsi-meet.jvb` in `values-k3s.yaml`). If a host firewall runs on the nodes
(firewalld, ufw), also allow the pod and Service networks, `10.42.0.0/16`
and `10.43.0.0/16`, as the k3s documentation requires.

The simple profile has no TURN server. Participants on networks that block
UDP towards port 10000 get no audio or video. For them you need TURN, which
on k3s needs a second IP address (see
[TURN](../../../docs/INFRASTRUCTURE.md#turn)).

## One node

1. **Choose the version**, on the workstation. Write `domain.yaml`, kept
   outside the repository, from the header of `values-k3s.yaml`: your two
   names and the image tags.

   ```yaml
   app:
     image:
       tag: "<X.Y.Z>"               # the release, without the v
     migration:
       image:
         tag: "v<X.Y.Z>-migrate"    # with the v of the git tag
   ```

   Always set both tags. Without them the chart uses its `appVersion` and
   derives `<X.Y.Z>-migrate` for the migrations. That form exists only for
   releases published after the release workflow started producing it,
   while `v<X.Y.Z>-migrate` exists for every release. With a tag that does
   not exist, the migration initContainer stays in `ImagePullBackOff` and
   the installation runs into its timeout. For the development images use
   `dev` and `dev-migrate`.

2. **Prepare the images**, on the machine that reaches the registries.
   Pass the same values files you will install with:

   ```bash
   cd infra/onprem/k3s
   ./preload-images.sh list -- \
     -f ../../helm/pa-webinar/examples/values-simple.yaml \
     -f ../../helm/pa-webinar/examples/values-k3s.yaml -f <path>/domain.yaml
   ./preload-images.sh save --out pa-webinar-images.tar -- <same arguments>
   ```

   Check that `list` shows both tags you chose. `save` writes
   `pa-webinar-images.tar.images.txt` next to the archive, with the digest of
   every image it bundled. The project's registry requires credentials even
   to read today. This machine uses its own, and the node never sees them.
   Skip this step only if the node can pull from the registries itself, with
   credentials in `--registries`.

3. **Copy** this directory and the archive to the node, then **install k3s**:

   ```bash
   sudo ./install-server.sh                      # direct Internet access
   sudo ./install-server.sh --proxy http://<proxy>:<port> --no-proxy <node-subnet>
   sudo ./install-server.sh --registries registries.yaml
   sudo ./install-server.sh --airgap-dir <dir>   # no Internet at all, see below
   ```

   The script waits until the node, CoreDNS and Traefik are ready, and prints
   the next commands. On RHEL, Rocky or AlmaLinux, read
   [RHEL and SELinux](#rhel-and-selinux) first.

4. **Import the images** on the node:

   ```bash
   sudo ./preload-images.sh import pa-webinar-images.tar
   ```

   It checks every reference the chart uses, exactly as the kubelet asks for
   it, and fails if one is missing.

5. **Get the kubeconfig** on your workstation:

   ```bash
   ssh <user>@<node-ip> sudo cat /etc/rancher/k3s/k3s.yaml \
     | sed 's#https://127.0.0.1:6443#https://<node-ip>:6443#' > kubeconfig-pa-webinar
   export KUBECONFIG=$PWD/kubeconfig-pa-webinar
   ```

6. **Write `secrets.yaml`**, also kept outside the repository. It holds
   values you generate once and pass unchanged to every upgrade:

   ```bash
   h() { openssl rand -hex "$1"; }
   cat > secrets.yaml <<EOF
   secrets:
     generate:
       APP_SECRET: "$(h 32)"
       JITSI_JWT_SECRET: "$(h 32)"
       PII_ENCRYPTION_KEY: "$(h 32)"
       CRON_API_KEY: "$(h 32)"
       ADMIN_API_KEY: "$(h 32)"
       POSTGRES_PASSWORD: "$(h 24)"
       POSTGRES_ADMIN_PASSWORD: "$(h 24)"
       REDIS_PASSWORD: "$(h 24)"
       SMTP_HOST: "<smtp-relay>"
       SMTP_FROM: "<sender address>"
   jitsi-meet:
     jicofo:
       xmpp:
         password: "$(h 16)"
     jvb:
       xmpp:
         password: "$(h 16)"
   EOF
   chmod 600 secrets.yaml
   ```

   Losing `POSTGRES_PASSWORD` or `PII_ENCRYPTION_KEY` means losing access to
   the data. The two XMPP passwords keep upgrades from restarting the
   conference: `values-k3s.yaml` refuses to render without them.

7. **Install**, from the repository root:

   ```bash
   helm upgrade --install pa-webinar ./infra/helm/pa-webinar \
     -n pa-webinar --create-namespace \
     -f infra/helm/pa-webinar/examples/values-simple.yaml \
     -f infra/helm/pa-webinar/examples/values-k3s.yaml \
     -f <path>/domain.yaml -f <path>/secrets.yaml \
     --wait --timeout 15m
   ```

   Read the notes Helm prints at the end. The section *Da controllare*
   ("to check") lists what is still an example value or a risk in your
   setup.

8. **Check** (add `-k` to `curl` while the certificate is self-signed):

   ```bash
   curl -s https://<portal>/api/health                              # "status":"ok"
   curl -s -o /dev/null -w '%{http_code}\n' https://<conference>/config.js   # 200
   curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://<portal>/  # 301 https://<portal>/
   kubectl -n pa-webinar create job --from=cronjob/pa-webinar-email-outbox outbox-check
   kubectl -n pa-webinar get job outbox-check                       # Complete
   ```

   Then hold a short call with two devices on different networks. A
   participant list that fills up is not enough: check that you hear and
   see each other. Media problems show up only there.

**TLS.** Until you configure a certificate, Traefik serves its own
self-signed one. With your organization's certificate:

```bash
kubectl -n pa-webinar create secret tls pa-webinar-tls --cert=<chain.pem> --key=<key.pem>
```

Then set `ingress.tls` and `jitsi-meet.web.ingress.tls` to that Secret, as the
comments in `values-k3s.yaml` show. With a certificate from an internal CA,
browsers must trust the CA. The portal's status page checks the conference
inside the cluster and does not need it; the portal needs it only to reach
names behind that CA, such as an SMTP relay or object storage. Put the CA in
a ConfigMap and name it in `app.extraCaCerts`, which mounts it and sets
`NODE_EXTRA_CA_CERTS`
([Certificates](../../../docs/install/k3s.md#certificates)).

## Three nodes

Three VMs keep the bridge's CPU spikes away from the portal and database.
They are **not** highly available: one server with its embedded SQLite
datastore, and a database on one node's disk. In the lab, powering off the
portal and database node left a running call alive, but it stopped new joins
and registrations until the VM came back.

The layout below makes the server the ingress node: both DNS names point at
it, and it runs Traefik.

1. **Server**, as in step 3 above, as the ingress node from its first boot.
   In your copy of `traefik-config.yaml`, uncomment the `nodeSelector`
   block, then:

   ```bash
   sudo ./install-server.sh --node-label svccontroller.k3s.cattle.io/enablelb=true [other options]
   ```

   With the label, ServiceLB answers on 80 and 443 only from the server, and
   the `nodeSelector` keeps Traefik there, so the portal sees the real client
   addresses. The script stops if the `nodeSelector` is on and no node has
   the label: Traefik would stay `Pending`.
2. **Agents.** Each agent joins with the agent token, which the server keeps
   in `/var/lib/rancher/k3s/server/agent-token`. That token can add agent
   nodes, but not another server, which would read the datastore and the
   cluster keys. Copy it into a file that only you can read, never onto a
   command line:

   ```bash
   # on each agent
   (umask 077; ssh <user>@<server-ip> sudo cat /var/lib/rancher/k3s/server/agent-token > agent-token)
   sudo ./install-agent.sh --server https://<server-ip>:6443 --token-file agent-token          # portal and database
   sudo ./install-agent.sh --server https://<server-ip>:6443 --token-file agent-token --jvb    # bridge
   rm agent-token
   ```

   `--jvb` labels and taints the node `workload=jitsi-jvb` from its first
   boot, so nothing else lands there. On VMs with more than one interface, add
   `--node-ip` and `--flannel-iface` for the interface the nodes share.
   `install-server.sh` creates a separate agent token only on a new cluster.
   On a cluster installed with an earlier version of the script,
   `agent-token` holds the server token.
3. **Import the images** on every node (`preload-images.sh import`). The bridge
   node needs only the bridge image, but a full import costs nothing more.
4. **If the bridge node joined without `--jvb`**, reserve it from your
   workstation:

   ```bash
   ./label-jvb-node.sh <bridge-node>
   ```

   It lists the pods already there. With `--evict` it moves the ones a
   controller recreates, and it never touches a pod whose volume is on that
   node.
5. **Uncomment the three-node blocks** in your copy of `values-k3s.yaml`:
   `jitsi-meet.jvb.nodeSelector` and `tolerations` put the bridge on its node.
   `app.nodeSelector`, `postgresql.primary.nodeSelector` and
   `redis.master.nodeSelector` keep the portal and its data together on one
   known node. Node names are the host names in lowercase, as
   `kubectl get nodes` shows them. Then install as in step 7.
6. **Open** UDP 10000 on the bridge node only, and the ports between nodes
   from [Ports](#ports).

To serve 80 and 443 from a node other than the server, install the server
without `--node-label` and with the `nodeSelector` still commented out. Once
the agents have joined, run
`./label-jvb-node.sh <bridge-node> --ingress-node <node>`, point the DNS
names at that node, uncomment the `nodeSelector` in your copy of
`traefik-config.yaml`, and run `install-server.sh` again with the same
options.

## Proxies, mirrors, no Internet

The scripts support three ways for nodes to get what they need. You can
combine them.

- **HTTP proxy** (`--proxy`, or `HTTPS_PROXY` in the environment). The
  install scripts download k3s through it. By default containerd uses it
  only to pull images, and k3s and the kubelet do not. `--proxy-scope all`
  gives it to them as well. `NO_PROXY` always contains the pod and
  Service networks, `.svc`, `.cluster.local`, the node itself and, on an
  agent, the server. Add your node subnet and any internal registry with
  `--no-proxy`. `sudo` drops the environment, so pass the proxy with
  `--proxy` or with `sudo env HTTPS_PROXY=... ./install-server.sh`.

  A proxy URL with a user and password works too. The scripts keep it off
  the command lines they run and write it to their logs without the
  credentials. k3s needs it in the service's environment file, which only
  root can read. Keep it off your own command line as well: read it into
  the environment and let `sudo` keep it.

  ```bash
  read -rsp 'Proxy URL: ' HTTPS_PROXY; export HTTPS_PROXY
  sudo --preserve-env=HTTPS_PROXY ./install-server.sh --no-proxy <node-subnet>
  unset HTTPS_PROXY
  ```
- **Registry mirror** (`--registries`, from `registries.yaml.example`). List
  `registry-1.docker.io` as well as `docker.io`: the PostgreSQL image is
  written with that registry name, and containerd treats the two as
  different registries.
- **No Internet at all.** On a connected machine:

  ```bash
  ./preload-images.sh fetch-k3s --out k3s-airgap    # binary, install.sh, checksums, k3s system images
  ./preload-images.sh save --out pa-webinar-images.tar -- <your values>
  ```

  Copy both to every node, run `install-*.sh --airgap-dir k3s-airgap`, then
  `preload-images.sh import`. Both kinds of images are needed. k3s pulls
  some of its own images only when first used: local-path creates each volume
  with a helper image the first time a volume is requested. Without the k3s
  air-gap images, the database volume would wait forever. `import` warns
  when that helper image is missing, on the server and on agents.

These settings cover only what the nodes download. They do not proxy the
portal's own outbound connections, such as the SMTP relay or object storage:
the node must reach those directly.

## RHEL and SELinux

On RHEL, Rocky Linux and AlmaLinux the scripts keep SELinux enforcing. k3s
then needs its policy, the `k3s-selinux` package, which requires
`container-selinux`.

- **With network access**, `install-*.sh` lets the k3s installer add both
  packages, as a standard k3s installation does. `dnf` must reach the
  distribution's repositories and `rpm.rancher.io`. Behind a proxy, `dnf`
  uses its own configuration (`proxy=` in `/etc/dnf/dnf.conf`), not the
  scripts' `--proxy`.
- **With `--airgap-dir`**, install `container-selinux` from your
  distribution mirror and `k3s-selinux` from a mirror of `rpm.rancher.io`
  first. With SELinux enforcing and no policy, the script stops before it
  changes anything on the node.
- **Once the policy is installed**, re-runs download no packages, with or
  without a network.
- `INSTALL_K3S_SKIP_SELINUX_RPM=true` skips the policy entirely and
  `INSTALL_K3S_SELINUX_WARN=true` turns the missing policy into a warning.
  Both work as in the k3s installer. Pass them with
  `sudo env INSTALL_K3S_SELINUX_WARN=true ./install-server.sh ...`.

If firewalld runs on the nodes, open the ports from [Ports](#ports) and trust
the pod and Service networks:

```bash
sudo firewall-cmd --permanent --zone=trusted --add-source=10.42.0.0/16 --add-source=10.43.0.0/16
sudo firewall-cmd --reload
```

## Upgrades and changes

- **Chart and application.** Put the new tags in `domain.yaml`, prepare a new
  image archive (`list` shows what changes), import it on the nodes, then run
  the same `helm upgrade` with the same `secrets.yaml`. With the XMPP
  passwords pinned, an upgrade restarts the Jitsi web front end and whatever
  changed, but not Prosody, Jicofo or the bridge, which carry the calls.
  Still, avoid upgrading during an event.
- **Scripts.** Running an install script again with the same options rewrites
  its configuration and restarts k3s. Running pods keep running. Running it
  without `--proxy` removes the proxy from k3s.
- **Traefik configuration.** Edit `traefik-config.yaml` in your copy of this
  directory, then run `install-server.sh` again with the same options. Each
  run replaces the copy k3s reads, in
  `/var/lib/rancher/k3s/server/manifests/`. If that copy was edited in place,
  the script says so and keeps it as
  `/var/lib/rancher/k3s/server/traefik-config.yaml.precedente`.
- **k3s version.** The scripts install the tested version. Another version
  goes through `--version`, at your own risk: Traefik, ServiceLB and the
  policy controller change with k3s.

## Known limits

- **No high availability**, on one node or on three (see above).
- **No TURN** in the simple profile (see [Ports](#ports)).
- **Never set `JVB_ADVERTISE_PRIVATE_CANDIDATES: "false"`** when the bridge
  announces a private address (an intranet, or a lab). The bridge then
  announces no address at all. Participants join, and the participant
  list fills up, but nobody hears or sees anyone.
- **Behind a NAT**, `jitsi-meet.jvb.publicIPs` must hold the public address.
  If it is missing, outside participants get no media.
- **Images float on the development tag** if you install `:dev`. An archive
  fixes the copy of the day it was made. Released versions have fixed tags.

## What was tested

In labs of KVM VMs with k3s v1.36.4+k3s1 and images from the development
branch.

**One node**, a fresh 4 vCPU / 8 GiB Debian 12 VM with no Internet access:

- `install-server.sh` ran through an HTTP proxy in 47 s. Then the proxy was
  removed.
- The chart was installed from the image archive (10 images, 1.6 GB,
  imported in 29 s) plus the k3s air-gap images. The first attempt, without
  the air-gap images, left the database volume `Pending`, because the
  local-path helper image was missing. A clean install then took 38 s, and an
  upgrade left Prosody, Jicofo and the bridge running.
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
- The chart installed in 60 s, with the three-node blocks uncommented: portal,
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
never had network, `label-jvb-node.sh --evict`, a publicly trusted
certificate, delivery through a real SMTP relay, and cert-manager with the
redirect on port 80.
