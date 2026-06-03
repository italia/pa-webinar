'use client';

/**
 * Pagina di gestione completa di una registrazione (ADR-013 / UX
 * post-evento). Consolida in un'unica vista, a tab:
 *   - Trascrizione: editor testo + diarization (assegnazione speaker)
 *   - Sintesi: editor della sintesi AI (overall, decisioni, azioni, topic)
 *   - Traduzioni: lingue tradotte + aggiungi lingua
 * più un header con stato pipeline, durata e azioni (re-run, pagina
 * pubblica). Sostituisce l'editor inline cramped della dashboard.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import TranscriptEditor from './transcript-editor';
import SummaryEditor from './summary-editor';
import TranslationManager from './translation-manager';

type TabKey = 'transcript' | 'summary' | 'translations';

function statusBadgeClass(status: string): string {
  if (status.endsWith('DONE')) return 'bg-success';
  if (status.endsWith('FAILED')) return 'bg-danger';
  if (status.endsWith('PARTIAL')) return 'bg-warning text-dark';
  if (status.endsWith('RUNNING') || status.endsWith('QUEUED')) return 'bg-info text-dark';
  return 'bg-secondary';
}

function fmtDuration(sec: number | null): string {
  if (sec == null) return '–';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

export default function RecordingManageClient({
  recordingId,
  eventTitle,
  eventSlug,
  status,
  durationSec,
  sourceLanguage,
  createdAt,
}: {
  recordingId: string;
  eventTitle: string;
  eventSlug: string | null;
  status: string;
  durationSec: number | null;
  sourceLanguage: string;
  createdAt: string;
}) {
  const t = useTranslations('admin.postprod');
  const [tab, setTab] = useState<TabKey>('transcript');
  const [rerunning, setRerunning] = useState(false);
  const [rerunMsg, setRerunMsg] = useState<string | null>(null);

  async function rerun(): Promise<void> {
    if (!confirm(t('rerunTooltip'))) return;
    setRerunning(true);
    setRerunMsg(null);
    try {
      const r = await fetch(`/api/admin/postprod/recordings/${recordingId}/rerun`, {
        method: 'POST',
        credentials: 'include',
      });
      setRerunMsg(r.ok ? t('manageRerunOk') : t('rerunFailed', { code: r.status }));
    } catch {
      setRerunMsg(t('rerunFailed', { code: 0 }));
    } finally {
      setRerunning(false);
    }
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'transcript', label: t('manageTabTranscript') },
    { key: 'summary', label: t('manageTabSummary') },
    { key: 'translations', label: t('manageTabTranslations') },
  ];

  return (
    <div className="container py-4">
      {/* Header */}
      <div className="mb-2">
        <Link href="/admin/postprod" className="text-decoration-none small">
          ← {t('manageBackToList')}
        </Link>
      </div>
      <div className="d-flex flex-wrap align-items-center gap-3 mb-4">
        <div className="flex-grow-1">
          <h1 className="fw-bold mb-1" style={{ color: 'var(--app-text)', fontSize: '1.5rem' }}>
            {eventTitle}
          </h1>
          <div className="d-flex flex-wrap align-items-center gap-2 small text-secondary">
            <span className={`badge ${statusBadgeClass(status)}`}>{status}</span>
            <span>· {t('manageDuration')}: {fmtDuration(durationSec)}</span>
            <span>· {t('manageSource')}: {sourceLanguage}</span>
            <span>· {new Date(createdAt).toLocaleString()}</span>
          </div>
        </div>
        <div className="d-flex align-items-center gap-2">
          {rerunMsg && <span className="small text-secondary">{rerunMsg}</span>}
          {eventSlug && (
            <Link
              href={`/eventi/${eventSlug}`}
              className="btn btn-sm btn-outline-secondary"
              target="_blank"
            >
              {t('manageOpenPublic')}
            </Link>
          )}
          <button
            type="button"
            className="btn btn-sm btn-outline-primary"
            disabled={rerunning}
            onClick={() => void rerun()}
          >
            {rerunning ? '…' : t('rerun')}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <ul className="nav nav-tabs mb-3" role="tablist">
        {tabs.map((tb) => (
          <li className="nav-item" role="presentation" key={tb.key}>
            <button
              type="button"
              role="tab"
              aria-selected={tab === tb.key}
              className={`nav-link ${tab === tb.key ? 'active' : ''}`}
              onClick={() => setTab(tb.key)}
            >
              {tb.label}
            </button>
          </li>
        ))}
      </ul>

      <div role="tabpanel">
        {tab === 'transcript' && <TranscriptEditor recordingId={recordingId} />}
        {tab === 'summary' && <SummaryEditor recordingId={recordingId} />}
        {tab === 'translations' && <TranslationManager recordingId={recordingId} />}
      </div>
    </div>
  );
}
