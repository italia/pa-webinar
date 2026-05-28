'use client';

/**
 * Hook che gestisce il deep-link `#t=NN` (NN = secondi dall'inizio).
 *
 * Esempi di URL:
 *   /it/eventi/<slug>#t=183     → al load, fa seek a 3:03 e play
 *   /it/eventi/<slug>#t=0:45    → 45 secondi (forma MM:SS supportata)
 *
 * Usato da:
 *   - PostEventHero (topic chips) per costruire il link condivisibile
 *   - TranscriptPanel (futuro share-segment)
 *   - event-detail-client per riprendere il punto al caricamento
 */

import { useEffect } from 'react';
import type { RefObject } from 'react';

import type { VideoPlayerHandle } from '@/components/events/video-player';

function parseHashTime(): number | null {
  if (typeof window === 'undefined') return null;
  const m = window.location.hash.match(/#t=([0-9]+(?::[0-9]{1,2})?(?:\.[0-9]+)?)/);
  if (!m) return null;
  const raw = m[1]!;
  if (raw.includes(':')) {
    const [mm, ss] = raw.split(':');
    return Number(mm) * 60 + Number(ss);
  }
  return Number(raw);
}

export function useDeepLinkSeek(playerRef: RefObject<VideoPlayerHandle | null>) {
  useEffect(() => {
    const apply = () => {
      const sec = parseHashTime();
      if (sec == null || Number.isNaN(sec)) return;
      const video = playerRef.current?.videoEl?.();
      if (!video) return;
      // Aspetta che il <video> abbia metadata pronti per fare seek
      // attendibile (durata nota).
      if (video.readyState >= 1) {
        playerRef.current?.seekTo?.(sec, true);
      } else {
        const once = () => {
          video.removeEventListener('loadedmetadata', once);
          playerRef.current?.seekTo?.(sec, true);
        };
        video.addEventListener('loadedmetadata', once);
      }
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, [playerRef]);
}
