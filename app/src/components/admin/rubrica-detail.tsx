'use client';

/**
 * Admin rubrica person detail.
 *
 * Shows profile fields + event attendance history. Deletion is hard
 * (GDPR Art. 17) — registrations keep existing with personId cleared
 * via onDelete: SetNull on the FK, so event analytics are preserved.
 */

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, CardBody } from 'design-react-kit';

interface Detail {
  id: string;
  displayName: string | null;
  organization: string | null;
  organizationRole: string | null;
  organizationType: string | null;
  optedInToAddressBook: boolean;
  optedInAt: string | null;
  optedOutAt: string | null;
  lastActiveAt: string;
  retentionMonths: number;
  createdAt: string;
  registrations: Array<{
    id: string;
    createdAt: string;
    organization: string | null;
    organizationRole: string | null;
    organizationType: string | null;
    event: { slug: string; title: Record<string, string>; startsAt: string };
  }>;
}

export default function RubricaDetail({ id }: { id: string }) {
  const router = useRouter();
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/rubrica/${id}`, { cache: 'no-store' });
      if (res.status === 404) {
        setNotFound(true);
      } else if (res.ok) {
        setData(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = useCallback(async () => {
    if (!confirm('Eliminare definitivamente questa persona dalla rubrica? L\'operazione è irreversibile ma preserva lo storico delle iscrizioni.')) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/rubrica/${id}`, { method: 'DELETE' });
      if (res.ok) {
        router.push('/admin/rubrica');
      } else {
        alert('Errore durante l\'eliminazione.');
        setDeleting(false);
      }
    } catch {
      alert('Errore di rete.');
      setDeleting(false);
    }
  }, [id, router]);

  if (loading) return <div className="text-muted">Caricamento…</div>;
  if (notFound) return <div className="text-muted">Persona non trovata.</div>;
  if (!data) return <div className="text-muted">Errore.</div>;

  return (
    <div className="d-flex flex-column gap-3">
      <Card className="shadow-sm border-0" style={{ borderRadius: 8 }}>
        <CardBody className="p-4">
          <div className="d-flex justify-content-between flex-wrap gap-2 mb-3">
            <div>
              <h2 className="fw-semibold mb-1" style={{ color: '#17324D' }}>
                {data.displayName || '(senza nome)'}
              </h2>
              <div className="text-muted small">
                {data.organization || '—'}
                {data.organizationRole && <> · {data.organizationRole}</>}
                {data.organizationType && <> · {data.organizationType}</>}
              </div>
            </div>
            <div>
              {data.optedInToAddressBook ? (
                <span className="badge bg-success">Opt-in attivo</span>
              ) : (
                <span className="badge bg-secondary">Opt-out</span>
              )}
            </div>
          </div>

          <div className="row g-3">
            <div className="col-md-3">
              <div className="text-muted small">Consenso dato il</div>
              <div>{data.optedInAt ? new Date(data.optedInAt).toLocaleString('it') : '—'}</div>
            </div>
            <div className="col-md-3">
              <div className="text-muted small">Opt-out</div>
              <div>{data.optedOutAt ? new Date(data.optedOutAt).toLocaleString('it') : '—'}</div>
            </div>
            <div className="col-md-3">
              <div className="text-muted small">Ultima attività</div>
              <div>{new Date(data.lastActiveAt).toLocaleDateString('it')}</div>
            </div>
            <div className="col-md-3">
              <div className="text-muted small">Retention</div>
              <div>{data.retentionMonths} mesi</div>
            </div>
          </div>

          <div className="mt-4 d-flex gap-2">
            <Button color="danger" outline size="sm" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Eliminazione…' : 'Elimina dalla rubrica (art. 17)'}
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card className="shadow-sm border-0" style={{ borderRadius: 8 }}>
        <CardBody className="p-4">
          <h5 className="fw-semibold mb-3">Storico iscrizioni ({data.registrations.length})</h5>
          {data.registrations.length === 0 ? (
            <div className="text-muted small">Nessuna iscrizione registrata.</div>
          ) : (
            <table className="table table-sm mb-0">
              <thead>
                <tr>
                  <th>Evento</th>
                  <th>Data evento</th>
                  <th>Data iscrizione</th>
                  <th>Organizzazione (snapshot)</th>
                </tr>
              </thead>
              <tbody>
                {data.registrations.map((r) => {
                  const title = r.event.title?.it || r.event.slug;
                  return (
                    <tr key={r.id}>
                      <td>
                        <a href={`/admin/events/${r.event.slug}`} className="text-decoration-none">
                          {title}
                        </a>
                      </td>
                      <td>{new Date(r.event.startsAt).toLocaleDateString('it')}</td>
                      <td>{new Date(r.createdAt).toLocaleDateString('it')}</td>
                      <td>
                        {r.organization || '—'}
                        {r.organizationType && <span className="text-muted small"> · {r.organizationType}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
