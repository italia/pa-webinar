'use client';

/**
 * Pannello Agenda/Note live (ADR funzione opzionale agendaEnabled).
 * Checklist dei punti da trattare: il moderatore li aggiunge e li spunta
 * man mano; i partecipanti la vedono read-only. Sync via SWR polling (3s),
 * coerente con Q&A/poll. Le mutazioni usano il token moderatore (Bearer).
 */

import { useCallback, useState } from 'react';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';

interface AgendaItem {
  id: string;
  label: string;
  completed: boolean;
  sortOrder: number;
}
interface AgendaResponse {
  agendaEnabled: boolean;
  items: AgendaItem[];
}

interface Props {
  eventSlug: string;
  token: string;
  isModerator: boolean;
}

export default function AgendaPanel({ eventSlug, token, isModerator }: Props) {
  const t = useTranslations('agenda');
  const apiUrl = `/api/events/${eventSlug}/agenda`;
  const [newLabel, setNewLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const fetcher = useCallback(
    (url: string) =>
      fetch(url, { headers: { Authorization: `Bearer ${token}` } }).then((r) =>
        r.json(),
      ),
    [token],
  );
  const { data, mutate } = useSWR<AgendaResponse>(apiUrl, fetcher, {
    refreshInterval: 3000,
  });

  const items = data?.items ?? [];
  const doneCount = items.filter((i) => i.completed).length;

  const addItem = useCallback(async () => {
    const label = newLabel.trim();
    if (!label || busy) return;
    setBusy(true);
    try {
      await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ label }),
      });
      setNewLabel('');
      await mutate();
    } finally {
      setBusy(false);
    }
  }, [newLabel, busy, apiUrl, token, mutate]);

  const toggle = useCallback(
    async (item: AgendaItem) => {
      // Optimistic: aggiorna subito la UI.
      await mutate(
        (cur) =>
          cur
            ? {
                ...cur,
                items: cur.items.map((i) =>
                  i.id === item.id ? { ...i, completed: !i.completed } : i,
                ),
              }
            : cur,
        { revalidate: false },
      );
      await fetch(`${apiUrl}/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ completed: !item.completed }),
      });
      await mutate();
    },
    [apiUrl, token, mutate],
  );

  const remove = useCallback(
    async (id: string) => {
      await fetch(`${apiUrl}/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      await mutate();
    },
    [apiUrl, token, mutate],
  );

  return (
    <div className="p-3">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h6 className="fw-semibold mb-0" style={{ color: 'var(--app-text)' }}>
          {t('title')}
        </h6>
        {items.length > 0 && (
          <span className="badge bg-secondary">
            {doneCount}/{items.length}
          </span>
        )}
      </div>

      {items.length === 0 && (
        <p className="text-secondary small mb-3">{t('empty')}</p>
      )}

      <ul className="list-unstyled mb-3">
        {items.map((item) => (
          <li
            key={item.id}
            className="d-flex align-items-start gap-2 py-2"
            style={{ borderBottom: '1px solid #f0f0f0' }}
          >
            <input
              type="checkbox"
              className="form-check-input mt-1 flex-shrink-0"
              checked={item.completed}
              disabled={!isModerator}
              onChange={() => isModerator && void toggle(item)}
              aria-label={item.label}
              style={{ cursor: isModerator ? 'pointer' : 'default' }}
            />
            <span
              className="flex-grow-1 small"
              style={{
                textDecoration: item.completed ? 'line-through' : 'none',
                color: item.completed ? 'var(--app-muted)' : 'var(--app-text)',
              }}
            >
              {item.label}
            </span>
            {isModerator && (
              <button
                type="button"
                className="btn btn-sm btn-link text-danger p-0 flex-shrink-0"
                onClick={() => void remove(item.id)}
                aria-label={t('remove')}
                style={{ lineHeight: 1 }}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>

      {isModerator && (
        <div className="d-flex gap-2">
          <input
            type="text"
            className="form-control form-control-sm"
            placeholder={t('addPlaceholder')}
            value={newLabel}
            maxLength={500}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addItem();
            }}
          />
          <button
            type="button"
            className="btn btn-sm btn-primary flex-shrink-0"
            onClick={() => void addItem()}
            disabled={busy || !newLabel.trim()}
          >
            {t('add')}
          </button>
        </div>
      )}
    </div>
  );
}
