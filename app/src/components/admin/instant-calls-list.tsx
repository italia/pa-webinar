'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations, useFormatter } from 'next-intl';
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
  lastActiveAt: string | null;
  endsAt: string;
  moderatorName: string | null;
  moderatorToken: string;
  peakParticipants: number;
  recordingUrl: string | null;
  recordingDuration: number | null;
  recordingFileSize: string | null;
  callSessionsCount: number;
  registrationsCount: number;
}

type StatusFilter = 'all' | 'LIVE' | 'IDLE' | 'ENDED' | 'ARCHIVED';
type HasRecFilter = 'any' | 'yes' | 'no';

interface Filters {
  q: string;
  from: string;
  to: string;
  status: StatusFilter;
  hasRec: HasRecFilter;
}

const DEBOUNCE_MS = 350;

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

function StatusBadge({
  status,
  lastActiveAt,
  idleGraceMinutes,
  t,
}: {
  status: string;
  lastActiveAt: string | null;
  idleGraceMinutes: number;
  t: ReturnType<typeof useTranslations>;
}) {
  if (status === 'LIVE') {
    return (
      <Badge color="danger" pill className="px-2 py-1" style={{ fontSize: '0.7rem' }}>
        <span
          className="d-inline-block me-1"
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: '#fff',
            animation: 'pulse 1.5s ease-in-out infinite',
          }}
        />
        LIVE
      </Badge>
    );
  }
  if (status === 'IDLE') {
    const idleSince = lastActiveAt ? new Date(lastActiveAt) : null;
    const idleMin = idleSince
      ? Math.floor((Date.now() - idleSince.getTime()) / 60000)
      : null;
    const title =
      idleMin !== null
        ? t('status.idleTooltip', {
            idle: idleMin,
            grace: idleGraceMinutes,
          })
        : t('status.idle');
    return (
      <Badge
        color="warning"
        pill
        className="px-2 py-1"
        style={{ fontSize: '0.7rem' }}
        title={title}
      >
        <Icon icon="it-pause" size="xs" className="me-1" color="white" />
        {t('status.idle')}
      </Badge>
    );
  }
  if (status === 'ENDED') {
    return (
      <Badge color="secondary" pill className="px-2 py-1" style={{ fontSize: '0.7rem' }}>
        {t('status.ended')}
      </Badge>
    );
  }
  if (status === 'ARCHIVED') {
    return (
      <Badge color="light" pill className="px-2 py-1 text-muted" style={{ fontSize: '0.7rem' }}>
        {t('status.archived')}
      </Badge>
    );
  }
  return (
    <Badge color="info" pill className="px-2 py-1" style={{ fontSize: '0.7rem' }}>
      {status}
    </Badge>
  );
}

export default function InstantCallsList({
  locale: _locale,
  idleGraceMinutes,
}: {
  locale: string;
  idleGraceMinutes: number;
}) {
  const t = useTranslations('admin.instantCalls');
  const tc = useTranslations('common');
  const fmt = useFormatter();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState<Filters>(() => ({
    q: searchParams.get('q') ?? '',
    from: searchParams.get('from') ?? '',
    to: searchParams.get('to') ?? '',
    status: (searchParams.get('status') as StatusFilter) || 'all',
    hasRec: (searchParams.get('hasRec') as HasRecFilter) || 'any',
  }));

  const [rows, setRows] = useState<InstantCallRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newModerator, setNewModerator] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Debounced fetch: whenever a filter changes, wait DEBOUNCE_MS then
  // re-query the backend and reflect the current filter state in the URL.
  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.status !== 'all') params.set('status', filters.status);
    if (filters.hasRec !== 'any') params.set('hasRec', filters.hasRec);

    const handle = setTimeout(() => {
      const qs = params.toString();
      // Update URL so filters are shareable and survive navigation.
      window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
      setLoading(true);
      fetch(`/api/admin/events/instant${qs ? `?${qs}` : ''}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((data) => {
          setRows(data.rows);
          setTotal(data.total);
        })
        .catch(() => {
          setRows([]);
          setTotal(0);
        })
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);

    return () => clearTimeout(handle);
  }, [filters]);

  const refresh = useCallback(() => {
    setFilters((f) => ({ ...f }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters({ q: '', from: '', to: '', status: 'all', hasRec: 'any' });
  }, []);

  const hasActiveFilters =
    filters.q !== '' ||
    filters.from !== '' ||
    filters.to !== '' ||
    filters.status !== 'all' ||
    filters.hasRec !== 'any';

  const allSelected = rows.length > 0 && selected.size === rows.length;
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
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((c) => c.id))));
  }, [rows]);

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
      const data = (await res.json()) as { id: string; moderatorToken: string };
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
      refresh();
    } finally {
      setSubmitting(false);
    }
  }, [selected, tc, refresh]);

  const selectedCount = useMemo(() => selected.size, [selected]);

  return (
    <>
      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        .hero-cta {
          background: linear-gradient(135deg, #0066cc 0%, #004080 100%);
          border-radius: 12px;
          color: #fff;
          padding: 24px 28px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 24px;
          box-shadow: 0 4px 16px rgba(0, 102, 204, 0.15);
        }
        .hero-cta__text h2 {
          color: #fff;
          font-size: 1.35rem;
          margin: 0 0 4px 0;
          font-weight: 600;
        }
        .hero-cta__text p {
          color: rgba(255, 255, 255, 0.85);
          margin: 0;
          font-size: 0.9rem;
        }
        .hero-cta__icon {
          width: 56px;
          height: 56px;
          background: rgba(255, 255, 255, 0.15);
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .hero-cta__action {
          background: #fff;
          color: #0066cc;
          border: none;
          padding: 12px 24px;
          border-radius: 8px;
          font-weight: 600;
          cursor: pointer;
          transition: transform 0.15s, box-shadow 0.15s;
          white-space: nowrap;
        }
        .hero-cta__action:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }
      `}</style>

      <div className="hero-cta">
        <div className="d-flex align-items-center gap-3 flex-grow-1">
          <div className="hero-cta__icon">
            <Icon icon="it-video" size="lg" color="white" />
          </div>
          <div className="hero-cta__text">
            <h2>{t('hero.title')}</h2>
            <p>{t('hero.subtitle')}</p>
          </div>
        </div>
        <button className="hero-cta__action" onClick={() => setCreateOpen(true)}>
          <Icon icon="it-plus" size="xs" className="me-2" color="primary" />
          {t('createNew')}
        </button>
      </div>

      <Card className="border-0 shadow-sm mb-3">
        <CardBody className="p-3">
          <div className="row g-2 align-items-end">
            <div className="col-md-4">
              <label className="form-label small text-muted mb-1">{t('filters.search')}</label>
              <div className="position-relative">
                <Input
                  type="text"
                  value={filters.q}
                  onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
                  placeholder={t('filters.searchPlaceholder')}
                />
              </div>
            </div>
            <div className="col-md-2">
              <label className="form-label small text-muted mb-1">{t('filters.from')}</label>
              <Input
                type="date"
                value={filters.from}
                onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
              />
            </div>
            <div className="col-md-2">
              <label className="form-label small text-muted mb-1">{t('filters.to')}</label>
              <Input
                type="date"
                value={filters.to}
                onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
              />
            </div>
            <div className="col-md-2">
              <label className="form-label small text-muted mb-1">{t('filters.status')}</label>
              <select
                className="form-select"
                value={filters.status}
                onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as StatusFilter }))}
              >
                <option value="all">{t('filters.statusAll')}</option>
                <option value="LIVE">{t('status.live')}</option>
                <option value="IDLE">{t('status.idle')}</option>
                <option value="ENDED">{t('status.ended')}</option>
                <option value="ARCHIVED">{t('status.archived')}</option>
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label small text-muted mb-1">{t('filters.recording')}</label>
              <select
                className="form-select"
                value={filters.hasRec}
                onChange={(e) => setFilters((f) => ({ ...f, hasRec: e.target.value as HasRecFilter }))}
              >
                <option value="any">{t('filters.recAny')}</option>
                <option value="yes">{t('filters.recYes')}</option>
                <option value="no">{t('filters.recNo')}</option>
              </select>
            </div>
          </div>
          {hasActiveFilters && (
            <div className="d-flex justify-content-end mt-2">
              <Button color="secondary" outline size="xs" onClick={resetFilters}>
                <Icon icon="it-close" size="xs" className="me-1" />
                {t('filters.reset')}
              </Button>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <div className="d-flex align-items-center gap-2">
          {rows.length > 0 && (
            <Button color="primary" outline size="xs" onClick={toggleAll} aria-pressed={allSelected}>
              <Icon icon={allSelected ? 'it-check-circle' : 'it-check'} size="xs" className="me-1" />
              {allSelected ? t('deselectAll') : t('selectAll')}
            </Button>
          )}
          {someSelected && (
            <>
              <span className="text-muted small">
                {selectedCount} {t('selected')}
              </span>
              <Button color="danger" outline size="xs" onClick={() => setDeleteOpen(true)}>
                <Icon icon="it-delete" size="xs" className="me-1" />
                {t('deleteSelected')}
              </Button>
            </>
          )}
        </div>
        <span className="text-muted small">
          {loading ? tc('loading') : `${total} ${t('total')}`}
        </span>
      </div>

      {!loading && rows.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardBody className="p-5 text-center">
            <Icon icon="it-video" size="xl" className="text-muted mb-3" />
            <p className="text-muted mb-0">
              {hasActiveFilters ? t('noResults') : t('noCalls')}
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="d-flex flex-column gap-3">
          {rows.map((call) => {
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
                          <div className="d-flex align-items-center gap-2 mb-1 flex-wrap">
                            <Icon icon="it-video" size="sm" className="text-primary" />
                            <span className="fw-semibold" style={{ color: '#17324D' }}>
                              {call.title}
                            </span>
                            <StatusBadge
                              status={call.status}
                              lastActiveAt={call.lastActiveAt}
                              idleGraceMinutes={idleGraceMinutes}
                              t={t}
                            />
                            {hasRecording && (
                              <Badge color="success" pill className="px-2 py-1" style={{ fontSize: '0.7rem' }}>
                                <Icon icon="it-video" size="xs" className="me-1" color="white" />
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
                              {fmt.dateTime(new Date(call.createdAt), {
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
          <Input
            id="instant-call-title"
            type="text"
            label={`${t('form.titleLabel')} *`}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            maxLength={120}
            disabled={submitting}
            autoFocus
          />
          <Input
            id="instant-call-moderator"
            type="text"
            label={t('form.moderatorLabel')}
            value={newModerator}
            onChange={(e) => setNewModerator(e.target.value)}
            maxLength={100}
            disabled={submitting}
          />
          {error && <div className="text-danger small">{error}</div>}
        </ModalBody>
        <ModalFooter>
          <Button color="secondary" outline onClick={() => setCreateOpen(false)} disabled={submitting}>
            {tc('cancel')}
          </Button>
          <Button
            color="primary"
            onClick={handleCreate}
            disabled={submitting || newTitle.trim().length < 2}
          >
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
