'use client';

/**
 * Admin rubrica list — displays Person rows with filters.
 *
 * The rubrica is intentionally email-free: we show displayName +
 * organization only. PII (encrypted email) still lives on the
 * Registration rows; the Person row keeps an emailHash for dedup.
 * Opening a detail page shows the per-event attendance history.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, CardBody, Input, Label } from 'design-react-kit';

const ORG_TYPES = [
  'MINISTRY', 'AGENCY', 'REGION', 'PROVINCE', 'MUNICIPALITY',
  'ASL', 'UNIVERSITY', 'PUBLIC_ENTITY', 'IN_HOUSE', 'OTHER',
];

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
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [orgType, setOrgType] = useState('');
  const [includeOptedOut, setIncludeOptedOut] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (q) qs.set('q', q);
      if (orgType) qs.set('orgType', orgType);
      if (includeOptedOut) qs.set('includeOpted', 'out');
      const res = await fetch(`/api/admin/rubrica?${qs}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setRows(data.rows);
        setTotal(data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [q, orgType, includeOptedOut]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <Card className="shadow-sm border-0 mb-4" style={{ borderRadius: 8 }}>
        <CardBody className="p-3">
          <div className="row g-3 align-items-end">
            <div className="col-md-4">
              <Label>Cerca per nome o organizzazione</Label>
              <Input
                type="text"
                value={q}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
                placeholder="Es. Ministero, Mario Rossi…"
              />
            </div>
            <div className="col-md-3">
              <Label>Tipo organizzazione</Label>
              <select
                className="form-select"
                value={orgType}
                onChange={(e) => setOrgType(e.target.value)}
              >
                <option value="">— tutti —</option>
                {ORG_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="col-md-3">
              <div className="form-check mt-4">
                <input
                  type="checkbox"
                  id="includeOptedOut"
                  className="form-check-input"
                  checked={includeOptedOut}
                  onChange={(e) => setIncludeOptedOut(e.target.checked)}
                />
                <label htmlFor="includeOptedOut" className="form-check-label">
                  Includi cancellati (opt-out)
                </label>
              </div>
            </div>
            <div className="col-md-2">
              <Button color="primary" size="sm" onClick={load}>
                Filtra
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      <div className="mb-3 text-muted small">
        {total} {total === 1 ? 'persona' : 'persone'} nella rubrica.
      </div>

      {loading ? (
        <div className="text-muted">Caricamento…</div>
      ) : rows.length === 0 ? (
        <div className="text-muted">Nessuna persona corrisponde ai filtri.</div>
      ) : (
        <Card className="shadow-sm border-0" style={{ borderRadius: 8 }}>
          <CardBody className="p-0">
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Organizzazione</th>
                  <th>Tipo</th>
                  <th className="text-end">Eventi</th>
                  <th>Ultima attività</th>
                  <th>Stato</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.displayName || '—'}</td>
                    <td>{r.organization || '—'}</td>
                    <td>{r.organizationType || '—'}</td>
                    <td className="text-end">{r.registrationCount}</td>
                    <td>{new Date(r.lastActiveAt).toLocaleDateString('it')}</td>
                    <td>
                      {r.optedInToAddressBook ? (
                        <span className="badge bg-success">Attivo</span>
                      ) : (
                        <span className="badge bg-secondary">Opt-out</span>
                      )}
                    </td>
                    <td>
                      <Link
                        href={`/admin/rubrica/${r.id}`}
                        className="btn btn-sm btn-outline-primary"
                      >
                        Dettaglio
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
