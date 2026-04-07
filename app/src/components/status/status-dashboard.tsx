'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  Icon,
  Row,
  Col,
} from 'design-react-kit';

interface ComponentStatus {
  name: string;
  status: 'operational' | 'degraded' | 'outage' | 'standby' | 'unknown';
  responseTime?: number;
  details?: string;
}

interface SystemStatus {
  overall: 'operational' | 'degraded' | 'outage';
  components: ComponentStatus[];
  metrics: {
    activeEvents: number;
    totalRegistrationsToday: number;
    jvbDesiredReplicas: number;
    jvbStatus: 'ready' | 'scaling' | 'standby';
  };
  upcomingEvents: {
    title: string;
    startsAt: string;
    status: string;
  }[];
  lastChecked: string;
}

const STATUS_COLOR: Record<string, string> = {
  operational: '#008758',
  degraded: '#A66300',
  outage: '#CC334D',
  standby: '#5A768A',
  unknown: '#5A768A',
};

const OVERALL_ALERT: Record<string, 'success' | 'warning' | 'danger'> = {
  operational: 'success',
  degraded: 'warning',
  outage: 'danger',
};

const MAX_HISTORY = 10;
const POLL_INTERVAL_MS = 30_000;

export default function StatusDashboard() {
  const t = useTranslations('status');
  const format = useFormatter();
  const [data, setData] = useState<SystemStatus | null>(null);
  const [error, setError] = useState(false);
  const historyRef = useRef<Map<string, number[]>>(new Map());

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status', {
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: SystemStatus = await res.json();
      setData(json);
      setError(false);

      for (const comp of json.components) {
        if (comp.responseTime !== undefined) {
          const history = historyRef.current.get(comp.name) ?? [];
          history.push(comp.responseTime);
          if (history.length > MAX_HISTORY) history.shift();
          historyRef.current.set(comp.name, history);
        }
      }
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  if (!data && !error) {
    return (
      <div className="text-center py-5">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">{t('loading')}</span>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <Alert color="danger">{t('fetchError')}</Alert>
    );
  }

  if (!data) return null;

  const componentKey = (name: string): string => {
    const keyMap: Record<string, string> = {
      app: 'components.app',
      database: 'components.database',
      jitsi: 'components.jitsi',
      jvb: 'components.jvb',
      jibri: 'components.jibri',
      smtp: 'components.smtp',
    };
    return keyMap[name] ?? name;
  };

  const statusLabel = (status: string): string => {
    const keyMap: Record<string, string> = {
      operational: 'operational',
      degraded: 'degradedLabel',
      outage: 'outage',
      standby: 'standby',
      unknown: 'standby',
    };
    return t(keyMap[status] ?? 'standby');
  };

  const jvbMaxReplicas = parseInt(process.env.NEXT_PUBLIC_JVB_MAX_REPLICAS ?? '4', 10) || 4;
  const jvbCapacityPct = Math.min(100, (data.metrics.jvbDesiredReplicas / jvbMaxReplicas) * 100);
  const jvbCapacityColor = jvbCapacityPct > 70
    ? '#CC334D'
    : jvbCapacityPct > 0
      ? '#008758'
      : '#5A768A';

  return (
    <>
      {/* Overall status banner */}
      <Alert color={OVERALL_ALERT[data.overall] ?? 'info'} className="mb-4">
        <strong>
          {data.overall === 'operational' && t('allOperational')}
          {data.overall === 'degraded' && t('degraded')}
          {data.overall === 'outage' && t('outage')}
        </strong>
      </Alert>

      {/* Component list */}
      <Card className="mb-4 border-0 shadow-sm">
        <CardBody className="p-0">
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  <th className="border-0 ps-4" style={{ width: '40%' }}>{t('componentLabel')}</th>
                  <th className="border-0" style={{ width: '30%' }}>{t('statusLabel')}</th>
                  <th className="border-0 text-end pe-4" style={{ width: '30%' }}>{t('responseTime')}</th>
                </tr>
              </thead>
              <tbody>
                {data.components.map((comp) => (
                  <tr key={comp.name}>
                    <td className="ps-4 align-middle">
                      <span className="d-flex align-items-center gap-2">
                        <span
                          className="rounded-circle d-inline-block flex-shrink-0"
                          style={{
                            width: 10,
                            height: 10,
                            backgroundColor: STATUS_COLOR[comp.status] ?? '#5A768A',
                          }}
                        />
                        {t(componentKey(comp.name))}
                      </span>
                    </td>
                    <td className="align-middle">
                      <Badge
                        style={{
                          backgroundColor: STATUS_COLOR[comp.status] ?? '#5A768A',
                          fontSize: '0.78rem',
                        }}
                      >
                        {statusLabel(comp.status)}
                      </Badge>
                    </td>
                    <td className="text-end pe-4 align-middle">
                      {comp.responseTime !== undefined ? (
                        <span className="d-flex align-items-center justify-content-end gap-2">
                          <ResponseHistory
                            history={historyRef.current.get(comp.name) ?? []}
                          />
                          <span className="text-muted" style={{ fontSize: '0.85rem' }}>
                            {comp.responseTime}ms
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted" style={{ fontSize: '0.85rem' }}>
                          {comp.details ?? '—'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <Row className="mb-4">
        {/* JVB Capacity */}
        <Col md={6} className="mb-4 mb-md-0">
          <Card className="h-100 border-0 shadow-sm">
            <CardBody>
              <h5 className="fw-semibold mb-3">
                <Icon icon="it-video" size="sm" className="me-2" />
                {t('jvbCapacity')}
              </h5>
              {data.metrics.jvbDesiredReplicas === 0 ? (
                <p className="text-muted mb-0">{t('jvbStandby')}</p>
              ) : (
                <>
                  <div className="progress mb-2" style={{ height: 12, borderRadius: 6 }}>
                    <div
                      className="progress-bar"
                      role="progressbar"
                      style={{
                        width: `${jvbCapacityPct}%`,
                        backgroundColor: jvbCapacityColor,
                        borderRadius: 6,
                      }}
                      aria-valuenow={jvbCapacityPct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    />
                  </div>
                  <p className="text-muted mb-0" style={{ fontSize: '0.88rem' }}>
                    {data.metrics.jvbDesiredReplicas}/{jvbMaxReplicas} {t('nodesActive')}{' · '}
                    ~{data.metrics.jvbDesiredReplicas * 100} {t('participantsAvailable')}
                  </p>
                </>
              )}
              {data.metrics.jvbStatus === 'scaling' && (
                <p className="text-warning mt-2 mb-0" style={{ fontSize: '0.85rem' }}>
                  {t('jvbScaling')}
                </p>
              )}
            </CardBody>
          </Card>
        </Col>

        {/* Upcoming events */}
        <Col md={6}>
          <Card className="h-100 border-0 shadow-sm">
            <CardBody>
              <h5 className="fw-semibold mb-3">
                <Icon icon="it-calendar" size="sm" className="me-2" />
                {t('upcomingEvents')}
              </h5>
              {data.upcomingEvents.length === 0 ? (
                <p className="text-muted mb-0">{t('noUpcomingEvents')}</p>
              ) : (
                <ul className="list-unstyled mb-0">
                  {data.upcomingEvents.map((event, i) => {
                    const startsAt = new Date(event.startsAt);
                    const isLive = event.status === 'LIVE';
                    const minutesUntil = Math.max(
                      0,
                      Math.round((startsAt.getTime() - Date.now()) / 60_000),
                    );

                    return (
                      <li
                        key={i}
                        className={`d-flex justify-content-between align-items-start ${i > 0 ? 'mt-3 pt-3 border-top' : ''}`}
                      >
                        <div>
                          <span className="fw-semibold" style={{ fontSize: '0.92rem' }}>
                            {event.title}
                          </span>
                          <br />
                          <span className="text-muted" style={{ fontSize: '0.82rem' }}>
                            {format.dateTime(startsAt, {
                              day: 'numeric',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        {isLive ? (
                          <Badge color="success" className="ms-2 flex-shrink-0">
                            {t('liveNow')}
                          </Badge>
                        ) : minutesUntil <= 30 ? (
                          <span
                            className="text-warning flex-shrink-0"
                            style={{ fontSize: '0.8rem' }}
                          >
                            {t('jvbActivatesIn', { minutes: minutesUntil })}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>

      {/* Metrics summary */}
      <Row className="mb-4">
        <Col xs={6} md={3} className="mb-3">
          <Card className="border-0 shadow-sm text-center">
            <CardBody className="py-3">
              <div className="h3 mb-1 fw-bold" style={{ color: '#0066CC' }}>
                {data.metrics.activeEvents}
              </div>
              <div className="text-muted" style={{ fontSize: '0.82rem' }}>
                {t('activeEvents')}
              </div>
            </CardBody>
          </Card>
        </Col>
        <Col xs={6} md={3} className="mb-3">
          <Card className="border-0 shadow-sm text-center">
            <CardBody className="py-3">
              <div className="h3 mb-1 fw-bold" style={{ color: '#0066CC' }}>
                {data.metrics.totalRegistrationsToday}
              </div>
              <div className="text-muted" style={{ fontSize: '0.82rem' }}>
                {t('registrationsToday')}
              </div>
            </CardBody>
          </Card>
        </Col>
        <Col xs={6} md={3} className="mb-3">
          <Card className="border-0 shadow-sm text-center">
            <CardBody className="py-3">
              <div className="h3 mb-1 fw-bold" style={{ color: '#0066CC' }}>
                {data.metrics.jvbDesiredReplicas}
              </div>
              <div className="text-muted" style={{ fontSize: '0.82rem' }}>
                {t('jvbNodes')}
              </div>
            </CardBody>
          </Card>
        </Col>
        <Col xs={6} md={3} className="mb-3">
          <Card className="border-0 shadow-sm text-center">
            <CardBody className="py-3">
              <div
                className="h3 mb-1 fw-bold"
                style={{ color: STATUS_COLOR[data.overall] }}
              >
                {statusLabel(data.overall)}
              </div>
              <div className="text-muted" style={{ fontSize: '0.82rem' }}>
                {t('overallStatus')}
              </div>
            </CardBody>
          </Card>
        </Col>
      </Row>

      {/* Last checked */}
      <p className="text-muted text-center" style={{ fontSize: '0.82rem' }}>
        {t('lastChecked')}: {format.dateTime(new Date(data.lastChecked), {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })}
        {error && (
          <span className="text-danger ms-2">{t('fetchError')}</span>
        )}
      </p>
    </>
  );
}

function ResponseHistory({ history }: { history: number[] }) {
  if (history.length < 2) return null;

  const max = Math.max(...history, 1);
  const dotSize = 4;
  const gap = 3;
  const height = 16;

  return (
    <svg
      width={history.length * (dotSize + gap)}
      height={height}
      aria-hidden="true"
    >
      {history.map((ms, i) => {
        const normalised = Math.min(ms / max, 1);
        const y = height - dotSize / 2 - normalised * (height - dotSize);
        const color = ms > 1000 ? '#CC334D' : ms > 500 ? '#A66300' : '#008758';
        return (
          <circle
            key={i}
            cx={i * (dotSize + gap) + dotSize / 2}
            cy={y}
            r={dotSize / 2}
            fill={color}
            opacity={0.7}
          />
        );
      })}
    </svg>
  );
}
