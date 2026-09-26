# Virtual backgrounds

This folder holds the virtual backgrounds that ship with PA Webinar. People choose one in the waiting
room's device check, and the live room applies it when they enter the conference.

## What they are

- **The catalog.** The list is `SFONDI_VIRTUALI` in `app/src/lib/jitsi/virtual-background.ts`. Each
  entry has a stable `id` and the path of an image in this folder. The first entry, `nessuno`, is the
  **No background** option. It has no image, and it is the default.
- **The picker.** The device check (`app/src/components/live/device-check.tsx`) shows the list as
  thumbnails under **Virtual background**, in catalog order. The display name of each background is
  its tooltip and its screen-reader label.
- **The stored choice.** The browser keeps the chosen entry's `id` in local storage, under
  `paw_sfondo_virtuale`. That stored value is why an `id` must stay stable (see
  [Removing or renaming a background](#removing-or-renaming-a-background)). When the browser blocks
  local storage, the picker still works, but the person enters the room with no background.
- **On entry.** The room fetches the chosen image and hands it to the conference as a data URI. The
  size rule under [Format](#format) follows from this.

How the choice reaches the conference, and what the remote command cannot do, are covered in
[Virtual backgrounds](../../../../docs/architecture/jitsi-integration.md#virtual-backgrounds) on the
Jitsi integration page. The picker is covered in
[Device check and virtual backgrounds](../../../../docs/architecture/waiting-room.md#device-check-and-virtual-backgrounds)
on the waiting-room page.

## Provenance and license

The images are abstract gradients made for this repository. They contain no photographs, no logos
and no third-party content. They are covered by the repository's license, the European Union Public
Licence (EUPL-1.2), and carry no attribution requirements of their own. They are recorded under
[Bundled assets](../../../../THIRD-PARTY-LICENSES.md#bundled-assets) in the third-party licenses page.

Why gradients rather than photographs:

- A photograph behind a speaker's face pulls attention away from the speaker.
- Photographs date quickly.
- In software built for reuse, every public administration would have to check the license of an
  image it did not choose.

Gradients avoid all three problems and stay readable behind a person. Prefer them for new
backgrounds too. An image under any other license needs its license text committed next to the file
and a row in [Bundled assets](../../../../THIRD-PARTY-LICENSES.md#bundled-assets), as the
[third-party rules](../../../../THIRD-PARTY-LICENSES.md#adding-a-third-party-component) require.

## Format

- JPEG, 1280×720 (16:9), the shape of the camera video.
- File names use lowercase letters and hyphens, with the `.jpg` extension.
  `app/src/lib/jitsi/virtual-background.test.ts` fails for any image path outside that pattern or
  outside this folder.
- Keep files small. The picker uses each full image as its thumbnail, so every visitor whose waiting
  room shows the device check downloads every background in the list. On entry the room fetches the
  chosen one again and hands it to the conference as a data URI.

## Adding a background

The backgrounds are part of the application image, not a runtime setting. Adding, renaming or
removing one is a code change followed by a rebuild. What a public body can brand without a rebuild
is in [Branding and white-labeling](../../../../docs/configuration/branding.md).

- [ ] Put the JPEG in this folder.
- [ ] Add an entry to `SFONDI_VIRTUALI`, with an `id` equal to the file name without its extension
      and the path `/images/virtual-backgrounds/<file>.jpg`. Keep `nessuno` first: the test requires
      the default to lead the list. The position of the new entry is its position in the picker.
- [ ] Add the display name under `deviceCheck.background.<id>` in `app/src/i18n/messages/it.json`
      and `en.json`, then run `node scripts/sync-i18n.mjs`. The script copies the English name into
      the other catalogs as filler.
- [ ] Replace the English filler that the script copied into the other catalogs with a translation.
- [ ] Run `npm run test --workspace=app`, then open the waiting room and check the picker in more
      than one language, Italian included.

`app/src/i18n/locale-parity.test.ts` checks every catalog against `it.json`. It fails when a name
present in `it.json` is missing or empty elsewhere. It does not notice a name missing from `it.json`
itself, or English filler left in place of a translation. A name missing from `it.json` shows in
Italian, the default language, as the raw key path `deviceCheck.background.<id>` in the tooltip and
the screen-reader label, so check the picker on the page. The i18n recipe is in
[Adding UI text or a language](../../../../docs/development/extending.md#adding-ui-text-or-a-language).

### Removing or renaming a background

An `id` is what the browser stores, so treat it as stable. When an `id` disappears from the list,
anyone who had chosen it falls back to `nessuno`, and the room sends "background off" rather than
asking the conference for an image that no longer exists. A rename has the same effect for people
who chose the old `id`.

To remove one, delete the file and its `SFONDI_VIRTUALI` entry, remove its name from `it.json` and
`en.json`, and run `node scripts/sync-i18n.mjs`, which drops keys that `en.json` lacks from the other
catalogs.
