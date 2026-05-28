'use client';

/**
 * Mini-player sticky che compare in basso a destra quando il video
 * principale esce dal viewport durante lo scroll. Non duplica il
 * video: mostra solo un riferimento visivo + i controlli essenziali
 * (play/pause, ritorno al video). Il `<video>` element del player
 * principale resta l'unico in pagina — il mini-player condivide la
 * stessa istanza tramite `playerRef`.
 *
 * Comportamento:
 *   - IntersectionObserver sul wrapper del player principale →
 *     quando esce dal viewport, mostra la mini-bar.
 *   - Click sulla mini-bar → scrollIntoView del player principale
 *     con scroll smooth (rimette il video al centro).
 *   - Pulsante chiudi → nasconde la mini-bar fino al prossimo scroll
 *     completo via fuori dal video.
 *   - Auto-pausa il video se l'utente chiude la mini-bar e il video
 *     era in play → evita la fastidiosa "voce che continua a parlare
 *     senza che si veda".
 */

import { useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from 'design-react-kit';

import type { VideoPlayerHandle } from '@/components/events/video-player';

interface Props {
  /** Ref del VideoPlayer principale (per controllo). */
  playerRef: RefObject<VideoPlayerHandle | null>;
  /** Ref del wrapper del player nel layout — IntersectionObserver target. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Titolo dell'evento (usato come label del mini-player). */
  title: string;
  /** Poster opzionale per la mini-thumbnail. */
  poster?: string | null;
}

export default function VideoMiniPlayer({
  playerRef,
  anchorRef,
  title,
  poster,
}: Props) {
  const t = useTranslations('postprod');
  const [visible, setVisible] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const dismissedRef = useRef(false);

  // Track play state for accurate icon
  useEffect(() => {
    const el = playerRef.current?.videoEl?.();
    if (!el) return undefined;
    const update = () => setIsPlaying(!el.paused);
    update();
    el.addEventListener('play', update);
    el.addEventListener('pause', update);
    return () => {
      el.removeEventListener('play', update);
      el.removeEventListener('pause', update);
    };
  }, [playerRef]);

  // Show mini-player when anchor leaves viewport
  useEffect(() => {
    const node = anchorRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return undefined;
    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        const inView = entry.isIntersecting && entry.intersectionRatio > 0.15;
        if (inView) {
          dismissedRef.current = false;
          setVisible(false);
        } else if (!dismissedRef.current) {
          // Mostra solo se il video sta suonando — niente pop-up per
          // chi non sta seguendo il contenuto.
          const el = playerRef.current?.videoEl?.();
          if (el && !el.paused) {
            setVisible(true);
          }
        }
      },
      { threshold: [0, 0.15, 0.5] },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [anchorRef, playerRef]);

  const goToPlayer = () => {
    anchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setVisible(false);
  };

  const dismiss = () => {
    dismissedRef.current = true;
    setVisible(false);
    playerRef.current?.pause?.();
  };

  const togglePlay = () => {
    if (isPlaying) playerRef.current?.pause?.();
    else void playerRef.current?.play?.();
  };

  if (!visible) return null;

  return (
    <div
      className="video-mini-player"
      role="region"
      aria-label={title}
      style={{
        position: 'fixed',
        bottom: 18,
        right: 18,
        zIndex: 1040,
        width: 320,
        maxWidth: 'calc(100vw - 32px)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: 8,
        borderRadius: 12,
        background: 'rgba(20, 32, 52, 0.92)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        color: 'white',
        boxShadow: '0 10px 30px rgba(0,0,0,0.28)',
        animation: 'video-mini-pop 0.2s ease-out',
      }}
    >
      <button
        type="button"
        onClick={goToPlayer}
        title={t('miniPlayerOpen')}
        aria-label={t('miniPlayerOpen')}
        style={{
          position: 'relative',
          width: 56,
          height: 40,
          padding: 0,
          border: 'none',
          borderRadius: 8,
          background: poster
            ? `center/cover no-repeat url(${poster})`
            : 'linear-gradient(135deg, #003a78, #0066CC)',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            borderRadius: 8,
          }}
        />
      </button>
      <button
        type="button"
        onClick={togglePlay}
        title={isPlaying ? t('miniPlayerHint') : t('miniPlayerOpen')}
        style={{
          background: 'rgba(255,255,255,0.16)',
          border: 'none',
          color: 'white',
          width: 36,
          height: 36,
          borderRadius: 18,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        <Icon icon={isPlaying ? 'it-pause' : 'it-play'} size="sm" color="white" />
      </button>
      <button
        type="button"
        onClick={goToPlayer}
        className="text-start text-truncate"
        style={{
          flex: 1,
          background: 'transparent',
          border: 'none',
          color: 'white',
          fontSize: '0.85rem',
          fontWeight: 500,
          cursor: 'pointer',
          padding: 0,
          minWidth: 0,
        }}
      >
        <span style={{ display: 'block', fontSize: '0.7rem', opacity: 0.65 }}>
          {t('miniPlayerHint')}
        </span>
        <span
          style={{
            display: 'block',
            textOverflow: 'ellipsis',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </span>
      </button>
      <button
        type="button"
        onClick={dismiss}
        title={t('miniPlayerClose')}
        aria-label={t('miniPlayerClose')}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'white',
          width: 32,
          height: 32,
          borderRadius: 16,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          opacity: 0.7,
          flexShrink: 0,
        }}
      >
        <Icon icon="it-close" size="sm" color="white" />
      </button>
    </div>
  );
}
