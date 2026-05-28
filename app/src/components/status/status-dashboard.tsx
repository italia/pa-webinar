'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import {
  Badge,
  Card,
  CardBody,
  Icon,
  Row,
  Col,
} from 'design-react-kit';

import PostprodStatusCard from './postprod-status-card';

interface SystemStatus {
  overall: 'operational' | 'degraded' | 'outage';
  components: unknown[];
  metrics: {
    activeEvents: number;
    idleEvents: number;
    provisioningEvents: number;
    totalRegistrationsToday: number;
    jvbDesiredReplicas: number;
    jvbRunningReplicas: number;
    jvbStatus: 'ready' | 'scaling' | 'standby';
    jvbStressLevel: number | null;
    jvbParticipants: number | null;
    jvbStale: boolean;
    jvbOctoEnabled: boolean;
    jvbOctoConferences: number | null;
    jvbOctoEndpoints: number | null;
    jvbOctoSendBitrateBps: number | null;
    jibriStale: boolean;
  };
  upcomingEvents: {
    title: string;
    startsAt: string;
    status: string;
    maxParticipants: number;
    videoEnabled: boolean;
  }[];
  config: {
    provisioningTimeoutMinutes: number;
    pollIntervalSeconds: number;
  };
  lastChecked: string;
}

const DEFAULT_POLL_INTERVAL_MS = 30_000;

export default function StatusDashboard() {
  const t = useTranslations('status');
  const format = useFormatter();
  const [data, setData] = useState<SystemStatus | null>(null);
  const [error, setError] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status', {
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  // Poll interval comes from SiteSetting (admin-configurable, default 30s).
  // Until the first fetch lands we fall back to the compile-time default.
  const pollIntervalMs = (data?.config?.pollIntervalSeconds ?? 0) > 0
    ? (data!.config.pollIntervalSeconds * 1000)
    : DEFAULT_POLL_INTERVAL_MS;

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, pollIntervalMs);
    return () => clearInterval(interval);
  }, [fetchStatus, pollIntervalMs]);

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
      <div className="alert alert-danger">{t('fetchError')}</div>
    );
  }

  if (!data) return null;

  const jvbMaxReplicas = parseInt(process.env.NEXT_PUBLIC_JVB_MAX_REPLICAS ?? '6', 10) || 6;
  const jvbRunning = data.metrics.jvbRunningReplicas;
  const jvbDesired = data.metrics.jvbDesiredReplicas;

  const jvbCapacityColor = data.metrics.jvbStatus === 'scaling'
    ? '#A66300'
    : jvbRunning > 0
      ? '#008758'
      : '#5A768A';

  const stressLevel = data.metrics.jvbStressLevel;
  const stressColor = stressLevel === null
    ? '#5A768A'
    : stressLevel > 0.7
      ? '#CC334D'
      : stressLevel > 0.5
        ? '#A66300'
        : '#008758';

  const anyStale = data.metrics.jvbStale || data.metrics.jibriStale;

  return (
    <>
      {anyStale && (
        <div
          className="alert alert-warning mb-4 border-0"
          role="alert"
          style={{ background: '#fff8e1', color: '#6d4c00' }}
        >
          <Icon icon="it-warning-circle" size="sm" className="me-2" color="warning" />
          <strong>{t('staleWarningTitle')}</strong>
          <div className="mt-1" style={{ fontSize: '0.88rem' }}>
            {data.metrics.jvbStale && t('staleJvbDetail')}
            {data.metrics.jvbStale && data.metrics.jibriStale && ' '}
            {data.metrics.jibriStale && t('staleJibriDetail')}
          </div>
        </div>
      )}
      <Row className="mb-4">
        {/* JVB Capacity */}
        <Col md={6} className="mb-4 mb-md-0">
          <Card className="h-100 border-0 shadow-sm">
            <CardBody className="p-4">
              <h5 className="fw-semibold mb-3">
                <Icon icon="it-video" size="sm" className="me-2" />
                {t('jvbCapacity')}
              </h5>
              {data.metrics.jvbStatus === 'standby' ? (
                <div>
                  <p className="text-muted mb-2">{t('jvbStandby')}</p>
                  <p className="mb-0" style={{ fontSize: '0.82rem', color: '#5A768A' }}>
                    {t('jvbStandbyDetail')}
                  </p>
                </div>
              ) : (
                <>
                  <div className="progress mb-2" style={{ height: 12, borderRadius: 6 }}>
                    <div
                      className="progress-bar"
                      role="progressbar"
                      style={{
                        width: `${(jvbRunning / jvbMaxReplicas) * 100}%`,
                        backgroundColor: jvbCapacityColor,
                        borderRadius: 6,
                      }}
                      aria-valuenow={jvbRunning}
                      aria-valuemin={0}
                      aria-valuemax={jvbMaxReplicas}
                    />
                    {jvbDesired > jvbRunning && (
                      <div
                        className="progress-bar progress-bar-striped progress-bar-animated"
                        role="progressbar"
                        style={{
                          width: `${((jvbDesired - jvbRunning) / jvbMaxReplicas) * 100}%`,
                          backgroundColor: '#A66300',
                        }}
                        aria-valuenow={jvbDesired - jvbRunning}
                        aria-valuemin={0}
                        aria-valuemax={jvbMaxReplicas}
                      />
                    )}
                  </div>
                  <p className="text-muted mb-0" style={{ fontSize: '0.88rem' }}>
                    {data.metrics.jvbStatus === 'scaling' ? (
                      <>
                        <strong style={{ color: '#A66300' }}>{t('jvbScaling')}</strong>
                        {' · '}
                        {jvbRunning}/{jvbDesired} {t('nodesReady')}
                      </>
                    ) : (
                      <>
                        {jvbRunning}/{jvbMaxReplicas} {t('nodesActive')}
                      </>
                    )}
                  </p>

                  {stressLevel !== null && (
                    <div className="mt-3">
                      <div className="d-flex justify-content-between align-items-center mb-1">
                        <span style={{ fontSize: '0.8rem', color: '#5A768A' }}>{t('jvbStress')}</span>
                        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: stressColor }}>
                          {Math.round(stressLevel * 100)}%
                        </span>
                      </div>
                      <div className="progress" style={{ height: 6, borderRadius: 3 }}>
                        <div
                          className="progress-bar"
                          style={{
                            width: `${stressLevel * 100}%`,
                            backgroundColor: stressColor,
                            borderRadius: 3,
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {data.metrics.jvbParticipants !== null && data.metrics.jvbParticipants > 0 && (
                    <p className="mt-2 mb-0" style={{ fontSize: '0.82rem', color: '#5A768A' }}>
                      {data.metrics.jvbParticipants} {t('participantsConnected')}
                    </p>
                  )}

                  {data.metrics.jvbOctoEnabled && (
                    <p className="mt-2 mb-0" style={{ fontSize: '0.82rem', color: '#0066CC' }}>
                      <Icon icon="it-link" size="xs" className="me-1" />
                      {t('jvbOctoActive', {
                        bridges: (data.metrics.jvbOctoConferences ?? 0) + 1,
                        relayMbps: Math.round((data.metrics.jvbOctoSendBitrateBps ?? 0) / 1000),
                      })}
                    </p>
                  )}
                </>
              )}
            </CardBody>
          </Card>
        </Col>

        {/* Upcoming events */}
        <Col md={6}>
          <Card className="h-100 border-0 shadow-sm">
            <CardBody className="p-4">
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
                    const minutesUntil = Math.max(
                      0,
                      Math.round((startsAt.getTime() - Date.now()) / 60_000),
                    );

                    // Badge/label driven by lifecycle state. IDLE and
                    // PROVISIONING are new states introduced with
                    // scale-to-zero; they need distinct visual treatment
                    // so a user landing on /status can tell why a room is
                    // "up but not running".
                    const badge = (() => {
                      switch (event.status) {
                        case 'LIVE':
                          return <Badge color="success" className="ms-2 flex-shrink-0">{t('liveNow')}</Badge>;
                        case 'PROVISIONING':
                          return <Badge color="warning" className="ms-2 flex-shrink-0">{t('provisioning')}</Badge>;
                        case 'IDLE':
                          return <Badge color="secondary" className="ms-2 flex-shrink-0">{t('idle')}</Badge>;
                        default:
                          return minutesUntil <= 30 ? (
                            <span className="text-warning flex-shrink-0" style={{ fontSize: '0.8rem' }}>
                              {t('jvbActivatesIn', { minutes: minutesUntil })}
                            </span>
                          ) : null;
                      }
                    })();

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
                            {' · '}
                            {event.maxParticipants} max
                            {' · '}
                            {event.videoEnabled ? t('videoInteractive') : t('videoWebinar')}
                          </span>
                        </div>
                        {badge}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>

      {/* Postprod AI pipeline — il componente si auto-nasconde quando
          la pipeline è disabilitata (graceful degradation, vedi
          PostprodStatusCard). Quando visibile occupa una riga intera
          per dare spazio a queue bar + provider info + footer last
          success/failure. */}
      <Row className="mb-4">
        <Col>
          <PostprodStatusCard />
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
