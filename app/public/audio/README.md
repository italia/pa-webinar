# Waiting-room music

This folder holds `waiting-room-default.mp3`, the audio track bundled with PA Webinar. It is not
licensed under the European Union Public Licence (EUPL-1.2): see [Attribution and license](#attribution-and-license).

## When the bundled track plays

Waiting-room music is set per event, not per site. The waiting room shows the music toggle only
when both of these hold:

- the event is `PUBLISHED`, that is, before its room starts being prepared;
- the event has its own audio (`Event.waitingRoomAudioUrl`).

`app/src/components/live/audio-player.tsx` falls back to `/audio/waiting-room-default.mp3` when it
receives no URL, but `app/src/components/live/waiting-room.tsx` never renders the player without
an event audio. An event without its own audio therefore has no music toggle, and the bundled
track plays only for an event whose audio URL points at it.

## Playback

Visitors start and stop the music with a toggle; nothing autoplays. See
[The waiting room and the square](../../../docs/architecture/waiting-room.md#waiting-room-music).

## Setting or replacing the music

**Per event (recommended).** In the event wizard's **Basics** step, fill in **Waiting-room audio
(optional)**:

- **Upload a file.** Accepted types are `audio/mpeg`, `audio/wav`, `audio/ogg`, `audio/mp4` and
  `audio/webm`, up to the size cap in `app/src/app/api/admin/assets/upload-url/route.ts`. The file
  goes to the files storage domain and the portal serves it under `/api/assets/`, so it comes from
  the portal's own origin and the Content Security Policy needs no change. Uploading requires files
  storage to be configured; see [Object storage](../../../docs/configuration/storage.md).
- **Paste a URL.** It must be absolute. Audio on another host plays only if that host is allowed
  by the Content Security Policy `media-src` directive, which contains only the portal's own origin,
  `blob:` URLs, the recordings storage hosts and any hosts listed in `RECORDING_MEDIA_CSP_HOSTS`. See
  [Images and audio from other hosts](../../../docs/SECURITY-CSP.md#images-and-audio-from-other-hosts).

To use the bundled track for an event, enter its absolute portal URL, for example
`https://webinar.example.com/audio/waiting-room-default.mp3`. The value is copied when an event is
duplicated.

**The bundled file.** Replacing `waiting-room-default.mp3` changes the audio only for events whose
URL points at it. The file is part of `app/public`, which is copied into the container image, so
a replacement needs an image rebuild.

How to choose a track (style, file size and licensing) is covered in
[Branding and white-labeling](../../../docs/configuration/branding.md#waiting-room-music).

## Attribution and license

| Field | Value |
|---|---|
| File | `waiting-room-default.mp3` (MP3, stereo, about 2 min 21 s) |
| Title | Romantic Italian Melody - Amore al Mare (Love at the Sea) |
| Author | Grand_Project |
| Source | [Pixabay track page](https://pixabay.com/music/modern-classical-romantic-italian-melody-amore-al-mare-love-at-the-sea-501525/) |
| License | [Pixabay Content License](https://pixabay.com/service/license-summary/) |

What the Pixabay Content License allows and forbids, in its own terms:

- The content can be used for free and modified or adapted into new works.
- Attribution is not required. The credit above is given anyway.
- The content may not be sold or distributed "on a Standalone basis". The license defines
  standalone as "where no creative effort has been applied to the Content and it remains in
  substantially the same form as it exists on our website".

**To verify.** PA Webinar ships this file unmodified, in the public repository and in the
container image. Whether that counts as standalone distribution has not been settled. An
installation that wants to avoid the question can replace the file in its own image with a track
it holds the rights to, or remove it: no waiting room plays it unless an event points at it.

The project's license policy and the other bundled assets are listed in
[Third-party licenses](../../../THIRD-PARTY-LICENSES.md#bundled-assets).
