'use client';

import { useState, useCallback } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import {
  Alert,
  Button,
  Card,
  CardBody,
  Icon,
  Table,
  Toggle,
  Row,
  Col,
  Badge,
} from 'design-react-kit';

import { useRouter } from '@/i18n/navigation';
import { Link } from '@/i18n/navigation';

import StatusBadge from './status-badge';
import CopyButton from './copy-button';
import DeleteEventModal from './delete-event-modal';

const ORG_TYPE_LABELS: Record<string, { it: string; en: string }> = {
  MINISTRY: { it: 'Ministero', en: 'Ministry' },
  AGENCY: { it: 'Agenzia', en: 'Agency' },
  REGION: { it: 'Regione', en: 'Region' },
  PROVINCE: { it: 'Provincia', en: 'Province' },
  MUNICIPALITY: { it: 'Comune', en: 'Municipality' },
  ASL: { it: 'ASL', en: 'ASL' },
  UNIVERSITY: { it: 'Università', en: 'University' },
  PUBLIC_ENTITY: { it: 'Ente pubblico', en: 'Public entity' },
  IN_HOUSE: { it: 'Società in-house', en: 'In-house company' },
  OTHER: { it: 'Altro', en: 'Other' },
};

interface Registration {
  id: string;
  displayName: string;
  organization: string | null;
  organizationRole: string | null;
  organizationType: string | null;
  joinedAt: string | null;
  createdAt: string;
}

interface EventData {
  id: string;
  slug: string;
  titleIt: string;
  titleEn: string | null;
  descriptionIt: string;
  descriptionEn: string | null;
  startsAt: string;
  endsAt: string;
  timezone: string;
  maxParticipants: number;
  registrationCount: number;
  qaEnabled: boolean;
  chatEnabled: boolean;
  recordingEnabled: boolean;
  participantsCanUnmute: boolean;
  participantsCanStartVideo: boolean;
  participantsCanShareScreen: boolean;
  status: string;
  recordingUrl: string | null;
  requireOrganization: boolean;
  requireOrganizationRole: boolean;
  requireOrganizationType: boolean;
  moderatorToken: string;
  moderatorName: string | null;
  moderatorEmail: string | null;
  jitsiRoomName: string;
  dataRetentionDays: number;
  privacyPolicyUrl: string | null;
  createdAt: string;
  registrations: Registration[];
}

interface EventManagementClientProps {
  event: EventData;
  baseUrl: string;
  locale: string;
}

const CARD_STYLE = {
  borderRadius: 8,
  border: '1px solid #e8e8e8',
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h5 className="fw-semibold mb-3" style={{ color: '#17324D' }}>
      {children}
    </h5>
  );
}

function UrlBox({ url }: { url: string }) {
  return (
    <div
      className="mb-2"
      style={{
        background: '#f5f7fb',
        padding: 12,
        borderRadius: 4,
        wordBreak: 'break-all',
        fontSize: 13,
        fontFamily: "'Roboto Mono', monospace",
        color: '#17324D',
        lineHeight: 1.5,
      }}
    >
      {url}
    </div>
  );
}

export default function EventManagementClient({
  event,
  baseUrl,
  locale,
}: EventManagementClientProps) {
  const t = useTranslations('admin');
  const te = useTranslations('events');
  const format = useFormatter();
  const router = useRouter();

  const [status, setStatus] = useState(event.status);
  const [chatEnabled, setChatEnabled] = useState(event.chatEnabled);
  const [qaEnabled, setQaEnabled] = useState(event.qaEnabled);
  const [recordingEnabled, setRecordingEnabled] = useState(event.recordingEnabled);
  const [participantsCanUnmute, setParticipantsCanUnmute] = useState(event.participantsCanUnmute);
  const [participantsCanStartVideo, setParticipantsCanStartVideo] = useState(event.participantsCanStartVideo);
  const [participantsCanShareScreen, setParticipantsCanShareScreen] = useState(event.participantsCanShareScreen);
  const [updating, setUpdating] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [savedField, setSavedField] = useState<string | null>(null);

  type ToggleField = 'chatEnabled' | 'qaEnabled' | 'recordingEnabled' | 'participantsCanUnmute' | 'participantsCanStartVideo' | 'participantsCanShareScreen';

  const toggleSetting = useCallback(
    async (field: ToggleField) => {
      const setters: Record<ToggleField, (v: boolean) => void> = {
        chatEnabled: setChatEnabled,
        qaEnabled: setQaEnabled,
        recordingEnabled: setRecordingEnabled,
        participantsCanUnmute: setParticipantsCanUnmute,
        participantsCanStartVideo: setParticipantsCanStartVideo,
        participantsCanShareScreen: setParticipantsCanShareScreen,
      };
      const current = { chatEnabled, qaEnabled, recordingEnabled, participantsCanUnmute, participantsCanStartVideo, participantsCanShareScreen }[field];
      const next = !current;

      setters[field](next);
      setSavedField(null);

      try {
        const res = await fetch(`/api/events/${event.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${event.moderatorToken}`,
          },
          body: JSON.stringify({ [field]: next }),
        });
        if (res.ok) {
          setSavedField(field);
          setTimeout(() => setSavedField(null), 2000);
        } else {
          setters[field](current);
        }
      } catch {
        setters[field](current);
      }
    },
    [chatEnabled, qaEnabled, recordingEnabled, participantsCanUnmute, participantsCanStartVideo, participantsCanShareScreen, event.id, event.moderatorToken],
  );

  const title = locale === 'en' && event.titleEn ? event.titleEn : event.titleIt;
  const startsAt = new Date(event.startsAt);
  const endsAt = new Date(event.endsAt);
  const durationMs = endsAt.getTime() - startsAt.getTime();
  const durationHours = Math.floor(durationMs / 3_600_000);
  const durationMinutes = Math.floor((durationMs % 3_600_000) / 60_000);

  const publicUrl = `${baseUrl}/${locale}/eventi/${event.slug}`;
  const moderatorUrl = `${baseUrl}/${locale}/admin/eventi/${event.id}?token=${event.moderatorToken}`;
  const liveModeratorUrl = `/eventi/${event.slug}/live?token=${event.moderatorToken}`;

  const togglePublish = useCallback(async () => {
    const newStatus = status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED';
    setUpdating(true);
    setFeedback('');
    try {
      const res = await fetch(`/api/events/${event.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${event.moderatorToken}`,
        },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        setStatus(newStatus);
        setFeedback(
          newStatus === 'PUBLISHED' ? t('publishSuccess') : t('unpublishSuccess'),
        );
      }
    } finally {
      setUpdating(false);
    }
  }, [status, event.id, event.moderatorToken, t]);

  const startEvent = useCallback(async () => {
    setUpdating(true);
    setFeedback('');
    try {
      const res = await fetch(`/api/events/${event.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${event.moderatorToken}`,
        },
        body: JSON.stringify({ status: 'LIVE' }),
      });
      if (res.ok) {
        setStatus('LIVE');
        setFeedback(t('startEventSuccess'));
      }
    } finally {
      setUpdating(false);
    }
  }, [event.id, event.moderatorToken, t]);

  const handleDeleted = useCallback(() => {
    router.push('/admin');
  }, [router]);

  const exportCsv = useCallback(() => {
    const headers = ['Nome', 'Ente', 'Ruolo', 'Tipologia ente', 'Data registrazione', 'Entrato'];
    const rows = event.registrations.map((reg) => [
      reg.displayName,
      reg.organization ?? '',
      reg.organizationRole ?? '',
      reg.organizationType ? (ORG_TYPE_LABELS[reg.organizationType]?.[locale as 'it' | 'en'] ?? reg.organizationType) : '',
      new Date(reg.createdAt).toISOString(),
      reg.joinedAt ? 'Si' : 'No',
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `registrazioni-${event.slug}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [event.registrations, event.slug, locale]);

  const occupancyPct = Math.min(
    100,
    (event.registrationCount / event.maxParticipants) * 100,
  );

  return (
    <>
      {/* ── Breadcrumb + Header ── */}
      <div className="mb-2">
        <Link
          href="/admin"
          className="text-decoration-none d-inline-flex align-items-center text-primary"
          style={{ fontSize: '0.9rem' }}
        >
          <Icon icon="it-arrow-left" size="sm" className="me-1" />
          {t('title')}
        </Link>
      </div>

      <div className="d-flex justify-content-between align-items-start mb-2 flex-wrap gap-3">
        <div className="flex-grow-1" style={{ minWidth: 0 }}>
          <h1 className="fw-bold mb-2" style={{ color: '#17324D' }}>
            {title}
          </h1>
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <StatusBadge status={status} />
            <span className="text-muted" style={{ fontSize: '0.85rem' }}>
              {format.dateTime(startsAt, {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </span>
          </div>
        </div>
        <div className="d-flex gap-2 flex-wrap flex-shrink-0">
          {status === 'PUBLISHED' && (
            <Button color="success" onClick={startEvent} disabled={updating}>
              <Icon icon="it-video" size="sm" color="white" className="me-1" />
              {t('startEvent')}
            </Button>
          )}
          <Link href={`/admin/eventi/${event.id}/modifica?token=${event.moderatorToken}`}>
            <Button color="secondary" outline tag="span">
              <Icon icon="it-pencil" size="sm" className="me-1" />
              {t('editEvent')}
            </Button>
          </Link>
          <Button
            color={status === 'PUBLISHED' ? 'warning' : 'primary'}
            onClick={togglePublish}
            disabled={updating || status === 'LIVE' || status === 'ENDED'}
          >
            {status === 'PUBLISHED' ? t('unpublish') : t('publish')}
          </Button>
          <DeleteEventModal
            eventId={event.id}
            moderatorToken={event.moderatorToken}
            onDeleted={handleDeleted}
          />
        </div>
      </div>

      {feedback && (
        <Alert color="success" className="mb-4 mt-3">
          {feedback}
        </Alert>
      )}

      {status === 'LIVE' && (
        <Alert color="info" className="mb-4 mt-3">
          <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
            <span className="d-flex align-items-center">
              <Icon icon="it-video" className="me-2" />
              <strong>{t('eventIsLive')}</strong>
            </span>
            <Link href={liveModeratorUrl}>
              <Button color="primary" size="sm" tag="span">
                {t('joinAsModeratorBtn')}
              </Button>
            </Link>
          </div>
        </Alert>
      )}

      <Row className="mt-4">
        {/* ═══ Left Column ═══ */}
        <Col lg={8}>
          {/* ── Event Details Card ── */}
          <Card className="shadow-sm border-0 mb-4" style={CARD_STYLE}>
            <CardBody className="p-4">
              <SectionTitle>{t('eventDetails')}</SectionTitle>
              <dl className="mb-0">
                <DetailRow
                  label={te('detail.date')}
                  value={
                    <>
                      {format.dateTime(startsAt, {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                      {' · '}
                      {format.dateTime(startsAt, { hour: '2-digit', minute: '2-digit' })}
                      {' – '}
                      {format.dateTime(endsAt, { hour: '2-digit', minute: '2-digit' })}
                    </>
                  }
                />
                <DetailRow
                  label={te('detail.duration')}
                  value={te('detail.durationHours', {
                    hours: durationHours,
                    minutes: durationMinutes,
                  })}
                />
                <DetailRow
                  label={te('detail.participants')}
                  value={
                    <div>
                      <div className="d-flex align-items-center justify-content-between mb-1">
                        <span className="fw-semibold">
                          {event.registrationCount} / {event.maxParticipants}
                        </span>
                        <span className="text-muted" style={{ fontSize: '0.8rem' }}>
                          {Math.round(occupancyPct)}%
                        </span>
                      </div>
                      <div className="progress" style={{ height: 5, borderRadius: 3 }}>
                        <div
                          className="progress-bar bg-primary"
                          role="progressbar"
                          style={{ width: `${occupancyPct}%`, borderRadius: 3 }}
                          aria-valuenow={event.registrationCount}
                          aria-valuemin={0}
                          aria-valuemax={event.maxParticipants}
                        />
                      </div>
                    </div>
                  }
                />
                {event.moderatorName && (
                  <DetailRow
                    label={t('form.moderatorName')}
                    value={
                      event.moderatorEmail
                        ? `${event.moderatorName} (${event.moderatorEmail})`
                        : event.moderatorName
                    }
                  />
                )}
                {event.descriptionIt && (
                  <DetailRow
                    label={te('detail.description')}
                    value={
                      <span className="text-secondary" style={{ whiteSpace: 'pre-wrap' }}>
                        {locale === 'en' && event.descriptionEn
                          ? event.descriptionEn
                          : event.descriptionIt}
                      </span>
                    }
                  />
                )}
              </dl>
            </CardBody>
          </Card>

          {/* ── Settings Card ── */}
          <Card className="shadow-sm border-0 mb-4" style={CARD_STYLE}>
            <CardBody className="p-4">
              <SectionTitle>{te('manage.settingsSection')}</SectionTitle>
              <ToggleRow
                label={te('manage.toggleChat')}
                description={t('toggleChatDesc')}
                checked={chatEnabled}
                onChange={() => toggleSetting('chatEnabled')}
                disabled={updating}
                saved={savedField === 'chatEnabled'}
                savedLabel={t('settingsSaved')}
              />
              <ToggleRow
                label={te('manage.toggleQa')}
                description={t('toggleQaDesc')}
                checked={qaEnabled}
                onChange={() => toggleSetting('qaEnabled')}
                disabled={updating}
                saved={savedField === 'qaEnabled'}
                savedLabel={t('settingsSaved')}
                hasBorder
              />
              <ToggleRow
                label={te('manage.toggleRecording')}
                description={t('toggleRecordingDesc')}
                checked={recordingEnabled}
                onChange={() => toggleSetting('recordingEnabled')}
                disabled={updating}
                saved={savedField === 'recordingEnabled'}
                savedLabel={t('settingsSaved')}
                hasBorder
              />
            </CardBody>
          </Card>

          {/* ── AV Permissions Card ── */}
          <Card className="shadow-sm border-0 mb-4" style={CARD_STYLE}>
            <CardBody className="p-4">
              <SectionTitle>{t('form.sectionPermissions')}</SectionTitle>
              <ToggleRow
                label={t('form.participantsCanUnmute')}
                description={participantsCanUnmute ? t('form.permissionsOnDesc') : t('form.permissionsOffDesc')}
                checked={participantsCanUnmute}
                onChange={() => toggleSetting('participantsCanUnmute')}
                disabled={updating}
                saved={savedField === 'participantsCanUnmute'}
                savedLabel={t('settingsSaved')}
              />
              <ToggleRow
                label={t('form.participantsCanStartVideo')}
                description={participantsCanStartVideo ? t('form.permissionsOnDesc') : t('form.permissionsOffDesc')}
                checked={participantsCanStartVideo}
                onChange={() => toggleSetting('participantsCanStartVideo')}
                disabled={updating}
                saved={savedField === 'participantsCanStartVideo'}
                savedLabel={t('settingsSaved')}
                hasBorder
              />
              <ToggleRow
                label={t('form.participantsCanShareScreen')}
                description={participantsCanShareScreen ? t('form.permissionsOnDesc') : t('form.permissionsOffDesc')}
                checked={participantsCanShareScreen}
                onChange={() => toggleSetting('participantsCanShareScreen')}
                disabled={updating}
                saved={savedField === 'participantsCanShareScreen'}
                savedLabel={t('settingsSaved')}
                hasBorder
              />
              <div className="mt-2">
                <small className="form-text text-muted">
                  {t('form.permissionsNote')}
                </small>
              </div>
            </CardBody>
          </Card>

          {/* ── Registrations Card ── */}
          <Card className="shadow-sm border-0 mb-4" style={CARD_STYLE}>
            <CardBody className="p-4">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <div className="d-flex align-items-center gap-2">
                  <SectionTitle>{t('registrations')}</SectionTitle>
                  <Badge color="primary" pill className="mb-3" style={{ fontSize: '0.78rem' }}>
                    {event.registrationCount}
                  </Badge>
                </div>
                {event.registrations.length > 0 && (
                  <Button
                    color="primary"
                    outline
                    size="sm"
                    onClick={exportCsv}
                  >
                    {t('exportCsv')}
                  </Button>
                )}
              </div>

              {/* Organization type stats */}
              {event.registrations.some((r) => r.organizationType) && (
                <div className="mb-3 d-flex flex-wrap gap-2">
                  {Object.entries(
                    event.registrations.reduce<Record<string, number>>((acc, r) => {
                      if (r.organizationType) {
                        acc[r.organizationType] = (acc[r.organizationType] || 0) + 1;
                      }
                      return acc;
                    }, {}),
                  )
                    .sort((a, b) => b[1] - a[1])
                    .map(([type, count]) => {
                      const pct = Math.round((count / event.registrations.length) * 100);
                      const label = ORG_TYPE_LABELS[type]?.[locale as 'it' | 'en'] ?? type;
                      return (
                        <Badge key={type} color="" pill className="px-2 py-1" style={{ backgroundColor: '#E9ECEF', color: '#17324D', fontSize: '0.78rem' }}>
                          {label}: {pct}% ({count})
                        </Badge>
                      );
                    })}
                </div>
              )}

              {event.registrations.length === 0 ? (
                <div className="text-center py-4">
                  <div
                    className="mx-auto mb-3 d-flex align-items-center justify-content-center rounded-circle"
                    style={{
                      width: 48,
                      height: 48,
                      backgroundColor: 'rgba(0,102,204,0.08)',
                    }}
                  >
                    <Icon icon="it-user" className="text-primary" />
                  </div>
                  <p className="text-muted mb-0">{t('noRegistrations')}</p>
                </div>
              ) : (
                <div className="table-responsive">
                  <Table hover>
                    <thead>
                      <tr>
                        <th scope="col" style={{ width: 40 }}>#</th>
                        <th scope="col">{te('detail.participants')}</th>
                        {event.requireOrganization && <th scope="col">{t('organization')}</th>}
                        {event.requireOrganizationType && <th scope="col">{t('organizationType')}</th>}
                        <th scope="col">{t('registrationDate')}</th>
                        <th scope="col">{t('joined')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {event.registrations.map((reg, i) => (
                        <tr key={reg.id}>
                          <td className="text-muted">{i + 1}</td>
                          <td className="fw-semibold">{reg.displayName}</td>
                          {event.requireOrganization && (
                            <td className="text-secondary">{reg.organization ?? '—'}</td>
                          )}
                          {event.requireOrganizationType && (
                            <td className="text-secondary">
                              {reg.organizationType
                                ? (ORG_TYPE_LABELS[reg.organizationType]?.[locale as 'it' | 'en'] ?? reg.organizationType)
                                : '—'}
                            </td>
                          )}
                          <td className="text-secondary">
                            {format.dateTime(new Date(reg.createdAt), {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                          <td>
                            {reg.joinedAt ? (
                              <Badge color="success" pill className="px-2 py-1" style={{ fontSize: '0.75rem' }}>
                                {t('joined')}
                              </Badge>
                            ) : (
                              <Badge color="" pill className="px-2 py-1" style={{ fontSize: '0.75rem', backgroundColor: '#E9ECEF', color: '#5A768A' }}>
                                {t('notJoined')}
                              </Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
            </CardBody>
          </Card>
        </Col>

        {/* ═══ Right Column ═══ */}
        <Col lg={4}>
          {/* ── Links Card ── */}
          <Card className="shadow-sm border-0 mb-4" style={CARD_STYLE}>
            <CardBody className="p-4">
              <SectionTitle>{t('links.title')}</SectionTitle>

              <div className="mb-4">
                <label className="fw-semibold d-block mb-1 text-secondary" style={{ fontSize: '0.85rem' }}>
                  {t('links.publicPage')}
                </label>
                <UrlBox url={publicUrl} />
                <CopyButton text={publicUrl} />
              </div>

              <div
                className="mb-4 pt-4"
                style={{ borderTop: '1px solid #e8e8e8' }}
              >
                <label className="fw-semibold d-block mb-1 text-secondary" style={{ fontSize: '0.85rem' }}>
                  {t('links.moderatorLink')}
                </label>
                <Alert color="warning" className="py-2 px-3 mb-2">
                  <small>{t('links.moderatorLinkHint')}</small>
                </Alert>
                <UrlBox url={moderatorUrl} />
                <CopyButton text={moderatorUrl} />
              </div>

              {(status === 'PUBLISHED' || status === 'LIVE') && (
                <div className="pt-4" style={{ borderTop: '1px solid #e8e8e8' }}>
                  <label className="fw-semibold d-block mb-1 text-secondary" style={{ fontSize: '0.85rem' }}>
                    {t('liveRoomLink')}
                  </label>
                  <UrlBox url={`${baseUrl}${liveModeratorUrl}`} />
                  <CopyButton text={`${baseUrl}${liveModeratorUrl}`} />
                </div>
              )}
            </CardBody>
          </Card>

          {/* ── Quick Actions Card ── */}
          <Card className="shadow-sm border-0 mb-4" style={CARD_STYLE}>
            <CardBody className="p-4">
              <SectionTitle>{t('quickActions')}</SectionTitle>
              <div className="d-grid gap-2">
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-outline-primary d-flex align-items-center justify-content-center gap-2"
                >
                  <Icon icon="it-external-link" size="sm" />
                  {t('openPublicPage')}
                </a>

                {(status === 'PUBLISHED' || status === 'LIVE') && (
                  <Link href={liveModeratorUrl}>
                    <Button
                      color="primary"
                      outline
                      className="w-100 d-flex align-items-center justify-content-center gap-2"
                      tag="span"
                    >
                      <Icon icon="it-video" size="sm" />
                      {t('joinAsModeratorBtn')}
                    </Button>
                  </Link>
                )}

                {status === 'PUBLISHED' && (
                  <Button
                    color="success"
                    className="d-flex align-items-center justify-content-center gap-2"
                    onClick={startEvent}
                    disabled={updating}
                  >
                    <Icon icon="it-video" size="sm" color="white" />
                    {t('startEvent')}
                  </Button>
                )}
              </div>
            </CardBody>
          </Card>
        </Col>
      </Row>
    </>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div
      className="py-3"
      style={{ borderBottom: '1px solid #f0f0f0' }}
    >
      <dt
        className="text-secondary text-uppercase mb-1"
        style={{ fontSize: '0.75rem', letterSpacing: '0.04em', fontWeight: 600 }}
      >
        {label}
      </dt>
      <dd className="mb-0" style={{ color: '#17324D' }}>
        {value}
      </dd>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled,
  saved,
  savedLabel,
  hasBorder,
  isLast,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
  disabled: boolean;
  saved: boolean;
  savedLabel: string;
  hasBorder?: boolean;
  isLast?: boolean;
}) {
  return (
    <div
      className={`d-flex justify-content-between align-items-start py-3${isLast ? '' : ''}`}
      style={hasBorder ? { borderTop: '1px solid #f0f0f0' } : undefined}
    >
      <div className="me-3">
        <div className="fw-semibold" style={{ color: '#17324D' }}>
          {label}
        </div>
        <div className="text-secondary" style={{ fontSize: '0.85rem' }}>
          {description}
        </div>
      </div>
      <div className="d-flex align-items-center gap-2 flex-shrink-0">
        {saved && (
          <span className="text-success" style={{ fontSize: '0.8rem' }}>
            <Icon icon="it-check" size="sm" className="me-1" />
            {savedLabel}
          </span>
        )}
        <Toggle
          label=""
          checked={checked}
          onChange={onChange}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
