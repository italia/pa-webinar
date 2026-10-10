# Live captions gateway

The gateway sits between Jitsi's bridge and the speech-recognition engine of the [live captions](../../../docs/architecture/live-captions.md) service. The bridge streams each speaker's Opus audio to it; the gateway decodes the audio, transcribes it on the engine that runs next to it in the same pod, and sends the text back to the bridge, which relays it to every participant. This page is for developers who change the gateway. The decision is [ADR-018](../../../docs/adr/018-live-captions.md).

## What it does

- **Accepts the bridge.** A WebSocket on `/transcribe/<meetingId>?room=<room>`, opened by the bridge when Jicofo asks it to transcribe a conference. If `CAPTIONS_AUTH_TOKEN` is set, the connection must carry it in `X-Captions-Token` (or as a bearer token).
- **Decodes each speaker.** One Opus decoder per audio source (`opus-decoder`, WebAssembly), straight to 16 kHz mono. Short gaps in the RTP timestamps are filled with silence.
- **Finds the voice.** An open microphone sends audio during pauses too. Each 20 ms frame counts as voice when its level is above both `CAPTIONS_VAD_MIN_DBFS` (−55 dBFS) and the speaker's noise floor plus `CAPTIONS_VAD_MARGIN_DB` (10 dB); the noise floor is the lowest level of the last three seconds, so steady noise stops counting as voice. A sentence starts after 60 ms of continuous voice. Only voice, with the 300 ms before it and the pause that ends it, reaches the engine; while transcription is paused or off, the sentence in progress is dropped.
- **Transcribes.** One engine session per speaker, configured with the room's language and vocabulary. A pause of `CAPTIONS_PAUSE_GAP_MS`, as silence or as no packets, closes the sentence on the engine; each new sentence starts with 300 ms of silence, without which the model loses the first word and the punctuation. A session silent for `CAPTIONS_IDLE_CLOSE_MS` is closed.
- **Builds captions.** The engine's fragments become one caption at a time, sent whole on every update, split when they get too long, with the glossary's known misspellings corrected (`src/captions.ts`).
- **Feeds the transcript.** When the room's context says the event keeps a [transcript from captions](../../../docs/architecture/live-captions.md#transcript-from-captions) (`transcript: true`), every final sentence also goes to the portal (`POST /api/internal/captions/segments`), with the speaker's bridge endpoint, the language, the start and end times and the sentence id. The gateway does not know who is speaking: the portal decides, voice by voice, whether to keep the text. Each sentence is fitted to the portal's limits before it is queued: text trimmed and cut to 2000 characters, a sentence left empty or with an over-long id or endpoint dropped, a language tag of the wrong length left out, so one bad sentence never makes the portal reject a batch. Sentences leave in batches (every 2 seconds or 20 sentences) and are sent before the process stops. They stay queued and are retried while the portal does not answer, answers with a server error, or answers `401`, `403`, `404`, `408` or `429`, up to 500 per conference in memory with the oldest dropped beyond that; a batch refused with any other `4xx` is dropped (`src/transcript.ts`). The address is `CAPTIONS_SEGMENTS_URL`, or, when it is empty, the context address with `segments` as its last segment.
- **Governs the load.** The delay of every fragment feeds a governor that reduces the number of speakers transcribed or pauses the service (`src/load.ts`).
- **Reports.** `GET /healthz` (alive), `GET /readyz` (the engine answers) and `GET /status` (state, delay, speakers; no personal data).

| File | Role |
|---|---|
| `src/mediajson.ts` | The bridge's protocol: parsing `start`, `media`, `ping`, `session-end`; building `pong` and `transcription-result` |
| `src/engine.ts` | One session on the engine's realtime WebSocket, with the lag measurement |
| `src/captions.ts` | From fragments to captions; glossary corrections |
| `src/load.ts` | Load governance, pure logic with an injected clock |
| `src/context.ts` | The room's context from the portal (`/api/internal/captions/context`), asked by room name and meeting id: language, vocabulary, whether to keep a transcript |
| `src/transcript.ts` | The final sentences sent to the portal for the transcript from captions |
| `src/gateway.ts` | Conferences, speakers and engine sessions under one governor |
| `src/server.ts`, `src/index.ts` | HTTP and WebSocket server, configuration, shutdown |

Configuration is read from the environment in `src/config.ts`, where every variable and its default is documented. The chart sets them from `captions.*` in `infra/helm/pa-webinar/values.yaml`.

## Develop and test

```bash
cd infra/captions/gateway
npm ci
npx tsc --noEmit -p tsconfig.json
npm test
```

The tests include an end-to-end run over real WebSockets, with a fake bridge sending Opus frames and a fake engine answering with text (`src/gateway.test.ts`). To try it against the real engine, start the engine's server (see [`../engine`](../engine/README.md)) and run the gateway with `CAPTIONS_ENGINE_PORT` pointing to it.

The gateway logs service events only: conferences connecting and closing, state changes of the load governor, the engine becoming reachable or not, and a failed delivery of transcript sentences with its HTTP status. It never logs transcribed text or names, and writes no text to disk.
