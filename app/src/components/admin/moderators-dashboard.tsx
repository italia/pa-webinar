'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import { Badge, Card, CardBody, Icon, Input } from 'design-react-kit';

import { Link } from '@/i18n/navigation';

interface ModeratorRow {
  id: string;
  slug: string;
  title: string;
  status: string;
  eventType: string;
  startsAt: string;
  endsAt: string;
  moderatorName: string | null;
  moderatorEmail: string | null;
  moderatorToken: string;
}

interface ApiResponse {
  rows: ModeratorRow[];
}

export default function ModeratorsDashboard({
  appUrl,
  locale,
}: {
  appUrl: string;
  locale: string;
}) {
  const t = useTranslations('admin.moderators');
  const fmt = useFormatter();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [rotating, setRotating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Debounce the search input so every keystroke doesn't hit the DB.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  const fetchRows = useCallback(async () => {
    setError(null);
    try {
      const p = new URLSearchParams();
      if (debounced) p.set('q', debounced);
      const res = await fetch(`/api/admin/moderators?${p.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json() as ApiResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch error');
    }
  }, [debounced]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  function buildLink(row: ModeratorRow): string {
    return `${appUrl}/${locale}/events/${row.slug}/live?token=${row.moderatorToken}`;
  }

  async function copyLink(row: ModeratorRow) {
    try {
      await navigator.clipboard.writeText(buildLink(row));
      setCopied(row.id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // Non-critical — user can still copy manually.
    }
  }

  async function regenerate(row: ModeratorRow) {
    if (!confirm(t('confirmRegenerate'))) return;
    setRotating(row.id);
    try {
      const res = await fetch('/api/admin/moderators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: row.id, action: 'regenerate' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchRows();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'regenerate failed');
    } finally {
      setRotating(null);
    }
  }

  return (
    <div>
      <Card className="border-0 shadow-sm mb-3">
        <CardBody className="p-3">
          <Input
            type="text"
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          />
          <small className="text-muted" style={{ fontSize: '0.75rem' }}>
            {t('searchHelp')}
          </small>
        </CardBody>
      </Card>

      {error && <div className="alert alert-danger">{error}</div>}

      {data && (
        <Card className="border-0 shadow-sm">
          <CardBody className="p-0">
            <div className="table-responsive">
              <table className="table table-hover mb-0" style={{ fontSize: '0.85rem' }}>
                <thead style={{ background: '#F8FAFE' }}>
                  <tr>
                    <th>{t('colEvent')}</th>
                    <th>{t('colModerator')}</th>
                    <th>{t('colDate')}</th>
                    <th>{t('colStatus')}</th>
                    <th style={{ minWidth: 220 }}>{t('colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/admin/events/${r.id}`} className="text-decoration-none fw-semibold">
                          {r.title}
                        </Link>
                        {r.eventType === 'INSTANT' && (
                          <Badge color="secondary" className="ms-1" style={{ fontSize: '0.65rem' }}>⚡</Badge>
                        )}
                        <br />
                        <span className="text-muted" style={{ fontSize: '0.72rem' }}>{r.slug}</span>
                      </td>
                      <td>
                        {r.moderatorName ?? <span className="text-muted">—</span>}
                        {r.moderatorEmail && (
                          <>
                            <br />
                            <span className="text-muted" style={{ fontSize: '0.72rem' }}>{r.moderatorEmail}</span>
                          </>
                        )}
                      </td>
                      <td className="text-muted" style={{ fontSize: '0.75rem' }}>
                        {fmt.dateTime(new Date(r.startsAt), { day: '2-digit', month: 'short', year: 'numeric' })}
                      </td>
                      <td>
                        <Badge color={r.status === 'LIVE' ? 'danger' : r.status === 'ENDED' ? 'secondary' : 'primary'} style={{ fontSize: '0.68rem' }}>
                          {r.status}
                        </Badge>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-primary me-1"
                          onClick={() => copyLink(r)}
                          title={t('copyLink')}
                        >
                          <Icon icon="it-copy" size="xs" className="me-1" />
                          {copied === r.id ? t('copied') : t('copy')}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-warning"
                          onClick={() => regenerate(r)}
                          disabled={rotating === r.id}
                          title={t('regenerateTitle')}
                        >
                          <Icon icon="it-refresh" size="xs" className="me-1" />
                          {rotating === r.id ? t('rotating') : t('regenerate')}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {data.rows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center text-muted py-4">
                        {t('noResults')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
