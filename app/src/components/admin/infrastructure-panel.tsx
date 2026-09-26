'use client';

import { useTranslations } from 'next-intl';
import {
  Alert,
  Card,
  CardBody,
  Col,
  Row,
} from 'design-react-kit';

import { Icon } from '@/components/ui/icon';
import type { InfrastructureInfo } from '@/lib/infrastructure';

interface InfrastructurePanelProps {
  info: InfrastructureInfo;
}

type StatusColor = 'success' | 'secondary' | 'warning' | 'danger';

function statusDot(color: StatusColor) {
  const colorMap: Record<StatusColor, string> = {
    success: '#28a745',
    secondary: '#adb5bd',
    warning: '#A66300',
    danger: '#dc3545',
  };
  return (
    <span
      className="d-inline-block rounded-circle me-2"
      style={{ width: 10, height: 10, backgroundColor: colorMap[color] }}
    />
  );
}

function InfraCard({
  title,
  status,
  children,
}: {
  title: string;
  status: StatusColor;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-0 shadow-sm h-100">
      <CardBody className="p-3">
        <h6 className="fw-semibold d-flex align-items-center mb-3">
          {statusDot(status)}
          {title}
        </h6>
        <div className="small text-secondary">{children}</div>
      </CardBody>
    </Card>
  );
}

export default function InfrastructurePanel({ info }: InfrastructurePanelProps) {
  const t = useTranslations('admin.infrastructure');

  const modeLabels: Record<string, string> = {
    simple: t('modes.simple'),
    standard: t('modes.standard'),
    full: t('modes.full'),
    unknown: t('modes.unknown'),
  };

  // La sala: verde se risponde, ambra se risponde male o se la sola verifica
  // possibile (l'indirizzo pubblico) non riconosce il certificato o il nome.
  const jitsiColor: StatusColor = !info.jitsi.domain
    ? 'secondary'
    : info.jitsi.status === 'operational'
      ? 'success'
      : info.jitsi.status === 'degraded'
        ? 'warning'
        : info.jitsi.status === 'outage'
          ? 'danger'
          : 'secondary';
  const jvbColor: StatusColor =
    info.jvb.mode === 'unmonitored'
      ? 'secondary'
      : info.jvb.runningReplicas === 0 && info.jvb.mode === 'fixed'
        ? 'danger'
        : 'success';

  return (
    <div>
      {/* Deployment overview */}
      <div className="mb-4 p-3 rounded" style={{ backgroundColor: '#F5F7FB' }}>
        <Row className="align-items-center">
          <Col md={4}>
            <div className="small text-muted">{t('deploymentMode')}</div>
            <div className="fw-semibold">{modeLabels[info.deployment.mode] ?? info.deployment.mode}</div>
            <div className="small text-muted">{t(`platforms.${info.deployment.platform}`)}</div>
          </Col>
          <Col md={4}>
            <div className="small text-muted">{t('version')}</div>
            <div className="fw-semibold">{info.deployment.version || '—'}</div>
          </Col>
          <Col md={4}>
            <div className="small text-muted">{t('environment')}</div>
            <div className="fw-semibold">{info.deployment.nodeEnv}</div>
          </Col>
        </Row>
      </div>

      <Row className="g-3 mb-3">
        {/* Database */}
        <Col md={6} lg={4}>
          <InfraCard
            title={t('database.title')}
            status={info.database.connected ? 'success' : 'danger'}
          >
            <p className="mb-1">
              {info.database.type === 'internal' ? t('database.internal') : t('database.external')}
            </p>
            {info.database.host && (
              <p className="mb-1 text-truncate" title={info.database.host}>
                {info.database.host}
              </p>
            )}
            <p className="mb-0">
              {info.database.connected ? t('database.connected') : t('database.disconnected')}
            </p>
          </InfraCard>
        </Col>

        {/* Jitsi */}
        <Col md={6} lg={4}>
          <InfraCard title={t('jitsi.title')} status={jitsiColor}>
            {info.jitsi.domain ? (
              <>
                <p className="mb-1 text-truncate" title={info.jitsi.domain}>
                  {info.jitsi.domain}
                </p>
                <p className="mb-1">
                  {info.jitsi.publicCheckFailed
                    ? t('jitsi.publicCheckFailed', { code: info.jitsi.detail ?? '—' })
                    : info.jitsi.status === 'degraded'
                      ? t('jitsi.degraded')
                      : info.jitsi.reachable
                        ? t('jitsi.reachable')
                        : t('jitsi.unreachable')}
                </p>
                {info.jitsi.detail && !info.jitsi.publicCheckFailed && (
                  <p className="mb-1 text-truncate" title={info.jitsi.detail}>
                    <code>{info.jitsi.detail}</code>
                  </p>
                )}
                <p className="mb-0">
                  JWT: {info.jitsi.jwtConfigured ? '\u2713' : '\u2717'}
                </p>
              </>
            ) : (
              <p className="mb-0">{t('jitsi.notConfigured')}</p>
            )}
          </InfraCard>
        </Col>

        {/* JVB */}
        <Col md={6} lg={4}>
          <InfraCard title={t('jvb.title')} status={jvbColor}>
            {info.jvb.mode === 'scaler' ? (
              <>
                <p className="mb-1">{t('jvb.scaleToZero')}</p>
                <p className="mb-1">
                  {t('jvb.replicas', { current: info.jvb.desiredReplicas, max: info.jvb.maxReplicas })}
                </p>
                <p className="mb-0">
                  {t('jvb.preScale', { minutes: info.jvb.preScaleMinutes })}
                </p>
              </>
            ) : info.jvb.mode === 'fixed' ? (
              <>
                <p className="mb-1">{t('jvb.fixedMode')}</p>
                {info.jvb.runningReplicas === 0 ? (
                  <p className="mb-0">{t('jvb.fixedDown')}</p>
                ) : (
                  <p className="mb-0">
                    {t('jvb.replicas', {
                      current: info.jvb.runningReplicas ?? 0,
                      max: info.jvb.maxReplicas,
                    })}
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="mb-1">{t('jvb.fixedMode')}</p>
                <p className="mb-0">{t('jvb.unmonitored')}</p>
              </>
            )}
          </InfraCard>
        </Col>

        {/* Jibri / Recording */}
        <Col md={6} lg={4}>
          <InfraCard
            title={t('jibri.title')}
            status={info.jibri.storageConfigured ? 'success' : 'secondary'}
          >
            {info.jibri.storageConfigured ? (
              <>
                <p className="mb-1">{t('jibri.available')}</p>
                <p className="mb-0">
                  {t('jibri.storageType')}: {info.jibri.storageType}
                </p>
              </>
            ) : (
              <p className="mb-0">{t('jibri.notConfigured')}</p>
            )}
          </InfraCard>
        </Col>

        {/* Email */}
        <Col md={6} lg={4}>
          <InfraCard
            title={t('email.title')}
            status={info.email.configured ? 'success' : 'secondary'}
          >
            {info.email.configured ? (
              <>
                <p className="mb-1">{info.email.provider}</p>
                <p className="mb-0">{t('email.configured')}</p>
              </>
            ) : (
              <p className="mb-0">{t('email.notConfigured')}</p>
            )}
          </InfraCard>
        </Col>

        {/* Features */}
        <Col md={6} lg={4}>
          <InfraCard title={t('features.title')} status="success">
            <ul className="list-unstyled mb-0">
              {info.features.statusPage && (
                <li className="mb-1">
                  <Icon icon="it-check" size="xs" className="me-1" />
                  {t('features.statusPage')}
                </li>
              )}
              {info.features.guestAccess && (
                <li className="mb-1">
                  <Icon icon="it-check" size="xs" className="me-1" />
                  {t('features.guestAccess')}
                </li>
              )}
              {info.features.metricsEndpoint && (
                <li className="mb-0">
                  <Icon icon="it-check" size="xs" className="me-1" />
                  {t('features.metrics')}
                </li>
              )}
            </ul>
          </InfraCard>
        </Col>
      </Row>

      {/* Jibri callout */}
      {!info.jibri.storageConfigured && (
        <Alert color="info" className="mt-3">
          <Icon icon="it-info-circle" className="me-2" />
          {t('jibri.configureHint')}{' '}
          <a
            href="https://github.com/italia/pa-webinar/blob/main/docs/operations/recording-setup.md#recording-storage"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('jibri.docsLink')}
          </a>
        </Alert>
      )}

      {/* Footer note */}
      <div className="mt-4 p-3 rounded" style={{ backgroundColor: '#F5F7FB' }}>
        <p className="text-secondary small mb-1">
          <Icon icon="it-info-circle" size="xs" className="me-1" />
          {t('note')}
        </p>
        <a
          href="https://github.com/italia/pa-webinar/blob/main/docs/DEPLOYMENT.md"
          className="small"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('deployDocs')}
        </a>
      </div>
    </div>
  );
}
