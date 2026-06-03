/**
 * Config dell'operator, da env. Tutto iniettato dall'Helm chart (K8s) o dal
 * docker-compose (VM). Il runner è selezionabile per supportare entrambi gli
 * ambienti di riuso (full mode su cluster, VM/compose senza K8s).
 */

export type RunnerKind = 'kubernetes' | 'docker';

export interface ControllerConfig {
  /** Tipo di runner: come si avviano i recorder. */
  runner: RunnerKind;
  /** Base URL del portale (internalUrl Helm / service compose), senza slash finale. */
  portalUrl: string;
  /** CRON_API_KEY, inviato come header x-api-key al portale. */
  cronApiKey: string;
  /** Intervallo del reconcile loop (ms). */
  reconcileIntervalMs: number;
  /** Porta dell'HTTP server (/dispatch, /healthz). */
  port: number;

  /** Config specifica Kubernetes (se runner=kubernetes). */
  k8s?: {
    namespace: string;
    recorderCronJobName: string;
  };
  /** Config specifica Docker (se runner=docker). */
  docker?: {
    image: string;
    network?: string;
    /** Env statiche passate a ogni recorder (allowlist passthrough). */
    recorderEnv: Record<string, string>;
  };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`variabile d'ambiente mancante: ${name}`);
  return v;
}

/**
 * Raccoglie le env `RECORDER_ENV_<NAME>=value` → `{ <NAME>: value }`.
 * Sono le env statiche che il controller passa a ogni recorder in modalità
 * Docker (es. RECORDER_ENV_JITSI_DOMAIN, RECORDER_ENV_INGEST_URL).
 */
export function collectRecorderEnv(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const out: Record<string, string> = {};
  const prefix = 'RECORDER_ENV_';
  for (const [k, v] of Object.entries(env)) {
    if (k.startsWith(prefix) && v != null) {
      out[k.slice(prefix.length)] = v;
    }
  }
  return out;
}

export function readConfig(): ControllerConfig {
  const runner = (process.env.RUNNER ?? 'kubernetes') as RunnerKind;
  if (runner !== 'kubernetes' && runner !== 'docker') {
    throw new Error(`RUNNER non valido: "${runner}" (kubernetes|docker)`);
  }

  const base = {
    runner,
    portalUrl: requireEnv('PORTAL_URL').replace(/\/+$/, ''),
    cronApiKey: requireEnv('CRON_API_KEY'),
    reconcileIntervalMs: Number(process.env.RECONCILE_INTERVAL_MS ?? '30000'),
    port: Number(process.env.PORT ?? '8080'),
  };

  if (runner === 'kubernetes') {
    return {
      ...base,
      k8s: {
        namespace: requireEnv('NAMESPACE'),
        recorderCronJobName: requireEnv('RECORDER_CRONJOB_NAME'),
      },
    };
  }
  return {
    ...base,
    docker: {
      image: requireEnv('RECORDER_IMAGE'),
      network: process.env.DOCKER_NETWORK,
      recorderEnv: collectRecorderEnv(),
    },
  };
}
