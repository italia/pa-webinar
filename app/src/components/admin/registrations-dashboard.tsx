'use client';

/**
 * Admin cross-event registrations dashboard.
 *
 * Gives the admin a single page to see all registrations across all
 * events, filter them by event / period / org type / joined-or-not,
 * and export the filtered set as CSV. The per-event view under
 * /admin/events/[id] remains the primary place to triage a specific
 * conference; this page is for the "give me all sign-ups for Q1" use
 * case that was previously impossible without SQL.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import { Badge, Card, CardBody, Icon, Input, Label } from 'design-react-kit';

interface EventOption {
  id: string;
  slug: string;
  title: string;
  startsAt: string;
  status: string;
}

interface RegistrationRow {
  id: string;
  eventId: string;
  eventTitle: string;
  eventSlug: string;
  eventStartsAt: string;
  displayName: string;
  email: string;
  organization: string | null;
  organizationRole: string | null;
  organizationType: string | null;
  consentRecording: boolean | null;
  consentFutureCommunications: boolean;
  joinedAt: string | null;
  leftAt: string | null;
  createdAt: string;
}

interface ApiResponse {
  rows: RegistrationRow[];
  total: number;
  limit: number;
  offset: number;
  since: string;
  until: string;
  orgSummary: Record<string, number>;
  joinedCount: number;
}

const ORG_TYPES = [
  'MINISTRY',
  'AGENCY',
  'REGION',
  'PROVINCE',
  'MUNICIPALITY',
  'ASL',
  'UNIVERSITY',
  'PUBLIC_ENTITY',
  'IN_HOUSE',
  'OTHER',
] as const;

type Range = '7d' | '30d' | '90d' | 'all';

function rangeSince(range: Range): Date {
  const now = Date.now();
  switch (range) {
    case '7d': return new Date(now - 7 * 86400_000);
    case '30d': return new Date(now - 30 * 86400_000);
    case '90d': return new Date(now - 90 * 86400_000);
    case 'all': return new Date(0);
  }
}

export default function RegistrationsDashboard({
  events,
  locale,
}: {
  events: EventOption[];
  locale: string;
}) {
  const t = useTranslations('admin.registrations');
  const fmt = useFormatter();

  const [range, setRange] = useState<Range>('30d');
  const [eventId, setEventId] = useState<string>('');
  const [orgType, setOrgType] = useState<string>('');
  const [joined, setJoined] = useState<'' | 'yes' | 'no'>('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const limit = 100;

  const buildQuery = useCallback((csv = false) => {
    const params = new URLSearchParams();
    params.set('since', rangeSince(range).toISOString());
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    if (eventId) params.set('eventId', eventId);
    if (orgType) params.set('orgType', orgType);
    if (joined) params.set('joined', joined);
    if (csv) params.set('format', 'csv');
    return params.toString();
  }, [range, eventId, orgType, joined, offset]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/registrations?${buildQuery(false)}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json() as ApiResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch error');
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Client-side search filter on top of the server-side result set.
  // Kept client-side because we already cap the server result at 100 rows
  // per fetch; a proper full-text search would go to the DB.
  const visibleRows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.rows;
    return data.rows.filter((r) =>
      r.displayName.toLowerCase().includes(q)
      || r.email.toLowerCase().includes(q)
      || (r.organization ?? '').toLowerCase().includes(q)
      || r.eventTitle.toLowerCase().includes(q),
    );
  }, [data, search]);

  const exportCsv = () => {
    window.location.href = `/api/admin/registrations?${buildQuery(true)}`;
  };

  return (
    <div>
      {/* Filters */}
      <Card className="border-0 shadow-sm mb-4">
        <CardBody className="p-3">
          <div className="row g-3 align-items-end">
            <div className="col-md-3">
              <Label for="range">{t('range')}</Label>
              <select
                id="range"
                className="form-control form-control-sm"
                value={range}
                onChange={(e) => { setOffset(0); setRange(e.target.value as Range); }}
              >
                <option value="7d">{t('range7d')}</option>
                <option value="30d">{t('range30d')}</option>
                <option value="90d">{t('range90d')}</option>
                <option value="all">{t('rangeAll')}</option>
              </select>
            </div>
            <div className="col-md-4">
              <Label for="eventFilter">{t('eventFilter')}</Label>
              <select
                id="eventFilter"
                className="form-control form-control-sm"
                value={eventId}
                onChange={(e) => { setOffset(0); setEventId(e.target.value); }}
              >
                <option value="">{t('allEvents')}</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title} — {fmt.dateTime(new Date(e.startsAt), { day: '2-digit', month: 'short', year: 'numeric' })}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-2">
              <Label for="orgType">{t('orgType')}</Label>
              <select
                id="orgType"
                className="form-control form-control-sm"
                value={orgType}
                onChange={(e) => { setOffset(0); setOrgType(e.target.value); }}
              >
                <option value="">{t('allOrgTypes')}</option>
                {ORG_TYPES.map((ot) => (
                  <option key={ot} value={ot}>{t(`orgTypes.${ot}`)}</option>
                ))}
              </select>
            </div>
            <div className="col-md-2">
              <Label for="joined">{t('joined')}</Label>
              <select
                id="joined"
                className="form-control form-control-sm"
                value={joined}
                onChange={(e) => { setOffset(0); setJoined(e.target.value as '' | 'yes' | 'no'); }}
              >
                <option value="">{t('allRegs')}</option>
                <option value="yes">{t('joinedYes')}</option>
                <option value="no">{t('joinedNo')}</option>
              </select>
            </div>
            <div className="col-md-1">
              <button
                type="button"
                className="btn btn-sm btn-primary w-100"
                onClick={exportCsv}
                disabled={!data || data.total === 0}
                title={t('exportCsv')}
              >
                <Icon icon="it-download" size="sm" color="white" />
              </button>
            </div>
          </div>
          <div className="row g-2 mt-1">
            <div className="col-md-6">
              <Input
                type="text"
                placeholder={t('searchPlaceholder')}
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
          <div className="col-md-3">
            <Card className="border-0 shadow-sm h-100">
              <CardBody className="p-3">
                <div className="text-muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase' }}>{t('statTotal')}</div>
                <div className="fw-bold" style={{ fontSize: '1.6rem', color: '#17324D' }}>{data.total}</div>
                <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                  {t('showing', { count: visibleRows.length })}
                </div>
              </CardBody>
            </Card>
          </div>
          <div className="col-md-3">
            <Card className="border-0 shadow-sm h-100">
              <CardBody className="p-3">
                <div className="text-muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase' }}>{t('statJoined')}</div>
                <div className="fw-bold" style={{ fontSize: '1.6rem', color: '#008758' }}>
                  {data.joinedCount}
                </div>
                <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                  {data.rows.length > 0
                    ? `${Math.round((data.joinedCount / data.rows.length) * 100)}% ${t('conversionRate')}`
                    : ''}
                </div>
              </CardBody>
            </Card>
          </div>
          <div className="col-md-6">
            <Card className="border-0 shadow-sm h-100">
              <CardBody className="p-3">
                <div className="text-muted mb-2" style={{ fontSize: '0.72rem', textTransform: 'uppercase' }}>{t('topOrgTypes')}</div>
                <div className="d-flex flex-wrap gap-2">
                  {Object.entries(data.orgSummary)
                    .filter(([, n]) => n > 0)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 6)
                    .map(([type, count]) => (
                      <Badge key={type} color="primary" className="p-2" style={{ fontSize: '0.75rem' }}>
                        {type === 'UNKNOWN' ? t('orgTypeUnknown') : t(`orgTypes.${type}` as Parameters<typeof t>[0])}: {count}
                      </Badge>
                    ))}
                  {Object.keys(data.orgSummary).length === 0 && (
                    <span className="text-muted" style={{ fontSize: '0.78rem' }}>—</span>
                  )}
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {/* Table */}
      {error && <div className="alert alert-danger">{error}</div>}
      {loading && <div className="text-muted">{t('loading')}</div>}

      {data && (
        <Card className="border-0 shadow-sm">
          <CardBody className="p-0">
            <div className="table-responsive">
              <table className="table table-hover mb-0" style={{ fontSize: '0.85rem' }}>
                <thead style={{ background: '#F8FAFE' }}>
                  <tr>
                    <th>{t('colCreatedAt')}</th>
                    <th>{t('colEvent')}</th>
                    <th>{t('colName')}</th>
                    <th>{t('colEmail')}</th>
                    <th>{t('colOrg')}</th>
                    <th>{t('colJoined')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((r) => (
                    <tr key={r.id}>
                      <td className="text-muted" style={{ fontSize: '0.75rem' }}>
                        {fmt.dateTime(new Date(r.createdAt), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td>
                        <a href={`/${locale}/admin/events/${r.eventId}`} className="text-decoration-none">
                          {r.eventTitle}
                        </a>
                      </td>
                      <td>{r.displayName}</td>
                      <td className="text-muted">{r.email}</td>
                      <td>
                        {r.organization ? (
                          <>
                            <div>{r.organization}</div>
                            {r.organizationRole && (
                              <div className="text-muted" style={{ fontSize: '0.72rem' }}>{r.organizationRole}</div>
                            )}
                          </>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td>
                        {r.joinedAt ? (
                          <Badge color="success" style={{ fontSize: '0.7rem' }}>✓</Badge>
                        ) : (
                          <Badge color="secondary" style={{ fontSize: '0.7rem' }}>—</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                  {visibleRows.length === 0 && !loading && (
                    <tr>
                      <td colSpan={6} className="text-center text-muted py-4">
                        {t('noResults')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {data.total > visibleRows.length + offset && (
              <div className="p-3 border-top d-flex justify-content-between align-items-center">
                <div className="text-muted" style={{ fontSize: '0.78rem' }}>
                  {t('pageInfo', { from: offset + 1, to: offset + visibleRows.length, total: data.total })}
                </div>
                <div>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-primary me-1"
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - limit))}
                  >
                    {t('prev')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-primary"
                    disabled={offset + limit >= data.total}
                    onClick={() => setOffset(offset + limit)}
                  >
                    {t('next')}
                  </button>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
