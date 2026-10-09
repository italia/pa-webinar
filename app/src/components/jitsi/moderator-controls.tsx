'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import {
  Button,
  Badge,
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Spinner,
} from 'design-react-kit';

import { Icon } from '@/components/ui/icon';
import type { FaseRegistratore } from '@/lib/jitsi/bridge-readiness';
import type { JitsiMeetExternalAPI } from '@/types/jitsi';
import { useJitsiEvents } from '@/hooks/use-jitsi-events';
import { useRouter, percorso } from '@/i18n/navigation';

interface ModeratorControlsProps {
  api: JitsiMeetExternalAPI | null;
  eventId: string;
  moderatorToken: string;
  recordingEnabled: boolean;
  /** Stato del registratore letto dalla sonda di stato
   *  (lib/jitsi/bridge-readiness#leggiFaseRegistratore). `null` = non lo so:
   *  il pulsante resta usabile. */
  recorderPhase?: FaseRegistratore | null;
  /** Event opted into the native Jitsi/Excalidraw whiteboard → show the
   *  "Apri lavagna" toggle (desktop only, matching Jitsi's own gating). */
  whiteboardEnabled?: boolean;
  /** The installation serves the whiteboard (Excalidraw backend + Jitsi
   *  `config.whiteboard.enabled`). Without it the toggle stays hidden so it
   *  never shows as a dead button. Resolved at RUNTIME by the live page's
   *  Server Component (lib/jitsi/whiteboard.ts), never read from
   *  `process.env` here: webpack would freeze it into the image at build. */
  whiteboardInfraReady?: boolean;
  /** Only the PRIMARY moderator can reach /admin/events/[id]. Co-moderators
   *  and speakers hold a magic-link token without admin rights, so redirecting
   *  them there after "Termina evento" lands on a 404 — they just close. */
  isPrimaryModerator?: boolean;
  /** Avvisa la sala che l'evento e' finito PRIMA dell'hangup: senza, la
   *  chiusura di Jitsi arrivava con l'evento ancora LIVE e chi l'aveva appena
   *  terminato si vedeva «Sei uscito dalla sala» con il pulsante «Rientra». */
  onEnded?: () => void;
  /** Dove montare la conferma: a schermo intero `<body>` e' fuori dal livello
   *  visibile e la finestra non comparirebbe (vedi LiveEventClient). */
  modalContainer?: HTMLElement;
}

const BAR_STYLE: React.CSSProperties = {
  background: 'var(--app-text)',
  borderBottom: '2px solid #0066CC',
};

const BTN_BASE = 'py-2 px-3 d-inline-flex align-items-center gap-1 fw-semibold border-0 rounded-1';

const BTN_DEFAULT: React.CSSProperties = {
  fontSize: '0.82rem',
  background: '#243B55',
  color: '#C9D4DE',
};

const BTN_DANGER: React.CSSProperties = {
  fontSize: '0.82rem',
};

export default function ModeratorControls({
  api,
  eventId,
  moderatorToken,
  recordingEnabled,
  recorderPhase = null,
  whiteboardEnabled = false,
  whiteboardInfraReady = false,
  isPrimaryModerator = false,
  onEnded,
  modalContainer,
}: ModeratorControlsProps) {
  const t = useTranslations('live.moderator');
  const tl = useTranslations('live');
  const tc = useTranslations('common');
  const router = useRouter();

  const { isRecording } = useJitsiEvents(api);

  const [endModalOpen, setEndModalOpen] = useState(false);
  const [ending, setEnding] = useState(false);
  const [recToast, setRecToast] = useState('');

  const [recSeconds, setRecSeconds] = useState(0);
  const [recCooldown, setRecCooldown] = useState(false);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endNavigationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (endNavigationTimerRef.current) clearTimeout(endNavigationTimerRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Un avviso alla volta: il timer del precedente non deve spegnere il nuovo.
  const mostraAvviso = useCallback((messaggio: string, durataMs = 4000) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setRecToast(messaggio);
    toastTimerRef.current = setTimeout(() => setRecToast(''), durataMs);
  }, []);

  // Il registratore non si è acceso entro il tempo massimo: la sonda smette di
  // dire «in avvio» e chi modera riceve un avviso esplicito, una volta per
  // attesa (la fase non torna indietro: bridge-readiness#faseRegistratoreStabile).
  // Chi entra quando il registratore è già dato per non partito riceve lo
  // stesso avviso: tutti i moderatori leggono la stessa sonda. Nessun avviso
  // mentre si registra: la sonda può non raggiungere l'API di salute di un
  // registratore che sta lavorando, e il pulsante per fermarlo resta.
  const fasePrecedenteRef = useRef<FaseRegistratore | null>(null);
  const avvisoNonPartito = tl('recorderNotStartedDetail');
  useEffect(() => {
    const precedente = fasePrecedenteRef.current;
    fasePrecedenteRef.current = recorderPhase;
    if (
      !recordingEnabled ||
      isRecording ||
      recorderPhase !== 'non-partito' ||
      precedente === 'non-partito'
    ) {
      return;
    }
    mostraAvviso(avvisoNonPartito, 10_000);
  }, [recorderPhase, recordingEnabled, isRecording, mostraAvviso, avvisoNonPartito]);

  // Una registrazione in corso smentisce l'avviso: chi entra tardi può
  // riceverlo prima che Jitsi gli comunichi la registrazione già avviata.
  useEffect(() => {
    if (isRecording) setRecToast((attuale) => (attuale === avvisoNonPartito ? '' : attuale));
  }, [isRecording, avvisoNonPartito]);

  const registratoreBloccato =
    recorderPhase === 'in-avvio' ||
    recorderPhase === 'non-partito' ||
    recorderPhase === 'non-configurato';

  useEffect(() => {
    if (isRecording) {
      setRecSeconds(0);
      recTimerRef.current = setInterval(() => {
        setRecSeconds((s) => s + 1);
      }, 1000);
    } else {
      if (recTimerRef.current) clearInterval(recTimerRef.current);
      setRecSeconds(0);
    }
    return () => {
      if (recTimerRef.current) clearInterval(recTimerRef.current);
    };
  }, [isRecording]);

  const formatTime = (secs: number) => {
    const m = String(Math.floor(secs / 60)).padStart(2, '0');
    const s = String(secs % 60).padStart(2, '0');
    return `${m}:${s}`;
  };

  const recRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recAttemptsRef = useRef(0);
  const MAX_REC_RETRIES = 3;
  const REC_RETRY_DELAY_MS = 3000;

  useEffect(() => {
    return () => {
      if (recRetryRef.current) clearTimeout(recRetryRef.current);
    };
  }, []);

  const attemptStartRecording = useCallback(() => {
    if (!api) return;
    try {
      api.executeCommand('startRecording', { mode: 'file' });
    } catch {
      // Jibri not yet in MUC — schedule retry with backoff
      if (recAttemptsRef.current < MAX_REC_RETRIES) {
        recAttemptsRef.current += 1;
        const delay = REC_RETRY_DELAY_MS * recAttemptsRef.current;
        recRetryRef.current = setTimeout(attemptStartRecording, delay);
      } else {
        recAttemptsRef.current = 0;
        mostraAvviso(tl('recorderStartFailed'), 8000);
      }
    }
  }, [api, tl, mostraAvviso]);

  // Listen for recording errors (service-unavailable) and auto-retry
  useEffect(() => {
    if (!api) return;
    const onRecordingLinkUpdate = (evt: { error?: string; on?: boolean }) => {
      if (evt.error && recAttemptsRef.current < MAX_REC_RETRIES) {
        recAttemptsRef.current += 1;
        const delay = REC_RETRY_DELAY_MS * recAttemptsRef.current;
        if (recRetryRef.current) clearTimeout(recRetryRef.current);
        recRetryRef.current = setTimeout(attemptStartRecording, delay);
      } else if (evt.error) {
        recAttemptsRef.current = 0;
        mostraAvviso(tl('recorderStartFailed'), 8000);
      } else if (evt.on !== undefined) {
        recAttemptsRef.current = 0;
      }
    };
    api.addListener('recordingStatusChanged', onRecordingLinkUpdate);
    return () => {
      api.removeListener('recordingStatusChanged', onRecordingLinkUpdate);
    };
  }, [api, attemptStartRecording, tl, mostraAvviso]);

  const handleToggleRecording = useCallback(() => {
    if (!api || recCooldown) return;
    if (isRecording) {
      api.executeCommand('stopRecording', 'file');
      setRecCooldown(true);
      setTimeout(() => setRecCooldown(false), 8000);
    } else {
      // Il pulsante è disabilitato in queste fasi; la guardia resta per
      // non avviare nulla da un click arrivato durante il cambio di fase.
      if (registratoreBloccato) return;
      recAttemptsRef.current = 0;
      attemptStartRecording();
    }
  }, [api, isRecording, recCooldown, registratoreBloccato, attemptStartRecording]);

  const handleEndEvent = useCallback(async () => {
    setEnding(true);
    try {
      const res = await fetch(`/api/events/${eventId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${moderatorToken}`,
        },
        body: JSON.stringify({ status: 'ENDED' }),
      });
      if (!res.ok) {
        setEnding(false);
        mostraAvviso(tl('endEventError'));
        return;
      }
      onEnded?.();
      api?.executeCommand('hangup');
      setEndModalOpen(false);
      // Only the primary moderator has admin access. Co-moderators/speakers
      // just close: the hangup fires Jitsi's readyToClose, which the live
      // client turns into the "evento concluso" screen — no 404 redirect.
      if (isPrimaryModerator) {
        endNavigationTimerRef.current = setTimeout(() => {
          router.push(percorso(`/admin/events/${eventId}?token=${moderatorToken}`));
        }, 2000);
      }
    } catch {
      setEnding(false);
      mostraAvviso(tl('endEventError'));
    }
  }, [api, eventId, moderatorToken, router, tl, mostraAvviso, isPrimaryModerator, onEnded]);

  return (
    <>
      <div
        className="text-white px-3 py-2 d-flex align-items-center justify-content-between flex-wrap gap-2 moderator-bar"
        style={BAR_STYLE}
      >
        <div className="d-flex align-items-center gap-2 flex-wrap">
          {/* Recording — il pulsante normale ogni volta che si può agire:
              registrazione in corso (va sempre potuta fermare, qualunque cosa
              dica la sonda), pausa dopo lo stop, registratore pronto o stato
              sconosciuto. Le altre fasi lo sostituiscono con un indicatore. */}
          {recordingEnabled && (
            isRecording || recCooldown || !registratoreBloccato ? (
              <Button
                color={isRecording ? 'danger' : 'secondary'}
                size="sm"
                className={BTN_BASE}
                onClick={handleToggleRecording}
                disabled={!api || recCooldown}
                style={isRecording ? BTN_DANGER : BTN_DEFAULT}
              >
                {recCooldown ? (
                  <>
                    <Icon icon="it-refresh" size="sm" color="white" />
                    {t('recPreparing')}
                  </>
                ) : isRecording ? (
                  <>
                    <span
                      className="d-inline-block rounded-circle"
                      style={{
                        width: 8,
                        height: 8,
                        backgroundColor: '#fff',
                        animation: 'pulse-dot 1.5s ease-in-out infinite',
                      }}
                    />
                    {t('stopRecording')}
                    <Badge
                      color=""
                      pill
                      className="ms-1"
                      style={{ fontSize: '0.72rem', background: 'rgba(255,255,255,0.2)', color: '#fff' }}
                    >
                      {formatTime(recSeconds)}
                    </Badge>
                  </>
                ) : (
                  <>
                    <Icon icon="it-video" size="sm" color="white" />
                    {t('startRecording')}
                  </>
                )}
              </Button>
            ) : recorderPhase === 'in-avvio' ? (
              <Button
                color="secondary"
                size="sm"
                className={BTN_BASE}
                disabled
                style={{ ...BTN_DEFAULT, opacity: 0.6 }}
                title={tl('jibriScalingTooltip')}
              >
                <Spinner active small className="me-1" style={{ width: 14, height: 14 }} />
                {tl('jibriScaling')}
              </Button>
            ) : (
              <Button
                color="secondary"
                size="sm"
                className={BTN_BASE}
                disabled
                style={{ ...BTN_DEFAULT, opacity: 0.6 }}
                title={
                  recorderPhase === 'non-partito'
                    ? tl('recorderNotStartedDetail')
                    : tl('jibriNotConfigured')
                }
              >
                <Icon icon="it-warning-circle" size="sm" color="white" />
                {recorderPhase === 'non-partito'
                  ? tl('recorderNotStarted')
                  : tl('jibriNotConfigured')}
              </Button>
            )
          )}

          {/* Whiteboard — toggle the native Jitsi/Excalidraw board via the
              IFrame API. Desktop-only (matches Jitsi's own toolbar gating; the
              board doesn't render on mobile) and only when the event opted in. */}
          {whiteboardEnabled && whiteboardInfraReady && (
            <Button
              color="secondary"
              size="sm"
              className={`${BTN_BASE} d-none d-lg-inline-flex`}
              onClick={() => api?.executeCommand('toggleWhiteboard')}
              disabled={!api}
              style={BTN_DEFAULT}
            >
              <Icon icon="it-pencil" size="sm" color="white" />
              {t('whiteboard')}
            </Button>
          )}

          {/* Presentation-timer control slot — PresentationTimer portals its
              moderator control here so it sits on the controls line instead of
              a full-width row of its own. Empty (zero size) when unused. */}
          <div
            id="live-timer-control-slot"
            className="d-inline-flex align-items-center gap-2"
          />

          {/* End event */}
          <Button
            color="danger"
            size="sm"
            className={BTN_BASE}
            onClick={() => setEndModalOpen(true)}
            style={BTN_DANGER}
          >
            <Icon icon="it-close-circle" size="sm" color="white" />
            {t('endEvent')}
          </Button>
        </div>
      </div>

      {/* Jibri toast */}
      {recToast && (
        <div
          className="bg-warning text-dark px-3 py-2 small text-center fw-semibold"
          role="alert"
        >
          {recToast}
        </div>
      )}

      {/* End event confirmation modal */}
      <Modal
        isOpen={endModalOpen}
        toggle={() => setEndModalOpen(false)}
        centered
        container={modalContainer}
      >
        <ModalHeader closeAriaLabel={tc('close')} toggle={() => setEndModalOpen(false)}>
          {t('endEvent')}
        </ModalHeader>
        <ModalBody>
          <p>{t('endEventConfirm')}</p>
        </ModalBody>
        <ModalFooter>
          <Button
            color="secondary"
            outline
            onClick={() => setEndModalOpen(false)}
            disabled={ending}
          >
            {tc('cancel')}
          </Button>
          <Button color="danger" onClick={handleEndEvent} disabled={ending}>
            {ending ? tc('loading') : tc('confirm')}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
