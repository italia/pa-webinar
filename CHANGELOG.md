# Changelog

All notable changes to PA Webinar, newest first.

This file is **generated** — run `npm run changelog:md` after editing
`app/src/content/changelog/releases.json` or
`app/src/content/changelog/translations/en.json`. The same data renders the
public `/changelog` page, translated into every language the site ships.

Versions follow [semantic versioning](https://semver.org/). Releases marked
🔒 were primarily security or dependency hardening.

## 0.8.9 — 2026-07-23

**The changelog, now with the software inventory built in**

- Each release now opens its software bill of materials (SBOM) right here: a searchable list of every component it ships, with version and ecosystem — no download needed.
- The technical section is now a set of links — SBOM, the GitHub release, the source at that tag, the build pipeline — instead of a paragraph that repeated the summary above.
- The footer adds the project's security signals: the OpenSSF Scorecard and the code-scanning results.

## 0.8.8 — 2026-07-23

**The what's-new page, redesigned**

- Each release now reads on two levels: the highlights that matter to you, and — under a “Technical detail” tab you open only if you want — the engineering behind them.
- Every version that ships with a software bill of materials (SBOM) links straight to its release on GitHub, where the SBOM is attached. The source code repository is now public.
- The timeline strip at the top is gone: it grew cluttered as releases piled up and told you little. The dates stay on each card.

## 0.8.7 — 2026-07-23

**The interface complete in all 24 languages, and a refreshed visual identity**

- The interface is now fully translated in all 24 EU languages: before, several screens — including the waiting room and the consent texts — fell back to Italian where a translation was missing.
- Refreshed logo and visual identity (favicon, icon, watermark), and an image preview when an event link is shared on chat and social.
- A what's-new page in every language, with links to the service transparency and security pages.

## 0.8.6 — 2026-07-22

**The waiting room: a page, and a square you choose to enter**

- The waiting room is now a clean page that follows the design system: the event, the audio and video controls, your name, the chat. The small game that used to sit in the side box is gone.
- The interactive square opens only if you choose it, and it fills the screen. The page's own controls stay beside it — name, microphone, camera, chat, notices — and you can step back out whenever you like. Anyone who would rather have no animation can switch to the classic version, and that choice is remembered.
- Avatars: if the address you registered with has a Gravatar, it can now appear as your picture in the room. An administrator turns it on, and our server makes the request: participants' browsers never contact gravatar.com.
- The component that records the event no longer appears among the participants or in the headcount: it is an internal service, not someone in the room. The notice that the event is being recorded stays exactly where it was.

## 0.8.5 — 2026-07-22 🔒

**A livelier chat: mentions, reactions, corrections and export**

- Chat: being named with @ now highlights the message and, if you are looking elsewhere, sends a notification. Until now a mention was indistinguishable from any other message.
- Chat: you can react to a single message with an emoji, and correct your own message within fifteen minutes (it is marked as edited). The “Reply” button is now discreet.
- Chat: a new button downloads the conversation, as text or as data. The messages were already kept, but there was no way to take them with you.
- In the room: a timer shows how long is left (or how long you have been going), on by default for whoever is running it and available to everyone.
- A room is no longer started by someone opening the event page hours ahead: it warms up when it should. This also fixes a case where an event was shut down minutes after it began.
- Analytics: the peak number of participants is now recorded on the individual session too, not only on the event.

## 0.8.4 — 2026-07-22

**Confirmation emails: the event name, its image, and a configurable sender**

- Registration confirmation emails carry the event name again, in the subject and in the body. Anyone registering from a page in a language the title had not been translated into received an email with no event name and a calendar attachment with no title.
- Confirmation emails and reminders now open with the event image and show the title prominently, instead of tucking it into a row of the details table.
- New settings in the admin panel: the name the sender appears under in a recipient's inbox, and a reply-to address (emails are sent from an address that does not receive replies).
- More generally, text that has not been translated into a language now shows the original instead of appearing blank — this affected titles and descriptions on the public pages too.

## 0.8.3 — 2026-07-21 🔒

**Chat privacy, an accurate participant count and moderation restored**

- Chat history can no longer be read by people who are not taking part in the event. Until now, anyone who knew an event's address could download its messages — together with the names of the people who wrote them — even after the event had ended. Access now requires being a registered attendee, being a moderator, or being in the room while the event is under way.
- The participant count shown in the room was off by one, because each person was not counting themselves. The same error carried through to the event statistics (peak participants). The count is now correct and matches the figure recorded in the statistics.
- Moderator controls in the participant list work again: removing a participant and adjusting an individual's volume previously had no effect.
- Reactions are now available on smartphones as well, where the button to send them had disappeared. Emoji floating across the screen no longer intercept clicks on the control bar.
- In full screen, dialogues — link sharing and, for moderators, “Leave the room” — are visible again: they used to stay hidden behind the video, which made the buttons look broken.
- Event templates now start with chat switched on, in line with the room itself: creating a “Webinar” still produced an event without chat.
- The English translation of the interface is now complete; a number of items were missing, including the whole “Share” dialogue.

## 0.8.2 — 2026-07-17

**No empty room left running past its end time**

- A room left open past its end time and then emptied stayed active indefinitely, tying up video resources for no reason. It is now closed once it has been empty for 45 minutes beyond the scheduled end time. A room that is still in use is never interrupted: past the end time it simply shows a notice, and nobody is disconnected.

## 0.8.1 — 2026-07-17

**Configurable reactions, empty-room closing and a more secure admin area**

- Emoji reactions can now be configured by the administrator. By default the platform uses the native Jitsi reactions, available straight from the control bar (lightweight and short-lived). Alternatively you can switch on the platform's own reactions, shown in a bar at the bottom left, which are counted in the event statistics.
- New administrator option: automatically close a room that has been left completely empty, moderators included, as a sign that the event has been abandoned. It is off by default — inactivity with no moderator present is already handled safely, since the room goes dormant after 45 minutes — and can be enabled in the settings.
- A more secure administration area: when a session expires you are taken back to the login screen, so admin pages can no longer be used after expiry. Sessions also last longer and renew automatically while you work.

## 0.8.0 — 2026-07-17

**A cleaner live room: chat, reactions, full screen and registration**

- Chat: you can now add emoji to your messages with a dedicated picker, and a small indicator warns you if chat updates start to lag. Messages you send appear immediately, even on corporate networks that buffer real-time updates.
- Full screen: the full-screen button now keeps the chat visible alongside the video instead of hiding it.
- Emoji reactions no longer cover the controls at the bottom of the screen: the bar stays clickable at all times, including in tile view.
- The “Share” and “Leave the room” buttons are now clearly visible and coloured by default (leave in red), rather than only when you hover over them.
- The “Recorder” bot no longer appears in the participant list or in the count.
- Registration: if you sign up well in advance you are taken to a confirmation page with a link to add the event to your calendar, instead of being sent to the waiting room; close to the start time you go straight into the room. The event page now also shows whether you have already registered.
- Chat is now the main way to interact in the room. Automatic closing of events left empty and the participant count in the statistics have also been improved.

## 0.7.8 — 2026-07-17

**Moderators can lower a raised hand**

- In the raised-hands queue, moderators now have a button to lower an individual participant's hand — useful when someone has already spoken or has left their hand up by mistake. The request reaches that participant, who sees their own hand go down; nobody else is affected.

## 0.7.7 — 2026-07-16

**Less background noise when you speak**

- Advanced background-noise cancellation is applied when you take the floor: it does a better job of damping sounds such as typing, fans or traffic, on top of the basic suppression already in place.

## 0.7.6 — 2026-07-16

**Per-participant volume**

- A new volume control for each individual participant in the “Participants” panel: if someone sounds too loud or too quiet, you can adjust them just for yourself, without changing what anyone else hears.
- Separate per-participant audio recording, used in post-production, is more reliable: if a capture turns out to be silent, the system detects it straight away and avoids producing empty transcripts.

## 0.7.5 — 2026-07-16

**Raised hands stay raised**

- When you raise your hand it now stays up until you lower it yourself, or a moderator deals with it. It used to drop on its own the moment you started speaking, making you disappear from the speaking queue.

## 0.7.4 — 2026-07-15 🔒

**Chat names protected against forwarded links (security)**

- In the chat, a registered attendee's real name is shown only on the device they registered with: anyone opening a forwarded joining link now takes part under the name they type in, not under the original attendee's name. This closes a gap that allowed messages to be wrongly attributed.
- The same protection applies to attachments: a file sent from a forwarded link is no longer attributed to the original attendee's name.
- Anyone joining from a second device — a phone, for example — or with a link received in advance can still take part, write in the chat and send attachments without interruption. The only difference is the name displayed, which becomes the one typed when entering the room.

## 0.7.3 — 2026-07-15

**Accurate attendance count, centred reactions and room refinements**

- The count of people present no longer multiplies someone who leaves and comes back, for example using the browser's Back button: duplicate connections from the same person are counted once. The participant list still shows every connection, so moderators can always see and manage them all.
- The reactions bar now sits at the bottom centre of the screen, clearly visible and easy to find, instead of in the bottom-left corner.
- The number of registered attendees is no longer shown publicly on the event page or in the event listing; it remains visible to administrators in the admin panel. During a live event the audience only sees how many people are present.
- Background-noise suppression is now switched on automatically for every microphone: basic audio processing — echo and noise — is always enabled, with nothing to turn on by hand.
- Joining the room is slightly faster: the video system starts waking up as soon as you click the join button.

## 0.7.2 — 2026-07-15

**A richer chat: attachments, replies and mentions**

- You can now send images and attachments in the chat (PNG, JPEG, WebP, GIF and PDF, up to 10 MB), with a preview shown directly in the message.
- New “Reply” function: you can quote a specific message, and the quotation stays visible in the thread of the conversation.
- Mentions with @: you can address a participant by name inside a message.
- Chat moderation: moderators can remove individual messages during the event.

## 0.7.1 — 2026-07-09

**Post-event statistics for every event**

- A new “Statistics” tab for each event in the admin panel, available even for events with no registration and for events with no video recording. It shows how the call unfolded, who spoke the most, the overall level of participation and the key indicators.
- A chart of interaction over time — chat, questions, votes on questions, polls, word cloud entries and reactions — highlighting the peak moment of the call.
- A ranking of who spoke for longest, in minutes each, showing how evenly speaking time was shared, alongside counts of reactions and raised hands.
- A new estimate of how long participants stayed in the room on average, which also feeds into the overall attention score.

## 0.7.0 — 2026-07-09

**Editable speaker names and an audio-only player**

- After an event you can now rename speakers, correcting the names automatically detected in the transcript.
- If a recording has no playable video, the editing page still offers an audio-only player so you can listen back and fix the text and the speaker names.
- Multi-track recording fix: the actual audio of remote participants is now captured correctly.

## 0.6.9 — 2026-07-09

**Reliability of AI processing**

- The admin panel now shows a reliability indicator for post-event AI processing (transcription, summaries, translations), so you can tell at a glance whether the result is complete and trustworthy.

## 0.6.8 — 2026-07-08

**A clearer post-event editing page**

- The editing page for transcripts, summaries and translations now explains when AI content is not yet available — “processing under way” or “start processing from the controls above” — instead of showing a red error that looked like a fault.
- A failed save is now shown in red, with the specific reason returned by the server, instead of appearing in green as if it had worked.
- An expired administrator session and a loading problem now produce their own distinct messages, rather than a single generic error.
- If the audio of a recording cannot be played, the page says so, and you can still correct the text and the speaker of each segment.

## 0.6.7 — 2026-07-08

**Always-visible reactions and “Notes / Checklist”**

- Emoji reactions are now always visible in a bar at the bottom left, rather than tucked away behind a button: easier to find and to use during an event.
- The “Agenda” feature has been renamed “Notes / Checklist” to make clear that it is a checklist-style notes area whose content does not go into the chat. Moderators can still enable it for each event.

## 0.6.6 — 2026-07-08

**Refinements: chat, counts and access**

- Links shared in the chat are now clickable and open safely in a new tab; previously they were plain text.
- In the room, the total number of registered attendees is now visible only to moderators: participants see only how many people are actually present.
- Faster access to the room: the connection to the video server is prepared while you are still in the waiting room, cutting the wait when you join.
- In the participant list, the header with the count stays visible as you scroll through the list.

## 0.6.5 — 2026-07-08

**Recordings and counts**

- The count of people in the room now excludes the recorder: it shows only real people, not the bot capturing the audio.
- Post-production: a new “Generate with AI” button starts transcription, summarising and translation for audio-only recordings too, with one track per participant. Until now these offered no way to start the process.
- In the list of tracks, each nickname is paired with an identifier: different people using the same nickname are given distinct identifiers, while several contributions from the same person share one.
- A clear message is shown when starting the pipeline queues no work — because AI is disabled for the event or the pipeline is paused — instead of a misleading “operation successful”.

## 0.6.4 — 2026-07-08 🔒

**Identity security and room refinements**

- Security fix: if you share your personal link to the room, whoever opens it now enters under their OWN name. Previously they could inherit the name of the person who sent the link.
- Sharper screen sharing: it now favours resolution (5 fps at high quality) over smoothness, so slides and documents stay legible when there is little movement.
- The “hide your own video” option has been removed: once switched on, it left no way to bring your own tile back.
- Administrator access: after signing in again following a period of inactivity, the page refreshes properly — no more screens that seem stuck until you reload them by hand.

## 0.6.3 — 2026-07-08

**Event room refinements — round 2**

- The presentation timer is now built into the moderator's control bar instead of taking up a row of its own; the countdown bar appears only while the timer is running.
- The chat now shows the real name of whoever is writing, rather than a generic “Moderator”.
- Chat has become a panel of its own in the sidebar, instead of always overlapping the other content: a cleaner interface, with an unread-message counter on the tab.
- A new “Whiteboard” button lets moderators open the shared whiteboard straight from the control bar.
- The “Share” button now has the right colour, so it can no longer be mistaken for “Leave”; links have icons beside them; and the moderator link, shown to moderators only, sits behind a warning so that other moderators can be invited without any mix-ups.
- The word cloud is no longer on by default: moderators can still switch it on during the event if they want it.

## 0.6.2 — 2026-07-08

**Refinements to the live event room**

- The control bar (microphone, camera, screen sharing) stays visible and clickable at all times: in full screen, while someone is sharing, and when you are alone in the room.
- Moderators can once again turn live features (Questions, Chat, Agenda) on and off during the event.
- Audio and video controls can be used while the room is still being set up, without waiting for the video server to start.
- The “Raised hands” list correctly shows who has asked to speak.
- A new “Share” button in the room copies the joining link and the event page link in one click, without exposing any private tokens.
- PA Webinar branding is visible again in the top bar of the event room.

## 0.6.1 — 2026-07-07 🔒

**Public changelog and security updates**

- A new public changelog page, reached by clicking the version number in the footer, lists every release of the platform along with its main new features.
- Security updates to dependencies (undici, nodemailer) and a hardened build pipeline with vulnerability scanning.

## 0.6.0 — 2026-07-07

**Post-event workflow and interactive waiting room**

- New end-of-event workflow: when the event finishes, a dedicated prompt asks the moderator where the recording should go — published on the event page, added to the library, or kept in the archive only.
- An automatic, anonymised post-event recap — attendance, most-voted questions, poll results, word cloud and ratings — shown on every completed event page, even when there is no recording.
- A post-event summary email sent to participants with the content of the event.
- An interactive “Piazza Digitale” waiting room: you walk your avatar up to the gateway to enter the call, with the classic join button always available alongside it.
- The word cloud now has a section of its own on the completed event page, with a visibility toggle for administrators.
- A shared whiteboard that can be enabled for individual events and from templates.
- A reworked event creation wizard: advanced options collapsed, a main moderator with a link, warnings about personal data, draft saving and better handling of partial errors.
- Separate retention periods for recordings and for per-speaker audio tracks, tied to the “video published” signal, together with GDPR clean-up of chat messages.

## 0.5.11 — 2026-06-17

**Moderation, call closing and audio refinements**

- Moderators now appear under their real names, rather than a generic “Moderator”.
- An in-app closing screen is shown when the event ends, instead of the misleading “Room being set up” message.
- Fixed overlapping icons in the waiting room.
- Noise suppression forced off through the IFrame API to resolve audio problems.

## 0.5.9 — 2026-06-17

**Stable multi-track recording, star ratings and performance**

- Per-speaker (multi-track) recording made reliable end to end: complete audio on every track, no truncation, parallel uploads.
- A post-event feedback questionnaire with star ratings and a summary dashboard for administrators.
- Performance improvements: VP9 codec for the camera, lazy loading on mobile, recorder tuning.
- A post-upgrade Helm hook that automatically reloads the Jitsi config.js.

## 0.5.8 — 2026-06-16

**Configurable audio and video quality, and a new join flow**

- Audio and video quality can be configured by the administrator, with presets per event.
- Redesigned join flow: registration, then waiting room, then video call.
- Raised hands show each participant's real name.

## 0.5.6 — 2026-06-12

**Configurable waiting room and event cover images**

- The waiting room experience can be configured — game, garden or classic — both site-wide and for individual events.
- Cover images on the event page and in card thumbnails.
- Uploaded files served through a dedicated route, using signed URLs that expire quickly.
- An “Enter now” button available immediately after registering.
- A consolidated admin section for managing AI processing of recordings, and more robust multi-track capture.

## 0.5.2 — 2026-06-11

**Event preparation and refinements**

- An agenda with agree and disagree feedback, plus fixes to permissions inherited from templates.
- Real names instead of “SPEAKER_00” in summaries and subtitles.
- A series of hotfixes (v0.5.2 to v0.5.5) in preparation for public events.

## 0.5.1 — 2026-06-05

**Community-first home page and multi-track archive**

- A community-first redesign of the home page, with translation overrides that can be applied at runtime and AgID accessibility compliance.
- A multi-track MKV archive with a player for listening back to each speaker individually.
- Multi-track audio aligned to the Jibri mix using cross-correlation.

## 0.5.0 — 2026-06-04

**AI post-production and multi-track recording**

- An AI post-production pipeline: transcription, summaries, subtitles, translations and multi-voice dubbing (always synthetic), with the provenance of the models tracked.
- Multi-track recording, one track per speaker, with speaker attribution and automatic naming (ADR-013).
- A public video library and a post-event management page for administrators.
- A post-event transcript editor for correcting the text and reassigning speakers.
- An overhaul of the admin interface: .italia toasts and dialogues in place of native browser alerts, skeleton loaders, and colour design tokens replacing hundreds of hard-coded hex values.
- Per-participant consent for multi-track recording (GDPR) and an extended Article 15 data export.

## 0.4.0 — 2026-04-24

**Engagement and lifecycle**

- New live features: word cloud, presentation timer, reaction counter, Meet-style live controls and a raised-hands panel.
- A recording lifecycle, from temporary to published, with admin controls (preview, publish, delete) and separate retention periods.
- A tabbed post-event page (recording, Q&A archive, polls, feedback, materials), with control over what is published and when.
- A five-step event creation wizard, a tag taxonomy, a contacts directory and an editorial kicker for titles.
- A public video library at /video-library and a transparency page at /service-inventory (per-tenant CycloneDX 1.6).
- Two-stage JVB autoscaling, with a Redis snapshot feeding the status page.
- Three-stage GDPR clean-up: immediate removal of personal data, removal of content once its retention period ends, then hard deletion.

## 0.3.0 — 2026-04-03

**Configurable platform and infrastructure**

- Site settings that let other public bodies reuse the platform — branding, colours, favicon, SEO, footer, home page mode, privacy and accessibility pages — without rebuilding it.
- An analytics dashboard and an infrastructure admin panel.
- Three Helm deployment modes (simple, standard, full) and JVB scale-to-zero on a dedicated node pool.
- A multi-cloud Jibri pipeline (Azure Blob, S3, GCS, MinIO or local storage) and a configurable Jitsi watermark.
- OpenSSF Scorecard, Dependabot, a dependency SBOM, centralised error handling, rate limiting and more than 210 unit tests.
- Numerous incremental releases (v0.3.8 to v0.3.45) following feedback from the demo.

## 0.2.0 — 2026-04-01

**DTD feedback**

- Participant profiling at registration (organisation, role, category), configurable for each event, with CSV export and aggregate statistics.
- Configurable reminders, with several lead times and different emails for each.
- Polls with real-time results and CSV export.
- GDPR improvements: a privacy policy for each event, granular consent, an audit log of deletions and Article 15 data export.
- Consolidated Moderator and Auditor roles, and an audit of dependency licences.

## 0.1.0 — 2026-03-31

**MVP — first release**

- A public platform for digital events, built on the .italia design system (Bootstrap Italia, design-react-kit).
- A live room powered by Jitsi Meet (IFrame API, JWT authentication), with roles enforced server-side.
- GDPR-compliant participant registration, with personal data encrypted (AES-256-GCM).
- Q&A with upvoting and moderation, and a waiting room with a countdown and guest access.
- Confirmation and reminder emails, plus calendar integration (Google, Outlook, Yahoo, iCal).
- An admin panel with API key authentication, GDPR clean-up and Prometheus metrics.
- A production-grade Helm chart, non-root read-only Docker images, CI/CD with GitHub Actions and publiccode.yml.
