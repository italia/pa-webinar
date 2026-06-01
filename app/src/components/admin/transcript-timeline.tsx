'use client';

/**
 * Waveform + segment timeline for the admin transcript editor.
 *
 * Renders the recording's pre-computed amplitude envelope (WAVEFORM_JSON
 * artifact) as a canvas, with a speaker-coloured band showing diarization
 * turns and a playhead synced to an embedded <audio> element. Clicking
 * anywhere seeks; the active segment under the playhead is reported up so
 * the editor can highlight + scroll to the matching row.
 *
 * When no waveform is available (older recordings) it degrades to a
 * segment-only band — still a usable timeline.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { speakerColor } from '@/lib/utils/speaker-palette';

export interface Waveform {
  version: number;
  duration: number;
  buckets: number;
  peaks: number[];
}

export interface TimelineSegment {
  index: number;
  start: number;
  end: number;
  speaker: string | null;
}

export interface TimelineControls {
  seekTo: (seconds: number) => void;
}

const HEIGHT = 80;
const BAND_HEIGHT = 10; // speaker turn strip at the bottom
const WAVE_TOP = 4;

function fmt(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export default function TranscriptTimeline({
  mediaUrl,
  waveform,
  segments,
  durationSec,
  identityFor,
  controlsRef,
  onActiveIndexChange,
}: {
  mediaUrl: string;
  waveform: Waveform | null;
  segments: TimelineSegment[];
  durationSec: number | null;
  /** Map a diar label to the identity used for colouring (displayName ?? label). */
  identityFor: (speaker: string | null) => string | null;
  controlsRef: React.MutableRefObject<TimelineControls | null>;
  onActiveIndexChange?: (index: number) => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [current, setCurrent] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const lastActive = useRef<number>(-2);

  // Best available duration: waveform metadata, DB column, then the
  // audio element once it loads. Guards against a 0 that would make the
  // time↔pixel mapping divide by zero.
  const duration = audioDuration || waveform?.duration || durationSec || 0;

  // Expose imperative seek to the parent (segment rows call this).
  const seekTo = useCallback((seconds: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.max(0, seconds);
    setCurrent(a.currentTime);
    void a.play().catch(() => {
      // autoplay may be blocked — fine, the seek still landed
    });
  }, []);
  useEffect(() => {
    controlsRef.current = { seekTo };
    return () => {
      controlsRef.current = null;
    };
  }, [controlsRef, seekTo]);

  // Track the rendered width (responsive + crisp on HiDPI).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth(Math.floor(w));
    });
    ro.observe(el);
    setWidth(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);

  // Report the active segment (last one whose [start,end) contains the
  // playhead) only when it changes, so the parent isn't spammed.
  useEffect(() => {
    let active = -1;
    for (const seg of segments) {
      if (current >= seg.start && current < seg.end) active = seg.index;
    }
    if (active !== lastActive.current) {
      lastActive.current = active;
      onActiveIndexChange?.(active);
    }
  }, [current, segments, onActiveIndexChange]);

  // Draw the canvas whenever inputs change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(HEIGHT * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);

    const waveBottom = HEIGHT - BAND_HEIGHT - 2;
    const waveHeight = waveBottom - WAVE_TOP;
    const mid = WAVE_TOP + waveHeight / 2;

    // Waveform (neutral) — mirrored bars around the vertical midline.
    const peaks = waveform?.peaks ?? [];
    if (peaks.length > 0) {
      ctx.fillStyle = '#9bb4c9';
      const barW = width / peaks.length;
      for (let i = 0; i < peaks.length; i += 1) {
        const h = Math.max(1, (peaks[i] ?? 0) * waveHeight);
        const x = i * barW;
        ctx.fillRect(x, mid - h / 2, Math.max(0.5, barW - 0.3), h);
      }
    } else {
      // No waveform: a faint baseline so the band still has context.
      ctx.strokeStyle = '#d6e3f1';
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(width, mid);
      ctx.stroke();
    }

    // Speaker-turn band along the bottom.
    if (duration > 0) {
      const bandY = HEIGHT - BAND_HEIGHT;
      for (const seg of segments) {
        const x = (seg.start / duration) * width;
        const w = Math.max(1, ((seg.end - seg.start) / duration) * width);
        ctx.fillStyle = speakerColor(identityFor(seg.speaker)).color;
        ctx.fillRect(x, bandY, w, BAND_HEIGHT);
      }
    }

    // Playhead.
    if (duration > 0) {
      const px = (current / duration) * width;
      ctx.strokeStyle = '#17324d';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, HEIGHT);
      ctx.stroke();
    }
  }, [width, current, duration, waveform, segments, identityFor]);

  function onCanvasClick(e: React.MouseEvent<HTMLCanvasElement>): void {
    if (duration <= 0 || width <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    seekTo((x / width) * duration);
  }

  return (
    <div className="mb-3">
      <div
        ref={wrapRef}
        style={{ position: 'relative', width: '100%', height: HEIGHT, cursor: 'pointer' }}
      >
        <canvas
          ref={canvasRef}
          onClick={onCanvasClick}
          style={{ width: '100%', height: HEIGHT, display: 'block' }}
        />
      </div>
      <div className="d-flex align-items-center gap-2 mt-1">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- raw recording playback, captions live in the transcript itself */}
        <audio
          ref={audioRef}
          src={mediaUrl}
          controls
          preload="metadata"
          style={{ height: 32, flex: 1 }}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d)) setAudioDuration(d);
          }}
          onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
          onSeeked={(e) => setCurrent(e.currentTarget.currentTime)}
        />
        <span className="small text-secondary text-nowrap" style={{ minWidth: 96 }}>
          {fmt(current)} / {fmt(duration)}
        </span>
      </div>
    </div>
  );
}
