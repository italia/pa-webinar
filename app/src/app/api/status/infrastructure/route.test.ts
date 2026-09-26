// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { visible, settings, findMany, count } = vi.hoisted(() => ({
  visible: vi.fn(),
  settings: vi.fn(),
  findMany: vi.fn(async (): Promise<unknown[]> => []),
  count: vi.fn(async () => 0),
}));

vi.mock('@/lib/status-page', () => ({ statusDataVisible: visible }));
vi.mock('@/lib/settings', () => ({ getSettings: settings }));
vi.mock('@/lib/jvb-snapshot', () => ({ readJvbSnapshot: vi.fn(async () => null) }));
vi.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: vi.fn(async () => [{ ok: 1 }]),
    event: { findMany, count },
    registration: { count: vi.fn(async () => 0) },
  },
}));
vi.mock('@/lib/redis', async (importOriginal) => ({
  ...(await importOriginal<typeof RedisModule>()),
  getRedis: () => null,
}));

import type * as RedisModule from '@/lib/redis';
import { __resetProbeCache } from '@/lib/status/probes';

import { GET, type InfraMapData } from './route';

function fetchFailed(code: string): TypeError {
  const err = new TypeError('fetch failed');
  (err as TypeError & { cause: unknown }).cause = Object.assign(new Error(code), { code });
  return err;
}

async function mappa(): Promise<InfraMapData> {
  const res = await GET(
    new Request('http://localhost:3000/api/status/infrastructure') as never,
    { params: Promise.resolve({}) },
  );
  expect(res.status).toBe(200);
  return (await res.json()) as InfraMapData;
}

const nodo = (data: InfraMapData, id: string) => data.services.find((s) => s.id === id)!;

/** Un `fetch` che risponde per prefisso d'indirizzo; il resto non si risolve. */
function rete(risposte: Record<string, (() => Response) | string>) {
  return vi.fn(async (url: string) => {
    for (const [prefisso, esito] of Object.entries(risposte)) {
      if (String(url).startsWith(prefisso)) {
        if (typeof esito === 'string') throw fetchFailed(esito);
        return esito();
      }
    }
    throw fetchFailed('ENOTFOUND');
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetProbeCache();
  settings.mockResolvedValue({ statusPageEnabled: true });
  findMany.mockResolvedValue([]);
  count.mockResolvedValue(0);
  visible.mockResolvedValue(true);
  vi.stubEnv('NEXT_PUBLIC_JITSI_DOMAIN', 'jitsi.example.test');
  vi.stubEnv('JVB_SCALER_ENABLED', 'false');
  vi.stubEnv('RECORDING_STORAGE_TYPE', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('GET /api/status/infrastructure', () => {
  it('pagina di stato spenta: 404 prima di leggere configurazione o topologia', async () => {
    // Domini, namespace e repliche sono proprio ciò che l'amministrazione
    // sceglie di non pubblicare spegnendo la pagina.
    visible.mockResolvedValue(false);
    const res = await GET(
      new Request('http://localhost:3000/api/status/infrastructure') as never,
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(404);
    expect(settings).not.toHaveBeenCalled();
  });
});

describe('GET /api/status/infrastructure — Jibri', () => {
  it('senza Jibri previsto non interroga il suo indirizzo (il chart lo imposta comunque)', async () => {
    vi.stubEnv('JIBRI_HEALTH_URL', 'http://rel-jitsi-meet-jibri:2222');
    const fetchMock = rete({});
    vi.stubGlobal('fetch', fetchMock);

    const data = await mappa();

    const chiamati = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(chiamati.some((u) => u.includes('jibri'))).toBe(false);
    expect(nodo(data, 'jibri')).toMatchObject({
      status: 'standby',
      verdict: 'infraMap.verdicts.jibri.unconfigured',
      impact: null,
    });
  });
});

describe('GET /api/status/infrastructure — Jitsi', () => {
  it('con gli indirizzi interni ogni componente ha il suo stato', async () => {
    vi.stubEnv('JITSI_WEB_INTERNAL_URL', 'http://web');
    vi.stubEnv('PROSODY_INTERNAL_URL', 'http://prosody:5280');
    vi.stubEnv('JICOFO_HEALTH_URL', 'http://jicofo:8888');
    vi.stubGlobal(
      'fetch',
      rete({
        'http://web/': () => new Response('ok'),
        'http://prosody:5280/': () => new Response('ok'),
        'http://jicofo:8888/': 'ECONNREFUSED',
      }),
    );

    const data = await mappa();

    expect(nodo(data, 'jitsi-web')).toMatchObject({ status: 'healthy', impact: null });
    expect(nodo(data, 'prosody')).toMatchObject({ status: 'healthy', impact: null });
    expect(nodo(data, 'jicofo')).toMatchObject({
      status: 'down',
      verdict: 'infraMap.verdicts.jicofo.down',
      impact: 'infraMap.impacts.jicofo',
    });
    expect(nodo(data, 'jicofo').metadata.probeDetail).toBe('ECONNREFUSED');
  });

  it('solo l’indirizzo pubblico, certificato non riconosciuto: degradato, nessun «le conferenze non funzionano»', async () => {
    vi.stubGlobal('fetch', rete({ 'https://jitsi.example.test': 'DEPTH_ZERO_SELF_SIGNED_CERT' }));

    const data = await mappa();

    expect(nodo(data, 'jitsi-web')).toMatchObject({
      status: 'degraded',
      verdict: 'infraMap.verdicts.jitsiWeb.publicCheckFailed',
      impact: null,
    });
    expect(nodo(data, 'prosody')).toMatchObject({ status: 'degraded', impact: null });
    // Jicofo non ha un indirizzo pubblico: non monitorato, non «giù».
    expect(nodo(data, 'jicofo')).toMatchObject({
      status: 'unknown',
      verdict: 'infraMap.verdicts.jicofo.unmonitored',
      impact: null,
    });
  });
});

describe('GET /api/status/infrastructure — ponte video', () => {
  const diretta = {
    id: 'live1',
    status: 'LIVE',
    startsAt: new Date(Date.now() - 20 * 60_000),
    provisioningStartedAt: null,
    maxParticipants: 300,
    expectedSenderRatioPct: null,
    participantsCanStartVideo: true,
    recordingEnabled: false,
  };

  it('bridge fisso che risponde, con una diretta: operativo, niente barre di scalata', async () => {
    vi.stubEnv('JVB_HEALTH_URL', 'http://ponte:8080');
    vi.stubEnv('JVB_MAX_REPLICAS', '1');
    findMany.mockResolvedValue([diretta]);
    vi.stubGlobal('fetch', rete({ 'http://ponte:8080/': () => Response.json({ participants: 3 }) }));

    const jvb = nodo(await mappa(), 'jvb');

    expect(jvb).toMatchObject({ status: 'healthy', verdict: 'infraMap.verdicts.jvb.healthy', impact: null });
    expect(jvb.replicas).toEqual({ running: 1, desired: null, max: null });
    expect(jvb.metadata.mode).toBe('fixed');
  });

  it('bridge fisso che non risponde, anche senza eventi: giù, mai «standby»', async () => {
    vi.stubEnv('JVB_HEALTH_URL', 'http://ponte:8080');
    vi.stubGlobal('fetch', rete({}));

    const jvb = nodo(await mappa(), 'jvb');

    expect(jvb).toMatchObject({
      status: 'down',
      verdict: 'infraMap.verdicts.jvb.fixedDown',
      impact: 'infraMap.impacts.jvbDown',
    });
  });

  it('senza indirizzo e senza scaler: non monitorato', async () => {
    findMany.mockResolvedValue([diretta]);
    vi.stubGlobal('fetch', rete({}));

    const jvb = nodo(await mappa(), 'jvb');

    expect(jvb).toMatchObject({ status: 'unknown', verdict: 'infraMap.verdicts.jvb.unmonitored', impact: null });
    expect(jvb.replicas).toEqual({ running: null, desired: null, max: null });
  });

  it('con lo scaler la lettura scale-to-zero resta quella di prima', async () => {
    vi.stubEnv('JVB_SCALER_ENABLED', 'true');
    vi.stubEnv('JVB_MAX_REPLICAS', '6');
    vi.stubGlobal('fetch', rete({}));

    expect(nodo(await mappa(), 'jvb')).toMatchObject({
      status: 'standby',
      verdict: 'infraMap.verdicts.jvb.standby',
    });

    __resetProbeCache();
    findMany.mockResolvedValue([{ ...diretta, startsAt: new Date(Date.now() - 60_000) }]);
    const jvb = nodo(await mappa(), 'jvb');
    expect(jvb.status).toBe('scaling');
    expect(jvb.replicas).toEqual({ running: 0, desired: 3, max: 6 });
  });
});

describe('GET /api/status/infrastructure — valori dell’installazione', () => {
  it('profilo, database, versione dichiarati; repliche dell’app non inventate', async () => {
    vi.stubEnv('DEPLOY_PROFILE', 'simple');
    vi.stubEnv('KUBERNETES_SERVICE_HOST', '10.0.0.1');
    vi.stubEnv('JVB_MAX_REPLICAS', '1');
    vi.stubEnv('DATABASE_BUNDLED', 'true');
    vi.stubEnv('NEXT_PUBLIC_BUILD_VERSION', '1.2.3');
    vi.stubGlobal('fetch', rete({}));

    const data = await mappa();

    expect(data.cluster.mode).toBe('simple');
    expect(data.cluster.version).toBe('1.2.3');
    expect(nodo(data, 'database').metadata.type).toBe('in-cluster');
    expect(nodo(data, 'app').replicas.running).toBeNull();
  });

  it('i contatori usano la regola della pagina di stato: le dirette senza limite di orario', async () => {
    vi.stubGlobal('fetch', rete({}));
    await mappa();
    const wheres = count.mock.calls.map((c) => JSON.stringify((c as unknown as [{ where: unknown }])[0].where));
    expect(wheres).toContain('{"status":"LIVE"}');
    expect(wheres.some((w) => w.includes('{"status":"LIVE"}') && w.includes('"PUBLISHED"'))).toBe(true);
  });
});
