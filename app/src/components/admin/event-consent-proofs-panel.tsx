'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';

import { salvaRisposta } from '@/lib/utils/download';

/**
 * Le prove dei consensi dell'evento (lib/gdpr/consent-proofs): quanti
 * consensi alla registrazione e alla trascrizione valgono, quanti sono stati
 * ritirati, e l'elenco completo in CSV, con i nomi, per dimostrarli. Solo per
 * lo staff che gestisce l'evento: la rotta non accetta il link del moderatore.
 */

interface Riepilogo {
  summary: Record<'recording' | 'transcription', { given: number; withdrawn: number }>;
  total: number;
}

const fetcher = async (url: string): Promise<Riepilogo> => {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Riepilogo;
};

export default function EventConsentProofsPanel({
  eventId,
  locale,
}: {
  eventId: string;
  locale: string;
}) {
  const t = useTranslations('admin.consentProofs');
  const [scaricando, setScaricando] = useState(false);
  const [erroreCsv, setErroreCsv] = useState(false);
  const { data, error, isLoading } = useSWR(
    `/api/admin/events/${eventId}/consents`,
    fetcher
  );

  const scaricaCsv = async () => {
    setScaricando(true);
    setErroreCsv(false);
    try {
      const res = await fetch(
        `/api/admin/events/${eventId}/consents?format=csv&locale=${locale}`,
        {
          credentials: 'include',
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await salvaRisposta(res, `consensi-${eventId.slice(0, 8)}.csv`);
    } catch {
      setErroreCsv(true);
    } finally {
      setScaricando(false);
    }
  };

  if (isLoading) return <p className="text-muted mb-0">{t('loading')}</p>;
  if (error || !data) return <p className="text-danger mb-0">{t('loadFailed')}</p>;
  if (data.total === 0) return <p className="text-secondary mb-0">{t('none')}</p>;

  return (
    <div>
      <ul className="list-unstyled mb-3">
        {(['recording', 'transcription'] as const).map((k) => (
          <li key={k} className="mb-1">
            <strong>{t(`kinds.${k}`)}</strong>
            {': '}
            {t('counts', {
              given: data.summary[k].given,
              withdrawn: data.summary[k].withdrawn,
            })}
          </li>
        ))}
      </ul>
      <p className="small text-secondary mb-3">{t('countsNote')}</p>
      <button
        type="button"
        className="btn btn-outline-primary btn-sm"
        onClick={() => void scaricaCsv()}
        disabled={scaricando}
      >
        {scaricando ? t('downloading') : t('download')}
      </button>
      <p className="small text-secondary mt-2 mb-0">{t('downloadNote')}</p>
      {erroreCsv && (
        <p className="small text-danger mt-2 mb-0" role="alert">
          {t('downloadFailed')}
        </p>
      )}
    </div>
  );
}
