# Checklists

Every checklist for installing and running PA Webinar, in the order you meet
them. Each item says how to check it, and links the page that explains it.
Where an item belongs to someone other than the IT staff, it says who:

- **IT**: the people who install and run the servers, the network and the
  cluster;
- **DPO**: the data protection officer, with whoever owns the privacy notice;
- **Communications**: whoever runs the site's content, the event pages and
  the messages to participants.

The commands assume the release and namespace `pa-webinar`. On k3s, `S` is
the installation's state folder, `~/.config/pa-webinar/k3s/<portal>` by
default, and `S/kubeconfig.tunnel` the kubeconfig that reaches the API through
an ssh tunnel ([Reach the cluster](k3s.md#reach-the-cluster)). Platforms,
support levels and constraints are compared in
[Installing PA Webinar](README.md).

On this page:

- [Pre-install checks by constraint](#pre-install-checks-by-constraint)
- [Services and accounts](#services-and-accounts)
- [Workstation and server preflight](#workstation-and-server-preflight)
- [Post-install verification](#post-install-verification)
- [Go-live](#go-live)
- [Security hardening for one server](#security-hardening-for-one-server)
- [Day-2 routine](#day-2-routine)
- [Upgrade](#upgrade)
- [Restore drill](#restore-drill)
- [Secrets rotation](#secrets-rotation)
- [Decommissioning](#decommissioning)

## Pre-install checks by constraint

Go through each line that applies to your network. The answer on each
platform, and how far it is proven, is in
[Constraints by platform](README.md#constraints-by-platform).

- [ ] **The address participants reach.** You know it, and whether a NAT sits
      in front of the server. A NAT must be 1:1 and keep UDP port 10000; the
      bridge must then announce the public address (`--public-ip` on k3s,
      `jitsi-meet.jvb.publicIPs` elsewhere).
- [ ] **UDP towards the bridge.** Port 10000/UDP is open from the Internet to
      the bridge. If some participants sit on networks that block UDP, which
      is common in public administrations, TURN is planned (`--turn` on k3s,
      coturn elsewhere), and so is a test from such a network.
- [ ] **A corporate proxy.** You have its URL, whether it needs a user and
      password, and the `NO_PROXY` entries for the servers' own network and
      any internal registry. It lets the servers reach the k3s downloads, the
      container registries and, with `--tls acme`, the ACME server.
- [ ] **No Internet at all.** A connected machine prepares the k3s air-gap
      files and the image archive (`preload-images.sh fetch-k3s` and
      `build`), and you have a way to copy them to the servers. The Mailpit
      and Garage images are added to the archive when you use them.
- [ ] **A private certificate authority.** You know who makes every
      participant's browser trust it (managed desktops, instructions for
      guests). External participants on their own devices will not trust it:
      public events need a publicly trusted certificate.
- [ ] **No object storage service.** Uploads and videos are needed or not. On
      one k3s server, `--storage garage` needs a third DNS name and room on
      the disk (50 GiB by default); elsewhere, a bucket with CORS for uploads
      from browsers ([Object storage](../configuration/storage.md)).
- [ ] **No DNS API.** Certificates come from ACME over port 443
      (`--tls acme`, reachable from the ACME server), or from your
      organization (`--tls own`).
- [ ] **Intranet only.** Every participant is inside your network; the
      server keeps its private address, and certificates can come from your
      internal authority.
- [ ] **Recordings.** Jibri composite recording needs a managed cluster;
      uploading and publishing videos needs object storage.
- [ ] **A load balancer, reverse proxy or WAF in front.** Its addresses are
      known, to trust them in Traefik or in the ingress and to set
      `TRUSTED_PROXY_HOPS`
      ([Client address and rate limits](../CONFIGURATION.md#client-address-and-rate-limits)).
      On k3s this needs the manual procedure.

## Services and accounts

Gather these before you start.

- [ ] **DNS names**: the portal and the conference, and on k3s `s3.<portal>`
      and `turn.<portal>` for the add-ons, as `A` records for the server's
      public address. `getent hosts <name>` answers with it.
- [ ] **Certificates** for every name, or the choice of ACME or of a private
      authority ([Certificates](k3s.md#certificates),
      [DNS and TLS](../INFRASTRUCTURE.md#dns-and-tls)).
- [ ] **An SMTP relay** reachable from the server, with a sender address and
      its credentials, and the SPF and DKIM records that the relay gives you
      published with a DMARC policy for the sender's domain
      ([Email delivery](../configuration/email.md)). Until it is ready,
      `--mailpit` on k3s keeps the emails in a test mailbox.
- [ ] **Access to the images**: Docker on the workstation to build them, since
      the published images refuse anonymous pulls today, or read access to the
      packages ([Registry access](README.md#registry-access-to-the-published-images)).
- [ ] **Object storage credentials**, when you use your provider's: static
      keys with the permissions in
      [Creating buckets and containers](../configuration/storage.md#creating-buckets-and-containers).
- [ ] **The database**: in the cluster (the simple profile, and k3s), or a
      managed PostgreSQL, which the standard and full profiles expect.
- [ ] **The firewall rules** requested: the k3s table in
      [Ports and firewall](k3s.md#ports-and-firewall), or the general one in
      [Ports and firewall](../INFRASTRUCTURE.md#ports-and-firewall).
- [ ] **A private place for the installation's files**, outside the
      repository, readable only by the people who administer it, with a
      backup that is encrypted and kept away from the server.

## Workstation and server preflight

`pa-webinar-up.sh` and `minikube-up.sh` check most of these themselves and
stop, or warn, before they change anything. The commands let you check ahead.

### The workstation, for k3s

- [ ] **The repository at the release you install**:
      `git describe --tags --exact-match` prints `vX.Y.Z`.
- [ ] **The tools**: `bash`, `helm version` 3.16.3 or later,
      `kubectl version --client` 1.35 to 1.37 (within one minor version of
      the k3s the scripts pin, v1.36; otherwise use `sudo k3s kubectl` on the
      server), `openssl`, `curl`, `ssh`. Linux was tested; macOS and Windows
      (WSL) were not.
- [ ] **Docker**, running (`docker info`), with room for the build: the
      migration image alone is 2.4 GB.
- [ ] **For the add-ons**: `curl --version` 7.75 or later.
- [ ] **For `--verify-call`**: Node.js 20 or later, `npm ci` at the
      repository root, and a Chromium (`npx playwright install chromium`) or
      Chrome. The script checks them at the start of each run, `--dry-run`
      included.
- [ ] **For backups**: `age --version` answers, and a key pair made on the
      workstation with `(umask 077; age-keygen -o key.txt)`. The public key
      it prints encrypts the backups; `key.txt` stays off the server, with a
      copy in your vault ([An encryption key, once](k3s.md#an-encryption-key-once)).
- [ ] **Remote access**: `ssh <user>@<server> sudo -n true` succeeds.
      Otherwise run the script on the server with `--local`.

### The server, for k3s

- [ ] **Size**: 4 vCPU, 8 GiB, 40 GB of disk at least (`nproc`, `free -g`,
      `df -h /var/lib`), plus the object store's volume.
- [ ] **System**: x86_64 with systemd; Debian 12 tested, Rocky Linux 9 tested
      for the node scripts.
- [ ] **Ports free**: `sudo ss -ltnup | grep -E ':(80|443|10000)\b'` prints
      nothing, or only k3s's own processes on a re-run.
- [ ] **Clock**: `timedatectl show -p NTPSynchronized --value` answers `yes`.
- [ ] **Firewall**: TCP 80 and 443, UDP 10000 (and UDP 3478 with TURN) open
      towards the server; ssh from the administrators; 6443 never from the
      Internet. A host firewall (firewalld, ufw) also trusts the pod and
      Service networks, `10.42.0.0/16` and `10.43.0.0/16`.
- [ ] **Outbound**: the server reaches, directly or through the proxy, the
      k3s downloads, the container registries, the ACME server with
      `--tls acme`, and the SMTP relay on its port.

### The workstation, for minikube

- [ ] **Memory**: 6 GB for the node, plus about 2 GB for each Chrome
      participant you open on the workstation.
- [ ] **Disk**: 30 GB for the node, about 3 GB of images on the host and as
      much for minikube's cache.
- [ ] **Tools**: minikube 1.38.1 or later, Helm 3.16.3 or later, kubectl,
      openssl, curl and Docker; `certutil` for `--trust-ca` (`nss-tools` on
      Fedora, `libnss3-tools` on Debian and Ubuntu).
- [ ] **Names**: `getent hosts app.127.0.0.1.nip.io` answers `127.0.0.1`;
      otherwise use `--domain sslip.io`.
- [ ] **No profile with the same name**: `minikube profile list`.
- [ ] **Docker's storage driver**: on btrfs minikube starts without its
      preload, a little more slowly.

## Post-install verification

- [ ] **The installation check passes**: `scripts/verify-install.sh` exits
      `0` (`1`: a check failed; `2`: it could not check). It can run as soon
      as an install or an upgrade returns: the conference's front end
      restarts each time, and the check retries the conference for up to
      90 s before it reports an error (`--conference-wait`).

  ```bash
  # one k3s server
  scripts/verify-install.sh --kubeconfig "$S/kubeconfig.tunnel" --secrets-file "$S/secrets.env" --call
  # minikube
  scripts/verify-install.sh --context pa-webinar \
    --ca-file ~/.config/pa-webinar/minikube/pa-webinar/ca.crt \
    --secrets-file ~/.config/pa-webinar/minikube/pa-webinar/secrets.yaml --call
  # any cluster
  scripts/verify-install.sh --kubeconfig <file> --context <context> --keys-from-cluster --call
  ```

  Add `--ca-file` for a private authority, `--resolve <address>` while the
  DNS records are not in place, and `--browser <path>` to use an installed
  Chrome. It never takes the instance key from the command line, and
  `--call` deletes the test call at the end.
- [ ] **The add-ons**, on k3s: `infra/onprem/k3s/addons/storage.sh --check`
      and `infra/onprem/k3s/addons/turn.sh --check` exit `0`
      ([Check the installation](k3s.md#check-the-installation)).
- [ ] **The post-install notes read**: every item under *Da controllare* ("to
      check") is resolved or understood (`helm get notes pa-webinar -n
      pa-webinar`; on k3s also `$S/helm-notes.txt`).
- [ ] **The first sign-in**, with **Sign in with the instance key** at
      `/en/admin/login`.
- [ ] **A named administrator**: **People** > **Accounts**, the
      **Administrator** role, **Send the sign-in link now**. The link arrives:
      that is the test of the SMTP relay.
- [ ] **A first event**: **New event**, a template or **Configure manually**,
      then **Publish event**. The wizard lands on the event page. A
      registration from another browser receives its confirmation email
      within about a minute.
- [ ] **An upload**, with object storage: an image or a material from the
      administration area opens again.
- [ ] **A call from two devices on different networks**, one of them outside
      yours: both hear and see each other. With TURN, one of the devices sits
      on a network that blocks UDP.

### A minikube evaluation, step by step

Each step with the result to expect ([First steps](minikube.md#first-steps)):

- [ ] `scripts/minikube-up.sh --trust-ca` ends with the summary line
      "PA Webinar è su minikube" ("PA Webinar is on minikube") and the three
      addresses.
- [ ] After a browser restart, the portal, the conference and Mailpit open
      without a certificate warning.
- [ ] The sign-in with the instance key opens the administration area.
- [ ] A published event lands on its page in the administration area.
- [ ] A registration from a second browser profile: the confirmation email
      in Mailpit within about a minute.
- [ ] The moderator link and the registrant's link, in two browser profiles:
      both hear and see each other.
- [ ] **System status** shows two participants and one conference;
      **Monitoring** > **Infrastructure** shows **Fixed mode**.
- [ ] **End for everyone** closes the room and shows the page with the
      feedback form.
- [ ] `scripts/verify-install.sh --context pa-webinar ... --call` exits `0`.
- [ ] When you are done, `scripts/minikube-down.sh --purge`, and the
      profile's name typed when it asks (`--yes` skips the question): the
      profile, its state folder, its images and the authority in the browser
      are gone.

## Go-live

Before the first public event. The owner is in each group's title.

### IT

- [ ] Certificates that every participant's browser trusts on every name:
      `--tls acme` or `--tls own`, not a private authority, for a public
      event.
- [ ] UDP 10000 reachable from outside, proved by a call from another
      network; with TURN, a call from a network that blocks UDP.
- [ ] The real SMTP relay in place of the test mailbox (`--smtp-file`), with
      SPF, DKIM and DMARC published; a sign-in link and a registration
      confirmation received outside your domain.
- [ ] Backups scheduled (`--backup`, and `scripts/backup.sh` encrypted,
      with `--include-storage` when the object store is Garage), copied off
      the server, and a [restore drill](#restore-drill) done.
- [ ] The state folder, `secrets.env` included, copied encrypted away from
      the workstation or the server that holds it.
- [ ] Monitoring: `verify-install.sh --quiet` from cron, an uptime check on
      `/api/health`, and someone who reads the alerts
      ([Monitoring](k3s.md#monitoring)).
- [ ] Staff sign in under their own names; the instance key is in a vault.
- [ ] The [security hardening](#security-hardening-for-one-server) done.
- [ ] A load balancer or WAF in front, if any: `trustedIPs` and
      `TRUSTED_PROXY_HOPS` set, and the audit log shows real client
      addresses.
- [ ] No upgrade planned during the event, and an upgrade window agreed.

### DPO

- [ ] The privacy notice filled in under **Settings**, and its retention
      periods matched to the events' retention
      ([Privacy and data protection](../GDPR.md)).
- [ ] Processor agreements with whoever hosts the server, the SMTP relay and
      the object storage.
- [ ] The record of processing updated, with the choices that affect it: no
      third-party STUN server (the k3s and minikube overlays use none),
      recordings and AI post-production if used, the retention of backups
      (a dump keeps personal data for as long as it is kept).
- [ ] A policy for logs that store full addresses: moderator and participant
      links carry `?token=`, and conference addresses carry `?jwt=`
      ([Logging](../architecture/security.md#logging)).
- [ ] The procedure for data-subject requests known to the people who answer
      them ([What erasure deletes](../GDPR.md#what-erasure-deletes)).

### Communications

- [ ] The site filled in under **Settings**: the organization's name and
      logo, the legal notice, the accessibility statement and a reply-to
      address for emails ([Runtime settings](../configuration/runtime-settings.md)).
- [ ] The languages offered, with Italian active for event content.
- [ ] A test event end to end: the public page, registration, the
      confirmation email, the reminder, entering the room, the recap.
- [ ] Moderators briefed: the moderator link is a credential that does not
      expire; it is never shown while sharing the screen, nor pasted in a
      chat.
- [ ] Whether the status page (`/status`) is public, decided with IT.

## Security hardening for one server

- [ ] **Updates**: unattended security updates for the operating system
      (`unattended-upgrades` on Debian, `dnf-automatic` on RHEL-family
      systems), and a reboot window for kernel updates outside events.
- [ ] **ssh**: keys only (`PasswordAuthentication no`), no password login for
      root, access limited to the administrators.
- [ ] **Host firewall** that denies by default, and opens only ssh from the
      administrators, TCP 80 and 443, UDP 10000, and UDP 3478 with TURN; the
      pod and Service networks trusted as k3s requires.
- [ ] **The Kubernetes API**, port 6443, never reachable from the Internet:
      the ssh tunnel reaches it.
- [ ] **Secrets encrypted at rest** in the k3s datastore, which
      `install-server.sh` turns on: `sudo k3s secrets-encrypt status`.
- [ ] **The state folder** readable only by its owner (the script creates it
      0700, its files 0600), on an encrypted disk, and its copy encrypted.
- [ ] **The kubeconfig** held only by the administrators, never merged into
      a shared `~/.kube/config`.
- [ ] **The instance key** used only for emergencies and automation once
      named administrators exist; rotated if it may have leaked
      ([Secrets rotation](#secrets-rotation)).
- [ ] **The test mailbox removed** before real events (`--smtp-file`): it
      keeps sign-in links and has no password.
- [ ] **The clock** synchronized by NTP.
- [ ] **The backups**: their folders readable only by their owner, encrypted,
      and the key that decrypts them kept away from the server.

## Day-2 routine

### Weekly (IT)

- [ ] `scripts/verify-install.sh` without `--quiet`, read in full: warnings
      too, such as certificates close to expiry and the database disk.
- [ ] The week's backups present and copied off the server. In a backup
      folder of `backup.sh`, `sha256sum -c SHA256SUMS` passes. With Garage,
      one of them taken with `--include-storage`, outside events.
- [ ] The email outbox with no failed messages (the check reports them).
- [ ] Free space on the server: the database, the object store and the
      nightly dumps all live under `/var/lib/rancher/k3s/storage`.
- [ ] Operating system updates applied.

### Monthly

- [ ] A [restore drill](#restore-drill) (IT).
- [ ] New releases checked on the repository's releases page and in
      `CHANGELOG.md`: only the latest minor version receives security fixes
      (IT).
- [ ] The images you run scanned with your scanner, since published images
      are not scanned after publication (IT).
- [ ] Staff accounts reviewed under **People** > **Accounts**: people who
      left removed (IT, with Communications).
- [ ] Certificates: your own renewed before they expire; with a private
      authority, the script run once a year re-signs them (IT).

## Upgrade

Before every upgrade, on every platform:

- [ ] The release notes read, for every release between the one you run and
      the target: some releases restart the conference's components, which
      drops the calls in progress.
- [ ] A backup taken (`scripts/backup.sh`, with `--include-storage` when the
      object store is Garage) and copied off the server.
- [ ] No event live or being provisioned, and none due to start soon; the
      window announced.

### One k3s server, with the script

- [ ] `git fetch --tags && git checkout vX.Y.Z`, and
      `git describe --tags --exact-match` shows the tag.
- [ ] `infra/onprem/k3s/pa-webinar-up.sh --portal <portal> --dry-run`, then
      the same without `--dry-run` (add `--state-dir` if you gave one).
- [ ] Without registry access, the build of the new images, several
      minutes; with `--images archive`, a new archive from the new checkout
      passed with `--archive`.
- [ ] The installation check at the end of the run passes, with its call
      when `--verify-call` is remembered.
- [ ] The copy of `scripts/` on the server, used by cron, replaced with the
      new release's.

### k3s by hand, and three nodes

- [ ] The new checkout, its subcharts, and a new image archive imported on
      every node.
- [ ] Both image tags bumped in the site file.
- [ ] The dry run and the diff against the running release
      ([The upgrade procedure](../operations/upgrades.md#the-upgrade-procedure)).
- [ ] `helm upgrade` with the same layers, and the rollouts watched
      ([A.8 Install the chart](k3s.md#a8-install-the-chart)).
- [ ] Your copy of `traefik-config.yaml`, if you keep one, compared with the
      release's file.
- [ ] The installation check passes.

### minikube

- [ ] `git pull`, then `scripts/minikube-up.sh --images local` with the same
      `--profile`.
- [ ] A profile installed before the chart rendered the conference Ingress
      itself: the old Ingress deleted first, or the upgrade fails in the
      ingress controller's webhook
      (`kubectl --context <profile> -n pa-webinar delete ingress pa-webinar-jitsi-meet-web`).

### Managed clusters

- [ ] [The upgrade procedure](../operations/upgrades.md#the-upgrade-procedure):
      the profile, the overlay and the module's output of the new release,
      then your site file.
- [ ] The pull of the web image checked with the pull Secret
      ([Check that every image can be pulled](../operations/upgrades.md#check-that-every-image-can-be-pulled)).
- [ ] The digests of the floating `:dev` components recorded, or those
      components pinned.
- [ ] On ingress-nginx, when you switch to the chart's conference Ingress:
      the old Ingress deleted first
      ([The conference Ingress](../DEPLOYMENT.md#the-conference-ingress)).
- [ ] The rollouts watched, the Jitsi web pod's included, and the
      installation check passes.

## Restore drill

A backup is proven only by a restore. Monthly, or at least before the first
real event and after every upgrade that adds migrations (IT). On one k3s
server, from the workstation, with the tunnel to the API open and `key.txt`
the age key ([An encryption key, once](k3s.md#an-encryption-key-once)):

- [ ] A fresh backup, encrypted, with the state folder and, with Garage, the
      object store, outside events (the store stops for the copy):

  ```bash
  scripts/backup.sh --kubeconfig "$S/kubeconfig.tunnel" --state-dir "$S" \
    --include-storage --age-recipient age1...
  B="$S/backups/pa-webinar-<timestamp>"      # the folder it wrote
  ```

- [ ] The backup copied to your backup storage, and decrypted on a machine
      that holds the private key:
      `age -d -i key.txt "$B/database.dump.age" | head -c 5` prints `PGDMP`.
- [ ] The dry run exits `0`: checksums, decryption, key fingerprints and the
      absence of live events all verified.

  ```bash
  scripts/restore.sh --kubeconfig "$S/kubeconfig.tunnel" --from "$B" \
    --identity key.txt --include-storage --dry-run
  ```

- [ ] In a quiet hour, with no event live or scheduled, the restore itself:

  ```bash
  scripts/restore.sh --kubeconfig "$S/kubeconfig.tunnel" --from "$B" \
    --identity key.txt --include-storage --yes -- --call
  ```

  It exits `0`: the row counts match the manifest, the files are back, and
  the installation check with its call passes. The check reads the instance
  key from the cluster and the certificate authority from the state folder,
  so nothing else follows `--`. What was written between the backup and the
  restore is lost, which is why the backup is taken just before.
- [ ] The grace period of orphan recordings set back with the command the
      restore printed, after the **Orphans** tab of **Video recordings** was
      reviewed:
      `scripts/restore.sh --reset-orphan-grace <days> --kubeconfig "$S/kubeconfig.tunnel"`.
      The installation check stops warning about it.
- [ ] The time it took, and the result, recorded.
- [ ] Once a year, a rebuild on a spare server from the backup's state
      archive, database and files, to prove that everything needed is in the
      backup. This path has not been tested yet.

On another cluster, the same commands with `--kubeconfig <file>` and
`--context <context>`, and `--ca-file <file>` for a private authority.
`--include-storage` covers an object store that runs on a volume of the
cluster (`--storage-selector` for one other than Garage). A store outside the
cluster is backed up and restored with its provider's tools, to the same
moment as the database. The procedure behind each step is in
[Backup and restore](k3s.md#backup-and-restore) and
[Restore a backup](../operations/upgrades.md#restore-a-backup).

## Secrets rotation

What each key protects, and what changing it breaks, is in the
[Secrets map](../CONFIGURATION.md#secrets-map). On one k3s server the keys
live in `$S/secrets.env`, and a run of `pa-webinar-up.sh` applies that file to
the Kubernetes Secrets and restarts the portal when they changed. To give a
key a new value:

```bash
sed -i "s/^ADMIN_API_KEY=.*/ADMIN_API_KEY=$(openssl rand -hex 32)/" "$S/secrets.env"
infra/onprem/k3s/pa-webinar-up.sh --portal <portal>
```

Then refresh the encrypted copy of the state folder. In the manual `existing`
mode, change the Secret and restart the portal
(`kubectl -n pa-webinar rollout restart deployment/pa-webinar`).

| Key | Rotate | What else |
|---|---|---|
| `ADMIN_API_KEY` | Yes, whenever it may have leaked | New sign-ins with the instance key need the new value; sessions continue |
| `CRON_API_KEY` | Yes | The scheduled jobs read it at their next run. Restart the recorder controller if it runs, and update the ServiceMonitor's bearer if you use one |
| `SMTP_PASSWORD` and the other SMTP settings | Yes | On k3s, a new file with `--smtp-file` |
| `JITSI_JWT_SECRET` | Yes, outside events | Both Secrets take it from the same line. Then restart Prosody, which drops the calls in progress: `kubectl -n pa-webinar rollout restart statefulset/pa-webinar-jitsi-meet-prosody` |
| Object storage keys | Yes, at your provider; not scripted for Garage | Restart the portal |
| `REDIS_PASSWORD` | Possible, outside events. Not tested | Restart Redis and the portal together |
| `JICOFO_AUTH_PASSWORD`, `JVB_AUTH_PASSWORD` | Possible, outside events. Not tested | Restart Prosody, Jicofo and the bridge together: the chart does not restart them when an existing Secret changes |
| `APP_SECRET` | **Never** on an installation that holds data | It signs every session, cookie and emailed link, and keys every stored email hash: staff, registrations and address-book entries could no longer be found by email |
| `PII_ENCRYPTION_KEY` | **Never** | Personal data written with it can no longer be read. There is no re-encryption |
| `POSTGRES_PASSWORD`, `POSTGRES_ADMIN_PASSWORD` | **Never** by changing the file | The database keeps the password it was initialized with: changing the Secret only breaks the login |

## Decommissioning

When an installation is retired. The owner is in brackets.

- [ ] **What must be kept** decided, and exported: published videos,
      reports, anything your retention obligations require (DPO, with IT).
- [ ] **Participants and staff informed**, and public pages taken down or
      redirected (Communications).
- [ ] **A final backup**, only if a retention obligation requires one:
      encrypted, with a deletion date (IT, DPO).
- [ ] **The installation removed.** On k3s,
      `infra/onprem/k3s/pa-webinar-down.sh --portal <portal> --k3s --purge --purge-images`
      deletes the release, the namespace with the database, the object store
      and the nightly dumps, k3s itself, the state folder's files, and the
      images built on the workstation. The state folder's `backups/` stays
      until you delete it
      ([Remove the installation](k3s.md#remove-the-installation)). On other
      clusters, `helm uninstall` keeps the backup volume
      (`helm.sh/resource-policy: keep`): delete the namespace, the volumes,
      the buckets and the managed database too (IT).
- [ ] **The disks wiped**, following your policy: deleting a volume does not
      overwrite it. Destroying the VM's disk is the simplest (IT).
- [ ] **The keys destroyed**: every copy of `secrets.env`, the kubeconfig, a
      private authority's key, and, once the last backup kept has been
      deleted, the key that decrypts the backups (IT).
- [ ] **Backups kept elsewhere** deleted at the end of their retention (IT,
      DPO).
- [ ] **DNS records and certificates** removed: the portal, the conference,
      `s3.` and `turn.`; a private authority removed from the browsers and
      the managed desktops that trusted it (IT).
- [ ] **The SMTP relay** no longer authorizes the sender (IT).
- [ ] **The record of processing** updated (DPO).
