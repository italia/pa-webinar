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
`XMPP_MUC_MODULES=token_affiliation,token_affiliation_custom,pa_media_lock`. On the `jicofo` service it
turns off Jicofo's authentication (`JICOFO_ENABLE_AUTH=false`) and the auto-owner rule
(`ENABLE_AUTO_OWNER=false`), as the chart does.

**Helm chart.** The chart's `values.yaml` sets the wiring by default, on every profile:

- `jitsi-meet.prosody.extraEnvs.XMPP_MUC_MODULES: token_affiliation,token_affiliation_custom,pa_media_lock`;
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
