'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import { Badge, Button, Card, CardBody, Input } from 'design-react-kit';

import { Link } from '@/i18n/navigation';
import { useToast } from '@/components/ui/toast';
import { SkeletonLines } from '@/components/ui/skeleton';

interface PublicationRow {
  id: string;
  slug: string;
  title: string;
  description: string;
  source: 'scheduled' | 'instant' | 'legacy';
  eventType: string;
  status: string;
  startsAt: string;
  endsAt: string;
  libraryListed: boolean;
  postEventPublic: boolean;
  coverImageUrl: string | null;
  imageUrl: string | null;
  youtubeUrl: string | null;
  hasPublishedRecording: boolean;
  recordingPublishedAt: string | null;
  pendingSessionRecordings: number;
  registrationCount: number;
}

interface ApiResponse {
  rows: PublicationRow[];
  total: number;
  counters: {
    scheduled: number;
    instant: number;
    legacy: number;
    pending: number;
    listed: number;
  };
}

type Tab = 'all' | 'scheduled' | 'instant' | 'legacy' | 'pending';

export default function PublicationsDashboard({ locale }: { locale: string }) {
  const t = useTranslations('admin.publications');
  const tc = useTranslations('common');
  const fmt = useFormatter();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>('all');
  const [listedFilter, setListedFilter] = useState<'any' | 'yes' | 'no'>('any');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('source', tab);
      params.set('listed', listedFilter);
      if (search) params.set('q', search);
      const res = await fetch(`/api/admin/publications?${params.toString()}`, {
        cache: 'no-store',
      });
      if (res.ok) setData(await res.json() as ApiResponse);
    } finally {
      setLoading(false);
    }
  }, [tab, listedFilter, search]);

  useEffect(() => {
    const handle = setTimeout(fetchData, 250);
    return () => clearTimeout(handle);
  }, [fetchData]);

  const toggleLibraryListed = useCallback(
    async (row: PublicationRow) => {
      setBusyId(row.id);
      try {
        const res = await fetch(`/api/admin/publications/${row.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ libraryListed: !row.libraryListed }),
        });
        if (res.ok) await fetchData();
        else toast.error(t('updateFailed'));
      } catch {
        toast.error(t('updateFailed'));
      } finally {
        setBusyId(null);
      }
    },
    [fetchData, toast],
  );

  const counters = data?.counters;

  const eventHrefBase = locale === 'en' ? '/events' : '/eventi';

  const tabs = useMemo<{ id: Tab; label: string; count?: number }[]>(
    () => [
      { id: 'all', label: t('tabs.all'), count: data?.total },
      { id: 'scheduled', label: t('tabs.scheduled'), count: counters?.scheduled },
      { id: 'instant', label: t('tabs.instant'), count: counters?.instant },
      { id: 'legacy', label: t('tabs.legacy'), count: counters?.legacy },
      { id: 'pending', label: t('tabs.pending'), count: counters?.pending },
    ],
    [t, data?.total, counters],
  );

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
        <ul className="nav nav-tabs mb-0 flex-grow-1" role="tablist">
          {tabs.map((tb) => (
            <li key={tb.id} className="nav-item">
              <button
                type="button"
                role="tab"
                className={`nav-link ${tab === tb.id ? 'active' : ''}`}
                onClick={() => setTab(tb.id)}
              >
                {tb.label}
                {tb.count !== undefined && (
                  <Badge color="" pill className="ms-2" style={{ fontSize: '0.65rem', background: '#E9ECEF', color: 'var(--app-muted)' }}>
                    {tb.count}
                  </Badge>
                )}
              </button>
            </li>
          ))}
        </ul>
        <Link href="/admin/publications/new">
          <Button color="primary" size="sm" tag="span">
            + {t('newPublication')}
          </Button>
        </Link>
      </div>

      <Card className="border-0 shadow-sm mb-4">
        <CardBody className="p-3">
          <div className="row g-2 align-items-end">
            <div className="col-md-6">
              <Input
                type="text"
                placeholder={t('searchPlaceholder')}
                value={search}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
              />
            </div>
            <div className="col-md-3">
              <select
                className="form-select form-select-sm"
                value={listedFilter}
                onChange={(e) => setListedFilter(e.target.value as 'any' | 'yes' | 'no')}
              >
                <option value="any">{t('listedAny')}</option>
                <option value="yes">{t('listedYes')}</option>
                <option value="no">{t('listedNo')}</option>
              </select>
            </div>
          </div>
        </CardBody>
      </Card>

      {loading && !data && (
        <Card className="border-0 shadow-sm">
          <CardBody className="p-3">
            <SkeletonLines lines={6} loadingLabel={tc('loading')} />
          </CardBody>
        </Card>
      )}

      {data && data.rows.length === 0 && (
        <Card className="border-0 shadow-sm">
          <CardBody className="p-5 text-center">
            <p className="text-muted mb-0">{t('empty')}</p>
          </CardBody>
        </Card>
      )}

      {data && data.rows.length > 0 && (
        <div className="d-flex flex-column gap-3">
          {data.rows.map((r) => {
            const cover = r.coverImageUrl ?? r.imageUrl ?? null;
            return (
              <Card key={r.id} className="shadow-sm border-0" style={{ borderRadius: 10 }}>
                <CardBody className="p-3">
                  <div className="d-flex gap-3 flex-wrap flex-md-nowrap">
                    <div
                      style={{
                        width: 160,
                        aspectRatio: '16/9',
                        flexShrink: 0,
                        borderRadius: 8,
                        overflow: 'hidden',
                        background: cover
                          ? `url(${cover}) center/cover`
                          : 'linear-gradient(135deg, #0066CC 0%, #4A90E2 100%)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff',
                        fontSize: '1.5rem',
                      }}
                      aria-hidden="true"
                    >
                      {!cover && '▶'}
                    </div>
                    <div style={{ minWidth: 0, flexGrow: 1 }}>
                      <div className="d-flex align-items-center gap-2 flex-wrap mb-1">
                        <h6 className="fw-semibold mb-0" style={{ color: 'var(--app-text)' }}>
                          {r.title || <em className="text-muted">{t('untitled')}</em>}
                        </h6>
                        <SourceBadge source={r.source} />
                        {r.libraryListed ? (
                          <Badge color="success" pill style={{ fontSize: '0.65rem' }}>
                            {t('badges.listed')}
                          </Badge>
                        ) : (
                          <Badge color="" pill style={{ fontSize: '0.65rem', background: '#E9ECEF', color: 'var(--app-muted)' }}>
                            {t('badges.unlisted')}
                          </Badge>
                        )}
                        {r.pendingSessionRecordings > 0 && !r.libraryListed && (
                          <Badge color="warning" pill style={{ fontSize: '0.65rem' }}>
                            {t('badges.pending', { count: r.pendingSessionRecordings })}
                          </Badge>
                        )}
                      </div>
                      <div className="text-muted mb-1" style={{ fontSize: '0.78rem' }}>
                        {fmt.dateTime(new Date(r.endsAt), { day: '2-digit', month: 'short', year: 'numeric' })}
                        {r.registrationCount > 0 && (
                          <> · {t('meta.registrations', { count: r.registrationCount })}</>
                        )}
                      </div>
                      {r.description && (
                        <p
                          className="text-secondary mb-2"
                          style={{
                            fontSize: '0.82rem',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}
                        >
                          {r.description}
                        </p>
                      )}
                      <div className="d-flex gap-2 flex-wrap">
                        <Link href={`/admin/events/${r.id}`}>
                          <Button color="secondary" outline size="xs" tag="span">
                            {t('actions.edit')}
                          </Button>
                        </Link>
                        <Link href={`${eventHrefBase}/${r.slug}`}>
                          <Button color="secondary" outline size="xs" tag="span">
                            {t('actions.preview')}
                          </Button>
                        </Link>
                        <Button
                          color={r.libraryListed ? 'warning' : 'primary'}
                          size="xs"
                          disabled={busyId === r.id}
                          onClick={() => toggleLibraryListed(r)}
                        >
                          {r.libraryListed ? t('actions.unlist') : t('actions.list')}
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SourceBadge({ source }: { source: 'scheduled' | 'instant' | 'legacy' }) {
  const t = useTranslations('admin.publications.source');
  const color = source === 'legacy' ? 'info' : source === 'instant' ? 'secondary' : 'primary';
  return (
    <Badge color={color} pill style={{ fontSize: '0.65rem' }}>
      {t(source)}
    </Badge>
  );
}
