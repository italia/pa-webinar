'use client';

import { useState, useEffect, useRef } from 'react';

import type { JitsiMeetExternalAPI, JitsiConnectionStats } from '@/types/jitsi';

export interface JitsiStatsState {
  connectionQuality: number | null;
  downloadBitrate: number | null;
  uploadBitrate: number | null;
  packetLoss: number | null;
  jvbRtt: number | null;
  resolution: { width: number; height: number } | null;
  framerate: number | null;
  transport: string | null;
  raw: JitsiConnectionStats | null;
}

const INITIAL_STATE: JitsiStatsState = {
  connectionQuality: null,
  downloadBitrate: null,
  uploadBitrate: null,
  packetLoss: null,
  jvbRtt: null,
  resolution: null,
  framerate: null,
  transport: null,
  raw: null,
};

/**
 * Polls Jitsi IFrame API for WebRTC connection quality stats.
 * Provides reactive state for UI indicators (quality badge, bitrate, etc.).
 *
 * @param api  - JitsiMeetExternalAPI instance (or null before ready)
 * @param intervalMs - polling interval in ms (default 5000)
 */
export function useJitsiStats(
  api: JitsiMeetExternalAPI | null,
  intervalMs = 5000,
): JitsiStatsState {
  const [stats, setStats] = useState<JitsiStatsState>(INITIAL_STATE);
  const apiRef = useRef(api);
  useEffect(() => { apiRef.current = api; }, [api]);

  useEffect(() => {
    if (!api) {
      setStats(INITIAL_STATE);
      return;
    }

    let cancelled = false;

    const poll = async () => {
      if (cancelled || !apiRef.current) return;
      try {
        const raw = await apiRef.current.getConnectionQuality();
        if (cancelled || !raw) return;

        const resolutionEntries = raw.resolution ? Object.values(raw.resolution) : [];
        const localRes = resolutionEntries[0] ?? null;
        const framerateEntries = raw.framerate ? Object.values(raw.framerate) : [];
        const localFps = framerateEntries[0] ?? null;

        setStats({
          connectionQuality: raw.connectionQuality ?? null,
          downloadBitrate: raw.bitrate?.download ?? null,
          uploadBitrate: raw.bitrate?.upload ?? null,
          packetLoss: raw.packetLoss?.total ?? null,
          jvbRtt: raw.jvbRTT ?? null,
          resolution: localRes && localRes.width && localRes.height
            ? { width: localRes.width, height: localRes.height }
            : null,
          framerate: typeof localFps === 'number' ? localFps : null,
          transport: raw.transport?.[0]?.type ?? null,
          raw,
        });
      } catch {
        // getConnectionQuality may not be available on all Jitsi versions
      }
    };

    poll();
    const id = setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [api, intervalMs]);

  return stats;
}

/** Map connectionQuality (0-100) to a human-readable label. */
export function qualityLabel(quality: number | null): 'good' | 'medium' | 'poor' | 'unknown' {
  if (quality === null) return 'unknown';
  if (quality >= 70) return 'good';
  if (quality >= 30) return 'medium';
  return 'poor';
}

/** Map quality label to a Bootstrap Italia compatible color. */
export function qualityColor(quality: number | null): string {
  const label = qualityLabel(quality);
  switch (label) {
    case 'good': return '#008758';
    case 'medium': return '#A66300';
    case 'poor': return '#CC334D';
    default: return '#8899AA';
  }
}
