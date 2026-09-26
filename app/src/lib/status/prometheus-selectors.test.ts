// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { metricsNamespace, upSelector } from './prometheus-selectors';

describe('upSelector', () => {
  it('con il job dichiarato dal chart: job e namespace, come le regole di allerta', () => {
    expect(upSelector({ METRICS_JOB: 'pa-webinar', POD_NAMESPACE: 'webinar' })).toBe(
      'up{namespace="webinar",job="pa-webinar"}',
    );
  });

  it('mai per etichetta `app`: `up` non la porta', () => {
    expect(upSelector({ METRICS_JOB: 'pa-webinar' })).not.toContain('app=');
    expect(upSelector({})).not.toContain('app=');
  });

  it('senza job (chart precedenti): la selezione di prima', () => {
    expect(upSelector({ POD_NAMESPACE: 'webinar' })).toBe('up{namespace="webinar",job=~".*eventi.*"}');
  });

  it('i valori finiscono in una query: niente virgolette né graffe', () => {
    expect(upSelector({ METRICS_JOB: 'a"}or{b', POD_NAMESPACE: 'x"' })).toBe(
      'up{namespace="x",job="aorb"}',
    );
  });
});

describe('metricsNamespace', () => {
  it('il namespace del pod, o default', () => {
    expect(metricsNamespace({ POD_NAMESPACE: 'webinar' })).toBe('webinar');
    expect(metricsNamespace({})).toBe('default');
  });
});
