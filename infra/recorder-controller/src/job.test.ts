import { describe, it, expect } from 'vitest';
import type { V1JobSpec } from '@kubernetes/client-node';

import { buildRecorderJob, SAFE_TO_EVICT_ANNOTATION } from './job.js';
import { RECORDING_ID_LABEL } from './labels.js';

const d = {
  recordingId: '0c0dc02e-2f49-4a53-b92e-f8530e810b01',
  eventId: '55555555-5555-4555-8555-555555555555',
};

const template = (): V1JobSpec => ({
  backoffLimit: 1,
  template: {
    metadata: {
      labels: { 'app.kubernetes.io/component': 'recorder' },
      annotations: { 'example.org/nota': 'dal chart' },
    },
    spec: {
      restartPolicy: 'Never',
      terminationGracePeriodSeconds: 300,
      containers: [
        {
          name: 'recorder',
          image: 'recorder:1',
          env: [
            { name: 'PORTAL_URL', value: 'http://app' },
            { name: 'RECORDING_ID', value: 'vecchio' },
          ],
        },
      ],
    },
  },
});

describe('buildRecorderJob', () => {
  it('il pod non si sposta per consolidare i nodi, anche se il template non lo dice', () => {
    const tpl = template();
    delete tpl.template.metadata!.annotations;
    const job = buildRecorderJob(tpl, d, 'ns');
    expect(job.spec?.template.metadata?.annotations?.[SAFE_TO_EVICT_ANNOTATION]).toBe(
      'false'
    );
  });

  it('tiene le annotazioni del template; le etichette sono solo quelle del recorder', () => {
    const tpl = template();
    tpl.template.metadata!.labels = {
      ...tpl.template.metadata!.labels,
      'app.kubernetes.io/name': 'pa-webinar',
    };
    const job = buildRecorderJob(tpl, d, 'ns');
    const meta = job.spec?.template.metadata;
    expect(meta?.annotations?.['example.org/nota']).toBe('dal chart');
    expect(meta?.labels?.[RECORDING_ID_LABEL]).toBe(d.recordingId);
    // Le etichette di selezione dell'app non arrivano al pod del recorder.
    expect(meta?.labels).not.toHaveProperty('app.kubernetes.io/name');
    expect(job.spec?.template.spec?.terminationGracePeriodSeconds).toBe(300);
  });

  it('inietta RECORDING_ID ed EVENT_ID una volta sola, senza toccare il template', () => {
    const tpl = template();
    const job = buildRecorderJob(tpl, d, 'ns');
    const env = job.spec?.template.spec?.containers[0]?.env ?? [];
    expect(env.filter((e) => e.name === 'RECORDING_ID')).toEqual([
      { name: 'RECORDING_ID', value: d.recordingId },
    ]);
    expect(env.find((e) => e.name === 'EVENT_ID')?.value).toBe(d.eventId);
    expect(env.find((e) => e.name === 'PORTAL_URL')?.value).toBe('http://app');
    expect(tpl.template.spec?.containers[0]?.env).toHaveLength(2);
  });
});
