'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  Icon,
} from 'design-react-kit';

import ToggleSwitch from '@/components/ui/toggle-switch';
import { useRouter, Link } from '@/i18n/navigation';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import RecordingUploadWidget from './recording-upload-widget';

interface RecordingManagementProps {
  event: {
    id: string;
    slug: string;
    status: string;
    recordingEnabled: boolean;
    recordingUrl: string | null;
    tempRecordingUrl: string | null;
    tempRecordingStartedAt: string | null;
    recordingPublished: boolean;
    recordingPublishedAt: string | null;
    recordingFileSize: number | null;
    recordingDuration: number | null;
    recordingDeleteAfterDays: number | null;
    moderatorToken: string;
  };
  jibriAvailable?: boolean;
}

const RETENTION_OPTIONS = [
  { value: 1, labelKey: 'retention.24h' },
  { value: 7, labelKey: 'retention.7d' },
  { value: 30, labelKey: 'retention.30d' },
  { value: 90, labelKey: 'retention.90d' },
  { value: -1, labelKey: 'retention.forever' },
] as const;

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export default function RecordingManagement({
  event,
  jibriAvailable = true,
}: RecordingManagementProps) {
  const t = useTranslations('recording');
  const toast = useToast();
  const confirm = useConfirm();
  const fmt = useFormatter();
  const router = useRouter();

  const [published, setPublished] = useState(event.recordingPublished);
  const [retentionDays, setRetentionDays] = useState<number | null>(event.recordingDeleteAfterDays);
  const [saving, setSaving] = useState(false);
  const [liveElapsed, setLiveElapsed] = useState('');
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const hasRecording = !!(event.recordingUrl || event.tempRecordingUrl);
  const isLive = event.status === 'LIVE';

  useEffect(() => {
    if (!isLive || !event.tempRecordingStartedAt) return;
    const startMs = new Date(event.tempRecordingStartedAt).getTime();
    function tick() {
      const elapsed = Math.floor((Date.now() - startMs) / 1000);
      setLiveElapsed(formatDuration(Math.max(0, elapsed)));
    }
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isLive, event.tempRecordingStartedAt]);

  const updateField = useCallback(
    async (data: Record<string, unknown>) => {
      setSaving(true);
      try {
        await fetch(`/api/events/${event.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${event.moderatorToken}`,
          },
          body: JSON.stringify(data),
        });
      } finally {
        setSaving(false);
      }
    },
    [event.id, event.moderatorToken],
  );

  const handleTogglePublish = useCallback(async () => {
    const next = !published;
    setPublished(next);
    await updateField({ recordingPublished: next });
  }, [published, updateField]);

  const handleRetentionChange = useCallback(
    async (days: number) => {
      const val = days === -1 ? null : days;
      setRetentionDays(val);
      await updateField({ recordingDeleteAfterDays: val });
    },
    [updateField],
  );

  const handleDelete = useCallback(async () => {
    const ok = await confirm({
      title: t('deleteConfirmTitle'),
      message: t('deleteConfirm'),
      confirmLabel: t('delete'),
      danger: true,
    });
    if (!ok) return;
    const r = await fetch(`/api/events/${event.slug}/recording`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${event.moderatorToken}` },
    });
    if (!r.ok) {
      toast.error(t('deleteFailed'));
      return;
    }
    toast.success(t('deleteSuccess'));
    router.refresh();
  }, [event.slug, event.moderatorToken, t, router, confirm, toast]);

  if (!event.recordingEnabled && !hasRecording) {
    return (
      <Card className="shadow-sm border-0 mb-4" style={{ borderRadius: 8, border: '1px solid #e8e8e8' }}>
        <CardBody className="p-4">
          <h5 className="fw-semibold mb-3" style={{ color: '#17324D' }}>
            {t('management')}
          </h5>
          <div className="text-muted mb-3" style={{ fontSize: '0.9rem' }}>
            {t('disabledHint')}
          </div>
          <RecordingUploadWidget eventId={event.id} />
        </CardBody>
      </Card>
    );
  }

  if (!jibriAvailable && !hasRecording) {
    return (
      <Card className="shadow-sm border-0 mb-4" style={{ borderRadius: 8, border: '1px solid #e8e8e8' }}>
        <CardBody className="p-4">
          <h5 className="fw-semibold mb-3" style={{ color: '#17324D' }}>
            {t('management')}
          </h5>
          <Alert color="warning" className="mb-0">
            {t('notConfigured')}
          </Alert>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm border-0 mb-4" style={{ borderRadius: 8, border: '1px solid #e8e8e8' }}>
      <CardBody className="p-4">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h5 className="fw-semibold mb-0" style={{ color: '#17324D' }}>
            {t('management')}
          </h5>
          {isLive && event.tempRecordingStartedAt && (
            <Badge color="danger" pill className="px-2 py-1">
              <span className="me-1" style={{ animation: 'pulse-dot 1.5s ease-in-out infinite' }}>●</span>
              {t('inProgress')}
            </Badge>
          )}
        </div>

        {/* Live recording in progress */}
        {isLive && event.tempRecordingStartedAt && (
          <div className="mb-3 p-3 rounded" style={{ background: '#FFF3CD' }}>
            <div className="d-flex justify-content-between align-items-center">
              <div>
                <div className="fw-semibold" style={{ fontSize: '0.9rem' }}>
                  {t('duration')}: <span className="font-monospace">{liveElapsed}</span>
                </div>
                <div className="text-muted" style={{ fontSize: '0.82rem' }}>
                  {t('startedAt')}: {fmt.dateTime(new Date(event.tempRecordingStartedAt), { hour: '2-digit', minute: '2-digit', second: '2-digit' })} ({t('automatic')})
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Recording available (post-event) */}
        {!isLive && hasRecording && (
          <>
            <Alert color="success" className="py-2 px-3 mb-3">
              <div className="d-flex align-items-center">
                <Icon icon="it-video" className="me-2" />
                <span className="fw-semibold">{t('available')}</span>
              </div>
            </Alert>

            {event.recordingDuration && (
              <div className="text-muted mb-1" style={{ fontSize: '0.85rem' }}>
                {t('duration')}: {formatDuration(event.recordingDuration)}
              </div>
            )}
            {event.recordingFileSize && (
              <div className="text-muted mb-1" style={{ fontSize: '0.85rem' }}>
                {t('fileSize')}: {formatFileSize(event.recordingFileSize)}
              </div>
            )}
            {event.recordingUrl && (
              <div
                className="mb-3 mt-2"
                style={{
                  background: '#f5f7fb',
                  padding: 8,
                  borderRadius: 4,
                  wordBreak: 'break-all',
                  fontSize: 12,
                  fontFamily: "'Roboto Mono', monospace",
                }}
              >
                {event.recordingUrl}
              </div>
            )}

            {/* Publish toggle */}
            <div className="border rounded p-3 mb-3">
              <div className="d-flex justify-content-between align-items-start">
                <div className="me-3">
                  <div className="fw-semibold" style={{ color: '#17324D' }}>
                    {t('publish')}
                  </div>
                  <div className="text-secondary" style={{ fontSize: '0.85rem' }}>
                    {t('publishDesc')}
                  </div>
                </div>
                <ToggleSwitch
                  label=""
                  checked={published}
                  onChange={handleTogglePublish}
                  disabled={saving}
                />
              </div>
            </div>

            {/* Retention options */}
            <div className="border rounded p-3 mb-3">
              <div className="fw-semibold mb-2" style={{ color: '#17324D' }}>
                {t('retentionLabel')}
              </div>
              <div className="d-flex flex-column gap-1">
                {RETENTION_OPTIONS.map(({ value, labelKey }) => (
                  <label key={value} className="d-flex align-items-center gap-2" style={{ cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="retention"
                      checked={value === -1 ? retentionDays === null : retentionDays === value}
                      onChange={() => handleRetentionChange(value)}
                      disabled={saving}
                    />
                    <span style={{ fontSize: '0.88rem' }}>{t(labelKey)}</span>
                  </label>
                ))}
              </div>
              <div className="text-muted mt-2" style={{ fontSize: '0.8rem' }}>
                {t('retentionNote')}
              </div>
            </div>

            {/* Action buttons */}
            <div className="d-flex align-items-center gap-3 flex-wrap">
              {event.recordingUrl && (
                <>
                  <a
                    href={event.recordingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-primary btn-sm d-inline-flex align-items-center gap-1"
                  >
                    <Icon icon="it-video" size="sm" color="white" />
                    {t('play')}
                  </a>
                  <a
                    href={event.recordingUrl}
                    download
                    className="btn btn-outline-primary btn-sm d-inline-flex align-items-center gap-1"
                  >
                    <Icon icon="it-download" size="sm" />
                    {t('download')}
                  </a>
                  {/* Apre la gestione post-produzione (trascrizione, speaker,
                      traduzione, editor) per questo evento. */}
                  <Link
                    href={`/admin/postprod?eventId=${event.id}`}
                    className="btn btn-outline-secondary btn-sm d-inline-flex align-items-center gap-1"
                  >
                    <Icon icon="it-comment" size="sm" />
                    {t('transcriptManage')}
                  </Link>
                </>
              )}
              <Button
                color="danger"
                outline
                size="sm"
                className="d-inline-flex align-items-center gap-1"
                onClick={handleDelete}
              >
                <Icon icon="it-delete" size="sm" />
                {t('delete')}
              </Button>
            </div>
          </>
        )}

        {/* Replace the existing recording with a different MP4 —
            useful after editing the Jibri output offline or swapping
            for a MsTeams export. Hidden while a live recording is
            running to avoid racing against Jibri's own upload. */}
        {!isLive && (
          <RecordingUploadWidget eventId={event.id} compact />
        )}
      </CardBody>
    </Card>
  );
}
