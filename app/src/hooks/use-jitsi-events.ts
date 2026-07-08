'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

import type { JitsiMeetExternalAPI } from '@/types/jitsi';
import { humanParticipantCount } from '@/lib/jitsi/participants';

interface JitsiEventsState {
  participantCount: number;
  isRecording: boolean;
  isAudioMuted: boolean;
  isVideoMuted: boolean;
}

/**
 * Subscribes to JitsiMeetExternalAPI events and exposes reactive state.
 * Cleans up all listeners on unmount or when the API instance changes.
 */
export function useJitsiEvents(api: JitsiMeetExternalAPI | null): JitsiEventsState {
  const [participantCount, setParticipantCount] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isAudioMuted, setIsAudioMuted] = useState(true);
  const [isVideoMuted, setIsVideoMuted] = useState(true);

  const cleanupRef = useRef<(() => void) | null>(null);

  const apiRef = useRef(api);
  useEffect(() => { apiRef.current = api; }, [api]);

  const onParticipantJoined = useCallback(() => {
    if (apiRef.current) {
      setParticipantCount(humanParticipantCount(apiRef.current));
    }
  }, []);

  const onParticipantLeft = useCallback(() => {
    if (apiRef.current) {
      setParticipantCount(humanParticipantCount(apiRef.current));
    }
  }, []);

  const onRecordingStatusChanged = useCallback(
    (event: { on: boolean; mode: string }) => {
      setIsRecording(event.on);
    },
    [],
  );

  const onAudioMuteStatusChanged = useCallback(
    (event: { muted: boolean }) => {
      setIsAudioMuted(event.muted);
    },
    [],
  );

  const onVideoMuteStatusChanged = useCallback(
    (event: { muted: boolean }) => {
      setIsVideoMuted(event.muted);
    },
    [],
  );

  useEffect(() => {
    if (!api) return;

    const count = humanParticipantCount(api);
    setParticipantCount(count);

    api.addListener('participantJoined', onParticipantJoined);
    api.addListener('participantLeft', onParticipantLeft);
    api.addListener('recordingStatusChanged', onRecordingStatusChanged);
    api.addListener('audioMuteStatusChanged', onAudioMuteStatusChanged);
    api.addListener('videoMuteStatusChanged', onVideoMuteStatusChanged);

    cleanupRef.current = () => {
      api.removeListener('participantJoined', onParticipantJoined);
      api.removeListener('participantLeft', onParticipantLeft);
      api.removeListener('recordingStatusChanged', onRecordingStatusChanged);
      api.removeListener('audioMuteStatusChanged', onAudioMuteStatusChanged);
      api.removeListener('videoMuteStatusChanged', onVideoMuteStatusChanged);
    };

    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [
    api,
    onParticipantJoined,
    onParticipantLeft,
    onRecordingStatusChanged,
    onAudioMuteStatusChanged,
    onVideoMuteStatusChanged,
  ]);

  return { participantCount, isRecording, isAudioMuted, isVideoMuted };
}
