'use client';

/**
 * Step 4 — Content.
 *
 * Let the admin attach pre/post questionnaires (reusable templates + ad-hoc
 * questions) and materials. Templates are fetched from
 * /api/admin/question-templates. Ad-hoc questions are default-locale only;
 * the wizard shell wraps them into the multi-locale API shape on submit.
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

export type AdhocQuestionType =
  | 'SINGLE_CHOICE'
  | 'MULTI_CHOICE'
  | 'YES_NO'
  | 'LIKERT'
  | 'OPEN_TEXT';

export interface AdhocQuestionDraft {
  prompt: string;
  type: AdhocQuestionType;
  options: string[];
  scaleMin: number | null;
  scaleMax: number | null;
  required: boolean;
}

export interface QuestionnaireBlock {
  templateIds: string[];
  adhocQuestions: AdhocQuestionDraft[];
}

export interface Step4Value {
  preEventQuestionnaire: QuestionnaireBlock;
  postEventQuestionnaire: QuestionnaireBlock;
  materials: MaterialDraft[];
}

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  itemCount?: number;
}

interface Props {
  value: Step4Value;
  onChange: (patch: Partial<Step4Value>) => void;
  onSaveDraftAndNavigate: (destination: string) => Promise<void>;
  submitting?: boolean;
}

export function makeEmptyQuestionnaireBlock(): QuestionnaireBlock {
  return { templateIds: [], adhocQuestions: [] };
}

export function makeEmptyAdhocQuestion(): AdhocQuestionDraft {
  return {
    prompt: '',
    type: 'SINGLE_CHOICE',
    options: ['', ''],
    scaleMin: 1,
    scaleMax: 5,
    required: false,
  };
}

export default function Step4Content({
  value,
  onChange,
  onSaveDraftAndNavigate,
  submitting,
}: Props) {
  const t = useTranslations('admin.wizard.step4');
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [savingDraft, setSavingDraft] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/question-templates', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((data) => {
        if (cancelled) return;
        setTemplates(Array.isArray(data.rows) ? data.rows : []);
      })
      .catch(() => {
        /* silent */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSaveAndNavigate = async () => {
    setSavingDraft(true);
    try {
      // The destination is resolved inside the shell (needs the created id);
      // we pass a sentinel that the shell will rewrite after creation.
      await onSaveDraftAndNavigate('__questionnaires__');
    } finally {
      setSavingDraft(false);
    }
  };

  return (
    <div>
      <h2 className="h4 fw-bold mb-3" style={{ color: '#17324D' }}>
        {t('heading')}
      </h2>
      <p className="text-secondary mb-4" style={{ fontSize: '0.9rem' }}>
        {t('intro')}
      </p>

      <QuestionnairesSection
        value={value}
        onChange={onChange}
        templates={templates}
        onSaveAndNavigate={handleSaveAndNavigate}
        savingDraft={savingDraft || submitting === true}
      />

      <MaterialsSection
        value={value.materials}
        onChange={(next) => onChange({ materials: next })}
      />
    </div>
  );
}

// ── Questionnaires section ─────────────────────────────────────────────────

function QuestionnairesSection({
  value,
  onChange,
  templates,
  onSaveAndNavigate,
  savingDraft,
}: {
  value: Step4Value;
  onChange: (patch: Partial<Step4Value>) => void;
  templates: TemplateRow[];
  onSaveAndNavigate: () => void | Promise<void>;
  savingDraft: boolean;
}) {
  const t = useTranslations('admin.wizard.step4');

  return (
    <section className="mb-4">
      <h3 className="h5 fw-semibold mb-2" style={{ color: '#17324D' }}>
        {t('questionnairesHeading')}
      </h3>
      <p className="text-secondary mb-3" style={{ fontSize: '0.85rem' }}>
        {t('questionnairesIntro')}
      </p>

      <PlacementBlock
        heading={t('preHeading')}
        idPrefix="pre"
        templates={templates}
        value={value.preEventQuestionnaire}
        onChange={(next) => onChange({ preEventQuestionnaire: next })}
      />

      <PlacementBlock
        heading={t('postHeading')}
        idPrefix="post"
        templates={templates}
        value={value.postEventQuestionnaire}
        onChange={(next) => onChange({ postEventQuestionnaire: next })}
      />

      <div className="d-flex justify-content-end mb-2">
        <button
          type="button"
          className="btn btn-outline-primary"
          onClick={() => void onSaveAndNavigate()}
          disabled={savingDraft}
        >
          {savingDraft ? '...' : t('saveDraftAndGoQuestionnaires')}
        </button>
      </div>
    </section>
  );
}

function PlacementBlock({
  heading,
  idPrefix,
  templates,
  value,
  onChange,
}: {
  heading: string;
  idPrefix: string;
  templates: TemplateRow[];
  value: QuestionnaireBlock;
  onChange: (next: QuestionnaireBlock) => void;
}) {
  const t = useTranslations('admin.wizard.step4');

  const toggleTemplate = (id: string) => {
    const next = value.templateIds.includes(id)
      ? value.templateIds.filter((x) => x !== id)
      : [...value.templateIds, id];
    onChange({ ...value, templateIds: next });
  };

  const updateAdhoc = (index: number, patch: Partial<AdhocQuestionDraft>) => {
    const nextList = value.adhocQuestions.map((q, i) =>
      i === index ? { ...q, ...patch } : q,
    );
    onChange({ ...value, adhocQuestions: nextList });
  };

  const removeAdhoc = (index: number) => {
    onChange({
      ...value,
      adhocQuestions: value.adhocQuestions.filter((_, i) => i !== index),
    });
  };

  const addAdhoc = () => {
    onChange({
      ...value,
      adhocQuestions: [...value.adhocQuestions, makeEmptyAdhocQuestion()],
    });
  };

  return (
    <div
      className="border rounded p-3 mb-3 bg-white"
      style={{ borderColor: '#e8e8e8' }}
    >
      <h4 className="h6 fw-semibold mb-3" style={{ color: '#17324D' }}>
        {heading}
      </h4>

      <div className="mb-3">
        <label className="form-label">{t('templatesLabel')}</label>
        {templates.length === 0 ? (
          <div className="alert alert-info py-2 mb-0" role="status">
            <small>{t('templatesEmpty')}</small>
          </div>
        ) : (
          <div className="d-flex flex-wrap gap-2">
            {templates.map((tpl) => {
              const active = value.templateIds.includes(tpl.id);
              return (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => toggleTemplate(tpl.id)}
                  className={`btn btn-sm ${active ? 'btn-primary' : 'btn-outline-primary'}`}
                  style={{ borderRadius: 999 }}
                  aria-pressed={active}
                >
                  {active ? '✓ ' : ''}
                  {tpl.name}
                  {typeof tpl.itemCount === 'number' ? ` (${tpl.itemCount})` : ''}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <label className="form-label mb-2">{t('adhocLabel')}</label>

        {value.adhocQuestions.length > 0 && (
          <ul className="list-unstyled mb-2">
            {value.adhocQuestions.map((q, i) => (
              <li key={i} className="mb-2">
                <AdhocQuestionEditor
                  idPrefix={`${idPrefix}-${i}`}
                  value={q}
                  onChange={(patch) => updateAdhoc(i, patch)}
                  onRemove={() => removeAdhoc(i)}
                />
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          onClick={addAdhoc}
        >
          {t('addQuestion')}
        </button>
      </div>
    </div>
  );
}

function AdhocQuestionEditor({
  idPrefix,
  value,
  onChange,
  onRemove,
}: {
  idPrefix: string;
  value: AdhocQuestionDraft;
  onChange: (patch: Partial<AdhocQuestionDraft>) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('admin.wizard.step4');

  const updateOption = (index: number, text: string) => {
    onChange({
      options: value.options.map((o, i) => (i === index ? text : o)),
    });
  };

  const addOption = () => {
    onChange({ options: [...value.options, ''] });
  };

  const removeOption = (index: number) => {
    if (value.options.length <= 2) return;
    onChange({ options: value.options.filter((_, i) => i !== index) });
  };

  const needsOptions =
    value.type === 'SINGLE_CHOICE' || value.type === 'MULTI_CHOICE';

  return (
    <div
      className="border rounded p-3"
      style={{ borderColor: '#e8e8e8', background: '#fbfbfd' }}
    >
      <div className="mb-2">
        <label className="form-label" htmlFor={`${idPrefix}-prompt`}>
          {t('questionPrompt')}
        </label>
        <input
          id={`${idPrefix}-prompt`}
          type="text"
          className="form-control"
          value={value.prompt}
          onChange={(e) => onChange({ prompt: e.target.value })}
        />
      </div>

      <div className="row g-2 mb-2">
        <div className="col-md-6">
          <label className="form-label" htmlFor={`${idPrefix}-type`}>
            {t('questionType')}
          </label>
          <select
            id={`${idPrefix}-type`}
            className="form-select"
            value={value.type}
            onChange={(e) => {
              const nextType = e.target.value as AdhocQuestionType;
              const patch: Partial<AdhocQuestionDraft> = { type: nextType };
              if (
                (nextType === 'SINGLE_CHOICE' || nextType === 'MULTI_CHOICE') &&
                value.options.length < 2
              ) {
                patch.options = ['', ''];
              }
              if (nextType === 'LIKERT') {
                if (value.scaleMin == null) patch.scaleMin = 1;
                if (value.scaleMax == null) patch.scaleMax = 5;
              }
              onChange(patch);
            }}
          >
            <option value="SINGLE_CHOICE">{t('questionTypeSingle')}</option>
            <option value="MULTI_CHOICE">{t('questionTypeMulti')}</option>
            <option value="YES_NO">{t('questionTypeYesNo')}</option>
            <option value="LIKERT">{t('questionTypeLikert')}</option>
            <option value="OPEN_TEXT">{t('questionTypeOpen')}</option>
          </select>
        </div>
        <div className="col-md-6 d-flex align-items-end">
          <div className="form-check me-auto">
            <input
              id={`${idPrefix}-required`}
              type="checkbox"
              className="form-check-input"
              checked={value.required}
              onChange={(e) => onChange({ required: e.target.checked })}
            />
            <label
              className="form-check-label"
              htmlFor={`${idPrefix}-required`}
            >
              {t('required')}
            </label>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-outline-danger"
            onClick={onRemove}
          >
            {t('remove')}
          </button>
        </div>
      </div>

      {needsOptions && (
        <div className="mb-2">
          <ul className="list-unstyled mb-2">
            {value.options.map((opt, i) => (
              <li key={i} className="d-flex gap-2 mb-1">
                <input
                  type="text"
                  className="form-control"
                  placeholder={`${t('option')} ${i + 1}`}
                  value={opt}
                  onChange={(e) => updateOption(i, e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-sm btn-outline-danger"
                  onClick={() => removeOption(i)}
                  disabled={value.options.length <= 2}
                  aria-label={t('remove')}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={addOption}
          >
            {t('addOption')}
          </button>
        </div>
      )}

      {value.type === 'LIKERT' && (
        <div className="row g-2">
          <div className="col-md-6">
            <label className="form-label" htmlFor={`${idPrefix}-min`}>
              {t('scaleMin')}
            </label>
            <input
              id={`${idPrefix}-min`}
              type="number"
              min={1}
              max={10}
              className="form-control"
              value={value.scaleMin ?? 1}
              onChange={(e) =>
                onChange({ scaleMin: Number(e.target.value) || 1 })
              }
            />
          </div>
          <div className="col-md-6">
            <label className="form-label" htmlFor={`${idPrefix}-max`}>
              {t('scaleMax')}
            </label>
            <input
              id={`${idPrefix}-max`}
              type="number"
              min={2}
              max={11}
              className="form-control"
              value={value.scaleMax ?? 5}
              onChange={(e) =>
                onChange({ scaleMax: Number(e.target.value) || 5 })
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Materials section (unchanged layout, moved below) ──────────────────────

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
      <h3 className="h5 fw-semibold mb-2" style={{ color: '#17324D' }}>
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
