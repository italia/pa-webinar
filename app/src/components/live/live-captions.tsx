'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { applyChunk, prune, type CaptionLine } from '@/lib/captions/caption-lines';
import {
  CAPTIONS_BUTTON_ID,
  CAPTIONS_DISABLED_SOUNDS,
  captionsToolbarButton,
  readCaptionsVisible,
  writeCaptionsVisible,
} from '@/lib/captions/toolbar-button';
import {
  DIMENSIONI_SOTTOTITOLI,
  leggiPreferenzeSottotitoli,
  scriviPreferenzeSottotitoli,
  type PreferenzeSottotitoli,
} from '@/lib/captions/preferences';
import { Icon } from '@/components/ui/icon';
import { impostaPulsante } from '@/lib/jitsi/custom-buttons';
import type { JitsiMeetExternalAPI, JitsiTranscriptionChunk } from '@/types/jitsi';


/** Stato del servizio come lo riporta la pagina di stato (null = non noto). */
export type CaptionsServiceState = 'operational' | 'degraded' | 'paused' | 'unavailable' | null;

/**
 * I sottotitoli live sopra il video (ADR-018).
 *
 * Il testo arriva dall'IFrame API (`transcriptionChunkReceived`), una frase
 * alla volta per chi parla; il nome di chi parla lo dà la sala stessa
 * dall'endpoint, perché il servizio di trascrizione non lo conosce. Ogni
 * spettatore può nasconderli per sé con il pulsante dei sottotitoli nella
 * barra di Jitsi: la scelta resta nel suo browser.
 *
 * Per i lettori di schermo si annunciano solo le frasi concluse, in una
 * regione `aria-live` a parte: annunciare ogni aggiornamento provvisorio
 * renderebbe la sala inascoltabile.
 */
export default function LiveCaptions({
  api,
  active,
  alto = null,
}: {
  api: JitsiMeetExternalAPI | null;
  /** Sottotitoli accesi per l'evento e servizio installato. */
  active: boolean;
  /** Dove disegnarli quando chi guarda li vuole in alto sul video. */
  alto?: HTMLElement | null;
}) {
  const t = useTranslations('live.captions');
  // Lo stato del servizio, per dire a chi guarda perché i sottotitoli tacciono
  // (sospesi per sovraccarico, servizio fermo). Interrogato di rado: la rotta
  // è in cache sul server e serve solo un avviso.
  const { data: servizio } = useSWR<{ state: CaptionsServiceState }>(
    active ? '/api/status/captions' : null,
    (url: string) => fetch(url).then((r) => r.json()),
    { refreshInterval: 30_000 },
  );
  const serviceState = servizio?.state ?? null;
  const [lines, setLines] = useState<CaptionLine[]>([]);
  // La scelta salvata va letta subito: il primo aggiornamento del pulsante
  // nella barra deve già avere lo stato giusto. Sul server vale «visibili»,
  // e senza frasi da mostrare la pagina è la stessa.
  const [visible, setVisible] = useState(readCaptionsVisible);
  const [announcement, setAnnouncement] = useState('');
  // Dove e quanto grandi: li sceglie chi guarda (sopra la barra dei comandi
  // possono coprire qualcosa), e restano nel suo browser.
  const [pref, setPref] = useState<PreferenzeSottotitoli>(leggiPreferenzeSottotitoli);
  const cambiaPref = useCallback((p: Partial<PreferenzeSottotitoli>) => {
    setPref((prima) => {
      const dopo = { ...prima, ...p };
      scriviPreferenzeSottotitoli(dopo);
      return dopo;
    });
  }, []);

  // Il pulsante nella barra di Jitsi: c'è solo con i sottotitoli accesi, e
  // icona e testo dicono che cosa fa il clic. La barra la tiene il registro
  // dei pulsanti personalizzati (lib/jitsi/custom-buttons), che la condivide
  // con gli altri pulsanti della sala e la ridisegna quando cambia.
  const show = t('show');
  const hide = t('hide');
  useEffect(() => {
    if (!api) return;
    impostaPulsante(api, CAPTIONS_BUTTON_ID, active ? captionsToolbarButton(visible, { show, hide }) : null);
  }, [api, active, visible, show, hide]);

  const cambiaVisibili = useCallback((v: boolean) => {
    writeCaptionsVisible(v);
    setVisible(v);
  }, []);

  // Accesi a sala già aperta: da qui in poi Jitsi non annuncia la
  // trascrizione come registrazione. Non si ripristina allo spegnimento, che
  // farebbe sentire «recording off» a tutti.
  const suoniToltiSu = useRef<JitsiMeetExternalAPI | null>(null);
  useEffect(() => {
    if (!api || !active || suoniToltiSu.current === api) return;
    suoniToltiSu.current = api;
    try {
      api.executeCommand('overwriteConfig', { disabledSounds: [...CAPTIONS_DISABLED_SOUNDS] });
    } catch {
      // Una versione di Jitsi senza il comando: restano gli annunci.
    }
  }, [api, active]);

  useEffect(() => {
    if (!api || !active) return;
    const onClick = (event: { key: string }) => {
      if (event?.key !== CAPTIONS_BUTTON_ID) return;
      setVisible((v) => {
        writeCaptionsVisible(!v);
        return !v;
      });
    };
    api.addListener('toolbarButtonClicked', onClick);
    return () => api.removeListener('toolbarButtonClicked', onClick);
  }, [api, active]);

  const speakerName = useCallback(
    (speakerId: string | null): string => {
      if (!speakerId || !api) return t('unknownSpeaker');
      try {
        return api.getDisplayName(speakerId)?.trim() || t('unknownSpeaker');
      } catch {
        return t('unknownSpeaker');
      }
    },
    [api, t],
  );

  useEffect(() => {
    if (!api || !active) {
      setLines([]);
      return;
    }
    const onChunk = (event: { data?: JitsiTranscriptionChunk }) => {
      // L'IFrame API consegna il frammento dentro `data`; una forma senza
      // involucro si accetta lo stesso, per non dipendere dalla versione.
      const chunk = event?.data ?? (event as unknown as JitsiTranscriptionChunk);
      if (!chunk?.messageID) return;
      setLines((current) => applyChunk(current, chunk, Date.now()));
      if (typeof chunk.final === 'string' && chunk.final.trim()) {
        setAnnouncement(`${speakerName(chunk.participant?.id ?? null)}: ${chunk.final.trim()}`);
      }
    };
    api.addListener('transcriptionChunkReceived', onChunk);
    // Le frasi lette spariscono anche se non arriva nulla di nuovo.
    const timer = window.setInterval(() => {
      setLines((current) => {
        const next = prune(current, Date.now());
        return next.length === current.length ? current : next;
      });
    }, 1000);
    return () => {
      api.removeListener('transcriptionChunkReceived', onChunk);
      window.clearInterval(timer);
    };
  }, [api, active, speakerName]);

  if (!active) return null;

  const notice =
    serviceState === 'paused' ? t('paused') : serviceState === 'unavailable' ? t('unavailable') : null;

  const indice = DIMENSIONI_SOTTOTITOLI.indexOf(pref.dimensione);
  const inAlto = pref.posizione === 'alto' && alto !== null;
  const contenuto = (
    <div
      className={`live-captions live-captions--${pref.dimensione}${inAlto ? ' live-captions--alto' : ''}`}
      role="region"
      aria-label={t('region')}
    >
      {visible ? (
        // I comandi di chi guarda, sempre a vista mentre i sottotitoli ci
        // sono: come toglierli, spostarli, ingrandirli.
        <div className="live-captions__comandi" role="group" aria-label={t('controls')}>
          <button
            type="button"
            className="live-captions__comando"
            onClick={() => cambiaPref({ dimensione: DIMENSIONI_SOTTOTITOLI[Math.max(0, indice - 1)] })}
            disabled={indice <= 0}
            aria-label={t('smaller')}
            title={t('smaller')}
          >
            <span aria-hidden="true">{t('smallerShort')}</span>
          </button>
          <button
            type="button"
            className="live-captions__comando"
            onClick={() =>
              cambiaPref({
                dimensione: DIMENSIONI_SOTTOTITOLI[Math.min(DIMENSIONI_SOTTOTITOLI.length - 1, indice + 1)],
              })
            }
            disabled={indice >= DIMENSIONI_SOTTOTITOLI.length - 1}
            aria-label={t('larger')}
            title={t('larger')}
          >
            <span aria-hidden="true">{t('largerShort')}</span>
          </button>
          {alto !== null && (
            <button
              type="button"
              className="live-captions__comando"
              onClick={() => cambiaPref({ posizione: inAlto ? 'basso' : 'alto' })}
              aria-label={inAlto ? t('moveDown') : t('moveUp')}
              title={inAlto ? t('moveDown') : t('moveUp')}
            >
              <Icon icon={inAlto ? 'it-arrow-down' : 'it-arrow-up'} size="xs" color="white" />
            </button>
          )}
          <button
            type="button"
            className="live-captions__comando"
            onClick={() => cambiaVisibili(false)}
            aria-label={hide}
            title={hide}
          >
            <Icon icon="it-close" size="xs" color="white" />
          </button>
        </div>
      ) : (
        // Nascosti: il comando per riaverli, dove stavano.
        <button
          type="button"
          className="live-captions__cc"
          onClick={() => cambiaVisibili(true)}
          aria-label={show}
          title={show}
        >
          <span aria-hidden="true">{t('showShort')}</span>
        </button>
      )}
      {visible && lines.length > 0 && (
        <div className="live-captions__box" aria-hidden="true">
          {lines.map((line, i) => (
            <p key={line.id} className="live-captions__line">
              {/* Il nome solo quando cambia chi parla: una frase lunga divisa in
                  due righe non lo ripete. */}
              {(i === 0 || lines[i - 1]?.speakerId !== line.speakerId) && (
                <>
                  <span className="live-captions__speaker">{speakerName(line.speakerId)}</span>{' '}
                </>
              )}
              {line.text}
            </p>
          ))}
        </div>
      )}
      {visible && notice && <p className="live-captions__notice">{notice}</p>}
      <span className="visually-hidden" aria-live="polite">
        {visible ? announcement : ''}
      </span>
    </div>
  );
  // In alto, nel riquadro che la sala gli prepara sopra il video: lo stesso
  // componente, solo un altro posto nella pagina.
  return inAlto ? createPortal(contenuto, alto) : contenuto;
}
