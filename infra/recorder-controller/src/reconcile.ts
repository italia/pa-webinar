/**
 * Logica di riconciliazione dell'operator recorder (ADR-013 Fase 3).
 *
 * PURA e senza dipendenze K8s/rete: prende lo stato *desiderato* (eventi
 * LIVE che devono avere un recorder, dal portale) e lo stato *reale* (i
 * Job recorder presenti nel namespace) e produce un piano di azioni
 * idempotente. Questo è il cuore dell'operator ed è interamente
 * unit-testabile; il glue K8s (k8s.ts) e l'HTTP (portal.ts/index.ts) sono
 * sottili wrapper attorno a questa funzione.
 *
 * Invarianti:
 *  - UN solo Job "vivo" per recordingId (nome deterministico + label).
 *  - Si (ri)crea un recorder solo se non c'è già un Job attivo o completato
 *    con successo per quel recordingId (un fallimento → si ritenta; il
 *    backoffLimit del Job + il fatto che il portale smette di elencarlo a
 *    fine evento evitano storm infinite).
 *  - I duplicati attivi (race fra push edge-triggered e reconcile) vengono
 *    deduplicati: si tiene il primo, si elimina il resto.
 */

/** Un recorder che il portale dice debba essere attivo. */
export interface DesiredRecorder {
  recordingId: string;
  eventId: string;
}

/** Fase sintetica di un Job recorder osservato nel cluster. */
export type JobPhase = 'active' | 'succeeded' | 'failed';

/** Un Job recorder reale nel namespace, già mappato per recordingId. */
export interface ActualJob {
  recordingId: string;
  jobName: string;
  phase: JobPhase;
}

export interface ReconcilePlan {
  /** Recorder da creare (desiderati, senza Job attivo/completato). */
  toCreate: DesiredRecorder[];
  /** Nomi di Job da eliminare (duplicati attivi per lo stesso recordingId). */
  toDelete: string[];
}

/**
 * Calcola il piano di riconciliazione. Deterministico: l'ordine di
 * `toCreate` segue `desired`, quello di `toDelete` segue `actual`.
 */
export function reconcile(
  desired: DesiredRecorder[],
  actual: ActualJob[],
): ReconcilePlan {
  // Indicizza i Job reali per recordingId (più Job possibili per via di race).
  const byRecording = new Map<string, ActualJob[]>();
  for (const job of actual) {
    const list = byRecording.get(job.recordingId) ?? [];
    list.push(job);
    byRecording.set(job.recordingId, list);
  }

  const toCreate: DesiredRecorder[] = [];
  const toDelete: string[] = [];

  // 1. Dedup: per ogni recordingId con >1 Job ATTIVO, tieni il primo
  //    (ordine d'arrivo), elimina gli altri. I Job terminali non si
  //    deduplicano qui: ci pensa ttlSecondsAfterFinished.
  for (const jobs of byRecording.values()) {
    const activeJobs = jobs.filter((j) => j.phase === 'active');
    for (const extra of activeJobs.slice(1)) {
      toDelete.push(extra.jobName);
    }
  }

  // 2. Create: per ogni desiderato senza Job attivo o già riuscito.
  //    (failed-only → si ricrea; nessun Job → si crea.)
  for (const d of desired) {
    const jobs = byRecording.get(d.recordingId) ?? [];
    const hasLiveOrDone = jobs.some(
      (j) => j.phase === 'active' || j.phase === 'succeeded',
    );
    if (!hasLiveOrDone) {
      toCreate.push(d);
    }
  }

  return { toCreate, toDelete };
}
