/**
 * Astrazione del "runner" del recorder (ADR-013 Fase 3).
 *
 * Il `reconcile` è platform-agnostico: ragiona su recordingId e su "unità
 * di lavoro" con un handle opaco e una fase. COME quell'unità venga
 * avviata/elencata/fermata è l'unica cosa che cambia fra ambienti:
 *   - Kubernetes (full mode): un Job per recording → `KubernetesRunner`;
 *   - Docker/VM (compose, riuso open-source): un container → `DockerRunner`.
 *
 * Così lo stesso operator e la stessa logica di riconciliazione girano
 * sia su cluster sia su una singola VM, senza dipendere da K8s.
 */

import type { ActualJob, DesiredRecorder } from './reconcile.js';

export interface RecorderRunner {
  /** Nome del runner (logging). */
  readonly kind: string;
  /** Elenca i recorder reali (handle opaco in `ActualJob.jobName`). */
  list(): Promise<ActualJob[]>;
  /** Avvia un recorder per il recording desiderato. Idempotente sull'handle. */
  start(desired: DesiredRecorder): Promise<void>;
  /** Ferma/rimuove un recorder dato il suo handle. */
  stop(handle: string): Promise<void>;
}
