'use client';

/**
 * Tab "Traduzioni" della gestione registrazione.
 *
 * Mostra le lingue già tradotte con i loro contenuti scaricabili (sintesi /
 * sottotitoli / doppiaggio) e permette di aggiungere una nuova lingua, che
 * accoda un TRANSLATE (+ DUB se il doppiaggio è attivo) via
 * POST /api/admin/postprod/recordings/[id]/translations.
 *
 * Strings sotto `admin.postprod.tm.*`. Bootstrap Italia, no <Icon>.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { SkeletonLines } from '@/components/ui/skeleton';

interface TranslatedLang {
  lang: string;
  hasSummary: boolean;
  hasSubtitle: boolean;
  hasDub: boolean;
}
interface TranslationsResponse {
  sourceLanguage: string;
  eventSlug: string | null;
  translated: TranslatedLang[];
  available: string[];
}

const fetcher = (url: string): Promise<TranslationsResponse> =>
  fetch(url, { credentials: 'include' }).then(async (r) => {
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try {
        const b = (await r.json()) as { error?: string; message?: string };
        msg = b.error ?? b.message ?? msg;
      } catch {
        /* keep */
      }
      throw new Error(msg);
    }
    return r.json() as Promise<TranslationsResponse>;
  });

export default function TranslationManager({
  recordingId,
  onChanged,
}: {
  recordingId: string;
  onChanged?: () => void;
}) {
  const t = useTranslations('admin.postprod.tm');
  const url = `/api/admin/postprod/recordings/${recordingId}/translations`;
  const { data, error, isLoading, mutate } = useSWR<TranslationsResponse>(url, fetcher);

  const [selected, setSelected] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleAdd() {
    if (!selected) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetLanguage: selected }),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const b = (await res.json()) as { error?: string; message?: string };
          msg = b.error ?? b.message ?? msg;
        } catch {
          /* keep */
        }
        throw new Error(msg);
      }
      setSelected('');
      await mutate();
      onChanged?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('unexpectedError'));
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading) return <SkeletonLines lines={3} loadingLabel={t('loading')} />;
  if (error || !data) {
    return <div className="alert alert-danger small mb-0" role="alert">{t('loadError')}</div>;
  }

  const slug = data.eventSlug;
  const dl = (lang: string, kind: 'summary' | 'subtitle' | 'dub') => {
    if (!slug) return null;
    if (kind === 'summary') return `/api/events/${slug}/postprod/download/summary.md?lang=${lang}`;
    if (kind === 'subtitle') return `/api/events/${slug}/postprod/subtitle/${lang}`;
    return `/api/events/${slug}/postprod/dubbed-audio/${lang}`;
  };

  return (
    <div>
      <div className="mb-3">
        <span className="text-secondary small me-2">{t('sourceLabel')}</span>
        <span className="badge bg-secondary text-uppercase">{data.sourceLanguage}</span>
      </div>

      <h6 className="text-uppercase text-secondary small mb-2">{t('translatedHeader')}</h6>
      {data.translated.length === 0 ? (
        <p className="text-secondary small">{t('noneYet')}</p>
      ) : (
        <div className="table-responsive mb-3">
          <table className="table table-sm align-middle mb-0">
            <thead>
              <tr className="small text-secondary">
                <th>{/* lang */}</th>
                <th>{t('summary')}</th>
                <th>{t('subtitles')}</th>
                <th>{t('dub')}</th>
              </tr>
            </thead>
            <tbody>
              {data.translated.map((tl) => (
                <tr key={tl.lang}>
                  <td>
                    <span className="badge bg-success-subtle text-success-emphasis border border-success-subtle text-uppercase">
                      {tl.lang}
                    </span>
                  </td>
                  <td>
                    {tl.hasSummary && slug ? (
                      <a className="small text-decoration-none" href={dl(tl.lang, 'summary')!}>
                        ✓ {t('download')}
                      </a>
                    ) : (
                      <span className="text-secondary">–</span>
                    )}
                  </td>
                  <td>
                    {tl.hasSubtitle && slug ? (
                      <a className="small text-decoration-none" href={dl(tl.lang, 'subtitle')!}>
                        ✓ {t('download')}
                      </a>
                    ) : (
                      <span className="text-secondary">–</span>
                    )}
                  </td>
                  <td>
                    {tl.hasDub && slug ? (
                      <a className="small text-decoration-none" href={dl(tl.lang, 'dub')!}>
                        ✓ {t('download')}
                      </a>
                    ) : (
                      <span className="text-secondary">–</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Aggiungi lingua, oppure messaggio chiaro quando sono tutte tradotte. */}
      {data.available.length === 0 ? (
        <p className="text-secondary small mb-2">{t('allTranslated')}</p>
      ) : (
        <div className="d-flex flex-wrap gap-2 align-items-end mb-2">
          <div>
            <label htmlFor={`add-lang-${recordingId}`} className="form-label small mb-1">
              {t('addLabel')}
            </label>
            <select
              id={`add-lang-${recordingId}`}
              className="form-select form-select-sm"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              disabled={submitting}
            >
              <option value="">{t('selectPlaceholder')}</option>
              {data.available.map((lang) => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => void handleAdd()}
            disabled={!selected || submitting}
          >
            {submitting ? t('adding') : t('addButton')}
          </button>
        </div>
      )}

      {actionError && (
        <div className="alert alert-danger small mt-2 mb-0" role="alert">{actionError}</div>
      )}
      <p className="text-secondary small mt-2 mb-0">{t('note')}</p>
    </div>
  );
}
