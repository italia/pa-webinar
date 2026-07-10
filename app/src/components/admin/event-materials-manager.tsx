'use client';

/**
 * Admin UI for managing the attachments (EventMaterial rows) of a
 * single event. Supports add/edit/delete against the admin-session
 * API at /api/admin/events/[id]/materials.
 *
 * Mutations use optimistic updates with rollback on error so the UI
 * stays responsive on slow connections.
 *
 * Note on icons: per project memory, design-react-kit's <Icon> can
 * cause hydration mismatches inside list items that rerender on every
 * mutation — so this component uses inline SVG / emoji fallbacks.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from 'design-react-kit';

import { useConfirm } from '@/components/ui/confirm-dialog';
import { SkeletonLines } from '@/components/ui/skeleton';

import FileOrUrlInput from '@/components/ui/file-or-url-input';
import {
  MATERIAL_VISIBILITIES,
  type MaterialType,
  type MaterialVisibility,
} from '@/lib/validation/materials';

export interface MaterialRow {
  id: string;
  eventId: string;
  type: MaterialType;
  title: string;
  url: string;
  description: string | null;
  addedBy: string;
  fileName: string | null;
  fileSize: number | null;
  mimeType: string | null;
  blobPath: string | null;
  visibility: MaterialVisibility;
  createdAt: string;
}

interface EventMaterialsManagerProps {
  eventId: string;
  initialMaterials?: MaterialRow[];
  disabled?: boolean;
}

interface DraftForm {
  title: string;
  description: string;
  url: string;
  visibility: MaterialVisibility;
  type: MaterialType;
  fileName: string | null;
  fileSize: number | null;
  mimeType: string | null;
  blobPath: string | null;
}

const EMPTY_DRAFT: DraftForm = {
  title: '',
  description: '',
  url: '',
  visibility: 'ALWAYS',
  type: 'LINK',
  fileName: null,
  fileSize: null,
  mimeType: null,
  blobPath: null,
};

// ── File size humanisation ─────────────────────────────────

function humanSize(bytes: number | null | undefined, locale?: string): string {
  if (bytes == null || Number.isNaN(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const fmt = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
    minimumFractionDigits: value < 10 ? 1 : 0,
  });
  return `${fmt.format(value)} ${units[idx]}`;
}

// ── MIME → inline-SVG icon ─────────────────────────────────
//
// Keep this table tiny — common PA document types only. The generic
// "file" icon is the fallback. No design-react-kit <Icon> usage here
// (see file-level doc comment).

function MaterialTypeIcon({
  type,
  mimeType,
}: {
  type: MaterialType;
  mimeType: string | null;
}) {
  if (type === 'LINK') {
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    );
  }
  const mime = mimeType ?? '';
  let label = '📄';
  if (mime.includes('pdf')) label = '📕';
  else if (mime.includes('presentation') || mime.includes('powerpoint')) label = '📊';
  else if (mime.includes('spreadsheet') || mime.includes('excel')) label = '📈';
  else if (mime.startsWith('image/')) label = '🖼️';
  else if (mime.startsWith('audio/')) label = '🎵';
  else if (mime.startsWith('video/')) label = '🎬';
  return <span aria-hidden="true">{label}</span>;
}

// ── Component ──────────────────────────────────────────────

export default function EventMaterialsManager({
  eventId,
  initialMaterials,
  disabled,
}: EventMaterialsManagerProps) {
  const t = useTranslations('admin.materials');
  const tCommon = useTranslations('common');
  const confirm = useConfirm();

  const [materials, setMaterials] = useState<MaterialRow[]>(initialMaterials ?? []);
  const [loading, setLoading] = useState(!initialMaterials);
  const [error, setError] = useState<string | null>(null);

  // editing state: null = closed, 'new' = create form, uuid = edit row
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftForm>(EMPTY_DRAFT);
  const [submitting, setSubmitting] = useState(false);

  // ── load ────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/materials`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { materials: MaterialRow[] };
      setMaterials(data.materials);
    } catch {
      setError(t('errorGeneric'));
    } finally {
      setLoading(false);
    }
  }, [eventId, t]);

  useEffect(() => {
    if (!initialMaterials) {
      load();
    }
  }, [initialMaterials, load]);

  // ── helpers ─────────────────────────────────────────────
  const visibilityLabel = useCallback(
    (v: MaterialVisibility) => {
      switch (v) {
        case 'ALWAYS':
          return t('visibilityAlways');
        case 'BEFORE':
          return t('visibilityBefore');
        case 'DURING':
          return t('visibilityDuring');
        case 'AFTER':
          return t('visibilityAfter');
      }
    },
    [t],
  );

  const openCreate = useCallback(() => {
    setDraft(EMPTY_DRAFT);
    setEditingId('new');
    setError(null);
  }, []);

  const openEdit = useCallback((m: MaterialRow) => {
    setDraft({
      title: m.title,
      description: m.description ?? '',
      url: m.url,
      visibility: m.visibility,
      type: m.type,
      fileName: m.fileName,
      fileSize: m.fileSize,
      mimeType: m.mimeType,
      blobPath: m.blobPath,
    });
    setEditingId(m.id);
    setError(null);
  }, []);

  const closeForm = useCallback(() => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setError(null);
  }, []);

  // ── save (create or update) ─────────────────────────────
  const save = useCallback(async () => {
    if (!editingId) return;
    const isCreate = editingId === 'new';
    const title = draft.title.trim();
    const url = draft.url.trim();
    if (title.length < 1 || url.length < 1) {
      setError(t('errorGeneric'));
      return;
    }
    try {
      // Uploaded files are served from an absolute /api/assets/… URL (the
      // upload route always returns an absolute URL), matching the server's
      // absolute-URL contract.
      new URL(url);
    } catch {
      setError(t('errorGeneric'));
      return;
    }

    setSubmitting(true);
    setError(null);

    const payload = {
      title,
      url,
      description: draft.description.trim() ? draft.description.trim() : null,
      type: draft.type,
      visibility: draft.visibility,
      fileName: draft.fileName,
      fileSize: draft.fileSize,
      mimeType: draft.mimeType,
      blobPath: draft.blobPath,
    };

    // Optimistic update
    const prev = materials;
    if (!isCreate) {
      setMaterials((list) =>
        list.map((m) =>
          m.id === editingId
            ? {
                ...m,
                title: payload.title,
                url: payload.url,
                description: payload.description,
                type: payload.type,
                visibility: payload.visibility,
                fileName: payload.fileName,
                fileSize: payload.fileSize,
                mimeType: payload.mimeType,
                blobPath: payload.blobPath,
              }
            : m,
        ),
      );
    }

    try {
      const res = await fetch(
        isCreate
          ? `/api/admin/events/${eventId}/materials`
          : `/api/admin/events/${eventId}/materials/${editingId}`,
        {
          method: isCreate ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const saved = (await res.json()) as MaterialRow;
      if (isCreate) {
        setMaterials((list) => [saved, ...list]);
      } else {
        setMaterials((list) => list.map((m) => (m.id === saved.id ? saved : m)));
      }
      closeForm();
    } catch {
      // Rollback optimistic edit
      if (!isCreate) setMaterials(prev);
      setError(t('errorGeneric'));
    } finally {
      setSubmitting(false);
    }
  }, [editingId, draft, eventId, materials, t, closeForm]);

  // ── delete ──────────────────────────────────────────────
  const remove = useCallback(
    async (id: string) => {
      const ok = await confirm({
        title: tCommon('delete'),
        message: t('deleteConfirm'),
        confirmLabel: tCommon('delete'),
        danger: true,
      });
      if (!ok) return;
      const prev = materials;
      setMaterials((list) => list.filter((m) => m.id !== id));
      try {
        const res = await fetch(`/api/admin/events/${eventId}/materials/${id}`, {
          method: 'DELETE',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch {
        setMaterials(prev);
        setError(t('errorGeneric'));
      }
    },
    [materials, eventId, t, tCommon, confirm],
  );

  // ── form ────────────────────────────────────────────────
  const form = useMemo(() => {
    if (!editingId) return null;
    return (
      <div
        className="border rounded p-3 mb-3"
        style={{ background: '#f8f9fa' }}
      >
        <div className="mb-3">
          <label htmlFor="mat-title" className="form-label fw-semibold">
            {t('titleLabel')} *
          </label>
          <input
            id="mat-title"
            type="text"
            className="form-control"
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            maxLength={300}
            required
          />
        </div>

        <div className="mb-3">
          <label htmlFor="mat-desc" className="form-label fw-semibold">
            {t('descriptionLabel')}
          </label>
          <textarea
            id="mat-desc"
            className="form-control"
            rows={2}
            value={draft.description}
            onChange={(e) =>
              setDraft((d) => ({ ...d, description: e.target.value }))
            }
            maxLength={500}
          />
        </div>

        <div className="mb-3">
          <FileOrUrlInput
            id="mat-url"
            label={t('typeLabel')}
            value={draft.url || null}
            onChange={(v) =>
              setDraft((d) => {
                const next = v ?? '';
                // No-op if the URL is unchanged (e.g. a blur on the URL tab of
                // an existing FILE material) — otherwise we'd wrongly strip its
                // FILE provenance and orphan the blob.
                if (next === d.url) return d;
                // A genuinely new/changed URL (or a clear) means this is a LINK,
                // not an uploaded file: drop any FILE provenance from a prior
                // upload so the row is labeled correctly.
                return {
                  ...d,
                  url: next,
                  type: 'LINK',
                  fileName: null,
                  fileSize: null,
                  mimeType: null,
                  blobPath: null,
                };
              })
            }
            onUpload={(meta) =>
              setDraft((d) => ({
                ...d,
                url: meta.url,
                type: 'FILE',
                fileName: meta.filename,
                fileSize: meta.size,
                mimeType: meta.mime,
                // Full storage key (assets/…) so the cleanup cron can delete
                // the blob on retention/removal.
                blobPath: meta.key,
              }))
            }
            assetType="document"
          />
        </div>

        <fieldset className="mb-3">
          <legend className="form-label fw-semibold" style={{ fontSize: '1rem' }}>
            {t('visibilityLabel')}
          </legend>
          <div className="d-flex flex-wrap gap-3">
            {MATERIAL_VISIBILITIES.map((v) => (
              <div key={v} className="form-check">
                <input
                  id={`mat-vis-${v}`}
                  type="radio"
                  name="mat-visibility"
                  className="form-check-input"
                  checked={draft.visibility === v}
                  onChange={() => setDraft((d) => ({ ...d, visibility: v }))}
                />
                <label htmlFor={`mat-vis-${v}`} className="form-check-label">
                  {visibilityLabel(v)}
                </label>
              </div>
            ))}
          </div>
        </fieldset>

        {error && (
          <div className="text-danger small mb-2" role="alert">
            {error}
          </div>
        )}

        <div className="d-flex gap-2">
          <Button
            color="primary"
            size="sm"
            onClick={save}
            disabled={submitting || disabled}
          >
            {submitting ? tCommon('saving') : t('saveButton')}
          </Button>
          <Button
            color="secondary"
            outline
            size="sm"
            onClick={closeForm}
            disabled={submitting}
          >
            {t('cancelButton')}
          </Button>
        </div>
      </div>
    );
  }, [editingId, draft, error, submitting, disabled, save, closeForm, t, tCommon, visibilityLabel]);

  // ── render ──────────────────────────────────────────────
  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div className="small text-muted">
          {materials.length > 0 && `${materials.length}`}
        </div>
        {editingId === null && (
          <Button
            color="primary"
            size="sm"
            onClick={openCreate}
            disabled={disabled || loading}
          >
            + {t('addButton')}
          </Button>
        )}
      </div>

      {form}

      {loading ? (
        <SkeletonLines lines={4} loadingLabel={tCommon('loading')} />
      ) : materials.length === 0 ? (
        <div className="text-center py-4 text-muted border rounded">
          {t('empty')}
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead>
              <tr>
                <th scope="col" style={{ width: '40px' }} aria-label="icon" />
                <th scope="col">{t('titleLabel')}</th>
                <th scope="col" className="d-none d-md-table-cell">
                  {t('typeLabel')}
                </th>
                <th scope="col" className="d-none d-md-table-cell">
                  {t('visibilityLabel')}
                </th>
                <th scope="col" className="d-none d-lg-table-cell">
                  {t('sizeLabel')}
                </th>
                <th scope="col" className="text-end" style={{ width: '160px' }}>
                  <span className="visually-hidden">actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {materials.map((m) => (
                <tr key={m.id}>
                  <td className="text-primary">
                    <MaterialTypeIcon type={m.type} mimeType={m.mimeType} />
                  </td>
                  <td>
                    <a
                      href={m.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="fw-semibold text-decoration-none"
                    >
                      {m.title}
                    </a>
                    {m.description && (
                      <div
                        className="text-muted"
                        style={{ fontSize: '0.82rem' }}
                      >
                        {m.description}
                      </div>
                    )}
                    {m.fileName && (
                      <div
                        className="text-muted"
                        style={{ fontSize: '0.78rem' }}
                      >
                        {m.fileName}
                      </div>
                    )}
                  </td>
                  <td className="d-none d-md-table-cell">
                    <span className="badge bg-secondary-subtle text-secondary-emphasis">
                      {m.type === 'FILE' ? t('typeFile') : t('typeLink')}
                    </span>
                  </td>
                  <td className="d-none d-md-table-cell">
                    {visibilityLabel(m.visibility)}
                  </td>
                  <td
                    className="d-none d-lg-table-cell text-muted"
                    style={{ fontSize: '0.85rem' }}
                  >
                    {m.type === 'FILE' ? humanSize(m.fileSize) : '—'}
                  </td>
                  <td className="text-end">
                    <div className="d-inline-flex gap-1">
                      <Button
                        color="primary"
                        outline
                        size="xs"
                        onClick={() => openEdit(m)}
                        disabled={disabled || editingId !== null}
                      >
                        {t('editButton')}
                      </Button>
                      <Button
                        color="danger"
                        outline
                        size="xs"
                        onClick={() => remove(m.id)}
                        disabled={disabled || editingId !== null}
                      >
                        {tCommon('delete')}
                      </Button>
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
