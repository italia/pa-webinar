'use client';

import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useCallback,
  useEffect,
  type KeyboardEvent,
  type ForwardedRef,
} from 'react';
import { useTranslations } from 'next-intl';

export interface SubtitleTrack {
  /** ISO-639-1 language code, e.g. "it", "en", "fr". */
  language: string;
  /** Public VTT URL (typically `/api/events/{slug}/postprod/subtitle/{lang}`). */
  src: string;
  /** Human label, e.g. "Italiano". */
  label: string;
  /** When true, this track is rendered as the default `<track default>`. */
  isDefault?: boolean;
}

/**
 * Alternative audio track (dubbed audio). The player swaps the active
 * audio between the original video track and one of these external
 * `<audio>` elements, synced to the video's currentTime.
 *
 * AI Act Art. 50: ogni traccia con `isSynthetic: true` viene mostrata
 * con un badge "Doppiaggio AI" e una nota nel menu di selezione audio.
 */
export interface AudioTrack {
  /** ISO-639-1 language code or "original" for the source audio. */
  language: string;
  /** Public URL of the audio file (m4a / mp3). Ignored when `language === 'original'`. */
  src?: string;
  /** Human label, e.g. "English (AI dubbed)". */
  label: string;
  /** True for synthetic / AI-generated audio. */
  isSynthetic?: boolean;
}

interface VideoPlayerProps {
  src: string;
  title: string;
  poster?: string;
  /**
   * Optional WebVTT subtitle tracks. Each becomes a `<track>` element.
   * The active track is exposed via a small in-player switcher (CC
   * button) shown only when at least one track is present.
   */
  subtitleTracks?: SubtitleTrack[];
  /** Hook fired when the user picks a different subtitle language. */
  onSubtitleChange?: (lang: string | null) => void;
  /**
   * Optional dubbed audio tracks. When present, the player shows an
   * "Audio" button next to the CC button and the user can switch the
   * playback audio to a dubbed language. Selecting any of these
   * mutes the video's audio and plays the external <audio> in sync.
   */
  audioTracks?: AudioTrack[];
  /** Hook fired when the user picks a different audio track. */
  onAudioChange?: (lang: string) => void;
}

/**
 * Handle esposto via ref dal player. Permette ai consumer (es. il
 * TranscriptPanel) di leggere il tempo corrente, fare seek, gestire
 * pause/play senza dover possedere il `<video>` element diretto.
 */
export interface VideoPlayerHandle {
  /** Current playback time in seconds. */
  currentTime: () => number;
  /** Seek to `seconds`. If `play` is true, resume after seek. */
  seekTo: (seconds: number, play?: boolean) => void;
  /** Pause the playback. */
  pause: () => void;
  /** Play the playback (returns a Promise like HTMLMediaElement.play). */
  play: () => Promise<void> | void;
  /** Raw video element — escape hatch for advanced cases (timeupdate
   *  listener registration), used by TranscriptPanel. */
  videoEl: () => HTMLVideoElement | null;
}

const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function VideoPlayerImpl(
  {
    src,
    title,
    poster,
    subtitleTracks,
    onSubtitleChange,
    audioTracks,
    onAudioChange,
  }: VideoPlayerProps,
  ref: ForwardedRef<VideoPlayerHandle>,
) {
  const t = useTranslations('video');
  const videoRef = useRef<HTMLVideoElement>(null);
  const dubbedAudioRef = useRef<HTMLAudioElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [playing, setPlaying] = useState(false);
  const [activeSubtitle, setActiveSubtitle] = useState<string | null>(
    subtitleTracks?.find((t) => t.isDefault)?.language ?? null,
  );
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);
  const [activeAudio, setActiveAudio] = useState<string>('original');
  const [showAudioMenu, setShowAudioMenu] = useState(false);

  // Imperative handle per consumer esterni (TranscriptPanel ecc.).
  useImperativeHandle(ref, () => ({
    currentTime: () => videoRef.current?.currentTime ?? 0,
    seekTo: (seconds, play = true) => {
      const v = videoRef.current;
      if (!v) return;
      v.currentTime = seconds;
      if (play && v.paused) void v.play();
    },
    pause: () => videoRef.current?.pause(),
    play: () => videoRef.current?.play() ?? Promise.resolve(),
    videoEl: () => videoRef.current,
  }), []);

  // Sincronizza l'audio dubbed con il video. Quando l'utente cambia
  // traccia audio:
  //  - 'original': il video usa il suo audio nativo, l'<audio> esterno
  //    è silenziato e in pausa.
  //  - 'en' / 'fr' / ecc.: il video viene mutato (muted=true), e
  //    l'<audio> esterno parte sincronizzato.
  // Tutti i seek / play / pause sul video vengono propagati all'audio
  // esterno via i listener qui sotto.
  //
  // Note importanti su robustezza:
  //  - aspettiamo `loadedmetadata` sull'audio prima di settare
  //    currentTime e fare play(): impostare `currentTime` su un
  //    media element non ancora pronto è no-op silente.
  //  - niente `crossOrigin="anonymous"` sull'<audio>: il blob storage
  //    Azure non ha CORS configurato per i nostri domini e il check
  //    CORS fallirebbe sul 302 → SAS URL, lasciando il <audio> muto
  //    senza errore visibile. Per la sola riproduzione non serve.
  useEffect(() => {
    const v = videoRef.current;
    const a = dubbedAudioRef.current;
    if (!v) return;

    const isDubbed = activeAudio !== 'original';
    v.muted = isDubbed;

    if (!a) return;
    if (!isDubbed) {
      a.pause();
      try {
        a.currentTime = 0;
      } catch {
        // ignora: src appena cambiato, audio non ancora pronto.
      }
      return;
    }

    const syncTimeAndPlay = (): void => {
      try {
        a.currentTime = v.currentTime;
      } catch {
        // se non è ancora pronto, ritentiamo su loadedmetadata sotto.
      }
      a.playbackRate = v.playbackRate;
      if (!v.paused) {
        void a.play().catch((err) => {
          console.warn('[VideoPlayer] dub audio play() failed', err);
        });
      }
    };

    // Se l'audio è già pronto, sincronizza subito. Altrimenti aspetta
    // loadedmetadata (e play della stessa traccia).
    if (a.readyState >= 1 /* HAVE_METADATA */) {
      syncTimeAndPlay();
    } else {
      const onReady = (): void => {
        a.removeEventListener('loadedmetadata', onReady);
        a.removeEventListener('canplay', onReady);
        syncTimeAndPlay();
      };
      a.addEventListener('loadedmetadata', onReady);
      a.addEventListener('canplay', onReady);
      // Forziamo il fetch nel caso preload non abbia ancora cominciato
      // (può accadere dopo cambio src).
      try {
        a.load();
      } catch {
        // ignora: alcuni browser lanciano AbortError quando load() viene
        // chiamato in rapida sequenza.
      }
    }

    const onPlay = (): void => {
      try {
        a.currentTime = v.currentTime;
      } catch {
        // se l'utente preme play subito dopo aver switchato audio, il
        // src potrebbe non essere ancora pronto: ignoriamo.
      }
      void a.play().catch(() => undefined);
    };
    const onPause = (): void => a.pause();
    const onSeek = (): void => {
      try {
        a.currentTime = v.currentTime;
      } catch {
        // ignora
      }
    };
    const onRate = (): void => {
      a.playbackRate = v.playbackRate;
    };
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('seeked', onSeek);
    v.addEventListener('ratechange', onRate);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('seeked', onSeek);
      v.removeEventListener('ratechange', onRate);
    };
  }, [activeAudio]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [pipSupported, setPipSupported] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setPipSupported('pictureInPictureEnabled' in document && document.pictureInPictureEnabled);
  }, []);

  // Keep <video>.textTracks[i].mode in sync with the selected
  // subtitle language. The `default` attribute on <track> is only
  // consulted on initial load, so switching at runtime requires
  // poking the TextTrack API directly. We also walk the list on
  // every change so newly-added tracks (track.src loads
  // asynchronously) are reconciled.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !subtitleTracks?.length) return;
    const apply = (): void => {
      for (let i = 0; i < video.textTracks.length; i += 1) {
        const tt = video.textTracks[i];
        if (!tt) continue;
        // textTracks are matched by language; if multiple kinds with the
        // same language are present, only `subtitles`/`captions` count.
        const kind = tt.kind === 'captions' || tt.kind === 'subtitles';
        tt.mode =
          kind && activeSubtitle && tt.language === activeSubtitle
            ? 'showing'
            : 'hidden';
      }
    };
    apply();
    // Tracks may not all be loaded yet when this effect first runs;
    // the addtrack event refires reconciliation.
    video.textTracks.addEventListener('addtrack', apply);
    return () => {
      video.textTracks.removeEventListener('addtrack', apply);
    };
  }, [activeSubtitle, subtitleTracks]);

  const scheduleHideControls = useCallback(() => {
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    setShowControls(true);
    hideTimeoutRef.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) {
        setShowControls(false);
      }
    }, 3000);
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setCurrentTime(video.currentTime);
    if (video.buffered.length > 0) {
      setBuffered(video.buffered.end(video.buffered.length - 1));
    }
  }, []);

  const handleSeek = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const video = videoRef.current;
      const bar = progressRef.current;
      if (!video || !bar || !duration) return;
      const rect = bar.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      video.currentTime = pct * duration;
    },
    [duration],
  );

  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const video = videoRef.current;
      if (!video) return;
      const val = Number(e.target.value);
      video.volume = val;
      setVolume(val);
      if (val > 0 && video.muted) {
        video.muted = false;
        setMuted(false);
      }
    },
    [],
  );

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  }, []);

  const changeSpeed = useCallback((s: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = s;
    setSpeed(s);
    setShowSpeedMenu(false);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      container.requestFullscreen();
    }
  }, []);

  const togglePip = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch {
      // PiP may be blocked by user agent policy
    }
  }, []);

  // Toggle captions (C key + button): walks textTracks and either
  // hides the active track or shows the default/first track. Mirrors
  // the menu state via setActiveSubtitle so the badge stays in sync.
  const toggleCaptions = useCallback(() => {
    if (!subtitleTracks || subtitleTracks.length === 0) return;
    if (activeSubtitle) {
      setActiveSubtitle(null);
      onSubtitleChange?.(null);
    } else {
      const pick =
        subtitleTracks.find((tr) => tr.isDefault)?.language ??
        subtitleTracks[0]?.language ??
        null;
      if (pick) {
        setActiveSubtitle(pick);
        onSubtitleChange?.(pick);
      }
    }
  }, [subtitleTracks, activeSubtitle, onSubtitleChange]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const video = videoRef.current;
      if (!video) return;

      // Lasciamo che gli input testuali (cerca trascrizione, ecc.)
      // ricevano il loro tasto — solo i controlli del player gestiscono
      // le scorciatoie. Se l'utente sta digitando in un <input> non
      // intercettare nulla.
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
      }

      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          video.currentTime = Math.min(duration, video.currentTime + 5);
          break;
        case 'j':
        case 'J':
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 10);
          break;
        case 'l':
        case 'L':
          e.preventDefault();
          video.currentTime = Math.min(duration, video.currentTime + 10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          video.volume = Math.min(1, video.volume + 0.05);
          setVolume(video.volume);
          if (video.muted) {
            video.muted = false;
            setMuted(false);
          }
          break;
        case 'ArrowDown':
          e.preventDefault();
          video.volume = Math.max(0, video.volume - 0.05);
          setVolume(video.volume);
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          toggleMute();
          break;
        case 'c':
        case 'C':
          e.preventDefault();
          toggleCaptions();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          toggleFullscreen();
          break;
        case '?':
          e.preventDefault();
          setShowShortcuts((v) => !v);
          break;
        case 'Escape':
          if (showShortcuts) {
            e.preventDefault();
            setShowShortcuts(false);
          }
          break;
        case ',':
          e.preventDefault();
          {
            const speeds = PLAYBACK_SPEEDS as readonly number[];
            const idx = speeds.indexOf(speed);
            const prev = idx > 0 ? speeds[idx - 1] : undefined;
            if (prev !== undefined) changeSpeed(prev);
          }
          break;
        case '.':
          e.preventDefault();
          {
            const speeds = PLAYBACK_SPEEDS as readonly number[];
            const idx = speeds.indexOf(speed);
            const next = idx >= 0 && idx < speeds.length - 1 ? speeds[idx + 1] : undefined;
            if (next !== undefined) changeSpeed(next);
          }
          break;
      }
      scheduleHideControls();
    },
    [
      duration,
      speed,
      showShortcuts,
      togglePlay,
      toggleMute,
      toggleCaptions,
      toggleFullscreen,
      changeSpeed,
      scheduleHideControls,
    ],
  );

  const playedPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      className={`video-player${showControls ? ' video-player--controls-visible' : ''}`}
      onMouseMove={scheduleHideControls}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="region"
      aria-label={title}
      aria-keyshortcuts="Space K ArrowLeft ArrowRight ArrowUp ArrowDown J L M C F ? , ."
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        preload="metadata"
        crossOrigin="anonymous"
        onClick={togglePlay}
        onPlay={() => { setPlaying(true); scheduleHideControls(); }}
        onPause={() => { setPlaying(false); setShowControls(true); }}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={() => {
          if (videoRef.current) setDuration(videoRef.current.duration);
        }}
        className="video-player__video"
      >
        {subtitleTracks?.map((track) => (
          <track
            key={track.language}
            kind="subtitles"
            srcLang={track.language}
            src={track.src}
            label={track.label}
            default={
              activeSubtitle ? activeSubtitle === track.language : track.isDefault
            }
          />
        ))}
      </video>

      {/* Hidden audio element per traccia dubbed. Solo uno alla volta
          attivo: cambiamo src quando l'utente switcha lingua. Resta in
          sync via i listener nel useEffect [activeAudio] sopra. */}
      {audioTracks && audioTracks.length > 0 && (
        <audio
          ref={dubbedAudioRef}
          src={
            activeAudio !== 'original'
              ? audioTracks.find((a) => a.language === activeAudio)?.src
              : undefined
          }
          preload="auto"
          /* niente crossOrigin: il blob storage Azure non ha CORS
             attivo per il nostro origin, l'audio resterebbe muto in
             silenzio. Per la sola playback non serve. */
          style={{ display: 'none' }}
          aria-hidden="true"
        />
      )}

      {/* Banner AI Act Art. 50 quando l'utente sta ascoltando audio
          sintetico — discoverabile, persistente (non un toast), non
          intrusivo (sopra il video, semitrasparente). */}
      {activeAudio !== 'original' &&
        audioTracks?.find((a) => a.language === activeAudio)?.isSynthetic && (
          <div
            role="note"
            className="video-player__ai-banner"
            style={{
              position: 'absolute',
              top: 8,
              left: 8,
              right: 8,
              background: 'rgba(0,40,80,0.85)',
              color: '#fff',
              padding: '6px 12px',
              borderRadius: 4,
              fontSize: 13,
              zIndex: 5,
              pointerEvents: 'none',
            }}
          >
            {t('audioSyntheticBanner')}
          </div>
        )}

      {/* Keyboard shortcuts help button (top-right) + popover. Sempre
          visibile (anche con controlli nascosti) per essere
          discoverabile; il popover si chiude con Esc o clic sul
          backdrop. */}
      <button
        type="button"
        className="video-player__help-btn"
        onClick={() => setShowShortcuts((v) => !v)}
        aria-label={
          showShortcuts ? t('shortcutsHelpClose') : t('shortcutsHelpOpen')
        }
        aria-expanded={showShortcuts}
        aria-controls="video-player-shortcuts-popover"
        title={t('shortcutsHelpOpen')}
      >
        <span aria-hidden="true" style={{ fontWeight: 700 }}>?</span>
      </button>

      {showShortcuts && (
        <div
          id="video-player-shortcuts-popover"
          role="dialog"
          aria-label={t('shortcutsTitle')}
          className="video-player__shortcuts"
        >
          <div className="video-player__shortcuts-header">
            <strong>{t('shortcutsTitle')}</strong>
            <button
              type="button"
              className="video-player__shortcuts-close"
              onClick={() => setShowShortcuts(false)}
              aria-label={t('shortcutsHelpClose')}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <dl className="video-player__shortcuts-list">
            <div>
              <dt>
                <kbd>Space</kbd> <span aria-hidden="true">/</span>{' '}
                <kbd>K</kbd>
              </dt>
              <dd>{t('shortcutsSpace')}</dd>
            </div>
            <div>
              <dt>
                <kbd>←</kbd> <kbd>→</kbd>
              </dt>
              <dd>{t('shortcutsArrowsLR')}</dd>
            </div>
            <div>
              <dt>
                <kbd>J</kbd> <kbd>L</kbd>
              </dt>
              <dd>{t('shortcutsJL')}</dd>
            </div>
            <div>
              <dt>
                <kbd>↑</kbd> <kbd>↓</kbd>
              </dt>
              <dd>{t('shortcutsArrowsUD')}</dd>
            </div>
            <div>
              <dt>
                <kbd>M</kbd>
              </dt>
              <dd>{t('shortcutsM')}</dd>
            </div>
            <div>
              <dt>
                <kbd>C</kbd>
              </dt>
              <dd>{t('shortcutsC')}</dd>
            </div>
            <div>
              <dt>
                <kbd>F</kbd>
              </dt>
              <dd>{t('shortcutsF')}</dd>
            </div>
            <div>
              <dt>
                <kbd>,</kbd> <kbd>.</kbd>
              </dt>
              <dd>{t('shortcutsSpeed')}</dd>
            </div>
          </dl>
        </div>
      )}

      {/* Large centered play overlay when paused */}
      {!playing && (
        <button
          className="video-player__play-overlay"
          onClick={togglePlay}
          aria-label={t('play')}
          type="button"
        >
          <svg width="68" height="68" viewBox="0 0 68 68" fill="none">
            <circle cx="34" cy="34" r="34" fill="rgba(0,0,0,0.5)" />
            <path d="M27 20L50 34L27 48V20Z" fill="white" />
          </svg>
        </button>
      )}

      {/* Controls bar */}
      <div className="video-player__controls">
        {/* Progress bar */}
        <div
          ref={progressRef}
          className="video-player__progress"
          onClick={handleSeek}
          role="slider"
          aria-label={t('progress')}
          aria-valuenow={Math.round(currentTime)}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          tabIndex={0}
        >
          <div
            className="video-player__progress-buffered"
            style={{ width: `${bufferedPct}%` }}
          />
          <div
            className="video-player__progress-played"
            style={{ width: `${playedPct}%` }}
          />
        </div>

        <div className="video-player__controls-row">
          {/* Play/Pause */}
          <button
            className="video-player__btn"
            onClick={togglePlay}
            aria-label={playing ? t('pause') : t('play')}
            type="button"
          >
            {playing ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Volume */}
          <button
            className="video-player__btn"
            onClick={toggleMute}
            aria-label={muted ? t('unmute') : t('mute')}
            type="button"
          >
            {muted || volume === 0 ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                <path d="M3.63 3.63a.996.996 0 000 1.41L7.29 8.7 7 9H4c-.55 0-1 .45-1 1v4c0 .55.45 1 1 1h3l3.29 3.29c.63.63 1.71.18 1.71-.71v-4.17l4.18 4.18c-.49.37-1.02.68-1.6.91-.36.15-.58.53-.58.92 0 .72.73 1.18 1.39.91.8-.33 1.55-.77 2.22-1.31l1.34 1.34a.996.996 0 101.41-1.41L5.05 3.63c-.39-.39-1.02-.39-1.42 0zM19 12c0 .82-.15 1.61-.41 2.34l1.53 1.53c.56-1.17.88-2.48.88-3.87 0-3.83-2.4-7.11-5.78-8.4-.59-.23-1.22.23-1.22.86v.19c0 .38.25.71.61.85C17.18 6.54 19 9.06 19 12zm-8.71-6.29l-.17.17L12 7.76V6.41c0-.89-1.08-1.33-1.71-.7zM16.5 12A4.5 4.5 0 0014 7.97v1.79l2.48 2.48c.01-.08.02-.16.02-.24z" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 7.97v8.05c1.48-.73 2.5-2.25 2.5-3.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
              </svg>
            )}
          </button>

          <input
            type="range"
            className="video-player__volume-slider"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={handleVolumeChange}
            aria-label={t('volume')}
          />

          {/* Time */}
          <span className="video-player__time">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          <div className="video-player__spacer" />

          {/* Audio track selector (lingua audio doppiata) */}
          {audioTracks && audioTracks.length > 0 && (
            <div className="video-player__speed-wrapper">
              <button
                className="video-player__btn"
                onClick={() => setShowAudioMenu((v) => !v)}
                aria-label={t('audioLabel')}
                aria-expanded={showAudioMenu}
                type="button"
                title={t('audioLabel')}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                  <path d="M12 3c-4.97 0-9 4.03-9 9v7c0 1.1.9 2 2 2h4v-8H5v-1c0-3.87 3.13-7 7-7s7 3.13 7 7v1h-4v8h4c1.1 0 2-.9 2-2v-7c0-4.97-4.03-9-9-9z" />
                </svg>
                {activeAudio !== 'original' && (
                  <span
                    className="video-player__speed-badge"
                    style={{ marginLeft: 6 }}
                  >
                    {activeAudio.toUpperCase()}
                  </span>
                )}
              </button>
              {showAudioMenu && (
                <div
                  className="video-player__speed-menu"
                  role="listbox"
                  aria-label={t('audioLabel')}
                >
                  <button
                    key="original"
                    className={`video-player__speed-option${activeAudio === 'original' ? ' video-player__speed-option--active' : ''}`}
                    onClick={() => {
                      setActiveAudio('original');
                      setShowAudioMenu(false);
                      onAudioChange?.('original');
                    }}
                    role="option"
                    aria-selected={activeAudio === 'original'}
                    type="button"
                  >
                    {t('audioOriginal')}
                  </button>
                  {audioTracks.map((track) => (
                    <button
                      key={track.language}
                      className={`video-player__speed-option${activeAudio === track.language ? ' video-player__speed-option--active' : ''}`}
                      onClick={() => {
                        setActiveAudio(track.language);
                        setShowAudioMenu(false);
                        onAudioChange?.(track.language);
                      }}
                      role="option"
                      aria-selected={activeAudio === track.language}
                      type="button"
                    >
                      {track.label}
                      {track.isSynthetic && (
                        <span
                          aria-label={t('audioSyntheticHint')}
                          title={t('audioSyntheticHint')}
                          className="video-player__ai-tag"
                        >
                          AI
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Subtitle (CC) selector */}
          {subtitleTracks && subtitleTracks.length > 0 && (
            <div className="video-player__speed-wrapper">
              <button
                className="video-player__btn"
                onClick={() => setShowSubtitleMenu((v) => !v)}
                aria-label={t('subtitles')}
                aria-expanded={showSubtitleMenu}
                type="button"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                  <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V6h16v12zM6 10h2v2H6zm0 4h8v2H6zm10 0h2v2h-2zm-6-4h8v2h-8z" />
                </svg>
                {activeSubtitle && (
                  <span
                    className="video-player__speed-badge"
                    style={{ marginLeft: 6 }}
                  >
                    {activeSubtitle.toUpperCase()}
                  </span>
                )}
              </button>
              {showSubtitleMenu && (
                <div
                  className="video-player__speed-menu"
                  role="listbox"
                  aria-label={t('subtitles')}
                >
                  <button
                    key="off"
                    className={`video-player__speed-option${activeSubtitle === null ? ' video-player__speed-option--active' : ''}`}
                    onClick={() => {
                      setActiveSubtitle(null);
                      setShowSubtitleMenu(false);
                      onSubtitleChange?.(null);
                    }}
                    role="option"
                    aria-selected={activeSubtitle === null}
                    type="button"
                  >
                    {t('subtitlesOff')}
                  </button>
                  {subtitleTracks.map((track) => (
                    <button
                      key={track.language}
                      className={`video-player__speed-option${activeSubtitle === track.language ? ' video-player__speed-option--active' : ''}`}
                      onClick={() => {
                        setActiveSubtitle(track.language);
                        setShowSubtitleMenu(false);
                        onSubtitleChange?.(track.language);
                      }}
                      role="option"
                      aria-selected={activeSubtitle === track.language}
                      type="button"
                    >
                      {track.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Speed selector */}
          <div className="video-player__speed-wrapper">
            <button
              className="video-player__btn"
              onClick={() => setShowSpeedMenu((v) => !v)}
              aria-label={t('speedLabel')}
              aria-expanded={showSpeedMenu}
              type="button"
            >
              {speed !== 1 && (
                <span className="video-player__speed-badge">{speed}x</span>
              )}
              {speed === 1 && (
                <span className="video-player__speed-text">1x</span>
              )}
            </button>
            {showSpeedMenu && (
              <div className="video-player__speed-menu" role="listbox" aria-label={t('speedLabel')}>
                {PLAYBACK_SPEEDS.map((s) => (
                  <button
                    key={s}
                    className={`video-player__speed-option${s === speed ? ' video-player__speed-option--active' : ''}`}
                    onClick={() => changeSpeed(s)}
                    role="option"
                    aria-selected={s === speed}
                    type="button"
                  >
                    {s}x
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* PiP */}
          {pipSupported && (
            <button
              className="video-player__btn"
              onClick={togglePip}
              aria-label={t('pip')}
              type="button"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                <path d="M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z" />
              </svg>
            </button>
          )}

          {/* Fullscreen */}
          <button
            className="video-player__btn"
            onClick={toggleFullscreen}
            aria-label={t('fullscreen')}
            type="button"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
              <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  VideoPlayerImpl,
);
VideoPlayer.displayName = 'VideoPlayer';

export default VideoPlayer;
