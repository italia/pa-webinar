# Accessibility

PA Webinar targets WCAG 2.1 level AA, the level that EN 301 549 requires and that the Italian accessibility rules (Legge 9 gennaio 2004, n. 4, and the AgID guidelines) apply to public bodies. This page states what the project checks, how it checks it, and what it knows does not conform. It is the starting point for the evaluation an administration needs before it publishes its own accessibility statement; it does not replace that evaluation, and the statement, published through AgID's form, stays the administration's responsibility ([Reusing PA Webinar](REUSE.md)).

The built-in statement page (`/accessibility`, text in `app/src/i18n/messages/*.json` under `legal.accessibility`) follows AgID's model and defers the conformance status to the administration. An administrator replaces it with the administration's own text from **Settings**, **Pages** ([Runtime settings](configuration/runtime-settings.md)).

## What is checked automatically

Two browser test files in `app/e2e/` measure accessibility on the running application. They are part of the end-to-end suite ([Testing](development/testing.md)), which runs against the local stack; in CI that job does not block a merge, so run it before a release.

| Spec | What it checks | Where |
|---|---|---|
| `accessibility.spec.ts` | Every axe-core rule tagged WCAG 2.0 and 2.1, levels A and AA: contrast, accessible names, structure, landmarks, ARIA attributes, form labels. Any violation fails the test, which lists the rule and the elements | The public pages (home, events, an event page, registration, calendar, video library, the legal and privacy pages, status, service inventory, changelog, staff sign-in); the waiting room; the main administration pages, the event wizard included; the live room, entered as a moderator and as a participant, with every tab of the side column. On a desktop viewport, and on a phone viewport when both browser projects run (CI runs the desktop one) |
| `keyboard.spec.ts` | The first Tab reaches the skip link, and Enter moves focus to the main content. The language menu opens with Enter and closes with Esc, returning focus to its button. A visitor registers for an event with the keyboard alone. The focused field and button show a visible focus indicator | Home page and registration, on a desktop viewport |

Two rules hold across the code base and are checked where they live:

- **Motion.** No animation in the portal runs for more than five seconds (WCAG 2.2.2). The rule is stated in `app/src/styles/globals.scss` next to the animations, and the waiting room's invitation and entry button stop their animation under `prefers-reduced-motion` (see the [waiting room's accessibility contract](architecture/waiting-room.md#accessibility-contract)).
- **The waiting-room square is optional.** The 2D square is a canvas game, which cannot be made fully accessible. Nothing depends on it: every control is also on the page, the classic view is always reachable and remembered, and the square never opens by itself. The contract is in [the waiting room](architecture/waiting-room.md#accessibility-contract).

## What is not checked automatically

An automatic check sees markup and styles. It does not see whether a page makes sense, and the suite does not drive an assistive technology. These remain manual:

- **Screen readers.** The suite runs no screen reader. Check the main paths (registration, the waiting room, the live room's side column, the post-event page) with at least one screen reader on desktop and one on a phone.
- **Reading order and the sense of the texts**, including headings that describe their section and link texts that make sense out of context.
- **Zoom and reflow.** Text enlarged to 200%, and content at a 320-pixel width without horizontal scrolling (WCAG 1.4.4, 1.4.10).
- **Keyboard use beyond the paths above**, the administration area and the live room in particular.

## Known non-conformities and limits

| Area | What does not conform, or is not measured | Mitigation |
|---|---|---|
| **The video conference** | The conference is Jitsi Meet, a third-party application in its own frame. Its controls are outside the portal's code and outside the automatic checks, and some of its real-time functions have limits with assistive technologies | The side column of the room, which is the portal's own code, offers the participant list, raised hands, chat, questions and polls. Moderation actions are in its participant list |
| **Live captions** | Captions are generated automatically while the event runs. Their accuracy has not been measured on real events, so the statement cannot yet say how reliable they are (WCAG 1.2.4) | The measurement is an open roadmap item ([Live captions](ROADMAP.md#next)); the tool is `infra/captions/bench/event_wer.py` |
| **Recorded video** | A published recording carries subtitles only when a transcript exists for it. No recording has an audio description (WCAG 1.2.5) | Transcripts come from the AI post-production or from the live captions ([Recordings, voice data and AI outputs](privacy/recordings-and-ai.md)) |
| **Machine-generated text** | Transcripts, summaries, translations and dubbing are machine-generated and can contain errors | The event page labels them as machine-generated; staff can correct transcripts in the editor |
| **The waiting-room square** | A canvas game, not accessible to screen readers | Optional by design, as described above |
| **Content published by the organizers** | Materials, documents and images that organizers upload are not checked by the platform | Accessible content is the publisher's responsibility; the administration should check what it publishes |

## Writing the administration's statement

An administration that adopts PA Webinar evaluates its own installation, with its own content and settings, and publishes the result on AgID's form:

1. Run the end-to-end suite against the installation's configuration, as described in [Testing](development/testing.md), and keep the report.
2. Carry out the manual checks listed above on the installation.
3. Declare the conformance status (conforming, partially conforming or not conforming), listing the non-conformities in the table above that apply, and any found in the manual checks or in the administration's own content.
4. Publish the statement on AgID's form, and copy its text into **Settings**, **Pages**, so that `/accessibility` shows it.
