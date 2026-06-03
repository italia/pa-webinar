/**
 * Config dell'operator, da env. Tutto iniettato dall'Helm chart.
 */

export interface ControllerConfig {
  /** Namespace in cui creare/osservare i Job recorder. */
  namespace: string;
  /** Base URL del portale (internalUrl Helm), senza slash finale. */
  portalUrl: string;
  /** CRON_API_KEY, inviato come header x-api-key al portale. */
  cronApiKey: string;
  /** Nome del CronJob (sospeso) usato come template del Job recorder. */
  recorderCronJobName: string;
  /** Intervallo del reconcile loop (ms). */
  reconcileIntervalMs: number;
  /** Porta dell'HTTP server (/dispatch, /healthz). */
  port: number;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`variabile d'ambiente mancante: ${name}`);
  return v;
}

export function readConfig(): ControllerConfig {
  return {
    namespace: requireEnv('NAMESPACE'),
    portalUrl: requireEnv('PORTAL_URL').replace(/\/+$/, ''),
    cronApiKey: requireEnv('CRON_API_KEY'),
    recorderCronJobName: requireEnv('RECORDER_CRONJOB_NAME'),
    reconcileIntervalMs: Number(process.env.RECONCILE_INTERVAL_MS ?? '30000'),
    port: Number(process.env.PORT ?? '8080'),
  };
}
