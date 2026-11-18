// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

'use client';

/**
 * L'elenco delle richieste di rimozione da una registrazione, per
 * l'amministrazione, con il modulo per registrarne una arrivata per altre vie.
 */
import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Badge, Button, Card, CardBody } from 'design-react-kit';

import { SkeletonLines } from '@/components/ui/skeleton';
import { Link, percorso, useRouter } from '@/i18n/navigation';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';

import NewRequestForm from './new-request-form';
import { COLORE_STATO, type StatoRichiesta } from './status';

interface Riga {
  id: string;
  status: StatoRichiesta;
  source: 'self-service' | 'admin';
  name: string | null;
  createdAt: string;
  closedAt: string | null;
  event: { id: string; title: unknown; startsAt: string };
}

export default function RequestsList() {
  const t = useTranslations('admin.recordingRemovals');
  const fmt = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const [filtro, setFiltro] = useState<'open' | 'all'>('open');
  const [righe, setRighe] = useState<Riga[] | null>(null);
  const [errore, setErrore] = useState(false);
  const [nuova, setNuova] = useState(false);

  const carica = useCallback(async () => {
    setErrore(false);
    try {
      const res = await fetch(`/api/admin/recording-removals?status=${filtro}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(String(res.status));
      setRighe(((await res.json()) as { requests: Riga[] }).requests);
    } catch {
      setErrore(true);
      setRighe([]);
    }
  }, [filtro]);

  useEffect(() => {
    setRighe(null);
    void carica();
  }, [carica]);

  return (
    <>
      <div className="d-flex flex-wrap gap-2 align-items-center justify-content-between mb-3">
        <div className="btn-group" role="group" aria-label={t('filterLabel')}>
          {(['open', 'all'] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              color="primary"
              outline={filtro !== f}
              aria-pressed={filtro === f}
              onClick={() => setFiltro(f)}
            >
              {f === 'open' ? t('filterOpen') : t('filterAll')}
            </Button>
          ))}
        </div>
        {!nuova && (
          <Button size="sm" color="primary" onClick={() => setNuova(true)}>
            {t('newOpen')}
          </Button>
        )}
      </div>

      {nuova && (
        <NewRequestForm
          onCancel={() => setNuova(false)}
          onCreated={(id) => router.push(percorso(`/admin/recording-removals/${id}`))}
        />
      )}

      {errore && (
        <div className="alert alert-danger" role="alert">
          {t('loadError')}
        </div>
      )}
      <Card className="border-0 shadow-sm">
        <CardBody className="p-0">
          {righe === null ? (
            <div className="p-3">
              <SkeletonLines lines={4} />
            </div>
          ) : righe.length === 0 ? (
            <p className="p-3 mb-0 text-muted">{t('empty')}</p>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover mb-0" style={{ fontSize: '0.9rem' }}>
                <thead>
                  <tr>
                    <th scope="col">{t('colReceived')}</th>
                    <th scope="col">{t('colPerson')}</th>
                    <th scope="col">{t('colEvent')}</th>
                    <th scope="col">{t('colSource')}</th>
                    <th scope="col">{t('colStatus')}</th>
                    <th scope="col">
                      <span className="visually-hidden">{t('open')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {righe.map((r) => (
                    <tr key={r.id}>
                      <td className="text-nowrap">
                        {fmt.dateTime(new Date(r.createdAt), {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </td>
                      <td>{r.name ?? t('unnamed')}</td>
                      <td>
                        {getLocalized(r.event.title as LocalizedField, locale)}
                        <div className="text-muted small">
                          {fmt.dateTime(new Date(r.event.startsAt), {
                            dateStyle: 'medium',
                          })}
                        </div>
                      </td>
                      <td>{t(`sources.${r.source}`)}</td>
                      <td>
                        <Badge color={COLORE_STATO[r.status]}>
                          {t(`statuses.${r.status}`)}
                        </Badge>
                      </td>
                      <td className="text-end">
                        <Link
                          className="btn btn-outline-primary btn-sm"
                          href={percorso(`/admin/recording-removals/${r.id}`)}
                        >
                          {t('open')}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </>
  );
}
