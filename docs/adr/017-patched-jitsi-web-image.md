# ADR-017: Patch the jitsi/web bundle by shape for fixes with no configuration point

**Status:** Accepted

## Context

[ADR-001](001-jitsi-iframe-api.md) embeds Jitsi Meet through the IFrame API and rules out a fork. A
change to the conference normally goes through the extension ladder: IFrame API commands,
configuration overrides, server-side Jitsi configuration, the portal-signed JWT with its Prosody
module, and a separate client on a hidden domain. Three defects that participants run into cannot be
fixed at any of those points.

1. **Advanced noise suppression silences microphones.** Jitsi's rnnoise filter runs as an audio
   worklet on a shared `AudioContext`. Jitsi creates that context without an explicit sample rate, so
   it takes the hardware rate. The worklet does not resample. On a device whose audio does not run at
   48 kHz (for example at 44.1 kHz), the worklet treats the samples as if they did, and the
   participant's microphone goes silent. Nothing appears in the UI or in any log, and the problem is
   noticed once the event has started. From outside the conference, the portal can only turn the
   filter on or off (`setNoiseSuppressionEnabled`). It cannot change how the filter runs.
2. **A hidden self view cannot be recovered.** Jitsi keeps a participant's "hide self view" choice
   in browser storage on the conference origin. The selector that decides whether the local tile
   shows combines three things with a logical OR: the configuration, the stored setting and the rule
   for visitors. A stored `true` therefore beats any configuration. The portal runs on another origin
   and cannot read or clear that storage. The portal already removes the control
   (`disableSelfViewSettings: true`), which prevents new cases. People who hid their tile earlier
   still see everyone except themselves, and their only ways out are clearing the conference origin's
   site data, which few participants know how to do, or joining from a private window.
3. **Reaction emoji swallow clicks.** The flying emoji of Jitsi's native reactions cross the toolbar.
   Their container has no `pointer-events` rule, so during a burst of reactions they catch the clicks
   meant for the toolbar buttons underneath. Native reactions are the default: the `SiteSetting`
   field `reactionsMode` defaults to `NATIVE` in `app/prisma/schema.prisma`. Every installation is
   therefore exposed unless it switches to the portal's own reaction bar.

No configuration key, IFrame API command or server-side setting reaches any of the three. Any fix
therefore has to change a Jitsi artifact. The fix also has to keep what ADR-001 protects: every
public administration (PA) that reuses PA Webinar inherits Jitsi upgrades, so an upgrade must stay a
tag change followed by a checklist, never a merge.

## Decision

**PA Webinar rebuilds the official `jitsi/web` image as `ghcr.io/italia/pa-webinar-jitsi-web` and
applies each fix to the image's built assets, not to Jitsi's source.** This is the one sanctioned
modification of a Jitsi artifact.

### What may be patched

- Only a defect that users of the conference experience, and only when no rung of the extension
  ladder reaches it.
- Never a feature, a theme or branding. The branding limits of ADR-001 still apply.
- Only the web image. Prosody, Jicofo and Jitsi Videobridge (JVB) run their upstream images.

### Patch the minified bundle by shape

Minified identifiers change with every upstream build, so `patch-bundle.mjs` never writes one down.
It finds each target by its structure and captures the minified names it needs. Each replacement must
pass these assertions:

- the pattern matches **exactly once**;
- the text to replace is unique in the bundle;
- after the replacement the old text is gone, and the new text appears exactly once.

The bundle has two patch points.

**Noise suppression at 48 kHz.** The shared context is created lazily in this shape, where `X` is the
module variable that holds it:

```js
X||(X=new AudioContext)
```

It becomes:

```js
X||(X=new AudioContext({sampleRate:48000}))
```

The Web Audio graph now resamples, and the worklet receives the rate it assumes. As a cross-check,
the script requires `X.audioWorklet.addModule` to appear in the bundle. This proves that `X` is the
context that loads the noise-suppression worklet, not another shared context. The local audio mixer
creates its context in a different shape (`this.audioContext=new AudioContext`), and the patch leaves
it untouched on purpose.

**An explicit `false` wins for self view.** Upstream decides the local tile's visibility in this shape.
The name of the visitor check is minified, so the script captures it:

```js
e["features/base/config"].disableSelfView||e["features/base/settings"].disableSelfView||<isVisitor>(e)
```

It becomes:

```js
(!1!==e["features/base/config"].disableSelfView&&(e["features/base/config"].disableSelfView||e["features/base/settings"].disableSelfView))||<isVisitor>(e)
```

An explicit `false` in the configuration now takes precedence over the stored value. A configured
`true`, or no value at all, behaves as upstream does, and visitors still have no self view. The
portal sends `disableSelfView: false` in `app/src/lib/jitsi/config.ts`, so a browser stuck with a
hidden tile recovers on its next join, on an image revision that carries this patch.

### Add CSS instead of editing it

The reaction overlay is fixed with a rule appended to `/usr/share/jitsi-meet/css/all.css`. A marker
comment containing `pa-webinar reactions overlay` comes first, then the rule:

```css
.reactions-animations-container,.reactions-animations-container *{pointer-events:none!important}
```

The emoji are decoration and nothing in them is clickable, so the rule removes no behavior. Because
it is appended rather than written into an upstream rule, a reordering of upstream CSS cannot break
it. The Dockerfile step makes four checks:

- the stylesheet exists;
- the upstream selector `.reactions-animations-container` is present, because a renamed class would
  leave the rule inert;
- the marker is not already there;
- the marker is present after the append.

The step is deliberately not idempotent. A marker that is already present means the base image is not
the pristine upstream image the build assumes, and a second copy of the rule would hide that.

### Fail loudly when a patch point disappears

Every guard exits with an error and stops the image build. Zero matches means that upstream changed
the structure or fixed the defect. More than one match means ambiguity. In both cases the build stops
instead of guessing, because a wrong guess in this image can silence every microphone in an event.

The publishing workflow checks again before anything is published. It builds the image without pushing
it, then extracts the patched assets from the new image and the original assets from the upstream base
image (`BASE_IMAGE`). It then checks that:

- each patched form appears exactly once;
- each upstream form is gone from the patched bundle and appears exactly once in the original bundle,
  so a missing target cannot pass as already fixed;
- the CSS marker appears exactly once in the patched stylesheet and not at all in the original;
- the patched bundle still parses (`node --check`).

The workflow then pushes the exact image it validated, without rebuilding it. The component README
describes [the workflow](../../infra/jitsi-web-patched/README.md#the-workflow) step by step.

## Consequences

### Bumping Jitsi is a tag change plus a real call

- The upstream build appears in three values that move together:
  - the `BASE_TAG` default in `infra/jitsi-web-patched/Dockerfile`, which local builds use;
  - `BASE_TAG` in `.github/workflows/jitsi-web.yml`, which the workflow passes as a build argument
    and which overrides the Dockerfile default;
  - `BASE_IMAGE` in the same workflow, which the checks compare against.

  A new `IMAGE_TAG` goes with them.
- When every assertion passes, the bump needs no code change. When one fails, the maintainer finds
  out whether upstream changed the shape or fixed the defect. A fixed defect loses its patch, and a
  changed shape gets a new pattern. An assertion is never loosened to make the build pass.
- The checks prove that a patch is present, not that audio works. A bump is not done until a real call
  has been made with a microphone that does not run at 48 kHz. That call also checks self view and
  reactions over the toolbar. The full procedure is the
  [Jitsi upgrade checklist](../architecture/jitsi-integration.md#jitsi-upgrade-checklist).
- The workflow runs on pushes to `dev` that touch `infra/jitsi-web-patched/` or the workflow file,
  and on manual dispatch. It never runs on pull requests. A local `docker build` of
  `infra/jitsi-web-patched/` runs the same exactly-one-match assertions, so a patch change can be
  checked before it is merged. The workflow's comparison checks run only in the workflow.
- An upstream `jitsi/web` release, security fixes included, reaches the installations that serve the
  patched image only after the image is rebuilt on the new base.

### The image has its own tag lineage

- The repository is separate from the app image. Tags name the upstream build they were made from, in
  the form `stable-<jitsi-build>-rnnoise`. A revision suffix such as `-r2` is added when the patches
  change on the same upstream build. Because the workflow pushes whatever `IMAGE_TAG` says, every
  patch change must come with a new, never-pushed value in the same commit. Reusing a value
  overwrites the previous image and leaves no rollback target.
- The app's release tags do not version this image, and the release workflow does not build it. An
  installation moves to a new conference image only when its `jitsi-meet.web.image` value changes,
  or when a tag it uses is overwritten, which the tag rule above forbids. The chart default in
  `infra/helm/pa-webinar/values.yaml` and the workflow's `IMAGE_TAG` are maintained separately and
  can differ. Aligning them is a rollout of the conference image, decided on its own and carried out
  through [upgrades and rollback](../operations/upgrades.md).
- Because the chart default can lag `IMAGE_TAG`, an installation that relies on it may serve a
  revision that lacks a later fix, such as self-view recovery. Check which patches the tag carries
  (the component README's
  [verification checklist](../../infra/jitsi-web-patched/README.md#verification-checklist)) before
  relying on a fix.
- The chart pulls the image with `pullPolicy: Always`, as a safety net in case a tag is ever
  rewritten. Because the chart's post-upgrade hook restarts the web pod (`configReloadHook`), and the
  pull policy is `Always`, every upgrade pulls the image again (see
  [the web pod restarts on every upgrade](../operations/upgrades.md#the-web-pod-restarts-on-every-upgrade)).
  Jitsi pods take pull secrets only from `jitsi-meet.imagePullSecrets`, so a missing credential
  leaves the web pod in `ImagePullBackOff`. Test the pull before upgrading, as described in
  [check that every image can be pulled](../operations/upgrades.md#check-that-every-image-can-be-pulled).

### The chart couples noise suppression to the image

- The portal keeps advanced noise suppression forced off unless `NEXT_PUBLIC_JITSI_RNNOISE_ENFORCE`
  is exactly `false` (spaces and letter case are ignored). The live page's Server Component reads the
  variable at runtime with `getPublicEnv()`, and `resolveRnnoiseEnforceOff()` in
  `app/src/lib/jitsi/rnnoise.ts` interprets it. Changing it therefore needs a pod restart, not a
  rebuild. A Helm change to `app.env` restarts the pods through the ConfigMap checksum.
- The two settings sit far apart in the values file: `app.env.NEXT_PUBLIC_JITSI_RNNOISE_ENFORCE` and
  `jitsi-meet.web.image`. The chart turns an inconsistent pair into a render error, so the upgrade
  stops before it starts instead of producing an event with silent microphones. The guard is
  `pa-webinar.validateRnnoise` in `infra/helm/pa-webinar/templates/_guards.tpl`, included by the app
  Deployment template.
- When the variable is `"false"`, the web image must count as patched. If the optional
  `jitsi.patchedWebImage`, which has no default in `values.yaml`, is a boolean, it decides. An
  operator who publishes the patch under their own name sets it to `true`. Otherwise the image counts
  as patched only if `jitsi-meet.web.image.repository` contains `pa-webinar-jitsi-web`. The guard
  checks the name, not the image contents, and it sees only `app.env`: a value injected through the
  app's Secret is not checked.

### Installations without the patched image

An installation that cannot or will not pull the image sets `jitsi-meet.web.image.repository` to
`jitsi/web` and `jitsi-meet.web.image.tag` to the upstream build that matches the `jitsi-meet`
subchart, and can drop the chart default `ghcr-secret` from `jitsi-meet.imagePullSecrets`. It must
keep advanced noise suppression off, which is the portal's default and which the guard enforces. It
loses the self-view recovery and the click-through reactions. The Docker Compose stack runs the stock
`jitsi/web` image, so local development runs without the three fixes.

### Licensing and personal data

- The image redistributes the Jitsi Meet web client (Apache-2.0) with modifications.
  `patch-bundle.mjs` and the Dockerfile are the complete record of what changes. The license position
  is in [THIRD-PARTY-LICENSES](../../THIRD-PARTY-LICENSES.md#modified-third-party-code).
- The patches change no processing of personal data. The self-view patch only changes how a setting
  already stored in the participant's browser is weighed against the configuration, and nothing new
  is stored or sent.

### Risks accepted

- Installations serve upstream JavaScript that the project has modified and upstream has never
  tested. The exactly-one-match rule, the syntax check and the real-call check contain this risk.
- The syntax check runs only when Node can parse the unpatched bundle. If it cannot, the workflow logs
  a warning and relies on the occurrence counts alone.
- The portal's explicit `disableSelfView: false` is what makes the self-view patch take effect. The
  guard tests in `app/src/lib/jitsi/config.test.ts` assert `disableSelfViewSettings: true` but not
  that value.

## Alternatives considered

### Forking jitsi-meet

A fork allows any change. It also turns every upstream release, security fixes included, into a
merge that each reusing administration would have to repeat, and it makes the project responsible for
building Jitsi's front end. ADR-001 rejects the fork, and a few small fixes do not justify one.
Patching the built bundle keeps the upstream image as the base. The whole difference is two
structural replacements and one appended CSS rule.

### Living with the defects

For noise suppression this is possible: the portal forces the filter off, which is the default and
what an installation without the patched image does. The cost is that no event can use advanced
suppression. The self-view defect has no workaround that an installation can apply: each affected
participant has to clear the conference origin's site data or join from a private window. The
reactions defect can be avoided only by
giving up Jitsi's native reactions: set `reactionsMode` to `CUSTOM` and use the portal's reaction
bar. The portal cannot reach the conference origin's storage to clear a hidden self view, and for
installations that want native reactions it cannot style the inside of a cross-origin iframe to make
the emoji click-through. Waiting for an upstream fix leaves those participants stuck until then.
The zero-match rule shows when upstream changes the code, and the patch can then be dropped.

### Runtime injection

The Jitsi subchart can append JavaScript to the served `config.js`
(`jitsi-meet.web.custom.configs._custom_config_js`). Code placed there runs in the conference page
before the bundle. It could wrap the `AudioContext` constructor, rewrite the stored settings or insert
a style element. This alternative was rejected for four reasons:

- It acts on everything that matches at runtime, not on one call site found at build time. A wrapped
  `AudioContext` constructor would also change the local audio mixer's context, which the bundle patch
  deliberately leaves alone.
- Rewriting stored settings depends on the internal format of Jitsi's persisted state. That format is
  not a public contract, and nothing checks it when the image is built.
- Nothing fails when a target disappears. After an upstream change the injected code becomes inert or
  wrong without any error, and the problem is noticed during a live event. That is the failure this
  decision exists to prevent.
- It puts executable fixes in a configuration file, where anyone who inspects the image would not look
  for them.

## Implementation notes

- **Image build.** The build is in `infra/jitsi-web-patched/Dockerfile`. A Node stage copies
  `/usr/share/jitsi-meet/libs/app.bundle.min.js` out of the base image and runs `patch-bundle.mjs` on it.
  The final stage copies the patched bundle back and appends the CSS rule to
  `/usr/share/jitsi-meet/css/all.css`.
- **Publication.** `.github/workflows/jitsi-web.yml` builds, validates and pushes the image. The
  exact checks, and the details that matter when repeating them by hand, are in
  [the workflow](../../infra/jitsi-web-patched/README.md#the-workflow). The runner, the triggers and
  the tag variables are described in
  [CI, images and releases](../development/ci-and-release.md#jitsi-webyml-the-patched-jitsi-web-image).
- **Chart.** The chart sets `jitsi-meet.web.image.repository`, `jitsi-meet.web.image.tag` and
  `jitsi-meet.web.image.pullPolicy`, and uses `jitsi-meet.imagePullSecrets`. The guard
  `pa-webinar.validateRnnoise` in `infra/helm/pa-webinar/templates/_guards.tpl` honors an optional
  `jitsi.patchedWebImage`, which has no default in `values.yaml`.
- **Portal.** The portal passes `disableSelfView: false` and `disableSelfViewSettings: true` in
  `app/src/lib/jitsi/config.ts`. It resolves the noise-suppression switch in
  `app/src/lib/jitsi/rnnoise.ts` and applies it in `JitsiRoom`
  (`app/src/components/jitsi/jitsi-room.tsx`). The tests in `app/src/lib/jitsi/rnnoise.test.ts` keep
  the switch read at runtime, and keep every value other than `false` on the safe side.

## Related

- [ADR-001: Embed Jitsi Meet through the IFrame API](001-jitsi-iframe-api.md), the rule this record
  makes its one exception to
- [How PA Webinar extends Jitsi Meet](../architecture/jitsi-integration.md), in particular
  [the patched web image](../architecture/jitsi-integration.md#the-patched-web-image) and
  [noise suppression and the patched image](../architecture/jitsi-integration.md#noise-suppression-and-the-patched-image)
- [Patched jitsi/web image](../../infra/jitsi-web-patched/README.md), for building, bumping and
  verifying the image step by step
- [Upgrades and rollback](../operations/upgrades.md)
- [CI, images and releases](../development/ci-and-release.md)
