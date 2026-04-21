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
import { Badge, Button, Card, CardBody, Input, Label } from 'design-react-kit';

type Placement = 'PRE_REGISTRATION' | 'POST_EVENT';

type QuestionType = 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'YES_NO' | 'LIKERT' | 'OPEN_TEXT';

const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
  { value: 'OPEN_TEXT', label: 'Testo libero' },
  { value: 'SINGLE_CHOICE', label: 'Scelta singola' },
  { value: 'MULTI_CHOICE', label: 'Scelta multipla' },
  { value: 'YES_NO', label: 'Sì/No' },
  { value: 'LIKERT', label: 'Scala Likert' },
];

interface AdhocItemDraft {
  id?: string;
  promptIt: string;
  promptEn: string;
  type: QuestionType;
  options: { it: string; en: string }[];
  scaleMin: number;
  scaleMax: number;
  required: boolean;
}

interface TemplateOption {
  id: string;
  name: string;
  itemCount: number;
}

interface PlacementState {
  enabled: boolean;
  exists: boolean;
  titleIt: string;
  descriptionIt: string;
  required: boolean;
  allowEdit: boolean;
  selectedTemplateIds: string[];
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
  required: false,
  allowEdit: false,
  selectedTemplateIds: [],
  adhoc: [],
  responseCount: 0,
  saving: false,
  error: null,
};

export default function EventQuestionnairesManager({ eventId }: { eventId: string }) {
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [pre, setPre] = useState<PlacementState>(EMPTY_PLACEMENT);
  const [post, setPost] = useState<PlacementState>(EMPTY_PLACEMENT);

  const load = useCallback(async () => {
    const [tplsRes, existingRes] = await Promise.all([
      fetch('/api/admin/question-templates', { cache: 'no-store' }),
      fetch(`/api/admin/events/${eventId}/questionnaires`, { cache: 'no-store' }),
    ]);
    const tpls = tplsRes.ok ? (await tplsRes.json()).rows : [];
    setTemplates(tpls.map((r: { id: string; name: string; itemCount: number }) => ({
      id: r.id,
      name: r.name,
      itemCount: r.itemCount,
    })));

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
          required: match.required,
          allowEdit: match.allowEdit,
          selectedTemplateIds: match.templates.map((t) => t.id),
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
        title="Pre-registrazione"
        description="Mostrato nel form di registrazione; le risposte obbligatorie bloccano l'iscrizione finché non vengono fornite."
        templates={templates}
        state={pre}
        setState={setPre}
        eventId={eventId}
        onRefresh={load}
      />
      <PlacementCard
        placement="POST_EVENT"
        title="Post-evento"
        description="Mostrato nella pagina di ringraziamento dopo la fine dell'evento."
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

function adhocFromServer(i: PlacementResponse['adhocItems'][number]): AdhocItemDraft {
  return {
    id: i.id,
    promptIt: i.prompt.it ?? '',
    promptEn: i.prompt.en ?? '',
    type: i.type,
    options: i.options && i.options.length > 0
      ? i.options.map((o) => ({ it: o.it ?? '', en: o.en ?? '' }))
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
  const locked = state.responseCount > 0;

  const save = async () => {
    setState((s) => ({ ...s, saving: true, error: null }));
    try {
      const payload = {
        placement,
        title: state.titleIt.trim() ? { it: state.titleIt.trim() } : {},
        description: state.descriptionIt.trim() ? { it: state.descriptionIt.trim() } : {},
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
                const filled: Record<string, string> = {};
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
        const err = await res.json().catch(() => ({}));
        setState((s) => ({ ...s, error: err.error ?? 'Salvataggio fallito', saving: false }));
        return;
      }
      setState((s) => ({ ...s, saving: false }));
      onRefresh();
    } catch (e) {
      setState((s) => ({
        ...s,
        saving: false,
        error: e instanceof Error ? e.message : 'Errore di rete',
      }));
    }
  };

  const remove = async () => {
    if (!confirm(`Eliminare il questionario ${placement}? Verranno cancellate anche le risposte raccolte.`)) return;
    const res = await fetch(`/api/admin/events/${eventId}/questionnaires/${placement}`, {
      method: 'DELETE',
    });
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
            <h5 className="fw-semibold mb-1" style={{ color: '#17324D' }}>
              {title}
            </h5>
            <p className="text-secondary mb-0" style={{ fontSize: '0.85rem' }}>
              {description}
            </p>
          </div>
          <div className="d-flex gap-2">
            {state.exists && (
              <Badge color="" className="px-2 py-1" style={{ backgroundColor: '#E8F0FE', color: '#0066CC' }}>
                {state.responseCount} risposte
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
            Questionario attivo
          </label>
        </div>

        {state.enabled && (
          <>
            {locked && (
              <div className="alert alert-warning small">
                Questionario con {state.responseCount} risposte raccolte — le modifiche strutturali sono
                bloccate. Per riconfigurare, elimina il questionario (e le risposte).
              </div>
            )}
            {state.error && <div className="alert alert-danger">{state.error}</div>}

            <div className="row g-3 mb-3">
              <div className="col-md-6">
                <Label>Titolo (IT)</Label>
                <Input
                  type="text"
                  value={state.titleIt}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setState((s) => ({ ...s, titleIt: e.target.value }))
                  }
                />
              </div>
              <div className="col-md-6">
                <Label>Descrizione (IT)</Label>
                <Input
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
                    Compilazione richiesta
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
                    Modifica successive alla risposta consentite
                  </label>
                </div>
              </div>
            </div>

            <div className="mb-3">
              <Label>Template della libreria</Label>
              {templates.length === 0 ? (
                <div className="text-muted small">Nessun template in libreria. Creane uno da /admin/questionnaires.</div>
              ) : (
                <div className="d-flex flex-column gap-1">
                  {templates.map((t) => (
                    <div key={t.id} className="form-check">
                      <input
                        id={`tpl-${placement}-${t.id}`}
                        className="form-check-input"
                        type="checkbox"
                        checked={state.selectedTemplateIds.includes(t.id)}
                        onChange={(e) => {
                          setState((s) => ({
                            ...s,
                            selectedTemplateIds: e.target.checked
                              ? [...s.selectedTemplateIds, t.id]
                              : s.selectedTemplateIds.filter((x) => x !== t.id),
                          }));
                        }}
                      />
                      <label className="form-check-label" htmlFor={`tpl-${placement}-${t.id}`}>
                        {t.name} <span className="text-muted small">· {t.itemCount} domande</span>
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mb-3">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <Label className="mb-0">Domande ad-hoc per questo evento</Label>
                <Button color="secondary" outline size="xs" onClick={addAdhoc}>
                  + aggiungi
                </Button>
              </div>
              {state.adhoc.length === 0 && (
                <div className="text-muted small">Nessuna domanda ad-hoc. Puoi aggiungerne per questioni specifiche all&apos;evento.</div>
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
                {state.saving ? 'Salvataggio…' : 'Salva configurazione'}
              </Button>
              {state.exists && (
                <Button color="danger" outline onClick={remove} disabled={state.saving}>
                  Elimina questionario
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
  return (
    <Card className="mb-2 border" style={{ borderRadius: 6 }}>
      <CardBody className="p-3">
        <div className="d-flex justify-content-between align-items-start mb-2">
          <Badge color="" className="px-2 py-1" style={{ backgroundColor: '#E8F0FE', color: '#0066CC' }}>
            Ad-hoc #{idx + 1}
          </Badge>
          <Button color="danger" outline size="xs" onClick={onRemove}>
            Rimuovi
          </Button>
        </div>
        <div className="mb-2">
          <Label>Domanda (IT)</Label>
          <Input
            type="text"
            value={item.promptIt}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ promptIt: e.target.value })}
          />
        </div>
        <div className="row g-2 mb-2">
          <div className="col-md-6">
            <Label>Tipo</Label>
            <select
              className="form-select"
              value={item.type}
              onChange={(e) => onChange({ type: e.target.value as QuestionType })}
            >
              {QUESTION_TYPES.map((qt) => (
                <option key={qt.value} value={qt.value}>
                  {qt.label}
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
                Obbligatoria
              </label>
            </div>
          </div>
        </div>

        {(item.type === 'SINGLE_CHOICE' || item.type === 'MULTI_CHOICE') && (
          <div className="mb-2">
            <Label>Opzioni (IT)</Label>
            {item.options.map((opt, optIdx) => (
              <div key={optIdx} className="row g-2 mb-1 align-items-center">
                <div className="col">
                  <Input
                    type="text"
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
              + opzione
            </Button>
          </div>
        )}

        {item.type === 'LIKERT' && (
          <div className="row g-2">
            <div className="col-md-6">
              <Label>Min</Label>
              <Input
                type="number"
                value={item.scaleMin}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  onChange({ scaleMin: Number(e.target.value) || 1 })
                }
              />
            </div>
            <div className="col-md-6">
              <Label>Max</Label>
              <Input
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
  const prompt: Record<string, string> = {};
  if (it.promptIt.trim()) prompt.it = it.promptIt.trim();
  if (it.promptEn.trim()) prompt.en = it.promptEn.trim();
  return prompt;
}
