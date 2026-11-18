# ADR-021: Recording content belongs to the organizers and the participants

**Status:** Accepted

**Extends:** [ADR-014](014-organizer-role.md) and [ADR-015](015-named-administrators.md)

**Builds on:** [ADR-006](006-recording-and-storage.md), [ADR-016](016-in-cluster-ai-postproduction.md) and [ADR-020](020-consents-follow-event-format.md)

## Context

Under [ADR-014](014-organizer-role.md) an administrator manages every event of the installation. Every staff guard let an administrator through without looking at the event (`requireEventManager`, `requireRecordingManager`, `requireSpeakerManager`, `eventScope`), and the rule that decides who sees a recording (`app/src/lib/recording/audience.ts`) treated any staff member who manages the event as staff. An administrator could therefore watch every recording, play every participant's isolated voice, read and edit every transcript, summary and report, and start new processing on any of them.

People who take part in an event consent to being recorded for that event: to be seen by its organizers, by the other participants and, when the event says so, by the public. They do not consent to being watched by whoever administers the installation. The administrator of a shared installation is often a technical office that has nothing to do with the event.

Some side doors led to the same content:

- **The moderator link.** The event page in the administration area gave every staff member who manages the event the primary moderator token, and so did the **Moderator links** directory and the instant-call list. The token publishes, unpublishes and deletes the event's recording.
- **Arbitrary video addresses.** A staff member could attach to an event, as its video, the storage address of another event's file. The app then signed that address for whoever could see the first event. The storage providers accepted any key in the bucket.
- **Storage addresses in browsers.** Several pages, APIs and the post-event email carried the canonical storage address of a video. On a store that serves objects publicly, the address alone is the content.
- **No trace.** Nothing recorded that a staff member had read a transcript or played a recording.

Instant calls had a gap of their own. Their participants are guests with no registration, so nothing let them see the recording of a call they were in. The call's link answered "not found" once the call had ended.

## Decision

**The content of a recording is for the organizers of its event and for its participants.** An administrator who does not organize the event sees that a recording exists and its metadata, never its content. The instance-key session never sees content. A recording published for everyone is visible to everyone, administrators included.

### What content is

Content is what a recording shows or says, and what is derived from it: the composite video, the per-participant tracks and the archive that joins them, the waveform, the transcripts (from the AI pipeline and from live captions) and their editor, the summaries, the event report, the translations, the subtitles and the dubbed audio. Reading, changing and producing content are all content operations: starting the pipeline, rerunning it, adding a translation, building the archive, building the transcript from captions, renaming a speaker, aligning the slides with the video, requesting or publishing the report, attaching a file or publishing the video.

Metadata stays with whoever manages the event, administrators included: that a recording exists, its status, duration and size, its files, its processing jobs and their errors, the quality figures of the transcript (counts, durations, confidence), which languages exist, and the cancellation of queued jobs.

### Who sees content

`app/src/lib/recording/content-access.ts` is the single rule for staff:

- **Organizers.** A staff account sees the content of an event it organizes: it created the event (`Event.createdById`), or a valid named grant marked as organizer carries the account's email fingerprint. This is the ownership rule of `eventScope` without the administrator shortcut (`ambitoOrganizzatore` in `app/src/lib/auth/staff-session.ts`), and it applies to every role. An administrator who created an event, or who uploaded a publication, is its organizer.
- **Not the instance key.** A session opened with `ADMIN_API_KEY` has no person behind it (`accountId` is null) and never sees content.
- **Exceptions.** `DEROGHE_CONTENUTO` is an explicit list of functions, empty by default, that can open the content of one surface of one recording to a staff account that does not organize the event, for a reason they verify themselves. An exception is evaluated only after the organizer check fails, never for the instance key, at every request, and any read it opens is logged with `via: "deroga"`. Its signature is `(richiesta: RichiestaDeroga) => Promise<boolean>`, where the request carries `accountId`, `ruolo`, `eventId`, `recordingId` and `superficie`.

Participants and the public go through `app/src/lib/recording/audience.ts`, which now uses the rule above for its staff branch:

- **Published for everyone:** anyone.
- **Reserved for registrants:** whoever proves a registration that still exists ([ADR-020](020-consents-follow-event-format.md)).
- **Instant calls:** whoever was in the call while it was recorded, through a presence pass (below), and its organizers. The call has no publication: they see the recording without one, until the call is deleted at the end of its retention.

### The guards

- `requireRecordingContent(cookies, recordingId, surface)`, `requireSpeakerContent(cookies, speakerId, surface)` and `requireEventContent(cookies, eventId, surface)` refuse a staff member who manages the event without organizing it with `403 RECORDING_CONTENT_ORGANIZER_ONLY`, which the interface explains. Someone who does not manage the event gets the plain `403` of the other guards.
- Routes and pages that list metadata filter content row by row with `accessoContenutoStaff` and `eventiOrganizzati`, and say so in a `contenuto` flag.
- `app/src/lib/auth/recording-content-access.test.ts` lists every content route with the guard of each method, requires every post-production route to declare whether it serves content or metadata, and requires the routes that hand out moderator links to filter them. `app/src/test/db/accesso-contenuto.db.test.ts` checks the behavior on a real database.

### The side doors

- **Moderator links** go only to the organizers of the event: on the event page, in the event list, in the **Moderator links** directory and in the instant-call list. An administrator who holds the link anyway (an email addressed to them, say) keeps using it as any moderator does: the event page keeps the token in the address for them. An administrator can still regenerate a link, to lock out a leaked one, and the new link does not come back to them. Without the link the administrator governs the event from the administration area (status, details, registrations, consents, archive, deletion) and sees an explanation where the organizer's controls would be. Editing the event, which saves through the moderator link, is for its organizers.
- **Video addresses.** A storage address can be attached to an event only if the file belongs to that event (`assertVideoDellEvento`), and the app signs an address only for its own event (`generateRecordingSasUrl`, `appartenenzaChiave` in `app/src/lib/storage/recordings.ts`). A key that names another event (`postprod/<eventId>/…`, `recordings/multitrack/<eventId>/…`), or that is the video, a recording or a call session of another event, belongs to that event. An uploaded file that no other event uses belongs to the event it is attached to. An address outside the installation's storage is not signed and stays as stored.
- **Storage addresses** never reach a browser or an email. The event page, the room, the event APIs, the call sessions, the recordings library, the monitoring view and the post-event email carry the app route that serves the file (`/api/events/<slug>/recording` for the event's video, `/api/events/<slug>/sessions/<id>/recording` for a call session's file), which checks access again and redirects to a short-lived signed address.
- **Trace.** Every read of content that a staff member makes as staff writes a `RECORDING_CONTENT_READ` row in the event's GDPR log: the surface, the recording, the way in (`organizzatore` or `deroga`), the role and the account identifier. It holds no name, address or IP. The same read by the same account within 15 minutes is written once. Reads by participants and by the public are not staff privilege and are not logged.

### The presence pass

When an instant call starts recording, the room of each person present asks `POST /api/events/<slug>/recording/presence` with the room tokens of that page visit as proof of the seat, as the consent withdrawal does. The server checks that the event is an instant call with its room open, that the last recording action of the room is a start (`LiveAction`), and that the token belongs to this room. The token may have expired: the room does not renew it while a person stays connected, and a recording that starts hours after someone joined finds their token past its lifetime, so the usual tolerance of a day applies. The call's link lets anyone in, so the pass gives nothing more than the link already does. The server then sets `rec_pass_<eventId>`, an `HttpOnly` cookie holding an expiry and an HMAC of the event and that expiry, truncated to 128 bits for this purpose only: a person who takes part in many recorded calls collects one per call, and all of them travel with every request until they expire. It expires when the call's retention ends (`dataRetentionDays` after the later of its planned end and the moment of the request). The pass is for everyone present, whether or not they consented to appear in the video. After the call, the call's link shows the end-of-call page with **Watch the recording** to pass holders and to the organizers, and still answers "not found" to everyone else. Nothing is emailed and there is no link to forward.

## Alternatives considered

- **Encrypt the content per event, with keys that administrators do not hold.** It would make the block cryptographic. It needs key management outside the database, a key per event that the worker can use, and a recovery story when an organizer leaves. It is out of proportion for now, and the limit below is stated instead.
- **A new staff role between organizer and administrator.** The problem is not the number of roles but that administering the installation implied reading its content. The organizer rule already exists, and the administrator who organizes an event keeps their access.
- **Keep the moderator link visible to administrators.** It is the simplest way to keep every control on the event page working, and it reopens the content through publication and deletion.
- **An emailed link for instant-call participants.** Guests leave no address, and a link can be forwarded. The browser that was in the call is the person who was there.

## Consequences

- **Post-production on content is the organizers' job.** Correcting a transcript, naming speakers, writing the summary, adding a translation, building the archive or the report, and publishing: whoever organizes the event does it. An administrator monitors the pipeline, cancels runaway jobs, and sees status and errors.
- **An administrator who must work on an event needs to organize it.** The platform has no transfer of ownership: an organizer grant with the administrator's address, given by someone who manages the event, is the way in, and it is visible on the event.
- **The block is in the application, not cryptographic.** Whoever holds the storage credentials, the database credentials, `PII_ENCRYPTION_KEY` or the cluster can read the files and the decrypted text. The operator must restrict those credentials as tightly as the content they protect.
- **Signed addresses already handed out keep working until they expire** (120 minutes at most). Azure SAS tokens signed with the account key cannot be revoked one by one.
- **The pass trusts the room's record of the recording.** A moderator's browser reports the start and the stop of the recording (`LiveAction`). If no moderator is in the room when the recording stops, the stop is not reported, and while the call stays open someone who joins later can still obtain a pass for a recording they were not present for. They hold the call's link, which already let them in.
- **The machines keep their access.** The worker claim, the recorder and the cron jobs read and write content through their internal routes and credentials, as before.
- **An administrator still sees personal data that is not content**: registrations, consents, the participants of call sessions, the moderator's contact. Those follow [ADR-014](014-organizer-role.md) and the privacy documentation. The names tied to a voice (the label of a per-participant track, the name given to a speaker) are content.
