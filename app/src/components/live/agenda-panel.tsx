'use client';

/**
 * Pannello Agenda/Note live (ADR funzione opzionale agendaEnabled).
 * Checklist dei punti da trattare: il moderatore li aggiunge e li spunta
 * man mano; i partecipanti la vedono read-only. In più, su ogni punto i
 * partecipanti possono esprimere assenso/dissenso (audience pulse) — il
 * moderatore guida e vede le tally, l'aula vota. Sync via SWR polling (3s),
 * coerente con Q&A/poll. Le mutazioni del moderatore usano il token (Bearer);
 * le reaction usano l'identità partecipante (accessToken) o il guestId.
 */

import { useCallback, useState } from 'react';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';

type ReactionValue = 'AGREE' | 'DISAGREE';

interface AgendaItem {
  id: string;
  label: string;
  completed: boolean;
  sortOrder: number;
  agreeCount: number;
  disagreeCount: number;
  myReaction: ReactionValue | null;
}
interface AgendaResponse {
  agendaEnabled: boolean;
  items: AgendaItem[];
}

interface Props {
  eventSlug: string;
  token: string;
  isModerator: boolean;
  /** True for the audience (guests + registered participants) — shows the
   *  👍/👎 buttons. False for moderators/speakers, who only see the tallies. */
  canReact?: boolean;
  /** Stable anonymous id for a guest (no accessToken). Used to dedup the
   *  guest's reaction server-side and to recall it after a refresh. */
  guestId?: string;
}

export default function AgendaPanel({
  eventSlug,
  token,
  isModerator,
  canReact = false,
  guestId,
}: Props) {
  const t = useTranslations('agenda');
  const apiUrl = `/api/events/${eventSlug}/agenda`;
  // Guests pass their id so the GET can return `myReaction`; participants are
  // identified by the Bearer accessToken the fetcher already sends.
  const swrKey = guestId ? `${apiUrl}?guestId=${encodeURIComponent(guestId)}` : apiUrl;
  const [newLabel, setNewLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const fetcher = useCallback(
    (url: string) =>
      fetch(url, { headers: { Authorization: `Bearer ${token}` } }).then((r) =>
        r.json(),
      ),
    [token],
  );
  const { data, mutate } = useSWR<AgendaResponse>(swrKey, fetcher, {
    refreshInterval: 3000,
  });

  const items = data?.items ?? [];
  const doneCount = items.filter((i) => i.completed).length;
  // "in corso": il primo punto non ancora spuntato.
  const inProgressId = items.find((i) => !i.completed)?.id ?? null;

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

  const react = useCallback(
    async (item: AgendaItem, value: ReactionValue) => {
      // Toggle off when re-clicking the current choice.
      const next: ReactionValue | null = item.myReaction === value ? null : value;
      const prev = item.myReaction;
      const agreeDelta = (next === 'AGREE' ? 1 : 0) - (prev === 'AGREE' ? 1 : 0);
      const disagreeDelta =
        (next === 'DISAGREE' ? 1 : 0) - (prev === 'DISAGREE' ? 1 : 0);

      await mutate(
        (cur) =>
          cur
            ? {
                ...cur,
                items: cur.items.map((i) =>
                  i.id === item.id
                    ? {
                        ...i,
                        myReaction: next,
                        agreeCount: Math.max(0, i.agreeCount + agreeDelta),
                        disagreeCount: Math.max(0, i.disagreeCount + disagreeDelta),
                      }
                    : i,
                ),
              }
            : cur,
        { revalidate: false },
      );

      await fetch(`${apiUrl}/${item.id}/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          guestId ? { value: next, guestId } : { value: next, accessToken: token },
        ),
      }).catch(() => {
        /* best-effort; next poll reconciles */
      });
      await mutate();
    },
    [apiUrl, token, guestId, mutate],
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
        {items.map((item) => {
          const total = item.agreeCount + item.disagreeCount;
          const agreePct = total > 0 ? Math.round((item.agreeCount / total) * 100) : 0;
          const isInProgress = item.id === inProgressId;
          // Reactions surface on active (not-yet-checked) items; a completed
          // item keeps a compact read-only tally only if it already has votes.
          const showReactions = !item.completed || total > 0;
          return (
            <li
              key={item.id}
              className="py-2"
              style={{ borderBottom: '1px solid #f0f0f0' }}
            >
              <div className="d-flex align-items-start gap-2">
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
                  {isInProgress && (
                    <span
                      className="badge ms-2 align-middle"
                      style={{
                        backgroundColor: 'rgba(0,102,204,0.12)',
                        color: '#0066CC',
                        fontWeight: 600,
                        fontSize: '0.62rem',
                      }}
                    >
                      ● {t('inProgress')}
                    </span>
                  )}
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
              </div>

              {showReactions && (
                <div className="ms-4 mt-1">
                  <div className="d-flex align-items-center gap-2 mb-1">
                    {canReact && !item.completed ? (
                      <>
                        <ReactButton
                          active={item.myReaction === 'AGREE'}
                          tone="agree"
                          count={item.agreeCount}
                          label={t('agree')}
                          onClick={() => void react(item, 'AGREE')}
                        />
                        <ReactButton
                          active={item.myReaction === 'DISAGREE'}
                          tone="disagree"
                          count={item.disagreeCount}
                          label={t('disagree')}
                          onClick={() => void react(item, 'DISAGREE')}
                        />
                      </>
                    ) : (
                      <span
                        className="text-secondary"
                        style={{ fontSize: '0.78rem' }}
                      >
                        👍 {item.agreeCount} · 👎 {item.disagreeCount}
                      </span>
                    )}
                  </div>
                  {total > 0 ? (
                    <div className="d-flex align-items-center gap-2">
                      <div
                        className="flex-grow-1 rounded-pill overflow-hidden"
                        style={{ height: 6, backgroundColor: '#f0d4d4' }}
                        role="img"
                        aria-label={t('favorablePct', { pct: agreePct })}
                      >
                        <div
                          style={{
                            width: `${agreePct}%`,
                            height: '100%',
                            backgroundColor: '#008758',
                            transition: 'width 0.3s',
                          }}
                        />
                      </div>
                      <span
                        className="text-secondary flex-shrink-0"
                        style={{ fontSize: '0.72rem' }}
                      >
                        {t('favorablePct', { pct: agreePct })}
                      </span>
                    </div>
                  ) : (
                    canReact &&
                    !item.completed && (
                      <span className="text-secondary" style={{ fontSize: '0.72rem' }}>
                        {t('noReactions')}
                      </span>
                    )
                  )}
                </div>
              )}
            </li>
          );
        })}
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

function ReactButton({
  active,
  tone,
  count,
  label,
  onClick,
}: {
  active: boolean;
  tone: 'agree' | 'disagree';
  count: number;
  label: string;
  onClick: () => void;
}) {
  const color = tone === 'agree' ? '#008758' : '#D9364F';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={label}
      className="btn btn-sm d-inline-flex align-items-center gap-1"
      style={{
        padding: '0.1rem 0.5rem',
        fontSize: '0.78rem',
        lineHeight: 1.4,
        border: `1px solid ${active ? color : '#d0d0d0'}`,
        backgroundColor: active ? color : 'transparent',
        color: active ? '#fff' : color,
        borderRadius: 999,
      }}
    >
      <span aria-hidden="true">{tone === 'agree' ? '👍' : '👎'}</span>
      <span>{count}</span>
    </button>
  );
}
