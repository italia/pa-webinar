'use client';

/**
 * Admin monitoring dashboard — /admin/monitoring
 *
 * Target: technical ops. Mixes Prometheus time-series (latency, uptime,
 * JVB stress, CPU/memory, error rate) with DB analytics (events, call
 * sessions, registrations) over a configurable time range.
 *
 * Sections:
 *   - Time range selector (24h / 7d / 30d)
 *   - Real-time KPI cards (events live, participants, replicas, QoS)
 *   - Availability (uptime 24h/7d, error rate, pod uptime)
 *   - Capacity (JVB replicas, stress, participants history, Octo relay)
 *   - Quality of service (latency P50/P95/P99, request rate, event loop lag)
 *   - Event analytics (events/registrations/call-sessions by bucket)
 *   - Recent call sessions table with telemetry
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  Col,
  Row,
} from 'design-react-kit';

const APP_LABEL = 'pa-webinar';
const REFRESH_MS = 30_000;

type Range = '24h' | '7d' | '30d';

const RANGE_HOURS: Record<Range, number> = { '24h': 24, '7d': 168, '30d': 720 };
const RANGE_STEP: Record<Range, string> = { '24h': '120', '7d': '900', '30d': '3600' };

interface PromResult {
  available: boolean;
  status?: string;
  data?: {
    resultType: string;
    result: Array<{
      metric: Record<string, string>;
      value?: [number, string];
      values?: Array<[number, string]>;
    }>;
  };
  error?: string;
}

async function promQuery(query: string): Promise<PromResult> {
  try {
    const res = await fetch('/api/admin/metrics/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    return res.json();
  } catch {
    return { available: false };
  }
}

async function promRangeQuery(query: string, range: Range): Promise<PromResult> {
  const now = Math.floor(Date.now() / 1000);
  try {
    const res = await fetch('/api/admin/metrics/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        start: String(now - RANGE_HOURS[range] * 3600),
        end: String(now),
        step: RANGE_STEP[range],
      }),
    });
    return res.json();
  } catch {
    return { available: false };
  }
}

function extractScalar(res: PromResult): number | null {
  const first = res.data?.result?.[0];
  if (!first?.value) return null;
  const n = parseFloat(first.value[1]);
  return Number.isNaN(n) ? null : n;
}

function extractSeries(res: PromResult): Array<[number, number]> {
  const first = res.data?.result?.[0];
  if (!first?.values) return [];
  return first.values.map(([ts, v]) => [ts, parseFloat(v)]);
}

// ─── Chart primitives ────────────────────────────────────────────

function LineChart({
  series,
  color = '#0066CC',
  fillOpacity = 0.12,
  height = 80,
  unit = '',
  format,
  yDomain,
}: {
  series: Array<[number, number]> | Array<Array<[number, number]>>;
  color?: string | string[];
  fillOpacity?: number;
  height?: number;
  unit?: string;
  format?: (v: number) => string;
  yDomain?: [number, number];
}) {
  // Normalise to a list of series.
  const lines: Array<{ points: Array<[number, number]>; color: string }> = [];
  const defaultColor = '#0066CC';
  const firstPoint = (series as Array<unknown>)[0];
  if (Array.isArray(series) && series.length > 0 && Array.isArray(firstPoint) && typeof (firstPoint as [number, number])[0] === 'number') {
    // Single series passed as flat Array<[number, number]>
    const lineColor = Array.isArray(color) ? (color[0] ?? defaultColor) : color;
    lines.push({ points: series as Array<[number, number]>, color: lineColor });
  } else if (Array.isArray(series)) {
    const colours = Array.isArray(color) ? color : [color];
    (series as Array<Array<[number, number]>>).forEach((s, i) => {
      lines.push({ points: s, color: colours[i % colours.length] ?? defaultColor });
    });
  }

  const allPoints = lines.flatMap((l) => l.points).filter((p) => Number.isFinite(p[1]));
  if (allPoints.length < 2) {
    return (
      <div className="text-muted" style={{ fontSize: '0.78rem', height }}>
        —
      </div>
    );
  }
  const min = yDomain?.[0] ?? Math.min(...allPoints.map((p) => p[1]));
  const max = yDomain?.[1] ?? Math.max(...allPoints.map((p) => p[1]));
  const range = max - min || 1;

  const width = 600;
  const pad = 4;
  const cw = width - pad * 2;
  const ch = height - pad * 2;

  const tsMin = Math.min(...allPoints.map((p) => p[0]));
  const tsMax = Math.max(...allPoints.map((p) => p[0]));
  const tsRange = tsMax - tsMin || 1;

  const toXY = (p: [number, number]): [number, number] => [
    pad + ((p[0] - tsMin) / tsRange) * cw,
    pad + ch - ((p[1] - min) / range) * ch,
  ];

  const fmt = format ?? ((v: number) => `${v.toFixed(1)}${unit}`);
  const last = lines[0]?.points[lines[0]?.points.length - 1];

  return (
    <div style={{ position: 'relative' }}>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {lines.map((ln, idx) => {
          if (ln.points.length < 2) return null;
          const pts = ln.points.map(toXY);
          const linePath = `M ${pts.map(([x, y]) => `${x},${y}`).join(' L ')}`;
          const fillPath = `${linePath} L ${pad + cw},${pad + ch} L ${pad},${pad + ch} Z`;
          return (
            <g key={idx}>
              {idx === 0 && <path d={fillPath} fill={ln.color} opacity={fillOpacity} />}
              <path d={linePath} fill="none" stroke={ln.color} strokeWidth="1.5" />
            </g>
          );
        })}
      </svg>
      {last && (
        <div
          className="text-muted"
          style={{ position: 'absolute', top: 0, right: 0, fontSize: '0.72rem' }}
        >
          {fmt(last[1])}
        </div>
      )}
    </div>
  );
}

function BarChart({
  data,
  color = '#0066CC',
  height = 80,
  format,
}: {
  data: Array<{ ts: string; value: number }>;
  color?: string;
  height?: number;
  format?: (v: number) => string;
}) {
  if (data.length === 0) {
    return <div className="text-muted" style={{ fontSize: '0.78rem', height }}>—</div>;
  }
  const max = Math.max(1, ...data.map((d) => d.value));
  const fmt = format ?? ((v: number) => v.toFixed(0));
  return (
    <div style={{ position: 'relative' }}>
      <div className="d-flex align-items-end" style={{ height, gap: 1 }}>
        {data.map((d, i) => {
          const h = d.value > 0 ? Math.max(2, (d.value / max) * (height - 4)) : 0;
          return (
            <div
              key={i}
              style={{
                flex: 1,
                height: `${h}px`,
                background: d.value > 0 ? color : 'transparent',
                borderRadius: '2px 2px 0 0',
                transition: 'height 0.2s ease',
              }}
              title={`${d.ts}: ${fmt(d.value)}`}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── KPI card ───────────────────────────────────────────────────

function KpiCard({
  title,
  value,
  subtitle,
  color = '#17324D',
  trend,
}: {
  title: string;
  value: string;
  subtitle?: string;
  color?: string;
  trend?: Array<[number, number]>;
}) {
  return (
    <Card className="border-0 shadow-sm h-100">
      <CardBody className="p-3">
        <div className="text-muted mb-1" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
          {title}
        </div>
        <div className="fw-bold" style={{ fontSize: '1.4rem', color }}>{value}</div>
        {subtitle && <div className="text-muted" style={{ fontSize: '0.72rem' }}>{subtitle}</div>}
        {trend && trend.length > 1 && (
          <div className="mt-2">
            <LineChart series={trend} color={color} height={28} fillOpacity={0.15} />
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ─── Analytics response types ───────────────────────────────────

interface AnalyticsResponse {
  range: Range;
  since: string;
  now: string;
  events: {
    total: number;
    byStatus: Record<string, number>;
    avgParticipants: number | null;
    totalParticipants: number;
    mostCrowded: { title: string; peak: number; startedAt: string } | null;
  };
  registrations: { total: number; confirmed: number };
  callSessions: {
    total: number;
    totalDurationSeconds: number;
    totalRecordingBytes: string;
    avgDurationSeconds: number | null;
    avgPeakParticipants: number | null;
  };
  buckets: Array<{
    ts: string;
    events: number;
    registrations: number;
    callSessions: number;
    peakParticipants: number;
  }>;
  recentCalls: Array<{
    id: string;
    eventTitle: string;
    eventSlug: string;
    jitsiRoomName: string;
    startedAt: string;
    endedAt: string | null;
    durationSeconds: number | null;
    peakParticipants: number;
    recordingUrl: string | null;
    recordingFileSize: string | null;
  }>;
  scaleToZero: { idleEvents: number; provisioningEvents: number; liveEvents: number };
}

interface PromSnapshot {
  available: boolean;
  uptime24h: number | null;
  uptime7d: number | null;
  latencyP50: number | null;
  latencyP95: number | null;
  latencyP99: number | null;
  errorRate: number | null;
  requestRate: number | null;
  podUptime: number | null;
  jvbParticipants: number | null;
  jvbStress: number | null;
  jvbConferences: number | null;
  jvbOctoSendBitrate: number | null;
  eventLoopLag: number | null;
  // ranged series
  latencyP95Series: Array<[number, number]>;
  latencyP50Series: Array<[number, number]>;
  latencyP99Series: Array<[number, number]>;
  errorRateSeries: Array<[number, number]>;
  requestRateSeries: Array<[number, number]>;
  stressSeries: Array<[number, number]>;
  participantSeries: Array<[number, number]>;
  cpuSeries: Array<[number, number]>;
  memorySeries: Array<[number, number]>;
  uptimeSeries: Array<[number, number]>;
  octoSeries: Array<[number, number]>;
  // chat + redis
  chatMessagesPerMin: number | null;
  chatSseConnections: number | null;
  redisConnectedClients: number | null;
  redisMemoryBytes: number | null;
  redisOpsPerSec: number | null;
  redisPubsubChannels: number | null;
  chatMessagesSeries: Array<[number, number]>;
  chatSseSeries: Array<[number, number]>;
  redisMemorySeries: Array<[number, number]>;
}

// ─── Main component ─────────────────────────────────────────────

export default function MonitoringDashboard() {
  const t = useTranslations('admin.monitoring');
  const fmt = useFormatter();
  const [range, setRange] = useState<Range>('7d');
  const [prom, setProm] = useState<PromSnapshot | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setError(null);
    try {
      const app = `app="${APP_LABEL}"`;
      const bucket = `http_request_duration_seconds_bucket{${app}}`;
      const total = `http_requests_total{${app}}`;
      const [
        // instant
        uptime24hRes,
        uptime7dRes,
        p50Res,
        p95Res,
        p99Res,
        errorRes,
        reqRateRes,
        podUptimeRes,
        partsRes,
        stressRes,
        confRes,
        octoSendRes,
        elLagRes,
        // ranges
        p95Range,
        p50Range,
        p99Range,
        errorRange,
        reqRange,
        stressRange,
        partsRange,
        cpuRange,
        memRange,
        uptimeRange,
        octoRange,
        // chat + redis
        chatMsgRateRes,
        chatSseRes,
        redisClientsRes,
        redisMemoryRes,
        redisOpsRes,
        redisPubsubRes,
        chatMsgRateRange,
        chatSseRange,
        redisMemoryRange,
        // analytics
        analyticsRes,
      ] = await Promise.all([
        promQuery(`avg(avg_over_time(up{${app}}[24h])) * 100`),
        promQuery(`avg(avg_over_time(up{${app}}[7d])) * 100`),
        promQuery(`histogram_quantile(0.50, sum by (le) (rate(${bucket}[5m])))`),
        promQuery(`histogram_quantile(0.95, sum by (le) (rate(${bucket}[5m])))`),
        promQuery(`histogram_quantile(0.99, sum by (le) (rate(${bucket}[5m])))`),
        promQuery(`sum(rate(${total.replace('}', ',status_code=~"5.."}')}[5m])) / clamp_min(sum(rate(${total}[5m])), 0.001)`),
        promQuery(`sum(rate(${total}[5m]))`),
        promQuery(`max(time() - process_start_time_seconds{${app}})`),
        promQuery(`eventi_jvb_participants{${app}}`),
        promQuery(`eventi_jvb_stress_level{${app}}`),
        promQuery(`eventi_jvb_conferences{${app}}`),
        promQuery(`eventi_jvb_octo_send_bitrate_bps{${app}}`),
        promQuery(`nodejs_eventloop_lag_seconds{${app}}`),
        promRangeQuery(`histogram_quantile(0.95, sum by (le) (rate(${bucket}[5m])))`, range),
        promRangeQuery(`histogram_quantile(0.50, sum by (le) (rate(${bucket}[5m])))`, range),
        promRangeQuery(`histogram_quantile(0.99, sum by (le) (rate(${bucket}[5m])))`, range),
        promRangeQuery(`sum(rate(${total.replace('}', ',status_code=~"5.."}')}[5m])) / clamp_min(sum(rate(${total}[5m])), 0.001)`, range),
        promRangeQuery(`sum(rate(${total}[5m]))`, range),
        promRangeQuery(`eventi_jvb_stress_level{${app}}`, range),
        promRangeQuery(`eventi_jvb_participants{${app}}`, range),
        promRangeQuery(`rate(process_cpu_seconds_total{${app}}[5m])`, range),
        promRangeQuery(`process_resident_memory_bytes{${app}}`, range),
        promRangeQuery(`avg(up{${app}}) * 100`, range),
        promRangeQuery(`eventi_jvb_octo_send_bitrate_bps{${app}}`, range),
        // Chat fan-out — app-level counters + the Bitnami redis-exporter.
        // Redis exporter labels the scrape target by the subchart service
        // (…-redis-metrics), not by `app`, so we don't constrain on {app}.
        promQuery(`sum(rate(eventi_chat_messages_total{${app}}[5m])) * 60`),
        promQuery(`sum(eventi_chat_sse_connections{${app}})`),
        promQuery(`sum(redis_connected_clients)`),
        promQuery(`sum(redis_memory_used_bytes)`),
        promQuery(`sum(rate(redis_commands_processed_total[5m]))`),
        promQuery(`sum(redis_pubsub_channels)`),
        promRangeQuery(`sum(rate(eventi_chat_messages_total{${app}}[5m])) * 60`, range),
        promRangeQuery(`sum(eventi_chat_sse_connections{${app}})`, range),
        promRangeQuery(`sum(redis_memory_used_bytes)`, range),
        fetch(`/api/admin/monitoring/analytics?range=${range}`).then((r) => r.json() as Promise<AnalyticsResponse>),
      ]);

      setProm({
        available: uptime24hRes.available,
        uptime24h: extractScalar(uptime24hRes),
        uptime7d: extractScalar(uptime7dRes),
        latencyP50: extractScalar(p50Res),
        latencyP95: extractScalar(p95Res),
        latencyP99: extractScalar(p99Res),
        errorRate: extractScalar(errorRes),
        requestRate: extractScalar(reqRateRes),
        podUptime: extractScalar(podUptimeRes),
        jvbParticipants: extractScalar(partsRes),
        jvbStress: extractScalar(stressRes),
        jvbConferences: extractScalar(confRes),
        jvbOctoSendBitrate: extractScalar(octoSendRes),
        eventLoopLag: extractScalar(elLagRes),
        latencyP95Series: extractSeries(p95Range),
        latencyP50Series: extractSeries(p50Range),
        latencyP99Series: extractSeries(p99Range),
        errorRateSeries: extractSeries(errorRange),
        requestRateSeries: extractSeries(reqRange),
        stressSeries: extractSeries(stressRange),
        participantSeries: extractSeries(partsRange),
        cpuSeries: extractSeries(cpuRange),
        memorySeries: extractSeries(memRange),
        uptimeSeries: extractSeries(uptimeRange),
        octoSeries: extractSeries(octoRange),
        chatMessagesPerMin: extractScalar(chatMsgRateRes),
        chatSseConnections: extractScalar(chatSseRes),
        redisConnectedClients: extractScalar(redisClientsRes),
        redisMemoryBytes: extractScalar(redisMemoryRes),
        redisOpsPerSec: extractScalar(redisOpsRes),
        redisPubsubChannels: extractScalar(redisPubsubRes),
        chatMessagesSeries: extractSeries(chatMsgRateRange),
        chatSseSeries: extractSeries(chatSseRange),
        redisMemorySeries: extractSeries(redisMemoryRange),
      });
      setAnalytics(analyticsRes);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch error');
    }
  }, [range]);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchAll]);

  const bucketData = useMemo(() => {
    if (!analytics) return { events: [], regs: [], calls: [], peaks: [] };
    return {
      events: analytics.buckets.map((b) => ({ ts: b.ts, value: b.events })),
      regs: analytics.buckets.map((b) => ({ ts: b.ts, value: b.registrations })),
      calls: analytics.buckets.map((b) => ({ ts: b.ts, value: b.callSessions })),
      peaks: analytics.buckets.map((b) => ({ ts: b.ts, value: b.peakParticipants })),
    };
  }, [analytics]);

  // ─── Early returns ────────────────────────────────────────────
  if (!prom && !analytics && !error) {
    return (
      <div className="text-center py-5">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">{t('loading')}</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Range selector */}
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <div role="group" aria-label={t('rangeLabel')}>
          {(['24h', '7d', '30d'] as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              className={`btn btn-sm ${range === r ? 'btn-primary' : 'btn-outline-primary'} me-1`}
              onClick={() => setRange(r)}
            >
              {t(`range.${r}`)}
            </button>
          ))}
        </div>
        <div className="text-muted" style={{ fontSize: '0.78rem' }}>
          {t('autoRefresh', { seconds: REFRESH_MS / 1000 })}
        </div>
      </div>

      {error && <Alert color="danger" className="mb-3">{error}</Alert>}
      {prom && !prom.available && (
        <Alert color="warning" className="mb-3">{t('prometheusUnavailable')}</Alert>
      )}

      {/* ─── Availability ─────────────────────────────────────── */}
      <h5 className="fw-semibold mb-3">{t('sectionAvailability')}</h5>
      <Row className="g-3 mb-4">
        <Col md={3} sm={6}>
          <KpiCard
            title={t('uptime24h')}
            value={prom?.uptime24h !== null && prom?.uptime24h !== undefined ? `${prom.uptime24h.toFixed(2)}%` : '—'}
            color={prom && prom.uptime24h !== null && prom.uptime24h >= 99.9 ? '#008758' : '#A66300'}
            trend={prom?.uptimeSeries}
          />
        </Col>
        <Col md={3} sm={6}>
          <KpiCard
            title={t('uptime7d')}
            value={prom?.uptime7d !== null && prom?.uptime7d !== undefined ? `${prom.uptime7d.toFixed(2)}%` : '—'}
            color={prom && prom.uptime7d !== null && prom.uptime7d >= 99.9 ? '#008758' : '#A66300'}
          />
        </Col>
        <Col md={3} sm={6}>
          <KpiCard
            title={t('errorRate')}
            value={prom?.errorRate !== null && prom?.errorRate !== undefined ? `${(prom.errorRate * 100).toFixed(2)}%` : '—'}
            color={prom && (prom.errorRate ?? 0) > 0.01 ? '#CC334D' : '#008758'}
            trend={prom?.errorRateSeries}
          />
        </Col>
        <Col md={3} sm={6}>
          <KpiCard
            title={t('podUptime')}
            value={fmtDuration(prom?.podUptime)}
            subtitle={t('oldestPod')}
          />
        </Col>
      </Row>

      {/* ─── Quality of Service ─────────────────────────────────── */}
      <h5 className="fw-semibold mb-3">{t('sectionQos')}</h5>
      <Row className="g-3 mb-4">
        <Col md={3} sm={6}>
          <KpiCard
            title={t('latencyP50')}
            value={fmtMs(prom?.latencyP50)}
            color="#008758"
            trend={prom?.latencyP50Series}
          />
        </Col>
        <Col md={3} sm={6}>
          <KpiCard
            title={t('latencyP95')}
            value={fmtMs(prom?.latencyP95)}
            color="#A66300"
            trend={prom?.latencyP95Series}
          />
        </Col>
        <Col md={3} sm={6}>
          <KpiCard
            title={t('latencyP99')}
            value={fmtMs(prom?.latencyP99)}
            color="#CC334D"
            trend={prom?.latencyP99Series}
          />
        </Col>
        <Col md={3} sm={6}>
          <KpiCard
            title={t('requestRate')}
            value={prom?.requestRate !== null && prom?.requestRate !== undefined ? `${prom.requestRate.toFixed(2)} req/s` : '—'}
            trend={prom?.requestRateSeries}
          />
        </Col>
      </Row>
      <Row className="g-3 mb-4">
        <Col md={12}>
          <Card className="border-0 shadow-sm">
            <CardBody className="p-3">
              <div className="fw-semibold mb-2" style={{ fontSize: '0.88rem' }}>{t('chartLatencyQuantiles')}</div>
              <LineChart
                series={[
                  prom?.latencyP50Series ?? [],
                  prom?.latencyP95Series ?? [],
                  prom?.latencyP99Series ?? [],
                ]}
                color={['#008758', '#A66300', '#CC334D']}
                height={140}
                format={(v) => `${(v * 1000).toFixed(0)}ms`}
              />
              <div className="d-flex gap-3 mt-2" style={{ fontSize: '0.72rem' }}>
                <span><span style={{ display: 'inline-block', width: 10, height: 3, background: '#008758', verticalAlign: 'middle' }} /> P50</span>
                <span><span style={{ display: 'inline-block', width: 10, height: 3, background: '#A66300', verticalAlign: 'middle' }} /> P95</span>
                <span><span style={{ display: 'inline-block', width: 10, height: 3, background: '#CC334D', verticalAlign: 'middle' }} /> P99</span>
              </div>
            </CardBody>
          </Card>
        </Col>
      </Row>

      {/* ─── Capacity / JVB ───────────────────────────────────── */}
      <h5 className="fw-semibold mb-3">{t('sectionCapacity')}</h5>
      <Row className="g-3 mb-4">
        <Col md={3} sm={6}>
          <KpiCard
            title={t('participantsNow')}
            value={prom?.jvbParticipants !== null && prom?.jvbParticipants !== undefined ? String(Math.round(prom.jvbParticipants)) : '—'}
            color="#008758"
            trend={prom?.participantSeries}
          />
        </Col>
        <Col md={3} sm={6}>
          <KpiCard
            title={t('jvbStress')}
            value={prom?.jvbStress !== null && prom?.jvbStress !== undefined ? `${(prom.jvbStress * 100).toFixed(1)}%` : '—'}
            color={prom && (prom.jvbStress ?? 0) > 0.8 ? '#CC334D' : prom && (prom.jvbStress ?? 0) > 0.5 ? '#A66300' : '#008758'}
            trend={prom?.stressSeries}
          />
        </Col>
        <Col md={3} sm={6}>
          <KpiCard
            title={t('conferences')}
            value={prom?.jvbConferences !== null && prom?.jvbConferences !== undefined ? String(Math.round(prom.jvbConferences)) : '—'}
          />
        </Col>
        <Col md={3} sm={6}>
          <KpiCard
            title={t('octoRelay')}
            value={prom?.jvbOctoSendBitrate ? `${(prom.jvbOctoSendBitrate * 8 / 1_000_000).toFixed(1)} Mbps` : '0 Mbps'}
            subtitle={t('interBridge')}
            trend={prom?.octoSeries}
          />
        </Col>
      </Row>

      {/* ─── Resources ──────────────────────────────────────── */}
      <h5 className="fw-semibold mb-3">{t('sectionResources')}</h5>
      <Row className="g-3 mb-4">
        <Col md={6}>
          <Card className="border-0 shadow-sm h-100">
            <CardBody className="p-3">
              <div className="fw-semibold mb-2" style={{ fontSize: '0.88rem' }}>{t('chartCpu')}</div>
              <LineChart series={prom?.cpuSeries ?? []} color="#5A768A" height={120} format={(v) => `${(v * 100).toFixed(0)}%`} />
              <div className="text-muted mt-1" style={{ fontSize: '0.72rem' }}>{t('cpuHelp')}</div>
            </CardBody>
          </Card>
        </Col>
        <Col md={6}>
          <Card className="border-0 shadow-sm h-100">
            <CardBody className="p-3">
              <div className="fw-semibold mb-2" style={{ fontSize: '0.88rem' }}>{t('chartMemory')}</div>
              <LineChart series={prom?.memorySeries ?? []} color="#7B1FA2" height={120} format={(v) => `${(v / 1024 / 1024).toFixed(0)} MiB`} />
              <div className="text-muted mt-1" style={{ fontSize: '0.72rem' }}>{t('memHelp')}</div>
            </CardBody>
          </Card>
        </Col>
      </Row>

      {/* ─── Chat & real-time (Redis pub/sub) ───────────────── */}
      <h5 className="fw-semibold mb-3">{t('sectionChat')}</h5>
      <Row className="g-3 mb-4">
        <Col md={3} sm={6}>
          <KpiCard
            title={t('chatMessagesPerMin')}
            value={prom?.chatMessagesPerMin !== null && prom?.chatMessagesPerMin !== undefined
              ? prom.chatMessagesPerMin.toFixed(1)
              : '—'}
            subtitle={t('chatMessagesSubtitle')}
            color="#0066CC"
            trend={prom?.chatMessagesSeries}
          />
        </Col>
        <Col md={3} sm={6}>
          <KpiCard
            title={t('chatSseConnections')}
            value={prom?.chatSseConnections !== null && prom?.chatSseConnections !== undefined
              ? String(Math.round(prom.chatSseConnections))
              : '—'}
            subtitle={t('chatSseSubtitle')}
            color="#008758"
            trend={prom?.chatSseSeries}
          />
        </Col>
        <Col md={3} sm={6}>
          <KpiCard
            title={t('redisConnectedClients')}
            value={prom?.redisConnectedClients !== null && prom?.redisConnectedClients !== undefined
              ? String(Math.round(prom.redisConnectedClients))
              : '—'}
            subtitle={t('redisConnectedSubtitle')}
          />
        </Col>
        <Col md={3} sm={6}>
          <KpiCard
            title={t('redisPubsubChannels')}
            value={prom?.redisPubsubChannels !== null && prom?.redisPubsubChannels !== undefined
              ? String(Math.round(prom.redisPubsubChannels))
              : '—'}
            subtitle={t('redisPubsubSubtitle')}
          />
        </Col>
      </Row>
      <Row className="g-3 mb-4">
        <Col md={6}>
          <Card className="border-0 shadow-sm h-100">
            <CardBody className="p-3">
              <div className="fw-semibold mb-2" style={{ fontSize: '0.88rem' }}>{t('chartRedisMemory')}</div>
              <LineChart
                series={prom?.redisMemorySeries ?? []}
                color="#A66300"
                height={120}
                format={(v) => `${(v / 1024 / 1024).toFixed(1)} MiB`}
              />
              <div className="text-muted mt-1" style={{ fontSize: '0.72rem' }}>
                {t('redisMemoryHelp', {
                  ops: prom?.redisOpsPerSec !== null && prom?.redisOpsPerSec !== undefined
                    ? prom.redisOpsPerSec.toFixed(1)
                    : '—',
                })}
              </div>
            </CardBody>
          </Card>
        </Col>
        <Col md={6}>
          <Card className="border-0 shadow-sm h-100">
            <CardBody className="p-3">
              <div className="fw-semibold mb-2" style={{ fontSize: '0.88rem' }}>{t('chartChatSseConnections')}</div>
              <LineChart
                series={prom?.chatSseSeries ?? []}
                color="#008758"
                height={120}
                format={(v) => String(Math.round(v))}
              />
              <div className="text-muted mt-1" style={{ fontSize: '0.72rem' }}>{t('chatSseHelp')}</div>
            </CardBody>
          </Card>
        </Col>
      </Row>

      {/* ─── Event analytics (from DB) ──────────────────────── */}
      <h5 className="fw-semibold mb-3">{t('sectionEvents')}</h5>
      <Row className="g-3 mb-3">
        <Col md={3} sm={6}>
          <KpiCard
            title={t('eventsInRange')}
            value={String(analytics?.events.total ?? '—')}
            subtitle={analytics ? t('byStatus', {
              live: analytics.events.byStatus.LIVE ?? 0,
              ended: analytics.events.byStatus.ENDED ?? 0,
            }) : ''}
          />
        </Col>
        <Col md={3} sm={6}>
          <KpiCard
            title={t('avgParticipants')}
            value={analytics?.events.avgParticipants !== null && analytics?.events.avgParticipants !== undefined
              ? String(analytics.events.avgParticipants)
              : '—'}
          />
        </Col>
        <Col md={3} sm={6}>
          <KpiCard
            title={t('callSessions')}
            value={String(analytics?.callSessions.total ?? '—')}
            subtitle={analytics?.callSessions.avgDurationSeconds
              ? t('avgDuration', { mins: Math.round(analytics.callSessions.avgDurationSeconds / 60) })
              : ''}
          />
        </Col>
        <Col md={3} sm={6}>
          <KpiCard
            title={t('registrationsInRange')}
            value={String(analytics?.registrations.total ?? '—')}
            subtitle={analytics?.registrations.total
              ? t('confirmedRatio', {
                  pct: Math.round((analytics.registrations.confirmed / Math.max(1, analytics.registrations.total)) * 100),
                })
              : ''}
          />
        </Col>
      </Row>
      <Row className="g-3 mb-4">
        <Col md={6}>
          <Card className="border-0 shadow-sm h-100">
            <CardBody className="p-3">
              <div className="fw-semibold mb-2" style={{ fontSize: '0.88rem' }}>{t('chartEventsBucket')}</div>
              <BarChart data={bucketData.events} color="#008758" />
            </CardBody>
          </Card>
        </Col>
        <Col md={6}>
          <Card className="border-0 shadow-sm h-100">
            <CardBody className="p-3">
              <div className="fw-semibold mb-2" style={{ fontSize: '0.88rem' }}>{t('chartRegistrationsBucket')}</div>
              <BarChart data={bucketData.regs} color="#0066CC" />
            </CardBody>
          </Card>
        </Col>
      </Row>
      <Row className="g-3 mb-4">
        <Col md={6}>
          <Card className="border-0 shadow-sm h-100">
            <CardBody className="p-3">
              <div className="fw-semibold mb-2" style={{ fontSize: '0.88rem' }}>{t('chartCallsBucket')}</div>
              <BarChart data={bucketData.calls} color="#7B1FA2" />
            </CardBody>
          </Card>
        </Col>
        <Col md={6}>
          <Card className="border-0 shadow-sm h-100">
            <CardBody className="p-3">
              <div className="fw-semibold mb-2" style={{ fontSize: '0.88rem' }}>{t('chartPeakBucket')}</div>
              <BarChart data={bucketData.peaks} color="#A66300" />
            </CardBody>
          </Card>
        </Col>
      </Row>

      {/* ─── Recent call sessions ─────────────────────────────── */}
      {analytics && analytics.recentCalls.length > 0 && (
        <>
          <h5 className="fw-semibold mb-3">{t('sectionRecentCalls')}</h5>
          <Card className="border-0 shadow-sm mb-4">
            <CardBody className="p-0">
              <div className="table-responsive">
                <table className="table table-hover mb-0" style={{ fontSize: '0.85rem' }}>
                  <thead>
                    <tr>
                      <th>{t('colEvent')}</th>
                      <th>{t('colStartedAt')}</th>
                      <th className="text-end">{t('colDuration')}</th>
                      <th className="text-end">{t('colPeakParts')}</th>
                      <th>{t('colRecording')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.recentCalls.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <div className="fw-semibold">{c.eventTitle}</div>
                          <div className="text-muted" style={{ fontSize: '0.72rem' }}>{c.jitsiRoomName}</div>
                        </td>
                        <td>
                          {fmt.dateTime(new Date(c.startedAt), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="text-end">
                          {c.durationSeconds !== null ? fmtDuration(c.durationSeconds) : '—'}
                        </td>
                        <td className="text-end">{c.peakParticipants}</td>
                        <td>
                          {c.recordingUrl ? (
                            <Badge color="success">
                              {c.recordingFileSize
                                ? `${(Number(c.recordingFileSize) / 1024 / 1024).toFixed(0)} MiB`
                                : '✓'}
                            </Badge>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        </>
      )}

      {/* ─── Scale-to-zero summary ────────────────────────────── */}
      {analytics && (
        <Card className="border-0 shadow-sm mb-4" style={{ background: '#F8FAFE' }}>
          <CardBody className="p-3">
            <div className="fw-semibold mb-2" style={{ fontSize: '0.88rem' }}>{t('scaleToZeroTitle')}</div>
            <div className="d-flex gap-4 flex-wrap" style={{ fontSize: '0.85rem' }}>
              <div><strong>{analytics.scaleToZero.liveEvents}</strong> {t('liveNow')}</div>
              <div><strong>{analytics.scaleToZero.provisioningEvents}</strong> {t('provisioningNow')}</div>
              <div><strong>{analytics.scaleToZero.idleEvents}</strong> {t('idleNow')}</div>
            </div>
            <div className="text-muted mt-2" style={{ fontSize: '0.78rem' }}>{t('scaleToZeroHelp')}</div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

// ─── Formatters ─────────────────────────────────────────────────

function fmtMs(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${Math.round(v * 1000)} ms`;
}

function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}
