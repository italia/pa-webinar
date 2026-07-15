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
  resolveVideoQualityConfig,
  videoQualityMaxHeight,
  type VideoQualityPreset,
} from '@/lib/jitsi/config';
import { humanParticipantCount } from '@/lib/jitsi/participants';

// F18: forcing Jitsi's advanced rnnoise noise-cancellation OFF is a workaround
// for jitsi/web:stable-10741, whose rnnoise worklet has no resampling and
// SILENCES non-48kHz microphones. Base WebRTC noise suppression (AEC/NS/AGC)
// stays ON automatically via lib/jitsi/config.ts regardless of this flag.
// Default = enforce-off (safe, = current behaviour). Set
// NEXT_PUBLIC_JITSI_RNNOISE_ENFORCE=false ONLY after the served Jitsi web image
// is bumped to a build with the fixed worklet, then re-validate on a LIVE call.
// Build-time inlined (NEXT_PUBLIC_*), so flipping it requires a rebuild — which
// coincides with the image bump anyway.
const RNNOISE_ENFORCE_OFF =
  process.env.NEXT_PUBLIC_JITSI_RNNOISE_ENFORCE !== 'false';

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
  /** Slug dell'evento, usato per l'ingest della timeline dominant-speaker
   *  (ADR-013 Fase 0). Se assente, la cattura è disabilitata. */
  eventSlug?: string;
  role: 'moderator' | 'participant';
  participantsCanUnmute?: boolean;
  participantsCanStartVideo?: boolean;
  participantsCanShareScreen?: boolean;
  enableFileSharing?: boolean;
  /** Per-event opt-in (Event.whiteboardEnabled): when true, moderators get the
   *  native Jitsi/Excalidraw whiteboard button (desktop only). Jitsi still
   *  feature-gates it on config.whiteboard.enabled (server-side, test only),
   *  so it stays hidden on prod even for opted-in events. */
  whiteboardEnabled?: boolean;
  /** Video/audio quality preset (admin SiteSetting, per-event override).
   *  Drives resolution, bitrate caps, channelLastN and Opus settings, and is
   *  also enforced at runtime via setVideoQuality. Defaults to HIGH. */
  videoQuality?: VideoQualityPreset;
  /** If true, the iframe initializes with the local video track muted.
   *  Reflects the user's pre-join DeviceCheck toggle so the choice
   *  actually takes effect when the user lands in the Jitsi room. */
  startWithVideoMuted?: boolean;
  /** If true, the iframe initializes with the local audio track muted. */
  startWithAudioMuted?: boolean;
  watermark?: WatermarkSettings;
  onReady?: () => void;
  onLeft?: () => void;
  /** Fired on Jitsi's `readyToClose` — an INTENTIONAL hangup (native toolbar
   *  button, executeCommand('hangup'), or "Termina evento"), never a transient
   *  drop. The parent uses it as the authoritative "the user left" signal so
   *  the native hangup doesn't get mistaken for a network blip and reconnected. */
  onReadyToClose?: () => void;
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
  eventSlug,
  role,
  participantsCanUnmute = true,
  participantsCanStartVideo = true,
  participantsCanShareScreen = true,
  enableFileSharing = false,
  whiteboardEnabled = false,
  videoQuality,
  startWithVideoMuted = false,
  startWithAudioMuted = false,
  watermark,
  onReady,
  onLeft,
  onReadyToClose,
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
  const onReadyToCloseRef = useRef(onReadyToClose);
  const onParticipantCountChangedRef = useRef(onParticipantCountChanged);
  const onRecordingStatusChangedRef = useRef(onRecordingStatusChanged);
  const onApiReadyRef = useRef(onApiReady);

  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  useEffect(() => { onLeftRef.current = onLeft; }, [onLeft]);
  useEffect(() => { onReadyToCloseRef.current = onReadyToClose; }, [onReadyToClose]);
  useEffect(() => { onParticipantCountChangedRef.current = onParticipantCountChanged; }, [onParticipantCountChanged]);
  useEffect(() => { onRecordingStatusChangedRef.current = onRecordingStatusChanged; }, [onRecordingStatusChanged]);
  useEffect(() => { onApiReadyRef.current = onApiReady; }, [onApiReady]);

  const observerRef = useRef<MutationObserver | null>(null);
  // P4 — interval che ri-asserisce la soppressione rumore OFF per tutta la
  // call (vedi il listener `videoConferenceJoined`).
  const nsEnforceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Mobile detection captured once at mount. We intentionally don't
  // react to resize: flipping the toolbar mid-call would require
  // reinitialising the iframe (disconnecting the user).
  const isMobileRef = useRef<boolean>(false);

  // ADR-013 Fase 0 — buffer della timeline dominant-speaker. Accumuliamo i
  // cambi e li inviamo in batch (debounce + flush all'unload) all'ingest
  // `/api/events/[slug]/speaker-events`. `eventSlug` è letto via ref così il
  // closure dei listener non va ricreato e non forza la reinit dell'iframe.
  const eventSlugRef = useRef(eventSlug);
  useEffect(() => { eventSlugRef.current = eventSlug; }, [eventSlug]);
  const speakerT0Ref = useRef<number>(0);
  const speakerBufferRef = useRef<Array<{ atMs: number; participantId: string; displayName?: string }>>([]);
  const speakerFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // P1 analytics — buffer delle alzate di mano (`raiseHandUpdated`), stesso
  // schema di batching del dominant speaker: accumula e invia in batch a
  // `/api/events/[slug]/hand-raises`. Condivide `speakerT0Ref` come t0.
  // Nessuna PII: solo l'endpoint id opaco della PROPRIA sessione (self-report).
  const handRaiseBufferRef = useRef<Array<{ participantId: string; raised: boolean }>>([]);
  const handRaiseFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Endpoint id locale (dal `videoConferenceJoined`): serve a segnalare SOLO le
  // nostre alzate di mano, dato che l'evento arriva in broadcast a ogni client.
  const myEndpointIdRef = useRef<string>('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    disposedRef.current = false;
    isMobileRef.current = window.matchMedia('(max-width: 767.98px)').matches;

    let toolbarButtons = role === 'moderator'
      ? (isMobileRef.current ? [...mobileModeratorToolbarButtons] : [...moderatorToolbarButtons])
      : (isMobileRef.current ? [...mobileBaseToolbarButtons] : [...baseToolbarButtons]);

    const extraConfig: Record<string, unknown> = {};

    // paFaceFx PoC opt-in via `?facefx=1` on the app URL. It rides into the
    // Jitsi configOverwrite → the IFrame API serializes it into the iframe
    // URL hash, which the injected custom-config.js reads to enable the WebGL
    // face/lighting filter. This is the only opt-in that works on mobile
    // (the localStorage path lives on the Jitsi origin, unreachable there).
    // NB: the filter needs Insertable Streams → Chromium only (no iOS Safari).
    try {
      const facefx = new URLSearchParams(window.location.search).get('facefx');
      if (facefx === '1' || facefx === 'true') extraConfig.paFaceFx = true;
    } catch {
      /* SSR / no window → skip */
    }

    // Video/audio quality preset (admin-configurable). Spread first so the
    // per-role/per-permission keys below can still win on any overlap; these
    // keys (resolution, constraints, videoQuality, channelLastN, audioQuality…)
    // override the static defaults in `jitsiConfigOverwrite`.
    Object.assign(extraConfig, resolveVideoQualityConfig(videoQuality, { isMobile: isMobileRef.current }));

    // Moderators need the participants-pane "rimuovi utente" (kick) to
    // actually fire — the global default has `disableKick: true` to hide
    // the button from participants, so we flip it back on per-instance.
    // `disableGrantModerator` stays true: grant is driven by JWT, not UI.
    if (role === 'moderator') {
      extraConfig.remoteVideoMenu = {
        ...jitsiConfigOverwrite.remoteVideoMenu,
        disableKick: false,
      };
      // Native whiteboard: per-event opt-in + moderator + desktop only. Jitsi
      // additionally feature-gates the button on config.whiteboard.enabled
      // (set server-side, test only), so it stays hidden on prod even when an
      // event opted in — no client-side check for the server infra needed.
      if (whiteboardEnabled && !isMobileRef.current) {
        toolbarButtons.push('whiteboard');
      }
    }

    // Honor the user's pre-join DeviceCheck choice. The base
    // `jitsiConfigOverwrite` defaults both flags to `true` (start muted),
    // so we must explicitly write the prop value — both true AND false —
    // otherwise a user who turned the camera ON in the preview would
    // still join muted.
    //
    // EXCEPTION: on mobile browsers we always start muted, regardless of
    // the pre-join choice. iOS Safari (and Chrome in-iframe contexts)
    // require a fresh user gesture for each getUserMedia call, so
    // auto-acquiring the camera on join fails and can crash the iframe.
    // The user taps the Jitsi camera button after joining — that click
    // counts as a gesture and works reliably.
    if (isMobileRef.current) {
      extraConfig.startWithVideoMuted = true;
      extraConfig.startWithAudioMuted = true;
    } else {
      extraConfig.startWithVideoMuted = startWithVideoMuted;
      extraConfig.startWithAudioMuted = startWithAudioMuted;
    }

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

    // Invio JSON best-effort condiviso dagli ingest live (dominant-speaker e
    // alzate di mano): sendBeacon all'unload (sopravvive alla chiusura tab),
    // fetch keepalive altrimenti. Fire-and-forget: non rompe mai il flusso live.
    function sendJson(url: string, payload: string, useBeacon: boolean) {
      try {
        if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
          navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
          return;
        }
        void fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
        }).catch(() => { /* ingest best-effort */ });
      } catch {
        /* best-effort */
      }
    }

    // ADR-013 Fase 0 — invia il buffer dominant-speaker all'ingest.
    function flushSpeakerBuffer(useBeacon = false) {
      const slug = eventSlugRef.current;
      const buf = speakerBufferRef.current;
      if (!slug || buf.length === 0) return;
      // Cap difensivo lato client coerente col tetto della route (2000).
      // splice() muta il buffer in-place: l'eventuale eccedenza (>2000) resta
      // in coda per il flush successivo invece di essere persa.
      const events = buf.splice(0, 2000);
      sendJson(`/api/events/${encodeURIComponent(slug)}/speaker-events`, JSON.stringify({ events }), useBeacon);
    }

    function scheduleSpeakerFlush() {
      if (speakerFlushTimerRef.current) return;
      speakerFlushTimerRef.current = setTimeout(() => {
        speakerFlushTimerRef.current = null;
        flushSpeakerBuffer(false);
      }, 10_000);
    }

    // P1 analytics — stesso meccanismo per le alzate di mano, endpoint dedicato.
    function flushHandRaiseBuffer(useBeacon = false) {
      const slug = eventSlugRef.current;
      const buf = handRaiseBufferRef.current;
      if (!slug || buf.length === 0) return;
      const events = buf.splice(0, 2000);
      sendJson(`/api/events/${encodeURIComponent(slug)}/hand-raises`, JSON.stringify({ events }), useBeacon);
    }

    function scheduleHandRaiseFlush() {
      if (handRaiseFlushTimerRef.current) return;
      handRaiseFlushTimerRef.current = setTimeout(() => {
        handRaiseFlushTimerRef.current = null;
        flushHandRaiseBuffer(false);
      }, 10_000);
    }

    const handlePageHide = () => {
      flushSpeakerBuffer(true);
      flushHandRaiseBuffer(true);
    };

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
            // Force lib-jitsi-meet's _statsCurrentId to our display name.
            // Without these, lib-jitsi-meet falls back to a random
            // RandomUtil.randomElement(firstNames) + '-' + 3-char hex
            // (e.g. "Judah-hqj"), which is what shows up in Jicofo logs
            // as `stats-id` and in callstats/JaaS analytics. Keeping this
            // tied to our portal-issued displayName makes ops logs
            // traceable back to the registered participant.
            statisticsId: displayName,
            statisticsDisplayName: displayName,
          },
          interfaceConfigOverwrite: {
            ...jitsiInterfaceConfigOverwrite,
            TOOLBAR_BUTTONS: toolbarButtons,
          },
          userInfo: { displayName },
        });

        apiRef.current = api;
        onApiReadyRef.current?.(api);

        // Accessible name for the video call iframe (WCAG 4.1.2): without a
        // title the core of the page is announced generically ("iframe").
        const frameTitle = t('videoCallFrameTitle');
        const iframeEl = containerRef.current?.querySelector('iframe');
        if (iframeEl) {
          iframeEl.setAttribute('allow', IFRAME_ALLOW);
          iframeEl.setAttribute('title', frameTitle);
        } else {
          const observer = new MutationObserver((_mutations, obs) => {
            const frame = containerRef.current?.querySelector('iframe');
            if (frame) {
              frame.setAttribute('allow', IFRAME_ALLOW);
              frame.setAttribute('title', frameTitle);
              obs.disconnect();
              observerRef.current = null;
            }
          });
          observerRef.current = observer;
          if (containerRef.current) {
            observer.observe(containerRef.current, { childList: true, subtree: true });
          }
        }

        // P4 — Forza la "soppressione rumore extra" (rnnoise) OFF e la tiene OFF.
        // Su jitsi/web:stable-10741 il worklet rnnoise non fa conversione di
        // sample-rate e ZITTISCE il microfono in uscita su contesti di cattura
        // non-48kHz (un moderatore è rimasto muto nella demo prova-con-roberto).
        // Non esiste un flag di config per-feature che la disabiliti, e il toggle
        // è raggiungibile SIA dal tab Impostazioni>Audio SIA dal popup del caret
        // accanto al pulsante microfono — nessuno dei due rimovibile senza
        // perdere anche il selettore dispositivi. Quindi la forziamo via IFrame
        // API. `setNoiseSuppressionEnabled(false)` è un no-op quando la NS è già
        // off (il thunk Jitsi ha la guardia `enabled !== current`): l'interval
        // fa lavoro reale — ri-spegnendola entro un tick — solo se un utente la
        // riattiva manualmente. Da rimuovere quando l'immagine Jitsi servita
        // includerà un worklet rnnoise corretto.
        const enforceNoiseSuppressionOff = (): void => {
          if (disposedRef.current) return;
          try {
            api.executeCommand('setNoiseSuppressionEnabled', false);
          } catch {
            /* build più vecchie potrebbero non esporre il comando */
          }
        };

        api.addListener('videoConferenceJoined', (evt: { id?: string }) => {
          if (disposedRef.current) return;
          // Il nostro endpoint id: usato per segnalare solo le nostre alzate.
          if (evt?.id) myEndpointIdRef.current = evt.id;
          setLoadState('ready');
          // Annulla un'eventuale NS persistita da Jitsi in localStorage da una
          // sessione precedente, poi continua a ri-asserirla off per tutta la call.
          if (RNNOISE_ENFORCE_OFF) {
            enforceNoiseSuppressionOff();
            if (!nsEnforceTimerRef.current) {
              nsEnforceTimerRef.current = setInterval(enforceNoiseSuppressionOff, 2000);
            }
          }
          // Enforce the quality preset at runtime too. setVideoQuality is the
          // most reliable lever across Jitsi builds (caps the received video
          // height); the configOverwrite keys above cap the sent stream.
          try {
            api.executeCommand('setVideoQuality', videoQualityMaxHeight(videoQuality, { isMobile: isMobileRef.current }));
          } catch {
            /* older builds may not expose the command — configOverwrite still applies */
          }
          // ADR-013 Fase 0 — t0 della timeline = momento del join. Gli atMs
          // accumulati sono relativi a questo istante.
          speakerT0Ref.current = Date.now();
          onReadyRef.current?.();
        });

        // Ri-applica il cap qualità quando la camera viene ACCESA dopo il join
        // (al join era mutata → setVideoQuality poteva non agire sul layer
        // locale) e su cambio device. Senza, il primo frame post-accensione
        // poteva partire alla risoluzione di default del build, non al preset.
        const reapplyVideoQuality = (): void => {
          if (disposedRef.current) return;
          try {
            api.executeCommand(
              'setVideoQuality',
              videoQualityMaxHeight(videoQuality, { isMobile: isMobileRef.current }),
            );
          } catch {
            /* noop */
          }
        };
        api.addListener('videoMuteStatusChanged', (e: { muted?: boolean }) => {
          if (e && e.muted === false) reapplyVideoQuality();
        });

        api.addListener('videoConferenceLeft', () => {
          if (disposedRef.current) return;
          if (nsEnforceTimerRef.current) {
            clearInterval(nsEnforceTimerRef.current);
            nsEnforceTimerRef.current = null;
          }
          flushSpeakerBuffer(true);
          flushHandRaiseBuffer(true);
          onLeftRef.current?.();
        });

        // `readyToClose` fires ONLY after an intentional hangup (native
        // toolbar button, executeCommand('hangup'), moderator "Termina
        // evento") — never on a transient drop. It's the reliable signal
        // that the user meant to leave, so the parent can close cleanly
        // instead of treating the preceding videoConferenceLeft as a blip
        // and reconnecting. May arrive shortly AFTER videoConferenceLeft.
        api.addListener('readyToClose', () => {
          if (disposedRef.current) return;
          onReadyToCloseRef.current?.();
        });

        // ADR-013 Fase 0 — cattura la timeline del dominant speaker. A ogni
        // cambio accumuliamo `{ atMs, participantId, displayName }`; l'invio
        // è batchato (debounce 10s) o al pagehide/leave.
        api.addListener('dominantSpeakerChanged', (evt: { id: string }) => {
          if (disposedRef.current || !eventSlugRef.current || !evt?.id) return;
          let name: string | undefined;
          try {
            name = api.getDisplayName?.(evt.id) || undefined;
          } catch {
            name = undefined;
          }
          speakerBufferRef.current.push({
            atMs: Date.now() - speakerT0Ref.current,
            participantId: evt.id,
            displayName: name,
          });
          scheduleSpeakerFlush();
        });

        // P1 analytics — cattura le alzate di mano. `handRaised > 0` = mano
        // alzata, `0` = mano abbassata. `raiseHandUpdated` è in BROADCAST a ogni
        // client, quindi segnaliamo SOLO la nostra alzata (evt.id === il nostro
        // endpoint id): così ogni alzata è registrata una volta sola, non ~P×.
        // I moderatori sono esclusi (non contano per l'engagement del pubblico).
        api.addListener('raiseHandUpdated', (evt: { id: string; handRaised: number }) => {
          if (disposedRef.current || !eventSlugRef.current || !evt?.id) return;
          if (evt.id !== myEndpointIdRef.current || role === 'moderator') return;
          handRaiseBufferRef.current.push({
            participantId: evt.id,
            raised: evt.handRaised > 0,
          });
          scheduleHandRaiseFlush();
        });

        api.addListener('participantJoined', () => {
          if (disposedRef.current) return;
          onParticipantCountChangedRef.current?.(humanParticipantCount(api, displayName));
        });

        api.addListener('participantLeft', () => {
          if (disposedRef.current) return;
          onParticipantCountChangedRef.current?.(humanParticipantCount(api, displayName));
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

    // Flush della timeline anche se la tab viene chiusa/messa in background.
    window.addEventListener('pagehide', handlePageHide);

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
      // ADR-013 Fase 0 — svuota il buffer residuo prima di staccare i
      // listener/iframe, così non perdiamo gli ultimi cambi di speaker.
      window.removeEventListener('pagehide', handlePageHide);
      if (speakerFlushTimerRef.current) {
        clearTimeout(speakerFlushTimerRef.current);
        speakerFlushTimerRef.current = null;
      }
      if (handRaiseFlushTimerRef.current) {
        clearTimeout(handRaiseFlushTimerRef.current);
        handRaiseFlushTimerRef.current = null;
      }
      if (nsEnforceTimerRef.current) {
        clearInterval(nsEnforceTimerRef.current);
        nsEnforceTimerRef.current = null;
      }
      flushSpeakerBuffer(true);
      flushHandRaiseBuffer(true);
      if (apiRef.current) {
        apiRef.current.dispose();
        apiRef.current = null;
      }
    };
  // NOTE: locale is intentionally excluded from deps to prevent iframe
  // recreation (and user disconnection) when the user switches language.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, roomName, jwt, displayName, role, participantsCanUnmute, participantsCanStartVideo, participantsCanShareScreen, enableFileSharing, whiteboardEnabled, videoQuality, startWithVideoMuted, startWithAudioMuted]);

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
