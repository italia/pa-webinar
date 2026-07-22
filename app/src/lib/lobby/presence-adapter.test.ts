import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { GardenPresenceClient } from './presence-adapter';
import type { LobbyLocalState } from './shared';

/**
 * L'emote della piazza, dal tasto premuto all'avatar dell'altro.
 *
 * Il difetto di partenza non era un crash ma una BUGIA dell'interfaccia:
 * `emote()` era un no-op dichiarato, quindi chi salutava vedeva la propria
 * animazione partire e credeva che gli altri la vedessero — non la vedeva
 * nessuno. Qui si verifica che il saluto viaggi davvero sul ping di presenza e
 * che arrivi UNA volta sola a destinazione.
 *
 * Non si mocka nulla del client: solo `fetch` (è l'unico I/O) e il tempo, che
 * è parte del contratto — la finestra di ripetizione e il throttle sono
 * entrambi decisioni prese sull'orologio.
 */

const SLUG = 'evento-di-prova';
const WORLD = { w: 1600, h: 1024 };
const SELF_ID = 'self-0123456789';

const PROFILE = {
  id: SELF_ID,
  name: 'Anna',
  color: '#0066CC',
  accessories: { helmet: false, glasses: false },
};

/** Un peer come lo restituisce la rotta ping (percentuali, non px). */
function peerWire(over: Record<string, unknown> = {}) {
  return {
    userId: 'peer-1',
    displayName: 'Bruno',
    avatarId: '008758',
    x: 50,
    y: 50,
    facing: 'down',
    walkPhase: 0,
    updatedAt: Date.now(),
    ...over,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
let snapshot: Record<string, unknown>[] = [];

/** Il corpo dell'ultima POST: è lì che si vede se l'emote è partita davvero. */
function lastBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls.at(-1) as [string, { body: string }] | undefined;
  expect(call, 'nessun ping inviato').toBeDefined();
  return JSON.parse(call![1].body) as Record<string, unknown>;
}

/** I corpi di tutti i ping inviati dopo l'ultimo `mockClear()`. */
function allBodies(): Record<string, unknown>[] {
  return (fetchMock.mock.calls as [string, { body: string }][]).map(
    ([, init]) => JSON.parse(init.body) as Record<string, unknown>,
  );
}

/** Fa girare i microtask (le POST sono async) senza far scattare l'intervallo. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

async function connectedClient(): Promise<GardenPresenceClient> {
  const shared: LobbyLocalState = {
    name: 'Anna',
    color: '#0066CC',
    helmet: false,
    glasses: false,
  };
  const client = new GardenPresenceClient(SLUG, WORLD, shared);
  await client.connect(PROFILE);
  await flush(); // il ping di apertura non deve sporcare le asserzioni
  fetchMock.mockClear();
  return client;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-22T10:00:00.000Z'));
  snapshot = [];
  fetchMock = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ peers: snapshot, active: true }),
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('GardenPresenceClient.emote — trasmissione', () => {
  it('allega l’emote al ping e lo spedisce subito', async () => {
    // Il difetto: `emote()` non spediva niente. Se questa asserzione cade, il
    // tasto torna a essere una promessa non mantenuta.
    const client = await connectedClient();
    client.emote('wave');
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1); // subito, non al tick da 200ms
    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/events/${SLUG}/garden/ping`);
    expect(lastBody().emote).toEqual({ type: 'wave', at: Date.now() });
    client.disconnect();
  });

  it('ripete l’emote per tutta la durata dell’animazione, poi smette', async () => {
    // Redis tiene un solo record per utente: con l'emote in UN ping soltanto
    // resterebbe leggibile ~200ms e un peer che poll-a con jitter non la
    // vedrebbe mai. Deve restare allegata per la finestra dell'animazione.
    const client = await connectedClient();
    client.emote('heart');
    const at = Date.now();
    await flush();
    fetchMock.mockClear();

    await vi.advanceTimersByTimeAsync(1000); // 5 tick dentro la finestra
    const dentro = allBodies();
    expect(dentro.length).toBeGreaterThanOrEqual(4);
    // Stesso `at` su tutti: è una ripetizione, non cinque saluti diversi.
    expect(dentro.map((b) => b.emote)).toEqual(
      dentro.map(() => ({ type: 'heart', at })),
    );

    await vi.advanceTimersByTimeAsync(600); // ora siamo oltre i 1500ms
    fetchMock.mockClear();
    await vi.advanceTimersByTimeAsync(600);
    // I ping continuano (la presenza non si ferma), ma senza più l'emote.
    expect(allBodies().length).toBeGreaterThan(0);
    expect(allBodies().every((b) => b.emote === undefined)).toBe(true);
    client.disconnect();
  });

  it('assorbe l’auto-repeat del tasto invece di sparare una POST per keydown', async () => {
    // `emote()` è chiamata da un handler di keydown senza guardia sul repeat:
    // tenendo premuto E il browser ripete ~30 volte al secondo. Senza throttle
    // si superano le 600 richieste/minuto della rotta e a quel punto falliscono
    // anche i ping di POSIZIONE: l'utente sparisce dal giardino di tutti.
    const client = await connectedClient();
    for (let i = 0; i < 30; i++) client.emote('wave');
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    client.disconnect();
  });

  it('lascia passare un nuovo gesto una volta scaduto il throttle', async () => {
    // Il throttle non deve diventare un bavaglio: dopo la finestra minima un
    // secondo saluto (anche di tipo diverso) deve partire.
    const client = await connectedClient();
    client.emote('wave');
    await flush();
    fetchMock.mockClear();

    await vi.advanceTimersByTimeAsync(700);
    client.emote('heart');
    await flush();

    expect(lastBody().emote).toEqual({ type: 'heart', at: Date.now() });
    client.disconnect();
  });

  it('non spedisce nulla se il client non è connesso', async () => {
    const shared: LobbyLocalState = {
      name: 'Anna',
      color: '#0066CC',
      helmet: false,
      glasses: false,
    };
    const client = new GardenPresenceClient(SLUG, WORLD, shared);
    client.emote('wave');
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GardenPresenceClient — emote in arrivo dai peer', () => {
  it('notifica il saluto di un peer una volta sola, non a ogni poll', async () => {
    // Il mittente ripete l'emote su ~7 ping consecutivi: se il ricevente non
    // deduplicasse sull'`at`, l'animazione ripartirebbe da capo a ogni poll e
    // il peer resterebbe con l'emoji incollata sopra la testa.
    const client = await connectedClient();
    const emoted: string[] = [];
    client.on('peerEmote', (p) => emoted.push(`${p.id}:${p.emote?.type}`));

    snapshot = [peerWire()]; // prima visto senza emote, così il join è già passato
    await vi.advanceTimersByTimeAsync(200);
    snapshot = [peerWire({ emote: { type: 'wave', at: 1_000 } })];
    await vi.advanceTimersByTimeAsync(1000); // 5 poll con la stessa emote

    expect(emoted).toEqual(['peer-1:wave']);
    client.disconnect();
  });

  it('notifica di nuovo quando il peer saluta una seconda volta', async () => {
    // Guardia contro una deduplica troppo aggressiva (per id peer o per tipo):
    // due saluti identici a distanza di tempo sono due eventi distinti, e si
    // distinguono solo per l'`at`.
    const client = await connectedClient();
    const emoted: number[] = [];
    client.on('peerEmote', (p) => emoted.push(p.emote?.at ?? -1));

    snapshot = [peerWire({ emote: { type: 'wave', at: 1_000 } })];
    await vi.advanceTimersByTimeAsync(200);
    snapshot = [peerWire({ emote: { type: 'wave', at: 5_000 } })];
    await vi.advanceTimersByTimeAsync(200);

    expect(emoted).toEqual([1_000, 5_000]);
    client.disconnect();
  });

  it('emette peerEmote DOPO peerJoin quando il saluto arriva col primo avvistamento', async () => {
    // Il PeerStore del gioco scarta le emote dei peer che non ha ancora in
    // mappa: invertire l'ordine farebbe sparire il saluto di chi entra
    // salutando, che è esattamente il caso più frequente.
    const client = await connectedClient();
    const ordine: string[] = [];
    client.on('peerJoin', () => ordine.push('join'));
    client.on('peerEmote', () => ordine.push('emote'));

    snapshot = [peerWire({ emote: { type: 'heart', at: 2_000 } })];
    await vi.advanceTimersByTimeAsync(200);

    expect(ordine).toEqual(['join', 'emote']);
    client.disconnect();
  });

  it('porta l’emote dentro il PeerState, in px di mondo come il resto', async () => {
    const client = await connectedClient();
    const visti: unknown[] = [];
    client.on('peerEmote', (p) => visti.push({ x: p.x, y: p.y, emote: p.emote }));

    snapshot = [peerWire({ x: 50, y: 50, emote: { type: 'wave', at: 3_000 } })];
    await vi.advanceTimersByTimeAsync(200);

    expect(visti).toEqual([
      { x: WORLD.w / 2, y: WORLD.h / 2, emote: { type: 'wave', at: 3_000 } },
    ]);
    client.disconnect();
  });

  it('ignora l’eco del proprio saluto (la snapshot include sé stessi)', async () => {
    // La rotta rimanda indietro anche il record di chi ha pingato: senza il
    // filtro su selfId l'utente vedrebbe il proprio saluto come se fosse di un
    // altro, e con l'emote ripetuta lo vedrebbe più volte.
    const client = await connectedClient();
    const emoted: unknown[] = [];
    client.on('peerEmote', (p) => emoted.push(p.id));

    snapshot = [peerWire({ userId: SELF_ID, emote: { type: 'wave', at: 4_000 } })];
    await vi.advanceTimersByTimeAsync(400);

    expect(emoted).toEqual([]);
    expect(client.getPeers()).toEqual([]);
    client.disconnect();
  });
});
