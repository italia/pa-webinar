'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Spinner } from 'design-react-kit';

import type { JitsiMeetExternalAPI as JitsiAPI } from '@/types/jitsi';
import {
  jitsiConfigOverwrite,
  jitsiInterfaceConfigOverwrite,
} from '@/lib/jitsi/config';

interface JitsiRoomProps {
  domain: string;
  roomName: string;
  jwt: string;
  displayName: string;
  locale: string;
  onReady?: () => void;
  onLeft?: () => void;
  onParticipantCountChanged?: (count: number) => void;
  onRecordingStatusChanged?: (isRecording: boolean) => void;
  onApiReady?: (api: JitsiAPI) => void;
}

type LoadState = 'loading' | 'ready' | 'error';

export default function JitsiRoom({
  domain,
  roomName,
  jwt,
  displayName,
  locale,
  onReady,
  onLeft,
  onParticipantCountChanged,
  onRecordingStatusChanged,
  onApiReady,
}: JitsiRoomProps) {
  const t = useTranslations('live');
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<JitsiAPI | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');

  const initJitsi = useCallback(() => {
    if (!containerRef.current || !window.JitsiMeetExternalAPI) return;

    try {
      const api = new window.JitsiMeetExternalAPI(domain, {
        roomName,
        jwt,
        parentNode: containerRef.current,
        width: '100%',
        height: '100%',
        lang: locale,
        configOverwrite: { ...jitsiConfigOverwrite },
        interfaceConfigOverwrite: { ...jitsiInterfaceConfigOverwrite },
        userInfo: { displayName },
      });

      apiRef.current = api;
      onApiReady?.(api);

      api.addListener('videoConferenceJoined', () => {
        setLoadState('ready');
        onReady?.();
      });

      api.addListener('videoConferenceLeft', () => {
        onLeft?.();
      });

      api.addListener('participantJoined', () => {
        onParticipantCountChanged?.(api.getNumberOfParticipants());
      });

      api.addListener('participantLeft', () => {
        onParticipantCountChanged?.(api.getNumberOfParticipants());
      });

      api.addListener('recordingStatusChanged', (evt: { on: boolean }) => {
        onRecordingStatusChanged?.(evt.on);
      });
    } catch {
      setLoadState('error');
    }
  }, [domain, roomName, jwt, displayName, locale, onReady, onLeft, onParticipantCountChanged, onRecordingStatusChanged, onApiReady]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (window.JitsiMeetExternalAPI) {
      initJitsi();
      return;
    }

    const script = document.createElement('script');
    script.src = `https://${domain}/external_api.js`;
    script.async = true;

    script.onload = () => {
      initJitsi();
    };

    script.onerror = () => {
      setLoadState('error');
    };

    document.head.appendChild(script);

    return () => {
      apiRef.current?.dispose();
      apiRef.current = null;
    };
  }, [domain, initJitsi]);

  return (
    <div className="position-relative" style={{ width: '100%', height: 'calc(100vh - 160px)', minHeight: '400px' }}>
      {loadState === 'loading' && (
        <div className="position-absolute top-50 start-50 translate-middle text-center">
          <Spinner active double />
          <p className="mt-3 text-muted">{t('connecting')}</p>
        </div>
      )}

      {loadState === 'error' && (
        <div className="position-absolute top-50 start-50 translate-middle" style={{ width: '90%', maxWidth: '500px' }}>
          <Alert color="danger">
            {t('connectionError')}
          </Alert>
        </div>
      )}

      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          opacity: loadState === 'ready' ? 1 : 0,
          transition: 'opacity 0.3s ease',
        }}
      />
    </div>
  );
}

