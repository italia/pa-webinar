# ADR-018: Live captions from an in-cluster streaming recognizer, fed by Jitsi's bridge

**Status:** Accepted

## Context

During an event, people who cannot hear the audio have no text to follow. Subtitles existed only after the event, produced from the recording by the post-production pipeline ([ADR-016](016-in-cluster-ai-postproduction.md)). Live audio in synchronized media is what WCAG 2.1 success criterion 1.2.4 (Captions, Live, level AA) covers, and EN 301 549, which the Italian accessibility rules adopt, includes that criterion.

Three constraints shaped the decision:

- **Sovereignty.** As for post-production, speech must not leave the installation. The commercial streaming APIs that Jitsi's own transcription service supports are excluded by the policy in `app/src/lib/ai/providers.ts`.
- **No GPU at event time.** The GPU pool scales from zero and is sized for batch jobs. A live service must run on the CPUs that are already up while an event runs.
- **The Jitsi boundary.** [ADR-001](001-jitsi-iframe-api.md) allows the portal to act on the conference only through the IFrame API, configuration and the server-side components, never by forking Jitsi.

Recent Jitsi stable releases (from stable-10710) carry bridge-based transcription. Prosody marks a room as transcribable with the room metadata key `asyncTranscription`. When a moderator asks for transcription, the bridge opens a WebSocket to a transcription service and streams the Opus audio of each participant who speaks, in a JSON format derived from VoxImplant's. The service returns `transcription-result` messages, and the bridge relays them to every participant over its own channel. Jicofo picks the service from a URL template.

The streaming model had to be measured before it could be chosen. `infra/captions/bench/` drives the candidate engine, NeMo-Speech.cpp with the multilingual Nemotron 3.5 ASR Streaming 0.6B model in 8-bit weights, with Italian speech at real-time pace in 20 ms frames, as the bridge sends it. On a workstation CPU, four threads keep four people speaking at the same time within half a second of processing delay, and the model's word error rate on Italian read speech is around 7% with strict normalization.

## Decision

### The bridge feeds a gateway, the gateway feeds a local engine

A new component, the **captions service**, runs in the cluster as one pod with two containers:

- the **gateway** (`infra/captions/gateway`, TypeScript) accepts the bridge's WebSocket, decodes each speaker's Opus to 16 kHz PCM, opens one session per speaker on the engine, and turns the engine's text into `transcription-result` messages;
- the **engine** (`infra/captions/engine`) is NeMo-Speech.cpp in server mode on CPU, reachable only on the pod's loopback. The model is not in the image: an init container downloads it at a pinned revision and checks its SHA-256, from Hugging Face or from a mirror the operator sets.

The official transcription proxy that Jitsi publishes is not used: its providers are commercial APIs, and its OpenAI-compatible endpoint forwards each fragment as it comes, while the Jitsi client replaces the interim text on every message. The gateway sends the whole sentence so far on every update.

### The portal shows the captions, not Jitsi

The Jitsi client shows a caption as "name: text", taking the name from the service's message, and the service only knows the bridge endpoint. The room therefore renders its own captions: it listens to the IFrame API event `transcriptionChunkReceived`, which every client receives, resolves the speaker's display name from the endpoint, and draws the text over the video. Each viewer can hide the captions; screen readers hear finished sentences only.

### Transcription is on by default and the moderator's room turns it on

Captions are on by default at two levels, the instance (`SiteSetting.liveCaptionsEnabled`) and the event (`Event.liveCaptionsEnabled`). A Prosody module of the project (`mod_pa_captions`) marks every room as transcribable when the service is installed, and passes the room name to the service as a URL parameter. The room page of a moderator turns transcription on or off with the IFrame API command `setSubtitles`, which writes the room metadata Jicofo watches; the JWT grants the `transcription` feature to moderators only. The event flag can be changed during the event from the control room, like the other live switches.

### The service protects itself and reports its state

The gateway measures, on every fragment, how far the text lags behind the audio. When the lag grows it transcribes fewer speakers at once, keeping those who spoke most recently; when it stays too high it pauses itself, for a period that doubles at each relapse, and then tries again. The state is exposed at `/status`, which the status page, the infrastructure map and the room read: a paused service is shown, not hidden.

### The event's vocabulary guides the engine, gently

The service asks the portal for the room's context: language, and the vocabulary that post-production already uses (glossary terms of the instance and of the event, organizers, moderators and speakers). The vocabulary biases recognition through the engine's word boosting at a low weight, and the glossary's known misspellings are corrected in the text. The bench measured why the weight is low: at the weight the engine's documentation calls typical, boosting wrote glossary terms where nobody had said them.

### The text is kept only when the event asks, and only for those who consent

By default the captions are not stored anywhere. An event can opt in to a transcript built from its captions (`Event.captionsTranscriptEnabled`, off by default), which needs neither a recording nor AI post-production. Then:

- **Consent decides, voice by voice, on the server.** The transcription of one's own contributions is a separate, optional consent, never pre-ticked, asked at registration and in the waiting room of everyone, moderators and speakers included. It reuses the per-participant recording consent of [ADR-013](013-multitrack-speaker-attribution.md) (`Registration.consentMultitrack`, `MultitrackConsent`), so one answer governs both what the recorder records and what the transcript keeps. The consent text carries a version, stored with each answer: the transcript counts only answers given to the text that names the transcription with one's name, while the recorder also accepts the earlier text, which covered the audio track. Refusing it does not keep anyone out of the room.
- **The seat in the signed token identifies the voice, not a typed name.** The gateway knows only the bridge endpoint. A Prosody module of the project (`mod_pa_occupants`) tells the portal which token seat (`context.user.id`) stands behind each endpoint, and the portal maps the seat to the consent. The gateway still sends every final sentence; the portal stores text and name, encrypted, only for consenting seats, and for every other voice a row with the times alone.
- **The transcript is an ordinary post-production artifact.** After the event the sentences become a `TRANSCRIPT_JSON` with the model id `live-captions`, on the event's recording or on a recording without media created for it, so the transcript editor, the downloads and the event page use it as they use an AI transcript. It never replaces an AI transcript or one corrected by hand; a later AI transcript replaces it. Its publication on the event page is a separate staff decision (`Event.transcriptPublished`), and publishing the transcript alone makes public only its text, not the AI outputs that accompany a published video.

The flow and the data are described in [Live captions: transcript from captions](../architecture/live-captions.md#transcript-from-captions).

### The scaler starts it with the events

With the bridge scaler on, the captions service runs only while an event is live or starting, like Jibri ([ADR-007](007-jvb-scale-to-zero.md)): the portal says how many replicas it wants, and the scaler's CronJob applies it. It stays up for the whole event even when a moderator turns captions off, so that turning them back on is immediate; idle, it uses no CPU. Without the scaler it runs all the time.

## Alternatives considered

- **Jigasi with a Whisper backend.** Jitsi has deprecated Jigasi transcription, and Whisper is not a streaming model: it transcribes windows again and again, which costs a GPU for live use.
- **Jitsi's transcription proxy with a commercial provider.** Excluded by the sovereignty policy.
- **The proxy's OpenAI-compatible endpoint in front of the engine.** It speaks a protocol the engine's server does not, at a different sample rate, and its fragment handling shows only the last fragment in the Jitsi client.
- **Jitsi's native caption overlay.** It cannot show who is speaking, because the service does not know names; it also cannot be styled or made accessible the way the room is.
- **Running the engine on the GPU pool.** The pool scales from zero for batch jobs; keeping a GPU up for the length of every event costs far more than the CPU the measurement asks for.
- **Running on Jibri's node.** Jibri exists only for recorded events, and its browser and encoder already compete for that CPU.
- **Storing every sentence and filtering when the transcript is built.** The text of people who did not consent would sit in the database until then; deciding at the time of storage keeps it out altogether.
- **Matching voices by the name shown in the room.** A display name is typed by the person and proves nothing; the token seat is signed by the portal.

## Consequences

- A new deployable, two new images (`captions-gateway`, `captions-engine`) and two new Prosody modules (`mod_pa_captions`, `mod_pa_occupants`). The model's weights are downloaded at pod start and are not redistributed in the project's images.
- Captions depend on Jitsi stable-10710 or later. The room name reaches the service only from stable-10978; on earlier releases the portal finds the event from the meeting id that `mod_pa_occupants` reported, and without that module the service uses the instance's language and glossary.
- Every client receives every caption through the bridge; the room decides what to show.
- Speech of everyone who speaks is processed while captions are on. Without the transcript from captions nothing is stored, and the waiting room says so. With it, the text and name of those who consented are stored, encrypted, until the event's retention, and so is the transcript built from them unless staff publish it, or the video; erasure of a registration removes the person from it. The waiting room says that the text is kept. See [Privacy and data protection](../GDPR.md).
- Prosody signs its occupant reports with a key derived from the conference token secret it already shares with the portal, so it holds no other portal credential. Without the module, or with an external Jitsi that does not load it, no transcript text is kept and the multitrack recorder records no track.
- Captions depend on a moderator being in the room to turn them on. Before Jitsi stable-10978, Jicofo puts a conference on the bridge only from two participants, so a moderator alone in the room is captioned once someone else joins.
- Numbers come out in words: the engine has no Italian inverse text normalization.
- Sizing depends on the CPU. The gateway's load governance turns an undersized pod into fewer captioned speakers or a visible pause, never into delayed audio or video.

See [Live captions](../architecture/live-captions.md) for how it works, how the transcript is built and how to size it.
