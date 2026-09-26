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

import { leggiStatoPonte } from '@/lib/jitsi/bridge-readiness';
import { __resetRecorderWait } from '@/lib/jitsi/recorder-wait';
import type * as RedisModule from '@/lib/redis';
import { __resetProbeCache } from '@/lib/status/probes';

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
  __resetProbeCache();
});

async function chiedi(url = 'http://localhost:3000/api/status'): Promise<Record<string, unknown>> {
  const res = await GET(new Request(url) as never, {
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

/** Un errore di `fetch` di Node, con il codice nella causa. */
function fetchFailed(code: string): TypeError {
  const err = new TypeError('fetch failed');
  (err as TypeError & { cause: unknown }).cause = Object.assign(new Error(code), { code });
  return err;
}

type Componente = { name: string; status: string; details?: string };
const componente = (body: Record<string, unknown>, name: string) =>
  (body.components as Componente[]).find((c) => c.name === name);
const metriche = (body: Record<string, unknown>) => body.metrics as Record<string, unknown>;

/**
 * Bridge fissi (nessuno scaler, un indirizzo per interrogarli): il ponte
 * risponde o no, a prescindere dagli eventi. Mai «standby» da scale-to-zero,
 * mai «in preparazione», mai un evento «in attesa del bridge».
 */
describe('GET /api/status — ponte video senza scaler', () => {
  const T0 = new Date('2026-03-02T10:00:00Z').getTime();
  let ponte: 'su' | 'giu';

  const diretta = {
    id: 'live1',
    status: 'LIVE',
    startsAt: new Date(T0 - 20 * 60_000),
    provisioningStartedAt: null,
    maxParticipants: 300,
    expectedSenderRatioPct: null,
    participantsCanStartVideo: true,
    recordingEnabled: false,
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    visible.mockResolvedValue(true);
    ponte = 'su';
    vi.stubEnv('JVB_SCALER_ENABLED', 'false');
    vi.stubEnv('JVB_HEALTH_URL', 'http://ponte:8080');
    vi.stubEnv('JVB_MAX_REPLICAS', '1');
    vi.stubEnv('RECORDING_STORAGE_TYPE', '');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).startsWith('http://ponte:8080') && ponte === 'su') {
          return Response.json({ participants: 4, conferences: 1, stress_level: 0.1 });
        }
        throw fetchFailed('ECONNREFUSED');
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('nessun evento, ponte su: operativo e pronto, non «standby»', async () => {
    const body = await chiedi();
    expect(componente(body, 'jvb')?.status).toBe('operational');
    expect(metriche(body)).toMatchObject({
      jvbStatus: 'ready',
      jvbScalerEnabled: false,
      jvbMonitored: true,
      jvbMaxReplicas: 1,
      jvbParticipants: 4,
      jvbConferences: 1,
      jvbStale: false,
    });
  });

  it('nessun evento, ponte giù: interruzione, visibile anche senza eventi', async () => {
    ponte = 'giu';
    const body = await chiedi();
    expect(componente(body, 'jvb')).toMatchObject({ status: 'outage', details: 'Bridge not answering' });
  });

  it('una diretta da 20 minuti con il ponte giù: interruzione, mai «in preparazione» né «in attesa»', async () => {
    ponte = 'giu';
    findMany.mockResolvedValue([diretta]);
    const body = await chiedi();
    const m = metriche(body);
    expect(componente(body, 'jvb')?.status).toBe('outage');
    expect(componente(body, 'jvb')?.details).not.toMatch(/Scaling|Stale/);
    expect(m.jvbStatus).toBe('standby');
    expect(m.jvbStale).toBe(false);
    // La sala d'attesa non chiude la porta: «non lo so», mai «si sta accendendo».
    expect(leggiStatoPonte(m)).not.toBe(false);
  });

  it('una diretta da 300 posti con un solo bridge fisso: pronto, niente «1/3»', async () => {
    findMany.mockResolvedValue([diretta]);
    const body = await chiedi();
    expect(metriche(body).jvbStatus).toBe('ready');
    expect(leggiStatoPonte(metriche(body))).toBe(true);
  });

  it('a pagina di stato spenta la sala riceve lo stesso verdetto', async () => {
    visible.mockResolvedValue(false);
    findMany.mockResolvedValue([diretta]);
    const body = await chiedi();
    expect(metriche(body).jvbStatus).toBe('ready');
  });

  it('senza indirizzo del ponte (Compose, Jitsi esterno): non monitorato, mai interruzione né attesa', async () => {
    vi.stubEnv('JVB_HEALTH_URL', '');
    vi.stubEnv('JVB_MAX_REPLICAS', '4');
    findMany.mockResolvedValue([diretta]);
    const body = await chiedi();
    const m = metriche(body);
    expect(componente(body, 'jvb')).toMatchObject({ status: 'unknown', details: 'Not monitored' });
    expect(m).toMatchObject({ jvbStatus: 'standby', jvbMonitored: false, jvbStale: false });
    expect(leggiStatoPonte(m)).toBeNull();
  });
});

describe('GET /api/status — ponte video con lo scaler (invariato)', () => {
  const T0 = new Date('2026-03-02T10:00:00Z').getTime();

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    visible.mockResolvedValue(true);
    vi.stubEnv('JVB_SCALER_ENABLED', 'true');
    vi.stubEnv('JVB_HEALTH_URL', '');
    vi.stubEnv('JVB_MAX_REPLICAS', '6');
    vi.stubGlobal('fetch', vi.fn(async () => { throw fetchFailed('ECONNREFUSED'); }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('nessun evento: standby (scale-to-zero)', async () => {
    const body = await chiedi();
    expect(componente(body, 'jvb')).toMatchObject({ status: 'standby', details: 'Scale-to-zero — no events' });
    expect(metriche(body)).toMatchObject({ jvbStatus: 'standby', jvbScalerEnabled: true, jvbMaxReplicas: 6 });
  });

  it('un evento in diretta senza bridge acceso: in preparazione', async () => {
    findMany.mockResolvedValue([
      {
        id: 'live1',
        status: 'LIVE',
        startsAt: new Date(T0 - 60_000),
        provisioningStartedAt: null,
        maxParticipants: 50,
        expectedSenderRatioPct: null,
        participantsCanStartVideo: false,
        recordingEnabled: false,
      },
    ]);
    const body = await chiedi();
    expect(metriche(body).jvbStatus).toBe('scaling');
  });
});

describe('GET /api/status — componenti di Jitsi', () => {
  beforeEach(() => {
    visible.mockResolvedValue(true);
    vi.stubEnv('NEXT_PUBLIC_JITSI_DOMAIN', 'jitsi.example.test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('con gli indirizzi interni ognuno ha il suo stato, e il certificato pubblico non conta', async () => {
    vi.stubEnv('JITSI_WEB_INTERNAL_URL', 'http://web');
    vi.stubEnv('PROSODY_INTERNAL_URL', 'http://prosody:5280');
    vi.stubEnv('JICOFO_HEALTH_URL', 'http://jicofo:8888');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.startsWith('http://web/') || u.startsWith('http://prosody:5280/')) return new Response('ok');
        if (u.startsWith('http://jicofo:8888/')) throw fetchFailed('ECONNREFUSED');
        throw fetchFailed('DEPTH_ZERO_SELF_SIGNED_CERT');
      }),
    );
    const body = await chiedi();
    expect(componente(body, 'jitsi')?.status).toBe('operational');
    expect(componente(body, 'prosody')?.status).toBe('operational');
    expect(componente(body, 'jicofo')).toMatchObject({ status: 'outage', details: 'ECONNREFUSED' });
    expect(componente(body, 'prosody')?.details).not.toBe('Depends on Jitsi Web');
  });

  it('solo l’indirizzo pubblico, certificato non riconosciuto: degradato col codice, non interruzione', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw fetchFailed('DEPTH_ZERO_SELF_SIGNED_CERT'); }));
    const body = await chiedi();
    expect(componente(body, 'jitsi')).toMatchObject({
      status: 'degraded',
      details: 'DEPTH_ZERO_SELF_SIGNED_CERT',
    });
    expect(componente(body, 'prosody')?.status).toBe('degraded');
    expect(componente(body, 'jicofo')?.status).toBe('unknown');
  });
});

describe('GET /api/status — prossimi eventi', () => {
  const T0 = new Date('2026-03-02T10:00:00Z').getTime();
  type Args = { where?: unknown; select?: Record<string, unknown>; take?: number };

  const riga = (titolo: string, status: string, oreDaOra: number) => ({
    title: { it: `${titolo} (it)`, en: `${titolo} (en)` },
    startsAt: new Date(T0 + oreDaOra * 3_600_000),
    status,
    maxParticipants: 50,
    participantsCanStartVideo: true,
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    visible.mockResolvedValue(true);
    vi.stubGlobal('fetch', vi.fn(async () => { throw fetchFailed('ECONNREFUSED'); }));
    findMany.mockImplementation((async (args: Args) => {
      if (!args.select || !('title' in args.select)) return [];
      const where = JSON.stringify(args.where);
      // L'elenco delle sale in corso: le dirette, anche oltre la fine.
      if (where.includes('"PROVISIONING"') && where.includes('{"status":"LIVE"}')) {
        return [riga('Allestimento', 'PROVISIONING', 0.2), riga('Diretta oltre la fine', 'LIVE', -3)];
      }
      return [riga('Futuro', 'PUBLISHED', 2)];
    }) as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('prima le dirette (anche oltre l’orario di fine), poi gli allestimenti, poi il resto', async () => {
    const body = await chiedi();
    const elenco = body.upcomingEvents as Array<{ title: string; status: string }>;
    expect(elenco.map((e) => e.status)).toEqual(['LIVE', 'PROVISIONING', 'PUBLISHED']);
  });

  it('le regole di visibilità pubblica: niente chiamate istantanee', async () => {
    await chiedi();
    const elenchi = (findMany.mock.calls as unknown as Args[][])
      .map((c) => c[0])
      .filter((a): a is Args => !!a?.select && 'title' in a.select);
    expect(elenchi).toHaveLength(2);
    for (const a of elenchi) {
      expect(JSON.stringify(a.where)).toContain('"eventType":{"not":"INSTANT"}');
    }
    // Si limitano solo gli eventi futuri.
    expect(elenchi.map((a) => a.take)).toEqual([20, 5]);
  });

  it('i titoli nella lingua della pagina', async () => {
    const en = await chiedi('http://localhost:3000/api/status?locale=en');
    expect((en.upcomingEvents as Array<{ title: string }>)[0]?.title).toBe('Diretta oltre la fine (en)');
    const it_ = await chiedi('http://localhost:3000/api/status?locale=it');
    expect((it_.upcomingEvents as Array<{ title: string }>)[0]?.title).toBe('Diretta oltre la fine (it)');
  });

  it('i contatori usano la stessa regola: le dirette senza limite di orario', async () => {
    const count = (await import('@/lib/db')).prisma.event.count as unknown as ReturnType<typeof vi.fn>;
    await chiedi();
    const wheres = count.mock.calls.map((c) => JSON.stringify((c[0] as { where: unknown }).where));
    expect(wheres).toContain('{"status":"LIVE"}');
    expect(wheres.some((w) => w.includes('"status":"PROVISIONING"') && w.includes('endsAt'))).toBe(true);
  });
});

describe('GET /api/status — avviso sul registratore', () => {
  const T0 = new Date('2026-03-02T10:00:00Z').getTime();
  const conRegistrazione = {
    id: 'rec1',
    status: 'LIVE',
    startsAt: new Date(T0 - 30 * 60_000),
    provisioningStartedAt: null,
    maxParticipants: 50,
    expectedSenderRatioPct: null,
    participantsCanStartVideo: false,
    recordingEnabled: true,
  };

  beforeEach(() => {
    __resetRecorderWait();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    visible.mockResolvedValue(true);
    vi.stubEnv('KUBERNETES_SERVICE_HOST', '10.0.0.1');
    vi.stubEnv('RECORDING_S3_BUCKET', '');
    vi.stubEnv('RECORDING_AZURE_CONNECTION_STRING', '');
    vi.stubGlobal('fetch', vi.fn(async () => { throw fetchFailed('ENOTFOUND'); }));
    findMany.mockResolvedValue([conRegistrazione]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('senza Jibri previsto nessun «Jibri non è ancora disponibile»', async () => {
    vi.stubEnv('RECORDING_STORAGE_TYPE', '');
    vi.stubEnv('JIBRI_HEALTH_URL', 'http://jibri:2222');
    const body = await chiedi();
    expect(metriche(body).jibriStale).toBe(false);
    expect(componente(body, 'jibri')?.details).toBe('Not configured');
  });

  it('con Jibri previsto e un evento che lo aspetta da troppo: l’avviso c’è', async () => {
    vi.stubEnv('RECORDING_STORAGE_TYPE', 's3');
    vi.stubEnv('RECORDING_S3_BUCKET', 'registrazioni');
    vi.stubEnv('JIBRI_HEALTH_URL', 'http://jibri:2222');
    const body = await chiedi();
    expect(metriche(body).jibriStale).toBe(true);
  });
});
