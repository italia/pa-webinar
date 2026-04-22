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
  mobileBaseToolbarButtons,
  mobileModeratorToolbarButtons,
} from '@/lib/jitsi/config';

interface WatermarkSettings {
  url?: string;
  enabled?: boolean;
  opacity?: number;
  position?: string;
}

interface JitsiRoomProps {
  domain: string;
  roomName: string;
  jwt: string;
  displayName: string;
  locale: string;
  role: 'moderator' | 'participant';
  participantsCanUnmute?: boolean;
  participantsCanStartVideo?: boolean;
  participantsCanShareScreen?: boolean;
  enableFileSharing?: boolean;
  /** If true, the iframe initializes with the local video track muted.
   *  Reflects the user's pre-join DeviceCheck toggle so the choice
   *  actually takes effect when the user lands in the Jitsi room. */
  startWithVideoMuted?: boolean;
  /** If true, the iframe initializes with the local audio track muted. */
  startWithAudioMuted?: boolean;
  watermark?: WatermarkSettings;
  onReady?: () => void;
  onLeft?: () => void;
  onParticipantCountChanged?: (count: number) => void;
  onRecordingStatusChanged?: (isRecording: boolean) => void;
  onApiReady?: (api: JitsiAPI) => void;
}

type LoadState = 'loading' | 'ready' | 'error';

const DEFAULT_WATERMARK_URL = '/images/default-watermark.svg';

const POSITION_STYLES: Record<string, React.CSSProperties> = {
  'bottom-left': { bottom: 16, left: 16 },
  'bottom-right': { bottom: 16, right: 16 },
  'top-left': { top: 16, left: 16 },
  'top-right': { top: 16, right: 16 },
};

export default function JitsiRoom({
  domain,
  roomName,
  jwt,
  displayName,
  locale,
  role,
  participantsCanUnmute = true,
  participantsCanStartVideo = true,
  participantsCanShareScreen = true,
  enableFileSharing = false,
  startWithVideoMuted = false,
  startWithAudioMuted = false,
  watermark,
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

  const observerRef = useRef<MutationObserver | null>(null);
  // Mobile detection captured once at mount. We intentionally don't
  // react to resize: flipping the toolbar mid-call would require
  // reinitialising the iframe (disconnecting the user).
  const isMobileRef = useRef<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    disposedRef.current = false;
    isMobileRef.current = window.matchMedia('(max-width: 767.98px)').matches;

    let toolbarButtons = role === 'moderator'
      ? (isMobileRef.current ? [...mobileModeratorToolbarButtons] : [...moderatorToolbarButtons])
      : (isMobileRef.current ? [...mobileBaseToolbarButtons] : [...baseToolbarButtons]);

    const extraConfig: Record<string, unknown> = {};

    // Moderators need the participants-pane "rimuovi utente" (kick) to
    // actually fire — the global default has `disableKick: true` to hide
    // the button from participants, so we flip it back on per-instance.
    // `disableGrantModerator` stays true: grant is driven by JWT, not UI.
    if (role === 'moderator') {
      extraConfig.remoteVideoMenu = {
        ...jitsiConfigOverwrite.remoteVideoMenu,
        disableKick: false,
      };
    }

    // Honor the user's pre-join DeviceCheck choice. The base
    // `jitsiConfigOverwrite` defaults both flags to `true` (start muted),
    // so we must explicitly write the prop value — both true AND false —
    // otherwise a user who turned the camera ON in the preview would
    // still join muted.
    extraConfig.startWithVideoMuted = startWithVideoMuted;
    extraConfig.startWithAudioMuted = startWithAudioMuted;

    if (role === 'participant') {
      if (!participantsCanUnmute) {
        // Policy override: participants without unmute permission are
        // always forced muted. Can't be relaxed by the DeviceCheck.
        extraConfig.startWithAudioMuted = true;
        extraConfig.disableAudioDenied = true;
        toolbarButtons = toolbarButtons.filter(b => b !== 'microphone');
      }
      if (!participantsCanStartVideo) {
        extraConfig.startWithVideoMuted = true;
        extraConfig.disableVideoDenied = true;
        toolbarButtons = toolbarButtons.filter(b => b !== 'camera');
      }
      if (!participantsCanShareScreen) {
        toolbarButtons = toolbarButtons.filter(b => b !== 'desktop');
      }
    }

    const IFRAME_ALLOW = 'camera; microphone; display-capture; autoplay; clipboard-write; screen-wake-lock';

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
            ...extraConfig,
            toolbarButtons,
            ...(enableFileSharing ? { enableFileSharing: true } : {}),
          },
          interfaceConfigOverwrite: {
            ...jitsiInterfaceConfigOverwrite,
            TOOLBAR_BUTTONS: toolbarButtons,
          },
          userInfo: { displayName },
        });

        apiRef.current = api;
        onApiReadyRef.current?.(api);

        const iframeEl = containerRef.current?.querySelector('iframe');
        if (iframeEl) {
          iframeEl.setAttribute('allow', IFRAME_ALLOW);
        } else {
          const observer = new MutationObserver((_mutations, obs) => {
            const frame = containerRef.current?.querySelector('iframe');
            if (frame) {
              frame.setAttribute('allow', IFRAME_ALLOW);
              obs.disconnect();
              observerRef.current = null;
            }
          });
          observerRef.current = observer;
          if (containerRef.current) {
            observer.observe(containerRef.current, { childList: true, subtree: true });
          }
        }

        api.addListener('videoConferenceJoined', () => {
          if (disposedRef.current) return;
          setLoadState('ready');
          onReadyRef.current?.();
        });

        api.addListener('videoConferenceLeft', () => {
          if (disposedRef.current) return;
          onLeftRef.current?.();
        });

        api.addListener('participantJoined', () => {
          if (disposedRef.current) return;
          onParticipantCountChangedRef.current?.(api.getNumberOfParticipants());
        });

        api.addListener('participantLeft', () => {
          if (disposedRef.current) return;
          onParticipantCountChangedRef.current?.(api.getNumberOfParticipants());
        });

        api.addListener('recordingStatusChanged', (evt: { on: boolean }) => {
          if (disposedRef.current) return;
          onRecordingStatusChangedRef.current?.(evt.on);
        });
      } catch {
        if (!disposedRef.current) setLoadState('error');
        initializingRef.current = false;
      }
    }

    let scriptLoadHandler: (() => void) | null = null;
    let attachedScript: HTMLScriptElement | null = null;

    if (window.JitsiMeetExternalAPI) {
      initJitsi();
    } else {
      const existingScript = document.querySelector(
        `script[src*="external_api.js"]`,
      ) as HTMLScriptElement | null;

      if (existingScript) {
        scriptLoadHandler = initJitsi;
        attachedScript = existingScript;
        existingScript.addEventListener('load', scriptLoadHandler);
      } else {
        const script = document.createElement('script');
        script.src = `https://${domain}/external_api.js`;
        script.async = true;
        script.onload = initJitsi;
        script.onerror = () => { if (!disposedRef.current) setLoadState('error'); };
        document.head.appendChild(script);
      }
    }

    return () => {
      disposedRef.current = true;
      initializingRef.current = false;
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (attachedScript && scriptLoadHandler) {
        attachedScript.removeEventListener('load', scriptLoadHandler);
      }
      if (apiRef.current) {
        apiRef.current.dispose();
        apiRef.current = null;
      }
    };
  // NOTE: locale is intentionally excluded from deps to prevent iframe
  // recreation (and user disconnection) when the user switches language.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, roomName, jwt, displayName, role, participantsCanUnmute, participantsCanStartVideo, participantsCanShareScreen, enableFileSharing, startWithVideoMuted, startWithAudioMuted]);

  return (
    <div className="jitsi-wrapper position-relative">
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

      {loadState === 'ready' && watermark?.enabled !== false && (
        <img
          src={watermark?.url || DEFAULT_WATERMARK_URL}
          alt=""
          aria-hidden="true"
          style={{
            position: 'absolute',
            ...POSITION_STYLES[watermark?.position || 'bottom-left'],
            width: 80,
            pointerEvents: 'none',
            zIndex: 10,
            opacity: watermark?.opacity ?? 0.4,
          }}
        />
      )}
    </div>
  );
}
