import { describe, it, expect } from 'vitest';

import { isPrometheusConfigured } from './prometheus';

describe('prometheus', () => {
  it('reports not configured when PROMETHEUS_URL is empty', () => {
    expect(isPrometheusConfigured()).toBe(false);
  });
});
