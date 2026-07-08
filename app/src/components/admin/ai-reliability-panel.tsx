'use client';

/**
 * AI reliability panel.
 *
 * Operator-facing "how much can I trust this?" report for a recording's
 * post-production output. Surfaces, per pipeline stage: the model used, the
 * processing time, and — for the transcription — a confidence % derived from
 * whisper's per-segment avg_logprob, plus explicit warnings.
 *
 * Its reason to exist: a recording whose source audio was silent sailed
 * through the pipeline reporting "DONE" while producing an empty transcript
 * and a fully hallucinated summary. This panel makes that loud — 0 segments /
 * low confidence render as a red "non affidabile" verdict instead of a
 * confident lie. Fetches `/api/admin/postprod/recordings/[id]/reliability`.
 */

import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { SkeletonLines } from '@/components/ui/skeleton';

const fetcher = (url: string): Promise<unknown> =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });

type ReliabilityLevel = 'good' | 'fair' | 'poor' | 'failed';
type Severity = 'error' | 'warning' | 'info';
type TranscriptState = 'analyzed' | 'notProduced' | 'unavailable';

interface Warning {
  code: string;
  severity: Severity;
  stage?: string;
}

interface Stage {
  kind: string;
  status: string;
  durationSec: number | null;
  model: string | null;
  artifactCount: number;
  languages: string[];
  attempts: number;
}

interface TranscriptMetrics {
  segments: number;
  speakers: number;
  speechSec: number;
  avgConfidencePct: number | null;
  avgNoSpeechPct: number | null;
  lowConfidenceSegments: number;
  lowConfidencePct: number | null;
  verdict: 'empty' | 'low' | 'ok';
}

interface ReliabilityResponse {
  recordingId: string;
  durationSec: number | null;
  sourceLanguage: string;
  transcriptState: TranscriptState;
  transcript: TranscriptMetrics | null;
  stages: Stage[];
  overall: {
    totalProcessingSec: number;
    scorePct: number | null;
    level: ReliabilityLevel;
    warnings: Warning[];
  };
  hasData: boolean;
}

const LEVEL_BADGE: Record<ReliabilityLevel, string> = {
  good: 'bg-success',
  fair: 'bg-warning text-dark',
  poor: 'bg-warning text-dark',
  failed: 'bg-danger',
};

const SEVERITY_ALERT: Record<Severity, string> = {
  error: 'alert-danger',
  warning: 'alert-warning',
  info: 'alert-info',
};

const STATUS_BADGE: Record<string, string> = {
  DONE: 'bg-success',
  FAILED: 'bg-danger',
  RUNNING: 'bg-primary',
  CLAIMED: 'bg-secondary',
  PENDING: 'bg-light text-dark',
};

function fmtPct(n: number | null): string {
  if (n == null) return '—';
  return `${Math.round(n)}%`;
}

function fmtDuration(sec: number | null): string {
  if (sec == null || sec <= 0) return '—';
  const s = Math.round(sec);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem ? `${m} min ${rem} s` : `${m} min`;
}

export default function AiReliabilityPanel({ recordingId }: { recordingId: string }) {
  const t = useTranslations('admin.postprod');
  const { data, error, isLoading } = useSWR<ReliabilityResponse>(
    `/api/admin/postprod/recordings/${recordingId}/reliability`,
    fetcher as (url: string) => Promise<ReliabilityResponse>,
  );

  const label = (path: string, fallback: string): string =>
    t.has(path) ? t(path) : fallback;

  if (error) return <p className="text-danger small mb-0">{t('rel.loadError')}</p>;
  if (isLoading || !data) return <SkeletonLines lines={5} loadingLabel={t('rel.loading')} />;
  if (!data.hasData) return <p className="text-secondary small mb-0">{t('rel.noData')}</p>;

  const { overall, transcript, stages, transcriptState } = data;

  return (
    <div>
      <div className="d-flex align-items-start flex-wrap gap-2 mb-1">
        <div>
          <strong className="small">{t('rel.title')}</strong>
          <p className="small text-secondary mb-0">{t('rel.subtitle')}</p>
        </div>
        <span className={`badge ${LEVEL_BADGE[overall.level]} ms-auto align-self-center`}>
          {t(`rel.level.${overall.level}`)}
        </span>
      </div>

      {/* headline metrics */}
      <div className="row g-2 my-2">
        <Metric label={t('rel.overallScore')} value={fmtPct(overall.scorePct)} />
        <Metric label={t('rel.totalTime')} value={fmtDuration(overall.totalProcessingSec)} />
        <Metric label={t('rel.sourceLang')} value={data.sourceLanguage.toUpperCase()} />
      </div>

      {/* warnings — the whole point of the panel */}
      {overall.warnings.length > 0 && (
        <div className="mt-2">
          {overall.warnings.map((w, i) => (
            <div key={i} className={`alert ${SEVERITY_ALERT[w.severity]} py-2 px-3 small mb-2`}>
              {t(`rel.warn.${w.code}`, {
                stage: w.stage ? label(`rel.stage.${w.stage}`, w.stage) : '',
              })}
            </div>
          ))}
        </div>
      )}

      {/* transcript quality */}
      <div className="border rounded p-2 bg-white mt-2">
        <div className="small fw-semibold mb-2">{t('rel.transcriptTitle')}</div>
        {transcriptState === 'notProduced' && (
          <p className="small text-secondary mb-0">{t('rel.transcriptNotProduced')}</p>
        )}
        {transcriptState === 'unavailable' && (
          <p className="small text-secondary mb-0">{t('rel.transcriptUnavailable')}</p>
        )}
        {transcriptState === 'analyzed' && transcript && (
          <div className="row g-2">
            <Metric label={t('rel.segments')} value={String(transcript.segments)} small />
            <Metric label={t('rel.speakers')} value={String(transcript.speakers)} small />
            <Metric label={t('rel.speech')} value={fmtDuration(transcript.speechSec)} small />
            {data.durationSec ? (
              <Metric
                label={t('rel.coverage')}
                value={fmtPct((transcript.speechSec / data.durationSec) * 100)}
                small
              />
            ) : null}
            <Metric label={t('rel.confidence')} value={fmtPct(transcript.avgConfidencePct)} small />
            <Metric label={t('rel.silence')} value={fmtPct(transcript.avgNoSpeechPct)} small />
            <Metric
              label={t('rel.lowConf')}
              value={`${transcript.lowConfidenceSegments} (${fmtPct(transcript.lowConfidencePct)})`}
              small
            />
          </div>
        )}
      </div>

      {/* per-stage breakdown */}
      {stages.length > 0 && (
        <div className="mt-3">
          <div className="small fw-semibold mb-2">{t('rel.stagesTitle')}</div>
          <div className="table-responsive">
            <table className="table table-sm align-middle small mb-0">
              <thead>
                <tr>
                  <th scope="col">{t('rel.colStage')}</th>
                  <th scope="col">{t('rel.colStatus')}</th>
                  <th scope="col">{t('rel.colModel')}</th>
                  <th scope="col">{t('rel.colTime')}</th>
                  <th scope="col">{t('rel.colLangs')}</th>
                </tr>
              </thead>
              <tbody>
                {stages.map((s, i) => (
                  <tr key={i}>
                    <td>{label(`rel.stage.${s.kind}`, s.kind)}</td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[s.status] ?? 'bg-light text-dark'}`}>
                        {label(`rel.status.${s.status}`, s.status)}
                      </span>
                    </td>
                    <td className="text-break">{s.model ?? '—'}</td>
                    <td>{fmtDuration(s.durationSec)}</td>
                    <td>{s.languages.length ? s.languages.join(', ').toUpperCase() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  small,
}: {
  label: string;
  value: string;
  small?: boolean;
}) {
  return (
    <div className={small ? 'col-6 col-md-4 col-lg' : 'col-6 col-md-4'}>
      <div className="border rounded p-2 bg-white h-100">
        <div className="text-secondary" style={{ fontSize: '0.72rem' }}>
          {label}
        </div>
        <div className="fw-semibold">{value}</div>
      </div>
    </div>
  );
}
