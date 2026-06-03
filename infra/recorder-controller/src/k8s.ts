/**
 * Glue Kubernetes dell'operator. Sottile wrapper attorno a `reconcile`:
 * legge i Job recorder reali, ne crea di nuovi dal template (CronJob
 * sospeso) e ne elimina i duplicati. Parla SOLO l'API K8s standard →
 * portabile su AKS/GKE/EKS/k3s.
 *
 * NB: non unit-testabile senza un cluster; la logica decisionale vive
 * tutta in `reconcile.ts` (pura, testata). Qui solo I/O.
 */

import {
  KubeConfig,
  BatchV1Api,
  type V1Job,
  type V1EnvVar,
} from '@kubernetes/client-node';

import type { ActualJob, DesiredRecorder, JobPhase } from './reconcile';

const COMPONENT_LABEL = 'app.kubernetes.io/component';
const COMPONENT_VALUE = 'recorder';
/** Label che lega un Job al suo recordingId (chiave del dedup). */
export const RECORDING_ID_LABEL = 'eventi-dtd.it/recording-id';
const EVENT_ID_LABEL = 'eventi-dtd.it/event-id';

function jobPhase(job: V1Job): JobPhase {
  const s = job.status;
  if ((s?.succeeded ?? 0) > 0) return 'succeeded';
  if ((s?.failed ?? 0) > 0) return 'failed';
  // active o ancora pending: per noi è "vivo" (non va ricreato).
  return 'active';
}

/** Nome Job deterministico per recordingId (idempotenza lato API). */
export function recorderJobName(recordingId: string): string {
  const compact = recordingId.replace(/-/g, '').slice(0, 20);
  return `recorder-${compact}`;
}

export class RecorderJobManager {
  private readonly batch: BatchV1Api;

  constructor(
    private readonly namespace: string,
    private readonly recorderCronJobName: string,
    kc: KubeConfig = defaultKubeConfig(),
  ) {
    this.batch = kc.makeApiClient(BatchV1Api);
  }

  /** I Job recorder reali nel namespace, mappati per `reconcile`. */
  async listRecorderJobs(): Promise<ActualJob[]> {
    const res = await this.batch.listNamespacedJob(
      this.namespace,
      undefined,
      undefined,
      undefined,
      undefined,
      `${COMPONENT_LABEL}=${COMPONENT_VALUE}`,
    );
    const jobs: ActualJob[] = [];
    for (const job of res.body.items) {
      const recordingId = job.metadata?.labels?.[RECORDING_ID_LABEL];
      const jobName = job.metadata?.name;
      if (!recordingId || !jobName) continue;
      jobs.push({ recordingId, jobName, phase: jobPhase(job) });
    }
    return jobs;
  }

  /**
   * Crea un Job recorder dal template CronJob sospeso, iniettando
   * RECORDING_ID/EVENT_ID come env così il recorder reclama lo SPECIFICO
   * recording. Idempotente: nome deterministico → un 409 è benigno.
   */
  async createRecorderJob(d: DesiredRecorder): Promise<void> {
    const cron = await this.batch.readNamespacedCronJob(
      this.recorderCronJobName,
      this.namespace,
    );
    const tpl = cron.body.spec?.jobTemplate?.spec;
    if (!tpl) {
      throw new Error(
        `CronJob ${this.recorderCronJobName} senza jobTemplate.spec`,
      );
    }

    const name = recorderJobName(d.recordingId);
    const labels = {
      [COMPONENT_LABEL]: COMPONENT_VALUE,
      [RECORDING_ID_LABEL]: d.recordingId,
      [EVENT_ID_LABEL]: d.eventId,
    };

    // Inietta le env per-recording nel primo container.
    const containers = tpl.template.spec?.containers ?? [];
    if (containers[0]) {
      const env: V1EnvVar[] = (containers[0].env ?? []).filter(
        (e: V1EnvVar) => e.name !== 'RECORDING_ID' && e.name !== 'EVENT_ID',
      );
      env.push({ name: 'RECORDING_ID', value: d.recordingId });
      env.push({ name: 'EVENT_ID', value: d.eventId });
      containers[0].env = env;
    }

    const job: V1Job = {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: { name, namespace: this.namespace, labels },
      spec: { ...tpl, template: { ...tpl.template, metadata: { labels } } },
    };

    try {
      await this.batch.createNamespacedJob(this.namespace, job);
    } catch (err: unknown) {
      if (isConflict(err)) return; // già creato (race): benigno.
      throw err;
    }
  }

  /** Elimina un Job (propagazione Background → elimina anche i pod). */
  async deleteJob(name: string): Promise<void> {
    try {
      await this.batch.deleteNamespacedJob(
        name,
        this.namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        'Background',
      );
    } catch (err: unknown) {
      if (isNotFound(err)) return;
      throw err;
    }
  }
}

function defaultKubeConfig(): KubeConfig {
  const kc = new KubeConfig();
  kc.loadFromCluster();
  return kc;
}

function statusCode(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as {
    statusCode?: unknown;
    code?: unknown;
    response?: { statusCode?: unknown };
  };
  for (const c of [e.statusCode, e.code, e.response?.statusCode]) {
    if (typeof c === 'number') return c;
  }
  return undefined;
}
function isConflict(err: unknown): boolean {
  return statusCode(err) === 409;
}
function isNotFound(err: unknown): boolean {
  return statusCode(err) === 404;
}
