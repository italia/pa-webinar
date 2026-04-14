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
  jvbParticipantsGauge,
  jvbConferencesGauge,
  jvbStressLevelGauge,
  jvbScalingEventsTotal,
  eventParticipantsHistogram,
  eventDurationHistogram,
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
    expect(names).toContain('eventi_jvb_participants');
    expect(names).toContain('eventi_jvb_conferences');
    expect(names).toContain('eventi_jvb_stress_level');
    expect(names).toContain('eventi_jvb_scaling_events_total');
    expect(names).toContain('eventi_event_participants_total');
    expect(names).toContain('eventi_event_duration_seconds');
  });

  it('has default app label', async () => {
    const output = await register.metrics();
    expect(output).toContain('app="eventi-dtd"');
  });

  it('counter increments', () => {
    questionsTotal.inc();
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

  it('JVB gauges accept values', () => {
    expect(() => jvbParticipantsGauge.set(42)).not.toThrow();
    expect(() => jvbConferencesGauge.set(3)).not.toThrow();
    expect(() => jvbStressLevelGauge.set(0.65)).not.toThrow();
  });

  it('JVB scaling counter works', () => {
    expect(() => jvbScalingEventsTotal.inc({ direction: 'up' })).not.toThrow();
    expect(() => jvbScalingEventsTotal.inc({ direction: 'down' })).not.toThrow();
  });

  it('event histograms observe values', () => {
    expect(() => eventParticipantsHistogram.observe(75)).not.toThrow();
    expect(() => eventDurationHistogram.observe(3600)).not.toThrow();
  });

  it('produces text/plain metrics output', async () => {
    const output = await register.metrics();
    expect(typeof output).toBe('string');
    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain('# HELP');
    expect(output).toContain('# TYPE');
  });
});
