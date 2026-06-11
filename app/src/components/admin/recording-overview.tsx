'use client';

/**
 * Panoramica admin di una registrazione: a colpo d'occhio COSA ha prodotto
 * la pipeline AI, lingua per lingua (trascrizione / sintesi / sottotitoli /
 * doppiaggio), con player audio per i dub e anteprima della sintesi tradotta.
 *
 * Sostituisce l'esperienza "tutto a tab di editor senza una vista d'insieme"
 * (feedback: "non si capisce niente"). I dati vengono dalla stessa route
 * pubblica del viewer (`/api/events/[slug]/postprod/transcript`), che espone
 * già inventario per-lingua + URL firmati per audio/sottotitoli/sintesi.
 *
 * Niente <Icon> (hydration); glifi testuali. Solo classi Bootstrap Italia.
 */

import { useState } from 'react';
import useSWR from 'swr';
import { useTranslations, useLocale } from 'next-intl';

import { SkeletonLines } from '@/components/ui/skeleton';
import PipelineProvenance, {
  type PipelineSnapshot,
} from '@/components/events/pipeline-provenance';

const fetcher = (url: string): Promise<OverviewData> =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json() as Promise<OverviewData>;
  });

interface Structured {
  overall_summary?: string;
  key_decisions?: string[];
  action_items?: string[];
  topics?: Array<{ title?: string; start_mmss?: string; summary?: string }>;
}

interface OverviewData {
  sourceLanguage: string;
  speakers: Array<{ diarLabel: string; displayName: string | null }>;
  subtitleTracks: string[];
  summaries: Record<string, string>;
  summariesStructured: Record<string, Structured>;
  dubbedAudio: Array<{ language: string; src: string }>;
  pipelineSnapshot?: PipelineSnapshot | null;
}

export default function RecordingOverview({ eventSlug }: { eventSlug: string | null }) {
  const t = useTranslations('admin.postprod.ov');
  const locale = useLocale();
  const { data, error, isLoading } = useSWR<OverviewData>(
    eventSlug ? `/api/events/${eventSlug}/postprod/transcript` : null,
    fetcher,
  );
  const [sumLang, setSumLang] = useState<string | null>(null);

  if (!eventSlug || error) {
    // 404 = registrazione non ancora POSTPROD_DONE/PARTIAL → nessun artefatto.
    return <div className="alert alert-info small mb-0" role="status">{t('processing')}</div>;
  }
  if (isLoading) return <SkeletonLines lines={6} loadingLabel={t('tab')} />;
  if (!data) return <div className="alert alert-danger small mb-0" role="alert">{t('loadError')}</div>;

  const dubByLang = new Map(data.dubbedAudio.map((d) => [d.language, d.src]));
  const langs = Array.from(
    new Set([
      data.sourceLanguage,
      ...data.subtitleTracks,
      ...Object.keys(data.summaries),
      ...data.dubbedAudio.map((d) => d.language),
    ]),
  ).sort((a, b) =>
    a === data.sourceLanguage ? -1 : b === data.sourceLanguage ? 1 : a.localeCompare(b),
  );

  const structuredLangs = Object.keys(data.summariesStructured);
  const activeSumLang =
    sumLang && data.summariesStructured[sumLang]
      ? sumLang
      : data.summariesStructured[data.sourceLanguage]
        ? data.sourceLanguage
        : (structuredLangs[0] ?? null);
  const sm = activeSumLang ? data.summariesStructured[activeSumLang] : null;
  const decisions = sm?.key_decisions ?? [];
  const actions = sm?.action_items ?? [];
  const topics = sm?.topics ?? [];

  const present = (
    <span className="badge bg-success-subtle text-success-emphasis border border-success-subtle">
      ✓ {t('present')}
    </span>
  );
  const absent = <span className="text-secondary small">– {t('absent')}</span>;

  return (
    <div>
      <p className="text-secondary small mb-3">{t('intro')}</p>

      {/* Matrice lingue × artefatti — la vista d'insieme che mancava. */}
      <h6 className="fw-semibold mb-2">{t('langsTitle')}</h6>
      <div className="table-responsive mb-4">
        <table className="table table-sm align-middle mb-0">
          <thead>
            <tr className="small text-secondary">
              <th>{t('colLang')}</th>
              <th>{t('colTranscript')}</th>
              <th>{t('colSummary')}</th>
              <th>{t('colSubtitles')}</th>
              <th>{t('colDub')}</th>
            </tr>
          </thead>
          <tbody>
            {langs.map((l) => {
              const isSrc = l === data.sourceLanguage;
              const hasSummary = !!(data.summaries[l] || data.summariesStructured[l]);
              const hasSub = data.subtitleTracks.includes(l);
              const dub = dubByLang.get(l);
              return (
                <tr key={l}>
                  <td>
                    <strong className="text-uppercase">{l}</strong>
                    {isSrc && <span className="text-secondary small"> ({t('source')})</span>}
                  </td>
                  {/* La trascrizione completa esiste solo nella lingua originale;
                      le altre lingue sono sottotitoli + sintesi tradotti. */}
                  <td>{isSrc ? present : absent}</td>
                  <td>
                    {hasSummary ? (
                      <a
                        className="small text-decoration-none"
                        href={`/api/events/${eventSlug}/postprod/download/summary.md?lang=${l}`}
                      >
                        ✓ {t('download')} .md
                      </a>
                    ) : (
                      absent
                    )}
                  </td>
                  <td>
                    {hasSub ? (
                      <a
                        className="small text-decoration-none"
                        href={`/api/events/${eventSlug}/postprod/subtitle/${l}`}
                      >
                        ✓ {t('download')} .vtt
                      </a>
                    ) : (
                      absent
                    )}
                  </td>
                  <td>
                    {dub ? (
                      <a className="small text-decoration-none" href={dub}>
                        ✓ {t('download')} .m4a
                      </a>
                    ) : (
                      absent
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Player dub: ascolto diretto, una riga per lingua. */}
      <h6 className="fw-semibold mb-2">{t('dubTitle')}</h6>
      {data.dubbedAudio.length === 0 ? (
        <p className="text-secondary small">{t('dubNone')}</p>
      ) : (
        <div className="d-flex flex-column gap-2 mb-4">
          {data.dubbedAudio.map((d) => (
            <div key={d.language} className="d-flex align-items-center gap-2">
              <span className="badge bg-secondary text-uppercase" style={{ minWidth: 38 }}>
                {d.language}
              </span>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption -- audio doppiato, i sottotitoli sono separati */}
              <audio controls preload="none" src={d.src} style={{ height: 38, maxWidth: 460 }} />
            </div>
          ))}
        </div>
      )}

      {/* Anteprima sintesi (selettore lingua). */}
      <h6 className="fw-semibold mb-2 d-flex align-items-center gap-2">
        {t('summaryTitle')}
        {structuredLangs.length > 1 && (
          <select
            className="form-select form-select-sm"
            style={{ width: 'auto' }}
            value={activeSumLang ?? ''}
            onChange={(e) => setSumLang(e.target.value)}
            aria-label={t('summaryLang')}
          >
            {structuredLangs.map((l) => (
              <option key={l} value={l}>
                {l.toUpperCase()}
              </option>
            ))}
          </select>
        )}
      </h6>
      {!sm ? (
        <p className="text-secondary small">{t('summaryNone')}</p>
      ) : (
        <div className="border rounded p-3 mb-4" style={{ background: '#f8f9fb' }}>
          {sm.overall_summary && (
            <p className="mb-2" style={{ whiteSpace: 'pre-wrap' }}>
              {sm.overall_summary}
            </p>
          )}
          {decisions.length > 0 && (
            <>
              <div className="fw-semibold small text-uppercase text-secondary mt-2">
                {t('decisions')}
              </div>
              <ul className="small mb-2">
                {decisions.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </>
          )}
          {actions.length > 0 && (
            <>
              <div className="fw-semibold small text-uppercase text-secondary">{t('actions')}</div>
              <ul className="small mb-2">
                {actions.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </>
          )}
          {topics.length > 0 && (
            <>
              <div className="fw-semibold small text-uppercase text-secondary">{t('topics')}</div>
              <ul className="small mb-0">
                {topics.map((tp, i) => (
                  <li key={i}>
                    {tp.start_mmss && (
                      <span className="font-monospace text-secondary">{tp.start_mmss} </span>
                    )}
                    {tp.title}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {/* Parlanti: nome reale o "non assegnato". */}
      <h6 className="fw-semibold mb-2">{t('speakersTitle')}</h6>
      {data.speakers.length === 0 ? (
        <p className="text-secondary small">–</p>
      ) : (
        <div className="d-flex flex-wrap gap-2 mb-4">
          {data.speakers.map((sp) => (
            <span key={sp.diarLabel} className="badge bg-light text-dark border">
              {sp.displayName || `${sp.diarLabel} · ${t('speakerAnon')}`}
            </span>
          ))}
        </div>
      )}

      {/* Trasparenza modelli (stessa card del viewer pubblico). */}
      {data.pipelineSnapshot && (
        <PipelineProvenance snapshot={data.pipelineSnapshot} locale={locale} />
      )}

      <p className="text-secondary small mt-3 mb-0">{t('editHint')}</p>
    </div>
  );
}
