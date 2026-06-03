'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Button, Card, CardBody, Icon, Input, Label } from 'design-react-kit';

import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { SkeletonLines } from '@/components/ui/skeleton';

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  body: Record<string, string>;
  locales: string[];
  isDefault: boolean;
  usedByEvents: number;
  createdAt: string;
  updatedAt: string;
}

interface Draft {
  name: string;
  description: string;
  // Simplified editor: we surface a single body per locale. An admin who
  // needs multilingual templates can edit the JSON for now — the form
  // itself supports IT + EN by default.
  bodyIt: string;
  bodyEn: string;
  isDefault: boolean;
}

const EMPTY_DRAFT: Draft = {
  name: '',
  description: '',
  bodyIt: '',
  bodyEn: '',
  isDefault: false,
};

export default function GdprTemplatesManagement() {
  const t = useTranslations('admin.gdprTemplates');
  const tc = useTranslations('common');
  const toast = useToast();
  const confirm = useConfirm();

  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/gdpr-templates', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setRows(data.rows);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const startNew = () => {
    setDraft(EMPTY_DRAFT);
    setEditingId('new');
    setError(null);
  };

  const startEdit = (row: TemplateRow) => {
    setDraft({
      name: row.name,
      description: row.description ?? '',
      bodyIt: row.body.it ?? '',
      bodyEn: row.body.en ?? '',
      isDefault: row.isDefault,
    });
    setEditingId(row.id);
    setError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setError(null);
  };

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, string> = {};
      if (draft.bodyIt.trim()) body.it = draft.bodyIt.trim();
      if (draft.bodyEn.trim()) body.en = draft.bodyEn.trim();

      const payload = {
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        body,
        isDefault: draft.isDefault,
      };

      const url = editingId === 'new'
        ? '/api/admin/gdpr-templates'
        : `/api/admin/gdpr-templates/${editingId}`;
      const method = editingId === 'new' ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error ?? t('errors.saveFailed'));
        return;
      }

      setEditingId(null);
      setDraft(EMPTY_DRAFT);
      await fetchRows();
    } finally {
      setSaving(false);
    }
  }, [draft, editingId, fetchRows, t]);

  const handleDelete = useCallback(async (row: TemplateRow) => {
    const ok = await confirm({
      title: 'Elimina template',
      message: t('confirmDelete', { name: row.name, count: row.usedByEvents }),
      confirmLabel: tc('delete'),
      danger: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/admin/gdpr-templates/${row.id}`, { method: 'DELETE' });
    if (res.ok) await fetchRows();
    else toast.error(t('errors.saveFailed'));
  }, [confirm, fetchRows, t, tc, toast]);

  const editing = editingId !== null;

  return (
    <div>
      {!editing && (
        <div className="d-flex justify-content-end mb-3">
          <Button color="primary" size="sm" onClick={startNew}>
            <Icon icon="it-plus" size="sm" color="white" className="me-1" />
            {t('newTemplate')}
          </Button>
        </div>
      )}

      {editing ? (
        <Card className="shadow-sm border-0 mb-4" style={{ borderRadius: 8, border: '1px solid #e8e8e8' }}>
          <CardBody className="p-4">
            <h5 className="fw-semibold mb-3" style={{ color: 'var(--app-text)' }}>
              {editingId === 'new' ? t('form.newTitle') : t('form.editTitle')}
            </h5>

            {error && (
              <div className="alert alert-danger mb-3" role="alert">
                {error}
              </div>
            )}

            <div className="mb-3">
              <Label for="tpl-name">{t('form.name')}</Label>
              <Input
                id="tpl-name"
                type="text"
                value={draft.name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setDraft({ ...draft, name: e.target.value })
                }
                placeholder={t('form.namePlaceholder')}
              />
            </div>

            <div className="mb-3">
              <Label for="tpl-description">{t('form.description')}</Label>
              <Input
                id="tpl-description"
                type="text"
                value={draft.description}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setDraft({ ...draft, description: e.target.value })
                }
                placeholder={t('form.descriptionPlaceholder')}
              />
            </div>

            <div className="mb-3">
              <Label htmlFor="tpl-body-it">{t('form.bodyIt')}</Label>
              <textarea
                id="tpl-body-it"
                className="form-control"
                rows={8}
                value={draft.bodyIt}
                onChange={(e) => setDraft({ ...draft, bodyIt: e.target.value })}
                placeholder={t('form.bodyPlaceholder')}
                style={{ fontFamily: 'inherit', fontSize: '0.92rem' }}
              />
            </div>

            <div className="mb-3">
              <Label htmlFor="tpl-body-en">{t('form.bodyEn')}</Label>
              <textarea
                id="tpl-body-en"
                className="form-control"
                rows={8}
                value={draft.bodyEn}
                onChange={(e) => setDraft({ ...draft, bodyEn: e.target.value })}
                placeholder={t('form.bodyPlaceholder')}
                style={{ fontFamily: 'inherit', fontSize: '0.92rem' }}
              />
            </div>

            <div className="form-check mb-4">
              <input
                type="checkbox"
                className="form-check-input"
                id="tpl-default"
                checked={draft.isDefault}
                onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })}
              />
              <label className="form-check-label" htmlFor="tpl-default">
                {t('form.isDefault')}
              </label>
              <div className="form-text text-muted small">
                {t('form.isDefaultHint')}
              </div>
            </div>

            <div className="d-flex gap-2">
              <Button color="primary" onClick={save} disabled={saving || !draft.name.trim()}>
                {saving ? tc('saving') : tc('save')}
              </Button>
              <Button color="secondary" outline onClick={cancelEdit} disabled={saving}>
                {tc('cancel')}
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : loading && rows.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardBody className="p-3">
            <SkeletonLines lines={5} loadingLabel={tc('loading')} />
          </CardBody>
        </Card>
      ) : rows.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardBody className="p-5 text-center">
            <Icon icon="it-lock" size="xl" className="text-muted mb-3" />
            <p className="text-muted mb-3">{t('emptyState')}</p>
            <Button color="primary" size="sm" onClick={startNew}>
              {t('newTemplate')}
            </Button>
          </CardBody>
        </Card>
      ) : (
        <div className="d-flex flex-column gap-2">
          {rows.map((row) => (
            <Card key={row.id} className="shadow-sm border-0" style={{ borderRadius: 8, border: '1px solid #e8e8e8' }}>
              <CardBody className="p-3 p-md-4">
                <div className="d-flex justify-content-between align-items-start flex-wrap gap-2">
                  <div style={{ minWidth: 0 }}>
                    <div className="d-flex align-items-center gap-2 flex-wrap mb-1">
                      <h6 className="fw-semibold mb-0" style={{ color: 'var(--app-text)' }}>
                        {row.name}
                      </h6>
                      {row.isDefault && (
                        <Badge color="primary" pill style={{ fontSize: '0.7rem' }}>
                          {t('defaultBadge')}
                        </Badge>
                      )}
                      {row.locales.map((l) => (
                        <Badge key={l} color="" pill className="px-2 py-1" style={{ fontSize: '0.65rem', backgroundColor: '#E8F0FE', color: 'var(--app-primary)', textTransform: 'uppercase' }}>
                          {l}
                        </Badge>
                      ))}
                    </div>
                    {row.description && (
                      <div className="text-secondary" style={{ fontSize: '0.85rem' }}>
                        {row.description}
                      </div>
                    )}
                    <div className="text-muted mt-1" style={{ fontSize: '0.75rem' }}>
                      {t('usedByEvents', { count: row.usedByEvents })}
                    </div>
                  </div>
                  <div className="d-flex gap-2 flex-shrink-0">
                    <Button color="secondary" outline size="xs" onClick={() => startEdit(row)}>
                      <Icon icon="it-pencil" size="xs" className="me-1" />
                      {tc('edit')}
                    </Button>
                    <Button color="danger" outline size="xs" onClick={() => handleDelete(row)}>
                      <Icon icon="it-delete" size="xs" />
                    </Button>
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
