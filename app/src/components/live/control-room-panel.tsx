'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader, Spinner } from 'design-react-kit';

import { Icon } from '@/components/ui/icon';
import ToggleSwitch from '@/components/ui/toggle-switch';
import type { ControlloRegistrazione } from '@/hooks/use-recording-control';
import type { FaseRegistratore } from '@/lib/jitsi/bridge-readiness';
import type { JitsiMeetExternalAPI } from '@/types/jitsi';

import { PresentationTimerControls } from './presentation-timer';

/**
 * La scheda Regia: tutto ciò che chi conduce usa per gestire la sala, in un
 * posto solo e fuori dalla vista del pubblico. La registrazione, le funzioni
 * della sala, il timer degli interventi e, separato in fondo, la chiusura
 * dell'evento. I relatori non la vedono: non hanno poteri di moderazione.
 */

export interface FunzioneSala {
  key: 'qaEnabled' | 'chatEnabled' | 'agendaEnabled' | 'wordCloudEnabled' | 'liveCaptionsEnabled';
  label: string;
  on: boolean;
}

interface ControlRoomPanelProps {
  api: JitsiMeetExternalAPI | null;
  eventId: string;
  token: string;
  /** Avvisa la sala che l'evento è finito PRIMA dell'uscita dalla chiamata. */
  onEnded?: () => void;
  /** Dove montare la conferma (a schermo intero il body è fuori vista). */
  modalContainer?: HTMLElement;
  recordingEnabled: boolean;
  isRecording: boolean;
  faseRegistratore: FaseRegistratore | null;
  registrazione: ControlloRegistrazione;
  funzioni: FunzioneSala[];
  onToggleFunzione: (key: FunzioneSala['key'], on: boolean) => void;
  /** La lavagna è accesa per l'evento e l'installazione la serve. */
  lavagna: boolean;
  eventSlug: string;
}

export default function ControlRoomPanel({
  api,
  eventId,
  token,
  onEnded,
  modalContainer,
  recordingEnabled,
  isRecording,
  faseRegistratore,
  registrazione,
  funzioni,
  onToggleFunzione,
  lavagna,
  eventSlug,
}: ControlRoomPanelProps) {
  const t = useTranslations('live.controlRoom');
  const tl = useTranslations('live');
  const tm = useTranslations('live.moderator');
  const tc = useTranslations('common');

  const [confermaStop, setConfermaStop] = useState(false);
  const [chiusuraAperta, setChiusuraAperta] = useState(false);
  const [chiudendo, setChiudendo] = useState(false);
  const [erroreChiusura, setErroreChiusura] = useState('');

  // Una registrazione che si ferma da sola chiude anche la conferma.
  useEffect(() => {
    if (!isRecording) setConfermaStop(false);
  }, [isRecording]);

  const terminaEvento = useCallback(async () => {
    setChiudendo(true);
    setErroreChiusura('');
    try {
      const res = await fetch(`/api/events/${eventId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: 'ENDED' }),
      });
      if (!res.ok) {
        setChiudendo(false);
        setErroreChiusura(tl('endEventError'));
        return;
      }
      // La sala segna la fine e, per il link principale, porta alla gestione
      // dell'evento (LiveEventClient): qui il pannello sparisce con la chiamata.
      onEnded?.();
      api?.executeCommand('hangup');
      setChiusuraAperta(false);
    } catch {
      setChiudendo(false);
      setErroreChiusura(tl('endEventError'));
    }
  }, [api, eventId, token, onEnded, tl]);

  return (
    <div className="control-room">
      {/* Registrazione */}
      {recordingEnabled && (
        <section className="control-room__section" aria-labelledby="control-room-rec">
          <h3 id="control-room-rec" className="control-room__heading">
            {t('recordingHeading')}
          </h3>
          {isRecording ? (
            confermaStop ? (
              <div className="control-room__confirm" role="group" aria-label={t('stopConfirm')}>
                <p className="mb-2">{t('stopConfirm')}</p>
                <div className="d-flex gap-2">
                  <Button
                    color="danger"
                    size="sm"
                    onClick={() => {
                      registrazione.ferma();
                      setConfermaStop(false);
                    }}
                  >
                    {tm('stopRecording')}
                  </Button>
                  <Button color="secondary" outline size="sm" onClick={() => setConfermaStop(false)}>
                    {tc('cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="d-flex align-items-center justify-content-between gap-2">
                <span className="control-room__rec-state control-room__rec-state--on">
                  <span className="control-room__rec-dot" aria-hidden="true" />
                  {tl('recordingActive')}
                </span>
                <Button color="danger" outline size="sm" onClick={() => setConfermaStop(true)}>
                  {tm('stopRecording')}
                </Button>
              </div>
            )
          ) : (
            <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
              <span className="control-room__rec-state">
                {registrazione.inPausa
                  ? tm('recPreparing')
                  : faseRegistratore === 'in-avvio'
                    ? tl('jibriScaling')
                    : faseRegistratore === 'non-partito'
                      ? tl('recorderNotStarted')
                      : faseRegistratore === 'non-configurato'
                        ? tl('jibriNotConfigured')
                        : t('recordingOff')}
              </span>
              <Button
                color="danger"
                size="sm"
                className="text-nowrap"
                onClick={registrazione.avvia}
                disabled={!registrazione.azionabile}
              >
                {faseRegistratore === 'in-avvio' ? (
                  <Spinner active small className="me-1" style={{ width: 14, height: 14 }} />
                ) : (
                  <span className="control-room__rec-dot control-room__rec-dot--light me-1" aria-hidden="true" />
                )}
                {tm('startRecording')}
              </Button>
            </div>
          )}
          {faseRegistratore === 'non-partito' && !isRecording && (
            <p className="control-room__help">{tl('recorderNotStartedDetail')}</p>
          )}
          {/* L'avviso lo annuncia la striscia del tempo, visibile da ogni
              scheda; qui resta scritto, senza un secondo annuncio. */}
          {registrazione.avviso && <p className="control-room__warning">{registrazione.avviso}</p>}
        </section>
      )}

      {/* Funzioni della sala */}
      <section className="control-room__section" aria-labelledby="control-room-features">
        <h3 id="control-room-features" className="control-room__heading">
          {t('featuresHeading')}
        </h3>
        <p className="control-room__help">{t('featuresHelp')}</p>
        <ul className="control-room__switches">
          {funzioni.map((f) => (
            <li key={f.key}>
              <ToggleSwitch label={f.label} checked={f.on} onChange={() => onToggleFunzione(f.key, f.on)} />
            </li>
          ))}
        </ul>
        {lavagna && (
          <div className="mt-2">
            <Button
              color="primary"
              outline
              size="sm"
              className="d-none d-lg-inline-flex align-items-center gap-1"
              onClick={() => api?.executeCommand('toggleWhiteboard')}
              disabled={!api}
            >
              <Icon icon="it-pencil" size="xs" />
              {tm('whiteboard')}
            </Button>
            <p className="control-room__help mt-1 d-none d-lg-block">{tl('whiteboardNotSavedHint')}</p>
          </div>
        )}
      </section>

      {/* Timer degli interventi */}
      <section className="control-room__section" aria-labelledby="control-room-timer">
        <h3 id="control-room-timer" className="control-room__heading">
          {t('timerHeading')}
        </h3>
        <p className="control-room__help">{t('timerHelp')}</p>
        <PresentationTimerControls eventSlug={eventSlug} token={token} />
      </section>

      {/* Evento: separato, in fondo */}
      <section className="control-room__section control-room__section--danger" aria-labelledby="control-room-event">
        <h3 id="control-room-event" className="control-room__heading">
          {t('eventHeading')}
        </h3>
        <p className="control-room__help">{t('endHelp')}</p>
        <Button color="danger" size="sm" onClick={() => setChiusuraAperta(true)}>
          <Icon icon="it-close-circle" size="xs" color="white" className="me-1" />
          {tm('endEvent')}
        </Button>
      </section>

      <Modal
        isOpen={chiusuraAperta}
        toggle={() => !chiudendo && setChiusuraAperta(false)}
        centered
        container={modalContainer}
      >
        <ModalHeader closeAriaLabel={tc('close')} toggle={() => !chiudendo && setChiusuraAperta(false)}>
          {tm('endEvent')}
        </ModalHeader>
        <ModalBody>
          <p className="mb-0">{tm('endEventConfirm')}</p>
          {erroreChiusura && (
            <p className="text-danger mt-2 mb-0" role="alert">
              {erroreChiusura}
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <Button color="secondary" outline onClick={() => setChiusuraAperta(false)} disabled={chiudendo}>
            {tc('cancel')}
          </Button>
          <Button color="danger" onClick={() => void terminaEvento()} disabled={chiudendo}>
            {chiudendo ? tc('loading') : tc('confirm')}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
