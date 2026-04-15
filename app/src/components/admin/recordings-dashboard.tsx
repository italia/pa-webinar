'use client';

/**
 * Admin cross-event recordings library.
 *
 * Lists both CallSession artifacts and published Event recordings so
 * an admin has a single place to find, download or delete any video
 * file the platform has ever produced.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import { Badge, Button, Card, CardBody, Icon, Input, Label } from 'design-react-kit';

import { Link } from '@/i18n/navigation';

interface OrphanRow {
  id: string;
  blobName: string;
  sizeBytes: string | null;
  lastModified: string | null;
  discoveredAt: string;
  lastSeenAt: string;
  decision: string;
  note: string | null;
  deletesAt: string | null;
}

interface OrphanResponse {
  rows: OrphanRow[];
  total: number;
  totalBytes: string;
  graceDays: number;
}

interface EventOption {
  id: string;
  slug: string;
  title: string;
  startsAt: string;
  eventType: string;
}

interface RecordingRow {
  id: string;
  source: 'event' | 'session';
  eventId: string;
  eventTitle: string;
  eventSlug: string;
  eventType: string;
  eventStartsAt: string;
  startedAt: string;
  durationSeconds: number | null;
  peakParticipants: number;
  recordingUrl: string | null;
  recordingFilename: string | null;
  recordingFileSize: string | null;
}

interface ApiResponse {
  rows: RecordingRow[];
  total: number;
  stats: {
    withRecording: number;
    totalBytes: string;
    totalDurationSeconds: number;
  };
  since: string;
  until: string;
}

type Range = '7d' | '30d' | '90d' | 'all';

function rangeSince(r: Range): Date {
  const now = Date.now();
  switch (r) {
    case '7d': return new Date(now - 7 * 86400_000);
    case '30d': return new Date(now - 30 * 86400_000);
    case '90d': return new Date(now - 90 * 86400_000);
    case 'all': return new Date(0);
  }
}

function fmtSize(bytes: string | null): string {
  if (!bytes) return '—';
  const n = Number(bytes);
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(2)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(0)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

function fmtDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.round(seconds)}s`;
}

type Tab = 'library' | 'orphans';

export default function RecordingsDashboard({
  events,
  locale,
}: {
  events: EventOption[];
  locale: string;
}) {
  const t = useTranslations('admin.recordingsLibrary');
  const tc = useTranslations('common');
  const fmt = useFormatter();

  const [tab, setTab] = useState<Tab>('library');
  const [orphanData, setOrphanData] = useState<OrphanResponse | null>(null);
  const [orphanLoading, setOrphanLoading] = useState(false);
  const [orphanSelected, setOrphanSelected] = useState<Set<string>>(new Set());
  const [orphanSubmitting, setOrphanSubmitting] = useState(false);

  // Track which row currently has the inline HTML5 player expanded.
  // Only one row can be open at a time: opening a new one auto-closes
  // the previous player so we don't end up streaming two recordings
  // from the same tab.
  const [playingId, setPlayingId] = useState<string | null>(null);

  const [range, setRange] = useState<Range>('90d');
  const [eventId, setEventId] = useState('');
  const [hasRecording, setHasRecording] = useState<'yes' | 'no' | 'any'>('yes');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildQuery = useCallback((csv = false) => {
    const p = new URLSearchParams();
    p.set('since', rangeSince(range).toISOString());
    p.set('hasRecording', hasRecording);
    if (eventId) p.set('eventId', eventId);
    if (csv) p.set('format', 'csv');
    return p.toString();
  }, [range, hasRecording, eventId]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/recordings?${buildQuery()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json() as ApiResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch error');
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fetchOrphans = useCallback(async () => {
    setOrphanLoading(true);
    try {
      const res = await fetch('/api/admin/recordings/orphans', { cache: 'no-store' });
      if (res.ok) setOrphanData((await res.json()) as OrphanResponse);
    } finally {
      setOrphanLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'orphans') fetchOrphans();
  }, [tab, fetchOrphans]);

  const toggleOrphan = useCallback((id: string) => {
    setOrphanSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const orphanBulkDecision = useCallback(
    async (decision: 'ignore' | 'delete-now' | 'pending') => {
      if (orphanSelected.size === 0) return;
      setOrphanSubmitting(true);
      try {
        const res = await fetch('/api/admin/recordings/orphans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ids: Array.from(orphanSelected),
            decision,
          }),
        });
        if (res.ok) {
          setOrphanSelected(new Set());
          fetchOrphans();
        }
      } finally {
        setOrphanSubmitting(false);
      }
    },
    [orphanSelected, fetchOrphans],
  );

  const orphanCountPending = useMemo(
    () => orphanData?.rows.filter((r) => r.decision === 'pending').length ?? 0,
    [orphanData],
  );

  const exportCsv = () => {
    window.location.href = `/api/admin/recordings?${buildQuery(true)}`;
  };

  const visibleRows = data
    ? data.rows.filter((r) => {
        const q = search.trim().toLowerCase();
        if (!q) return true;
        return r.eventTitle.toLowerCase().includes(q)
          || (r.recordingFilename ?? '').toLowerCase().includes(q);
      })
    : [];

  return (
    <div>
      <ul className="nav nav-tabs mb-4">
        <li className="nav-item">
          <button
            type="button"
            className={`nav-link ${tab === 'library' ? 'active' : ''}`}
            onClick={() => setTab('library')}
          >
            <Icon icon="it-video" size="sm" className="me-1" />
            {t('tabs.library')}
          </button>
        </li>
        <li className="nav-item">
          <button
            type="button"
            className={`nav-link ${tab === 'orphans' ? 'active' : ''}`}
            onClick={() => setTab('orphans')}
          >
            <Icon icon="it-warning-circle" size="sm" className="me-1" />
            {t('tabs.orphans')}
            {orphanCountPending > 0 && (
              <Badge color="warning" className="ms-2" style={{ fontSize: '0.65rem' }}>
                {orphanCountPending}
              </Badge>
            )}
          </button>
        </li>
      </ul>

      {tab === 'orphans' ? (
        <OrphansView
          data={orphanData}
          loading={orphanLoading}
          selected={orphanSelected}
          submitting={orphanSubmitting}
          onToggle={toggleOrphan}
          onSelectAll={() => {
            if (!orphanData) return;
            setOrphanSelected((prev) =>
              prev.size === orphanData.rows.length
                ? new Set()
                : new Set(orphanData.rows.map((r) => r.id)),
            );
          }}
          onBulk={orphanBulkDecision}
          onRefresh={fetchOrphans}
          t={t}
          tc={tc}
          fmt={fmt}
        />
      ) : (
        <LibraryView />
      )}
    </div>
  );

  function LibraryView() {
    return (
      <div>
      {/* Filters */}
      <Card className="border-0 shadow-sm mb-4">
        <CardBody className="p-3">
          <div className="row g-3 align-items-end">
            <div className="col-md-3">
              <Label for="range">{t('range')}</Label>
              <select id="range" className="form-control form-control-sm"
                value={range}
                onChange={(e) => setRange(e.target.value as Range)}
              >
                <option value="7d">{t('range7d')}</option>
                <option value="30d">{t('range30d')}</option>
                <option value="90d">{t('range90d')}</option>
                <option value="all">{t('rangeAll')}</option>
              </select>
            </div>
            <div className="col-md-4">
              <Label for="eventFilter">{t('eventFilter')}</Label>
              <select id="eventFilter" className="form-control form-control-sm"
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
              >
                <option value="">{t('allEvents')}</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title} — {fmt.dateTime(new Date(e.startsAt), { day: '2-digit', month: 'short', year: 'numeric' })}
                    {e.eventType === 'INSTANT' ? ' · ⚡' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-3">
              <Label for="hasRec">{t('hasRecording')}</Label>
              <select id="hasRec" className="form-control form-control-sm"
                value={hasRecording}
                onChange={(e) => setHasRecording(e.target.value as 'yes' | 'no' | 'any')}
              >
                <option value="yes">{t('hasRecordingYes')}</option>
                <option value="no">{t('hasRecordingNo')}</option>
                <option value="any">{t('hasRecordingAny')}</option>
              </select>
            </div>
            <div className="col-md-2 text-end">
              <button type="button" className="btn btn-sm btn-primary"
                onClick={exportCsv}
                disabled={!data || data.total === 0}
              >
                <Icon icon="it-download" size="sm" color="white" className="me-1" />
                CSV
              </button>
            </div>
          </div>
          <div className="row g-2 mt-1">
            <div className="col-md-6">
              <Input type="text" placeholder={t('searchPlaceholder')}
                value={search}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Summary */}
      {data && (
        <div className="row g-3 mb-3">
          <div className="col-md-4">
            <Card className="border-0 shadow-sm h-100">
              <CardBody className="p-3">
                <div className="text-muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase' }}>{t('statWithRecording')}</div>
                <div className="fw-bold" style={{ fontSize: '1.6rem', color: '#17324D' }}>{data.stats.withRecording}</div>
              </CardBody>
            </Card>
          </div>
          <div className="col-md-4">
            <Card className="border-0 shadow-sm h-100">
              <CardBody className="p-3">
                <div className="text-muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase' }}>{t('statTotalSize')}</div>
                <div className="fw-bold" style={{ fontSize: '1.6rem', color: '#0066CC' }}>{fmtSize(data.stats.totalBytes)}</div>
              </CardBody>
            </Card>
          </div>
          <div className="col-md-4">
            <Card className="border-0 shadow-sm h-100">
              <CardBody className="p-3">
                <div className="text-muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase' }}>{t('statTotalDuration')}</div>
                <div className="fw-bold" style={{ fontSize: '1.6rem', color: '#008758' }}>{fmtDuration(data.stats.totalDurationSeconds)}</div>
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {error && <div className="alert alert-danger">{error}</div>}
      {loading && <div className="text-muted">{t('loading')}</div>}

      {data && (
        <Card className="border-0 shadow-sm">
          <CardBody className="p-0">
            <div className="table-responsive">
              <table className="table table-hover mb-0" style={{ fontSize: '0.85rem' }}>
                <thead style={{ background: '#F8FAFE' }}>
                  <tr>
                    <th>{t('colStartedAt')}</th>
                    <th>{t('colEvent')}</th>
                    <th>{t('colSource')}</th>
                    <th className="text-end">{t('colDuration')}</th>
                    <th className="text-end">{t('colSize')}</th>
                    <th className="text-end">{t('colPeak')}</th>
                    <th>{t('colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((r) => {
                    const isPlaying = playingId === r.id;
                    return (
                      <React.Fragment key={r.id}>
                        <tr>
                          <td className="text-muted" style={{ fontSize: '0.75rem' }}>
                            {fmt.dateTime(new Date(r.startedAt), { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td>
                            <Link href={`/admin/events/${r.eventId}`} className="text-decoration-none">
                              {r.eventTitle}
                            </Link>
                            {r.eventType === 'INSTANT' && (
                              <Badge color="secondary" className="ms-1" style={{ fontSize: '0.65rem' }}>⚡</Badge>
                            )}
                          </td>
                          <td>
                            <Badge color={r.source === 'session' ? 'primary' : 'info'} style={{ fontSize: '0.68rem' }}>
                              {t(`sources.${r.source}` as 'sources.session' | 'sources.event')}
                            </Badge>
                          </td>
                          <td className="text-end">{fmtDuration(r.durationSeconds)}</td>
                          <td className="text-end">{fmtSize(r.recordingFileSize)}</td>
                          <td className="text-end">{r.peakParticipants}</td>
                          <td>
                            {r.recordingUrl ? (
                              <div className="d-flex gap-1">
                                <button
                                  type="button"
                                  className={`btn btn-sm ${isPlaying ? 'btn-primary' : 'btn-outline-primary'}`}
                                  onClick={() => setPlayingId(isPlaying ? null : r.id)}
                                  title={isPlaying ? t('closePlayer') : t('play')}
                                >
                                  <Icon icon={isPlaying ? 'it-close' : 'it-video'} size="xs" color={isPlaying ? 'white' : undefined} />
                                </button>
                                <a
                                  href={r.recordingUrl}
                                  download={r.recordingFilename ?? undefined}
                                  className="btn btn-sm btn-outline-primary"
                                  title={t('download')}
                                >
                                  <Icon icon="it-download" size="xs" />
                                </a>
                              </div>
                            ) : (
                              <span className="text-muted" style={{ fontSize: '0.78rem' }}>{t('noFile')}</span>
                            )}
                          </td>
                        </tr>
                        {isPlaying && r.recordingUrl && (
                          <tr>
                            <td colSpan={7} style={{ background: '#F8FAFE', padding: '1rem' }}>
                              <video
                                key={r.recordingUrl}
                                controls
                                preload="metadata"
                                style={{ width: '100%', maxWidth: 900, display: 'block', margin: '0 auto', borderRadius: 8 }}
                                src={r.recordingUrl}
                              >
                                {t('playerUnsupported')}
                              </video>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {visibleRows.length === 0 && !loading && (
                    <tr>
                      <td colSpan={7} className="text-center text-muted py-4">
                        {t('noResults')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {/* Suppress unused-locale warning: we currently anchor link via
                next-intl's typed router which doesn't need a locale arg. */}
            <span hidden>{locale}</span>
          </CardBody>
        </Card>
      )}
    </div>
    );
  }
}

function fmtOrphanSize(bytesStr: string | null): string {
  if (!bytesStr) return '—';
  const n = Number(bytesStr);
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(2)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(0)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

interface OrphansViewProps {
  data: OrphanResponse | null;
  loading: boolean;
  selected: Set<string>;
  submitting: boolean;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onBulk: (decision: 'ignore' | 'delete-now' | 'pending') => void;
  onRefresh: () => void;
  t: ReturnType<typeof useTranslations>;
  tc: ReturnType<typeof useTranslations>;
  fmt: ReturnType<typeof useFormatter>;
}

function OrphansView({
  data,
  loading,
  selected,
  submitting,
  onToggle,
  onSelectAll,
  onBulk,
  onRefresh,
  t,
  tc,
  fmt,
}: OrphansViewProps) {
  if (loading && !data) {
    return <div className="text-muted">{tc('loading')}</div>;
  }
  if (!data || data.rows.length === 0) {
    return (
      <Card className="border-0 shadow-sm">
        <CardBody className="p-5 text-center">
          <Icon icon="it-check-circle" size="xl" className="text-success mb-3" />
          <p className="text-muted mb-1">{t('orphans.noneFound')}</p>
          <small className="text-muted">
            {t('orphans.graceDays', { days: data?.graceDays ?? 30 })}
          </small>
          <div className="mt-3">
            <Button color="secondary" outline size="xs" onClick={onRefresh}>
              <Icon icon="it-refresh" size="xs" className="me-1" />
              {t('orphans.refresh')}
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  const allSelected = selected.size === data.rows.length;
  const hasSelection = selected.size > 0;
  const countPending = data.rows.filter((r) => r.decision === 'pending').length;
  const countIgnore = data.rows.filter((r) => r.decision === 'ignore').length;
  const countDeleteNow = data.rows.filter((r) => r.decision === 'delete-now').length;

  return (
    <div>
      <div className="row g-3 mb-3">
        <div className="col-md-3">
          <Card className="border-0 shadow-sm h-100">
            <CardBody className="p-3">
              <div className="text-muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase' }}>
                {t('orphans.statTotal')}
              </div>
              <div className="fw-bold" style={{ fontSize: '1.6rem', color: '#17324D' }}>
                {data.total}
              </div>
              <small className="text-muted">{fmtOrphanSize(data.totalBytes)}</small>
            </CardBody>
          </Card>
        </div>
        <div className="col-md-3">
          <Card className="border-0 shadow-sm h-100">
            <CardBody className="p-3">
              <div className="text-muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase' }}>
                {t('orphans.statPending')}
              </div>
              <div className="fw-bold" style={{ fontSize: '1.6rem', color: '#A66300' }}>
                {countPending}
              </div>
            </CardBody>
          </Card>
        </div>
        <div className="col-md-3">
          <Card className="border-0 shadow-sm h-100">
            <CardBody className="p-3">
              <div className="text-muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase' }}>
                {t('orphans.statIgnore')}
              </div>
              <div className="fw-bold" style={{ fontSize: '1.6rem', color: '#5A768A' }}>
                {countIgnore}
              </div>
            </CardBody>
          </Card>
        </div>
        <div className="col-md-3">
          <Card className="border-0 shadow-sm h-100">
            <CardBody className="p-3">
              <div className="text-muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase' }}>
                {t('orphans.statDeleteNow')}
              </div>
              <div className="fw-bold" style={{ fontSize: '1.6rem', color: '#CC0000' }}>
                {countDeleteNow}
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="alert alert-info d-flex align-items-start gap-2 mb-3">
        <Icon icon="it-info-circle" size="sm" className="mt-1 flex-shrink-0" />
        <div style={{ fontSize: '0.85rem' }}>
          {t('orphans.intro', { days: data.graceDays })}
        </div>
      </div>

      <div className="d-flex flex-wrap gap-2 mb-3">
        <Button color="primary" outline size="xs" onClick={onSelectAll}>
          <Icon
            icon={allSelected ? 'it-check-circle' : 'it-check'}
            size="xs"
            className="me-1"
          />
          {allSelected ? tc('deselectAll') : tc('selectAll')}
        </Button>
        {hasSelection && (
          <>
            <span className="text-muted small ms-1">
              {selected.size} {t('orphans.selected')}
            </span>
            <Button
              color="secondary"
              outline
              size="xs"
              disabled={submitting}
              onClick={() => onBulk('ignore')}
            >
              <Icon icon="it-lock" size="xs" className="me-1" />
              {t('orphans.markIgnore')}
            </Button>
            <Button
              color="danger"
              outline
              size="xs"
              disabled={submitting}
              onClick={() => onBulk('delete-now')}
            >
              <Icon icon="it-delete" size="xs" className="me-1" />
              {t('orphans.markDelete')}
            </Button>
            <Button
              color="warning"
              outline
              size="xs"
              disabled={submitting}
              onClick={() => onBulk('pending')}
            >
              <Icon icon="it-refresh" size="xs" className="me-1" />
              {t('orphans.markPending')}
            </Button>
          </>
        )}
        <div className="ms-auto">
          <Button color="secondary" outline size="xs" onClick={onRefresh}>
            <Icon icon="it-refresh" size="xs" className="me-1" />
            {t('orphans.refresh')}
          </Button>
        </div>
      </div>

      <Card className="border-0 shadow-sm">
        <CardBody className="p-0">
          <div className="table-responsive">
            <table className="table table-hover mb-0" style={{ fontSize: '0.85rem' }}>
              <thead style={{ background: '#F8FAFE' }}>
                <tr>
                  <th style={{ width: 32 }} />
                  <th>{t('orphans.colBlobName')}</th>
                  <th className="text-end">{t('orphans.colSize')}</th>
                  <th>{t('orphans.colDiscovered')}</th>
                  <th>{t('orphans.colDecision')}</th>
                  <th>{t('orphans.colDeletesAt')}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const isSelected = selected.has(r.id);
                  const decisionBadge =
                    r.decision === 'pending' ? (
                      <Badge color="warning" style={{ fontSize: '0.68rem' }}>
                        {t('orphans.decisionPending')}
                      </Badge>
                    ) : r.decision === 'ignore' ? (
                      <Badge color="secondary" style={{ fontSize: '0.68rem' }}>
                        {t('orphans.decisionIgnore')}
                      </Badge>
                    ) : (
                      <Badge color="danger" style={{ fontSize: '0.68rem' }}>
                        {t('orphans.decisionDeleteNow')}
                      </Badge>
                    );
                  const deletesAtLabel =
                    r.deletesAt === null
                      ? '—'
                      : r.deletesAt === 'next-sweep'
                        ? t('orphans.nextSweep')
                        : fmt.dateTime(new Date(r.deletesAt), {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          });
                  return (
                    <tr key={r.id} style={{ background: isSelected ? '#EFF6FF' : undefined }}>
                      <td>
                        <input
                          type="checkbox"
                          className="form-check-input"
                          checked={isSelected}
                          onChange={() => onToggle(r.id)}
                        />
                      </td>
                      <td>
                        <code style={{ fontSize: '0.78rem', color: '#17324D' }}>{r.blobName}</code>
                      </td>
                      <td className="text-end">{fmtOrphanSize(r.sizeBytes)}</td>
                      <td className="text-muted" style={{ fontSize: '0.78rem' }}>
                        {fmt.dateTime(new Date(r.discoveredAt), {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>
                      <td>{decisionBadge}</td>
                      <td className="text-muted" style={{ fontSize: '0.78rem' }}>
                        {deletesAtLabel}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
