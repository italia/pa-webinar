# Load-test toolkit

This directory holds the tooling for load-testing the conference side of a PA Webinar installation with
the `MalleusJitsificus` scenario of [jitsi-meet-torture](https://github.com/jitsi/jitsi-meet-torture):
a container image that runs the bots from a workstation, the scripts that mint their tokens, and the
manifests for an in-cluster run. This page is the tool manual, written for maintainers who run the
bundled container.

- The method, what to watch, the success criteria and the reference measurements are in
  [Load testing and reference measurements](../../docs/LOAD-TESTING.md).
- Running the bots inside the cluster, on a Selenium Grid, is covered by the runbook
  [In-cluster load test with Selenium Grid](SELENIUM-GRID.md).

> **Never run a load test during a real event.** The bots share the ingress, Prosody, Jicofo and the
> bridges with real participants, and preparing the target restarts the Jitsi web pods.

## Files in this directory

| File | What it is |
|---|---|
| `Dockerfile` | The toolkit image: Chrome, a matching chromedriver, a virtual display and a patched copy of jitsi-meet-torture. |
| `run-torture-local.sh` | The image's entrypoint. It mints a token and runs Malleus from the environment variables. |
| `run-local.sh` | A wrapper that builds the image if needed and runs it with Podman, or Docker when Podman is absent. |
| `mint-jwt.sh` | Mints a wildcard-room moderator token with `openssl` and `jq`. The entrypoint uses it, and so does the grid runbook. |
| `mint-jwt.mjs` | A Node alternative that mints a token for one room, as a participant or a moderator. |
| `run-torture.sh` | Runs Malleus from a local checkout of jitsi-meet-torture, without the image. It has none of the image's fixes (see [Other entry points](#other-entry-points)). |
| `selenium-grid.yaml`, `torture-job-selenium.yaml` | The in-cluster run, documented in [SELENIUM-GRID.md](SELENIUM-GRID.md). |
| `k8s-job.yaml` | A Job that runs Chrome inside the Maven container. Chrome exits on startup there, so the file is kept as a reference only (see [Why the local-Chrome Job does not work](../../docs/LOAD-TESTING.md#why-the-local-chrome-job-does-not-work)). |
| `coherence-bots.mjs` | A harness for per-participant recording, not a capacity tool (see [Other entry points](#other-entry-points)). |

## Where the bots go

The bots open room pages on the conference host directly, with a token they carry themselves, and never
touch the portal, its database or its object storage. [Test topology](../../docs/LOAD-TESTING.md#test-topology)
draws their signaling and media paths. One consequence matters when you run this tool: while the scaler
is paused, the cross-bridge snapshot behind the status pages and `/api/metrics` expires (see
[Across bridges](../../docs/LOAD-TESTING.md#across-bridges)), so read each bridge directly, as in
[Watch the bridges](#5-watch-the-bridges).

## What the image contains, and why

Most parts of the `Dockerfile` exist because a run failed without them.

- **Base.** The official Maven image, which is Ubuntu-based and ships a Java 17 JDK, plus `xvfb`, `jq`,
  `openssl`, fonts and the libraries Chrome needs.
- **Google Chrome stable**, from Google's own apt repository. Ubuntu's `chromium` package is a
  transitional snap that cannot run in a container.
- **chromedriver**, from the Chrome for Testing latest-stable release at build time, so that it matches
  the Chrome version.
- **jitsi-meet-torture**, cloned from its default branch at build time, with its Maven dependencies
  pre-fetched on a best-effort basis so that a run does not start with a long download.
- **A usable fake camera file.** Malleus gives every bot the fake video file
  `resources/FourPeople_1280x720_30.y4m`, and jitsi-meet-torture does not ship it. It ships
  `fakeVideoStream.y4m`, a 320×180 clip at 5 frames per second. The build transcodes that clip with
  `ffmpeg` to 1280×720 at 30 frames per second and saves it under the name Malleus expects. The result is
  about 2.5 GB of raw video, which makes the image large.
- **The prejoin patch.** The build removes the `config.prejoinConfig.enabled=false` parameter that
  jitsi-meet-torture adds to every room URL (see issue 4 in
  [Troubleshooting](#troubleshooting)). The build fails if the parameter is still there after the
  patch, so an upstream change cannot silently undo it.
- **The entrypoint** `run-torture-local.sh` and the token script `mint-jwt.sh`.

The image is for `amd64` only: both the Chrome repository and chromedriver are x86-64 builds.

It pins nothing. Every build takes the current Chrome, chromedriver and jitsi-meet-torture, so two
builds made at different times can behave differently. Rebuild with `--no-cache` when you want the
current versions, and note when the image was built next to your results. If a run fails with
`session not created` and a Chrome version message, the two Google channels disagreed at build time;
rebuild later.

### What the entrypoint does

1. It checks that `JITSI_URL`, `JITSI_JWT_SECRET` and `JITSI_JWT_SUBJECT` are set.
2. It mints **one** token with `mint-jwt.sh`. Every bot of the run carries that same token.
3. It runs `mvn test` for `MalleusJitsificus` under `xvfb-run`, on a 1280×720 virtual screen: one
   conference, one bot joining per second, with `SENDERS` bots publishing both audio and video. Chrome
   runs as a normal windowed browser on the virtual display, not headless.
4. It adds the token and the mute overrides to each bot's room URL: `jwt=…`, and for senders
   `config.startWithAudioMuted=false` and `config.startWithVideoMuted=false`. For every bot it sets
   `config.startAudioMuted` and `config.startVideoMuted` to 99999 (see
   [Two settings with similar names](#two-settings-with-similar-names)).

> **The run log contains the token.** Malleus prints its extra URL parameters at startup, and the
> entrypoint puts the token there. That token grants moderator rights in every room of the installation
> until it expires. Keep the output of a run private and do not paste it into issues.

## Quick start

The commands use Podman. Docker takes the same flags; with Docker, the image is `pa-webinar-load-test`
instead of `localhost/pa-webinar-load-test`. Kubernetes examples use `pa-webinar` as both the Helm
release and the namespace.

### 1. Build the image

From the repository root:

```bash
podman build -t pa-webinar-load-test scripts/load-test/
```

### 2. Get the signing secret

The bots need a token that Prosody accepts, signed with the installation's `JITSI_JWT_SECRET`. The value
is in the application Secret, the one named by `secrets.existingSecretName` (chart default
`videocall-secrets`):

```bash
export JITSI_JWT_SECRET="$(kubectl -n pa-webinar get secret <app-secret> \
  -o jsonpath='{.data.JITSI_JWT_SECRET}' | base64 -d)"
```

Whoever holds this value can mint a moderator token for any room of the installation. Keep it out of
shared shells and CI logs, and unset it when you finish. The claims a token must carry are explained in
[A token that Prosody accepts](../../docs/LOAD-TESTING.md#a-token-that-prosody-accepts) and
[Minting tokens](#minting-tokens).

### 3. Prepare the target

For a full-media run the target must have the prejoin page disabled server-side, otherwise the bots
stop at the prejoin screen (issue 4 in [Troubleshooting](#troubleshooting)). The change rolls the Jitsi
web pods, so make it only when no call is running:

```bash
kubectl -n pa-webinar set env deployment/pa-webinar-jitsi-meet-web ENABLE_PREJOIN_PAGE=false
kubectl -n pa-webinar rollout status deployment/pa-webinar-jitsi-meet-web

curl -s https://meet.webinar.example.com/config.js | grep -A1 'prejoinConfig = {'
# the line after it must read: enabled: false
```

The web image is pulled again on every rollout (`pullPolicy: Always`); if the rollout stalls, see
[ImagePullBackOff on the Jitsi web pod](../../docs/operations/troubleshooting.md#imagepullbackoff-on-the-jitsi-web-pod).

Make this change with `kubectl` for the test only, not in the chart's values. Prejoin and peer-to-peer
matter only to pages that open the conference host directly; the portal already configures both for real
participants.

Then make sure the bridges stay up for the whole run. On an installation with the JVB scaler, a test
room has no event behind it, and the scaler takes the bridges down within a tick. Pause it and set the
bridge count by hand, or keep an event `LIVE`, as described in
[Bridges that stay up for the whole run](../../docs/LOAD-TESTING.md#bridges-that-stay-up-for-the-whole-run)
and [Pausing for maintenance or load tests](../../docs/operations/jvb-scaler.md#pausing-for-maintenance-or-load-tests).

### 4. Run a smoke test

Twenty bots, five of them senders, each staying five minutes:

```bash
podman run --rm \
  --shm-size=4g \
  --pids-limit=-1 \
  --ulimit nofile=65536:65536 \
  --ulimit nproc=65536:65536 \
  -e JITSI_URL=https://meet.webinar.example.com \
  -e JITSI_JWT_SECRET \
  -e JITSI_JWT_SUBJECT=meet.webinar.example.com \
  -e JITSI_ROOM=load-test-smoke \
  -e PARTICIPANTS=20 \
  -e SENDERS=5 \
  -e DURATION=300 \
  localhost/pa-webinar-load-test
```

The bots join the room `load-test-smoke0`: Malleus appends the conference index to the prefix.

To keep the reports, add `-v "$PWD/results:/torture/target/surefire-reports"` (with `:Z` on hosts that
enforce SELinux). With `SAVE_LOGS=true` the browser console logs land there too, in `logs/`.

### 5. Watch the bridges

Sample `/colibri/stats` on every bridge, every 30 seconds or so, from another terminal:

```bash
for p in $(kubectl -n pa-webinar get pods -l app.kubernetes.io/component=jvb \
    --field-selector=status.phase=Running -o name); do
  echo "== $p"
  kubectl -n pa-webinar exec "$p" -- curl -s http://127.0.0.1:8080/colibri/stats \
    | jq '{participants, endpoints_sending_video, endpoints_sending_audio,
           stress_level, bit_rate_upload, bit_rate_download}'
done
```

What each field means, and when a run passes, is in
[What to watch](../../docs/LOAD-TESTING.md#what-to-watch).

### 6. Restore the target

```bash
kubectl -n pa-webinar set env deployment/pa-webinar-jitsi-meet-web ENABLE_PREJOIN_PAGE-
kubectl -n pa-webinar rollout status deployment/pa-webinar-jitsi-meet-web
```

Do this by hand. A later `helm upgrade` does not remove the variable for you: Helm's three-way merge
leaves alone the fields that neither the old nor the new chart manifest sets, and a variable added with
`kubectl set env` is such a field. Then resume the scaler if you paused it.

### Why the container flags matter

- **`--pids-limit=-1` and `--ulimit nproc=65536:65536`.** Every Chrome runs several processes with many
  threads, and the JVM that drives them adds threads for every bot. All of them count against the
  container's process limit, and Podman applies one by default (`pids_limit` in `containers.conf`). When
  the limit is reached, thread creation fails and the JVM reports
  `java.lang.OutOfMemoryError: unable to create native thread`, typically somewhere past 15 bots.
  Host memory is not the problem.
- **`--ulimit nofile=65536:65536`.** Each browser holds many sockets and files open.
- **`--shm-size=4g`.** Room for the browsers' shared memory; the container default is 64 MiB. Chrome is
  also launched with `--disable-dev-shm-usage`, which jitsi-meet-torture adds whenever it disables the
  Chrome sandbox (its default), so this is a safety margin more than a hard requirement.
- **`MAVEN_OPTS`** is set by the entrypoint to
  `-Xss512k -Xmx6g -XX:+UseG1GC -Dwebdriver.http.factory=netty` unless you pass your own. These options
  size the Maven process. jitsi-meet-torture runs its tests through the Surefire plugin, which forks a
  separate JVM, and its `pom.xml` sets no `argLine`: heap and thread-stack settings in `MAVEN_OPTS` do
  not reach the JVM that drives the browsers. Lowering `-Xss` there does not raise the bot ceiling; the
  process limits above do.

`run-local.sh` sets `--shm-size` (from `SHM_SIZE`, default `4g`) but none of the other flags, so use the
explicit command above for runs beyond a handful of bots.

### Minting tokens

| Script | Room claim | Role | Use it for |
|---|---|---|---|
| `mint-jwt.sh` | `*`, any room | moderator (`affiliation: owner`) | The image, and the Secret of the grid runbook |
| `mint-jwt.mjs` | the room passed with `--room` | participant, or moderator with `--moderator` | Hand-made tests, `run-torture.sh` |

Both sign with HS256 and set `iss`, `aud` and `sub` from `JITSI_JWT_ISSUER`, `JITSI_JWT_AUDIENCE` and
`JITSI_JWT_SUBJECT`. Use the portal's values: Prosody accepts only the issuer and audience it is
configured with (`JWT_ACCEPTED_ISSUERS`, `JWT_ACCEPTED_AUDIENCES`; see
[The Prosody JWT secret](../../docs/DEPLOYMENT.md#the-prosody-jwt-secret)). For `sub`, the portal uses
its own `JITSI_JWT_SUBJECT`, or the conference host `NEXT_PUBLIC_JITSI_DOMAIN` when that is unset.

- **`mint-jwt.sh`** needs all four `JITSI_JWT_*` variables; the entrypoint supplies the defaults for
  issuer and audience, but a standalone call does not. Optional: `BOT_NAME` (default `LoadBot`),
  `JWT_TTL_SECONDS` (default `7200`) and `JITSI_JWT_APP_ID` (default `pa_webinar`, used only as the
  prefix of the `jti` claim). It prints the token, or writes it to the file given as its first argument.
- **`mint-jwt.mjs`** imports `jose`; run it from inside the repository after `npm ci` at the root, where
  the workspaces install it. Options: `--room` (required), `--name`, `--moderator` and `--ttl` (for
  example `2h`, the default). Set `JITSI_JWT_SUBJECT` explicitly: the script falls back to `meet.jitsi`,
  which is not the portal's fallback. It reads `JITSI_JWT_APP_ID` but does not put it in the token.

**The room suffix.** A token for one room must name the room the bot actually joins. With Malleus that
is the prefix plus the conference index, so `--room load-test` fails for a run whose prefix is
`load-test`: mint `--room load-test0`, or `--room '*'`.

## Environment variables

These are the variables of the image's entrypoint and of `mint-jwt.sh`, with the defaults set in those
scripts. The last column says whether `run-local.sh` forwards the variable into the container.

| Variable | Default | Meaning | `run-local.sh` |
|---|---|---|---|
| `JITSI_URL` | required | Public URL of the conference host, for example `https://meet.webinar.example.com` | yes |
| `JITSI_JWT_SECRET` | required | The installation's `JITSI_JWT_SECRET` | yes |
| `JITSI_JWT_SUBJECT` | required | `sub` claim, as the portal sets it | yes |
| `JITSI_JWT_ISSUER` | `pa-webinar` | `iss` claim; must be one of Prosody's accepted issuers | yes |
| `JITSI_JWT_AUDIENCE` | `jitsi` | `aud` claim; must be one of Prosody's accepted audiences | yes |
| `JITSI_JWT_APP_ID` | `pa_webinar` | Prefix of the `jti` claim | no |
| `BOT_NAME` | `LoadBot` | Display name carried in the token | yes |
| `JWT_TTL_SECONDS` | `7200` | Token lifetime; it must outlast the join ramp of the run | no |
| `JITSI_ROOM` | `load-test-room` | Room prefix; the bots join `<prefix>0` | yes |
| `PARTICIPANTS` | `20` | Total bots, or total clients in signaling-only mode | yes |
| `SENDERS` | `2` | Bots that publish audio and video; the others only receive | yes |
| `DURATION` | `300` | Seconds from each bot's join slot until it leaves; browser start-up counts against it | yes |
| `USE_LOAD_TEST` | `false` | `true` selects the signaling-only mode, which needs the load-test client on the target (see [Signaling only](#signaling-only-use_load_testtrue)) | yes |
| `SENDERS_PER_TAB` | `1` | Sender clients per browser tab; signaling-only mode only | yes |
| `RECEIVERS_PER_TAB` | `1` | Receiver clients per browser tab; signaling-only mode only | yes |
| `SENDER_TABS_PER_BROWSER` | `1` | Sender tabs per Chrome instance | yes |
| `RECEIVER_TABS_PER_BROWSER` | `1` | Receiver tabs per Chrome instance | yes |
| `SAVE_LOGS` | `false` | `true` saves each browser's console log with the reports | no |
| `MAVEN_OPTS` | see [above](#why-the-container-flags-matter) | Options for the Maven process | no |

`run-local.sh` also reads `IMAGE` (default `pa-webinar-load-test`) and `SHM_SIZE` (default `4g`), and
builds the image first when it is missing or when called with `--build`. It runs the container with
`-it`, so it needs a terminal.

**Timing.** Malleus gives the bots join slots one second apart, and each bot leaves `DURATION` seconds
after its slot, so they also leave one per second. All of them are in the room together for about
`DURATION` minus `PARTICIPANTS` seconds, less the time each Chrome takes to start. Choose `DURATION` well
above `PARTICIPANTS`.

## Modes

### Full media (`USE_LOAD_TEST=false`)

Every bot is a real Chrome. Senders capture the transcoded video and jitsi-meet-torture's bundled audio
file through Chrome's fake capture devices; receivers join without capturing anything and receive what
the bridge forwards (Malleus disables video autoplay on every bot). This is the mode that loads the
bridge, and every synthetic reference result in
[LOAD-TESTING](../../docs/LOAD-TESTING.md#reference-measurements) comes from it.

The generator is often the first limit. [Where to run the bots](../../docs/LOAD-TESTING.md#where-to-run-the-bots)
gives the per-browser budget and what to do when one workstation is not enough.

The `*_PER_TAB` variables have no effect in this mode: Malleus resets them to 1 and prints a warning.
Several tabs per browser do work, but Malleus lets at most 16 tabs of one browser send audio and
silently mutes the rest.

### Signaling only (`USE_LOAD_TEST=true`)

In this mode Malleus points the bots at `/_load-test/<room>` on the conference host, the path of Jitsi's
lightweight load-test client, instead of the full Jitsi Meet page. One tab can host several clients
(`SENDERS_PER_TAB`, `RECEIVERS_PER_TAB`), and `PARTICIPANTS` then counts clients, not browsers. For
example, `PARTICIPANTS=300 SENDERS=2 RECEIVERS_PER_TAB=25` needs about a dozen receiver tabs.

**The mode does not work out of the box: the Jitsi web image does not contain the load-test client.**
Neither the stock `jitsi/web` image nor the patched one includes it. `ENABLE_LOAD_TEST_CLIENT=true` on
the web container only adds nginx routes: `/_load-test/<room>` is rewritten to
`/usr/share/jitsi-meet/load-test/index.html`, and `/_load-test/libs/` is served from the `libs/`
directory beside it. Nothing is installed there, so without the client the route returns 404.

The client page and its scripts have to be placed at that path, for example with a volume or a derived
image. The current jitsi-meet source does not ship a page for that route. It builds the load-test client
only as a script (`npm run build:load-test`), and the jitsi-meet repository's own load tester
(`tests/malleus`) uploads it into each browser instead of serving it from the deployment. This toolkit
provides no tested way to install the client, and this mode has not been run against the chart's web
image.

If you do install the client, turn the route on for the test the same way as the prejoin change, and
revert it the same way:

```bash
kubectl -n pa-webinar set env deployment/pa-webinar-jitsi-meet-web ENABLE_LOAD_TEST_CLIENT=true
kubectl -n pa-webinar rollout status deployment/pa-webinar-jitsi-meet-web
# after the run:
kubectl -n pa-webinar set env deployment/pa-webinar-jitsi-meet-web ENABLE_LOAD_TEST_CLIENT-
```

Before a run, open `https://meet.webinar.example.com/_load-test/<room>` in a browser and check that the
load-test page loads. A 404 there means the client is missing from the web pods.

This mode loads Prosody, Jicofo, token authentication and the ingress, and puts little load on the
bridge. No reference result was measured this way: start with a small run and check in Prosody's logs
that the clients really join before you trust a large one.

## In-cluster runs

Use the Selenium Grid runbook, [SELENIUM-GRID.md](SELENIUM-GRID.md). It pauses the scaler, deploys a
Selenium hub with Chrome nodes, and runs Malleus in remote mode from a Job, with the token in a Secret
minted by `mint-jwt.sh`.

The grid does not use this image. Its Job runs jitsi-meet-torture unpatched. The prejoin parameter stays
in the room URL, so senders start without camera and microphone (issue 4) and have no video file. A grid
run publishes little or no media, and it validates joins, ICE and connection stability at scale, not
video throughput. [Adapting the run](SELENIUM-GRID.md#adapting-the-run) describes a variant with real
video that has not been run.

## Other entry points

### `run-torture.sh`

Runs Malleus on the host, from a checkout of jitsi-meet-torture that it clones into
`./.cache/jitsi-meet-torture` under the current directory (override with `TORTURE_DIR`). It needs a JDK,
Maven, Chrome and chromedriver on the host. It takes `JITSI_URL`, `JITSI_ROOM` and a ready token in
`JITSI_JWT`, which it passes as `-Dorg.jitsi.token`; `PARTICIPANTS` defaults to 50 here.

It has none of the image's fixes, so it suits signaling checks only:

- The checkout is unpatched: the room URL keeps the prejoin parameter, and the senders start without
  camera or microphone (issue 4 below).
- The fake video file Malleus asks for does not exist in a plain checkout (issue 3 below).
- It starts Chrome headless (`org.jitsi.malleus.enable.headless=true`); inside a container that fails as
  in issue 2 below.
- It joins every bot at once (`join_delay=0`), not one per second, so the
  [Timing](#environment-variables) notes above do not apply.
- `GRID_URL` sets `-Dremote.address` but not `-Djitsi-meet.isRemote=true`, the property that switches
  jitsi-meet-torture to remote browsers, so the browsers still start locally. Use the grid runbook for
  remote browsers.
- Mint its token with `--room '*'` or with the suffixed room name (see [Minting tokens](#minting-tokens)).

### `coherence-bots.mjs`

Drives a few sender bots with distinct names, each with its own token, that toggle their microphones and
join and leave on a stagger. It exists to validate per-participant recording and speaker attribution
(see [Recording](../../docs/architecture/recording.md)), not to measure capacity. It needs `puppeteer`,
which the repository's root workspaces do not install. Its variables are documented in its header.

## Troubleshooting

### Known issues

The image and the entrypoint already handle issues 1 to 4 and 7. They are listed so that nobody undoes a
fix by accident, and because they reappear in any setup built another way.

**1. `Driver server process died prematurely`.** Ubuntu's `chromium` package is a transitional snap
that cannot run in a container. The image installs Google Chrome stable from Google's repository and
chromedriver from Chrome for Testing.

**2. Chrome exits right after chromedriver starts it (`Chrome instance exited`).** Started headless
inside this container, Chrome exits on startup; the same happens with `k8s-job.yaml`. Headless works on
Selenium Chrome nodes, which the grid Job uses. The entrypoint therefore does not ask Malleus for headless
browsers and runs Maven under `xvfb-run`, so each Chrome is a normal windowed browser on a virtual
display. Do not add `org.jitsi.malleus.enable.headless=true` to the entrypoint.

**3. `getUserMedia.constraint_failed: Constraint could not be satisfied`.** Malleus points every bot at
`resources/FourPeople_1280x720_30.y4m`, and a plain jitsi-meet-torture checkout does not contain it.
The image transcodes the bundled clip to that name and format with `ffmpeg`.

**4. `Initialized with 0 local tracks`: no bot sends media.** Jitsi Meet starts without camera and
microphone when a page that is not embedded in an iframe carries `config.prejoinConfig.enabled=false` in
its URL; the browser log shows `Using prejoinConfig.enabled config URL overwrite implies starting without
media.` jitsi-meet-torture adds that parameter to every room URL. The fix has two halves: the image
removes the parameter, and the target must disable the prejoin page server-side
(`ENABLE_PREJOIN_PAGE=false`, see [Prepare the target](#3-prepare-the-target)), or the bots stop at the
prejoin screen. Real participants are not affected either way: the portal embeds the room and turns the
prejoin page off itself.

**5. `Audio unmute permissions set by Jicofo to false` is not a refusal.** lib-jitsi-meet logs the value
of Jicofo's "audio sender limit reached" flag with that wording. `false` means the limit has not been
reached and the bot may publish. The same holds for the video message. Ignore the line.

**6. The bots publish, but the bridge shows `endpoints_sending_video` at zero.** With two participants
in a room, Jitsi sends the media peer-to-peer and bypasses the bridge. Malleus enables peer-to-peer
unless told otherwise (`org.jitsi.malleus.enable_p2p`, which the entrypoint does not expose), and the
portal's own P2P switch-off never reaches bots that open the room directly (see
[Media path](../../docs/architecture/jitsi-integration.md#media-path)). Jitsi uses peer-to-peer only
while exactly two participants are present, so always run with three bots or more.

**7. `java.lang.OutOfMemoryError: unable to create native thread` past about 15 bots.** The container's
process limit, not memory. Run with `--pids-limit=-1` and `--ulimit nproc=65536:65536`, as in the
[Quick start](#4-run-a-smoke-test). See [Why the container flags matter](#why-the-container-flags-matter).

### Two settings with similar names

Jitsi has two unrelated start-muted settings, and the entrypoint sets both:

- `startWithAudioMuted` and `startWithVideoMuted` are booleans that apply to the client that sets them.
  The entrypoint sets them to `false` for senders.
- `startAudioMuted` and `startVideoMuted` are conference thresholds: every participant after the Nth
  starts muted. The Jitsi web image's `config.js` sets both to 10 by default (`START_AUDIO_MUTED`,
  `START_VIDEO_MUTED`), so in a run with more than ten bots the late senders would join muted. The
  entrypoint raises both thresholds to 99999.

Changing one when you meant the other produces runs where some senders publish nothing.

### Other failures

- **No bot joins, and Prosody logs no connection at all.** The token is rejected before the signaling
  connection opens: the secret, the issuer or the audience does not match Prosody's, or the room claim
  does not match the room (see [Minting tokens](#minting-tokens)).
- **Every page load fails on the certificate.** The entrypoint passes `-Dallow.insecure.certs=true`, but
  jitsi-meet-torture reads a property named `allowInsecureCerts`, so the flag has no effect. The target
  needs a certificate that Chrome trusts; only `localhost` is exempt. In an invocation you control,
  `-DallowInsecureCerts=true` is the property jitsi-meet-torture reads.
- **The bots join, then the bridge disappears.** The scaler scaled it down because no event needed it.
  See [Bridges that stay up for the whole run](../../docs/LOAD-TESTING.md#bridges-that-stay-up-for-the-whole-run).

## Checklist

Before a run:

- [ ] A window with no event: nothing `LIVE`, nothing inside its pre-scale window, no `IDLE` room anyone
  may wake and no instant call about to start.
- [ ] The bridges will stay up for the whole run: scaler paused and bridge count set by hand, or an event
  kept `LIVE`.
- [ ] For full-media runs, the prejoin page is off on the target, and `config.js` confirms it.
- [ ] At least three bots, and `DURATION` well above `PARTICIPANTS`.
- [ ] Nobody else in a call on the installation.
- [ ] The generator has free memory for every browser, an idle CPU, and no leftover containers
  (`podman ps`).
- [ ] A place for the results: the reports mount and the `/colibri/stats` samples.

After a run:

- [ ] `ENABLE_PREJOIN_PAGE` removed from the Jitsi web Deployment, together with
  `ENABLE_LOAD_TEST_CLIENT` and any load-test client you installed, and the rollout finished.
- [ ] Scaler resumed and bridge count restored, as the scaler page describes.
- [ ] `JITSI_JWT_SECRET` unset, and any saved log or file that contains a token deleted or kept private.
- [ ] Results recorded with the metadata listed in
  [Publishing results](../../docs/LOAD-TESTING.md#publishing-results), including when the image was
  built.
