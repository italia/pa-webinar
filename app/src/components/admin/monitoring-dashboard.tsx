'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Card,
  CardBody,
  Col,
  Row,
} from 'design-react-kit';

const REFRESH_MS = 30_000;
const APP_LABEL = 'eventi-dtd';

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

interface MetricValue {
  label: string;
  value: string;
  color?: string;
}

async function promQuery(query: string): Promise<PromResult> {
  const res = await fetch('/api/admin/metrics/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  return res.json();
}

async function promRangeQuery(
  query: string,
  hours: number,
  step: string,
): Promise<PromResult> {
  const now = Math.floor(Date.now() / 1000);
  const res = await fetch('/api/admin/metrics/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      start: String(now - hours * 3600),
      end: String(now),
      step,
    }),
  });
  return res.json();
}

function extractValue(res: PromResult): string | null {
  if (!res.available || !res.data?.result?.[0]) return null;
  const r = res.data.result[0];
  if (r.value) return r.value[1];
  if (r.values && r.values.length > 0) {
    const last = r.values[r.values.length - 1];
    return last ? last[1] : null;
  }
  return null;
}

function Sparkline({ data, color = '#0066CC', width = 300, height = 60 }: {
  data: Array<[number, string]>;
  color?: string;
  width?: number;
  height?: number;
}) {
  if (data.length < 2) return <span className="text-muted" style={{ fontSize: '0.78rem' }}>—</span>;

  const values = data.map(d => parseFloat(d[1]));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 2;
  const cw = width - pad * 2;
  const ch = height - pad * 2;

  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * cw;
    const y = pad + ch - ((v - min) / range) * ch;
    return `${x},${y}`;
  });

  const linePath = `M ${pts.join(' L ')}`;
  const fillPath = `${linePath} L ${pad + cw},${pad + ch} L ${pad},${pad + ch} Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path d={fillPath} fill={color} opacity={0.12} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

function StatCard({ title, value, subtitle, color }: {
  title: string;
  value: string;
  subtitle?: string;
  color?: string;
}) {
  return (
    <Card className="border-0 shadow-sm h-100">
      <CardBody className="p-3">
        <div className="text-muted mb-1" style={{ fontSize: '0.75rem' }}>{title}</div>
        <div className="fw-bold" style={{ fontSize: '1.5rem', color: color ?? '#17324D' }}>{value}</div>
        {subtitle && <div className="text-muted" style={{ fontSize: '0.72rem' }}>{subtitle}</div>}
      </CardBody>
    </Card>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="border-0 shadow-sm h-100">
      <CardBody className="p-3">
        <div className="fw-semibold mb-2" style={{ fontSize: '0.82rem' }}>{title}</div>
        {children}
      </CardBody>
    </Card>
  );
}

export default function MonitoringDashboard() {
  const t = useTranslations('admin.monitoring');
  const [available, setAvailable] = useState<boolean | null>(null);
  const [stats, setStats] = useState<MetricValue[]>([]);
  const [participantSeries, setParticipantSeries] = useState<Array<[number, string]>>([]);
  const [latencySeries, setLatencySeries] = useState<Array<[number, string]>>([]);
  const [requestRateSeries, setRequestRateSeries] = useState<Array<[number, string]>>([]);
  const [stressSeries, setStressSeries] = useState<Array<[number, string]>>([]);
  const [cpuSeries, setCpuSeries] = useState<Array<[number, string]>>([]);
  const [memorySeries, setMemorySeries] = useState<Array<[number, string]>>([]);

  const fetchMetrics = useCallback(async () => {
    const checkRes = await promQuery(`up{app="${APP_LABEL}"}`);
    if (!checkRes.available) {
      setAvailable(false);
      return;
    }
    setAvailable(true);

    const [
      activeEventsRes,
      participantsRes,
      registrationsRes,
      uptimeRes,
      latencyP95Res,
      latencyP50Res,
      errorRateRes,
      stressRes,
      participantRangeRes,
      latencyRangeRes,
      requestRateRangeRes,
      stressRangeRes,
      cpuRangeRes,
      memRangeRes,
    ] = await Promise.all([
      promQuery(`eventi_active_events{app="${APP_LABEL}"}`),
      promQuery(`eventi_jvb_participants{app="${APP_LABEL}"}`),
      promQuery(`eventi_registrations_total{app="${APP_LABEL}"}`),
      promQuery(`avg_over_time(up{app="${APP_LABEL}"}[24h]) * 100`),
      promQuery(`histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{app="${APP_LABEL}"}[5m]))`),
      promQuery(`histogram_quantile(0.50, rate(http_request_duration_seconds_bucket{app="${APP_LABEL}"}[5m]))`),
      promQuery(`rate(http_requests_total{app="${APP_LABEL}",status_code=~"5.."}[5m]) / rate(http_requests_total{app="${APP_LABEL}"}[5m]) * 100`),
      promQuery(`eventi_jvb_stress_level{app="${APP_LABEL}"}`),
      promRangeQuery(`eventi_jvb_participants{app="${APP_LABEL}"}`, 24, '300'),
      promRangeQuery(`histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{app="${APP_LABEL}"}[5m]))`, 6, '60'),
      promRangeQuery(`rate(http_requests_total{app="${APP_LABEL}"}[5m])`, 6, '60'),
      promRangeQuery(`eventi_jvb_stress_level{app="${APP_LABEL}"}`, 24, '300'),
      promRangeQuery(`rate(process_cpu_seconds_total{app="${APP_LABEL}"}[5m])`, 6, '60'),
      promRangeQuery(`process_resident_memory_bytes{app="${APP_LABEL}"}`, 6, '300'),
    ]);

    const fv = (res: PromResult, decimals = 0): string => {
      const v = extractValue(res);
      if (v === null) return '—';
      const n = parseFloat(v);
      return isNaN(n) ? '—' : n.toFixed(decimals);
    };

    setStats([
      { label: t('activeEvents'), value: fv(activeEventsRes), color: '#008758' },
      { label: t('participants'), value: fv(participantsRes), color: '#0066CC' },
      { label: t('registrations'), value: fv(registrationsRes) },
      { label: t('uptime24h'), value: `${fv(uptimeRes, 1)}%`, color: parseFloat(fv(uptimeRes, 1)) >= 99.9 ? '#008758' : '#A66300' },
      { label: t('latencyP95'), value: `${(parseFloat(fv(latencyP95Res, 3)) * 1000).toFixed(0)}ms`, color: parseFloat(fv(latencyP95Res, 3)) < 0.5 ? '#008758' : '#A66300' },
      { label: t('latencyP50'), value: `${(parseFloat(fv(latencyP50Res, 3)) * 1000).toFixed(0)}ms` },
      { label: t('errorRate'), value: `${fv(errorRateRes, 2)}%`, color: parseFloat(fv(errorRateRes, 2)) < 1 ? '#008758' : '#CC334D' },
      { label: t('jvbStress'), value: `${(parseFloat(fv(stressRes, 2)) * 100).toFixed(0)}%`, color: parseFloat(fv(stressRes, 2)) > 0.8 ? '#CC334D' : '#008758' },
    ]);

    const extractSeries = (res: PromResult): Array<[number, string]> =>
      res.data?.result?.[0]?.values ?? [];

    setParticipantSeries(extractSeries(participantRangeRes));
    setLatencySeries(extractSeries(latencyRangeRes));
    setRequestRateSeries(extractSeries(requestRateRangeRes));
    setStressSeries(extractSeries(stressRangeRes));
    setCpuSeries(extractSeries(cpuRangeRes));
    setMemorySeries(extractSeries(memRangeRes));
  }, [t]);

  useEffect(() => {
    fetchMetrics();
    const id = setInterval(fetchMetrics, REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchMetrics]);

  if (available === null) {
    return (
      <div className="text-center py-5">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">{t('loading')}</span>
        </div>
      </div>
    );
  }

  if (!available) {
    return (
      <Alert color="warning">
        {t('prometheusUnavailable')}
      </Alert>
    );
  }

  return (
    <div>
      {/* Stats overview */}
      <Row className="g-3 mb-4">
        {stats.map((s) => (
          <Col key={s.label} xs={6} md={3}>
            <StatCard title={s.label} value={s.value} color={s.color} />
          </Col>
        ))}
      </Row>

      {/* Charts: Application performance */}
      <h5 className="fw-semibold mb-3">{t('sectionPerformance')}</h5>
      <Row className="g-3 mb-4">
        <Col md={6}>
          <ChartCard title={t('chartLatency')}>
            <Sparkline data={latencySeries} color="#A66300" />
            <div className="text-muted mt-1" style={{ fontSize: '0.7rem' }}>P95 · {t('last6h')}</div>
          </ChartCard>
        </Col>
        <Col md={6}>
          <ChartCard title={t('chartRequestRate')}>
            <Sparkline data={requestRateSeries} color="#0066CC" />
            <div className="text-muted mt-1" style={{ fontSize: '0.7rem' }}>{t('reqPerSec')} · {t('last6h')}</div>
          </ChartCard>
        </Col>
      </Row>

      {/* Charts: JVB / Video */}
      <h5 className="fw-semibold mb-3">{t('sectionJvb')}</h5>
      <Row className="g-3 mb-4">
        <Col md={6}>
          <ChartCard title={t('chartParticipants')}>
            <Sparkline data={participantSeries} color="#008758" />
            <div className="text-muted mt-1" style={{ fontSize: '0.7rem' }}>{t('last24h')}</div>
          </ChartCard>
        </Col>
        <Col md={6}>
          <ChartCard title={t('chartStress')}>
            <Sparkline data={stressSeries} color="#CC334D" />
            <div className="text-muted mt-1" style={{ fontSize: '0.7rem' }}>{t('last24h')}</div>
          </ChartCard>
        </Col>
      </Row>

      {/* Charts: Infrastructure */}
      <h5 className="fw-semibold mb-3">{t('sectionInfra')}</h5>
      <Row className="g-3 mb-4">
        <Col md={6}>
          <ChartCard title={t('chartCpu')}>
            <Sparkline data={cpuSeries} color="#5A768A" />
            <div className="text-muted mt-1" style={{ fontSize: '0.7rem' }}>{t('last6h')}</div>
          </ChartCard>
        </Col>
        <Col md={6}>
          <ChartCard title={t('chartMemory')}>
            <Sparkline data={memorySeries} color="#7B1FA2" />
            <div className="text-muted mt-1" style={{ fontSize: '0.7rem' }}>{t('last6h')}</div>
          </ChartCard>
        </Col>
      </Row>
    </div>
  );
}
