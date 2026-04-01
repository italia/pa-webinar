'use client';

import { useState, useCallback, type FormEvent } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import useSWR from 'swr';
import { Button, Icon } from 'design-react-kit';

interface MaterialData {
  id: string;
  type: string;
  title: string;
  url: string;
  description: string | null;
  addedBy: string;
  createdAt: string;
}

interface MaterialPanelProps {
  eventSlug: string;
  token: string;
  isModerator: boolean;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function MaterialPanel({ eventSlug, token, isModerator }: MaterialPanelProps) {
  const t = useTranslations('materials');
  const format = useFormatter();

  const { data, mutate } = useSWR<{ materials: MaterialData[] }>(
    `/api/events/${eventSlug}/materials`,
    fetcher,
    { refreshInterval: 5000 },
  );

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const materials = data?.materials ?? [];

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError('');

      if (title.trim().length < 1) return;

      try {
        new URL(url.trim());
      } catch {
        setError(t('errors.urlInvalid'));
        return;
      }

      setSubmitting(true);
      try {
        const res = await fetch(`/api/events/${eventSlug}/materials`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            title: title.trim(),
            url: url.trim(),
            description: description.trim() || undefined,
          }),
        });

        if (!res.ok) {
          setError(t('errors.generic'));
          return;
        }

        setTitle('');
        setUrl('');
        setDescription('');
        setShowForm(false);
        mutate();
      } catch {
        setError(t('errors.generic'));
      } finally {
        setSubmitting(false);
      }
    },
    [title, url, description, eventSlug, token, t, mutate],
  );

  const handleDelete = useCallback(
    async (materialId: string) => {
      if (!confirm(t('confirmDelete'))) return;

      try {
        await fetch(`/api/events/${eventSlug}/materials/${materialId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        mutate();
      } catch {
        // silently fail, will refresh
      }
    },
    [eventSlug, token, t, mutate],
  );

  return (
    <div className="p-2">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h6 className="mb-0 fw-semibold" style={{ fontSize: '0.9rem' }}>
          {t('title')}
        </h6>
        {isModerator && !showForm && (
          <Button
            color="primary"
            outline
            size="xs"
            className="px-2 py-0"
            onClick={() => setShowForm(true)}
          >
            + {t('addMaterial')}
          </Button>
        )}
      </div>

      {/* Add material form (moderator) */}
      {isModerator && showForm && (
        <form onSubmit={handleSubmit} className="border rounded p-2 mb-2">
          <div className="mb-1">
            <input
              type="text"
              className="form-control form-control-sm"
              placeholder={t('titleLabel')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={300}
            />
          </div>
          <div className="mb-1">
            <input
              type="url"
              className="form-control form-control-sm"
              placeholder={t('urlLabel')}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div className="mb-1">
            <input
              type="text"
              className="form-control form-control-sm"
              placeholder={t('descriptionLabel')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
            />
          </div>
          {error && <div className="text-danger small mb-1">{error}</div>}
          <div className="d-flex gap-2">
            <Button color="primary" size="xs" type="submit" disabled={submitting}>
              {submitting ? t('adding') : t('add')}
            </Button>
            <Button
              color="secondary"
              outline
              size="xs"
              type="button"
              onClick={() => { setShowForm(false); setError(''); }}
            >
              {t('cancel')}
            </Button>
          </div>
        </form>
      )}

      {/* Materials list */}
      {materials.length === 0 ? (
        <div className="text-center text-muted py-3" style={{ fontSize: '0.85rem' }}>
          {t('noMaterials')}
        </div>
      ) : (
        <div className="d-flex flex-column gap-2">
          {materials.map((m) => (
            <div key={m.id} className="border rounded p-2">
              <div className="d-flex justify-content-between align-items-start">
                <div style={{ minWidth: 0 }}>
                  <a
                    href={m.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="fw-semibold text-primary text-decoration-none d-inline-flex align-items-center gap-1"
                    style={{ fontSize: '0.85rem' }}
                  >
                    <Icon icon="it-external-link" size="xs" />
                    {m.title}
                  </a>
                  {m.description && (
                    <div className="text-muted" style={{ fontSize: '0.78rem' }}>
                      {m.description}
                    </div>
                  )}
                  <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                    {t('addedBy', { name: m.addedBy })} ·{' '}
                    {format.dateTime(new Date(m.createdAt), {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
                {isModerator && (
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-danger border-0 flex-shrink-0 p-1"
                    onClick={() => handleDelete(m.id)}
                    aria-label={t('deleteMaterial')}
                  >
                    <Icon icon="it-close" size="xs" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
