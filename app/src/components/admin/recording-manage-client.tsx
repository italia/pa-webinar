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
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';

import RecordingOverview from './recording-overview';
import TranscriptEditor from './transcript-editor';
import SummaryEditor from './summary-editor';
import TranslationManager from './translation-manager';
import ArchivePanel from './archive-panel';

type TabKey = 'overview' | 'transcript' | 'summary' | 'translations' | 'archive';

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
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<TabKey>('overview');
  const [rerunning, setRerunning] = useState(false);
  const [generating, setGenerating] = useState(false);

  async function rerun(): Promise<void> {
    const ok = await confirm({
      title: t('rerun'),
      message: t('rerunTooltip'),
      confirmLabel: t('rerun'),
    });
    if (!ok) return;
    setRerunning(true);
    try {
      const r = await fetch(`/api/admin/postprod/recordings/${recordingId}/rerun`, {
        method: 'POST',
        credentials: 'include',
      });
      if (r.ok) {
        // A successful POST can enqueue NOTHING: either nothing was runnable (AI
        // disabled / pipeline paused → true no-op) or every job already exists at
        // this runCount (already queued). Distinguish them instead of a false
        // "OK" (F15, review #1/#4).
        const data = (await r.json().catch(() => null)) as {
          enqueued?: number;
          skippedExisting?: number;
        } | null;
        if (data?.enqueued === 0) {
          if ((data.skippedExisting ?? 0) > 0) toast.success(t('manageRerunAlreadyQueued'));
          else toast.error(t('manageRerunNoop'));
        } else {
          toast.success(t('manageRerunOk'));
        }
      } else {
        toast.error(t('rerunFailed', { code: r.status }));
      }
    } catch {
      toast.error(t('rerunFailed', { code: 0 }));
    } finally {
      setRerunning(false);
    }
  }

  // Start the AI pipeline on a recording that never ran it (status READY, no
  // jobs) — e.g. an audio-only multitrack recording, or an event captured with
  // AI off. Unlike Rerun this ENABLES the AI flags first, and the enqueue
  // auto-detects multitrack, so all three functions (transcript → summary →
  // translation) actually start. (F15)
  async function generateAi(): Promise<void> {
    const ok = await confirm({
      title: t('generateAi'),
      message: t('generateAiConfirm'),
      confirmLabel: t('generateAi'),
    });
    if (!ok) return;
    setGenerating(true);
    try {
      const r = await fetch(`/api/admin/postprod/recordings/${recordingId}/generate-ai`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        // Transcript + summary only. Translations are added explicitly, per
        // language, from the Translations tab — one click shouldn't blanket
        // auto-translate to every default locale (consent/scope, review #3).
        body: JSON.stringify({ summary: true }),
      });
      if (r.ok) {
        const data = (await r.json().catch(() => null)) as {
          enqueued?: number;
          skippedExisting?: number;
        } | null;
        if (data?.enqueued === 0) {
          if ((data.skippedExisting ?? 0) > 0) {
            toast.success(t('manageRerunAlreadyQueued'));
            window.location.reload();
          } else {
            toast.error(t('manageRerunNoop'));
          }
        } else {
          toast.success(t('generateAiOk'));
          window.location.reload();
        }
      } else {
        const data = (await r.json().catch(() => null)) as { error?: string } | null;
        toast.error(data?.error ?? t('rerunFailed', { code: r.status }));
      }
    } catch {
      toast.error(t('rerunFailed', { code: 0 }));
    } finally {
      setGenerating(false);
    }
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'overview', label: t('ov.tab') },
    { key: 'transcript', label: t('manageTabTranscript') },
    { key: 'summary', label: t('manageTabSummary') },
    { key: 'translations', label: t('manageTabTranslations') },
    { key: 'archive', label: t('manageTabArchive') },
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
          {eventSlug && (
            <Link
              href={`/eventi/${eventSlug}`}
              className="btn btn-sm btn-outline-secondary"
              target="_blank"
            >
              {t('manageOpenPublic')}
            </Link>
          )}
          {status === 'READY' && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={generating}
              onClick={() => void generateAi()}
            >
              {generating ? '…' : t('generateAi')}
            </button>
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

      {/* Tabs — il pannello sotto è una Card (superficie bianca, bordo,
          ombra leggera) così ogni sezione è contenuta e leggibile, non
          testo sciolto sulla pagina. */}
      <ul className="nav nav-tabs" role="tablist" style={{ borderBottom: 'none' }}>
        {tabs.map((tb) => (
          <li className="nav-item" role="presentation" key={tb.key}>
            <button
              type="button"
              role="tab"
              aria-selected={tab === tb.key}
              className={`nav-link ${tab === tb.key ? 'active fw-semibold' : ''}`}
              onClick={() => setTab(tb.key)}
            >
              {tb.label}
            </button>
          </li>
        ))}
      </ul>

      <div
        role="tabpanel"
        className="bg-white border rounded-bottom rounded-end p-4 shadow-sm"
        style={{ borderTopLeftRadius: tab === tabs[0]?.key ? 0 : 8 }}
      >
        {tab === 'overview' && <RecordingOverview recordingId={recordingId} />}
        {tab === 'transcript' && <TranscriptEditor recordingId={recordingId} status={status} />}
        {tab === 'summary' && <SummaryEditor recordingId={recordingId} status={status} />}
        {tab === 'translations' && <TranslationManager recordingId={recordingId} />}
        {tab === 'archive' && <ArchivePanel recordingId={recordingId} />}
      </div>
    </div>
  );
}
