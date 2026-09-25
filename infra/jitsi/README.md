# Jitsi extras: Prosody module and Jibri finalize scripts

This directory holds the pieces of PA Webinar that run inside Jitsi components instead of in the portal.
Neither piece changes Jitsi's source code. The Prosody module loads from the image's plugin directory,
and Jibri calls the finalize script as a hook after each recording. The page
[How PA Webinar extends Jitsi Meet](../../docs/architecture/jitsi-integration.md) explains where these
pieces sit on the Jitsi boundary.

| Path | What it is | What runs it |
|---|---|---|
| `prosody-plugins/mod_token_affiliation_custom.lua` | A Prosody MUC module that sets each occupant's room affiliation from the portal's JWT | Only the Docker Compose stack. The Helm chart does not load it |
| `jibri-finalize.sh` | A standalone Jibri finalize script | Nothing in the repository. The chart ships a different script, `infra/helm/pa-webinar/files/jibri-finalize.sh` |

## The Prosody module

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

The module is a safety net for the community `token_affiliation` module, which ships in the stock
`jitsi/prosody` image (`/prosody-plugins-contrib`). That module reads the same `context.user` claims,
also accepting `context.user.moderator`, and applies them after the join instead of before it. The
token alone decides who is moderator only when Jicofo's auto-owner rule is off. With the rule on,
Jicofo also makes a participant moderator whenever the room has no owner, for example the first to
join, whatever the token says.

### Where it is loaded

**Docker Compose.** `docker-compose.yml` is the reference wiring. It mounts `infra/jitsi/prosody-plugins/`
read-only at `/prosody-plugins-custom` in the `prosody` service and sets
`XMPP_MUC_MODULES=token_affiliation,token_affiliation_custom`. On the `jicofo` service it turns off the
auto-owner rule with `ENABLE_AUTO_OWNER=false`.

**Helm chart: known limitation.** The chart does not mount the module, does not enable
`token_affiliation` and does not turn off auto-owner. What that means inside a conference is described
in [Server-side role enforcement](../../docs/architecture/jitsi-integration.md#server-side-role-enforcement),
and the gap is tracked in the [roadmap](../../docs/ROADMAP.md). The example `values-production.yaml`
sets `jitsi-meet.jicofo.env.JICOFO_ENABLE_AUTO_OWNER`, which has no effect: the subchart reads Jicofo
variables only from `extraEnvs`, and Jicofo reads `ENABLE_AUTO_OWNER`.

To reproduce the Compose wiring on Kubernetes, create a ConfigMap from the module and mount it through
the subchart's extension points:

```bash
kubectl -n pa-webinar create configmap prosody-token-affiliation \
  --from-file=infra/jitsi/prosody-plugins/mod_token_affiliation_custom.lua
```

```yaml
jitsi-meet:
  prosody:
    extraEnvs:
      XMPP_MUC_MODULES: token_affiliation,token_affiliation_custom
    extraVolumes:
      - name: prosody-token-affiliation
        configMap:
          name: prosody-token-affiliation
    extraVolumeMounts:
      - name: prosody-token-affiliation
        mountPath: /prosody-plugins-custom/mod_token_affiliation_custom.lua
        subPath: mod_token_affiliation_custom.lua
  jicofo:
    extraEnvs:
      ENABLE_AUTO_OWNER: "false"
```

- `extraEnvs` is a map, so it merges with the chart defaults. `extraVolumes` and `extraVolumeMounts`
  are lists, so they replace any value set in an earlier values file.
- The upgrade restarts Prosody and Jicofo because their configuration changes.
- A later change to the module file does not restart anything: recreate the ConfigMap, then restart
  Prosody.

Then check in a real call that a participant gets no moderator badge and cannot mute others, that a
moderator can mute others, and that recording still starts.

A smaller variant uses `token_affiliation` without this module. It is shown in
[Server-side role enforcement](../../docs/architecture/jitsi-integration.md#server-side-role-enforcement).

## The Jibri finalize scripts

Jibri runs a finalize script after each composite recording and passes the recording directory as the
only argument. The repository contains two scripts named `jibri-finalize.sh`, and they behave
differently.

### Which script the chart uses

The chart uses `infra/helm/pa-webinar/files/jibri-finalize.sh`. When `jitsi.enabled` and
`jitsi-meet.jibri.enabled` are both true, `templates/configmap-jibri-finalize.yaml` renders the script
into the ConfigMap `<fullname>-jibri-finalize` under the key `finalize.sh`. For a release named
`pa-webinar`, the ConfigMap is `pa-webinar-jibri-finalize`.

The chart renders that ConfigMap but does not mount it, and sets none of the script's variables in the
Jibri container. [Setting up recording](../../docs/operations/recording-setup.md#mount-the-finalize-script)
shows how to mount it and pass `APP_INTERNAL_URL`, `CRON_API_KEY` and `RECORDING_WEBHOOK_SECRET`. Pass
the two secrets through `jitsi-meet.jibri.extraSecrets`, which exposes only the keys you name. Two
alternatives suggested elsewhere in the repository expose more:

- The script's header comment suggests `jitsi-meet.jibri.extraEnvs`. The subchart writes `extraEnvs`
  into a ConfigMap, so a secret placed there is stored in plain text and readable by anyone who can
  read ConfigMaps in the namespace.
- The comment in `values.yaml` suggests `jitsi-meet.jibri.extraSecretsFrom` on the app Secret. That
  loads every key of the app Secret, such as `DATABASE_URL` and `PII_ENCRYPTION_KEY`, into the Jibri
  container.

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
| Shipped by | The chart, as ConfigMap `<fullname>-jibri-finalize` | Nothing |
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
  - the presence of `token_affiliation` in the `jitsi/prosody` image.

  Wherever the module is loaded, check that Prosody logs `Set affiliation to ...` on each join. Then
  repeat the moderator and participant call test above.
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
