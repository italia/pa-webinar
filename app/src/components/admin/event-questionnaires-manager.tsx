'use client';

/**
 * Per-event questionnaire configuration (admin-authenticated).
 *
 * Lets the admin attach a PRE_REGISTRATION and/or POST_EVENT questionnaire
 * to a specific event, selecting any number of library templates and
 * adding ad-hoc items. Both placements share the same form shape.
 *
 * Note: the endpoint refuses edits once responses are collected, so the
 * UI surfaces that as a disabled "Reset" flow (DELETE + reconfigure).
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Button, Card, CardBody, Input, Label } from 'design-react-kit';

import { useConfirm } from '@/components/ui/confirm-dialog';
import {
  USAGE_SHORT_KEY,
  isForOtherMoment,
  templatesFor,
  type QuestionnaireMoment,
} from '@/lib/questionnaires/template-usage';

type Placement = QuestionnaireMoment;

type QuestionType = 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'YES_NO' | 'LIKERT' | 'OPEN_TEXT';

// Le etichette sono quelle del wizard (admin.wizard.step4.questionType*).
const QUESTION_TYPES: { value: QuestionType; labelKey: string }[] = [
  { value: 'OPEN_TEXT', labelKey: 'questionTypeOpen' },
  { value: 'SINGLE_CHOICE', labelKey: 'questionTypeSingle' },
  { value: 'MULTI_CHOICE', labelKey: 'questionTypeMulti' },
  { value: 'YES_NO', labelKey: 'questionTypeYesNo' },
  { value: 'LIKERT', labelKey: 'questionTypeLikert' },
];

interface AdhocItemDraft {
  id?: string;
  promptIt: string;
  promptEn: string;
  /** Le lingue oltre a italiano e inglese, che qui non si modificano: si
   *  rimandano com'erano (lo stesso per le opzioni). */
  promptOther: Record<string, string>;
  type: QuestionType;
  options: { it: string; en: string; other?: Record<string, string> }[];
  scaleMin: number;
  scaleMax: number;
  required: boolean;
}

interface TemplateOption {
  id: string;
  name: string;
  itemCount: number;
  usage: QuestionnaireMoment | null;
}

interface PlacementState {
  enabled: boolean;
  exists: boolean;
  titleIt: string;
  descriptionIt: string;
  /** Le altre lingue di titolo e descrizione, che qui non si modificano: si
   *  rimandano com'erano, altrimenti salvare le cancellerebbe. */
  titleOther: Record<string, string>;
  descriptionOther: Record<string, string>;
  required: boolean;
  allowEdit: boolean;
  selectedTemplateIds: string[];
  /** I modelli salvati all'ultimo caricamento: restano in elenco anche se
   *  sono per l'altro momento, così togliere la spunta non li fa sparire. */
  savedTemplateIds: string[];
  adhoc: AdhocItemDraft[];
  responseCount: number;
  saving: boolean;
  error: string | null;
}

const EMPTY_PLACEMENT: PlacementState = {
  enabled: false,
  exists: false,
  titleIt: '',
  descriptionIt: '',
  titleOther: {},
  descriptionOther: {},
  required: false,
  allowEdit: false,
  selectedTemplateIds: [],
  savedTemplateIds: [],
  adhoc: [],
  responseCount: 0,
  saving: false,
  error: null,
};

function senzaItaliano(campo: Record<string, string> | null | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(campo ?? {}).filter(([k]) => k !== 'it'));
}

export default function EventQuestionnairesManager({ eventId }: { eventId: string }) {
  const t = useTranslations('admin.eventQuestionnaires');
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [pre, setPre] = useState<PlacementState>(EMPTY_PLACEMENT);
  const [post, setPost] = useState<PlacementState>(EMPTY_PLACEMENT);

  const load = useCallback(async () => {
    const [tplsRes, existingRes] = await Promise.all([
      fetch('/api/admin/question-templates', { cache: 'no-store' }),
      fetch(`/api/admin/events/${eventId}/questionnaires`, { cache: 'no-store' }),
    ]);
    const tpls = tplsRes.ok ? (await tplsRes.json()).rows : [];
    setTemplates(
      tpls.map((r: { id: string; name: string; itemCount: number; usage?: QuestionnaireMoment | null }) => ({
        id: r.id,
        name: r.name,
        itemCount: r.itemCount,
        usage: r.usage ?? null,
      })),
    );

    const existing: { rows: PlacementResponse[] } = existingRes.ok
      ? await existingRes.json()
      : { rows: [] };
    for (const placement of ['PRE_REGISTRATION', 'POST_EVENT'] as const) {
      const match = existing.rows.find((r) => r.placement === placement);
      const setter = placement === 'PRE_REGISTRATION' ? setPre : setPost;
      if (match) {
        setter({
          ...EMPTY_PLACEMENT,
          enabled: true,
          exists: true,
          titleIt: (match.title as Record<string, string>).it ?? '',
          descriptionIt: (match.description as Record<string, string>).it ?? '',
          titleOther: senzaItaliano(match.title as Record<string, string>),
          descriptionOther: senzaItaliano(match.description as Record<string, string>),
          required: match.required,
          allowEdit: match.allowEdit,
          selectedTemplateIds: match.templates.map((t) => t.id),
          savedTemplateIds: match.templates.map((t) => t.id),
          adhoc: match.adhocItems.map(adhocFromServer),
          responseCount: match.responseCount,
        });
      }
    }
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="d-flex flex-column gap-4">
      <PlacementCard
        placement="PRE_REGISTRATION"
        title={t('preTitle')}
        description={t('preDescription')}
        templates={templates}
        state={pre}
        setState={setPre}
        eventId={eventId}
        onRefresh={load}
      />
      <PlacementCard
        placement="POST_EVENT"
        title={t('postTitle')}
        description={t('postDescription')}
        templates={templates}
        state={post}
        setState={setPost}
        eventId={eventId}
        onRefresh={load}
      />
    </div>
  );
}

interface PlacementResponse {
  placement: Placement;
  title: Record<string, string>;
  description: Record<string, string>;
  required: boolean;
  allowEdit: boolean;
  templates: { id: string; name: string; sortOrder: number }[];
  adhocItems: {
    id: string;
    prompt: Record<string, string>;
    type: QuestionType;
    options: Record<string, string>[] | null;
    scaleMin: number | null;
    scaleMax: number | null;
    required: boolean;
    sortOrder: number;
  }[];
  responseCount: number;
}

function altreLingue(campo: Record<string, string> | null | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(campo ?? {}).filter(([k]) => k !== 'it' && k !== 'en'));
}

function adhocFromServer(i: PlacementResponse['adhocItems'][number]): AdhocItemDraft {
  return {
    id: i.id,
    promptIt: i.prompt.it ?? '',
    promptEn: i.prompt.en ?? '',
    promptOther: altreLingue(i.prompt),
    type: i.type,
    options: i.options && i.options.length > 0
      ? i.options.map((o) => ({ it: o.it ?? '', en: o.en ?? '', other: altreLingue(o) }))
      : [{ it: '', en: '' }, { it: '', en: '' }],
    scaleMin: i.scaleMin ?? 1,
    scaleMax: i.scaleMax ?? 5,
    required: i.required,
  };
}

function PlacementCard({
  placement,
  title,
  description,
  templates,
  state,
  setState,
  eventId,
  onRefresh,
}: {
  placement: Placement;
  title: string;
  description: string;
  templates: TemplateOption[];
  state: PlacementState;
  setState: React.Dispatch<React.SetStateAction<PlacementState>>;
  eventId: string;
  onRefresh: () => void;
}) {
  const t = useTranslations('admin.eventQuestionnaires');
  const tq = useTranslations('admin.questionTemplates');
  const tw = useTranslations('admin.wizard.step4');
  const tc = useTranslations('common');
  const confirm = useConfirm();
  const proposti = templatesFor(placement, templates, [
    ...state.savedTemplateIds,
    ...state.selectedTemplateIds,
  ]);
  const locked = state.responseCount > 0;

  const save = async () => {
    setState((s) => ({ ...s, saving: true, error: null }));
    try {
      const payload = {
        placement,
        title: { ...state.titleOther, ...(state.titleIt.trim() ? { it: state.titleIt.trim() } : {}) },
        description: {
          ...state.descriptionOther,
          ...(state.descriptionIt.trim() ? { it: state.descriptionIt.trim() } : {}),
        },
        required: state.required,
        allowEdit: state.allowEdit,
        templateIds: state.selectedTemplateIds,
        adhocItems: state.adhoc.map((it, idx) => {
          const base: Record<string, unknown> = {
            prompt: buildPrompt(it),
            type: it.type,
            required: it.required,
            sortOrder: idx,
          };
          if (it.type === 'SINGLE_CHOICE' || it.type === 'MULTI_CHOICE') {
            base.options = it.options
              .map((o) => {
                const filled: Record<string, string> = { ...(o.other ?? {}) };
                if (o.it.trim()) filled.it = o.it.trim();
                if (o.en.trim()) filled.en = o.en.trim();
                return filled;
              })
              .filter((o) => Object.keys(o).length > 0);
          }
          if (it.type === 'LIKERT') {
            base.scaleMin = it.scaleMin;
            base.scaleMax = it.scaleMax;
          }
          return base;
        }),
      };

      const res = await fetch(`/api/admin/events/${eventId}/questionnaires/${placement}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        // Un rifiuto che si puo' correggere lo si dice; il dettaglio del
        // server resta fra parentesi.
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const messaggio =
          res.status === 409
            ? t('locked', { count: state.responseCount })
            : res.status === 400 || res.status === 422
              ? `${t('invalid')}${body.error ? ` (${body.error})` : ''}`
              : tc('errorGeneric');
        setState((s) => ({ ...s, error: messaggio, saving: false }));
        return;
      }
      setState((s) => ({ ...s, saving: false }));
      onRefresh();
    } catch {
      setState((s) => ({ ...s, saving: false, error: tc('errorGeneric') }));
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: t('deleteTitle'),
      message: t('deleteMessage'),
      confirmLabel: tc('delete'),
      danger: true,
    });
    if (!ok) return;
    // Dopo la conferma, che dice che si cancellano anche le risposte.
    const res = await fetch(
      `/api/admin/events/${eventId}/questionnaires/${placement}?withResponses=1`,
      { method: 'DELETE' },
    );
    if (res.ok) {
      setState({ ...EMPTY_PLACEMENT });
      onRefresh();
    }
  };

  const addAdhoc = () => {
    setState((s) => ({
      ...s,
      adhoc: [
        ...s.adhoc,
        {
          promptIt: '',
          promptEn: '',
          promptOther: {},
          type: 'OPEN_TEXT',
          options: [{ it: '', en: '' }, { it: '', en: '' }],
          scaleMin: 1,
          scaleMax: 5,
          required: false,
        },
      ],
    }));
  };

  return (
    <Card className="shadow-sm border-0" style={{ borderRadius: 8 }}>
      <CardBody className="p-4">
        <div className="d-flex justify-content-between align-items-start gap-2 mb-2">
          <div>
            <h2 className="h5 fw-semibold mb-1" style={{ color: 'var(--app-text)' }}>
              {title}
            </h2>
            <p className="text-secondary mb-0" style={{ fontSize: '0.85rem' }}>
              {description}
            </p>
          </div>
          <div className="d-flex gap-2">
            {state.exists && (
              <Badge color="" className="px-2 py-1" style={{ backgroundColor: '#E8F0FE', color: 'var(--app-primary)' }}>
                {t('responses', { count: state.responseCount })}
              </Badge>
            )}
          </div>
        </div>

        <div className="form-check form-switch mb-3 mt-3">
          <input
            className="form-check-input"
            type="checkbox"
            role="switch"
            id={`enabled-${placement}`}
            checked={state.enabled}
            onChange={(e) => setState((s) => ({ ...s, enabled: e.target.checked }))}
          />
          <label className="form-check-label" htmlFor={`enabled-${placement}`}>
            {t('active')}
          </label>
        </div>

        {state.enabled && (
          <>
            {locked && (
              <div className="alert alert-warning small">
                {t('locked', { count: state.responseCount })}
              </div>
            )}
            {state.error && <div className="alert alert-danger" role="alert">{state.error}</div>}

            <div className="row g-3 mb-3">
              <div className="col-md-6">
                <Label for={`title-${placement}`}>{t('titleIt')}</Label>
                <Input
                  id={`title-${placement}`}
                  type="text"
                  value={state.titleIt}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setState((s) => ({ ...s, titleIt: e.target.value }))
                  }
                />
              </div>
              <div className="col-md-6">
                <Label for={`desc-${placement}`}>{t('descriptionIt')}</Label>
                <Input
                  id={`desc-${placement}`}
                  type="text"
                  value={state.descriptionIt}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setState((s) => ({ ...s, descriptionIt: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="row g-3 mb-3">
              <div className="col-md-6 d-flex align-items-center">
                <div className="form-check">
                  <input
                    id={`req-${placement}`}
                    className="form-check-input"
                    type="checkbox"
                    checked={state.required}
                    onChange={(e) => setState((s) => ({ ...s, required: e.target.checked }))}
                  />
                  <label className="form-check-label" htmlFor={`req-${placement}`}>
                    {t('required')}
                  </label>
                </div>
              </div>
              <div className="col-md-6 d-flex align-items-center">
                <div className="form-check">
                  <input
                    id={`edit-${placement}`}
                    className="form-check-input"
                    type="checkbox"
                    checked={state.allowEdit}
                    onChange={(e) => setState((s) => ({ ...s, allowEdit: e.target.checked }))}
                  />
                  <label className="form-check-label" htmlFor={`edit-${placement}`}>
                    {t('allowEdit')}
                  </label>
                </div>
              </div>
            </div>

            <div className="mb-3">
              <div className="form-label" id={`tpls-${placement}`}>{t('libraryTemplates')}</div>
              {proposti.length === 0 ? (
                <div className="text-muted small">
                  {templates.length === 0 ? tw('templatesEmpty') : tw('templatesNoneForMoment')}
                </div>
              ) : (
                <div className="d-flex flex-column gap-1">
                  {proposti.map((tpl) => (
                    <div key={tpl.id} className="form-check">
                      <input
                        id={`tpl-${placement}-${tpl.id}`}
                        className="form-check-input"
                        type="checkbox"
                        checked={state.selectedTemplateIds.includes(tpl.id)}
                        onChange={(e) => {
                          setState((s) => ({
                            ...s,
                            selectedTemplateIds: e.target.checked
                              ? [...s.selectedTemplateIds, tpl.id]
                              : s.selectedTemplateIds.filter((x) => x !== tpl.id),
                          }));
                        }}
                      />
                      <label className="form-check-label" htmlFor={`tpl-${placement}-${tpl.id}`}>
                        {tpl.name}{' '}
                        <span className="text-muted small">· {t('templateItems', { count: tpl.itemCount })}</span>
                        {isForOtherMoment(placement, tpl.usage) && tpl.usage && (
                          <span className="text-muted small"> · {tq(USAGE_SHORT_KEY[tpl.usage])}</span>
                        )}
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mb-3">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <div className="form-label mb-0">{tw('adhocLabel')}</div>
                <Button color="secondary" outline size="xs" onClick={addAdhoc}>
                  + {tq('addQuestion')}
                </Button>
              </div>
              {state.adhoc.length === 0 && (
                <div className="text-muted small">{t('adhocEmpty')}</div>
              )}
              {state.adhoc.map((it, idx) => (
                <AdhocItemEditor
                  key={idx}
                  idx={idx}
                  item={it}
                  onChange={(patch) =>
                    setState((s) => ({
                      ...s,
                      adhoc: s.adhoc.map((x, i) => (i === idx ? { ...x, ...patch } : x)),
                    }))
                  }
                  onRemove={() =>
                    setState((s) => ({ ...s, adhoc: s.adhoc.filter((_, i) => i !== idx) }))
                  }
                />
              ))}
            </div>

            <div className="d-flex gap-2">
              <Button color="primary" onClick={save} disabled={state.saving || locked}>
                {state.saving ? tc('saving') : t('save')}
              </Button>
              {state.exists && (
                <Button color="danger" outline onClick={remove} disabled={state.saving}>
                  {t('deleteTitle')}
                </Button>
              )}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function AdhocItemEditor({
  idx,
  item,
  onChange,
  onRemove,
}: {
  idx: number;
  item: AdhocItemDraft;
  onChange: (patch: Partial<AdhocItemDraft>) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('admin.eventQuestionnaires');
  const tq = useTranslations('admin.questionTemplates');
  const tw = useTranslations('admin.wizard.step4');
  const base = `adhoc-${idx}`;
  return (
    <Card className="mb-2 border" style={{ borderRadius: 6 }}>
      <CardBody className="p-3">
        <div className="d-flex justify-content-between align-items-start mb-2">
          <Badge color="" className="px-2 py-1" style={{ backgroundColor: '#E8F0FE', color: 'var(--app-primary)' }}>
            {t('adhocBadge', { n: idx + 1 })}
          </Badge>
          <Button
            color="danger"
            outline
            size="xs"
            onClick={onRemove}
            aria-label={tq('removeQuestion', { n: idx + 1 })}
          >
            {tq('remove')}
          </Button>
        </div>
        <div className="mb-2">
          <Label for={`${base}-it`}>{tq('promptIt')}</Label>
          <Input
            id={`${base}-it`}
            type="text"
            value={item.promptIt}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ promptIt: e.target.value })}
          />
        </div>
        <div className="row g-2 mb-2">
          <div className="col-md-6">
            <Label for={`${base}-type`}>{tq('type')}</Label>
            <select
              id={`${base}-type`}
              className="form-select"
              value={item.type}
              onChange={(e) => onChange({ type: e.target.value as QuestionType })}
            >
              {QUESTION_TYPES.map((qt) => (
                <option key={qt.value} value={qt.value}>
                  {tw(qt.labelKey)}
                </option>
              ))}
            </select>
          </div>
          <div className="col-md-6 d-flex align-items-end">
            <div className="form-check">
              <input
                id={`adhoc-req-${idx}`}
                className="form-check-input"
                type="checkbox"
                checked={item.required}
                onChange={(e) => onChange({ required: e.target.checked })}
              />
              <label className="form-check-label" htmlFor={`adhoc-req-${idx}`}>
                {tq('required')}
              </label>
            </div>
          </div>
        </div>

        {(item.type === 'SINGLE_CHOICE' || item.type === 'MULTI_CHOICE') && (
          <div className="mb-2">
            <div className="form-label">{tq('options')}</div>
            {item.options.map((opt, optIdx) => (
              <div key={optIdx} className="row g-2 mb-1 align-items-center">
                <div className="col">
                  <Input
                    type="text"
                    aria-label={tq('optionIt', { n: optIdx + 1 })}
                    value={opt.it}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      onChange({
                        options: item.options.map((o, i) =>
                          i === optIdx ? { ...o, it: e.target.value } : o,
                        ),
                      })
                    }
                  />
                </div>
                <div className="col-auto">
                  <Button
                    color="danger"
                    outline
                    size="xs"
                    onClick={() =>
                      onChange({ options: item.options.filter((_, i) => i !== optIdx) })
                    }
                    aria-label={tq('removeOption', { n: optIdx + 1 })}
                  >
                    ×
                  </Button>
                </div>
              </div>
            ))}
            <Button
              color="secondary"
              outline
              size="xs"
              onClick={() => onChange({ options: [...item.options, { it: '', en: '' }] })}
            >
              + {tq('addOption')}
            </Button>
          </div>
        )}

        {item.type === 'LIKERT' && (
          <div className="row g-2">
            <div className="col-md-6">
              <Label for={`${base}-min`}>{tq('scaleMin')}</Label>
              <Input
                id={`${base}-min`}
                type="number"
                value={item.scaleMin}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  onChange({ scaleMin: Number(e.target.value) || 1 })
                }
              />
            </div>
            <div className="col-md-6">
              <Label for={`${base}-max`}>{tq('scaleMax')}</Label>
              <Input
                id={`${base}-max`}
                type="number"
                value={item.scaleMax}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  onChange({ scaleMax: Number(e.target.value) || 5 })
                }
              />
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function buildPrompt(it: AdhocItemDraft): Record<string, string> {
  const prompt: Record<string, string> = { ...it.promptOther };
  if (it.promptIt.trim()) prompt.it = it.promptIt.trim();
  if (it.promptEn.trim()) prompt.en = it.promptEn.trim();
  return prompt;
}
