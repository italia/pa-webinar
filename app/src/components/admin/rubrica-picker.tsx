'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

export interface RubricaPickedPerson {
  id: string;
  displayName: string;
  organization: string | null;
  email: string | null;
}

interface RubricaRow {
  id: string;
  displayName: string | null;
  organization: string | null;
  organizationRole: string | null;
  organizationType: string | null;
  email?: string | null;
  emailHash?: string | null;
}

type SingleProps = {
  mode?: 'single';
  onSelect: (person: RubricaPickedPerson) => void;
  onAddMany?: never;
  placeholder?: string;
  disabled?: boolean;
};

type MultiProps = {
  mode: 'multi';
  onAddMany: (persons: RubricaPickedPerson[]) => void;
  onSelect?: never;
  placeholder?: string;
  disabled?: boolean;
};

type RubricaPickerProps = SingleProps | MultiProps;

const DEBOUNCE_MS = 250;
const RESULT_LIMIT = 8;

function rowToPerson(row: RubricaRow): RubricaPickedPerson {
  const email =
    typeof row.email === 'string' && row.email.length > 0 ? row.email : null;
  return {
    id: row.id,
    displayName: row.displayName ?? '',
    organization: row.organization ?? null,
    email,
  };
}

export default function RubricaPicker(props: RubricaPickerProps) {
  const { placeholder, disabled } = props;
  const mode: 'single' | 'multi' = props.mode ?? 'single';
  const t = useTranslations('admin.rubricaPicker');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RubricaRow[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [selected, setSelected] = useState<RubricaPickedPerson[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const reqCounter = useRef(0);
  const listboxId = useId();

  const runSearch = useCallback(async (q: string) => {
    const mine = ++reqCounter.current;
    setLoading(true);
    try {
      // Admin picker includes opted-out persons — the admin rubrica may
      // contain entries that have not (yet) opted in to the address book.
      const qs = new URLSearchParams({
        q,
        limit: String(RESULT_LIMIT),
        includeOpted: 'out',
      });
      const res = await fetch(`/api/admin/rubrica?${qs.toString()}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        if (mine === reqCounter.current) setResults([]);
        return;
      }
      const data = (await res.json()) as { rows: RubricaRow[] };
      if (mine === reqCounter.current) {
        setResults(
          Array.isArray(data.rows) ? data.rows.slice(0, RESULT_LIMIT) : [],
        );
        setHighlight(0);
      }
    } catch {
      if (mine === reqCounter.current) setResults([]);
    } finally {
      if (mine === reqCounter.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    const handle = setTimeout(() => {
      void runSearch(query.trim());
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, runSearch]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const chooseSingle = useCallback(
    (row: RubricaRow) => {
      if (mode !== 'single' || !props.onSelect) return;
      props.onSelect(rowToPerson(row));
      setQuery('');
      setResults([]);
      setOpen(false);
      setHighlight(0);
    },
    // props.onSelect is stable per render; mode is a literal
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, props.onSelect],
  );

  const toggleSelected = useCallback((row: RubricaRow) => {
    const person = rowToPerson(row);
    setSelected((list) => {
      if (list.some((p) => p.id === person.id)) {
        return list.filter((p) => p.id !== person.id);
      }
      return [...list, person];
    });
  }, []);

  const removeSelected = useCallback((id: string) => {
    setSelected((list) => list.filter((p) => p.id !== id));
  }, []);

  const emitAddMany = useCallback(() => {
    if (mode !== 'multi' || !props.onAddMany) return;
    if (selected.length === 0) return;
    props.onAddMany(selected);
    setSelected([]);
    setQuery('');
    setResults([]);
    setOpen(false);
    setHighlight(0);
  }, [mode, props.onAddMany, selected]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) {
      if (e.key === 'Escape') {
        setOpen(false);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (h + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = results[highlight];
      if (!pick) return;
      if (mode === 'multi') {
        toggleSelected(pick);
      } else {
        chooseSingle(pick);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  // Keep the dropdown open as long as the user is focused with a non-empty
  // query. Show explicit loading / empty states inside instead of flickering.
  const showDropdown = open && query.trim().length > 0;

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {mode === 'multi' && selected.length > 0 && (
        <div className="d-flex flex-wrap gap-2 mb-2" aria-live="polite">
          {selected.map((p) => (
            <span
              key={p.id}
              className="badge bg-primary d-inline-flex align-items-center"
              style={{ fontSize: '0.85rem', padding: '0.35em 0.6em' }}
            >
              <span className="me-2">
                {p.displayName || p.email || p.id}
              </span>
              <button
                type="button"
                className="btn-close btn-close-white btn-sm"
                aria-label="remove"
                onClick={() => removeSelected(p.id)}
                style={{ fontSize: '0.6rem' }}
              />
            </span>
          ))}
        </div>
      )}
      <div className="d-flex gap-2">
        <input
          ref={inputRef}
          type="text"
          className="form-control"
          value={query}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          role="combobox"
          aria-expanded={showDropdown}
          aria-autocomplete="list"
          aria-controls={listboxId}
        />
        {mode === 'multi' && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={disabled || selected.length === 0}
            onClick={emitAddMany}
          >
            {t('addSelected')}
            {selected.length > 0 && (
              <span className="ms-2 badge bg-light text-primary">
                {selected.length}
              </span>
            )}
          </button>
        )}
      </div>
      {mode === 'multi' && selected.length > 0 && (
        <small className="text-muted d-block mt-1">
          {t('selectedCount', { count: selected.length })}
        </small>
      )}
      {showDropdown && (
        <ul
          id={listboxId}
          role="listbox"
          className="list-group shadow-sm"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 1050,
            marginTop: 4,
            maxHeight: 320,
            overflowY: 'auto',
          }}
        >
          {loading && results.length === 0 && (
            <li className="list-group-item text-muted small">
              <span
                className="spinner-border spinner-border-sm me-2"
                aria-hidden="true"
              />
              {t('loading')}
            </li>
          )}
          {!loading && results.length === 0 && (
            <li className="list-group-item text-muted small">
              {t('noResults')}
            </li>
          )}
          {results.map((row, i) => {
            const active = i === highlight;
            const isSelected =
              mode === 'multi' && selected.some((p) => p.id === row.id);
            return (
              <li
                key={row.id}
                role="option"
                aria-selected={active}
                className={`list-group-item list-group-item-action${
                  active ? ' active' : ''
                }`}
                style={{ cursor: 'pointer' }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (mode === 'multi') {
                    toggleSelected(row);
                  } else {
                    chooseSingle(row);
                  }
                }}
                onMouseEnter={() => setHighlight(i)}
              >
                <div className="d-flex align-items-center">
                  {mode === 'multi' && (
                    <input
                      type="checkbox"
                      className="form-check-input me-2"
                      checked={isSelected}
                      readOnly
                      tabIndex={-1}
                      aria-hidden="true"
                    />
                  )}
                  <div>
                    <div className="fw-semibold">
                      {row.displayName || '—'}
                    </div>
                    {row.organization && (
                      <small className={active ? '' : 'text-muted'}>
                        {row.organization}
                      </small>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
