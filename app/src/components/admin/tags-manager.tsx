'use client';

import { useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

interface Tag {
  id: string;
  slug: string;
  name: Record<string, string>;
  color: string | null;
  sortOrder: number;
}

interface Draft {
  slug: string;
  nameIt: string;
  nameEn: string;
  color: string;
  sortOrder: number;
}

interface ValidationDetail {
  path: (string | number)[];
  message: string;
}

const EMPTY_DRAFT: Draft = {
  slug: '',
  nameIt: '',
  nameEn: '',
  color: '',
  sortOrder: 0,
};

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// Inline SVGs — avoid design-react-kit <Icon> per project memory
// (async icons cache triggers hydration mismatches on list/header UI).
function IconPlus() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function IconPencil() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

interface Props {
  initialTags: Tag[];
}

export default function TagsManager({ initialTags }: Props) {
  const t = useTranslations('admin.tags');
  const router = useRouter();

  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const sortedTags = useMemo(() => {
    return [...initialTags].sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.slug.localeCompare(b.slug);
    });
  }, [initialTags]);

  const resetForm = useCallback(() => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setError(null);
    setFieldErrors({});
  }, []);

  const startNew = useCallback(() => {
    setDraft(EMPTY_DRAFT);
    setEditingId('new');
    setError(null);
    setFieldErrors({});
    setSuccessMessage(null);
  }, []);

  const startEdit = useCallback((tag: Tag) => {
    setDraft({
      slug: tag.slug,
      nameIt: tag.name.it ?? '',
      nameEn: tag.name.en ?? '',
      color: tag.color ?? '',
      sortOrder: tag.sortOrder,
    });
    setEditingId(tag.id);
    setError(null);
    setFieldErrors({});
    setSuccessMessage(null);
  }, []);

  const handleApiError = useCallback(
    async (res: Response) => {
      let message = t('genericError');
      const nextFieldErrors: Record<string, string> = {};
      try {
        const body = await res.json();
        if (res.status === 409) {
          message = t('slugInUse');
          nextFieldErrors.slug = t('slugInUse');
        } else if (res.status === 404) {
          message = t('notFound');
        } else if (res.status === 422 && Array.isArray(body?.details)) {
          const details = body.details as ValidationDetail[];
          for (const d of details) {
            const pathStr = d.path.join('.');
            if (pathStr === 'slug') nextFieldErrors.slug = d.message;
            else if (pathStr === 'name' || pathStr === 'name.it')
              nextFieldErrors.nameIt = d.message;
            else if (pathStr === 'color') nextFieldErrors.color = d.message;
            else if (pathStr === 'sortOrder')
              nextFieldErrors.sortOrder = d.message;
          }
          message = body?.message ?? t('validationFailed');
        } else if (typeof body?.message === 'string') {
          message = body.message;
        }
      } catch {
        // swallow JSON parse errors
      }
      setError(message);
      setFieldErrors(nextFieldErrors);
    },
    [t],
  );

  const save = useCallback(async () => {
    // Client-side early validation for common mistakes. The server
    // remains the source of truth, but this keeps UX snappy.
    const nextFieldErrors: Record<string, string> = {};
    const slug = draft.slug.trim();
    if (!slug || !SLUG_RE.test(slug)) {
      nextFieldErrors.slug = t('slugHelp');
    }
    if (!draft.nameIt.trim()) {
      nextFieldErrors.nameIt = t('nameItRequired');
    }
    const color = draft.color.trim();
    if (color && !HEX_COLOR_RE.test(color)) {
      nextFieldErrors.color = t('colorInvalid');
    }

    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      setError(t('validationFailed'));
      return;
    }

    setSaving(true);
    setError(null);
    setFieldErrors({});
    setSuccessMessage(null);

    const name: Record<string, string> = { it: draft.nameIt.trim() };
    if (draft.nameEn.trim()) name.en = draft.nameEn.trim();

    const payload = {
      slug,
      name,
      color: color || null,
      sortOrder: Number(draft.sortOrder) || 0,
    };

    try {
      const url =
        editingId === 'new'
          ? '/api/admin/tags'
          : `/api/admin/tags/${editingId}`;
      const method = editingId === 'new' ? 'POST' : 'PATCH';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        await handleApiError(res);
        return;
      }

      setSuccessMessage(t('saved'));
      resetForm();
      router.refresh();
    } catch {
      setError(t('genericError'));
    } finally {
      setSaving(false);
    }
  }, [draft, editingId, handleApiError, resetForm, router, t]);

  const remove = useCallback(
    async (tag: Tag) => {
      const label = tag.name.it || tag.slug;
      if (!window.confirm(t('deleteConfirm', { name: label }))) return;

      setDeletingId(tag.id);
      setError(null);
      setSuccessMessage(null);
      try {
        const res = await fetch(`/api/admin/tags/${tag.id}`, {
          method: 'DELETE',
        });
        if (!res.ok) {
          await handleApiError(res);
          return;
        }
        setSuccessMessage(t('deleted'));
        router.refresh();
      } catch {
        setError(t('genericError'));
      } finally {
        setDeletingId(null);
      }
    },
    [handleApiError, router, t],
  );

  const renderEditForm = () => (
    <div
      className="p-3 p-md-4 mb-3 rounded-3"
      style={{ background: '#f8f9fa', border: '1px solid #e8e8e8' }}
    >
      <h2 className="h5 fw-semibold mb-3" style={{ color: '#17324D' }}>
        {editingId === 'new' ? t('addTag') : t('editTag')}
      </h2>
      <div className="row g-3">
        <div className="col-md-6">
          <label htmlFor="tag-slug" className="form-label fw-semibold">
            {t('slugLabel')} <span className="text-danger">*</span>
          </label>
          <input
            id="tag-slug"
            type="text"
            className={`form-control${fieldErrors.slug ? ' is-invalid' : ''}`}
            value={draft.slug}
            onChange={(e) =>
              setDraft((d) => ({ ...d, slug: e.target.value.toLowerCase() }))
            }
            placeholder="es. webinar-aperto"
            autoComplete="off"
            spellCheck={false}
          />
          <div className="form-text">{t('slugHelp')}</div>
          {fieldErrors.slug && (
            <div className="invalid-feedback d-block">{fieldErrors.slug}</div>
          )}
        </div>

        <div className="col-md-6">
          <label htmlFor="tag-sort-order" className="form-label fw-semibold">
            {t('sortOrderLabel')}
          </label>
          <input
            id="tag-sort-order"
            type="number"
            min={0}
            max={9999}
            className={`form-control${fieldErrors.sortOrder ? ' is-invalid' : ''}`}
            value={draft.sortOrder}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                sortOrder: Number(e.target.value) || 0,
              }))
            }
          />
          <div className="form-text">{t('sortOrderHelp')}</div>
          {fieldErrors.sortOrder && (
            <div className="invalid-feedback d-block">
              {fieldErrors.sortOrder}
            </div>
          )}
        </div>

        <div className="col-md-6">
          <label htmlFor="tag-name-it" className="form-label fw-semibold">
            {t('nameItLabel')} <span className="text-danger">*</span>
          </label>
          <input
            id="tag-name-it"
            type="text"
            className={`form-control${fieldErrors.nameIt ? ' is-invalid' : ''}`}
            value={draft.nameIt}
            onChange={(e) => setDraft((d) => ({ ...d, nameIt: e.target.value }))}
            maxLength={80}
          />
          {fieldErrors.nameIt && (
            <div className="invalid-feedback d-block">{fieldErrors.nameIt}</div>
          )}
        </div>

        <div className="col-md-6">
          <label htmlFor="tag-name-en" className="form-label fw-semibold">
            {t('nameEnLabel')}
          </label>
          <input
            id="tag-name-en"
            type="text"
            className="form-control"
            value={draft.nameEn}
            onChange={(e) => setDraft((d) => ({ ...d, nameEn: e.target.value }))}
            maxLength={80}
          />
        </div>

        <div className="col-md-6">
          <label htmlFor="tag-color-text" className="form-label fw-semibold">
            {t('colorLabel')}
          </label>
          <div className="d-flex gap-2 align-items-center">
            <input
              id="tag-color-picker"
              type="color"
              className="form-control form-control-color"
              style={{ width: 48, minWidth: 48 }}
              value={HEX_COLOR_RE.test(draft.color) ? draft.color : '#0066CC'}
              onChange={(e) =>
                setDraft((d) => ({ ...d, color: e.target.value }))
              }
              aria-label={t('colorLabel')}
            />
            <input
              id="tag-color-text"
              type="text"
              className={`form-control${fieldErrors.color ? ' is-invalid' : ''}`}
              value={draft.color}
              onChange={(e) =>
                setDraft((d) => ({ ...d, color: e.target.value }))
              }
              placeholder="#0066CC"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {fieldErrors.color && (
            <div className="invalid-feedback d-block">{fieldErrors.color}</div>
          )}
        </div>
      </div>

      {error && (
        <div className="alert alert-danger mt-3 mb-0" role="alert">
          {error}
        </div>
      )}

      <div className="d-flex gap-2 mt-4">
        <button
          type="button"
          className="btn btn-primary"
          onClick={save}
          disabled={saving}
        >
          {saving ? t('saving') : t('save')}
        </button>
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={resetForm}
          disabled={saving}
        >
          {t('cancel')}
        </button>
      </div>
    </div>
  );

  return (
    <div>
      {successMessage && !editingId && (
        <div className="alert alert-success" role="status">
          {successMessage}
        </div>
      )}

      {error && !editingId && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}

      <div className="d-flex justify-content-between align-items-center mb-3">
        <div className="text-secondary" style={{ fontSize: '0.9rem' }}>
          {t('countLabel', { count: sortedTags.length })}
        </div>
        {editingId === null && (
          <button
            type="button"
            className="btn btn-primary d-inline-flex align-items-center gap-2"
            onClick={startNew}
          >
            <IconPlus />
            <span>{t('addTag')}</span>
          </button>
        )}
      </div>

      {editingId !== null && renderEditForm()}

      {sortedTags.length === 0 ? (
        <div
          className="p-4 text-center rounded-3"
          style={{ background: '#f8f9fa', border: '1px dashed #cfd8e3' }}
        >
          <p className="mb-0 text-secondary">{t('empty')}</p>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table align-middle">
            <thead>
              <tr>
                <th scope="col" style={{ width: 48 }}>
                  <span className="visually-hidden">{t('columnColor')}</span>
                </th>
                <th scope="col">{t('columnSlug')}</th>
                <th scope="col">{t('columnName')}</th>
                <th scope="col" style={{ width: 110 }}>
                  {t('columnSortOrder')}
                </th>
                <th scope="col" style={{ width: 180 }} className="text-end">
                  <span className="visually-hidden">
                    {t('columnActions')}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedTags.map((tag) => (
                <tr key={tag.id}>
                  <td>
                    <span
                      aria-hidden="true"
                      className="d-inline-block"
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: 4,
                        background: tag.color ?? '#d0d0d0',
                        border: '1px solid rgba(0,0,0,0.08)',
                      }}
                    />
                  </td>
                  <td>
                    <code style={{ fontSize: '0.85rem' }}>{tag.slug}</code>
                  </td>
                  <td>{tag.name.it ?? tag.slug}</td>
                  <td>{tag.sortOrder}</td>
                  <td className="text-end">
                    <div className="d-inline-flex gap-2">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1"
                        onClick={() => startEdit(tag)}
                        disabled={editingId !== null || deletingId !== null}
                      >
                        <IconPencil />
                        <span>{t('edit')}</span>
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-danger d-inline-flex align-items-center gap-1"
                        onClick={() => remove(tag)}
                        disabled={
                          editingId !== null || deletingId === tag.id
                        }
                      >
                        <IconTrash />
                        <span>
                          {deletingId === tag.id ? t('deleting') : t('delete')}
                        </span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
