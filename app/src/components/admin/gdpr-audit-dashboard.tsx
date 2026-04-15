'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import { Badge, Card, CardBody, Label } from 'design-react-kit';

import { Link } from '@/i18n/navigation';

interface AuditRow {
  id: string;
  action: string;
  recordCount: number;
  details: string | null;
  createdAt: string;
  eventId: string;
  eventSlug: string;
  eventTitle: string;
}

interface ApiResponse {
  rows: AuditRow[];
  actionSummary: Array<{ action: string; count: number; totalRecords: number }>;
  since: string;
  limit: number;
}

const ACTION_COLORS: Record<string, string> = {
  DATA_DELETED: 'danger',
  CONSENT_RECORDED: 'success',
  DATA_EXPORTED: 'primary',
};

export default function GdprAuditDashboard() {
  const t = useTranslations('admin.gdprAudit');
  const fmt = useFormatter();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [range, setRange] = useState<'30d' | '90d' | '1y'>('90d');
  const [action, setAction] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const days = range === '30d' ? 30 : range === '90d' ? 90 : 365;
      const since = new Date(Date.now() - days * 86400_000).toISOString();
      const p = new URLSearchParams({ since });
      if (action) p.set('action', action);
      const res = await fetch(`/api/admin/gdpr-audit?${p.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json() as ApiResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch error');
    } finally {
      setLoading(false);
    }
  }, [range, action]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div>
      <Card className="border-0 shadow-sm mb-4">
        <CardBody className="p-3">
          <div className="row g-3 align-items-end">
            <div className="col-md-3">
              <Label for="range">{t('range')}</Label>
              <select id="range" className="form-control form-control-sm"
                value={range}
                onChange={(e) => setRange(e.target.value as '30d' | '90d' | '1y')}
              >
                <option value="30d">{t('range30d')}</option>
                <option value="90d">{t('range90d')}</option>
                <option value="1y">{t('range1y')}</option>
              </select>
            </div>
            <div className="col-md-3">
              <Label for="action">{t('actionFilter')}</Label>
              <select id="action" className="form-control form-control-sm"
                value={action}
                onChange={(e) => setAction(e.target.value)}
              >
                <option value="">{t('allActions')}</option>
                <option value="DATA_DELETED">{t('actions.DATA_DELETED')}</option>
                <option value="CONSENT_RECORDED">{t('actions.CONSENT_RECORDED')}</option>
                <option value="DATA_EXPORTED">{t('actions.DATA_EXPORTED')}</option>
              </select>
            </div>
          </div>
        </CardBody>
      </Card>

      {data && data.actionSummary.length > 0 && (
        <div className="row g-3 mb-3">
          {data.actionSummary.map((s) => (
            <div key={s.action} className="col-md-4">
              <Card className="border-0 shadow-sm h-100">
                <CardBody className="p-3">
                  <Badge color={ACTION_COLORS[s.action] ?? 'secondary'} className="mb-2" style={{ fontSize: '0.72rem' }}>
                    {t(`actions.${s.action}` as 'actions.DATA_DELETED' | 'actions.CONSENT_RECORDED' | 'actions.DATA_EXPORTED')}
                  </Badge>
                  <div className="fw-bold" style={{ fontSize: '1.4rem', color: '#17324D' }}>
                    {s.count}
                  </div>
                  <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                    {t('recordsAffected', { count: s.totalRecords })}
                  </div>
                </CardBody>
              </Card>
            </div>
          ))}
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
                    <th>{t('colWhen')}</th>
                    <th>{t('colAction')}</th>
                    <th>{t('colEvent')}</th>
                    <th className="text-end">{t('colRecords')}</th>
                    <th>{t('colDetails')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="text-muted" style={{ fontSize: '0.75rem' }}>
                        {fmt.dateTime(new Date(r.createdAt), { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td>
                        <Badge color={ACTION_COLORS[r.action] ?? 'secondary'} style={{ fontSize: '0.7rem' }}>
                          {t(`actions.${r.action}` as 'actions.DATA_DELETED' | 'actions.CONSENT_RECORDED' | 'actions.DATA_EXPORTED')}
                        </Badge>
                      </td>
                      <td>
                        <Link href={`/admin/events/${r.eventId}`} className="text-decoration-none">
                          {r.eventTitle}
                        </Link>
                      </td>
                      <td className="text-end fw-semibold">{r.recordCount}</td>
                      <td className="text-muted" style={{ fontSize: '0.72rem', maxWidth: 400, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {r.details ?? '—'}
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
