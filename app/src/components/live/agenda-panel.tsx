'use client';

/**
 * La scaletta dell'incontro (funzione opzionale agendaEnabled).
 *
 * Il moderatore prepara gli argomenti (anche incollando un elenco, uno per
 * riga), con una durata prevista se vuole, li riordina e ne guida lo stato: da
 * discutere, in corso (uno solo alla volta), discusso, saltato. «Prossimo
 * argomento» chiude quello in corso e avvia il successivo. Chi partecipa vede
 * a che punto si e' e sull'argomento in corso puo' dire se e' d'accordo
 * (audience pulse). L'argomento in corso compare anche nella barra della sala
 * (agenda-ticker), per chi segue la chiamata e la chat senza aprire il pannello.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { useNow, useTranslations } from 'next-intl';

import { Icon } from '@/components/ui/icon';
import { useLivePush } from '@/hooks/use-live-state';
import { splitAgendaLines, type AgendaStatus } from '@/lib/agenda/status';

import AgendaStatusLine from './agenda-status-line';

type ReactionValue = 'AGREE' | 'DISAGREE';

interface AgendaItem {
  id: string;
  label: string;
  completed: boolean;
  status: AgendaStatus;
  startedAt: string | null;
  completedAt: string | null;
  plannedMinutes: number | null;
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

/** Il campo «nuovo argomento» cresce con il testo fino a questa altezza. */
const ADD_MAX_HEIGHT = 140;

/**
 * Minuti scritti in un campo: vuoto vuol dire nessuna durata (null), un intero
 * tra 1 e 600 e' la durata, il resto non e' valido (undefined): si dice, non
 * si cancella in silenzio la durata che c'era. Il campo e' di testo: uno di
 * tipo numero con dentro «1e» o lettere varrebbe '' e sembrerebbe vuoto.
 */
function parseMinutes(raw: string): number | null | undefined {
  const testo = raw.trim();
  if (testo === '') return null;
  if (!/^\d{1,3}$/.test(testo)) return undefined;
  const n = Number(testo);
  return n >= 1 && n <= 600 ? n : undefined;
}

export default function AgendaPanel({
  eventSlug,
  token,
  isModerator,
  canReact = false,
  guestId,
}: Props) {
  const t = useTranslations('agenda');
  const tc = useTranslations('common');
  const now = useNow({ updateInterval: 30_000 });
  const apiUrl = `/api/events/${eventSlug}/agenda`;
  const swrKey = guestId ? `${apiUrl}?guestId=${encodeURIComponent(guestId)}` : apiUrl;
  const [newText, setNewText] = useState('');
  const [newMinutes, setNewMinutes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addRef = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();
  // L'argomento che il moderatore sta modificando: titolo, durata, posizione.
  const [editing, setEditing] = useState<{ id: string; label: string; minutes: string } | null>(
    null,
  );
  // Eliminare non si annulla: il primo clic chiede conferma.
  const [armedDelete, setArmedDelete] = useState<string | null>(null);
  useEffect(() => {
    if (!armedDelete) return;
    const timer = setTimeout(() => setArmedDelete(null), 4000);
    return () => clearTimeout(timer);
  }, [armedDelete]);

  // Il campo cresce con le righe incollate, cosi' l'elenco si rilegge tutto.
  useEffect(() => {
    const el = addRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, ADD_MAX_HEIGHT)}px`;
  }, [newText]);

  const fetcher = useCallback(
    (url: string) =>
      fetch(url, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
    [token],
  );
  const pushLive = useLivePush();
  const { data, mutate } = useSWR<AgendaResponse>(swrKey, fetcher, {
    refreshInterval: pushLive ? 0 : 3000,
  });

  const items = useMemo(() => data?.items ?? [], [data]);
  const doneCount = items.filter((i) => i.status === 'DONE').length;
  const skippedCount = items.filter((i) => i.status === 'SKIPPED').length;
  const plannedTotal = items.reduce((tot, i) => tot + (i.plannedMinutes ?? 0), 0);
  const current = items.find((i) => i.status === 'CURRENT') ?? null;
  // Il prossimo da discutere: il primo «da discutere» dopo quello in corso,
  // altrimenti il primo «da discutere» in assoluto.
  const currentIndex = current ? items.indexOf(current) : -1;
  const next =
    items.slice(currentIndex + 1).find((i) => i.status === 'PENDING') ??
    items.find((i) => i.status === 'PENDING') ??
    null;

  const righe = splitAgendaLines(newText);

  /** Una scrittura del moderatore: un rifiuto del server si dice. */
  const send = useCallback(
    async (url: string, init: RequestInit, conflictMessage?: string): Promise<boolean> => {
      setError(null);
      let ok = false;
      try {
        const res = await fetch(url, init);
        ok = res.ok;
        if (!ok) setError(res.status === 409 && conflictMessage ? conflictMessage : tc('errorGeneric'));
      } catch {
        setError(tc('errorGeneric'));
      }
      await mutate();
      return ok;
    },
    [mutate, tc],
  );

  const jsonInit = useCallback(
    (method: string, body: unknown): RequestInit => ({
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
    [token],
  );

  const setStatus = useCallback(
    (item: AgendaItem, status: AgendaStatus) =>
      send(`${apiUrl}/${item.id}`, jsonInit('PATCH', { status })),
    [apiUrl, jsonInit, send],
  );

  const addItems = useCallback(async () => {
    if (righe.length === 0 || busy) return;
    const minuti = righe.length === 1 ? parseMinutes(newMinutes) : null;
    if (minuti === undefined) {
      setError(t('minutesInvalid'));
      return;
    }
    setBusy(true);
    const body = righe.length === 1 ? { label: righe[0], plannedMinutes: minuti } : { labels: righe };
    const ok = await send(apiUrl, jsonInit('POST', body));
    if (ok) {
      setNewText('');
      setNewMinutes('');
    }
    setBusy(false);
  }, [righe, busy, newMinutes, apiUrl, jsonInit, send, t]);

  const saveEdit = useCallback(async () => {
    if (!editing) return;
    const label = editing.label.trim();
    if (!label) return;
    const minuti = parseMinutes(editing.minutes);
    if (minuti === undefined) {
      setError(t('minutesInvalid'));
      return;
    }
    const ok = await send(
      `${apiUrl}/${editing.id}`,
      jsonInit('PATCH', { label, plannedMinutes: minuti }),
    );
    if (ok) setEditing(null);
  }, [editing, apiUrl, jsonInit, send, t]);

  const move = useCallback(
    async (item: AgendaItem, delta: -1 | 1) => {
      const idx = items.findIndex((i) => i.id === item.id);
      const dest = idx + delta;
      if (idx < 0 || dest < 0 || dest >= items.length) return;
      const riordinati = [...items];
      [riordinati[idx], riordinati[dest]] = [riordinati[dest]!, riordinati[idx]!];
      await mutate((cur) => (cur ? { ...cur, items: riordinati } : cur), { revalidate: false });
      await send(
        apiUrl,
        jsonInit('PUT', { order: riordinati.map((i) => i.id) }),
        t('agendaChanged'),
      );
    },
    [items, apiUrl, jsonInit, mutate, send, t],
  );

  const remove = useCallback(
    async (id: string) => {
      const ok = await send(`${apiUrl}/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (ok) setEditing(null);
    },
    [apiUrl, token, send],
  );

  const react = useCallback(
    async (item: AgendaItem, value: ReactionValue) => {
      const nextReaction: ReactionValue | null = item.myReaction === value ? null : value;
      const prev = item.myReaction;
      const agreeDelta = (nextReaction === 'AGREE' ? 1 : 0) - (prev === 'AGREE' ? 1 : 0);
      const disagreeDelta = (nextReaction === 'DISAGREE' ? 1 : 0) - (prev === 'DISAGREE' ? 1 : 0);

      await mutate(
        (cur) =>
          cur
            ? {
                ...cur,
                items: cur.items.map((i) =>
                  i.id === item.id
                    ? {
                        ...i,
                        myReaction: nextReaction,
                        agreeCount: Math.max(0, i.agreeCount + agreeDelta),
                        disagreeCount: Math.max(0, i.disagreeCount + disagreeDelta),
                      }
                    : i,
                ),
              }
            : cur,
        { revalidate: false },
      );

      await send(`${apiUrl}/${item.id}/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          guestId ? { value: nextReaction, guestId } : { value: nextReaction, accessToken: token },
        ),
      });
    },
    [apiUrl, token, guestId, mutate, send],
  );

  const progresso = items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0;

  return (
    <div className="agenda">
      <div className="live-panel-header">
        <h6 className="live-panel-header__title">
          <Icon icon="it-list" size="sm" color="primary" />
          {t('title')}
        </h6>
      </div>

      {items.length > 0 && (
        <div className="agenda__progress">
          <span className="agenda__progress-label">
            <span>
              {t('progress', { done: doneCount, total: items.length })}
              {skippedCount > 0 && <> · {t('skippedCount', { count: skippedCount })}</>}
            </span>
            {plannedTotal > 0 && (
              <span className="agenda__planned-total">
                <Icon icon="it-clock" size="xs" />
                {t('plannedTotal', { minutes: plannedTotal })}
              </span>
            )}
          </span>
          <span
            className="agenda__progress-bar"
            role="meter"
            aria-label={t('progress', { done: doneCount, total: items.length })}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progresso}
          >
            <span style={{ width: `${progresso}%` }} />
          </span>
        </div>
      )}

      {isModerator && (current || next) && (
        <button
          type="button"
          className="agenda__next"
          onClick={() => {
            if (next) void setStatus(next, 'CURRENT');
            else if (current) void setStatus(current, 'DONE');
          }}
        >
          {next ? (
            <>
              <Icon icon="it-arrow-right-circle" size="sm" color="white" />
              <span>
                {current ? t('nextTopic') : t('startFirst')}
                <span className="agenda__next-label">{next.label}</span>
              </span>
            </>
          ) : (
            <>
              <Icon icon="it-check-circle" size="sm" color="white" />
              <span>{t('finishCurrent')}</span>
            </>
          )}
        </button>
      )}

      {error && (
        <p className="qa-error" role="alert">
          {error}
        </p>
      )}

      {data && items.length === 0 && (
        <div className="qa-empty">
          <span className="qa-empty__icon" aria-hidden="true">
            <Icon icon="it-list" color="primary" />
          </span>
          <p className="mb-0">{isModerator ? t('emptyModerator') : t('empty')}</p>
        </div>
      )}

      <ol className="agenda__list">
        {items.map((item, idx) => {
          const total = item.agreeCount + item.disagreeCount;
          const agreePct = total > 0 ? Math.round((item.agreeCount / total) * 100) : 0;
          const aperto = item.status === 'PENDING' || item.status === 'CURRENT';
          // Si reagisce all'argomento di cui si sta parlando: su quelli ancora
          // da discutere non c'e' niente su cui essere d'accordo.
          const reagisce = canReact && item.status === 'CURRENT';
          const inModifica = editing?.id === item.id;
          return (
            <li key={item.id} className={`agenda-item agenda-item--${item.status.toLowerCase()}`}>
              {inModifica && editing ? (
                <form
                  className="agenda-edit"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveEdit();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setEditing(null);
                  }}
                >
                  <input
                    type="text"
                    className="agenda-edit__label"
                    aria-label={t('editLabel')}
                    value={editing.label}
                    maxLength={500}
                    autoFocus
                    onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                  />
                  <div className="agenda-edit__row">
                    <label className="agenda-minutes">
                      <Icon icon="it-clock" size="xs" />
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={3}
                        placeholder={t('minutesPlaceholder')}
                        aria-label={t('minutesLabel')}
                        value={editing.minutes}
                        onChange={(e) => setEditing({ ...editing, minutes: e.target.value })}
                      />
                      <span aria-hidden="true">{t('minutesPlaceholder')}</span>
                    </label>
                    <button
                      type="button"
                      className="qa-action"
                      title={t('actions.moveUp')}
                      aria-label={`${t('actions.moveUp')}: ${item.label}`}
                      disabled={idx === 0}
                      onClick={() => void move(item, -1)}
                    >
                      <Icon icon="it-arrow-up" size="sm" />
                    </button>
                    <button
                      type="button"
                      className="qa-action"
                      title={t('actions.moveDown')}
                      aria-label={`${t('actions.moveDown')}: ${item.label}`}
                      disabled={idx === items.length - 1}
                      onClick={() => void move(item, 1)}
                    >
                      <Icon icon="it-arrow-down" size="sm" />
                    </button>
                    <button
                      type="button"
                      className={`qa-action qa-action--dismiss${armedDelete === item.id ? ' is-armed' : ''}`}
                      title={t('remove')}
                      aria-label={
                        armedDelete === item.id
                          ? `${t('remove')}: ${item.label} — ${tc('confirm')}`
                          : `${t('remove')}: ${item.label}`
                      }
                      onClick={() => {
                        if (armedDelete !== item.id) {
                          setArmedDelete(item.id);
                          return;
                        }
                        setArmedDelete(null);
                        void remove(item.id);
                      }}
                    >
                      <Icon icon="it-delete" size="sm" />
                      {armedDelete === item.id && <span>{tc('confirm')}</span>}
                    </button>
                    <span className="agenda-edit__spacer" />
                    <button type="button" className="poll-action" onClick={() => setEditing(null)}>
                      {tc('cancel')}
                    </button>
                    <button
                      type="submit"
                      className="poll-action poll-action--primary"
                      disabled={!editing.label.trim()}
                    >
                      {tc('save')}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="agenda-item__main">
                  <span className="agenda-item__marker" aria-hidden="true">
                    {item.status === 'DONE' ? (
                      <Icon icon="it-check" size="xs" />
                    ) : item.status === 'SKIPPED' ? (
                      <Icon icon="it-arrow-right" size="xs" />
                    ) : item.status === 'CURRENT' ? (
                      <span className="agenda-item__pulse" />
                    ) : (
                      idx + 1
                    )}
                  </span>
                  <div className="agenda-item__body">
                    <span className="agenda-item__label">{item.label}</span>
                    <AgendaStatusLine item={item} now={now} isModerator={isModerator} />
                  </div>
                  {isModerator && (
                    <div className="agenda-item__actions">
                      {item.status === 'PENDING' && (
                        <button
                          type="button"
                          className="qa-action qa-action--text"
                          aria-label={`${t('actions.start')}: ${item.label}`}
                          onClick={() => void setStatus(item, 'CURRENT')}
                        >
                          {t('actions.start')}
                        </button>
                      )}
                      {item.status === 'CURRENT' && (
                        <button
                          type="button"
                          className="qa-action qa-action--answered"
                          title={t('actions.done')}
                          aria-label={`${t('actions.done')}: ${item.label}`}
                          onClick={() => void setStatus(item, 'DONE')}
                        >
                          <Icon icon="it-check-circle" size="sm" />
                        </button>
                      )}
                      {aperto && (
                        <button
                          type="button"
                          className="qa-action"
                          title={t('actions.skip')}
                          aria-label={`${t('actions.skip')}: ${item.label}`}
                          onClick={() => void setStatus(item, 'SKIPPED')}
                        >
                          <Icon icon="it-arrow-right" size="sm" />
                        </button>
                      )}
                      {!aperto && (
                        <button
                          type="button"
                          className="qa-action"
                          title={t('actions.reopen')}
                          aria-label={`${t('actions.reopen')}: ${item.label}`}
                          onClick={() => void setStatus(item, 'PENDING')}
                        >
                          <Icon icon="it-restore" size="sm" />
                        </button>
                      )}
                      <button
                        type="button"
                        className="qa-action"
                        title={t('actions.edit')}
                        aria-label={`${t('actions.edit')}: ${item.label}`}
                        onClick={() => {
                          setArmedDelete(null);
                          setEditing({
                            id: item.id,
                            label: item.label,
                            minutes: item.plannedMinutes ? String(item.plannedMinutes) : '',
                          });
                        }}
                      >
                        <Icon icon="it-pencil" size="sm" />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {!inModifica && (reagisce || total > 0) && (
                <div className="agenda-item__pulse-row">
                  {reagisce ? (
                    <>
                      <span className="agenda-item__prompt">{t('pulsePrompt')}</span>
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
                    <span className="agenda-item__tally">
                      👍 {item.agreeCount} · 👎 {item.disagreeCount}
                    </span>
                  )}
                  {total > 0 && (
                    <span className="agenda-item__favor">{t('favorablePct', { pct: agreePct })}</span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {isModerator && (
        <form
          className="agenda__add"
          onSubmit={(e) => {
            e.preventDefault();
            void addItems();
          }}
        >
          <div className="agenda__add-row">
            <textarea
              ref={addRef}
              rows={1}
              className="agenda__add-input"
              placeholder={t('addPlaceholder')}
              aria-label={t('addPlaceholder')}
              aria-describedby={hintId}
              value={newText}
              maxLength={5000}
              onChange={(e) => setNewText(e.target.value)}
              onKeyDown={(e) => {
                // Invio aggiunge, Maiusc+Invio va a capo. Durante la
                // composizione (accenti, IME) Invio conferma il carattere.
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void addItems();
                }
              }}
            />
            {righe.length <= 1 && (
              <label className="agenda-minutes">
                <Icon icon="it-clock" size="xs" />
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={3}
                  placeholder={t('minutesPlaceholder')}
                  aria-label={t('minutesLabel')}
                  value={newMinutes}
                  onChange={(e) => setNewMinutes(e.target.value)}
                />
              </label>
            )}
          </div>
          <div className="agenda__add-foot">
            <span id={hintId} className="agenda__add-hint">
              {t('addHint')}
            </span>
            <button
              type="submit"
              className="poll-action poll-action--primary"
              disabled={busy || righe.length === 0}
            >
              <Icon icon="it-plus" size="xs" />
              {righe.length > 1 ? t('addMany', { count: righe.length }) : t('add')}
            </button>
          </div>
        </form>
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
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${label}: ${count}`}
      title={label}
      className={`agenda-react agenda-react--${tone}${active ? ' is-on' : ''}`}
    >
      <span aria-hidden="true">{tone === 'agree' ? '👍' : '👎'}</span>
      <span>{count}</span>
    </button>
  );
}
