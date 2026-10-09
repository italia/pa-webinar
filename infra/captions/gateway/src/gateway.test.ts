/**
 * Il gateway per intero, su WebSocket vere: un finto bridge manda audio
 * Opus (frame di silenzio da 20 ms), un finto motore risponde con frammenti
 * di testo, e il bridge deve ricevere i sottotitoli provvisori e definitivi.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';

import { loadConfig } from './config.js';
import { ContextProvider } from './context.js';
import { Gateway } from './gateway.js';
import { createGatewayServer } from './server.js';

const SILENCE = '+P/+'; // frame Opus CELT di silenzio, 20 ms

interface EngineSessionLog {
  ws: WebSocket;
  update: Record<string, unknown> | null;
  pcmBytes: number;
  commits: number;
}

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

async function listen(server: Server | WebSocketServer): Promise<number> {
  return new Promise((resolve) => {
    if (server instanceof WebSocketServer) {
      server.on('listening', () => resolve((server.address() as AddressInfo).port));
    } else {
      server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
    }
  });
}

async function waitFor<T>(fn: () => T | undefined | null | false, timeoutMs = 3000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = fn();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error('condizione non raggiunta');
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function fakeEngine(transcript = 'Buongiorno a tutti.', completedDelayMs = 0) {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  const port = await listen(wss);
  const sessions: EngineSessionLog[] = [];
  wss.on('connection', (ws) => {
    const log: EngineSessionLog = { ws, update: null, pcmBytes: 0, commits: 0 };
    sessions.push(log);
    ws.send(JSON.stringify({ type: 'session.created' }));
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        log.pcmBytes += (data as Buffer).length;
        return;
      }
      const ev = JSON.parse(data.toString()) as { type: string; session?: Record<string, unknown> };
      if (ev.type === 'session.update') {
        log.update = ev.session ?? null;
        ws.send(JSON.stringify({ type: 'session.updated' }));
      } else if (ev.type === 'input_audio_buffer.commit') {
        log.commits += 1;
        setTimeout(() => {
          ws.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript }));
          ws.send(JSON.stringify({ type: 'input_audio_buffer.committed' }));
        }, completedDelayMs);
      }
    });
  });
  cleanups.push(() => new Promise<void>((r) => wss.close(() => r())));
  return { sessions, url: `ws://127.0.0.1:${port}/v1/audio/transcriptions/realtime` };
}

async function startGateway(env: Record<string, string>, contextUrl?: string) {
  const config = loadConfig({
    CAPTIONS_AUTH_TOKEN: 'segreto',
    CAPTIONS_PAUSE_GAP_MS: '150',
    CAPTIONS_INTERIM_INTERVAL_MS: '0',
    ...(contextUrl ? { CAPTIONS_CONTEXT_URL: contextUrl, CAPTIONS_CONTEXT_TOKEN: 'ctx' } : {}),
    ...env,
  });
  const gateway = new Gateway(
    config,
    new ContextProvider({ url: config.contextUrl, token: config.contextToken, defaultLanguage: config.defaultLanguage }),
  );
  const server = createGatewayServer(gateway);
  const port = await listen(server);
  cleanups.push(
    () =>
      new Promise<void>((r) => {
        gateway.stop();
        server.close(() => r());
      }),
  );
  return { gateway, port };
}

async function bridge(port: number, path = '/transcribe/meet-1?room=stanza', token = 'segreto') {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: { 'x-captions-token': token } });
  const received: Array<Record<string, unknown>> = [];
  ws.on('message', (data) => received.push(JSON.parse(data.toString()) as Record<string, unknown>));
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });
  cleanups.push(() => ws.terminate());
  let ts = 0;
  return {
    ws,
    received,
    send: (ev: unknown) => ws.send(JSON.stringify(ev)),
    start: (tag: string, endpointId: string) =>
      ws.send(
        JSON.stringify({
          event: 'start',
          sequenceNumber: '0',
          start: { tag, mediaFormat: { encoding: 'opus', sampleRate: 48000, channels: 2 }, customParameters: { endpointId } },
        }),
      ),
    media: (tag: string, frames: number) => {
      for (let i = 0; i < frames; i++) {
        ws.send(JSON.stringify({ event: 'media', sequenceNumber: '1', media: { tag, chunk: '1', timestamp: String(ts), payload: SILENCE } }));
        ts += 960;
      }
    },
  };
}

const results = (msgs: Array<Record<string, unknown>>) =>
  msgs.filter((m) => m.type === 'transcription-result') as Array<{
    message_id: string;
    is_interim: boolean;
    participant: { id: string };
    transcript: Array<{ text: string }>;
    event: string;
  }>;

describe('gateway', () => {
  it('trasforma audio e frammenti del motore in sottotitoli provvisori e definitivi', async () => {
    const engine = await fakeEngine();
    const { port } = await startGateway({ CAPTIONS_ENGINE_URL: engine.url });
    const b = await bridge(port);

    b.start('abcd1234-77', 'abcd1234');
    b.media('abcd1234-77', 10);
    const session = await waitFor(() => engine.sessions[0]?.update && engine.sessions[0]);
    expect(session.update).toEqual({ sample_rate: 16000, language: 'it-IT' });
    await waitFor(() => session.pcmBytes >= 10 * 320 * 2 && session.pcmBytes);

    session.ws.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', delta: 'Buongiorno', audio_processed: 0.1 }));
    session.ws.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', delta: ' a tutti', audio_processed: 0.2 }));
    await waitFor(() => results(b.received).length >= 2);
    const [first, second] = results(b.received);
    expect(first).toMatchObject({ event: 'transcription-result', is_interim: true, participant: { id: 'abcd1234' } });
    expect(first?.transcript[0]?.text).toBe('Buongiorno');
    expect(second?.transcript[0]?.text).toBe('Buongiorno a tutti');

    // Niente più pacchetti: dopo la pausa la frase si chiude con il testo del motore.
    await waitFor(() => session.commits === 1);
    const final = await waitFor(() => results(b.received).find((r) => !r.is_interim));
    expect(final.transcript[0]?.text).toBe('Buongiorno a tutti.');
    expect(final.message_id).toBe(first?.message_id);
  });

  it('un testo definitivo che arriva dopo la scadenza non riapre la frase già chiusa', async () => {
    const engine = await fakeEngine('Buongiorno a tutti.', 600);
    const { port } = await startGateway({ CAPTIONS_ENGINE_URL: engine.url, CAPTIONS_FINISH_TIMEOUT_MS: '200' });
    const b = await bridge(port);
    b.start('cc-1', 'cc');
    b.media('cc-1', 5);
    const session = await waitFor(() => engine.sessions[0]?.update && engine.sessions[0]);
    session.ws.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', delta: 'Buongiorno', audio_processed: 0.1 }));
    await waitFor(() => session.commits === 1);
    const finale = await waitFor(() => results(b.received).find((r) => !r.is_interim));
    expect(finale.transcript[0]?.text).toBe('Buongiorno');
    // Il `completed` arriva 600 ms dopo il commit: nessun secondo definitivo.
    await new Promise((r) => setTimeout(r, 900));
    expect(results(b.received).filter((r) => !r.is_interim)).toHaveLength(1);
  });

  it('rilegge il contesto: i sottotitoli riaccesi dal vivo ripartono senza riconnettere il bridge', async () => {
    const engine = await fakeEngine();
    let enabled = false;
    const ctx = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ enabled }));
    });
    const ctxPort = await listen(ctx);
    cleanups.push(() => new Promise<void>((r) => ctx.close(() => r())));
    const { port } = await startGateway(
      { CAPTIONS_ENGINE_URL: engine.url, CAPTIONS_CONTEXT_REFRESH_MS: '600' },
      `http://127.0.0.1:${ctxPort}/ctx`,
    );
    const b = await bridge(port);
    b.start('dd-1', 'dd');
    b.media('dd-1', 5);
    await new Promise((r) => setTimeout(r, 200));
    expect(engine.sessions).toHaveLength(0);
    enabled = true;
    // Spenti, il contesto si rilegge ogni 100 ms; la cache del portale dura 4 s.
    await new Promise((r) => setTimeout(r, 4300));
    b.media('dd-1', 5);
    await waitFor(() => engine.sessions[0]?.update, 3000);
  }, 10_000);

  it('risponde ai ping del bridge', async () => {
    const engine = await fakeEngine();
    const { port } = await startGateway({ CAPTIONS_ENGINE_URL: engine.url });
    const b = await bridge(port);
    b.send({ event: 'ping', id: 3 });
    await waitFor(() => b.received.find((m) => m.event === 'pong'));
    expect(b.received.find((m) => m.event === 'pong')).toEqual({ event: 'pong', id: 3 });
  });

  it('rifiuta il bridge senza il segreto', async () => {
    const engine = await fakeEngine();
    const { port } = await startGateway({ CAPTIONS_ENGINE_URL: engine.url });
    await expect(bridge(port, '/transcribe/x', 'sbagliato')).rejects.toThrow(/401/);
  });

  it('usa il contesto della stanza: lingua, frasi da favorire e correzioni', async () => {
    const engine = await fakeEngine('Il servizio pago pa.');
    let seen: { room: string | null; auth: string | undefined } | null = null;
    const ctx = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      seen = { room: url.searchParams.get('room'), auth: req.headers['x-api-key'] as string | undefined };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ enabled: true, language: 'it-IT', phrases: ['PagoPA'], aliases: [{ term: 'PagoPA', aliases: ['pago pa'] }] }));
    });
    const ctxPort = await listen(ctx);
    cleanups.push(() => new Promise<void>((r) => ctx.close(() => r())));

    const { port } = await startGateway({ CAPTIONS_ENGINE_URL: engine.url }, `http://127.0.0.1:${ctxPort}/ctx`);
    const b = await bridge(port, '/transcribe/meet-2?room=evento-prova');
    b.start('ee11-1', 'ee11');
    b.media('ee11-1', 5);
    const session = await waitFor(() => engine.sessions[0]?.update && engine.sessions[0]);
    expect(seen).toEqual({ room: 'evento-prova', auth: 'ctx' });
    expect(session.update).toEqual({
      sample_rate: 16000,
      language: 'it-IT',
      speech_contexts: [{ phrases: ['PagoPA'], boost: 0.5 }],
    });
    session.ws.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', delta: 'Il servizio pago pa', audio_processed: 0.1 }));
    const final = await waitFor(() => results(b.received).find((r) => !r.is_interim));
    expect(final.transcript[0]?.text).toBe('Il servizio PagoPA.');
  });

  it('una stanza con i sottotitoli spenti non apre sessioni del motore', async () => {
    const engine = await fakeEngine();
    const ctx = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ enabled: false }));
    });
    const ctxPort = await listen(ctx);
    cleanups.push(() => new Promise<void>((r) => ctx.close(() => r())));
    const { port } = await startGateway({ CAPTIONS_ENGINE_URL: engine.url }, `http://127.0.0.1:${ctxPort}/ctx`);
    const b = await bridge(port);
    b.start('aa-1', 'aa');
    b.media('aa-1', 5);
    await new Promise((r) => setTimeout(r, 200));
    expect(engine.sessions).toHaveLength(0);
  });

  it('oltre il limite di voci, la nuova voce prende il posto di quella zitta da più tempo', async () => {
    const engine = await fakeEngine();
    const { gateway, port } = await startGateway({ CAPTIONS_ENGINE_URL: engine.url, CAPTIONS_MAX_STREAMS: '1' });
    const b = await bridge(port);
    b.start('aa-1', 'aa');
    b.media('aa-1', 3);
    await waitFor(() => engine.sessions[0]?.update);
    expect(gateway.status().activeStreams).toBe(1);

    // La seconda voce parla subito: la prima non è ancora zitta, resta lei.
    b.start('bb-1', 'bb');
    b.media('bb-1', 3);
    await new Promise((r) => setTimeout(r, 50));
    expect(engine.sessions).toHaveLength(1);

    // Dopo la pausa la prima è zitta: la seconda le subentra.
    await new Promise((r) => setTimeout(r, 200));
    b.media('bb-1', 3);
    await waitFor(() => engine.sessions[1]?.update);
    await waitFor(() => engine.sessions[0]?.ws.readyState === WebSocket.CLOSED);
    expect(gateway.status()).toMatchObject({ activeStreams: 1, maxStreams: 1, conferences: 1 });
  });

  it('espone lo stato su /status e /healthz', async () => {
    const engine = await fakeEngine();
    const { port } = await startGateway({ CAPTIONS_ENGINE_URL: engine.url });
    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(await health.text()).toBe('ok');
    const status = (await (await fetch(`http://127.0.0.1:${port}/status`)).json()) as Record<string, unknown>;
    expect(status).toMatchObject({ state: 'ok', engine: 'up', conferences: 0, activeStreams: 0, maxStreams: 4 });
  });
});
