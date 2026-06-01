'use client';

/**
 * Lista dei bookmark salvati dall'utente per l'evento corrente.
 * I bookmark sono persistiti in `localStorage` (vedi `useBookmarks`):
 * non richiedono login. Ogni utente vede i propri, sul proprio
 * browser/device.
 *
 * Renderizzato come card nel sidebar destra della pagina evento
 * ENDED, sotto al PostEventSidebar. Niente UI se la lista è vuota
 * (la card scompare per non sprecare spazio quando non serve).
 */

import { useTranslations } from 'next-intl';
import type { RefObject } from 'react';
import { Icon } from 'design-react-kit';

import type { VideoPlayerHandle } from '@/components/events/video-player';
import { useBookmarks } from '@/lib/utils/use-bookmarks';

interface Props {
  slug: string;
  playerRef: RefObject<VideoPlayerHandle | null>;
}

function formatTs(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function BookmarksPanel({ slug, playerRef }: Props) {
  const t = useTranslations('postprod');
  const bookmarks = useBookmarks(slug);

  if (bookmarks.items.length === 0) return null;

  const goTo = (sec: number) => {
    playerRef.current?.seekTo?.(sec, true);
    // Scroll al video se l'utente è in basso nella pagina.
    playerRef.current?.videoEl?.()?.scrollIntoView?.({
      behavior: 'smooth',
      block: 'center',
    });
  };

  return (
    <div
      className="mt-3"
      style={{
        background: 'white',
        borderRadius: 12,
        border: '1px solid #d6e3f1',
        padding: 16,
      }}
      aria-label={t('bookmarksHeader')}
    >
      <div
        className="d-flex align-items-center gap-2 mb-3"
        style={{ color: '#17324D' }}
      >
        <Icon icon="it-star-full" size="sm" color={undefined} />
        <span className="fw-semibold">{t('bookmarksHeader')}</span>
        <span
          className="ms-auto"
          style={{ fontSize: '0.72rem', color: '#5A768A' }}
        >
          {bookmarks.items.length}
        </span>
      </div>

      <ul className="list-unstyled mb-0">
        {bookmarks.items.map((b) => (
          <li
            key={`${b.tSec}-${b.at}`}
            className="d-flex align-items-start gap-2 py-2"
            style={{ borderTop: '1px solid #eef3f8' }}
          >
            <button
              type="button"
              onClick={() => goTo(b.tSec)}
              className="text-start flex-grow-1 p-0 border-0 bg-transparent"
              style={{ cursor: 'pointer' }}
            >
              <code
                style={{
                  color: '#0066CC',
                  fontVariantNumeric: 'tabular-nums',
                  fontSize: '0.78rem',
                }}
              >
                {formatTs(b.tSec)}
              </code>
              <div
                className="mt-1"
                style={{
                  color: '#26354A',
                  fontSize: '0.85rem',
                  lineHeight: 1.4,
                }}
              >
                {b.label || '—'}
              </div>
            </button>
            <button
              type="button"
              onClick={() => bookmarks.remove(b.tSec)}
              title={t('bookmarkRemove')}
              aria-label={t('bookmarkRemove')}
              className="btn p-0 border-0 bg-transparent"
              style={{
                color: '#9AAAB8',
                width: 26,
                height: 26,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <Icon icon="it-close" size="sm" color={undefined} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
