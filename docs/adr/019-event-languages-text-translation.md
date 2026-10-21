# ADR-019: One language list per event, and automatic translation of its texts at save

**Status:** Accepted

## Context

An event's title and description are multilingual (`{ "it": "…", "en": "…" }`), and the public page shows them in the page's language, falling back to the main language. Three separate things decided which languages an event had:

- the language tabs of the wizard were all the languages active on the site, with no choice per event;
- the translation of subtitles and summary had its own list (`Event.aiTargetLocales`), asked in two places of the wizard and defaulting to `SiteSetting.aiDefaultTargetLocales`, edited in the AI settings;
- the machine translation of the title and description, run on CPU by the in-cluster engine of [ADR-016](016-in-cluster-ai-postproduction.md), was a separate request (a checkbox when creating, a button when editing) whose result was a proposal that filled empty fields in the browser and was forgotten once saved.

Nothing recorded who wrote the text of a language, so a machine translation saved once looked like a person's text, and nobody knew when it went stale. Where the engine was not installed the wizard simply showed nothing, and an empty tab looked the same with or without it. The fields carried no `lang`, and the main-language text shown on another language's page carried none either.

## Decision

### One list of languages per event

`Event.aiTargetLocales` becomes the **event languages**. It drives the tabs of the title and description, the automatic translation of those texts into the **page languages** (the event languages active on the site, other than the main one), and, only when `aiTranslationEnabled` is on, the translation of subtitles and summary. There is no second list and no per-event opt-out: the list is the control. The wizard always writes it, an empty string when the event has no language besides the main one (null keeps meaning "the site's defaults", for events that never chose); a new event starts from its template's list or from the site's **Default event languages**, which move to **Settings › Languages**. A language not active on the site only serves subtitles and summary. Removing a language that has text asks for confirmation, and deletes the text when the event is saved.

### Who wrote each language is stored

`Event.textLocaleState` records, for each language other than the main one, `{ origin, sourceHash, at, model? }`: `MACHINE` or `HUMAN` (a reviewed language counts as `HUMAN`), and the SHA-256 of the main title and description the language comes from, computed on the server only. One pure function (`app/src/lib/text-translation/stato-lingue.ts`) turns the stored state, the main text and the open job into the state each tab writes, for the server and for the wizard. A copy of an event inherits the state with the texts.

### The server translates after the save, never over a person's text

After a save that sends texts or languages, and after every delivery of the engine, the server queues one translation of the stored main text into the page languages that are empty or machine-translated from a different main text (`riconciliaTraduzioni`). It never picks a language written by a person, never runs with a job already open or for an instant call or an archived event, and does not repeat the last job on the same text and languages when it failed or completed without a text for them (the language says it failed, and a person retries it); right after a delivery or a final failure it never repeats it, so that languages the engine leaves empty cannot start an endless round of jobs. A draft saved automatically must not call it. The delivery writes a language only if it is still empty or `MACHINE` and only if the main text is still the one translated; otherwise the result is kept as the last machine translation and the server asks again.

The wizard sends the languages it touched (`textEdits.touched`): those become `HUMAN`, and the server keeps its own text for the others, read again under a row lock, so a translation delivered while the wizard was open is not wiped. Clients that do not send `textEdits` keep the former behavior. **Translate again** in the wizard empties the language in the form after a confirmation, so that the save translates it; the API offers only **Retry**, which never replaces a person's text.

### Machine text is published, and says so

A machine translation is published at once. The public page shows an **Automatic translation** notice for a `MACHINE` language until someone reviews it, and marks with `lang` the main-language text shown in its place. Without the engine the wizard promises nothing: empty languages are **Empty**, and the page shows the main text.

## Alternatives considered

- **Keep machine translations as proposals until a person reviews them.** Rejected by the product owner: it makes translation a chore that is often skipped, and the notice already tells readers what they are reading.
- **A separate column for the page languages, linked to the post-production languages by default.** Rejected: it brings back the double question the single list removes.
- **A per-event switch to turn automatic translation off.** Rejected for now: removing a language from the event is the way to have no text in it.
- **Hashing the main text in the browser to compare it with the stored state.** Rejected: Web Crypto is missing on pages served without TLS outside localhost, and comparing the form's text with the text loaded is enough for the wizard.
- **Checking the output language before applying a delivery.** Deferred: a line now and then comes back in another language. The notice, **Mark as reviewed** and editing are the mitigation until the check exists.

## Consequences

- More `TRANSLATE_TEXT` jobs: one per save that leaves a page language empty or stale, bounded by one open job per event and by the loop guard. The CPU engine starts more often.
- `aiTargetLocales` is now always written. Its readers that mean post-production (`lib/ai/enqueue.ts`, the report's default languages) use it only with `aiTranslationEnabled`.
- Machine text reaches readers without review. Emails, calendar files and link previews use it without the notice.
- Only the title and description are translated; the programme topics, tags and the other multilingual texts are not.

Behavior and contracts are described in [AI post-production: Event text translation](../POSTPROD.md#event-text-translation).
