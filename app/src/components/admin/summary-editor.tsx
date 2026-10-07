'use client';

/**
 * Admin summary editor.
 *
 * Lets the operator correct the AI-generated SUMMARY of a recording —
 * which until now was completely uneditable from the admin side. Loads
 * per-language summaries from
 * `/api/admin/postprod/recordings/[id]/summary` and lets the operator
 * fix the structured payload (overall_summary, key_decisions[],
 * action_items[], topics[{title,start_mmss,summary}]) that feeds the
 * public post-event hero, plus the raw markdown.
 *
 * State model: `draft` holds the working copy for the *currently
 * selected* language. It is seeded from the API the first time a
 * language is visited and edited locally afterwards. A language is
 * "dirty" when its working draft differs from what the API returned.
 * Saving PUTs `{ language, structured, md? }`, then refetches.
 */

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { SkeletonLines } from '@/components/ui/skeleton';

const fetcher = (url: string): Promise<unknown> =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });

interface Topic {
  title?: string;
  start_mmss?: string;
  summary?: string;
}

interface StructuredSummary {
  overall_summary?: string;
  key_decisions?: string[];
  action_items?: string[];
  topics?: Topic[];
  [key: string]: unknown;
}

interface LangSummary {
  md: string | null;
  structured: StructuredSummary | null;
}

interface SummaryResponse {
  recordingId: string;
  sourceLanguage: string;
  languages: string[];
  summaries: Record<string, LangSummary>;
}

/** Working draft normalised so every collection is always present. */
interface Draft {
  overall_summary: string;
  key_decisions: string[];
  action_items: string[];
  topics: Topic[];
  md: string;
  /** Extra structured fields the API may have (passthrough) — preserved on save. */
  extra: Record<string, unknown>;
}

const KNOWN_KEYS = new Set([
  'overall_summary',
  'key_decisions',
  'action_items',
  'topics',
]);

function toDraft(s: LangSummary | undefined): Draft {
  const st = s?.structured ?? {};
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(st)) {
    if (!KNOWN_KEYS.has(k)) extra[k] = v;
  }
  return {
    overall_summary: st.overall_summary ?? '',
    key_decisions: Array.isArray(st.key_decisions) ? [...st.key_decisions] : [],
    action_items: Array.isArray(st.action_items) ? [...st.action_items] : [],
    topics: Array.isArray(st.topics) ? st.topics.map((t) => ({ ...t })) : [],
    md: s?.md ?? '',
    extra,
  };
}

/** Rebuild the structured payload PUT to the API (drops empty fields). */
function draftToStructured(d: Draft): StructuredSummary {
  const out: StructuredSummary = { ...d.extra };
  if (d.overall_summary.trim()) out.overall_summary = d.overall_summary;
  const decisions = d.key_decisions.map((x) => x.trim()).filter(Boolean);
  if (decisions.length > 0) out.key_decisions = decisions;
  const actions = d.action_items.map((x) => x.trim()).filter(Boolean);
  if (actions.length > 0) out.action_items = actions;
  const topics = d.topics
    .map((t) => {
      const tp: Topic = {};
      if (t.title?.trim()) tp.title = t.title;
      if (t.start_mmss?.trim()) tp.start_mmss = t.start_mmss;
      if (t.summary?.trim()) tp.summary = t.summary;
      return tp;
    })
    .filter((t) => Object.keys(t).length > 0);
  if (topics.length > 0) out.topics = topics;
  return out;
}

const draftEquals = (a: Draft, b: Draft): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

// Inline SVG icons — design-react-kit's <Icon> can trigger hydration
// mismatches in components like this, so we hand-roll the few glyphs we need.
function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function SummaryEditor({
  recordingId,
  status,
  onSaved,
}: {
  recordingId: string;
  /** Recording.status — lets the empty state say "in corso" vs "mai generata". */
  status?: string;
  onSaved?: () => void;
}) {
  const t = useTranslations('admin.postprod');
  const tc = useTranslations('common');
  const { data, error, isLoading, mutate } = useSWR<SummaryResponse>(
    `/api/admin/postprod/recordings/${recordingId}/summary`,
    fetcher as (url: string) => Promise<SummaryResponse>,
  );

  const [lang, setLang] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showMd, setShowMd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Pick an initial language once the data arrives (prefer the source).
  useEffect(() => {
    if (!data || lang !== null) return;
    if (data.languages.length === 0) return;
    const initial = data.languages.includes(data.sourceLanguage)
      ? data.sourceLanguage
      : data.languages[0]!;
    setLang(initial);
  }, [data, lang]);

  // Seed / reset the working draft whenever the selected language changes.
  useEffect(() => {
    if (!data || lang === null) return;
    setDraft(toDraft(data.summaries[lang]));
    setSavedMsg(null);
    setErrorMsg(null);
  }, [data, lang]);

  const pristine = useMemo<Draft | null>(
    () => (data && lang ? toDraft(data.summaries[lang]) : null),
    [data, lang],
  );

  const dirty = !!(draft && pristine && !draftEquals(draft, pristine));

  if (error) {
    return <p className="text-danger small mb-0">{t('summaryLoadError')}</p>;
  }
  if (isLoading || !data) {
    return <SkeletonLines lines={5} loadingLabel={t('summaryLoading')} />;
  }
  if (data.languages.length === 0) {
    // Distinguish "still processing" / "failed" / "never generated" so the
    // operator knows whether to wait or to (re-)run from the controls above.
    const processing = status === 'POSTPROD_QUEUED' || status === 'POSTPROD_RUNNING';
    const failed = status === 'POSTPROD_FAILED';
    return (
      <p className="text-secondary small mb-0">
        {processing
          ? t('summaryEmptyProcessing')
          : failed
            ? t('summaryEmptyFailed')
            : t('summaryEmptyNone')}
      </p>
    );
  }
  if (!lang || !draft) {
    return <p className="text-secondary small mb-0">{t('summaryLoading')}</p>;
  }

  const patch = (p: Partial<Draft>): void => {
    setSavedMsg(null);
    setDraft((prev) => (prev ? { ...prev, ...p } : prev));
  };

  // --- list helpers (key_decisions / action_items) -----------------------
  const editListItem = (
    key: 'key_decisions' | 'action_items',
    i: number,
    value: string,
  ): void => {
    const next = [...draft[key]];
    next[i] = value;
    patch({ [key]: next } as Partial<Draft>);
  };
  const addListItem = (key: 'key_decisions' | 'action_items'): void => {
    patch({ [key]: [...draft[key], ''] } as Partial<Draft>);
  };
  const removeListItem = (
    key: 'key_decisions' | 'action_items',
    i: number,
  ): void => {
    patch({ [key]: draft[key].filter((_, idx) => idx !== i) } as Partial<Draft>);
  };

  // --- topic helpers ------------------------------------------------------
  const editTopic = (i: number, p: Partial<Topic>): void => {
    const next = draft.topics.map((t, idx) => (idx === i ? { ...t, ...p } : t));
    patch({ topics: next });
  };
  const addTopic = (): void => {
    patch({ topics: [...draft.topics, { title: '', start_mmss: '', summary: '' }] });
  };
  const removeTopic = (i: number): void => {
    patch({ topics: draft.topics.filter((_, idx) => idx !== i) });
  };

  async function save(): Promise<void> {
    if (!lang || !draft || !dirty) return;
    setSaving(true);
    setSavedMsg(null);
    setErrorMsg(null);
    try {
      const payload: { language: string; structured: StructuredSummary; md?: string } = {
        language: lang,
        structured: draftToStructured(draft),
      };
      // Only send md when the source row actually had markdown (the API
      // requires the artifact to exist), and only when it changed.
      const original = data!.summaries[lang]?.md;
      if (original != null && draft.md !== original) {
        payload.md = draft.md;
      }
      const r = await fetch(
        `/api/admin/postprod/recordings/${recordingId}/summary`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      if (!r.ok) {
        // Un rifiuto del server (testo troppo lungo, lingua senza la sua
        // sintesi) non si risolve riprovando: lo si dice, con il dettaglio.
        const body = (await r.json().catch(() => ({}))) as { error?: string; message?: string };
        const dettaglio = body.error ?? body.message ?? '';
        setErrorMsg(
          r.status >= 400 && r.status < 500
            ? `${t('summarySaveRejected')}${dettaglio ? ` (${dettaglio})` : ''}`
            : t('summarySaveFailed'),
        );
        return;
      }
      setSavedMsg(t('summarySaved'));
      await mutate();
      onSaved?.();
    } catch {
      setErrorMsg(t('summarySaveFailed'));
    } finally {
      setSaving(false);
    }
  }

  const hasMd = data.summaries[lang]?.md != null;

  return (
    <div>
      <div className="d-flex align-items-center flex-wrap gap-2 mb-3">
        <h3 className="h6 fw-semibold mb-0">{t('summaryHeading')}</h3>
        {data.languages.length > 1 ? (
          <select
            className="form-select form-select-sm"
            style={{ width: 'auto' }}
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            aria-label={t('summaryLanguage')}
          >
            {data.languages.map((l) => (
              <option key={l} value={l}>
                {l}
                {l === data.sourceLanguage ? ` (${t('summarySource')})` : ''}
              </option>
            ))}
          </select>
        ) : (
          <span className="badge bg-light text-dark">{lang}</span>
        )}
        <div className="ms-auto d-flex align-items-center gap-2">
          <span role="status" className="small text-success">{savedMsg}</span>
          {errorMsg && <span role="alert" className="small text-danger">{errorMsg}</span>}
          {dirty && <span className="small text-secondary">{t('summaryUnsaved')}</span>}
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={!dirty || saving}
            onClick={() => void save()}
          >
            {saving ? tc('saving') : tc('save')}
          </button>
        </div>
      </div>

      {/* overall_summary */}
      <div className="mb-3">
        <label className="form-label small fw-semibold" htmlFor={`${recordingId}-overall`}>
          {t('summaryOverall')}
        </label>
        <textarea
          id={`${recordingId}-overall`}
          className="form-control form-control-sm"
          rows={4}
          value={draft.overall_summary}
          placeholder={t('summaryOverallPlaceholder')}
          onChange={(e) => patch({ overall_summary: e.target.value })}
        />
      </div>

      <div className="row g-3">
        {/* key_decisions */}
        <div className="col-md-6">
          <EditableList
            label={t('summaryDecisions')}
            items={draft.key_decisions}
            onEdit={(i, v) => editListItem('key_decisions', i, v)}
            onRemove={(i) => removeListItem('key_decisions', i)}
            onAdd={() => addListItem('key_decisions')}
            addLabel={t('summaryAddDecision')}
          />
        </div>
        {/* action_items */}
        <div className="col-md-6">
          <EditableList
            label={t('summaryActions')}
            items={draft.action_items}
            onEdit={(i, v) => editListItem('action_items', i, v)}
            onRemove={(i) => removeListItem('action_items', i)}
            onAdd={() => addListItem('action_items')}
            addLabel={t('summaryAddAction')}
          />
        </div>
      </div>

      {/* topics */}
      <div className="mt-3">
        <div className="d-flex align-items-center gap-2 mb-2">
          <span className="form-label small fw-semibold mb-0">{t('summaryTopics')}</span>
          <button
            type="button"
            className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1 ms-auto"
            onClick={addTopic}
          >
            <PlusIcon /> {t('summaryAddTopic')}
          </button>
        </div>
        {draft.topics.length === 0 ? (
          <p className="small text-secondary mb-0">{t('summaryNoTopics')}</p>
        ) : (
          <div className="d-flex flex-column gap-2">
            {draft.topics.map((tp, i) => (
              <div key={i} className="border rounded p-2 bg-white">
                <div className="d-flex gap-2 mb-2">
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    placeholder={t('summaryTopicTitle')}
                    aria-label={t('summaryTopicTitle')}
                    value={tp.title ?? ''}
                    onChange={(e) => editTopic(i, { title: e.target.value })}
                  />
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    style={{ width: 90 }}
                    placeholder="mm:ss"
                    value={tp.start_mmss ?? ''}
                    onChange={(e) => editTopic(i, { start_mmss: e.target.value })}
                    aria-label={t('summaryTopicStart')}
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-danger d-inline-flex align-items-center"
                    onClick={() => removeTopic(i)}
                    aria-label={t('summaryRemoveTopic')}
                    title={t('summaryRemoveTopic')}
                  >
                    <TrashIcon />
                  </button>
                </div>
                <textarea
                  className="form-control form-control-sm"
                  rows={2}
                  placeholder={t('summaryTopicSummary')}
                  aria-label={t('summaryTopicSummary')}
                  value={tp.summary ?? ''}
                  onChange={(e) => editTopic(i, { summary: e.target.value })}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* raw markdown (advanced, collapsible) */}
      {hasMd && (
        <div className="mt-3">
          <button
            type="button"
            className="btn btn-link btn-sm p-0 text-decoration-none"
            onClick={() => setShowMd((v) => !v)}
            aria-expanded={showMd}
          >
            {showMd ? '▾' : '▸'} {t('summaryRawMarkdown')}
          </button>
          {showMd && (
            <>
              <textarea
                className="form-control form-control-sm mt-2"
                rows={10}
                aria-label={t('summaryRawMarkdown')}
                value={draft.md}
                onChange={(e) => patch({ md: e.target.value })}
                style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
              />
              <p className="small text-secondary mt-1 mb-0">{t('summaryRawMarkdownHelp')}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function EditableList({
  label,
  items,
  onEdit,
  onRemove,
  onAdd,
  addLabel,
}: {
  label: string;
  items: string[];
  onEdit: (i: number, value: string) => void;
  onRemove: (i: number) => void;
  onAdd: () => void;
  addLabel: string;
}) {
  const t = useTranslations('admin.postprod');
  return (
    <div className="border rounded p-2 bg-white h-100">
      <div className="small fw-semibold mb-2">{label}</div>
      {items.length === 0 ? (
        <p className="small text-secondary mb-2">{t('summaryNoItems')}</p>
      ) : (
        <div className="d-flex flex-column gap-2 mb-2">
          {items.map((it, i) => (
            <div key={i} className="d-flex gap-1 align-items-start">
              <textarea
                className="form-control form-control-sm"
                rows={1}
                aria-label={`${label} ${i + 1}`}
                value={it}
                onChange={(e) => onEdit(i, e.target.value)}
              />
              <button
                type="button"
                className="btn btn-sm btn-outline-danger d-inline-flex align-items-center"
                onClick={() => onRemove(i)}
                aria-label={t('summaryRemoveItem', { n: i + 1 })}
                title={t('summaryRemoveItem', { n: i + 1 })}
              >
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1"
        onClick={onAdd}
      >
        <PlusIcon /> {addLabel}
      </button>
    </div>
  );
}
