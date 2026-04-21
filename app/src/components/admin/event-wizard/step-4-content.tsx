'use client';

/**
 * Step 4 — Content.
 *
 * Let the admin attach materials (files/URLs) and pick pre- and post-event
 * questionnaires. The questionnaires are pulled from /api/admin/questionnaires
 * once on mount so the wizard doesn't need the parent page to hydrate them.
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import FileOrUrlInput from '@/components/ui/file-or-url-input';

export interface MaterialDraft {
  title: string;
  url: string;
  description?: string | null;
  type: 'file' | 'link';
  visibility: 'BEFORE' | 'DURING' | 'AFTER' | 'ALWAYS';
}

export interface Step4Value {
  materials: MaterialDraft[];
  preEventQuestionnaireId: string | null;
  postEventQuestionnaireId: string | null;
}

interface Props {
  value: Step4Value;
  onChange: (patch: Partial<Step4Value>) => void;
}

interface QRow {
  id: string;
  title: Record<string, string> | string | null;
  questionCount?: number;
}

export default function Step4Content({ value, onChange }: Props) {
  const t = useTranslations('admin.wizard.step4');
  const [questionnaires, setQuestionnaires] = useState<QRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/questionnaires', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((data) => {
        if (cancelled) return;
        setQuestionnaires(Array.isArray(data.rows) ? data.rows : []);
      })
      .catch(() => {
        /* optional */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <h2 className="h4 fw-bold mb-3" style={{ color: '#17324D' }}>
        {t('heading')}
      </h2>
      <p className="text-secondary mb-4" style={{ fontSize: '0.9rem' }}>
        {t('intro')}
      </p>

      <MaterialsSection
        value={value.materials}
        onChange={(next) => onChange({ materials: next })}
      />

      <QuestionnairesSection
        questionnaires={questionnaires}
        preId={value.preEventQuestionnaireId}
        postId={value.postEventQuestionnaireId}
        onPre={(id) => onChange({ preEventQuestionnaireId: id })}
        onPost={(id) => onChange({ postEventQuestionnaireId: id })}
      />
    </div>
  );
}

function MaterialsSection({
  value,
  onChange,
}: {
  value: MaterialDraft[];
  onChange: (next: MaterialDraft[]) => void;
}) {
  const t = useTranslations('admin.wizard.step4');
  const [draft, setDraft] = useState<MaterialDraft>({
    title: '',
    url: '',
    description: '',
    type: 'file',
    visibility: 'ALWAYS',
  });

  const add = () => {
    if (!draft.title.trim() || !draft.url.trim()) return;
    onChange([
      ...value,
      {
        ...draft,
        title: draft.title.trim(),
        url: draft.url.trim(),
        description: draft.description?.trim() || null,
      },
    ]);
    setDraft({
      title: '',
      url: '',
      description: '',
      type: 'file',
      visibility: 'ALWAYS',
    });
  };

  return (
    <section className="mb-4">
      <h3 className="h6 fw-semibold mb-2" style={{ color: '#17324D' }}>
        {t('materialsHeading')}
      </h3>
      <p className="text-secondary mb-2" style={{ fontSize: '0.85rem' }}>
        {t('materialsHelp')}
      </p>

      {value.length > 0 && (
        <ul className="list-group mb-3">
          {value.map((m, i) => (
            <li
              key={`${m.url}-${i}`}
              className="list-group-item d-flex justify-content-between align-items-center"
            >
              <div style={{ minWidth: 0 }} className="me-3">
                <div className="fw-semibold">{m.title}</div>
                <small className="text-muted d-block text-truncate">
                  {m.url}
                </small>
                <small className="text-secondary">
                  {t(`visibility.${m.visibility}`)}
                </small>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-outline-danger"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                {t('remove')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div
        className="border rounded p-3 bg-white"
        style={{ borderColor: '#e8e8e8' }}
      >
        <div className="mb-2">
          <label className="form-label" htmlFor="mat-title">
            {t('materialTitle')}
          </label>
          <input
            id="mat-title"
            type="text"
            className="form-control"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </div>
        <div className="mb-2">
          <FileOrUrlInput
            id="mat-url"
            label={t('materialUrl')}
            assetType="document"
            value={draft.url || null}
            onChange={(next) =>
              setDraft({
                ...draft,
                url: next ?? '',
                type: next && next.includes('/assets/') ? 'file' : 'link',
              })
            }
          />
        </div>
        <div className="row g-2">
          <div className="col-md-6">
            <label className="form-label" htmlFor="mat-vis">
              {t('visibilityLabel')}
            </label>
            <select
              id="mat-vis"
              className="form-select"
              value={draft.visibility}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  visibility: e.target.value as MaterialDraft['visibility'],
                })
              }
            >
              <option value="ALWAYS">{t('visibility.ALWAYS')}</option>
              <option value="BEFORE">{t('visibility.BEFORE')}</option>
              <option value="DURING">{t('visibility.DURING')}</option>
              <option value="AFTER">{t('visibility.AFTER')}</option>
            </select>
          </div>
          <div className="col-md-6 d-flex align-items-end">
            <button
              type="button"
              className="btn btn-primary w-100"
              onClick={add}
              disabled={!draft.title.trim() || !draft.url.trim()}
            >
              {t('addMaterial')}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function QuestionnairesSection({
  questionnaires,
  preId,
  postId,
  onPre,
  onPost,
}: {
  questionnaires: QRow[];
  preId: string | null;
  postId: string | null;
  onPre: (id: string | null) => void;
  onPost: (id: string | null) => void;
}) {
  const t = useTranslations('admin.wizard.step4');

  const title = (q: QRow): string => {
    if (!q.title) return q.id;
    if (typeof q.title === 'string') return q.title;
    return q.title.it ?? q.title.en ?? q.id;
  };

  if (questionnaires.length === 0) {
    return (
      <section className="mb-3">
        <h3 className="h6 fw-semibold mb-2" style={{ color: '#17324D' }}>
          {t('questionnairesHeading')}
        </h3>
        <div className="alert alert-info" role="status">
          {t('questionnairesEmpty')}
        </div>
      </section>
    );
  }

  return (
    <section className="mb-3">
      <h3 className="h6 fw-semibold mb-2" style={{ color: '#17324D' }}>
        {t('questionnairesHeading')}
      </h3>
      <div className="row g-3">
        <div className="col-md-6">
          <label className="form-label" htmlFor="q-pre">
            {t('preQuestionnaire')}
          </label>
          <select
            id="q-pre"
            className="form-select"
            value={preId ?? ''}
            onChange={(e) => onPre(e.target.value || null)}
          >
            <option value="">{t('none')}</option>
            {questionnaires.map((q) => (
              <option key={q.id} value={q.id}>
                {title(q)}
              </option>
            ))}
          </select>
        </div>
        <div className="col-md-6">
          <label className="form-label" htmlFor="q-post">
            {t('postQuestionnaire')}
          </label>
          <select
            id="q-post"
            className="form-select"
            value={postId ?? ''}
            onChange={(e) => onPost(e.target.value || null)}
          >
            <option value="">{t('none')}</option>
            {questionnaires.map((q) => (
              <option key={q.id} value={q.id}>
                {title(q)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </section>
  );
}
