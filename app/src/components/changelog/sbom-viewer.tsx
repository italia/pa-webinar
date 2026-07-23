'use client';

import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import type { SbomSummary } from '@/lib/changelog/sbom';

/**
 * Changelog SBOM viewer: a chip that opens an in-page modal listing the
 * components of a release's SBOM, searchable. The 640 KB SPDX never reaches the
 * browser — the modal fetches the trimmed summary from
 * `/api/changelog/:version/sbom` (server-parsed, cached) on first open.
 *
 * Uses the native <dialog> element so focus-trap and Escape-to-close come for
 * free and correct; a click on the backdrop closes it too.
 */
export function SbomViewer({ version, rawUrl }: { version: string; rawUrl: string }) {
  const t = useTranslations('changelog');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SbomSummary | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');

  // Retryable: a transient failure leaves `data` null and `loading` false, so
  // reopening the modal fetches again (and clears the previous error) instead of
  // latching "couldn't load" until a full page reload.
  const load = useCallback(async () => {
    if (loading || data) return;
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/changelog/${encodeURIComponent(version)}/sbom`);
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as SbomSummary);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [loading, data, version]);

  const open = useCallback(() => {
    dialogRef.current?.showModal();
    void load();
  }, [load]);

  const close = useCallback(() => dialogRef.current?.close(), []);

  // Close when the backdrop (the dialog element itself, outside its content) is
  // clicked. Clicks inside the content card have a different target.
  const onDialogClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (e.target === dialogRef.current) close();
    },
    [close],
  );

  const filtered = (data?.components ?? []).filter((c) =>
    query.trim() ? c.name.toLowerCase().includes(query.trim().toLowerCase()) : true,
  );

  const ecoLine = data
    ? Object.entries(data.byEcosystem)
        .sort((a, b) => b[1] - a[1])
        .map(([eco, n]) => `${eco} ${n}`)
        .join(' · ')
    : '';

  const titleId = `sbom-title-${version}`;

  return (
    <>
      <button
        type="button"
        className="btn btn-outline-primary btn-sm"
        style={{ fontSize: '0.8rem' }}
        onClick={open}
      >
        📦 {t('sbomButton')}
      </button>

      <dialog
        ref={dialogRef}
        onClick={onDialogClick}
        aria-labelledby={titleId}
        style={{
          width: 'min(680px, 94vw)',
          maxWidth: '94vw',
          border: 'none',
          borderRadius: 10,
          padding: 0,
          boxShadow: '0 10px 40px rgba(0,0,0,0.25)',
        }}
      >
        <div className="d-flex flex-column" style={{ maxHeight: '82vh' }}>
          <div className="d-flex align-items-start justify-content-between p-3 border-bottom">
            <div>
              <h2 id={titleId} className="h6 mb-1">
                {t('sbomButton')} · v{version}
              </h2>
              {data && (
                <p className="text-muted mb-0" style={{ fontSize: '0.8rem' }}>
                  <span lang="en">{data.image}</span>
                  {data.tool ? ` · ${data.tool}` : ''}
                </p>
              )}
            </div>
            <button
              type="button"
              className="btn btn-link p-0 text-decoration-none"
              onClick={close}
              aria-label={t('sbomClose')}
              style={{ fontSize: '1.4rem', lineHeight: 1 }}
            >
              ×
            </button>
          </div>

          {error && !loading && (
            <div className="p-3">
              <p className="mb-0">
                {t('sbomError')}{' '}
                <a href={rawUrl} target="_blank" rel="noopener noreferrer">
                  {t('sbomDownload')} ↗
                </a>
              </p>
            </div>
          )}

          {loading && (
            <div className="p-4 text-center text-muted">{t('sbomLoading')}</div>
          )}

          {!error && !loading && data && (
            <>
              <div className="px-3 pt-3">
                <p className="mb-2" style={{ fontSize: '0.85rem' }}>
                  <strong>{data.total}</strong> {t('sbomComponents')}
                  {ecoLine ? ` — ${ecoLine}` : ''}
                </p>
                <input
                  type="search"
                  className="form-control form-control-sm mb-2"
                  placeholder={t('sbomSearch')}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label={t('sbomSearch')}
                />
              </div>
              <div className="px-3 pb-2" style={{ overflowY: 'auto' }}>
                <table className="table table-sm table-hover mb-0" style={{ fontSize: '0.82rem' }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--app-surface, #fff)' }}>
                    <tr>
                      <th scope="col">{t('sbomColName')}</th>
                      <th scope="col">{t('sbomColVersion')}</th>
                      <th scope="col">{t('sbomColEcosystem')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((c, i) => (
                      <tr key={`${c.ecosystem}:${c.name}:${i}`}>
                        <td lang="en" style={{ wordBreak: 'break-all' }}>{c.name}</td>
                        <td lang="en">{c.version || '—'}</td>
                        <td>
                          <span className="badge bg-secondary" style={{ fontWeight: 400 }}>
                            {c.ecosystem}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={3} className="text-muted text-center py-3">
                          {t('sbomNoMatch')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="p-3 border-top">
                <a href={rawUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.85rem' }}>
                  {t('sbomDownload')} ↗
                </a>
              </div>
            </>
          )}
        </div>
      </dialog>
    </>
  );
}
