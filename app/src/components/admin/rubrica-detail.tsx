'use client';

/**
 * Admin rubrica person detail.
 *
 * Shows profile fields + event attendance history. Deletion is hard
 * (GDPR Art. 17) — registrations keep existing with personId cleared
 * via onDelete: SetNull on the FK, so event analytics are preserved.
 */

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Button, Card, CardBody } from 'design-react-kit';

import { Link, percorso, useRouter } from '@/i18n/navigation';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { SkeletonLines } from '@/components/ui/skeleton';
import { eventAdminPath } from '@/lib/events/admin-links';
import { getLocalized } from '@/lib/utils/locale';

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
    event: { id: string; slug: string; title: Record<string, string>; startsAt: string };
  }>;
}

export default function RubricaDetail({ id }: { id: string }) {
  const t = useTranslations('admin.rubrica');
  const tTypes = useTranslations('admin.registrations.orgTypes');
  const tc = useTranslations('common');
  const format = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
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
    } catch {
      // Resta senza dati: si mostra l'errore generico.
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = useCallback(async () => {
    const ok = await confirm({
      title: t('deleteTitle'),
      message: t('deleteMessage'),
      confirmLabel: tc('delete'),
      danger: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/rubrica/${id}`, { method: 'DELETE' });
      if (res.ok) {
        router.push('/admin/rubrica');
        return;
      }
      toast.error(t('deleteFailed'));
    } catch {
      toast.error(t('deleteFailed'));
    }
    setDeleting(false);
  }, [id, router, confirm, toast, t, tc]);

  const tipo = (code: string | null) => (code ? (tTypes.has(code) ? tTypes(code) : code) : null);
  const data_ = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });
  const dataOra = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });

  if (loading) return <SkeletonLines lines={5} loadingLabel={tc('loading')} />;
  if (notFound) return <p className="text-muted">{t('notFound')}</p>;
  if (!data) return <div className="alert alert-danger" role="alert">{tc('errorGeneric')}</div>;

  return (
    <div className="d-flex flex-column gap-3">
      <Card className="shadow-sm border-0" style={{ borderRadius: 8 }}>
        <CardBody className="p-4">
          <div className="d-flex justify-content-between flex-wrap gap-2 mb-3">
            <div>
              <h1 className="h2 fw-bold mb-1" style={{ color: 'var(--app-text)' }}>
                {data.displayName || t('noName')}
              </h1>
              <div className="text-muted small">
                {data.organization || '—'}
                {data.organizationRole && <> · {data.organizationRole}</>}
                {tipo(data.organizationType) && <> · {tipo(data.organizationType)}</>}
              </div>
            </div>
            <div>
              {data.optedInToAddressBook ? (
                <span className="badge bg-success">{t('statusActive')}</span>
              ) : (
                <span className="badge bg-secondary">{t('statusOptedOut')}</span>
              )}
            </div>
          </div>

          <dl className="row g-3 mb-0">
            <div className="col-md-3">
              <dt className="text-muted small fw-normal">{t('consentGivenAt')}</dt>
              <dd className="mb-0">{data.optedInAt ? dataOra(data.optedInAt) : '—'}</dd>
            </div>
            <div className="col-md-3">
              <dt className="text-muted small fw-normal">{t('optedOutAt')}</dt>
              <dd className="mb-0">{data.optedOutAt ? dataOra(data.optedOutAt) : '—'}</dd>
            </div>
            <div className="col-md-3">
              <dt className="text-muted small fw-normal">{t('col.lastActive')}</dt>
              <dd className="mb-0">{data_(data.lastActiveAt)}</dd>
            </div>
            <div className="col-md-3">
              <dt className="text-muted small fw-normal">{t('retentionMonths')}</dt>
              <dd className="mb-0">{data.retentionMonths}</dd>
            </div>
          </dl>

          <div className="mt-4 d-flex gap-2">
            <Button color="danger" outline size="sm" onClick={handleDelete} disabled={deleting}>
              {deleting ? t('deleting') : t('deleteButton')}
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card className="shadow-sm border-0" style={{ borderRadius: 8 }}>
        <CardBody className="p-4">
          <h2 className="h5 fw-semibold mb-3">
            {t('historyTitle', { count: data.registrations.length })}
          </h2>
          {data.registrations.length === 0 ? (
            <p className="text-muted small mb-0">{t('historyEmpty')}</p>
          ) : (
            <div className="table-responsive">
              <table className="table table-sm mb-0">
                <thead>
                  <tr>
                    <th scope="col">{t('col.event')}</th>
                    <th scope="col">{t('col.eventDate')}</th>
                    <th scope="col">{t('col.registeredAt')}</th>
                    <th scope="col">{t('col.orgSnapshot')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.registrations.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link href={percorso(eventAdminPath(r.event.id))}>
                          {getLocalized(r.event.title, locale) || r.event.slug}
                        </Link>
                      </td>
                      <td>{data_(r.event.startsAt)}</td>
                      <td>{data_(r.createdAt)}</td>
                      <td>
                        {r.organization || '—'}
                        {tipo(r.organizationType) && (
                          <span className="text-muted small"> · {tipo(r.organizationType)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
