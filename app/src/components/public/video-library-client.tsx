'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import { Badge, Card, CardBody, Input } from 'design-react-kit';

import { Link } from '@/i18n/navigation';

interface LibraryRow {
  id: string;
  slug: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  durationSeconds: number | null;
  publishedAt: string | null;
  imageUrl: string | null;
  hasYoutube: boolean;
}

interface LibraryResponse {
  rows: LibraryRow[];
  page: number;
  pageSize: number;
  total: number;
}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function VideoLibraryClient({ locale }: { locale: string }) {
  const t = useTranslations('videoLibrary');
  const fmt = useFormatter();

  const [search, setSearch] = useState('');
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const fetchPage = useCallback(async (q: string, p: number) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      params.set('page', String(p));
      const res = await fetch(`/api/public/video-library?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json() as LibraryResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => { fetchPage(search, page); }, 250);
    return () => clearTimeout(handle);
  }, [search, page, fetchPage]);

  const totalPages = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, Math.ceil(data.total / data.pageSize));
  }, [data]);

  const eventHrefBase = locale === 'en' ? '/events' : '/eventi';

  return (
    <div>
      <div className="row g-3 mb-4">
        <div className="col-md-6">
          <Input
            type="text"
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="col-md-6 d-flex align-items-center justify-content-md-end">
          <span className="text-muted" style={{ fontSize: '0.88rem' }}>
            {data ? t('results', { count: data.total }) : t('loading')}
          </span>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger">{error}</div>
      )}

      {loading && !data && <div className="text-muted">{t('loading')}</div>}

      {data && data.rows.length === 0 && (
        <Card className="border-0 shadow-sm">
          <CardBody className="p-5 text-center">
            <p className="text-muted mb-0">{t('empty')}</p>
          </CardBody>
        </Card>
      )}

      {data && data.rows.length > 0 && (
        <>
          <div className="row g-3">
            {data.rows.map((r) => {
              const publishedLabel = r.publishedAt
                ? fmt.dateTime(new Date(r.publishedAt), { day: '2-digit', month: 'short', year: 'numeric' })
                : fmt.dateTime(new Date(r.endsAt), { day: '2-digit', month: 'short', year: 'numeric' });

              return (
                <div key={r.id} className="col-sm-6 col-lg-4">
                  <Link
                    href={`${eventHrefBase}/${r.slug}`}
                    className="text-decoration-none d-block h-100"
                  >
                    <Card
                      className="h-100 shadow-sm border-0"
                      style={{ borderRadius: 10, overflow: 'hidden', transition: 'transform 0.15s ease' }}
                    >
                      {r.imageUrl ? (
                        <div
                          style={{
                            aspectRatio: '16/9',
                            backgroundImage: `url(${r.imageUrl})`,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                          }}
                          aria-hidden="true"
                        />
                      ) : (
                        <div
                          style={{
                            aspectRatio: '16/9',
                            background: 'linear-gradient(135deg, #0066CC 0%, #4A90E2 100%)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#fff',
                            fontSize: '2.5rem',
                          }}
                          aria-hidden="true"
                        >
                          ▶
                        </div>
                      )}
                      <CardBody className="p-3">
                        <div className="d-flex align-items-center gap-2 mb-2" style={{ fontSize: '0.72rem' }}>
                          <span className="text-muted">{publishedLabel}</span>
                          {r.durationSeconds && r.durationSeconds > 0 && (
                            <span className="text-muted">· {formatDuration(r.durationSeconds)}</span>
                          )}
                          {r.hasYoutube && (
                            <Badge color="danger" pill style={{ fontSize: '0.62rem' }}>
                              YouTube
                            </Badge>
                          )}
                        </div>
                        <h6 className="fw-semibold mb-1" style={{ color: 'var(--app-text)', lineHeight: 1.3 }}>
                          {r.title}
                        </h6>
                        {r.description && (
                          <p
                            className="text-secondary mb-0"
                            style={{
                              fontSize: '0.82rem',
                              display: '-webkit-box',
                              WebkitLineClamp: 3,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                          >
                            {r.description}
                          </p>
                        )}
                      </CardBody>
                    </Card>
                  </Link>
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="d-flex justify-content-center mt-4 gap-2">
              <button
                type="button"
                className="btn btn-outline-primary btn-sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ← {t('prev')}
              </button>
              <span className="align-self-center text-muted" style={{ fontSize: '0.85rem' }}>
                {t('pageOf', { page, total: totalPages })}
              </span>
              <button
                type="button"
                className="btn btn-outline-primary btn-sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                {t('next')} →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
