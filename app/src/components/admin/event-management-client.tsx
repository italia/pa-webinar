'use client';

import { useState, useCallback } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import {
  Alert,
  Button,
  Card,
  CardBody,
  FormGroup,
  Icon,
  Table,
  Toggle,
  Row,
  Col,
} from 'design-react-kit';

import { useRouter } from '@/i18n/navigation';
import { Link } from '@/i18n/navigation';

import StatusBadge from './status-badge';
import CopyButton from './copy-button';
import DeleteEventModal from './delete-event-modal';

interface Registration {
  id: string;
  displayName: string;
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
  status: string;
  recordingUrl: string | null;
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
  const [recordingEnabled, setRecordingEnabled] = useState(
    event.recordingEnabled,
  );
  const [updating, setUpdating] = useState(false);
  const [feedback, setFeedback] = useState('');

  const toggleSetting = useCallback(
    async (field: 'chatEnabled' | 'qaEnabled' | 'recordingEnabled') => {
      const setters = {
        chatEnabled: setChatEnabled,
        qaEnabled: setQaEnabled,
        recordingEnabled: setRecordingEnabled,
      };
      const current = { chatEnabled, qaEnabled, recordingEnabled }[field];
      const next = !current;

      setters[field](next);
      setFeedback('');

      try {
        const res = await fetch(`/api/events/${event.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${event.moderatorToken}`,
          },
          body: JSON.stringify({ [field]: next }),
        });
        if (!res.ok) {
          setters[field](current);
        }
      } catch {
        setters[field](current);
      }
    },
    [chatEnabled, qaEnabled, recordingEnabled, event.id, event.moderatorToken],
  );

  const title = locale === 'en' && event.titleEn ? event.titleEn : event.titleIt;

  const publicUrl = `${baseUrl}/${locale}/eventi/${event.slug}`;
  const moderatorUrl = `${baseUrl}/${locale}/admin/eventi/${event.id}?token=${event.moderatorToken}`;

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
          newStatus === 'PUBLISHED'
            ? t('publishSuccess')
            : t('unpublishSuccess'),
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

  return (
    <>
      {/* ── Header ── */}
      <div className="d-flex justify-content-between align-items-start mb-4 flex-wrap gap-3">
        <div>
          <Link href="/admin" className="text-decoration-none d-inline-flex align-items-center mb-2">
            <Icon icon="it-arrow-left" size="sm" className="me-1" />
            {t('title')}
          </Link>
          <h1 className="mb-1">{title}</h1>
          <StatusBadge status={status} />
        </div>
        <div className="d-flex gap-2 flex-wrap">
          {status === 'PUBLISHED' && (
            <Button
              color="success"
              onClick={startEvent}
              disabled={updating}
            >
              <Icon icon="it-video" size="sm" color="white" className="me-1" />
              {t('startEvent')}
            </Button>
          )}
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
        <Alert color="success" className="mb-4">
          {feedback}
        </Alert>
      )}

      {status === 'LIVE' && (
        <Alert color="info" className="mb-4">
          <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
            <span>
              <Icon icon="it-video" className="me-2" />
              {t('eventIsLive')}
            </span>
            <Link
              href={`/eventi/${event.slug}/live?token=${event.moderatorToken}`}
            >
              <Button color="primary" size="sm" tag="span">
                {t('joinAsModeratorBtn')}
              </Button>
            </Link>
          </div>
        </Alert>
      )}

      <Row>
        {/* ── Event Details ── */}
        <Col lg={8} className="mb-4">
          <Card className="card-bg shadow-sm">
            <CardBody>
              <h4 className="mb-3">{t('eventDetails')}</h4>
              <dl className="row mb-0">
                <dt className="col-sm-4">{te('detail.date')}</dt>
                <dd className="col-sm-8">
                  {format.dateTime(new Date(event.startsAt), {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {' — '}
                  {format.dateTime(new Date(event.endsAt), {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </dd>

                <dt className="col-sm-4">{te('detail.participants')}</dt>
                <dd className="col-sm-8">
                  {event.registrationCount} / {event.maxParticipants}
                </dd>

                {event.moderatorName && (
                  <>
                    <dt className="col-sm-4">{t('form.moderatorName')}</dt>
                    <dd className="col-sm-8">{event.moderatorName}</dd>
                  </>
                )}

                {event.moderatorEmail && (
                  <>
                    <dt className="col-sm-4">{t('form.moderatorEmail')}</dt>
                    <dd className="col-sm-8">{event.moderatorEmail}</dd>
                  </>
                )}
              </dl>
            </CardBody>
          </Card>
        </Col>

        {/* ── Links ── */}
        <Col lg={4} className="mb-4">
          <Card className="card-bg shadow-sm">
            <CardBody>
              <h4 className="mb-3">{t('links.title')}</h4>

              <div className="mb-3">
                <strong className="d-block mb-1">
                  {t('links.publicPage')}
                </strong>
                <code className="d-block text-break small mb-2">
                  {publicUrl}
                </code>
                <CopyButton text={publicUrl} />
              </div>

              <hr />

              <div>
                <strong className="d-block mb-1">
                  {t('links.moderatorLink')}
                </strong>
                <Alert color="warning" className="py-2 px-3 mb-2">
                  <small>{t('links.moderatorLinkHint')}</small>
                </Alert>
                <code className="d-block text-break small mb-2">
                  {moderatorUrl}
                </code>
                <CopyButton text={moderatorUrl} />
              </div>
            </CardBody>
          </Card>
        </Col>
      </Row>

      {/* ── Event Settings Toggles ── */}
      <Card className="card-bg shadow-sm mb-4">
        <CardBody>
          <h4 className="mb-3">{te('manage.settingsSection')}</h4>
          <Row>
            <Col md={4}>
              <FormGroup check className="mb-3">
                <Toggle
                  label={te('manage.toggleChat')}
                  checked={chatEnabled}
                  onChange={() => toggleSetting('chatEnabled')}
                  disabled={updating}
                />
              </FormGroup>
            </Col>
            <Col md={4}>
              <FormGroup check className="mb-3">
                <Toggle
                  label={te('manage.toggleQa')}
                  checked={qaEnabled}
                  onChange={() => toggleSetting('qaEnabled')}
                  disabled={updating}
                />
              </FormGroup>
            </Col>
            <Col md={4}>
              <FormGroup check className="mb-3">
                <Toggle
                  label={te('manage.toggleRecording')}
                  checked={recordingEnabled}
                  onChange={() => toggleSetting('recordingEnabled')}
                  disabled={updating}
                />
              </FormGroup>
            </Col>
          </Row>
        </CardBody>
      </Card>

      {/* ── Registrations Table ── */}
      <Card className="card-bg shadow-sm">
        <CardBody>
          <h4 className="mb-3">
            {t('registrations')}{' '}
            <span className="text-muted fw-normal">
              ({event.registrationCount})
            </span>
          </h4>

          {event.registrations.length === 0 ? (
            <p className="text-muted">{t('noRegistrations')}</p>
          ) : (
            <div className="table-responsive">
              <Table hover>
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">{te('detail.participants')}</th>
                    <th scope="col">{t('registrationDate')}</th>
                    <th scope="col">{t('joined')}</th>
                  </tr>
                </thead>
                <tbody>
                  {event.registrations.map((reg, i) => (
                    <tr key={reg.id}>
                      <td>{i + 1}</td>
                      <td>{reg.displayName}</td>
                      <td>
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
                          <span className="text-success fw-semibold">
                            {t('joined')}
                          </span>
                        ) : (
                          <span className="text-muted">
                            {t('notJoined')}
                          </span>
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
    </>
  );
}
