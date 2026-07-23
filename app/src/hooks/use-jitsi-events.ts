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
 *
 * `humanParticipantCount` is called without the local identity here: this hook
 * only has the API handle, and the roster of the external_api.js we serve DOES
 * include the local user (see lib/jitsi/participants.ts), so the count is right
 * without it. JitsiRoom passes name + endpoint id because it has them and that
 * makes the count exact under BOTH roster shapes; if a Jitsi bump ever removes
 * the local row, this consumer — currently only ModeratorControls — would
 * under-report by one and should be given the same arguments.
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
