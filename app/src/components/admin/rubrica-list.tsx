'use client';

/**
 * Admin rubrica list — displays Person rows with filters.
 *
 * The rubrica is intentionally email-free: we show displayName +
 * organization only. PII (encrypted email) still lives on the
 * Registration rows; the Person row keeps an emailHash for dedup.
 * Opening a detail page shows the per-event attendance history.
 */

import { useEffect, useId, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Card, CardBody } from 'design-react-kit';

import { Link, percorso } from '@/i18n/navigation';
import { SkeletonLines } from '@/components/ui/skeleton';
import { ORGANIZATION_TYPES } from '@/lib/validation/schemas';

/** Attesa dopo l'ultimo tasto prima di cercare. */
const SEARCH_DELAY_MS = 300;

interface Row {
  id: string;
  displayName: string | null;
  organization: string | null;
  organizationRole: string | null;
  organizationType: string | null;
  optedInToAddressBook: boolean;
  optedInAt: string | null;
  optedOutAt: string | null;
  lastActiveAt: string;
  registrationCount: number;
}

export default function RubricaList() {
  const t = useTranslations('admin.rubrica');
  const tTypes = useTranslations('admin.registrations.orgTypes');
  const tc = useTranslations('common');
  const format = useFormatter();
  const id = useId();
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [orgType, setOrgType] = useState('');
  const [includeOptedOut, setIncludeOptedOut] = useState(false);

  // La ricerca parte quando si smette di scrivere, non a ogni tasto.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(q.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs = new URLSearchParams();
    if (query) qs.set('q', query);
    if (orgType) qs.set('orgType', orgType);
    if (includeOptedOut) qs.set('includeOpted', 'out');
    fetch(`/api/admin/rubrica?${qs}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { rows: Row[]; total: number };
        if (cancelled) return;
        setRows(data.rows);
        setTotal(data.total);
        setFailed(false);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, orgType, includeOptedOut]);

  const tipo = (code: string | null) =>
    code ? (tTypes.has(code) ? tTypes(code) : code) : '—';

  return (
    <div>
      <Card className="shadow-sm border-0 mb-4" style={{ borderRadius: 8 }}>
        <CardBody className="p-3">
          <div className="row g-3 align-items-end">
            <div className="col-md-5">
              <label className="form-label" htmlFor={`${id}-q`}>
                {t('searchLabel')}
              </label>
              <input
                id={`${id}-q`}
                type="search"
                className="form-control"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className="col-md-3">
              <label className="form-label" htmlFor={`${id}-type`}>
                {t('orgTypeLabel')}
              </label>
              <select
                id={`${id}-type`}
                className="form-select"
                value={orgType}
                onChange={(e) => setOrgType(e.target.value)}
              >
                <option value="">{t('allTypes')}</option>
                {ORGANIZATION_TYPES.map((code) => (
                  <option key={code} value={code}>{tipo(code)}</option>
                ))}
              </select>
            </div>
            <div className="col-md-4">
              <div className="form-check mb-2">
                <input
                  type="checkbox"
                  id={`${id}-out`}
                  className="form-check-input"
                  checked={includeOptedOut}
                  onChange={(e) => setIncludeOptedOut(e.target.checked)}
                />
                <label htmlFor={`${id}-out`} className="form-check-label">
                  {t('includeOptedOut')}
                </label>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      <p className="mb-3 text-muted small" role="status">
        {loading ? '' : t('count', { count: total })}
      </p>

      {loading ? (
        <SkeletonLines lines={5} loadingLabel={tc('loading')} />
      ) : failed ? (
        <div className="alert alert-danger" role="alert">{tc('errorGeneric')}</div>
      ) : rows.length === 0 ? (
        <p className="text-muted">{t('empty')}</p>
      ) : (
        <Card className="shadow-sm border-0" style={{ borderRadius: 8 }}>
          <CardBody className="p-0">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th scope="col">{t('col.name')}</th>
                    <th scope="col">{t('col.organization')}</th>
                    <th scope="col">{t('col.type')}</th>
                    <th scope="col" className="text-end">{t('col.events')}</th>
                    <th scope="col">{t('col.lastActive')}</th>
                    <th scope="col">{t('col.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link href={percorso(`/admin/rubrica/${r.id}`)}>
                          {r.displayName || t('noName')}
                        </Link>
                      </td>
                      <td>{r.organization || '—'}</td>
                      <td>{tipo(r.organizationType)}</td>
                      <td className="text-end">{r.registrationCount}</td>
                      <td>{format.dateTime(new Date(r.lastActiveAt), { dateStyle: 'medium' })}</td>
                      <td>
                        {r.optedInToAddressBook ? (
                          <span className="badge bg-success">{t('statusActive')}</span>
                        ) : (
                          <span className="badge bg-secondary">{t('statusOptedOut')}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
