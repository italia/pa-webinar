'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button } from 'design-react-kit';

type PermissionState = 'idle' | 'requesting' | 'granted' | 'denied';

const CAMERA_PREF_KEY = 'pawebinar.deviceCheck.cameraOn';
const MIC_PREF_KEY = 'pawebinar.deviceCheck.micOn';

function readBoolPref(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === '1';
  } catch {
    return fallback;
  }
}

function writeBoolPref(key: string, value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* ignore */
  }
}

interface DeviceCheckProps {
  /** Called whenever readiness changes. True once mic+camera permission
   *  is granted AND both a video and an audio device are selected. */
  onReady?: (ok: boolean) => void;
  /** Called whenever the user toggles camera/mic in the pre-join UI.
   *  Parent wires this into `startWithVideoMuted`/`startWithAudioMuted`
   *  so the choice actually takes effect when the user joins Jitsi. */
  onStateChange?: (s: { cameraOn: boolean; micOn: boolean }) => void;
  /** true = vertical stacked layout (for narrow containers / mobile).
   *  false = horizontal with a 240x135 preview on the left. */
  compact?: boolean;
}

export default function DeviceCheck({ onReady, onStateChange, compact = false }: DeviceCheckProps) {
  const t = useTranslations('deviceCheck');

  const [cameraOn, setCameraOn] = useState<boolean>(() => readBoolPref(CAMERA_PREF_KEY, true));
  const [micOn, setMicOn] = useState<boolean>(() => readBoolPref(MIC_PREF_KEY, true));

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

  // Propagate the camera/mic on-off choice so the caller can forward it
  // as `startWithVideoMuted`/`startWithAudioMuted` when the user joins.
  useEffect(() => {
    onStateChange?.({ cameraOn, micOn });
  }, [cameraOn, micOn, onStateChange]);

  // Apply the camera toggle to the live preview by enabling/disabling
  // the video track. Keeping the stream alive means flipping the switch
  // is instant — no extra `getUserMedia` round-trip.
  useEffect(() => {
    const stream = streamRef.current;
    if (!stream) return;
    for (const track of stream.getVideoTracks()) {
      track.enabled = cameraOn;
    }
  }, [cameraOn, permissionState, selectedVideoId]);

  // Same for the mic: disabling the audio track keeps the VU meter flat
  // without tearing the stream down.
  useEffect(() => {
    const stream = streamRef.current;
    if (!stream) return;
    for (const track of stream.getAudioTracks()) {
      track.enabled = micOn;
    }
  }, [micOn, permissionState, selectedAudioId]);

  const handleCameraToggle = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.checked;
    setCameraOn(next);
    writeBoolPref(CAMERA_PREF_KEY, next);
  }, []);

  const handleMicToggle = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.checked;
    setMicOn(next);
    writeBoolPref(MIC_PREF_KEY, next);
  }, []);

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
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          background: '#000',
          display: cameraOn ? 'block' : 'none',
        }}
      />
      {permissionState !== 'granted' && (
        <div
          className="position-absolute top-50 start-50 translate-middle text-white-50 small text-center px-2"
          aria-live="polite"
        >
          {t('noVideo')}
        </div>
      )}
      {permissionState === 'granted' && !cameraOn && (
        <div
          className="position-absolute top-50 start-50 translate-middle text-white-50 small text-center px-2"
          aria-live="polite"
        >
          {t('cameraOffPreview')}
        </div>
      )}
    </div>
  );

  // The toggles drive two things: the live preview (only active when
  // permission is granted) and the join preference forwarded to Jitsi.
  // We deliberately keep them ENABLED even while the browser is
  // prompting for permission — otherwise on Firefox / browsers with
  // slow permission UIs the user sees the switches greyed out and
  // thinks they are broken.
  const toggles = (
    <div className="d-flex flex-wrap gap-3 mb-3">
      <label
        className="device-check-toggle d-inline-flex align-items-center gap-2"
        htmlFor="device-check-camera-toggle"
      >
        <input
          type="checkbox"
          className="device-check-toggle__input"
          id="device-check-camera-toggle"
          checked={cameraOn}
          onChange={handleCameraToggle}
        />
        <span className="device-check-toggle__track" aria-hidden="true">
          <span className="device-check-toggle__thumb" />
        </span>
        <span className="small fw-semibold">
          {cameraOn ? t('cameraToggleOn') : t('cameraToggleOff')}
        </span>
      </label>
      <label
        className="device-check-toggle d-inline-flex align-items-center gap-2"
        htmlFor="device-check-mic-toggle"
      >
        <input
          type="checkbox"
          className="device-check-toggle__input"
          id="device-check-mic-toggle"
          checked={micOn}
          onChange={handleMicToggle}
        />
        <span className="device-check-toggle__track" aria-hidden="true">
          <span className="device-check-toggle__thumb" />
        </span>
        <span className="small fw-semibold">
          {micOn ? t('micToggleOn') : t('micToggleOff')}
        </span>
      </label>
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
        <div className="mt-2">
          <Button
            color="primary"
            outline
            size="xs"
            onClick={() => {
              // Short chime so the user can confirm their speakers /
              // headphones actually play audio before joining. Several
              // caffettino attendees "didn't hear" the call — probably
              // because they never verified audio output beforehand.
              try {
                const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!)();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.value = 880;
                gain.gain.value = 0.001;
                osc.connect(gain).connect(ctx.destination);
                const t0 = ctx.currentTime;
                gain.gain.exponentialRampToValueAtTime(0.15, t0 + 0.05);
                gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.6);
                osc.start(t0);
                osc.stop(t0 + 0.65);
                osc.onended = () => ctx.close();
              } catch { /* ignore — user can still join */ }
            }}
          >
            {t('speakerTest')}
          </Button>
        </div>
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

      {toggles}

      <div className={compact ? 'd-flex flex-column gap-2' : 'd-flex flex-column flex-md-row gap-3'}>
        {previewBox}
        {controls}
      </div>
    </div>
  );
}
