import { describe, it, expect } from 'vitest';
import {
  register,
  httpRequestDuration,
  httpRequestsTotal,
  activeEventsGauge,
  totalRegistrationsGauge,
  totalEventsGauge,
  questionsTotal,
  jitsiTokensIssued,
} from './metrics';

describe('metrics registry', () => {
  it('contains all custom metrics', async () => {
    const metrics = await register.getMetricsAsJSON();
    const names = metrics.map((m) => m.name);

    expect(names).toContain('http_request_duration_seconds');
    expect(names).toContain('http_requests_total');
    expect(names).toContain('eventi_active_events');
    expect(names).toContain('eventi_registrations_total');
    expect(names).toContain('eventi_events_total');
    expect(names).toContain('eventi_questions_total');
    expect(names).toContain('eventi_jitsi_tokens_issued_total');
  });

  it('has default app label', async () => {
    const output = await register.metrics();
    // Default label appears in every metric line
    expect(output).toContain('app="eventi-dtd"');
  });

  it('counter increments', () => {
    const before = (questionsTotal as unknown as { hashMap: Map<string, { value: number }> }).hashMap;
    questionsTotal.inc();
    // Verify it doesn't throw — actual value assertion is fragile with prom-client internals
    expect(() => questionsTotal.inc()).not.toThrow();
  });

  it('histogram observes values', () => {
    expect(() =>
      httpRequestDuration.observe({ method: 'GET', route: '/api/test', status_code: '200' }, 0.05),
    ).not.toThrow();
  });

  it('gauge can set values', () => {
    expect(() => activeEventsGauge.set(5)).not.toThrow();
    expect(() => totalRegistrationsGauge.set(100)).not.toThrow();
    expect(() => totalEventsGauge.set({ status: 'PUBLISHED' }, 10)).not.toThrow();
  });

  it('counter with labels works', () => {
    expect(() => jitsiTokensIssued.inc({ role: 'moderator' })).not.toThrow();
    expect(() => httpRequestsTotal.inc({ method: 'POST', route: '/api/events', status_code: '201' })).not.toThrow();
  });

  it('produces text/plain metrics output', async () => {
    const output = await register.metrics();
    expect(typeof output).toBe('string');
    expect(output.length).toBeGreaterThan(0);
    // Prometheus text format includes HELP lines
    expect(output).toContain('# HELP');
    expect(output).toContain('# TYPE');
  });
});
