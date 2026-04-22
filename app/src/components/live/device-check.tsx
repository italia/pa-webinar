'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button } from 'design-react-kit';

type PermissionState = 'idle' | 'requesting' | 'granted' | 'denied';

interface DeviceCheckProps {
  /** Called whenever readiness changes. True once mic+camera permission
   *  is granted AND both a video and an audio device are selected. */
  onReady?: (ok: boolean) => void;
  /** true = vertical stacked layout (for narrow containers / mobile).
   *  false = horizontal with a 240x135 preview on the left. */
  compact?: boolean;
}

export default function DeviceCheck({ onReady, compact = false }: DeviceCheckProps) {
  const t = useTranslations('deviceCheck');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const meterRef = useRef<HTMLDivElement | null>(null);
  const disposedRef = useRef(false);

  const [permissionState, setPermissionState] = useState<PermissionState>('idle');
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState<string>('');
  const [selectedAudioId, setSelectedAudioId] = useState<string>('');

  const stopStream = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const attachMeter = useCallback((stream: MediaStream) => {
    try {
      const AudioCtx = window.AudioContext
        || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      analyserRef.current = analyser;

      const buffer = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        if (disposedRef.current || !analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i += 1) sum += buffer[i] ?? 0;
        const avg = sum / buffer.length; // 0..255
        const pct = Math.min(100, Math.round((avg / 128) * 100));
        if (meterRef.current) {
          meterRef.current.style.width = `${pct}%`;
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();
    } catch {
      /* meter is nice-to-have; ignore failures */
    }
  }, []);

  const applyStream = useCallback(async (stream: MediaStream) => {
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.muted = true;
      try {
        await videoRef.current.play();
      } catch {
        /* autoplay may be blocked; fine — user still sees mic meter */
      }
    }
    attachMeter(stream);
  }, [attachMeter]);

  const requestMedia = useCallback(async (videoId?: string, audioId?: string) => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setPermissionState('denied');
      return;
    }
    setPermissionState('requesting');
    try {
      stopStream();
      const constraints: MediaStreamConstraints = {
        video: videoId ? { deviceId: { exact: videoId } } : true,
        audio: audioId ? { deviceId: { exact: audioId } } : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (disposedRef.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      await applyStream(stream);

      const all = await navigator.mediaDevices.enumerateDevices();
      const cams = all.filter((d) => d.kind === 'videoinput');
      const mics = all.filter((d) => d.kind === 'audioinput');
      setVideoDevices(cams);
      setAudioDevices(mics);

      const activeVideoTrack = stream.getVideoTracks()[0];
      const activeAudioTrack = stream.getAudioTracks()[0];
      const resolvedVideoId = activeVideoTrack?.getSettings().deviceId ?? cams[0]?.deviceId ?? '';
      const resolvedAudioId = activeAudioTrack?.getSettings().deviceId ?? mics[0]?.deviceId ?? '';
      setSelectedVideoId(resolvedVideoId);
      setSelectedAudioId(resolvedAudioId);

      setPermissionState('granted');
    } catch {
      if (!disposedRef.current) setPermissionState('denied');
    }
  }, [applyStream, stopStream]);

  // Initial permission request on mount.
  useEffect(() => {
    disposedRef.current = false;
    void requestMedia();
    return () => {
      disposedRef.current = true;
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Propagate readiness.
  useEffect(() => {
    const ok = permissionState === 'granted' && !!selectedVideoId && !!selectedAudioId;
    onReady?.(ok);
  }, [permissionState, selectedVideoId, selectedAudioId, onReady]);

  const handleVideoChange = useCallback(async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setSelectedVideoId(id);
    await requestMedia(id, selectedAudioId || undefined);
  }, [requestMedia, selectedAudioId]);

  const handleAudioChange = useCallback(async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setSelectedAudioId(id);
    await requestMedia(selectedVideoId || undefined, id);
  }, [requestMedia, selectedVideoId]);

  const handleRetry = useCallback(() => {
    void requestMedia();
  }, [requestMedia]);

  const previewBox = (
    <div
      className="position-relative bg-dark rounded overflow-hidden device-check-preview"
      style={
        compact
          ? { width: '100%', aspectRatio: '16 / 9' }
          : { width: 240, height: 135, flexShrink: 0 }
      }
    >
      <video
        ref={videoRef}
        playsInline
        muted
        aria-label={t('preview')}
        style={{ width: '100%', height: '100%', objectFit: 'cover', background: '#000' }}
      />
      {permissionState !== 'granted' && (
        <div
          className="position-absolute top-50 start-50 translate-middle text-white-50 small text-center px-2"
          aria-live="polite"
        >
          {t('noVideo')}
        </div>
      )}
    </div>
  );

  const controls = (
    <div className="flex-grow-1">
      <div className="mb-2">
        <label htmlFor="device-check-camera" className="form-label small mb-1">
          {t('cameraLabel')}
        </label>
        <select
          id="device-check-camera"
          className="form-select form-select-sm"
          value={selectedVideoId}
          onChange={handleVideoChange}
          disabled={permissionState !== 'granted'}
        >
          {videoDevices.length === 0 && <option value="">—</option>}
          {videoDevices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || t('cameraLabel')}
            </option>
          ))}
        </select>
      </div>
      <div className="mb-2">
        <label htmlFor="device-check-mic" className="form-label small mb-1">
          {t('micLabel')}
        </label>
        <select
          id="device-check-mic"
          className="form-select form-select-sm"
          value={selectedAudioId}
          onChange={handleAudioChange}
          disabled={permissionState !== 'granted'}
        >
          {audioDevices.length === 0 && <option value="">—</option>}
          {audioDevices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || t('micLabel')}
            </option>
          ))}
        </select>
      </div>
      <div>
        <div className="small mb-1 text-muted">{t('micLevel')}</div>
        <div
          className="rounded"
          style={{
            width: '100%',
            height: 8,
            background: '#e9ecef',
            overflow: 'hidden',
          }}
          role="meter"
          aria-label={t('micLevel')}
        >
          <div
            ref={meterRef}
            style={{
              width: '0%',
              height: '100%',
              background: 'linear-gradient(90deg, #4caf50 0%, #ffc107 70%, #dc3545 100%)',
              transition: 'width 60ms linear',
            }}
          />
        </div>
        {permissionState === 'granted' && !streamRef.current?.getAudioTracks()[0] && (
          <div className="small text-muted mt-1">{t('noAudio')}</div>
        )}
      </div>
    </div>
  );

  return (
    <div className="device-check">
      {permissionState === 'denied' && (
        <Alert color="warning" className="mb-3">
          <div className="d-flex flex-column gap-2">
            <span>{t('permissionNeeded')}</span>
            <div>
              <Button color="primary" size="xs" onClick={handleRetry}>
                {t('retry')}
              </Button>
            </div>
          </div>
        </Alert>
      )}

      <div className={compact ? 'd-flex flex-column gap-2' : 'd-flex flex-column flex-md-row gap-3'}>
        {previewBox}
        {controls}
      </div>
    </div>
  );
}
