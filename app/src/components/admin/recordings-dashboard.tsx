'use client';

/**
 * Admin cross-event recordings library.
 *
 * Lists both CallSession artifacts and published Event recordings so
 * an admin has a single place to find, download or delete any video
 * file the platform has ever produced.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import { Badge, Card, CardBody, Icon, Input, Label } from 'design-react-kit';

import { Link } from '@/i18n/navigation';

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

export default function RecordingsDashboard({
  events,
  locale,
}: {
  events: EventOption[];
  locale: string;
}) {
  const t = useTranslations('admin.recordingsLibrary');
  const fmt = useFormatter();

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
                  {visibleRows.map((r) => (
                    <tr key={r.id}>
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
                          <a href={r.recordingUrl} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-outline-primary">
                            <Icon icon="it-download" size="xs" className="me-1" /> {t('download')}
                          </a>
                        ) : (
                          <span className="text-muted" style={{ fontSize: '0.78rem' }}>{t('noFile')}</span>
                        )}
                      </td>
                    </tr>
                  ))}
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
