# ADR-022: Only hosts in the recorded video, participants by voice

**Status:** Accepted

**Extends:** [ADR-020](020-consents-follow-event-format.md)

**Builds on:** [ADR-001](001-jitsi-iframe-api.md), [ADR-006](006-recording-and-storage.md) and [ADR-013](013-multitrack-speaker-attribution.md)

## Context

The composite video of an event (Jibri) must show only the people who host it: organizers,
moderators and speakers, and in an instant call its moderators. Participants must never appear in
it: no tile, no image, no name, no shared screen, and the stage must never move to them. Of a
participant with a valid recording consent the video keeps the voice; without that consent, not
even the voice. The portal marks a host's conference token with `context.user.paInVideo = true`.

Jitsi has one native way to keep a person out of the recorder's session: `hidden-from-recorder` in
the identity of the person's presence, honoured when the session has
`hiddenFromRecorderFeatureEnabled`. It removes the person entirely, voice included: the session does
not add them to its state (`USER_JOINED`) and drops all of their tracks (`TRACK_ADDED`). There is no
native "voice only". Configuration alone (tile view off, filmstrip off, display names off, receiver
constraints) cannot select people: the stage follows the dominant speaker, and moves to a participant
who speaks.

Jitsi's source is never changed ([ADR-001](001-jitsi-iframe-api.md)). The patched web image
([ADR-017](017-patched-jitsi-web-image.md)) is reserved for defects with no configuration point, and
rejected runtime injection for fixes because a silently broken injection goes unnoticed.

## Decision

1. **The server decides who is hidden.** `mod_pa_media_lock` writes `hidden-from-recorder` into the
   presence of every session whose token does not carry `paInVideo`, sessions without a token
   included. Of those, a participant whose token carries neither `voiceExcluded` nor `listenOnly` also
   gets `pa-recorder-voice`. The module rebuilds the identity on every presence, so the client can
   neither add nor remove the marks. A token without the key, issued before this rule, counts as a
   host's when its affiliation is `owner` or it carries `mediaExempt`.
2. **Jitsi's own feature keeps faces and names out.** Jibri's session leaves out everyone with
   `hidden-from-recorder`. A dominant speaker the session does not know leaves the stage on a host.
3. **A short script in the chart's conference text adds the voices.** It runs only in the page Jibri
   opens (`config.iAmRecorder` in the address and in the resolved configuration). It reads the
   conference from `APP.conference._room`, as Jibri's own call checks do, listens to its public track
   events, and plays through an audio element of its own each remote audio track whose current owner
   carries both marks. It changes nothing in Jitsi's code.
4. **Jibri's session runs without SSRC rewriting** (`flags.ssrcRewritingEnabled: false`, set by the
   same script). With rewriting, the session builds screen-share tiles from the presence of hidden
   members too, and a participant's screen share would put an empty tile on the stage.
5. **The portal learns what the video can hold from the chart.** The chart sets
   `RECORDING_VOICE_EXCLUSION` when the conference text has the hidden feature and
   `RECORDING_PARTICIPANT_VOICE` when it has the script; `partecipantiNelVideo` turns them into
   `solo-voce`, `esclusi`, `visibili` or `assente`. The consent rule and every text the portal
   shows derive from that one answer, and none promises more than it guarantees: with `esclusi`
   the recording consent is not asked, because it would cover nothing in the video, and with
   `visibili` the texts say that a name can appear.

## Consequences

- The privacy guarantee rests on Jitsi's feature and on a server-side mark; the script only adds
  sound. If an upgrade breaks the script, participants' voices go missing from the video and nobody
  appears who should not. The Jitsi upgrade checklist has a recorded call that tests it.
- The per-participant recorder records a hidden track only when it carries `pa-recorder-voice`, so it
  ships with the module.
- Jibri's call checks count only hosts. With Jibri's values a recording would end 30 seconds after the
  last host left, and after 10 minutes in which every host kept microphone and camera off while
  participants spoke. The chart relaxes them through Jibri's JVM options
  (`global.jibri.callStatusChecks`): `default-call-empty-timeout` 5 minutes, the time to come back
  after a dropped line; `all-muted-timeout` and `no-media-timeout` 30 days, never in practice.
  Participants' voices are received media even though Jibri's session never shows them, so a call
  where only participants speak is not cut. A broken media connection is still caught by Jibri's ICE
  check, and a recording also ends when a moderator stops it or the conference ends.
- Jibri's session receives every source of the conference, as the per-participant recorder already
  does, instead of a fixed set of rewritten ones.
- With an external Jitsi, or a values file that replaced the chart's conference text, the guarantee
  does not hold (`visibili`): participants can appear with face and name, even silent in the
  thumbnails. The portal keeps listen-only for scheduled events there and does not offer recording in
  instant calls. The recording box there shows the text that covers name, voice and image, and only
  a consent given on that text counts.
- Where the conference text hides participants but does not play their voices (`esclusi`), the video
  holds the hosts only, nobody is asked the recording consent, and instant calls still offer
  recording. The voice mark of a participant there follows the transcription consent, which the
  per-participant recorder and the captions transcript need; a conference text that gains the script
  must come with `RECORDING_PARTICIPANT_VOICE`, or those voices would reach the video.

## Alternatives considered

- **Mark the hosts and hide everyone else in the script.** The privacy part would depend on injected
  code reaching into Jitsi's state, and a broken script would put participants back in the video.
- **Hide every participant and mix their voices back from the per-participant tracks after the
  event.** Depends on the optional recorder, on timing alignment and on a new post-production step.
- **Patch the web bundle.** Excluded by ADR-001 and not needed.
