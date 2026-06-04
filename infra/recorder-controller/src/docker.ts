/**
 * Runner Docker (compose / VM, riuso open-source senza Kubernetes).
 *
 * Stessa semantica del KubernetesRunner ma su container: elenca per label,
 * avvia un container recorder per recording, lo rimuove. Parla col Docker
 * Engine via socket (montato `/var/run/docker.sock`). Pattern noto e
 * portabile su qualsiasi VM con Docker — niente cluster richiesto.
 *
 * In compose non c'è un "template" come il CronJob: il controller compone
 * l'env del recorder da un allowlist passthrough (config) + RECORDING_ID/
 * EVENT_ID per-recording.
 */

import Dockerode from 'dockerode';

import type { ActualJob, DesiredRecorder, JobPhase } from './reconcile.js';
import type { RecorderRunner } from './runner.js';
import {
  COMPONENT_LABEL,
  COMPONENT_VALUE,
  RECORDING_ID_LABEL,
  EVENT_ID_LABEL,
  recorderHandleName,
} from './labels.js';

export interface DockerRunnerOptions {
  /** Immagine del recorder (es. ghcr.io/italia/pa-webinar-recorder:dev). */
  image: string;
  /** Network a cui agganciare il container (per raggiungere il portale). */
  network?: string;
  /** Env statiche passate a ogni recorder (JITSI_DOMAIN, INGEST_URL, …). */
  recorderEnv: Record<string, string>;
  /** Iniettabile per i test. */
  docker?: Dockerode;
}

function containerPhase(info: Dockerode.ContainerInfo): JobPhase {
  // State: 'created'|'running'|'paused'|'restarting'|'removing'|'exited'|'dead'
  if (info.State === 'exited' || info.State === 'dead') {
    // Status es. "Exited (0) 2 minutes ago".
    return /Exited \(0\)/.test(info.Status) ? 'succeeded' : 'failed';
  }
  return 'active';
}

export class DockerRunner implements RecorderRunner {
  readonly kind = 'docker';
  private readonly docker: Dockerode;

  constructor(private readonly opts: DockerRunnerOptions) {
    this.docker = opts.docker ?? new Dockerode();
  }

  async list(): Promise<ActualJob[]> {
    const containers = await this.docker.listContainers({
      all: true,
      filters: { label: [`${COMPONENT_LABEL}=${COMPONENT_VALUE}`] },
    });
    const jobs: ActualJob[] = [];
    for (const c of containers) {
      const recordingId = c.Labels?.[RECORDING_ID_LABEL];
      const handle = c.Names?.[0]?.replace(/^\//, '') ?? c.Id;
      if (!recordingId || !handle) continue;
      jobs.push({ recordingId, jobName: handle, phase: containerPhase(c) });
    }
    return jobs;
  }

  async start(d: DesiredRecorder): Promise<void> {
    const name = recorderHandleName(d.recordingId);
    const env = Object.entries({
      ...this.opts.recorderEnv,
      RECORDING_ID: d.recordingId,
      EVENT_ID: d.eventId,
    }).map(([k, v]) => `${k}=${v}`);

    try {
      const container = await this.docker.createContainer({
        Image: this.opts.image,
        name,
        Labels: {
          [COMPONENT_LABEL]: COMPONENT_VALUE,
          [RECORDING_ID_LABEL]: d.recordingId,
          [EVENT_ID_LABEL]: d.eventId,
        },
        Env: env,
        HostConfig: {
          AutoRemove: true, // pulizia automatica a fine container (≈ ttl).
          ...(this.opts.network ? { NetworkMode: this.opts.network } : {}),
        },
      });
      await container.start();
    } catch (err: unknown) {
      if (statusCode(err) === 409) return; // nome già esistente: benigno.
      throw err;
    }
  }

  async stop(handle: string): Promise<void> {
    try {
      await this.docker.getContainer(handle).remove({ force: true });
    } catch (err: unknown) {
      if (statusCode(err) === 404) return;
      throw err;
    }
  }
}

function statusCode(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'statusCode' in err) {
    const c = (err as { statusCode: unknown }).statusCode;
    if (typeof c === 'number') return c;
  }
  return undefined;
}

export { containerPhase };
