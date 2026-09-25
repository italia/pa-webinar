// @vitest-environment node
/**
 * A pagina di stato spenta la rotta risponde ancora — la sala live la
 * interroga per sapere se il ponte video è pronto — ma solo con quei valori.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { visible, findMany } = vi.hoisted(() => ({
  visible: vi.fn(),
  findMany: vi.fn(async (): Promise<unknown[]> => []),
}));

vi.mock('@/lib/status-page', () => ({ statusDataVisible: visible }));
vi.mock('@/lib/settings', () => ({ getSettings: async () => ({}) }));
vi.mock('@/lib/jvb-snapshot', () => ({ readJvbSnapshot: vi.fn(async () => null) }));
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findMany, count: vi.fn(async () => 0) },
    registration: { count: vi.fn(async () => 0) },
    orphanRecording: { count: vi.fn(async () => 0) },
  },
}));
// Senza Redis: l'orologio dell'attesa del registratore resta in memoria.
vi.mock('@/lib/redis', async (importOriginal) => ({
  ...(await importOriginal<typeof RedisModule>()),
  getRedis: () => null,
}));

import { __resetRecorderWait } from '@/lib/jitsi/recorder-wait';
import type * as RedisModule from '@/lib/redis';

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
});

async function chiedi(): Promise<Record<string, unknown>> {
  const res = await GET(new Request('http://localhost:3000/api/status') as never, {
    params: Promise.resolve({}),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

describe('GET /api/status — pagina di stato spenta', () => {
  it('al pubblico arrivano solo i valori che legge la sala live', async () => {
    visible.mockResolvedValue(false);

    const body = await chiedi();

    expect(Object.keys(body).sort()).toEqual(['lastChecked', 'metrics']);
    expect(Object.keys(body.metrics as object).sort()).toEqual([
      'jibriStatus',
      'jvbParticipants',
      'jvbStale',
      'jvbStatus',
    ]);
  });
});

describe('GET /api/status — registratore', () => {
  const T0 = new Date('2026-03-02T10:00:00Z').getTime();
  const MIN = 60_000;
  let salute: 'giu' | 'su';

  const eventoConRegistrazione = {
    id: 'ev1',
    status: 'LIVE',
    startsAt: new Date(T0 + 60 * MIN),
    provisioningStartedAt: null,
    maxParticipants: 50,
    expectedSenderRatioPct: null,
    participantsCanStartVideo: false,
  };

  async function statoRegistratore(minuto: number): Promise<unknown> {
    vi.setSystemTime(T0 + minuto * MIN);
    const body = await chiedi();
    return (body.metrics as Record<string, unknown>).jibriStatus;
  }

  /** Come fa la sala: interroga senza pause lunghe (qui ogni minuto) fino a
   *  `minuto`, e restituisce l'ultima risposta. */
  let ultimoMinuto = 0;
  async function finoA(minuto: number): Promise<unknown> {
    for (let m = ultimoMinuto + 1; m < minuto; m += 1) await statoRegistratore(m);
    ultimoMinuto = minuto;
    return statoRegistratore(minuto);
  }

  beforeEach(() => {
    __resetRecorderWait();
    ultimoMinuto = 0;
    visible.mockResolvedValue(false);
    vi.useFakeTimers({ toFake: ['Date'] });
    salute = 'giu';
    vi.stubEnv('KUBERNETES_SERVICE_HOST', '10.0.0.1');
    vi.stubEnv('JIBRI_HEALTH_URL', 'http://registratore:2222');
    vi.stubEnv('RECORDING_STORAGE_TYPE', 's3');
    vi.stubEnv('RECORDING_S3_BUCKET', '');
    vi.stubEnv('RECORDING_AZURE_CONNECTION_STRING', '');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).startsWith('http://registratore:2222') && salute === 'su') {
          return Response.json({ status: { busyStatus: 'IDLE', health: { healthStatus: 'HEALTHY' } } });
        }
        throw new Error('irraggiungibile');
      }),
    );
    findMany.mockResolvedValue([eventoConRegistrazione]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('«in avvio» ha un limite: passato il tempo di allestimento diventa «failed»', async () => {
    expect(await statoRegistratore(0)).toBe('scaling');
    for (let m = 1; m < 15; m += 1) {
      expect(await finoA(m), `minuto ${m}`).toBe('scaling');
    }
    expect(await finoA(15)).toBe('failed');
    expect(await finoA(40)).toBe('failed');
  });

  it('quando risponde è pronto, e un’attesa successiva riparte da zero', async () => {
    await statoRegistratore(0);
    expect(await finoA(17)).toBe('failed');

    salute = 'su';
    expect(await finoA(18)).toBe('ready');

    salute = 'giu';
    expect(await finoA(19)).toBe('scaling');
    expect(await finoA(33)).toBe('scaling');
    expect(await finoA(34)).toBe('failed');
  });

  it('senza URL di salute in un cluster non resta «in avvio» per sempre', async () => {
    vi.stubEnv('JIBRI_HEALTH_URL', '');
    expect(await statoRegistratore(0)).toBe('scaling');
    expect(await finoA(14)).toBe('scaling');
    expect(await finoA(15)).toBe('failed');
  });

  it('nessun evento lo chiede: «standby», e l’attesa si azzera', async () => {
    await statoRegistratore(0);
    await finoA(10);
    findMany.mockResolvedValue([]);
    expect(await finoA(11)).toBe('standby');
    findMany.mockResolvedValue([eventoConRegistrazione]);
    expect(await finoA(12)).toBe('scaling');
    expect(await finoA(26)).toBe('scaling');
    expect(await finoA(27)).toBe('failed');
  });

  it('un evento che parte subito dopo uno rimasto senza registratore ha il suo tempo', async () => {
    await statoRegistratore(0);
    expect(await finoA(20)).toBe('failed');
    // Il primo evento finisce e per tre minuti nessuno interroga: il
    // segnaposto della sua attesa non è ancora scaduto.
    findMany.mockResolvedValue([{ ...eventoConRegistrazione, id: 'ev2' }]);
    ultimoMinuto = 22;
    expect(await finoA(23)).toBe('scaling');
    expect(await finoA(37)).toBe('scaling');
    expect(await finoA(38)).toBe('failed');
  });

  it('le sole credenziali dello storage non fanno aspettare Jibri', async () => {
    // Un'installazione senza Jibri, con lo storage delle registrazioni per il
    // registratore per partecipante e il JIBRI_HEALTH_URL che il chart imposta
    // comunque: nessun «in avvio», nessun «non partito», a qualunque minuto.
    vi.stubEnv('RECORDING_STORAGE_TYPE', '');
    vi.stubEnv('RECORDING_S3_BUCKET', 'registrazioni');
    expect(await statoRegistratore(0)).toBe('unavailable');
    expect(await finoA(30)).toBe('unavailable');
  });

  it('senza storage delle registrazioni è «unavailable», non un’attesa', async () => {
    vi.stubEnv('RECORDING_STORAGE_TYPE', '');
    expect(await statoRegistratore(0)).toBe('unavailable');
    expect(await statoRegistratore(30)).toBe('unavailable');
  });
});
