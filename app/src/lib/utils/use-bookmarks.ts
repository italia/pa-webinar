'use client';

/**
 * Bookmark dei punti del video, persistiti in localStorage per evento.
 *
 * Niente DB, niente login: il bookmark è un'azione personale dell'utente
 * che riguarda solo il suo browser. Lo stesso utente, su un altro device,
 * non vedrà i suoi bookmark — è una semplice "memo locale".
 *
 * Schema in localStorage:
 *   key:   "eventi-dtd:bookmarks:<slug>"
 *   value: JSON [{ tSec: 183, label: "Mute al singolo", at: 1716922800000 }]
 */
import { useCallback, useEffect, useState } from 'react';

export interface Bookmark {
  /** Secondi dall'inizio del video. */
  tSec: number;
  /** Etichetta — di solito le prime parole del segmento di transcript. */
  label: string;
  /** Timestamp di salvataggio (ms epoch). */
  at: number;
}

const PREFIX = 'eventi-dtd:bookmarks:';
const MAX_LABEL_LEN = 80;

function readAll(slug: string): Bookmark[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(PREFIX + slug);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeAll(slug: string, items: Bookmark[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREFIX + slug, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent('bookmarks-update', { detail: { slug } }));
  } catch {
    // Quota o private mode: best-effort silenzioso.
  }
}

export function useBookmarks(slug: string) {
  const [items, setItems] = useState<Bookmark[]>([]);

  useEffect(() => {
    setItems(readAll(slug));
    const onUpdate = (e: Event) => {
      const det = (e as CustomEvent).detail as { slug?: string } | undefined;
      if (det?.slug === slug) setItems(readAll(slug));
    };
    window.addEventListener('bookmarks-update', onUpdate);
    return () => window.removeEventListener('bookmarks-update', onUpdate);
  }, [slug]);

  const add = useCallback(
    (b: Omit<Bookmark, 'at'>) => {
      const label = (b.label || '').slice(0, MAX_LABEL_LEN);
      const fresh: Bookmark = { tSec: Math.floor(b.tSec), label, at: Date.now() };
      const next = readAll(slug).filter((it) => Math.abs(it.tSec - fresh.tSec) > 1);
      next.push(fresh);
      next.sort((a, b) => a.tSec - b.tSec);
      writeAll(slug, next);
    },
    [slug],
  );

  const remove = useCallback(
    (tSec: number) => {
      const next = readAll(slug).filter((it) => Math.abs(it.tSec - tSec) > 1);
      writeAll(slug, next);
    },
    [slug],
  );

  const has = useCallback(
    (tSec: number) =>
      readAll(slug).some((it) => Math.abs(it.tSec - tSec) <= 1),
    [slug],
  );

  return { items, add, remove, has };
}
