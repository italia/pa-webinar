'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

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

interface RubricaPickerProps {
  onSelect: (person: RubricaPickedPerson) => void;
  placeholder?: string;
  disabled?: boolean;
}

const DEBOUNCE_MS = 250;
const RESULT_LIMIT = 8;

export default function RubricaPicker({
  onSelect,
  placeholder,
  disabled,
}: RubricaPickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RubricaRow[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const reqCounter = useRef(0);
  const listboxId = useId();

  const runSearch = useCallback(async (q: string) => {
    const mine = ++reqCounter.current;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ q, limit: String(RESULT_LIMIT) });
      const res = await fetch(`/api/admin/rubrica?${qs.toString()}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        if (mine === reqCounter.current) setResults([]);
        return;
      }
      const data = (await res.json()) as { rows: RubricaRow[] };
      if (mine === reqCounter.current) {
        setResults(Array.isArray(data.rows) ? data.rows.slice(0, RESULT_LIMIT) : []);
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

  const choose = useCallback(
    (row: RubricaRow) => {
      const email =
        typeof row.email === 'string' && row.email.length > 0 ? row.email : null;
      onSelect({
        id: row.id,
        displayName: row.displayName ?? '',
        organization: row.organization ?? null,
        email,
      });
      setQuery('');
      setResults([]);
      setOpen(false);
      setHighlight(0);
    },
    [onSelect],
  );

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
      if (pick) choose(pick);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  const showDropdown =
    open && query.trim().length > 0 && (loading || results.length > 0);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
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
              ...
            </li>
          )}
          {results.map((row, i) => {
            const active = i === highlight;
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
                  choose(row);
                }}
                onMouseEnter={() => setHighlight(i)}
              >
                <div className="fw-semibold">
                  {row.displayName || '—'}
                </div>
                {row.organization && (
                  <small className={active ? '' : 'text-muted'}>
                    {row.organization}
                  </small>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
