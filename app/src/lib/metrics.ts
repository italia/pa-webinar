import client from 'prom-client';

const register = new client.Registry();

register.setDefaultLabels({ app: 'eventi-dtd' });

client.collectDefaultMetrics({ register });

export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [register],
});

export const activeEventsGauge = new client.Gauge({
  name: 'eventi_active_events',
  help: 'Number of currently LIVE events',
  registers: [register],
});

export const totalRegistrationsGauge = new client.Gauge({
  name: 'eventi_registrations_total',
  help: 'Total registrations across all events',
  registers: [register],
});

export const totalEventsGauge = new client.Gauge({
  name: 'eventi_events_total',
  help: 'Total events by status',
  labelNames: ['status'] as const,
  registers: [register],
});

export const questionsTotal = new client.Counter({
  name: 'eventi_questions_total',
  help: 'Total Q&A questions submitted',
  registers: [register],
});

export const jitsiTokensIssued = new client.Counter({
  name: 'eventi_jitsi_tokens_issued_total',
  help: 'Total Jitsi JWT tokens issued',
  labelNames: ['role'] as const,
  registers: [register],
});

export { register };
