'use client';

/**
 * Panoramica admin COMPLETA di una registrazione (feedback: "non si capisce
 * niente"). Vista d'insieme professionale e scansionabile:
 *   - KPI (durata, partecipanti, tracce, lingue, artefatti, stato/data);
 *   - timeline dei job della pipeline;
 *   - matrice lingue × artefatti con dimensioni + download;
 *   - player audio dei doppiaggi;
 *   - metriche dell'output LLM (sintesi) per lingua;
 *   - elenco dei file reali nello storage (con dimensioni);
 *   - tracce per-partecipante + parlanti;
 *   - trasparenza modelli (PipelineProvenance).
 *
 * Dati da `/api/admin/postprod/recordings/[id]/details` (un solo round-trip).
 * Niente <Icon> (hydration): glifi testuali. Solo Bootstrap Italia.
 */

import { useState } from 'react';
import useSWR from 'swr';
import { useTranslations, useLocale } from 'next-intl';

import { SkeletonLines } from '@/components/ui/skeleton';
import PipelineProvenance, {
  type PipelineSnapshot,
} from '@/components/events/pipeline-provenance';

interface Metrics {
  topics: number;
  decisions: number;
  actionItems: number;
  overallChars: number;
}
interface Details {
  recording: {
    id: string;
    status: string;
    runCount: number;
    sourceLanguage: string | null;
    durationSec: number | null;
    fileSizeBytes: number | null;
    createdAt: string;
    updatedAt: string;
    retentionUntil: string | null;
    eventTitle: string | null;
    eventSlug: string | null;
  };
  participants: { peak: number | null };
  tracks: {
    count: number;
    purged: number;
    items: Array<{
      participantId: string;
      displayName: string | null;
      startOffsetMs: number;
      durationMs: number | null;
      sizeBytes: number | null;
      purged: boolean;
    }>;
  };
  jobs: Array<{
    kind: string;
    status: string;
    attempts: number;
    durationSec: number | null;
    lastError: string | null;
    createdAt: string;
  }>;
  artifacts: Array<{
    type: string;
    language: string | null;
    sizeBytes: number | null;
    blobKey: string;
    modelId: string | null;
    watermark: string | null;
  }>;
  storageFiles: Array<{ key: string; sizeBytes: number | null }>;
  llm: { perLanguage: Record<string, Metrics>; model: string | null };
  dubbedAudio: Array<{ language: string; url: string; sizeBytes: number | null; watermark: string | null }>;
  speakers: Array<{ diarLabel: string; displayName: string | null; totalSpeechSec: number }>;
  pipelineSnapshot?: PipelineSnapshot | null;
}

const fetcher = (url: string): Promise<Details> =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json() as Promise<Details>;
  });

function fmtBytes(n: number | null): string {
  if (n == null) return '–';
  if (n === 0) return '0';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}
function fmtDur(sec: number | null): string {
  if (sec == null) return '–';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}
function jobStatusClass(s: string): string {
  if (s === 'DONE') return 'bg-success';
  if (s === 'FAILED') return 'bg-danger';
  if (s === 'RUNNING' || s === 'CLAIMED') return 'bg-info text-dark';
  return 'bg-secondary';
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border rounded p-3 text-center" style={{ background: '#fff', minWidth: 120 }}>
      <div className="fw-bold" style={{ fontSize: '1.4rem', color: 'var(--app-text)' }}>{value}</div>
      <div className="small text-secondary text-uppercase" style={{ fontSize: '0.68rem', letterSpacing: 0.4 }}>{label}</div>
      {sub && <div className="small text-secondary" style={{ fontSize: '0.72rem' }}>{sub}</div>}
    </div>
  );
}

export default function RecordingOverview({ recordingId }: { recordingId: string }) {
  const t = useTranslations('admin.postprod.ov');
  const locale = useLocale();
  const { data, error, isLoading } = useSWR<Details>(
    `/api/admin/postprod/recordings/${recordingId}/details`,
    fetcher,
  );
  const [sumLang, setSumLang] = useState<string | null>(null);
  const [showFiles, setShowFiles] = useState(false);

  if (isLoading) return <SkeletonLines lines={8} loadingLabel={t('tab')} />;
  if (error) return <div className="alert alert-info small mb-0" role="status">{t('processing')}</div>;
  if (!data) return <div className="alert alert-danger small mb-0" role="alert">{t('loadError')}</div>;

  const { recording: r, participants, tracks, jobs, artifacts, storageFiles, llm, dubbedAudio, speakers } = data;
  const slug = r.eventSlug;

  // Lingue presenti (union da artefatti + sorgente).
  const artLangs = new Set<string>();
  for (const a of artifacts) if (a.language) artLangs.add(a.language);
  const langs = Array.from(new Set([r.sourceLanguage ?? 'it', ...artLangs])).sort((a, b) =>
    a === (r.sourceLanguage ?? 'it') ? -1 : b === (r.sourceLanguage ?? 'it') ? 1 : a.localeCompare(b),
  );
  const hasType = (type: string, lang: string | null) =>
    artifacts.find((a) => a.type === type && (lang ? a.language === lang : true));

  const structuredLangs = Object.keys(llm.perLanguage);
  const activeSumLang =
    sumLang && llm.perLanguage[sumLang] ? sumLang
      : llm.perLanguage[r.sourceLanguage ?? 'it'] ? (r.sourceLanguage ?? 'it')
        : (structuredLangs[0] ?? null);
  const metrics = activeSumLang ? llm.perLanguage[activeSumLang] : null;

  const cell = (present: boolean, extra?: React.ReactNode) =>
    present ? <>{extra ?? <span className="text-success">✓</span>}</> : <span className="text-secondary">–</span>;

  return (
    <div>
      {/* ── KPI ───────────────────────────────────────────── */}
      <div className="d-flex flex-wrap gap-2 mb-4">
        <Kpi label={t('kpiDuration')} value={fmtDur(r.durationSec)} sub={r.fileSizeBytes != null ? fmtBytes(r.fileSizeBytes) : undefined} />
        <Kpi label={t('kpiParticipants')} value={participants.peak != null ? String(participants.peak) : '–'} />
        <Kpi label={t('kpiTracks')} value={String(tracks.count)} sub={tracks.purged > 0 ? `${tracks.purged} ${t('trackPurged')}` : undefined} />
        <Kpi label={t('kpiLanguages')} value={String(langs.length)} sub={langs.map((l) => l.toUpperCase()).join(' · ')} />
        <Kpi label={t('kpiArtifacts')} value={String(artifacts.length)} />
        <Kpi label={t('kpiProcessed')} value={new Date(r.updatedAt).toLocaleDateString(locale)} sub={`${t('run')} #${r.runCount}`} />
      </div>

      {/* ── Timeline job ──────────────────────────────────── */}
      <h6 className="fw-semibold mb-2">{t('jobsTitle')}</h6>
      {jobs.length === 0 ? (
        <p className="text-secondary small">{t('jobsNone')}</p>
      ) : (
        <div className="d-flex flex-wrap gap-2 mb-4">
          {jobs.map((j, i) => (
            <div key={i} className="border rounded px-2 py-1 small" style={{ background: '#fff' }} title={j.lastError ?? ''}>
              <span className={`badge ${jobStatusClass(j.status)} me-1`} style={{ fontSize: '0.62rem' }}>{j.status}</span>
              <span className="fw-medium">{j.kind}</span>
              {j.durationSec != null && <span className="text-secondary"> · {fmtDur(j.durationSec)}</span>}
              {j.attempts > 1 && <span className="text-warning"> · {t('attempts', { n: j.attempts })}</span>}
              {j.lastError && <span className="text-danger"> · ⚠</span>}
            </div>
          ))}
        </div>
      )}

      {/* ── Matrice lingue × artefatti ────────────────────── */}
      <h6 className="fw-semibold mb-2">{t('langsTitle')}</h6>
      <div className="table-responsive mb-4">
        <table className="table table-sm align-middle mb-0">
          <thead><tr className="small text-secondary">
            <th>{t('colLang')}</th><th>{t('colTranscript')}</th><th>{t('colSummary')}</th><th>{t('colSubtitles')}</th><th>{t('colDub')}</th>
          </tr></thead>
          <tbody>
            {langs.map((l) => {
              const isSrc = l === (r.sourceLanguage ?? 'it');
              const sumArt = hasType('SUMMARY_MD', l) || hasType('SUMMARY_JSON', l) || hasType('TRANSLATION_MD', l);
              const subArt = hasType('TRANSCRIPT_VTT', l) || hasType('TRANSLATION_VTT', l) || hasType('SUBTITLE_VTT', l);
              const dubArt = artifacts.find((a) => a.type === 'DUBBED_AUDIO' && a.language === l);
              return (
                <tr key={l}>
                  <td><strong className="text-uppercase">{l}</strong>{isSrc && <span className="text-secondary small"> ({t('source')})</span>}</td>
                  <td>{cell(isSrc)}</td>
                  <td>{cell(!!sumArt, sumArt && slug ? (
                    <a className="small text-decoration-none" href={`/api/events/${slug}/postprod/download/summary.md?lang=${l}`}>✓ .md <span className="text-secondary">({fmtBytes(sumArt.sizeBytes)})</span></a>
                  ) : undefined)}</td>
                  <td>{cell(!!subArt, subArt && slug ? (
                    <a className="small text-decoration-none" href={`/api/events/${slug}/postprod/subtitle/${l}`}>✓ .vtt <span className="text-secondary">({fmtBytes(subArt.sizeBytes)})</span></a>
                  ) : undefined)}</td>
                  <td>{cell(!!dubArt, dubArt ? (
                    <span className="small">✓ <span className="text-secondary">({fmtBytes(dubArt.sizeBytes)}{dubArt.watermark ? ' · 🔏' : ''})</span></span>
                  ) : undefined)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Player dub ────────────────────────────────────── */}
      <h6 className="fw-semibold mb-2">{t('dubTitle')}</h6>
      {dubbedAudio.length === 0 ? (
        <p className="text-secondary small">{t('dubNone')}</p>
      ) : (
        <div className="d-flex flex-column gap-2 mb-4">
          {dubbedAudio.map((d) => (
            <div key={d.language} className="d-flex align-items-center gap-2">
              <span className="badge bg-secondary text-uppercase" style={{ minWidth: 38 }}>{d.language}</span>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio controls preload="none" src={d.url} style={{ height: 38, maxWidth: 460 }} />
              <span className="small text-secondary">{fmtBytes(d.sizeBytes)}{d.watermark ? ` · ${d.watermark}` : ''}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Metriche LLM + anteprima sintesi ──────────────── */}
      <h6 className="fw-semibold mb-2 d-flex align-items-center gap-2">
        {t('metricsTitle')}
        {structuredLangs.length > 1 && (
          <select className="form-select form-select-sm" style={{ width: 'auto' }} value={activeSumLang ?? ''} onChange={(e) => setSumLang(e.target.value)} aria-label={t('summaryLang')}>
            {structuredLangs.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </select>
        )}
      </h6>
      {!metrics ? (
        <p className="text-secondary small mb-4">{t('summaryNone')}</p>
      ) : (
        <div className="d-flex flex-wrap gap-2 mb-4">
          <Kpi label={t('topics')} value={String(metrics.topics)} />
          <Kpi label={t('decisions')} value={String(metrics.decisions)} />
          <Kpi label={t('actions')} value={String(metrics.actionItems)} />
          <Kpi label={t('chars')} value={String(metrics.overallChars)} />
          {llm.model && <Kpi label={t('model')} value={llm.model} />}
        </div>
      )}

      {/* ── Tracce per partecipante ───────────────────────── */}
      <h6 className="fw-semibold mb-2">{t('tracksTitle')}</h6>
      {tracks.items.length === 0 ? (
        <p className="text-secondary small mb-4">{t('tracksNone')}</p>
      ) : (
        <div className="table-responsive mb-4">
          <table className="table table-sm align-middle mb-0">
            <tbody>
              {tracks.items.map((tr, i) => (
                <tr key={i}>
                  <td><strong>{tr.displayName || tr.participantId.slice(0, 10)}</strong></td>
                  <td className="small text-secondary">{t('trackEnters', { s: Math.round(tr.startOffsetMs / 1000) })}</td>
                  <td className="small text-secondary">{tr.durationMs != null ? fmtDur(tr.durationMs / 1000) : '–'}</td>
                  <td className="small text-secondary">{fmtBytes(tr.sizeBytes)}</td>
                  <td>{tr.purged && <span className="badge bg-light text-secondary border">{t('trackPurged')}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Parlanti ──────────────────────────────────────── */}
      <h6 className="fw-semibold mb-2">{t('speakersTitle')}</h6>
      <div className="d-flex flex-wrap gap-2 mb-4">
        {speakers.length === 0 ? <span className="text-secondary small">–</span> : speakers.map((sp) => (
          <span key={sp.diarLabel} className="badge bg-light text-dark border">
            {sp.displayName || `${sp.diarLabel} · ${t('speakerAnon')}`}
            <span className="text-secondary"> · {fmtDur(sp.totalSpeechSec)}</span>
          </span>
        ))}
      </div>

      {/* ── File nello storage ────────────────────────────── */}
      <h6 className="fw-semibold mb-2">{t('filesTitle')}</h6>
      {storageFiles.length === 0 ? (
        <p className="text-secondary small mb-4">{t('filesNone')}</p>
      ) : (
        <div className="mb-4">
          <button type="button" className="btn btn-sm btn-outline-secondary mb-2" onClick={() => setShowFiles((v) => !v)} aria-expanded={showFiles}>
            {t('filesToggle', { n: storageFiles.length })}
          </button>
          {showFiles && (
            <div className="table-responsive">
              <table className="table table-sm font-monospace mb-0" style={{ fontSize: '0.78rem' }}>
                <tbody>
                  {storageFiles.map((f) => (
                    <tr key={f.key}>
                      <td className="text-break">{f.key}</td>
                      <td className="text-end text-secondary" style={{ whiteSpace: 'nowrap' }}>{fmtBytes(f.sizeBytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Trasparenza modelli ───────────────────────────── */}
      {data.pipelineSnapshot && <PipelineProvenance snapshot={data.pipelineSnapshot} locale={locale} />}

      <p className="text-secondary small mt-3 mb-0">{t('editHint')}</p>
    </div>
  );
}
