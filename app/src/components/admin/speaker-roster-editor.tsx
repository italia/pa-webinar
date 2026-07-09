'use client';

/**
 * Speaker roster editor.
 *
 * Lets an admin correct the diarization roster — rename each detected
 * speaker (SPEAKER_00 → "Mario Rossi") so the transcript and the public
 * post-event page read with real names instead of anonymous labels.
 *
 * The backend (`PUT /api/admin/postprod/speakers/[id]`) already existed and
 * is used by the legacy dashboard; this surfaces the same capability on the
 * new per-recording management page, where it was missing. A rename overrides
 * both the live-alignment guess and the "Partecipante N" fallback in the
 * public transcript. Saves per row; the parent refetches via `onSaved`.
 */

import { useTranslations } from 'next-intl';
import { useState } from 'react';

export interface RosterSpeaker {
  id: string;
  diarLabel: string;
  displayName: string | null;
  totalSpeechSec: number;
}

function fmtSpeech(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem ? `${m}m ${rem}s` : `${m}m`;
}

export default function SpeakerRosterEditor({
  speakers,
  onSaved,
}: {
  speakers: RosterSpeaker[];
  onSaved?: () => void;
}) {
  const t = useTranslations('admin.postprod.ov');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);

  if (speakers.length === 0) return <span className="text-secondary small">–</span>;

  const draftFor = (s: RosterSpeaker): string => drafts[s.id] ?? s.displayName ?? '';
  const isDirty = (s: RosterSpeaker): boolean =>
    draftFor(s).trim() !== (s.displayName ?? '').trim();

  async function save(s: RosterSpeaker): Promise<void> {
    const name = draftFor(s).trim();
    setSavingId(s.id);
    setSavedId(null);
    setErrorId(null);
    try {
      const r = await fetch(`/api/admin/postprod/speakers/${s.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        // Rename only: send displayName (empty → null). We deliberately omit
        // personId so an existing rubrica link is preserved — this roster is a
        // name-correction tool, Person linking lives in the legacy dashboard.
        body: JSON.stringify({ displayName: name ? name : null }),
      });
      if (!r.ok) {
        setErrorId(s.id);
        return;
      }
      setSavedId(s.id);
      onSaved?.();
    } catch {
      setErrorId(s.id);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="d-flex flex-column gap-2 mb-4">
      <p className="small text-secondary mb-1">{t('speakerRenameHint')}</p>
      {speakers.map((s) => (
        <div key={s.id} className="d-flex align-items-center gap-2 flex-wrap">
          <span
            className="badge bg-light text-dark border"
            style={{ minWidth: 96, textAlign: 'center' }}
          >
            {s.diarLabel}
          </span>
          <input
            type="text"
            className="form-control form-control-sm"
            style={{ maxWidth: 260 }}
            value={draftFor(s)}
            placeholder={t('speakerNamePlaceholder')}
            aria-label={`${t('speakerNameAria')} ${s.diarLabel}`}
            onChange={(e) => {
              const v = e.target.value;
              setDrafts((d) => ({ ...d, [s.id]: v }));
              setSavedId(null);
              setErrorId(null);
            }}
          />
          <span className="small text-secondary">{fmtSpeech(s.totalSpeechSec)}</span>
          <button
            type="button"
            className="btn btn-sm btn-outline-primary"
            disabled={!isDirty(s) || savingId === s.id}
            onClick={() => void save(s)}
          >
            {savingId === s.id ? t('saving') : t('save')}
          </button>
          {savedId === s.id && <span className="small text-success">{t('saved')}</span>}
          {errorId === s.id && <span className="small text-danger">{t('saveError')}</span>}
        </div>
      ))}
    </div>
  );
}
