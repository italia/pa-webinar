'use client';

/**
 * Postprod admin dashboard.
 *
 * Server-side `/admin/postprod/page.tsx` fetches the initial page of
 * recordings + jobs and hands them to this client component. Actions
 * (re-run, cancel, speaker map) hit the admin API and SWR refetches.
 *
 * Intentionally one big file: the surface is small enough that
 * decomposition would add navigation cost without benefit. The
 * primary view is a table; clicking a row expands the details inline.
 */

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';

import { Link, useRouter } from '@/i18n/navigation';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import TranscriptEditor from './transcript-editor';

const fetcher = (url: string): Promise<unknown> =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });

interface JobRow {
  id: string;
  kind: 'TRANSCRIBE' | 'SUMMARIZE' | 'TRANSLATE' | 'SUBTITLE';
  status:
    | 'PENDING'
    | 'CLAIMED'
    | 'RUNNING'
    | 'DONE'
    | 'FAILED';
  attempts: number;
  lastError: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface ArtifactRow {
  id: string;
  type: string;
  language: string | null;
  sizeBytes: string | null;
  modelId: string | null;
  createdAt: string;
}

interface SpeakerRow {
  id: string;
  diarLabel: string;
  displayName: string | null;
  personId: string | null;
  totalSpeechSec: number;
  /** Prima frase pronunciata dallo speaker (max 140 caratteri) —
   *  sample per identificare chi è prima di compilarne il nome. */
  sampleText?: string | null;
  /** Nome suggerito dal LLM in fase di pipeline. Applicabile con un
   *  click invece di scrivere a mano. */
  suggestedName?: string | null;
}

interface RecordingRow {
  id: string;
  eventId: string;
  eventSlug: string;
  eventTitle: string;
  blobKey: string;
  durationSec: number | null;
  fileSizeBytes: string | null;
  sourceLanguage: string | null;
  status: string;
  runCount: number;
  retentionUntil: string | null;
  createdAt: string;
  jobs: JobRow[];
  artifacts: ArtifactRow[];
  speakers: SpeakerRow[];
}

interface ListResponse {
  total: number;
  limit: number;
  offset: number;
  rows: RecordingRow[];
}

function statusVariant(status: string): string {
  switch (status) {
    case 'POSTPROD_DONE':
    case 'DONE':
      return 'bg-success';
    case 'POSTPROD_FAILED':
    case 'FAILED':
      return 'bg-danger';
    case 'POSTPROD_PARTIAL':
      return 'bg-warning text-dark';
    case 'POSTPROD_RUNNING':
    case 'RUNNING':
    case 'CLAIMED':
      return 'bg-info text-dark';
    case 'POSTPROD_QUEUED':
    case 'PENDING':
      return 'bg-secondary';
    default:
      return 'bg-light text-dark';
  }
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '–';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export default function PostprodDashboard() {
  const t = useTranslations('admin.postprod');
  const toast = useToast();
  const confirm = useConfirm();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [expanded, setExpanded] = useState<string | null>(null);

  // Deep-link da "Registrazioni" e dalla pagina evento:
  //   /admin/postprod?recordingId=<id>  oppure  ?eventId=<id>
  // Auto-espande e scrolla alla registrazione giusta una volta caricati
  // i dati. Usiamo eventId come chiave robusta (presente ovunque).
  const router = useRouter();
  const searchParams = useSearchParams();
  const deepRecordingId = searchParams.get('recordingId');
  const deepEventId = searchParams.get('eventId');
  const deepLinkApplied = useRef(false);

  const qs = new URLSearchParams();
  if (statusFilter) qs.set('status', statusFilter);
  const { data, error, isLoading, mutate } = useSWR<ListResponse>(
    `/api/admin/postprod?${qs.toString()}`,
    fetcher as (url: string) => Promise<ListResponse>,
    { refreshInterval: 10_000 },
  );

  useEffect(() => {
    if (deepLinkApplied.current || !data) return;
    if (!deepRecordingId && !deepEventId) return;
    const match = data.rows.find(
      (r) => r.id === deepRecordingId || r.eventId === deepEventId,
    );
    if (match) {
      deepLinkApplied.current = true;
      // Deep-link da registrazioni/evento → pagina di gestione completa
      // del video (trascrizione + sintesi + traduzioni), non l'editor
      // inline cramped della lista.
      router.push(`/admin/postprod/${match.id}`);
    }
  }, [data, deepRecordingId, deepEventId, router]);

  async function rerun(recordingId: string): Promise<void> {
    const r = await fetch(`/api/admin/postprod/recordings/${recordingId}/rerun`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!r.ok) {
      toast.error(t('rerunFailed', { code: r.status }));
      return;
    }
    await mutate();
  }

  async function cancel(recordingId: string): Promise<void> {
    const ok = await confirm({
      title: t('cancelConfirmTitle'),
      message: t('cancelConfirm'),
      confirmLabel: t('cancel'),
      danger: true,
    });
    if (!ok) return;
    const r = await fetch(`/api/admin/postprod/recordings/${recordingId}/cancel`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!r.ok) {
      toast.error(t('cancelFailed', { code: r.status }));
      return;
    }
    await mutate();
  }

  async function updateSpeaker(
    speakerId: string,
    displayName: string | null,
    personId: string | null,
  ): Promise<void> {
    const r = await fetch(`/api/admin/postprod/speakers/${speakerId}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName, personId }),
    });
    if (!r.ok) {
      toast.error(t('speakerUpdateFailed', { code: r.status }));
      return;
    }
    toast.success(t('speakerUpdateSuccess'));
    await mutate();
  }

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {t('loadError')}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 d-flex gap-3 align-items-center">
        <label htmlFor="status-filter" className="form-label mb-0">
          {t('filterStatus')}
        </label>
        <select
          id="status-filter"
          className="form-select form-select-sm"
          style={{ maxWidth: 280 }}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">{t('all')}</option>
          <option value="POSTPROD_QUEUED">{t('queued')}</option>
          <option value="POSTPROD_RUNNING">{t('running')}</option>
          <option value="POSTPROD_DONE">{t('done')}</option>
          <option value="POSTPROD_PARTIAL">{t('partial')}</option>
          <option value="POSTPROD_FAILED">{t('failed')}</option>
        </select>
        <div className="text-secondary small ms-auto">
          {data ? t('totalRows', { count: data.total }) : isLoading ? '…' : ''}
        </div>
      </div>

      <div className="table-responsive">
        <table className="table table-hover align-middle">
          <thead>
            <tr>
              <th>{t('colEvent')}</th>
              <th>{t('colCreated')}</th>
              <th>{t('colDuration')}</th>
              <th>{t('colStatus')}</th>
              <th>{t('colJobs')}</th>
              <th>{t('colArtifacts')}</th>
              <th className="text-end">{t('colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((row) => {
              const isExpanded = expanded === row.id;
              const doneJobs = row.jobs.filter((j) => j.status === 'DONE').length;
              return (
                <>
                  <tr
                    key={row.id}
                    data-recording={row.id}
                    onClick={() => setExpanded(isExpanded ? null : row.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>
                      <div className="fw-semibold">{row.eventTitle}</div>
                      <code className="small text-muted">{row.eventSlug}</code>
                    </td>
                    <td>{new Date(row.createdAt).toLocaleString()}</td>
                    <td>{formatDuration(row.durationSec)}</td>
                    <td>
                      <span className={`badge ${statusVariant(row.status)}`}>
                        {row.status}
                      </span>
                    </td>
                    <td>
                      {doneJobs}/{row.jobs.length}
                    </td>
                    <td>{row.artifacts.length}</td>
                    <td className="text-end">
                      <Link
                        href={`/admin/postprod/${row.id}`}
                        className="btn btn-sm btn-primary me-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {t('manageOpen')}
                      </Link>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary me-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          void rerun(row.id);
                        }}
                        title={t('rerunTooltip')}
                      >
                        {t('rerun')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          void cancel(row.id);
                        }}
                        disabled={
                          row.status === 'POSTPROD_DONE' ||
                          row.status === 'POSTPROD_FAILED'
                        }
                      >
                        {t('cancel')}
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${row.id}-detail`}>
                      <td colSpan={7} className="bg-light">
                        <RecordingDetails
                          row={row}
                          onSpeakerSave={updateSpeaker}
                          onMutate={mutate}
                        />
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
            {data && data.rows.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-secondary py-4">
                  {t('empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RecordingDetails({
  row,
  onSpeakerSave,
  onMutate,
}: {
  row: RecordingRow;
  onSpeakerSave: (
    speakerId: string,
    displayName: string | null,
    personId: string | null,
  ) => Promise<void>;
  onMutate: () => Promise<unknown>;
}) {
  const t = useTranslations('admin.postprod');
  const [editing, setEditing] = useState(false);
  const hasTranscript = row.artifacts.some((a) => a.type === 'TRANSCRIPT_JSON');
  return (
    <div className="p-3">
      <div className="row g-3">
        <div className="col-md-4">
          <h6 className="text-uppercase text-secondary small">{t('detailJobs')}</h6>
          <ul className="list-unstyled mb-0">
            {row.jobs.map((j) => (
              <li key={j.id} className="mb-1">
                <span className={`badge me-2 ${statusVariant(j.status)}`}>
                  {j.status}
                </span>
                <code>{j.kind}</code>
                {j.attempts > 1 && (
                  <span className="text-secondary small ms-2">
                    {t('attempts', { n: j.attempts })}
                  </span>
                )}
                {j.lastError && (
                  <div className="small text-danger ms-4">{j.lastError}</div>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div className="col-md-4">
          <h6 className="text-uppercase text-secondary small">
            {t('detailArtifacts')}
          </h6>
          <ul className="list-unstyled mb-0">
            {row.artifacts.map((a) => (
              <li key={a.id} className="small mb-1">
                <code>{a.type}</code>
                {a.language && (
                  <span className="badge bg-light text-dark ms-1">{a.language}</span>
                )}
                {a.modelId && (
                  <span className="text-secondary ms-2">{a.modelId}</span>
                )}
              </li>
            ))}
            {row.artifacts.length === 0 && (
              <li className="text-secondary small">{t('noArtifacts')}</li>
            )}
          </ul>
        </div>
        <div className="col-md-4">
          <h6 className="text-uppercase text-secondary small">
            {t('detailSpeakers')}
          </h6>
          <SpeakersEditor speakers={row.speakers} onSave={onSpeakerSave} />
        </div>
      </div>

      {hasTranscript && (
        <div className="mt-3 pt-3 border-top">
          <button
            type="button"
            className="btn btn-sm btn-outline-primary"
            onClick={() => setEditing((v) => !v)}
            aria-expanded={editing}
          >
            {editing ? t('editClose') : t('editTranscript')}
          </button>
          {editing && (
            <div className="mt-3">
              <TranscriptEditor recordingId={row.id} onSaved={() => void onMutate()} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SpeakersEditor({
  speakers,
  onSave,
}: {
  speakers: SpeakerRow[];
  onSave: (
    speakerId: string,
    displayName: string | null,
    personId: string | null,
  ) => Promise<void>;
}) {
  const t = useTranslations('admin.postprod');
  const [edits, setEdits] = useState<Record<string, string>>({});

  if (speakers.length === 0) {
    return <p className="text-secondary small">{t('noSpeakers')}</p>;
  }
  return (
    <ul className="list-unstyled mb-0">
      {speakers.map((s) => {
        const current = edits[s.id] ?? s.displayName ?? '';
        const dirty = current !== (s.displayName ?? '');
        return (
          <li key={s.id} className="mb-2">
            <div className="d-flex align-items-center gap-2">
              <code className="text-secondary" style={{ minWidth: 100 }}>
                {s.diarLabel}
              </code>
              <input
                type="text"
                className="form-control form-control-sm"
                placeholder={t('speakerPlaceholder')}
                value={current}
                onChange={(e) =>
                  setEdits((m) => ({ ...m, [s.id]: e.target.value }))
                }
              />
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={!dirty}
                onClick={() =>
                  void onSave(s.id, current.trim() === '' ? null : current.trim(), null)
                }
              >
                {t('save')}
              </button>
            </div>
            <div className="d-flex align-items-center gap-2 ms-1">
              <small className="text-secondary">
                {t('speakerSpoke', { sec: s.totalSpeechSec })}
              </small>
              {s.suggestedName && current !== s.suggestedName && (
                <button
                  type="button"
                  className="btn btn-sm p-0"
                  onClick={() =>
                    setEdits((m) => ({ ...m, [s.id]: s.suggestedName! }))
                  }
                  style={{
                    color: '#0066CC',
                    fontSize: '0.78rem',
                    textDecoration: 'underline',
                    textDecorationStyle: 'dotted',
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                  }}
                  title={t('suggestedTitle')}
                >
                  {t('suggestedApply', { name: s.suggestedName })}
                </button>
              )}
            </div>
            {s.sampleText && (
              <blockquote
                className="ms-1 mt-1 mb-0 ps-2"
                style={{
                  borderLeft: '3px solid #d6e3f1',
                  fontSize: '0.82rem',
                  color: '#5A768A',
                  fontStyle: 'italic',
                }}
              >
                {s.sampleText}
              </blockquote>
            )}
          </li>
        );
      })}
    </ul>
  );
}
