'use client';

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  type KeyboardEvent,
} from 'react';
import { useTranslations } from 'next-intl';

interface VideoPlayerProps {
  src: string;
  title: string;
  poster?: string;
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

export default function VideoPlayer({ src, title, poster }: VideoPlayerProps) {
  const t = useTranslations('video');
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [pipSupported, setPipSupported] = useState(false);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setPipSupported('pictureInPictureEnabled' in document && document.pictureInPictureEnabled);
  }, []);

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

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const video = videoRef.current;
      if (!video) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          video.currentTime = Math.min(duration, video.currentTime + 10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          video.volume = Math.min(1, video.volume + 0.1);
          setVolume(video.volume);
          break;
        case 'ArrowDown':
          e.preventDefault();
          video.volume = Math.max(0, video.volume - 0.1);
          setVolume(video.volume);
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          toggleFullscreen();
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
    [duration, speed, togglePlay, toggleFullscreen, changeSpeed, scheduleHideControls],
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
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        preload="metadata"
        onClick={togglePlay}
        onPlay={() => { setPlaying(true); scheduleHideControls(); }}
        onPause={() => { setPlaying(false); setShowControls(true); }}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={() => {
          if (videoRef.current) setDuration(videoRef.current.duration);
        }}
        className="video-player__video"
      />

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
