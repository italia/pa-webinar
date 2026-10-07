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
 *   - Interface strings in admin.questionTemplates.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Button, Card, CardBody, Input, Label } from 'design-react-kit';

import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { SkeletonLines } from '@/components/ui/skeleton';

type QuestionType = 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'YES_NO' | 'LIKERT' | 'OPEN_TEXT';

// Le etichette sono quelle del wizard (admin.wizard.step4.questionType*).
const QUESTION_TYPES: { value: QuestionType; labelKey: string }[] = [
  { value: 'OPEN_TEXT', labelKey: 'questionTypeOpen' },
  { value: 'SINGLE_CHOICE', labelKey: 'questionTypeSingle' },
  { value: 'MULTI_CHOICE', labelKey: 'questionTypeMulti' },
  { value: 'YES_NO', labelKey: 'questionTypeYesNo' },
  { value: 'LIKERT', labelKey: 'questionTypeLikert' },
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
  const t = useTranslations('admin.questionTemplates');
  const tTypes = useTranslations('admin.wizard.step4');
  const tc = useTranslations('common');
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
      setError(tc('errorGeneric'));
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
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(
          res.status === 400 || res.status === 422
            ? `${t('invalid')}${body.error ? ` (${body.error})` : ''}`
            : tc('errorGeneric'),
        );
        return;
      }

      cancelEdit();
      await fetchRows();
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, description, sortOrder, items, editingId, fetchRows, t, tc]);

  const handleDelete = useCallback(
    async (row: TemplateRow) => {
      if (row.isSystem) return;
      const ok = await confirm({
        title: t('deleteTitle'),
        message: t('deleteMessage', { name: row.name, count: row.usedByQuestionnaires }),
        confirmLabel: tc('delete'),
        danger: true,
      });
      if (!ok) return;
      const res = await fetch(`/api/admin/question-templates/${row.id}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchRows();
      } else {
        // Ancora collegato a dei questionari: va staccato prima.
        toast.error(res.status === 409 ? t('inUse') : tc('errorGeneric'));
      }
    },
    [fetchRows, confirm, toast, t, tc],
  );

  const editing = editingId !== null;

  return (
    <div>
      {!editing && (
        <div className="d-flex justify-content-end mb-3">
          <Button color="primary" size="sm" onClick={startNew}>
            + {t('newTemplate')}
          </Button>
        </div>
      )}

      {editing ? (
        <Card className="shadow-sm border-0 mb-4" style={{ borderRadius: 8 }}>
          <CardBody className="p-4">
            <h5 className="fw-semibold mb-3" style={{ color: 'var(--app-text)' }}>
              {editingId === 'new' ? t('newTemplate') : t('editTemplate')}
            </h5>

            {error && (
              <div className="alert alert-danger mb-3" role="alert">
                {error}
              </div>
            )}

            <div className="mb-3">
              <Label for="tpl-name">{t('name')}</Label>
              <Input
                id="tpl-name"
                type="text"
                value={name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              />
            </div>

            <div className="mb-3">
              <Label for="tpl-desc">{t('description')}</Label>
              <Input
                id="tpl-desc"
                type="text"
                value={description}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDescription(e.target.value)}
              />
            </div>

            <div className="mb-3" style={{ maxWidth: 160 }}>
              <Label for="tpl-sort">{t('order')}</Label>
              <Input
                id="tpl-sort"
                type="number"
                value={sortOrder}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSortOrder(Number(e.target.value) || 0)}
              />
            </div>

            <hr className="my-4" />
            <h3 className="h6 fw-semibold mb-3">{t('questions')}</h3>

            {items.map((it, idx) => (
              <Card key={idx} className="mb-3 border" style={{ borderRadius: 6 }}>
                <CardBody className="p-3">
                  <div className="d-flex justify-content-between align-items-start gap-2 mb-2">
                    <Badge color="" className="px-2 py-1" style={{ backgroundColor: '#E8F0FE', color: 'var(--app-primary)' }}>
                      #{idx + 1}
                    </Badge>
                    <Button
                      color="danger"
                      outline
                      size="xs"
                      onClick={() => removeItem(idx)}
                      aria-label={t('removeQuestion', { n: idx + 1 })}
                    >
                      {t('remove')}
                    </Button>
                  </div>

                  <div className="mb-2">
                    <Label for={`q-${idx}-it`}>{t('promptIt')}</Label>
                    <Input
                      id={`q-${idx}-it`}
                      type="text"
                      value={it.promptIt}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        updateItem(idx, { promptIt: e.target.value })
                      }
                    />
                  </div>
                  <div className="mb-2">
                    <Label for={`q-${idx}-en`}>{t('promptEn')}</Label>
                    <Input
                      id={`q-${idx}-en`}
                      type="text"
                      value={it.promptEn}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        updateItem(idx, { promptEn: e.target.value })
                      }
                    />
                  </div>

                  <div className="row g-2 mb-2">
                    <div className="col-md-6">
                      <Label for={`q-${idx}-type`}>{t('type')}</Label>
                      <select
                        id={`q-${idx}-type`}
                        className="form-select"
                        value={it.type}
                        onChange={(e) => updateItem(idx, { type: e.target.value as QuestionType })}
                      >
                        {QUESTION_TYPES.map((qt) => (
                          <option key={qt.value} value={qt.value}>
                            {tTypes(qt.labelKey)}
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
                          {t('required')}
                        </label>
                      </div>
                    </div>
                  </div>

                  {(it.type === 'SINGLE_CHOICE' || it.type === 'MULTI_CHOICE') && (
                    <div className="mb-2">
                      <div className="form-label" id={`q-${idx}-opts`}>{t('options')}</div>
                      {it.options.map((opt, optIdx) => (
                        <div key={optIdx} className="row g-2 mb-1 align-items-center">
                          <div className="col">
                            <Input
                              type="text"
                              placeholder="IT"
                              aria-label={t('optionIt', { n: optIdx + 1 })}
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
                              aria-label={t('optionEn', { n: optIdx + 1 })}
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
                            <Button
                              color="danger"
                              outline
                              size="xs"
                              onClick={() => removeOption(idx, optIdx)}
                              aria-label={t('removeOption', { n: optIdx + 1 })}
                            >
                              ×
                            </Button>
                          </div>
                        </div>
                      ))}
                      <Button color="secondary" outline size="xs" onClick={() => addOption(idx)}>
                        + {t('addOption')}
                      </Button>
                    </div>
                  )}

                  {it.type === 'LIKERT' && (
                    <div className="row g-2 mb-2">
                      <div className="col-md-6">
                        <Label for={`q-${idx}-min`}>{t('scaleMin')}</Label>
                        <Input
                          id={`q-${idx}-min`}
                          type="number"
                          value={it.scaleMin}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            updateItem(idx, { scaleMin: Number(e.target.value) || 1 })
                          }
                        />
                      </div>
                      <div className="col-md-6">
                        <Label for={`q-${idx}-max`}>{t('scaleMax')}</Label>
                        <Input
                          id={`q-${idx}-max`}
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
              + {t('addQuestion')}
            </Button>

            <div className="d-flex gap-2">
              <Button color="primary" onClick={save} disabled={saving || !name.trim()}>
                {saving ? tc('saving') : tc('save')}
              </Button>
              <Button color="secondary" outline onClick={cancelEdit} disabled={saving}>
                {tc('cancel')}
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : loading && rows.length === 0 ? (
        <SkeletonLines lines={4} loadingLabel={tc('loading')} />
      ) : rows.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardBody className="p-5 text-center">
            <p className="text-muted mb-3">{t('empty')}</p>
            <Button color="primary" size="sm" onClick={startNew}>
              + {t('newTemplate')}
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
                      <h2 className="h6 fw-semibold mb-0" style={{ color: 'var(--app-text)' }}>
                        {row.name}
                      </h2>
                      {row.isSystem && (
                        <Badge color="primary" pill style={{ fontSize: '0.7rem' }}>
                          {t('system')}
                        </Badge>
                      )}
                    </div>
                    {row.description && (
                      <div className="text-secondary" style={{ fontSize: '0.85rem' }}>
                        {row.description}
                      </div>
                    )}
                    <div className="text-muted mt-1" style={{ fontSize: '0.75rem' }}>
                      {t('stats', { items: row.itemCount, used: row.usedByQuestionnaires })}
                    </div>
                  </div>
                  <div className="d-flex gap-2 flex-shrink-0">
                    <Button
                      color="secondary"
                      outline
                      size="xs"
                      onClick={() => startEdit(row)}
                      aria-label={`${tc('edit')} – ${row.name}`}
                    >
                      {tc('edit')}
                    </Button>
                    {!row.isSystem && (
                      <Button
                        color="danger"
                        outline
                        size="xs"
                        onClick={() => handleDelete(row)}
                        aria-label={`${tc('delete')} – ${row.name}`}
                      >
                        {tc('delete')}
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
