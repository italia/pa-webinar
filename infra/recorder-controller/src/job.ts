/**
 * Il Job di un recorder, costruito dal template del CronJob sospeso.
 *
 * LOGICA PURA: niente cluster, testabile. `k8s.ts` la chiama e crea il Job.
 */

import type { V1EnvVar, V1Job, V1JobSpec } from '@kubernetes/client-node';

import type { DesiredRecorder } from './reconcile.js';
import {
  COMPONENT_LABEL,
  COMPONENT_VALUE,
  RECORDING_ID_LABEL,
  EVENT_ID_LABEL,
  recorderHandleName,
} from './labels.js';

/**
 * Un recorder vive per tutta la diretta e tiene le tracce su un volume
 * locale: se l'autoscaler lo sposta per consolidare i nodi, le tracce fino a
 * quel momento sono perse. L'annotazione lo esclude dagli spostamenti
 * volontari; c'è anche nel template del chart, ma il controller la impone
 * comunque, così vale con qualsiasi template.
 */
export const SAFE_TO_EVICT_ANNOTATION = 'cluster-autoscaler.kubernetes.io/safe-to-evict';

export function buildRecorderJob(
  tpl: V1JobSpec,
  d: DesiredRecorder,
  namespace: string
): V1Job {
  const labels = {
    [COMPONENT_LABEL]: COMPONENT_VALUE,
    [RECORDING_ID_LABEL]: d.recordingId,
    [EVENT_ID_LABEL]: d.eventId,
  };

  // Le env per-recording nel primo container, su una copia: il template
  // letto dal cluster non si tocca.
  const containers = (tpl.template.spec?.containers ?? []).map((c, i) => {
    if (i !== 0) return c;
    const env: V1EnvVar[] = (c.env ?? []).filter(
      (e) => e.name !== 'RECORDING_ID' && e.name !== 'EVENT_ID'
    );
    env.push({ name: 'RECORDING_ID', value: d.recordingId });
    env.push({ name: 'EVENT_ID', value: d.eventId });
    return { ...c, env };
  });

  // Le annotazioni del template restano (sostituirle perdeva quelle del
  // chart). Le etichette no: quelle del template includono le etichette di
  // selezione dell'app, e un pod recorder che le porta finirebbe sotto il
  // Service, il PodDisruptionBudget e l'HPA dell'app.
  const metadata = tpl.template.metadata ?? {};
  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: { name: recorderHandleName(d.recordingId), namespace, labels },
    spec: {
      ...tpl,
      template: {
        ...tpl.template,
        metadata: {
          labels,
          annotations: {
            ...(metadata.annotations ?? {}),
            [SAFE_TO_EVICT_ANNOTATION]: 'false',
          },
        },
        spec: tpl.template.spec
          ? { ...tpl.template.spec, containers }
          : tpl.template.spec,
      },
    },
  };
}
