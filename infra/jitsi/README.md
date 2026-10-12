# Jitsi extras: Prosody modules, Jibri finalize scripts, web overrides

This directory holds the pieces of PA Webinar that run inside Jitsi components instead of in the portal.
Neither piece changes Jitsi's source code. The Prosody modules load from the image's plugin directory,
and Jibri calls the finalize script as a hook after each recording. The page
[How PA Webinar extends Jitsi Meet](../../docs/architecture/jitsi-integration.md) explains where these
pieces sit on the Jitsi boundary.

| Path | What it is | What runs it |
|---|---|---|
| `prosody-plugins/mod_token_affiliation_custom.lua` | A Prosody MUC module that sets each occupant's room affiliation from the portal's JWT | The Docker Compose stack, from this folder, and the Helm chart, from an identical copy in `infra/helm/pa-webinar/files/prosody-plugins/` |
| `prosody-plugins/mod_pa_media_lock.lua` | A Prosody MUC module that switches on Jitsi's audio, video and screen-share moderation when the event does not grant them to participants | The same two places, the same way |
| `prosody-plugins/mod_pa_captions.lua` | A Prosody MUC module that marks every new room as open to bridge transcription, for live captions | The same two places, the same way |
| `prosody-plugins/mod_pa_occupants.lua` | A Prosody MUC module that tells the portal which token seat stands behind each bridge endpoint, so that the transcript from captions and the multitrack recorder follow each person's consent | The same two places, the same way |
| `jibri-finalize.sh` | A standalone Jibri finalize script | Nothing in the repository. The chart ships a different script, `infra/helm/pa-webinar/files/jibri-finalize.sh` |
| `web/custom-interface_config.js`, `web/custom-config.js` | Interface and config overrides that hide the Jitsi logo and links over the call | The Docker Compose stack, which mounts them into the `jitsi-web` container; the image appends them to the configuration it generates at startup. On Kubernetes the same settings go in the web component's custom configs of the deployment values |

## The role module

### What it does

`mod_token_affiliation_custom` hooks `muc-occupant-pre-join` at priority 100, so it runs on every join to
a conference room. It reads `affiliation` from the JWT's `context.user` object, which Prosody's token
authentication stores on the session. It then sets the occupant's room affiliation:

| What the session carries | Affiliation set |
|---|---|
| `context.user.affiliation` is `owner` | `owner`, which Jitsi treats as moderator |
| `context.user.affiliation` has any other value, or is missing | `member` |
| No token context, for example a component that logs in with a password | `member` |

The portal signs `owner` for moderators and `member` for everyone else, speakers included
(`app/src/lib/auth/jwt.ts`). The token also carries top-level `moderator` and `affiliation` claims and `context.user.moderator`, but the
module reads none of them. It logs every decision at `info` level with the occupant's JID. The claims
themselves are documented in
[Identity, access and tokens](../../docs/architecture/identity-and-access.md).

The module works next to the community `token_affiliation` module, which ships in the stock
`jitsi/prosody` image (`/prosody-plugins-contrib`). That module reads the same `context.user` claims,
also accepting `context.user.moderator`, and applies them after the join instead of before it. It then
sets the affiliation again nine more times over about nine seconds, to undo any role that Jicofo
assigns in between.

The token alone decides who is moderator only when Jicofo assigns no roles of its own:

- **Jicofo authentication on** (`ENABLE_AUTH` without `JICOFO_ENABLE_AUTH: "false"`): Jicofo makes
  every authenticated member of the room a moderator. With the portal's tokens every participant is
  authenticated, guests and registrants included. Setting Jicofo's `AUTH_TYPE` to `jwt` changes
  nothing here.
- **Jicofo authentication off, auto-owner rule on**: Jicofo makes a participant moderator whenever the
  room has no owner, for example the first to join, whatever the token says.
- **Both off**: Jicofo assigns no roles, and the Prosody modules decide from the token. Prosody still
  refuses every connection without a valid token, so turning Jicofo's authentication off does not
  let anyone in without one.

## The media lock module

### What it does

`mod_pa_media_lock` makes the event's participant limits hold on the bridge, not only in the room's
toolbar. The portal writes two claims into every token of an event (`app/src/lib/auth/jwt.ts`):

| Claim | Meaning |
|---|---|
| `context.user.mediaLock` | `{ audio, video, desktop }`: what the event does **not** grant participants (`participantsCanUnmute`, `participantsCanStartVideo`, `participantsCanShareScreen` off) |
| `context.user.mediaExempt` | `true` for speakers, who have full audio and video without moderating |

On the first join to a room that carries a lock, the module switches on Jitsi's audio/video moderation
(the stock `av_moderation_component`) for each locked media type, before any moderator joins, and
announces it on the component's behalf to every occupant and to Jicofo. Jicofo then keeps everyone who
is not allowed muted on the bridge, whatever their client does. Moderators are always allowed. A
speaker is added to the allowed list as soon as they join.

Three details matter when you read its logs or change it:

- the lock is switched on once per room. A moderator can lift it during the call from the control bar
  (**Participant mic**, **Participant video**), and it stays lifted until the room empties and is
  created again. In the same way, a change to the event's participant flags while the room is open
  reaches the room only when it is created again; until then the moderator's toggles decide;
- when a moderator switches moderation back on, the stock component starts again from an allowed list
  of moderators only; the module adds back the speakers who are in the room;
- Jicofo checks only the allowed list, not the room role: the module adds moderators to it as they
  join;
- the actor declared for the switch-on is Jicofo's own occupant (`/focus`), never the participant who
  joined first, because Jicofo allows the actor to unmute;
- the stock component adds to the allowed list anyone who becomes `owner` and never removes them. When
  Jicofo briefly promotes a joining participant (Jicofo authentication on, as in Docker Compose) and
  `token_affiliation` then restores the token's role, the module removes that participant from the
  allowed list again, unless the token marks them exempt.

The module logs every switch-on, admission and removal at `info` level.

### Where it is loaded

**Docker Compose.** `docker-compose.yml` mounts `infra/jitsi/prosody-plugins/` read-only at
`/prosody-plugins-custom` in the `prosody` service and sets
`XMPP_MUC_MODULES=token_affiliation,token_affiliation_custom,pa_media_lock,pa_captions,pa_occupants`, with
`PA_PORTAL_URL` for the occupants module. On the `jicofo` service it
turns off Jicofo's authentication (`JICOFO_ENABLE_AUTH=false`) and the auto-owner rule
(`ENABLE_AUTO_OWNER=false`), as the chart does.

**Helm chart.** The chart's `values.yaml` sets the wiring by default, on every profile:

- `jitsi-meet.prosody.extraEnvs.XMPP_MUC_MODULES: token_affiliation,token_affiliation_custom,pa_media_lock,pa_captions,pa_occupants`,
  and `PA_PORTAL_URL` for the occupants module;
- `jitsi-meet.prosody.extraVolumes` and `extraVolumeMounts`, which mount the ConfigMap
  `pa-webinar-prosody-plugins` at `/prosody-plugins-custom`. The chart renders that ConfigMap from its
  copies of the modules in `infra/helm/pa-webinar/files/prosody-plugins/`;
  `scripts/validate-chart.sh` fails when a copy differs from this folder;
- `jitsi-meet.jicofo.extraEnvs.JICOFO_ENABLE_AUTH: "false"` and `ENABLE_AUTO_OWNER: "false"`, so Jicofo
  assigns no roles.

What to know when you change it:

- `extraEnvs` is a map, so your values merge with the chart's. `extraVolumes` and `extraVolumeMounts`
  are lists: a values file that sets them replaces the chart's entries, and must repeat them. The render
  stops when `XMPP_MUC_MODULES` asks for one of the project's modules and nothing is mounted at
  `/prosody-plugins-custom`, and when Jicofo authentication is off but `XMPP_MUC_MODULES` has neither
  module.
- The ConfigMap name is fixed, because the subchart's values cannot compute it: one release per
  namespace.
- The first upgrade to a chart with this wiring restarts Prosody and Jicofo, and calls in progress
  drop. Schedule it outside events.
- A later change to the module file does not restart Prosody: the new file reaches the pod, and
  Prosody loads it at its next start. Restart the Prosody StatefulSet when no call is running.
- After Prosody restarts, restart Jicofo by scaling its Deployment to 0 and back to 1, not with
  `kubectl rollout restart`: a rolling restart runs the old and the new Jicofo side by side with
  the same XMPP identity, the new one is disconnected ("Replaced by new connection") and
  conferences do not start until it is restarted again.

**Checked in the lab** on minikube with the simple profile, with two browsers using lib-jitsi-meet and
tokens issued by the portal, in both join orders, and through the portal's room with a guest who joined
from the direct invite link:

- the portal moderator is `moderator`, registrants and guests are `participant`, whoever joins first;
- a participant's request to mute the moderator is refused (Jicofo logs `Mute not allowed`), and so is
  a participant's attempt to kick the moderator. A guest's `muteEveryone` through the IFrame API does not
  mute the moderator;
- the moderator can still mute and kick a participant;
- a conference starts when a participant joins before the moderator, and audio and video flow once
  both are in.

Recording was not part of the check: the simple profile has no Jibri. Jibri starts a recording only for
a moderator, and the portal moderator is one.

## The live captions module

`mod_pa_captions` makes rooms eligible for Jitsi's bridge transcription, which the live captions
service in `infra/captions/` uses. It acts only when Prosody's environment has
`PA_CAPTIONS_ENABLED=true`; otherwise it logs that captions are off and does nothing.

On `muc-room-created`, at priority -2 (after the stock room metadata component creates the room's
metadata), it writes two keys into the metadata of every room except the health-check room:

| Key | Why |
|---|---|
| `asyncTranscription: true` | Jicofo asks the bridge to stream audio to the transcription service only for rooms that carry it. Recent Jitsi versions refuse this key when a client sets it, moderators included, so only a server module can |
| `transcription.urlParams.room` | The room name. From `stable-10978` Jicofo appends these parameters to the transcription WebSocket address, so the captions service knows which event the audio belongs to and asks the portal for its language and vocabulary. Earlier versions ignore it: the portal then finds the event from the meeting id that the [occupants module](#the-occupants-module) reported, and without that module the service falls back to its default language |

The metadata alone transcribes nothing: transcription starts when a moderator turns captions on in the
room (`recording.isTranscribingEnabled`), and stops when they turn them off.

The module is wired like the others. With the Helm chart, `global.captions.enabled` sets
`PA_CAPTIONS_ENABLED` for Prosody and, for Jicofo, the transcription address
(`jicofo.transcription.url-template`, passed as a JVM option in `JAVA_TOOL_OPTIONS`), and renders the
captions service; the render stops when captions are on and `XMPP_MUC_MODULES` lacks `pa_captions`. In
Docker Compose the same settings come from the `CAPTIONS_*` variables described in `.env.example`, with
the `captions` profile.

## The occupants module

`mod_pa_occupants` tells the portal who is in a conference. The captions service and the multitrack
recorder know each voice only by its bridge endpoint; the module lets the portal map an endpoint to the
seat of the token that entered with it, and so to that person's consent to the transcription of what
they say ([Live captions](../../docs/architecture/live-captions.md#transcript-from-captions)).

On `muc-occupant-joined` and `muc-occupant-left`, for every room except the health-check room, it posts
a JSON body to `POST <PA_PORTAL_URL>/api/internal/jitsi/occupants`:

| Field | Value |
|---|---|
| `room` | The room name |
| `meetingId` | The room's meeting id, which the captions service receives from the bridge on every Jitsi version |
| `endpointId` | The resource of the occupant's nickname in the room: the id the bridge uses for that person's audio |
| `seatId` | `context.user.id` of the token |
| `action` | `joined` or `left` |
| `ts` | The send time, in seconds |

The header `x-pa-signature` carries the hex HMAC-SHA256 of the raw body. Its key is derived from
`JWT_APP_SECRET`, the conference token secret Prosody already holds: the HMAC-SHA256 of that secret over
the label `pa-occupants`, so a signature cannot serve as a conference token. The portal recomputes it
with `JITSI_JWT_SECRET`, which has the same value, and refuses the notification (`401`) when the
signature does not match or `ts` is more than 300 seconds away from its clock
(`app/src/lib/auth/prosody-signature.ts`). Without the header, the route accepts the portal's internal
key in `x-api-key`, like the other internal routes.

It sends no name and no address. An occupant without a token context, such as a component that signs in
with a password, is not reported, and neither is Jicofo (`focus`). The request does not wait for an
answer; a status other than `200` or `204` is logged at `warn` level with the prefix `Occupanti:`. The
portal finds the event by room name, exact first, then ignoring case, and stores the notification for
every event when live captions are available and on for the instance (the captions service installed
and the site setting on), whatever the event's own captions switch, and for every event with
per-participant recording; the meeting id also lets the captions service's requests find the event.
Otherwise, and for a room that belongs to no event, it stores nothing.

The module acts only when Prosody's environment has both `PA_PORTAL_URL` (the portal's internal address)
and `JWT_APP_SECRET`; otherwise it logs that at start and does nothing. Without it, the transcript from captions keeps no text and the multitrack recorder records no
track, because the portal cannot tell whose voice is whose.

The module is wired like the others, with one addition, the portal's address:

- **Helm chart.** `jitsi-meet.prosody.extraEnvs.PA_PORTAL_URL` points at the portal's Service by its full
  name, `<fullname>.<namespace>.svc.<global.clusterDomain>`, because Prosody's resolver does not use the
  pod's search domains; with `global.clusterDomain` empty it is the short name. With the chart's
  NetworkPolicy on, the application's policy admits the Prosody pods on the app port
  ([NetworkPolicy](../../docs/DEPLOYMENT.md#networkpolicy)).
- **Docker Compose.** The `prosody` service sets `PA_PORTAL_URL=http://app:3000`.

The signing secret needs no wiring of its own: `JWT_APP_SECRET` must already equal the portal's
`JITSI_JWT_SECRET` for anyone to enter a room
([The Prosody JWT secret](../../docs/DEPLOYMENT.md#the-prosody-jwt-secret)). Rotating it, outside events,
also rotates the signing key.

The render stops when `XMPP_MUC_MODULES` lists `pa_occupants` and nothing is mounted at
`/prosody-plugins-custom`, and when `recorder.enabled` is on but `XMPP_MUC_MODULES` lacks `pa_occupants`,
because the recorder would then record nobody. An upgrade with `--reuse-values` keeps the previous
list, so it stops there when that list lacks the module. `scripts/validate-chart.sh` also checks that the
mounted ConfigMap carries the module with its hook.

## The Jibri finalize scripts

Jibri runs a finalize script after each composite recording and passes the recording directory as the
only argument. The repository contains two scripts named `jibri-finalize.sh`, and they behave
differently.

### Which script the chart uses

The chart uses `infra/helm/pa-webinar/files/jibri-finalize.sh`. When `jitsi.enabled` and
`jitsi-meet.jibri.enabled` are both true, `templates/configmap-jibri-finalize.yaml` renders the script
into the ConfigMap `pa-webinar-jibri-finalize` under the key `finalize.sh` (also as
`<fullname>-jibri-finalize`, the name earlier versions documented for mounting by hand).

The chart mounts it at `/config/finalize.sh` and passes the script its inputs: `APP_INTERNAL_URL` in
`jitsi-meet.jibri.extraEnvs`, and `CRON_API_KEY` and `RECORDING_WEBHOOK_SECRET` through
`jitsi-meet.jibri.extraSecrets`, which exposes only the keys it names
([Setting up recording](../../docs/operations/recording-setup.md#mount-the-finalize-script)). Two
alternatives suggested elsewhere expose more:

- The script's header comment suggests `jitsi-meet.jibri.extraEnvs`. The subchart writes `extraEnvs`
  into a ConfigMap, so a secret placed there is stored in plain text and readable by anyone who can
  read ConfigMaps in the namespace.
- `jitsi-meet.jibri.extraSecretsFrom` on the app Secret loads every key of the app Secret, such as
  `DATABASE_URL` and `PII_ENCRYPTION_KEY`, into the Jibri container.

The page [Recording](../../docs/architecture/recording.md#from-mp4-to-recording-the-finalize-contract)
describes what the chart's script does and which webhook it calls. The Docker Compose stack has no Jibri
service, so no finalize script runs there.

`infra/jitsi/jibri-finalize.sh` is a standalone variant that nothing in the repository runs: no chart
template, Compose service or workflow references it. The code comments in
`infra/recorder/src/upload.ts` cite it for the webhook signature and the payload shape. The chart's
script uses the same signature and the same payload fields, without `participants`.

### How the two scripts differ

| | Chart script (`infra/helm/pa-webinar/files/jibri-finalize.sh`) | Standalone script (`infra/jitsi/jibri-finalize.sh`) |
|---|---|---|
| Shipped by | The chart, as ConfigMap `pa-webinar-jibri-finalize`, mounted in Jibri | Nothing |
| Upload | A `PUT` to a single-object write URL from `POST /api/internal/recording-upload-url`. Storage credentials stay in the portal | The command-line tool selected by `RECORDING_STORAGE_TYPE`: `azcopy`, `aws`, `gcloud` or `mc`. `local` skips the upload. Storage credentials must be in the Jibri container |
| Webhook address | Always `$APP_INTERNAL_URL/api/webhooks/recording` | `$RECORDING_WEBHOOK_URL`. No webhook when it is unset |
| Webhook payload | `roomName`, `recordingUrl`, `filename`, `duration`, `fileSize` | The same fields plus `participants`, which the portal stores encrypted on the `CallSession`. Without `jq` or `python3`, `participants` is left out |
| MP4 metadata | Unchanged apart from the faststart re-mux | Also writes the event title, the organizer name shown on the event, the date, the description and the list of registrants who joined (display name, join and leave times) into the file's metadata, read from `GET /api/internal/recording-metadata` |
| Room name taken from | The MP4 file name | The recording directory's name |
| `APP_INTERNAL_URL` or `CRON_API_KEY` missing | Exits with an error before uploading | Skips the metadata step and uploads anyway |
| Local recording directory | Deleted when the script reaches the end, including after a failed webhook call. Kept when the upload-URL request or the upload fails | Deleted at the end unless `RECORDING_STORAGE_TYPE` is exactly `local`. Kept when a command such as an upload fails and the script stops (`set -e`) |
| Webhook signature | `X-Webhook-Signature` when `RECORDING_WEBHOOK_SECRET` is set and `openssl` is available | Same |

### Known limitations

The repository has two scripts named `jibri-finalize.sh`; only the chart's is shipped.

- **Two scripts share one name.**
  - While both exist, check every change to the upload or webhook contract against both scripts.
  - `GET /api/internal/recording-metadata` returns the decrypted names and join and leave times of
    registrants who joined, to any caller holding `CRON_API_KEY`. The standalone script is its only
    caller in the repository.
- **The standalone script has defects**, which matter only if someone runs it:
  - The `azure-blob` branch uses `RECORDING_AZURE_CONTAINER` as the storage account's host name, always
    writes to a container named `recordings`, never reads `RECORDING_AZURE_CONNECTION_STRING`, and
    passes no credential to `azcopy`.
  - When `RECORDING_STORAGE_TYPE` is unset, the script defaults to `local` storage but then deletes the
    recording directory, so the file is lost.
  - The test meant to skip the webhook for `local` storage, `[ "$RECORDING_URL" != "file://"* ]`, never
    matches because `[` does no pattern matching. When `RECORDING_WEBHOOK_URL` is set, the script posts
    a `file://` URL to the portal.

## Re-verify on every Jitsi upgrade

No CI job lints or tests these files. The check below is the only one that covers them. Run it as part
of the [Jitsi upgrade checklist](../../docs/architecture/jitsi-integration.md#jitsi-upgrade-checklist).

- **Prosody module.** The module relies on these Jitsi internals:
  - the `muc-occupant-pre-join` hook;
  - the session field `jitsi_meet_context_user`;
  - `room:set_affiliation`;
  - the `/prosody-plugins-custom` plugin path;
  - the presence of `token_affiliation` in the `jitsi/prosody` image;
  - the `jitsi/jicofo` image reading `JICOFO_ENABLE_AUTH` and `ENABLE_AUTO_OWNER` in its configuration
    template: with the chart's values, the generated `/config/jicofo.conf` has no `authentication`
    block and has `enable-auto-owner = false`.

  Wherever the module is loaded, check that Prosody logs `Set affiliation to ...` on each join. Then
  repeat the checks listed under **Checked in the lab** above, with the moderator link and with a
  guest.
- **Occupants module.** `mod_pa_occupants` relies on the `muc-occupant-joined` and `muc-occupant-left`
  hooks, the session field `jitsi_meet_context_user`, the meeting id that the stock meeting-id module
  keeps in the room's data (`room._data.meetingId`), the occupant's nickname resource being the bridge
  endpoint id, `net.http` and `util.hashes`. In a room of an event, check that `room_occupants` gets a row for each
  person who joins, with their token's seat, and that Prosody logs no `Occupanti:` warning.
- **Finalize script.** The chart's script relies on:
  - the subchart's finalize path (`/config/finalize.sh` through `JIBRI_FINALIZE_RECORDING_SCRIPT_PATH`)
    and its `jitsi-meet.jibri.custom.other._finalize_sh` slot;
  - `curl`, `jq`, `ffprobe`, `ffmpeg` and `openssl` in the Jibri image;
  - Jibri's MP4 file name, `<room>_<yyyy-mm-dd-HH-MM-SS>.mp4`.

  The script takes the room name from that file name. If the format changes, the upload still succeeds,
  but the webhook finds no event, and after the next recordings reconcile run the file appears under
  **Video recordings** > **Orphans**. Unless an administrator marks it **Keep**, it is deleted when the
  orphan grace period (`orphanRecordingGraceDays`) expires. Make a test
  recording, as in
  [Check that Jibri works](../../docs/operations/recording-setup.md#check-that-jibri-works).

## Related pages

- [How PA Webinar extends Jitsi Meet](../../docs/architecture/jitsi-integration.md)
- [Recording: composite video and per-speaker audio](../../docs/architecture/recording.md)
- [Setting up recording](../../docs/operations/recording-setup.md)
- [Identity, access and tokens](../../docs/architecture/identity-and-access.md)
- [Roadmap](../../docs/ROADMAP.md)
