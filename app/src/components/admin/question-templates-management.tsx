'use client';

/**
 * Admin UI — library of reusable questionnaire templates.
 *
 * MVP scope:
 *   - List + create/edit/delete templates
 *   - Per-item editor supports all 5 question types with type-specific
 *     fields (options for choice, scale range for Likert)
 *   - i18n editor covers IT + EN only; additional locales can be added
 *     by editing the exported JSON (or extending the UI later).
 */

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, CardBody, Input, Label } from 'design-react-kit';

import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { SkeletonLines } from '@/components/ui/skeleton';

type QuestionType = 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'YES_NO' | 'LIKERT' | 'OPEN_TEXT';

const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
  { value: 'OPEN_TEXT', label: 'Testo libero' },
  { value: 'SINGLE_CHOICE', label: 'Scelta singola' },
  { value: 'MULTI_CHOICE', label: 'Scelta multipla' },
  { value: 'YES_NO', label: 'Sì/No' },
  { value: 'LIKERT', label: 'Scala Likert' },
];

interface ItemDraft {
  id?: string;
  promptIt: string;
  promptEn: string;
  type: QuestionType;
  options: { it: string; en: string }[];
  scaleMin: number;
  scaleMax: number;
  required: boolean;
  sortOrder: number;
}

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  sortOrder: number;
  itemCount: number;
  usedByQuestionnaires: number;
}

interface TemplateDetail extends TemplateRow {
  items: {
    id: string;
    prompt: Record<string, string>;
    type: QuestionType;
    options: Record<string, string>[] | null;
    scaleMin: number | null;
    scaleMax: number | null;
    required: boolean;
    sortOrder: number;
  }[];
}

const EMPTY_ITEM: ItemDraft = {
  promptIt: '',
  promptEn: '',
  type: 'OPEN_TEXT',
  options: [
    { it: '', en: '' },
    { it: '', en: '' },
  ],
  scaleMin: 1,
  scaleMax: 5,
  required: false,
  sortOrder: 0,
};

export default function QuestionTemplatesManagement() {
  const toast = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sortOrder, setSortOrder] = useState(0);
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/question-templates', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setRows(data.rows);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const resetDraft = () => {
    setName('');
    setDescription('');
    setSortOrder(0);
    setItems([]);
    setError(null);
  };

  const startNew = () => {
    resetDraft();
    setEditingId('new');
  };

  const startEdit = async (row: TemplateRow) => {
    const res = await fetch(`/api/admin/question-templates/${row.id}`, { cache: 'no-store' });
    if (!res.ok) {
      setError('Impossibile caricare il template');
      return;
    }
    const d: TemplateDetail = await res.json();
    setName(d.name);
    setDescription(d.description ?? '');
    setSortOrder(d.sortOrder);
    setItems(
      d.items.map((i) => ({
        id: i.id,
        promptIt: i.prompt.it ?? '',
        promptEn: i.prompt.en ?? '',
        type: i.type,
        options:
          i.options && i.options.length > 0
            ? i.options.map((o) => ({ it: o.it ?? '', en: o.en ?? '' }))
            : [
                { it: '', en: '' },
                { it: '', en: '' },
              ],
        scaleMin: i.scaleMin ?? 1,
        scaleMax: i.scaleMax ?? 5,
        required: i.required,
        sortOrder: i.sortOrder,
      })),
    );
    setEditingId(row.id);
    setError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    resetDraft();
  };

  const addItem = () => {
    setItems([...items, { ...EMPTY_ITEM, sortOrder: items.length, options: [{ it: '', en: '' }, { it: '', en: '' }] }]);
  };

  const removeItem = (idx: number) => {
    setItems(items.filter((_, i) => i !== idx));
  };

  const updateItem = (idx: number, patch: Partial<ItemDraft>) => {
    setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const addOption = (itemIdx: number) => {
    const it = items[itemIdx];
    if (!it) return;
    updateItem(itemIdx, { options: [...it.options, { it: '', en: '' }] });
  };

  const removeOption = (itemIdx: number, optIdx: number) => {
    const it = items[itemIdx];
    if (!it) return;
    updateItem(itemIdx, { options: it.options.filter((_, i) => i !== optIdx) });
  };

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const payloadItems = items.map((it, idx) => {
        const prompt: Record<string, string> = {};
        if (it.promptIt.trim()) prompt.it = it.promptIt.trim();
        if (it.promptEn.trim()) prompt.en = it.promptEn.trim();

        const base: Record<string, unknown> = {
          prompt,
          type: it.type,
          required: it.required,
          sortOrder: idx,
        };
        if (it.id) base.id = it.id;
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
      });

      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        sortOrder,
        items: payloadItems,
      };

      const url =
        editingId === 'new' ? '/api/admin/question-templates' : `/api/admin/question-templates/${editingId}`;
      const method = editingId === 'new' ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error ?? 'Salvataggio fallito');
        return;
      }

      cancelEdit();
      await fetchRows();
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, description, sortOrder, items, editingId, fetchRows]);

  const handleDelete = useCallback(
    async (row: TemplateRow) => {
      if (row.isSystem) return;
      const ok = await confirm({
        title: 'Elimina template',
        message: `Eliminare "${row.name}"? Usato da ${row.usedByQuestionnaires} questionari attivi.`,
        confirmLabel: 'Elimina',
        danger: true,
      });
      if (!ok) return;
      const res = await fetch(`/api/admin/question-templates/${row.id}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchRows();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? 'Eliminazione fallita');
      }
    },
    [fetchRows, confirm, toast],
  );

  const editing = editingId !== null;

  return (
    <div>
      {!editing && (
        <div className="d-flex justify-content-end mb-3">
          <Button color="primary" size="sm" onClick={startNew}>
            + Nuovo template
          </Button>
        </div>
      )}

      {editing ? (
        <Card className="shadow-sm border-0 mb-4" style={{ borderRadius: 8 }}>
          <CardBody className="p-4">
            <h5 className="fw-semibold mb-3" style={{ color: 'var(--app-text)' }}>
              {editingId === 'new' ? 'Nuovo template' : 'Modifica template'}
            </h5>

            {error && (
              <div className="alert alert-danger mb-3" role="alert">
                {error}
              </div>
            )}

            <div className="mb-3">
              <Label for="tpl-name">Nome</Label>
              <Input
                id="tpl-name"
                type="text"
                value={name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              />
            </div>

            <div className="mb-3">
              <Label for="tpl-desc">Descrizione</Label>
              <Input
                id="tpl-desc"
                type="text"
                value={description}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDescription(e.target.value)}
              />
            </div>

            <div className="mb-3" style={{ maxWidth: 160 }}>
              <Label for="tpl-sort">Ordine</Label>
              <Input
                id="tpl-sort"
                type="number"
                value={sortOrder}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSortOrder(Number(e.target.value) || 0)}
              />
            </div>

            <hr className="my-4" />
            <h6 className="fw-semibold mb-3">Domande</h6>

            {items.map((it, idx) => (
              <Card key={idx} className="mb-3 border" style={{ borderRadius: 6 }}>
                <CardBody className="p-3">
                  <div className="d-flex justify-content-between align-items-start gap-2 mb-2">
                    <Badge color="" className="px-2 py-1" style={{ backgroundColor: '#E8F0FE', color: 'var(--app-primary)' }}>
                      #{idx + 1}
                    </Badge>
                    <Button color="danger" outline size="xs" onClick={() => removeItem(idx)}>
                      Rimuovi
                    </Button>
                  </div>

                  <div className="mb-2">
                    <Label>Domanda (IT)</Label>
                    <Input
                      type="text"
                      value={it.promptIt}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        updateItem(idx, { promptIt: e.target.value })
                      }
                    />
                  </div>
                  <div className="mb-2">
                    <Label>Domanda (EN)</Label>
                    <Input
                      type="text"
                      value={it.promptEn}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        updateItem(idx, { promptEn: e.target.value })
                      }
                    />
                  </div>

                  <div className="row g-2 mb-2">
                    <div className="col-md-6">
                      <Label>Tipo</Label>
                      <select
                        className="form-select"
                        value={it.type}
                        onChange={(e) => updateItem(idx, { type: e.target.value as QuestionType })}
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
                          id={`req-${idx}`}
                          className="form-check-input"
                          type="checkbox"
                          checked={it.required}
                          onChange={(e) => updateItem(idx, { required: e.target.checked })}
                        />
                        <label className="form-check-label" htmlFor={`req-${idx}`}>
                          Risposta obbligatoria
                        </label>
                      </div>
                    </div>
                  </div>

                  {(it.type === 'SINGLE_CHOICE' || it.type === 'MULTI_CHOICE') && (
                    <div className="mb-2">
                      <Label>Opzioni</Label>
                      {it.options.map((opt, optIdx) => (
                        <div key={optIdx} className="row g-2 mb-1 align-items-center">
                          <div className="col">
                            <Input
                              type="text"
                              placeholder="IT"
                              value={opt.it}
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                updateItem(idx, {
                                  options: it.options.map((o, i) =>
                                    i === optIdx ? { ...o, it: e.target.value } : o,
                                  ),
                                })
                              }
                            />
                          </div>
                          <div className="col">
                            <Input
                              type="text"
                              placeholder="EN"
                              value={opt.en}
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                updateItem(idx, {
                                  options: it.options.map((o, i) =>
                                    i === optIdx ? { ...o, en: e.target.value } : o,
                                  ),
                                })
                              }
                            />
                          </div>
                          <div className="col-auto">
                            <Button color="danger" outline size="xs" onClick={() => removeOption(idx, optIdx)}>
                              ×
                            </Button>
                          </div>
                        </div>
                      ))}
                      <Button color="secondary" outline size="xs" onClick={() => addOption(idx)}>
                        + opzione
                      </Button>
                    </div>
                  )}

                  {it.type === 'LIKERT' && (
                    <div className="row g-2 mb-2">
                      <div className="col-md-6">
                        <Label>Scala min</Label>
                        <Input
                          type="number"
                          value={it.scaleMin}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            updateItem(idx, { scaleMin: Number(e.target.value) || 1 })
                          }
                        />
                      </div>
                      <div className="col-md-6">
                        <Label>Scala max</Label>
                        <Input
                          type="number"
                          value={it.scaleMax}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            updateItem(idx, { scaleMax: Number(e.target.value) || 5 })
                          }
                        />
                      </div>
                    </div>
                  )}
                </CardBody>
              </Card>
            ))}

            <Button color="secondary" outline size="sm" onClick={addItem} className="mb-4">
              + Aggiungi domanda
            </Button>

            <div className="d-flex gap-2">
              <Button color="primary" onClick={save} disabled={saving || !name.trim()}>
                {saving ? 'Salvataggio…' : 'Salva'}
              </Button>
              <Button color="secondary" outline onClick={cancelEdit} disabled={saving}>
                Annulla
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : loading && rows.length === 0 ? (
        <SkeletonLines lines={4} loadingLabel="Caricamento template…" />
      ) : rows.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardBody className="p-5 text-center">
            <p className="text-muted mb-3">Nessun template. Creane uno per riutilizzare set di domande fra eventi.</p>
            <Button color="primary" size="sm" onClick={startNew}>
              + Nuovo template
            </Button>
          </CardBody>
        </Card>
      ) : (
        <div className="d-flex flex-column gap-2">
          {rows.map((row) => (
            <Card key={row.id} className="shadow-sm border-0" style={{ borderRadius: 8 }}>
              <CardBody className="p-3 p-md-4">
                <div className="d-flex justify-content-between align-items-start flex-wrap gap-2">
                  <div style={{ minWidth: 0 }}>
                    <div className="d-flex align-items-center gap-2 flex-wrap mb-1">
                      <h6 className="fw-semibold mb-0" style={{ color: 'var(--app-text)' }}>
                        {row.name}
                      </h6>
                      {row.isSystem && (
                        <Badge color="primary" pill style={{ fontSize: '0.7rem' }}>
                          sistema
                        </Badge>
                      )}
                    </div>
                    {row.description && (
                      <div className="text-secondary" style={{ fontSize: '0.85rem' }}>
                        {row.description}
                      </div>
                    )}
                    <div className="text-muted mt-1" style={{ fontSize: '0.75rem' }}>
                      {row.itemCount} domande · usato in {row.usedByQuestionnaires} questionari
                    </div>
                  </div>
                  <div className="d-flex gap-2 flex-shrink-0">
                    <Button color="secondary" outline size="xs" onClick={() => startEdit(row)}>
                      Modifica
                    </Button>
                    {!row.isSystem && (
                      <Button color="danger" outline size="xs" onClick={() => handleDelete(row)}>
                        Elimina
                      </Button>
                    )}
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
