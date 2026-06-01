'use client';

/**
 * Admin transcript editor.
 *
 * Loaded lazily inside an expanded recording row in the postprod
 * dashboard. Lets the operator fix ASR mistakes (text) and diarization
 * mis-attributions (speaker) segment-by-segment, then saves a sparse
 * batch of edits to `/api/admin/postprod/recordings/[id]/transcript`.
 *
 * State model: `edits` holds only changed segments keyed by index. A
 * segment is "dirty" when its working value differs from the value the
 * API returned. Saving PUTs the dirty set, then refetches.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';

import TranscriptTimeline, {
  type TimelineControls,
  type Waveform,
} from './transcript-timeline';

const fetcher = (url: string): Promise<unknown> =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });

interface EditableSegment {
  index: number;
  start: number;
  end: number;
  text: string;
  speaker: string | null;
}

interface RosterEntry {
  diarLabel: string;
  displayName: string | null;
}

interface TranscriptResponse {
  recordingId: string;
  sourceLanguage: string;
  durationSec: number | null;
  segments: EditableSegment[];
  speakers: RosterEntry[];
  waveform: Waveform | null;
  mediaUrl: string;
}

interface Draft {
  text: string;
  speaker: string | null;
}

function fmtTs(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export default function TranscriptEditor({
  recordingId,
  onSaved,
}: {
  recordingId: string;
  onSaved?: () => void;
}) {
  const t = useTranslations('admin.postprod');
  const { data, error, isLoading, mutate } = useSWR<TranscriptResponse>(
    `/api/admin/postprod/recordings/${recordingId}/transcript`,
    fetcher as (url: string) => Promise<TranscriptResponse>,
  );

  // index -> working draft. Absent = untouched.
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const playerRef = useRef<TimelineControls | null>(null);
  const segScrollRef = useRef<HTMLDivElement>(null);

  const rosterLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const sp of data?.speakers ?? []) {
      map.set(sp.diarLabel, sp.displayName ? `${sp.displayName} (${sp.diarLabel})` : sp.diarLabel);
    }
    return map;
  }, [data?.speakers]);

  // Identity used for the timeline's speaker colours — displayName when
  // mapped, else the raw diar label — so colours match the public panel.
  const identityFor = useMemo(() => {
    const map = new Map<string, string>();
    for (const sp of data?.speakers ?? []) {
      map.set(sp.diarLabel, sp.displayName ?? sp.diarLabel);
    }
    return (speaker: string | null): string | null =>
      speaker ? map.get(speaker) ?? speaker : null;
  }, [data?.speakers]);

  // Keep the segment row under the playhead visible as the audio plays.
  useEffect(() => {
    if (activeIndex < 0) return;
    const container = segScrollRef.current;
    const row = container?.querySelector(`[data-seg="${activeIndex}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (error) {
    return <p className="text-danger small mb-0">{t('editLoadError')}</p>;
  }
  if (isLoading || !data) {
    return <p className="text-secondary small mb-0">{t('editLoading')}</p>;
  }
  if (data.segments.length === 0) {
    return <p className="text-secondary small mb-0">{t('editEmpty')}</p>;
  }

  function draftFor(seg: EditableSegment): Draft {
    return drafts[seg.index] ?? { text: seg.text, speaker: seg.speaker };
  }
  function isDirty(seg: EditableSegment): boolean {
    const d = drafts[seg.index];
    if (!d) return false;
    return d.text !== seg.text || (d.speaker ?? null) !== (seg.speaker ?? null);
  }

  function setDraft(seg: EditableSegment, patch: Partial<Draft>): void {
    setSavedMsg(null);
    setDrafts((prev) => {
      const base = prev[seg.index] ?? { text: seg.text, speaker: seg.speaker };
      return { ...prev, [seg.index]: { ...base, ...patch } };
    });
  }

  const dirtySegments = data.segments.filter(isDirty);

  async function save(): Promise<void> {
    if (dirtySegments.length === 0) return;
    setSaving(true);
    setSavedMsg(null);
    try {
      const edits = dirtySegments.map((seg) => {
        const d = draftFor(seg);
        return { index: seg.index, text: d.text, speaker: d.speaker };
      });
      const r = await fetch(
        `/api/admin/postprod/recordings/${recordingId}/transcript`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ edits }),
        },
      );
      if (!r.ok) {
        setSavedMsg(t('editFailed', { code: r.status }));
        return;
      }
      const res = (await r.json()) as { textChanges: number; speakerChanges: number };
      setDrafts({});
      setSavedMsg(
        t('editSaved', {
          text: res.textChanges,
          speaker: res.speakerChanges,
        }),
      );
      await mutate();
      onSaved?.();
    } catch {
      setSavedMsg(t('editFailed', { code: 0 }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="d-flex align-items-center gap-2 mb-2">
        <strong className="small">{t('editTranscriptTitle')}</strong>
        <span className="badge bg-light text-dark">{data.sourceLanguage}</span>
        <div className="ms-auto d-flex align-items-center gap-2">
          {savedMsg && <span className="small text-success">{savedMsg}</span>}
          {dirtySegments.length > 0 && (
            <span className="small text-secondary">
              {t('editDirty', { n: dirtySegments.length })}
            </span>
          )}
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={dirtySegments.length === 0 || saving}
            onClick={() => void save()}
          >
            {saving ? t('editSaving') : t('editSave')}
          </button>
        </div>
      </div>

      <p className="small text-secondary mb-2">{t('editHint')}</p>

      <TranscriptTimeline
        mediaUrl={data.mediaUrl}
        waveform={data.waveform}
        durationSec={data.durationSec}
        segments={data.segments.map((s) => ({
          index: s.index,
          start: s.start,
          end: s.end,
          speaker: s.speaker,
        }))}
        identityFor={identityFor}
        controlsRef={playerRef}
        onActiveIndexChange={setActiveIndex}
      />

      <div
        ref={segScrollRef}
        className="border rounded"
        style={{ maxHeight: 420, overflowY: 'auto', background: '#fff' }}
      >
        <table className="table table-sm align-middle mb-0">
          <tbody>
            {data.segments.map((seg) => {
              const d = draftFor(seg);
              const dirty = isDirty(seg);
              const active = seg.index === activeIndex;
              const rowClass = dirty
                ? 'table-warning'
                : active
                  ? 'table-info'
                  : undefined;
              return (
                <tr key={seg.index} data-seg={seg.index} className={rowClass}>
                  <td className="text-nowrap small" style={{ width: 64 }}>
                    <button
                      type="button"
                      className="btn btn-link btn-sm p-0 text-decoration-none"
                      onClick={() => playerRef.current?.seekTo(seg.start)}
                      title={t('editSeek')}
                    >
                      {fmtTs(seg.start)}
                    </button>
                  </td>
                  <td style={{ width: 200 }}>
                    <select
                      className="form-select form-select-sm"
                      value={d.speaker ?? ''}
                      onChange={(e) =>
                        setDraft(seg, { speaker: e.target.value === '' ? null : e.target.value })
                      }
                    >
                      <option value="">{t('editSpeakerNone')}</option>
                      {data.speakers.map((sp) => (
                        <option key={sp.diarLabel} value={sp.diarLabel}>
                          {rosterLabel.get(sp.diarLabel) ?? sp.diarLabel}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <textarea
                      className="form-control form-control-sm"
                      rows={Math.min(4, Math.max(1, Math.ceil(d.text.length / 80)))}
                      value={d.text}
                      onChange={(e) => setDraft(seg, { text: e.target.value })}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
