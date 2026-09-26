// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { settings, jitsiHealth, colibri } = vi.hoisted(() => ({
  settings: vi.fn(),
  jitsiHealth: vi.fn(),
  colibri: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: { $queryRaw: vi.fn(async () => [{ '?column?': 1 }]), event: { findMany: vi.fn(async () => []) } },
}));
vi.mock('@/lib/settings', () => ({ getSettings: settings }));
vi.mock('@/lib/jvb-snapshot', () => ({ readJvbSnapshot: vi.fn(async () => null) }));
vi.mock('@/lib/status/jitsi-health', async (importOriginal) => ({
  ...(await importOriginal<typeof JitsiHealthModule>()),
  getJitsiHealth: jitsiHealth,
}));
vi.mock('@/lib/status/bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof BridgeModule>()),
  fetchColibriStats: colibri,
}));

import type * as BridgeModule from '@/lib/status/bridge';
import type * as JitsiHealthModule from '@/lib/status/jitsi-health';

import {
  databaseBundled,
  deploymentMode,
  getInfrastructureInfo,
  jibriRecordingExpected,
  jvbScalerEnabled,
  recordingStorageConfigured,
  recordingStorageLabel,
} from './infrastructure';

/**
 * Lo storage delle registrazioni visto dalle pagine di amministrazione: il
 * «configurato» e il nome mostrato accanto seguono la stessa regola della
 * factory (lib/storage/provider-type), e non si contraddicono.
 */
describe('storage delle registrazioni', () => {
  it('tipo dichiarato e riconosciuto: configurato, col nome dichiarato', () => {
    const env = { RECORDING_STORAGE_TYPE: 'minio' };
    expect(recordingStorageConfigured(env)).toBe(true);
    expect(recordingStorageLabel(env)).toBe('minio');
    expect(recordingStorageLabel({ RECORDING_STORAGE_TYPE: 'azure-blob' })).toBe('azure-blob');
  });

  it('solo credenziali: configurato, col fornitore rilevato', () => {
    const s3 = { RECORDING_S3_BUCKET: 'registrazioni' };
    expect(recordingStorageConfigured(s3)).toBe(true);
    expect(recordingStorageLabel(s3)).toBe('s3');

    const azure = { RECORDING_AZURE_CONNECTION_STRING: 'AccountName=x;AccountKey=y' };
    expect(recordingStorageConfigured(azure)).toBe(true);
    expect(recordingStorageLabel(azure)).toBe('azure');
  });

  it('tipo non riconosciuto ma credenziali presenti: vale il fornitore rilevato', () => {
    const env = { RECORDING_STORAGE_TYPE: 'bucket', RECORDING_S3_BUCKET: 'registrazioni' };
    expect(recordingStorageConfigured(env)).toBe(true);
    expect(recordingStorageLabel(env)).toBe('s3');
  });

  it('niente storage: non configurato', () => {
    expect(recordingStorageConfigured({})).toBe(false);
    expect(recordingStorageLabel({})).toBe('not-configured');
    // `local` non è un fornitore delle registrazioni: resta scritto com'è.
    expect(recordingStorageConfigured({ RECORDING_STORAGE_TYPE: 'local' })).toBe(false);
    expect(recordingStorageLabel({ RECORDING_STORAGE_TYPE: 'local' })).toBe('local');
  });
});

/**
 * Quando l'installazione si aspetta Jibri. Solo lo storage dichiarato: le sole
 * credenziali servono anche al registratore per partecipante su installazioni
 * senza Jibri, dove un'API di salute che non risponde non è un registratore in
 * avvio.
 */
describe('jibriRecordingExpected', () => {
  it('storage dichiarato e risolto: Jibri previsto', () => {
    expect(jibriRecordingExpected({ RECORDING_STORAGE_TYPE: 'azure-blob' })).toBe(true);
    expect(
      jibriRecordingExpected({ RECORDING_STORAGE_TYPE: 'bucket', RECORDING_S3_BUCKET: 'reg' }),
    ).toBe(true);
  });

  it('solo credenziali: storage configurato, Jibri non previsto', () => {
    const env = { RECORDING_S3_BUCKET: 'registrazioni' };
    expect(recordingStorageConfigured(env)).toBe(true);
    expect(jibriRecordingExpected(env)).toBe(false);
    expect(
      jibriRecordingExpected({ RECORDING_AZURE_CONNECTION_STRING: 'AccountName=x;AccountKey=y' }),
    ).toBe(false);
  });

  it('niente storage, o `local`: Jibri non previsto', () => {
    expect(jibriRecordingExpected({})).toBe(false);
    expect(jibriRecordingExpected({ RECORDING_STORAGE_TYPE: 'local', RECORDING_S3_BUCKET: 'r' })).toBe(
      false,
    );
    // Un tipo che la factory non risolve, senza credenziali: nulla da registrare.
    expect(jibriRecordingExpected({ RECORDING_STORAGE_TYPE: 'bucket' })).toBe(false);
  });
});

/**
 * Lo scaler dei bridge nel pannello Infrastruttura: lo dichiara il chart, non
 * si deduce dal tetto dei bridge.
 */
describe('jvbScalerEnabled', () => {
  it('dichiarato dal chart: attivo solo con "true"', () => {
    expect(jvbScalerEnabled({ JVB_SCALER_ENABLED: 'true' })).toBe(true);
    expect(jvbScalerEnabled({ JVB_SCALER_ENABLED: 'false' })).toBe(false);
  });

  it('un tetto dei bridge senza scaler non è uno scaler', () => {
    // Profilo semplice: un bridge fisso, tetto a 1.
    expect(jvbScalerEnabled({ JVB_MAX_REPLICAS: '1', JVB_SCALER_ENABLED: 'false' })).toBe(false);
    // Docker Compose e installazioni senza il chart: nessuna dichiarazione.
    expect(jvbScalerEnabled({ JVB_MAX_REPLICAS: '4' })).toBe(false);
    expect(jvbScalerEnabled({})).toBe(false);
  });
});

/**
 * Il profilo d'installazione lo dichiara il chart; la stima di prima resta
 * solo dove la dichiarazione manca (Docker Compose, chart precedenti).
 */
describe('deploymentMode', () => {
  it('dichiarato: vale quello, anche un profilo semplice su Kubernetes', () => {
    expect(deploymentMode({ DEPLOY_PROFILE: 'simple', KUBERNETES_SERVICE_HOST: '10.0.0.1' })).toBe('simple');
    expect(deploymentMode({ DEPLOY_PROFILE: 'full', JVB_MAX_REPLICAS: '1' })).toBe('full');
    expect(deploymentMode({ DEPLOY_PROFILE: 'Standard' })).toBe('standard');
  });

  it('non dichiarato (o sconosciuto): la stima di prima', () => {
    expect(deploymentMode({})).toBe('simple');
    expect(deploymentMode({ KUBERNETES_SERVICE_HOST: '10.0.0.1', JVB_MAX_REPLICAS: '1' })).toBe('standard');
    expect(deploymentMode({ KUBERNETES_SERVICE_HOST: '10.0.0.1', JVB_MAX_REPLICAS: '4' })).toBe('full');
    expect(deploymentMode({ DEPLOY_PROFILE: 'boh' })).toBe('simple');
  });
});

describe('databaseBundled', () => {
  it('dichiarato dal chart: vale quello', () => {
    expect(databaseBundled({ DATABASE_BUNDLED: 'true', DATABASE_URL: 'postgresql://u:p@db.example.org/x' })).toBe(true);
    expect(databaseBundled({ DATABASE_BUNDLED: 'false', DATABASE_URL: 'postgresql://u:p@postgres/x' })).toBe(false);
  });

  it('non dichiarato: un nome di servizio senza dominio che contiene «postgres»', () => {
    expect(databaseBundled({ DATABASE_URL: 'postgresql://u:p@postgres:5432/x' })).toBe(true);
    expect(databaseBundled({ DATABASE_URL: 'postgresql://u:p@rel-postgresql:5432/x' })).toBe(true);
    expect(databaseBundled({ DATABASE_URL: 'postgresql://u:p@srv.postgres.database.example.net/x' })).toBe(false);
    expect(databaseBundled({ DATABASE_URL: 'non un indirizzo' })).toBe(false);
  });
});

/**
 * Il pannello Infrastruttura dell'amministrazione: valori letti a runtime e
 * dalle impostazioni, non stimati né congelati nel build.
 */
describe('getInfrastructureInfo', () => {
  const sano = { status: 'operational', responseMs: 5, via: 'internal' } as const;

  beforeEach(() => {
    settings.mockResolvedValue({ jvbPreScaleMinutes: 15, statusPageEnabled: false });
    jitsiHealth.mockResolvedValue({ domain: 'jitsi.example.test', web: sano, prosody: sano, jicofo: sano });
    colibri.mockResolvedValue({ participants: 2 });
    vi.stubEnv('NEXT_PUBLIC_BUILD_VERSION', '1.2.3');
    vi.stubEnv('JVB_SCALER_ENABLED', 'false');
    vi.stubEnv('JVB_HEALTH_URL', 'http://jvb:8080');
    vi.stubEnv('JVB_MAX_REPLICAS', '1');
    vi.stubEnv('DEPLOY_PROFILE', 'simple');
    vi.stubEnv('DATABASE_BUNDLED', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('versione del build, impostazioni e profilo dichiarato', async () => {
    const info = await getInfrastructureInfo();
    expect(info.deployment.version).toBe('1.2.3');
    expect(info.deployment.mode).toBe('simple');
    expect(info.database.type).toBe('internal');
    expect(info.jvb.preScaleMinutes).toBe(15);
    expect(info.features.statusPage).toBe(false);
  });

  it('la sala: dominio a runtime e stato dalle sonde condivise', async () => {
    const info = await getInfrastructureInfo();
    expect(info.jitsi).toMatchObject({
      domain: 'jitsi.example.test',
      reachable: true,
      status: 'operational',
      publicCheckFailed: false,
    });
  });

  it('una verifica pubblica fallita per certificato: raggiungibile ma degradata, col codice', async () => {
    const tls = {
      status: 'degraded',
      responseMs: 3,
      via: 'public',
      details: 'DEPTH_ZERO_SELF_SIGNED_CERT',
      publicCheckFailed: true,
    } as const;
    jitsiHealth.mockResolvedValue({ domain: 'jitsi.example.test', web: tls, prosody: tls, jicofo: sano });
    const info = await getInfrastructureInfo();
    expect(info.jitsi).toMatchObject({
      status: 'degraded',
      detail: 'DEPTH_ZERO_SELF_SIGNED_CERT',
      publicCheckFailed: true,
    });
  });

  it('bridge fissi: previsti quanti ne scrive il chart, accesi quelli che rispondono', async () => {
    const info = await getInfrastructureInfo();
    expect(info.jvb).toMatchObject({
      mode: 'fixed',
      scalerEnabled: false,
      desiredReplicas: 1,
      runningReplicas: 1,
      maxReplicas: 1,
    });

    colibri.mockResolvedValue(null);
    expect((await getInfrastructureInfo()).jvb.runningReplicas).toBe(0);
  });

  it('senza indirizzo del bridge: non monitorato, nessun numero inventato', async () => {
    vi.stubEnv('JVB_HEALTH_URL', '');
    const info = await getInfrastructureInfo();
    expect(info.jvb).toMatchObject({ mode: 'unmonitored', runningReplicas: null, desiredReplicas: 0 });
  });

  it('con lo scaler: i bridge che gli eventi chiedono ora, non una variabile mai impostata', async () => {
    vi.stubEnv('JVB_SCALER_ENABLED', 'true');
    vi.stubEnv('JVB_MAX_REPLICAS', '4');
    const info = await getInfrastructureInfo();
    expect(info.jvb).toMatchObject({ mode: 'scaler', scalerEnabled: true, desiredReplicas: 0, maxReplicas: 4 });
  });
});
