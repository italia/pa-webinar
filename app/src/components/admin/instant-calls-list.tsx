'use client';

import { useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Badge,
  Button,
  Card,
  CardBody,
  Icon,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from 'design-react-kit';

import { Link } from '@/i18n/navigation';

interface InstantCallRow {
  id: string;
  slug: string;
  title: string;
  status: string;
  createdAt: string;
  moderatorName: string | null;
  moderatorToken: string;
  peakParticipants: number;
  recordingUrl: string | null;
  recordingDuration: number | null;
  recordingFileSize: string | null;
  callSessionsCount: number;
  registrationsCount: number;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatSize(bytesStr: string | null): string {
  if (!bytesStr) return '—';
  const n = Number(bytesStr);
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(0)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
}

export default function InstantCallsList({
  calls,
  locale,
}: {
  calls: InstantCallRow[];
  locale: string;
}) {
  const t = useTranslations('admin.instantCalls');
  const tc = useTranslations('common');
  const router = useRouter();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newModerator, setNewModerator] = useState('');
  const [error, setError] = useState<string | null>(null);

  const allSelected = calls.length > 0 && selected.size === calls.length;
  const someSelected = selected.size > 0;

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => (prev.size === calls.length ? new Set() : new Set(calls.map((c) => c.id))));
  }, [calls]);

  const handleCreate = useCallback(async () => {
    const title = newTitle.trim();
    if (title.length < 2) {
      setError(t('titleTooShort'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/events/instant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: { it: title, en: title },
          moderatorName: newModerator.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error?.message ?? tc('errorGeneric'));
        return;
      }
      const data = (await res.json()) as {
        id: string;
        slug: string;
        moderatorToken: string;
      };
      setCreateOpen(false);
      setNewTitle('');
      setNewModerator('');
      router.push(`/admin/events/${data.id}?token=${data.moderatorToken}`);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }, [newTitle, newModerator, t, tc, router]);

  const handleBulkDelete = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/events/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error?.message ?? tc('errorGeneric'));
        return;
      }
      setDeleteOpen(false);
      setSelected(new Set());
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }, [selected, tc, router]);

  const selectedCount = useMemo(() => selected.size, [selected]);

  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <div className="d-flex align-items-center gap-2">
          {calls.length > 0 && (
            <Button
              color="primary"
              outline
              size="xs"
              onClick={toggleAll}
              aria-pressed={allSelected}
            >
              <Icon icon={allSelected ? 'it-check-circle' : 'it-check'} size="xs" className="me-1" />
              {allSelected ? t('deselectAll') : t('selectAll')}
            </Button>
          )}
          {someSelected && (
            <>
              <span className="text-muted small">
                {selectedCount} {t('selected')}
              </span>
              <Button
                color="danger"
                outline
                size="xs"
                onClick={() => setDeleteOpen(true)}
              >
                <Icon icon="it-delete" size="xs" className="me-1" />
                {t('deleteSelected')}
              </Button>
            </>
          )}
        </div>
        <div className="d-flex align-items-center gap-2">
          <span
            className="badge bg-primary rounded-pill px-3 py-2"
            style={{ fontSize: '0.9rem' }}
          >
            {calls.length} {t('total')}
          </span>
          <Button color="primary" onClick={() => setCreateOpen(true)}>
            <Icon icon="it-plus" size="xs" className="me-1" color="white" />
            {t('createNew')}
          </Button>
        </div>
      </div>

      {calls.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardBody className="p-5 text-center">
            <Icon icon="it-video" size="xl" className="text-muted mb-3" />
            <p className="text-muted">{t('noCalls')}</p>
          </CardBody>
        </Card>
      ) : (
        <div className="d-flex flex-column gap-3">
          {calls.map((call) => {
            const isLive = call.status === 'LIVE';
            const hasRecording = !!call.recordingUrl;
            const isSelected = selected.has(call.id);

            return (
              <Card
                key={call.id}
                className="border-0 shadow-sm"
                style={{
                  borderRadius: 8,
                  transition: 'box-shadow 0.15s',
                  outline: isSelected ? '2px solid #0066CC' : 'none',
                }}
              >
                <CardBody className="p-3">
                  <div className="d-flex align-items-start gap-3">
                    <div className="form-check pt-1" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="form-check-input"
                        checked={isSelected}
                        onChange={() => toggleOne(call.id)}
                        aria-label={t('selectRow')}
                      />
                    </div>
                    <Link
                      href={`/admin/events/${call.id}?token=${call.moderatorToken}`}
                      className="text-decoration-none flex-grow-1"
                    >
                      <div className="d-flex justify-content-between align-items-start">
                        <div className="flex-grow-1">
                          <div className="d-flex align-items-center gap-2 mb-1">
                            <Icon icon="it-video" size="sm" className="text-primary" />
                            <span className="fw-semibold" style={{ color: '#17324D' }}>
                              {call.title}
                            </span>
                            {isLive && (
                              <Badge color="danger" pill className="px-2 py-1" style={{ fontSize: '0.7rem' }}>
                                LIVE
                              </Badge>
                            )}
                            {hasRecording && (
                              <Badge color="success" pill className="px-2 py-1" style={{ fontSize: '0.7rem' }}>
                                <Icon icon="it-video" size="xs" className="me-1" />
                                REC
                              </Badge>
                            )}
                          </div>
                          <div className="d-flex gap-3 text-muted flex-wrap" style={{ fontSize: '0.82rem' }}>
                            {call.moderatorName && (
                              <span>
                                <Icon icon="it-user" size="xs" className="me-1" />
                                {call.moderatorName}
                              </span>
                            )}
                            <span>
                              <Icon icon="it-calendar" size="xs" className="me-1" />
                              {new Date(call.createdAt).toLocaleDateString(locale, {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                            <span>
                              <Icon icon="it-team-digitale" size="xs" className="me-1" />
                              {call.peakParticipants} {t('participants')}
                            </span>
                            {call.recordingDuration && (
                              <span>
                                <Icon icon="it-clock" size="xs" className="me-1" />
                                {formatDuration(call.recordingDuration)}
                              </span>
                            )}
                            {call.recordingFileSize && (
                              <span>{formatSize(call.recordingFileSize)}</span>
                            )}
                            {call.callSessionsCount > 0 && (
                              <span>
                                {call.callSessionsCount} {t('sessions')}
                              </span>
                            )}
                          </div>
                        </div>
                        <Icon icon="it-arrow-right" size="sm" className="text-muted mt-1" />
                      </div>
                    </Link>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      <Modal isOpen={createOpen} toggle={() => !submitting && setCreateOpen(false)} centered>
        <ModalHeader toggle={() => !submitting && setCreateOpen(false)}>
          {t('createNew')}
        </ModalHeader>
        <ModalBody>
          <div className="form-group">
            <label htmlFor="instant-call-title" className="form-label">
              {t('form.titleLabel')} *
            </label>
            <Input
              id="instant-call-title"
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              maxLength={120}
              disabled={submitting}
              autoFocus
            />
          </div>
          <div className="form-group">
            <label htmlFor="instant-call-moderator" className="form-label">
              {t('form.moderatorLabel')}
            </label>
            <Input
              id="instant-call-moderator"
              type="text"
              value={newModerator}
              onChange={(e) => setNewModerator(e.target.value)}
              maxLength={100}
              disabled={submitting}
            />
          </div>
          {error && <div className="text-danger small">{error}</div>}
        </ModalBody>
        <ModalFooter>
          <Button color="secondary" outline onClick={() => setCreateOpen(false)} disabled={submitting}>
            {tc('cancel')}
          </Button>
          <Button color="primary" onClick={handleCreate} disabled={submitting || newTitle.trim().length < 2}>
            {submitting ? tc('loading') : t('createAndJoin')}
          </Button>
        </ModalFooter>
      </Modal>

      <Modal isOpen={deleteOpen} toggle={() => !submitting && setDeleteOpen(false)} centered>
        <ModalHeader toggle={() => !submitting && setDeleteOpen(false)}>
          {t('deleteSelected')}
        </ModalHeader>
        <ModalBody>
          <p>{t('deleteConfirm', { count: selectedCount })}</p>
          {error && <div className="text-danger small">{error}</div>}
        </ModalBody>
        <ModalFooter>
          <Button color="secondary" outline onClick={() => setDeleteOpen(false)} disabled={submitting}>
            {tc('cancel')}
          </Button>
          <Button color="danger" onClick={handleBulkDelete} disabled={submitting}>
            {submitting ? tc('loading') : tc('delete')}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
