'use client';

import { useRef, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Spinner } from 'design-react-kit';

import type { JitsiMeetExternalAPI as JitsiAPI } from '@/types/jitsi';
import {
  jitsiConfigOverwrite,
  jitsiInterfaceConfigOverwrite,
  baseToolbarButtons,
  moderatorToolbarButtons,
} from '@/lib/jitsi/config';

interface JitsiRoomProps {
  domain: string;
  roomName: string;
  jwt: string;
  displayName: string;
  locale: string;
  role: 'moderator' | 'participant';
  onReady?: () => void;
  onLeft?: () => void;
  onParticipantCountChanged?: (count: number) => void;
  onRecordingStatusChanged?: (isRecording: boolean) => void;
  onApiReady?: (api: JitsiAPI) => void;
}

type LoadState = 'loading' | 'ready' | 'error';

const WATERMARK_URL =
  process.env.NEXT_PUBLIC_WATERMARK_URL || '/images/dtd-watermark.svg';

export default function JitsiRoom({
  domain,
  roomName,
  jwt,
  displayName,
  locale,
  role,
  onReady,
  onLeft,
  onParticipantCountChanged,
  onRecordingStatusChanged,
  onApiReady,
}: JitsiRoomProps) {
  const t = useTranslations('live');
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<JitsiAPI | null>(null);
  const initializingRef = useRef(false);
  const disposedRef = useRef(false);
  const [loadState, setLoadState] = useState<LoadState>('loading');

  const onReadyRef = useRef(onReady);
  const onLeftRef = useRef(onLeft);
  const onParticipantCountChangedRef = useRef(onParticipantCountChanged);
  const onRecordingStatusChangedRef = useRef(onRecordingStatusChanged);
  const onApiReadyRef = useRef(onApiReady);

  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  useEffect(() => { onLeftRef.current = onLeft; }, [onLeft]);
  useEffect(() => { onParticipantCountChangedRef.current = onParticipantCountChanged; }, [onParticipantCountChanged]);
  useEffect(() => { onRecordingStatusChangedRef.current = onRecordingStatusChanged; }, [onRecordingStatusChanged]);
  useEffect(() => { onApiReadyRef.current = onApiReady; }, [onApiReady]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    disposedRef.current = false;

    const toolbarButtons = role === 'moderator'
      ? [...moderatorToolbarButtons]
      : [...baseToolbarButtons];

    function initJitsi() {
      if (disposedRef.current || initializingRef.current || apiRef.current) return;
      if (!containerRef.current || !window.JitsiMeetExternalAPI) return;

      initializingRef.current = true;

      try {
        const api = new window.JitsiMeetExternalAPI(domain, {
          roomName,
          jwt,
          parentNode: containerRef.current,
          width: '100%',
          height: '100%',
          lang: locale,
          configOverwrite: {
            ...jitsiConfigOverwrite,
            toolbarButtons,
          },
          interfaceConfigOverwrite: {
            ...jitsiInterfaceConfigOverwrite,
            TOOLBAR_BUTTONS: toolbarButtons,
          },
          userInfo: { displayName },
        });

        apiRef.current = api;
        onApiReadyRef.current?.(api);

        api.addListener('videoConferenceJoined', () => {
          setLoadState('ready');
          onReadyRef.current?.();
        });

        api.addListener('videoConferenceLeft', () => {
          onLeftRef.current?.();
        });

        api.addListener('participantJoined', () => {
          onParticipantCountChangedRef.current?.(api.getNumberOfParticipants());
        });

        api.addListener('participantLeft', () => {
          onParticipantCountChangedRef.current?.(api.getNumberOfParticipants());
        });

        api.addListener('recordingStatusChanged', (evt: { on: boolean }) => {
          onRecordingStatusChangedRef.current?.(evt.on);
        });
      } catch {
        setLoadState('error');
        initializingRef.current = false;
      }
    }

    if (window.JitsiMeetExternalAPI) {
      initJitsi();
    } else {
      const existingScript = document.querySelector(
        `script[src*="external_api.js"]`,
      ) as HTMLScriptElement | null;

      if (existingScript) {
        existingScript.addEventListener('load', initJitsi);
      } else {
        const script = document.createElement('script');
        script.src = `https://${domain}/external_api.js`;
        script.async = true;
        script.onload = initJitsi;
        script.onerror = () => setLoadState('error');
        document.head.appendChild(script);
      }
    }

    return () => {
      disposedRef.current = true;
      initializingRef.current = false;
      if (apiRef.current) {
        apiRef.current.dispose();
        apiRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, roomName, jwt, displayName, locale, role]);

  return (
    <div
      className="jitsi-container position-relative"
      style={{
        width: '100%',
        height: '100%',
        minHeight: '400px',
        background: '#000',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      {loadState === 'loading' && (
        <div className="position-absolute top-50 start-50 translate-middle text-center">
          <Spinner active double />
          <p className="mt-3 text-white-50">{t('connecting')}</p>
        </div>
      )}

      {loadState === 'error' && (
        <div
          className="position-absolute top-50 start-50 translate-middle"
          style={{ width: '90%', maxWidth: '500px' }}
        >
          <Alert color="danger">{t('connectionError')}</Alert>
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

      {loadState === 'ready' && (
        <img
          src={WATERMARK_URL}
          alt=""
          aria-hidden="true"
          style={{
            position: 'absolute',
            bottom: 16,
            left: 16,
            width: 80,
            pointerEvents: 'none',
            zIndex: 10,
            opacity: 0.6,
          }}
        />
      )}
    </div>
  );
}
