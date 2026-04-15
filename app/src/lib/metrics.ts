import client from 'prom-client';

const register = new client.Registry();

const METRICS_APP_LABEL = process.env['METRICS_APP_LABEL'] || 'eventi-dtd';
register.setDefaultLabels({ app: METRICS_APP_LABEL });

export { METRICS_APP_LABEL };

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

export const jvbParticipantsGauge = new client.Gauge({
  name: 'eventi_jvb_participants',
  help: 'Current number of JVB participants',
  registers: [register],
});

export const jvbConferencesGauge = new client.Gauge({
  name: 'eventi_jvb_conferences',
  help: 'Current number of active JVB conferences',
  registers: [register],
});

export const jvbStressLevelGauge = new client.Gauge({
  name: 'eventi_jvb_stress_level',
  help: 'Current JVB stress level (0.0 - 1.0)',
  registers: [register],
});

// Octo (cascaded bridges). When a conference is spread across multiple
// JVB pods these gauges reflect the inter-bridge relay traffic. Value 0
// with octo disabled is indistinguishable from octo-enabled-but-idle.
export const jvbOctoConferencesGauge = new client.Gauge({
  name: 'eventi_jvb_octo_conferences',
  help: 'Number of conferences this JVB is participating in via Octo relay',
  registers: [register],
});

export const jvbOctoEndpointsGauge = new client.Gauge({
  name: 'eventi_jvb_octo_endpoints',
  help: 'Number of remote endpoints this JVB is forwarding from peer bridges',
  registers: [register],
});

export const jvbOctoSendBitrateGauge = new client.Gauge({
  name: 'eventi_jvb_octo_send_bitrate_bps',
  help: 'Outbound bitrate of Octo relay traffic (bytes per second)',
  registers: [register],
});

export const jvbOctoReceiveBitrateGauge = new client.Gauge({
  name: 'eventi_jvb_octo_receive_bitrate_bps',
  help: 'Inbound bitrate of Octo relay traffic (bytes per second)',
  registers: [register],
});

export const jvbScalingEventsTotal = new client.Counter({
  name: 'eventi_jvb_scaling_events_total',
  help: 'Total JVB scaling events',
  labelNames: ['direction'] as const,
  registers: [register],
});

export const eventParticipantsHistogram = new client.Histogram({
  name: 'eventi_event_participants_total',
  help: 'Number of participants per event at end',
  buckets: [5, 10, 25, 50, 100, 150, 200, 300],
  registers: [register],
});

export const eventDurationHistogram = new client.Histogram({
  name: 'eventi_event_duration_seconds',
  help: 'Duration of events in seconds',
  buckets: [300, 900, 1800, 3600, 5400, 7200, 10800],
  registers: [register],
});

export { register };

export async function getAppProcessMetrics(): Promise<{
  cpuUsagePercent: number | null;
  memoryUsedMB: number | null;
  heapUsedMB: number | null;
  eventLoopLagMs: number | null;
  uptimeHours: number | null;
}> {
  try {
    const metrics = await register.getMetricsAsJSON();

    const findGaugeValue = (name: string, labels?: Record<string, string>): number | null => {
      const metric = metrics.find(m => m.name === name);
      if (!metric || !('values' in metric)) return null;
      const values = (metric as { values: { value: number; labels: Record<string, string> }[] }).values;
      if (labels) {
        const entry = values.find(v =>
          Object.entries(labels).every(([k, val]) => v.labels[k] === val),
        );
        return entry?.value ?? null;
      }
      return values[0]?.value ?? null;
    };

    const cpuSeconds = findGaugeValue('process_cpu_seconds_total');
    const startTime = findGaugeValue('process_start_time_seconds');
    const nowSec = Date.now() / 1000;
    let cpuPercent: number | null = null;
    if (cpuSeconds !== null && startTime !== null) {
      const elapsed = nowSec - startTime;
      cpuPercent = elapsed > 0 ? Math.round((cpuSeconds / elapsed) * 10000) / 100 : null;
    }

    const rssBytes = findGaugeValue('process_resident_memory_bytes');
    const heapBytes = findGaugeValue('nodejs_heap_size_used_bytes');
    const elLag = findGaugeValue('nodejs_eventloop_lag_seconds');

    let uptimeHours: number | null = null;
    if (startTime !== null) {
      uptimeHours = Math.round(((nowSec - startTime) / 3600) * 10) / 10;
    }

    return {
      cpuUsagePercent: cpuPercent,
      memoryUsedMB: rssBytes !== null ? Math.round(rssBytes / 1048576) : null,
      heapUsedMB: heapBytes !== null ? Math.round(heapBytes / 1048576) : null,
      eventLoopLagMs: elLag !== null ? Math.round(elLag * 1000 * 100) / 100 : null,
      uptimeHours,
    };
  } catch {
    return { cpuUsagePercent: null, memoryUsedMB: null, heapUsedMB: null, eventLoopLagMs: null, uptimeHours: null };
  }
}
