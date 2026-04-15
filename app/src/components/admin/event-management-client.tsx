'use client';

import { useState, useCallback, useEffect } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import {
  Alert,
  Button,
  Card,
  CardBody,
  Icon,
  Table,
  Row,
  Col,
  Badge,
} from 'design-react-kit';

import ToggleSwitch from '@/components/ui/toggle-switch';
import { useRouter } from '@/i18n/navigation';
import { Link } from '@/i18n/navigation';
import { REMINDER_PRESETS } from '@/lib/validation/schemas';

import { getLocalized, type LocalizedField } from '@/lib/utils/locale';

import StatusBadge from './status-badge';
import CopyButton from './copy-button';
import DeleteEventModal from './delete-event-modal';
import EventConfigDiagram from './event-config-diagram';
import RecordingManagement from './recording-management';
import CallSessionsPanel from './call-sessions-panel';
import PostEventConfig from './post-event-config';

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

interface ReminderData {
  id: string;
  offsetMinutes: number;
  label: string;
  sentCount: number;
  createdAt: string;
}

interface MaterialData {
  id: string;
  title: string;
  url: string;
  description: string | null;
  addedBy: string;
  createdAt: string;
}

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
  title: Record<string, string>;
  description: Record<string, string>;
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
  tempRecordingUrl: string | null;
  tempRecordingStartedAt: string | null;
  recordingPublished: boolean;
  recordingPublishedAt: string | null;
  recordingFileSize: number | null;
  recordingDuration: number | null;
  recordingDeleteAfterDays: number | null;
  postEventPublic: boolean;
  postEventPublicUntil: string | null;
  postEventShowQA: boolean;
  postEventShowMaterials: boolean;
  postEventShowPolls: boolean;
  postEventShowFeedback: boolean;
  feedbackEnabled: boolean;
  recordingConsentText: string | null;
  requireOrganization: boolean;
  requireOrganizationRole: boolean;
  requireOrganizationType: boolean;
  moderatorToken: string;
  moderatorName: string | null;
  moderatorEmail: string | null;
  jitsiRoomName: string;
  dataRetentionDays: number;
  privacyPolicyUrl: string | null;
  privacyPolicyText: string | null;
  speakersInfo: Record<string, string> | null;
  createdAt: string;
  registrations: Registration[];
  materials: MaterialData[];
  reminders: ReminderData[];
  gdprAuditLogs: GdprAuditLogData[];
}

interface GdprAuditLogData {
  id: string;
  action: string;
  recordCount: number;
  details: string | null;
  createdAt: string;
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

  const title = getLocalized(event.title, locale);
  const startsAt = new Date(event.startsAt);
  const endsAt = new Date(event.endsAt);
  const durationMs = endsAt.getTime() - startsAt.getTime();
  const durationHours = Math.floor(durationMs / 3_600_000);
  const durationMinutes = Math.floor((durationMs % 3_600_000) / 60_000);

  const publicUrl = `${baseUrl}/${locale}/${locale === 'it' ? 'eventi' : 'events'}/${event.slug}`;
  const moderatorUrl = `${baseUrl}/${locale}/admin/events/${event.id}?token=${event.moderatorToken}`;
  const liveModeratorUrl = `/events/${event.slug}/live?token=${event.moderatorToken}`;

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

  const isEarlyStart = new Date(event.startsAt).getTime() > Date.now() + 30 * 60_000;

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
        const msg = isEarlyStart
          ? `${t('startEventSuccess')} ${t('jvbWarmupWarning')}`
          : t('startEventSuccess');
        setFeedback(msg);
      }
    } finally {
      setUpdating(false);
    }
  }, [event.id, event.moderatorToken, event.startsAt, isEarlyStart, t]);

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

  // ── Materials management ──
  const tm = useTranslations('materials');
  const [materials, setMaterials] = useState<MaterialData[]>(event.materials);
  const [showMaterialForm, setShowMaterialForm] = useState(false);
  const [matTitle, setMatTitle] = useState('');
  const [matUrl, setMatUrl] = useState('');
  const [matDesc, setMatDesc] = useState('');
  const [matSubmitting, setMatSubmitting] = useState(false);
  const [matError, setMatError] = useState('');

  const handleAddMaterial = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setMatError('');

      if (matTitle.trim().length < 1) return;
      try { new URL(matUrl.trim()); } catch {
        setMatError(tm('errors.urlInvalid'));
        return;
      }

      setMatSubmitting(true);
      try {
        const res = await fetch(`/api/events/${event.slug}/materials`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${event.moderatorToken}`,
          },
          body: JSON.stringify({
            title: matTitle.trim(),
            url: matUrl.trim(),
            description: matDesc.trim() || undefined,
          }),
        });
        if (res.ok) {
          const newMat: MaterialData = await res.json();
          setMaterials((prev) => [newMat, ...prev]);
          setMatTitle('');
          setMatUrl('');
          setMatDesc('');
          setShowMaterialForm(false);
        } else {
          setMatError(tm('errors.generic'));
        }
      } catch {
        setMatError(tm('errors.generic'));
      } finally {
        setMatSubmitting(false);
      }
    },
    [matTitle, matUrl, matDesc, event.slug, event.moderatorToken, tm],
  );

  const handleDeleteMaterial = useCallback(
    async (id: string) => {
      if (!confirm(tm('confirmDelete'))) return;
      try {
        const res = await fetch(`/api/events/${event.slug}/materials/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${event.moderatorToken}` },
        });
        if (res.ok) {
          setMaterials((prev) => prev.filter((m) => m.id !== id));
        }
      } catch { /* retry next time */ }
    },
    [event.slug, event.moderatorToken, tm],
  );

  // ── Reminders management ──
  const tr = useTranslations('reminders');
  const [reminders, setReminders] = useState<ReminderData[]>(event.reminders);
  const [selectedOffset, setSelectedOffset] = useState('');

  const availablePresets = REMINDER_PRESETS.filter(
    (p) => !reminders.some((r) => r.offsetMinutes === p.offsetMinutes),
  );

  const handleAddReminder = useCallback(async () => {
    const offset = Number(selectedOffset);
    if (!offset) return;

    try {
      const res = await fetch(`/api/events/${event.slug}/reminders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${event.moderatorToken}`,
        },
        body: JSON.stringify({ offsetMinutes: offset }),
      });
      if (res.ok) {
        const newReminder: ReminderData = await res.json();
        setReminders((prev) => [...prev, newReminder].sort((a, b) => b.offsetMinutes - a.offsetMinutes));
        setSelectedOffset('');
      }
    } catch { /* retry */ }
  }, [selectedOffset, event.slug, event.moderatorToken]);

  const handleDeleteReminder = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/events/${event.slug}/reminders/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${event.moderatorToken}` },
      });
      if (res.ok) {
        setReminders((prev) => prev.filter((r) => r.id !== id));
      }
    } catch { /* retry */ }
  }, [event.slug, event.moderatorToken]);

  // Poll live participant count when event is LIVE
  const [liveCount, setLiveCount] = useState<number | null>(null);
  useEffect(() => {
    if (status !== 'LIVE') {
      setLiveCount(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/events/${event.slug}/analytics/peak?token=${event.moderatorToken}`,
        );
        if (res.ok && !cancelled) {
          const data = await res.json();
          setLiveCount(data.peakParticipants ?? null);
        }
      } catch { /* ignore */ }
    };
    poll();
    const interval = setInterval(poll, 15_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [status, event.slug, event.moderatorToken]);

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
          <Link href={`/admin/events/${event.id}/edit?token=${event.moderatorToken}`}>
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
            <span className="d-flex align-items-center gap-3">
              <span className="d-flex align-items-center">
                <Icon icon="it-video" className="me-2" />
                <strong>{t('eventIsLive')}</strong>
              </span>
              {liveCount !== null && (
                <Badge
                  color=""
                  pill
                  className="px-2 py-1"
                  style={{ backgroundColor: 'rgba(0,102,204,0.12)', color: '#0066CC', fontSize: '0.82rem' }}
                >
                  <Icon icon="it-user" size="xs" className="me-1" />
                  {t('liveParticipants', { count: liveCount, max: event.maxParticipants })}
                </Badge>
              )}
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
                {getLocalized(event.description, locale) && (
                  <DetailRow
                    label={te('detail.description')}
                    value={
                      <span className="text-secondary" style={{ whiteSpace: 'pre-wrap' }}>
                        {getLocalized(event.description, locale)}
                      </span>
                    }
                  />
                )}
              </dl>
            </CardBody>
          </Card>

          {/* ── Configuration Diagram ── */}
          <Card className="shadow-sm border-0 mb-4" style={CARD_STYLE}>
            <CardBody className="p-4">
              <SectionTitle>{te('manage.settingsSection')}</SectionTitle>
              <EventConfigDiagram
                event={{
                  maxParticipants: event.maxParticipants,
                  qaEnabled,
                  chatEnabled,
                  recordingEnabled,
                  participantsCanUnmute,
                  participantsCanStartVideo,
                  participantsCanShareScreen,
                  speakers: getLocalized(event.speakersInfo as LocalizedField, locale) || undefined,
                  startsAt: event.startsAt,
                  endsAt: event.endsAt,
                }}
                registrationCount={event.registrationCount}
                adminMode
              />
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

          {/* ── Recording Management ── */}
          <RecordingManagement
            event={{
              id: event.id,
              slug: event.slug,
              status,
              recordingEnabled,
              recordingUrl: event.recordingUrl,
              tempRecordingUrl: event.tempRecordingUrl,
              tempRecordingStartedAt: event.tempRecordingStartedAt,
              recordingPublished: event.recordingPublished,
              recordingPublishedAt: event.recordingPublishedAt,
              recordingFileSize: event.recordingFileSize,
              recordingDuration: event.recordingDuration,
              recordingDeleteAfterDays: event.recordingDeleteAfterDays,
              moderatorToken: event.moderatorToken,
            }}
          />

          {/* ── Call Sessions ── */}
          <CallSessionsPanel
            eventId={event.id}
            eventSlug={event.slug}
            moderatorToken={event.moderatorToken}
          />

          {/* ── Post-event Configuration ── */}
          <PostEventConfig
            event={{
              id: event.id,
              moderatorToken: event.moderatorToken,
              postEventPublic: event.postEventPublic,
              postEventPublicUntil: event.postEventPublicUntil,
              postEventShowQA: event.postEventShowQA,
              postEventShowMaterials: event.postEventShowMaterials,
              postEventShowPolls: event.postEventShowPolls,
              postEventShowFeedback: event.postEventShowFeedback,
              feedbackEnabled: event.feedbackEnabled,
              dataRetentionDays: event.dataRetentionDays,
            }}
          />

          {/* ── Feedback Results ── */}
          {event.feedbackEnabled && status === 'ENDED' && (
            <EventFeedbackAdmin slug={event.slug} token={event.moderatorToken} />
          )}

          {/* ── Reminders Card ── */}
          <Card className="shadow-sm border-0 mb-4" style={CARD_STYLE}>
            <CardBody className="p-4">
              <SectionTitle>{tr('title')}</SectionTitle>

              {reminders.length > 0 && (
                <div className="d-flex flex-column gap-2 mb-3">
                  {reminders.map((r) => (
                    <div
                      key={r.id}
                      className="d-flex justify-content-between align-items-center border rounded px-3 py-2"
                    >
                      <div>
                        <span className="fw-semibold" style={{ fontSize: '0.9rem' }}>
                          {r.label}
                        </span>
                        {r.sentCount > 0 && (
                          <Badge color="success" pill className="ms-2" style={{ fontSize: '0.72rem' }}>
                            {tr('sentStatus', { count: r.sentCount })}
                          </Badge>
                        )}
                        {r.sentCount === 0 && (
                          <Badge color="" pill className="ms-2" style={{ fontSize: '0.72rem', backgroundColor: '#E9ECEF', color: '#5A768A' }}>
                            {tr('notSent')}
                          </Badge>
                        )}
                      </div>
                      <Button
                        color="danger"
                        outline
                        size="xs"
                        className="flex-shrink-0"
                        onClick={() => handleDeleteReminder(r.id)}
                      >
                        <Icon icon="it-close" size="xs" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {reminders.length < 5 && availablePresets.length > 0 && (
                <div className="d-flex gap-2 align-items-end">
                  <select
                    className="form-select form-select-sm"
                    value={selectedOffset}
                    onChange={(e) => setSelectedOffset(e.target.value)}
                    style={{ maxWidth: 240 }}
                  >
                    <option value="">{tr('selectPreset')}</option>
                    {availablePresets.map((p) => (
                      <option key={p.offsetMinutes} value={p.offsetMinutes}>
                        {locale === 'en' ? p.labelEn : p.labelIt}
                      </option>
                    ))}
                  </select>
                  <Button
                    color="primary"
                    outline
                    size="sm"
                    onClick={handleAddReminder}
                    disabled={!selectedOffset}
                  >
                    + {tr('addReminder')}
                  </Button>
                </div>
              )}

              {reminders.length >= 5 && (
                <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                  {tr('maxReminders')}
                </div>
              )}
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

          {/* ── Materials Card ── */}
          <Card className="shadow-sm border-0 mb-4" style={CARD_STYLE}>
            <CardBody className="p-4">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <div className="d-flex align-items-center gap-2">
                  <SectionTitle>{tm('title')}</SectionTitle>
                  <Badge color="primary" pill className="mb-3" style={{ fontSize: '0.78rem' }}>
                    {materials.length}
                  </Badge>
                </div>
                {!showMaterialForm && (
                  <Button color="primary" outline size="sm" onClick={() => setShowMaterialForm(true)}>
                    + {tm('addMaterial')}
                  </Button>
                )}
              </div>

              {showMaterialForm && (
                <form onSubmit={handleAddMaterial} className="border rounded p-3 mb-3">
                  <div className="mb-2">
                    <input
                      type="text"
                      className="form-control form-control-sm"
                      placeholder={tm('titleLabel')}
                      value={matTitle}
                      onChange={(e) => setMatTitle(e.target.value)}
                      maxLength={300}
                    />
                  </div>
                  <div className="mb-2">
                    <input
                      type="url"
                      className="form-control form-control-sm"
                      placeholder={tm('urlLabel')}
                      value={matUrl}
                      onChange={(e) => setMatUrl(e.target.value)}
                    />
                  </div>
                  <div className="mb-2">
                    <input
                      type="text"
                      className="form-control form-control-sm"
                      placeholder={tm('descriptionLabel')}
                      value={matDesc}
                      onChange={(e) => setMatDesc(e.target.value)}
                      maxLength={500}
                    />
                  </div>
                  {matError && <div className="text-danger small mb-2">{matError}</div>}
                  <div className="d-flex gap-2">
                    <Button color="primary" size="sm" type="submit" disabled={matSubmitting}>
                      {matSubmitting ? tm('adding') : tm('add')}
                    </Button>
                    <Button
                      color="secondary"
                      outline
                      size="sm"
                      type="button"
                      onClick={() => { setShowMaterialForm(false); setMatError(''); }}
                    >
                      {tm('cancel')}
                    </Button>
                  </div>
                </form>
              )}

              {materials.length === 0 ? (
                <div className="text-center py-3">
                  <p className="text-muted mb-0">{tm('noMaterials')}</p>
                </div>
              ) : (
                <div className="d-flex flex-column gap-2">
                  {materials.map((m) => (
                    <div key={m.id} className="d-flex justify-content-between align-items-start border rounded p-3">
                      <div style={{ minWidth: 0 }}>
                        <a
                          href={m.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="fw-semibold text-primary text-decoration-none d-inline-flex align-items-center gap-1"
                        >
                          <Icon icon="it-external-link" size="sm" />
                          {m.title}
                        </a>
                        {m.description && (
                          <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                            {m.description}
                          </div>
                        )}
                        <div className="text-muted" style={{ fontSize: '0.78rem' }}>
                          {tm('addedBy', { name: m.addedBy })} ·{' '}
                          {format.dateTime(new Date(m.createdAt), {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                      </div>
                      <Button
                        color="danger"
                        outline
                        size="xs"
                        className="flex-shrink-0 ms-2"
                        onClick={() => handleDeleteMaterial(m.id)}
                      >
                        <Icon icon="it-close" size="xs" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          {/* ── Registrations Card ── */}
          <Card className="shadow-sm border-0 mb-4" style={CARD_STYLE}>
            <CardBody className="p-4">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <div className="d-flex align-items-center gap-2">
                  <SectionTitle>{t('registrationsSection')}</SectionTitle>
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

      {/* ── GDPR Audit Log (collapsible) ── */}
      {event.gdprAuditLogs.length > 0 && (
        <Card className="shadow-sm border-0 mb-4" style={CARD_STYLE}>
          <CardBody className="p-4">
            <details>
              <summary className="fw-semibold mb-3" style={{ color: '#17324D', cursor: 'pointer' }}>
                {t('gdprAuditLog.title')} ({event.gdprAuditLogs.length})
              </summary>
              <Table responsive hover className="mt-3" style={{ fontSize: '0.85rem' }}>
                <thead>
                  <tr>
                    <th>{t('gdprAuditLog.date')}</th>
                    <th>{t('gdprAuditLog.action')}</th>
                    <th>{t('gdprAuditLog.recordCount')}</th>
                    <th>{t('gdprAuditLog.details')}</th>
                  </tr>
                </thead>
                <tbody>
                  {event.gdprAuditLogs.map((log) => (
                    <tr key={log.id}>
                      <td>{format.dateTime(new Date(log.createdAt), { dateStyle: 'short', timeStyle: 'short' })}</td>
                      <td>
                        <Badge
                          color=""
                          pill
                          style={{
                            fontSize: '0.72rem',
                            backgroundColor: log.action === 'DATA_DELETED' ? '#FFF3CD' : log.action === 'DATA_EXPORTED' ? '#D1ECF1' : '#D4EDDA',
                            color: log.action === 'DATA_DELETED' ? '#856404' : log.action === 'DATA_EXPORTED' ? '#0C5460' : '#155724',
                          }}
                        >
                          {t(`gdprAuditLog.actions.${log.action}`)}
                        </Badge>
                      </td>
                      <td>{log.recordCount}</td>
                      <td style={{ maxWidth: 200 }} className="text-truncate">
                        {log.details ? JSON.stringify(JSON.parse(log.details)) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </details>
          </CardBody>
        </Card>
      )}
    </>
  );
}

interface FeedbackEntry {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
}

interface FeedbackData {
  averageRating: number;
  totalCount: number;
  distribution: number[];
  feedback: FeedbackEntry[];
}

function EventFeedbackAdmin({
  slug,
  token,
}: {
  slug: string;
  token: string;
}) {
  const t = useTranslations('admin.feedbackAdmin');
  const [data, setData] = useState<FeedbackData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/events/${slug}/feedback?token=${token}`)
      .then((r) => r.ok ? r.json() : null)
      .then((json) => setData(json))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [slug, token]);

  if (loading) return null;
  if (!data || data.totalCount === 0) {
    return (
      <Card className="shadow-sm border-0 mb-4" style={CARD_STYLE}>
        <CardBody className="p-4">
          <SectionTitle>{t('title')}</SectionTitle>
          <p className="text-muted mb-0" style={{ fontSize: '0.9rem' }}>{t('noFeedback')}</p>
        </CardBody>
      </Card>
    );
  }

  const maxCount = Math.max(...data.distribution, 1);

  return (
    <Card className="shadow-sm border-0 mb-4" style={CARD_STYLE}>
      <CardBody className="p-4">
        <div className="d-flex justify-content-between align-items-start mb-4">
          <SectionTitle>{t('title')}</SectionTitle>
          <div className="text-end">
            <div className="fw-bold" style={{ fontSize: '1.6rem', color: '#17324D', lineHeight: 1 }}>
              {data.averageRating.toFixed(1)}
              <span className="text-warning ms-1">★</span>
            </div>
            <div className="text-muted" style={{ fontSize: '0.82rem' }}>
              {t('totalVotes', { count: data.totalCount })}
            </div>
          </div>
        </div>

        {/* Star distribution bars */}
        <div className="mb-4">
          {[5, 4, 3, 2, 1].map((star) => {
            const count = data.distribution[star - 1] ?? 0;
            const pct = Math.round((count / maxCount) * 100);
            return (
              <div key={star} className="d-flex align-items-center gap-2 mb-1" style={{ fontSize: '0.82rem' }}>
                <span className="text-muted flex-shrink-0" style={{ width: 24, textAlign: 'right' }}>{star}★</span>
                <div className="flex-grow-1 bg-light rounded" style={{ height: 8 }}>
                  <div
                    className="rounded"
                    style={{
                      width: `${pct}%`,
                      height: '100%',
                      backgroundColor: star >= 4 ? '#008758' : star === 3 ? '#A66300' : '#CC334D',
                      minWidth: count > 0 ? 4 : 0,
                    }}
                  />
                </div>
                <span className="text-muted flex-shrink-0" style={{ width: 20 }}>{count}</span>
              </div>
            );
          })}
        </div>

        {/* Comments */}
        {data.feedback.some((f) => f.comment) && (
          <>
            <div className="fw-semibold mb-2" style={{ fontSize: '0.88rem', color: '#17324D' }}>
              {t('comments')}
            </div>
            <div className="d-flex flex-column gap-2">
              {data.feedback
                .filter((f) => f.comment)
                .map((f) => (
                  <div
                    key={f.id}
                    className="p-3 rounded"
                    style={{ backgroundColor: '#F5F7FB', fontSize: '0.88rem' }}
                  >
                    <div className="d-flex justify-content-between align-items-center mb-1">
                      <span className="text-warning">{'★'.repeat(f.rating)}{'☆'.repeat(5 - f.rating)}</span>
                    </div>
                    <p className="mb-0" style={{ color: '#17324D' }}>{f.comment}</p>
                  </div>
                ))}
            </div>
          </>
        )}
      </CardBody>
    </Card>
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
        <ToggleSwitch
          label=""
          checked={checked}
          onChange={onChange}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
