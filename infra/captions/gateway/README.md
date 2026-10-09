# Live captions gateway

The gateway sits between Jitsi's bridge and the speech-recognition engine of the [live captions](../../../docs/architecture/live-captions.md) service. The bridge streams each speaker's Opus audio to it; the gateway decodes the audio, transcribes it on the engine that runs next to it in the same pod, and sends the text back to the bridge, which relays it to every participant. This page is for developers who change the gateway. The decision is [ADR-018](../../../docs/adr/018-live-captions.md).

## What it does

- **Accepts the bridge.** A WebSocket on `/transcribe/<meetingId>?room=<room>`, opened by the bridge when Jicofo asks it to transcribe a conference. If `CAPTIONS_AUTH_TOKEN` is set, the connection must carry it in `X-Captions-Token` (or as a bearer token).
- **Decodes each speaker.** One Opus decoder per audio source (`opus-decoder`, WebAssembly), straight to 16 kHz mono. Short gaps in the RTP timestamps are filled with silence.
- **Transcribes.** One engine session per speaker, configured with the room's language and vocabulary. A pause in the stream closes the sentence on the engine; each new sentence starts with 300 ms of silence, without which the model loses the first word and the punctuation.
- **Builds captions.** The engine's fragments become one caption at a time, sent whole on every update, split when they get too long, with the glossary's known misspellings corrected (`src/captions.ts`).
- **Governs the load.** The delay of every fragment feeds a governor that reduces the number of speakers transcribed or pauses the service (`src/load.ts`).
- **Reports.** `GET /healthz` (alive), `GET /readyz` (the engine answers) and `GET /status` (state, delay, speakers; no personal data).

| File | Role |
|---|---|
| `src/mediajson.ts` | The bridge's protocol: parsing `start`, `media`, `ping`, `session-end`; building `pong` and `transcription-result` |
| `src/engine.ts` | One session on the engine's realtime WebSocket, with the lag measurement |
| `src/captions.ts` | From fragments to captions; glossary corrections |
| `src/load.ts` | Load governance, pure logic with an injected clock |
| `src/context.ts` | The room's context from the portal (`/api/internal/captions/context`) |
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

The gateway logs service events only: conferences connecting and closing, state changes of the load governor, the engine becoming reachable or not. It never logs transcribed text or names.
