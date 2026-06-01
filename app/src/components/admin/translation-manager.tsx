'use client';

/**
 * Per-recording translation language manager (admin).
 *
 * Loaded inside an expanded recording row in the postprod dashboard.
 * Shows the languages the recording is already translated into and lets
 * the operator add a new one, which enqueues a single TRANSLATE job via
 * POST /api/admin/postprod/recordings/[id]/translations.
 *
 * UI strings are inline Italian for now (i18n keys listed in the PR
 * report). Bootstrap Italia utility classes only — no <Icon> (it
 * triggers hydration mismatches), inline SVG where a glyph is needed.
 */

import { useState } from 'react';
import useSWR from 'swr';

const fetcher = (url: string): Promise<unknown> =>
  fetch(url, { credentials: 'include' }).then(async (r) => {
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try {
        const body = (await r.json()) as { error?: string; message?: string };
        msg = body.error ?? body.message ?? msg;
      } catch {
        /* keep status message */
      }
      throw new Error(msg);
    }
    return r.json();
  });

interface TranslationsResponse {
  sourceLanguage: string;
  translated: string[];
  available: string[];
}

export default function TranslationManager({
  recordingId,
  onChanged,
}: {
  recordingId: string;
  onChanged?: () => void;
}) {
  const url = `/api/admin/postprod/recordings/${recordingId}/translations`;
  const { data, error, isLoading, mutate } = useSWR<TranslationsResponse>(
    url,
    fetcher as (u: string) => Promise<TranslationsResponse>,
  );

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
          const body = (await res.json()) as { error?: string; message?: string };
          msg = body.error ?? body.message ?? msg;
        } catch {
          /* keep status message */
        }
        throw new Error(msg);
      }
      setSelected('');
      await mutate();
      onChanged?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Errore imprevisto');
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="text-secondary small" aria-live="polite">
        Caricamento lingue di traduzione…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="alert alert-danger small mb-0" role="alert">
        Impossibile caricare le lingue di traduzione.
      </div>
    );
  }

  return (
    <div>
      <h6 className="text-uppercase text-secondary small mb-2">
        Lingue di traduzione
      </h6>

      <div className="mb-2">
        <span className="text-secondary small me-2">Lingua sorgente:</span>
        <span className="badge bg-secondary text-uppercase">
          {data.sourceLanguage}
        </span>
      </div>

      <div className="mb-3">
        <span className="text-secondary small d-block mb-1">Già tradotte:</span>
        {data.translated.length === 0 ? (
          <span className="text-secondary small">Nessuna traduzione ancora.</span>
        ) : (
          <div className="d-flex flex-wrap gap-1">
            {data.translated.map((lang) => (
              <span
                key={lang}
                className="badge bg-success-subtle text-success-emphasis text-uppercase border border-success-subtle"
              >
                {lang}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="d-flex flex-wrap gap-2 align-items-end">
        <div>
          <label
            htmlFor={`add-lang-${recordingId}`}
            className="form-label small mb-1"
          >
            Aggiungi una lingua
          </label>
          <select
            id={`add-lang-${recordingId}`}
            className="form-select form-select-sm"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={submitting || data.available.length === 0}
          >
            <option value="">
              {data.available.length === 0
                ? 'Nessuna lingua disponibile'
                : 'Seleziona una lingua…'}
            </option>
            {data.available.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={handleAdd}
          disabled={!selected || submitting}
        >
          {submitting ? 'Aggiunta in corso…' : 'Aggiungi lingua'}
        </button>
      </div>

      {actionError ? (
        <div className="alert alert-danger small mt-2 mb-0" role="alert">
          {actionError}
        </div>
      ) : null}

      <p className="text-secondary small mt-2 mb-0">
        L&apos;aggiunta di una lingua genera la traduzione di transcript e
        sintesi: la lavorazione avviene in background.
      </p>
    </div>
  );
}
