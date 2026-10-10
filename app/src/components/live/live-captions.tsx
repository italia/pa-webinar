'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
import type { JitsiMeetExternalAPI, JitsiTranscriptionChunk } from '@/types/jitsi';

/**
 * Tra togliere il pulsante dalla barra e rimetterlo. I due comandi arrivano a
 * Jitsi come messaggi separati e ciascuno ridisegna la barra; l'attesa copre
 * un iframe impegnato, che altrimenti li elaborerebbe insieme e lascerebbe il
 * pulsante vecchio fino al clic successivo.
 */
const REMOUNT_DELAY_MS = 250;

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
}: {
  api: JitsiMeetExternalAPI | null;
  /** Sottotitoli accesi per l'evento e servizio installato. */
  active: boolean;
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

  // Il pulsante nella barra di Jitsi: c'è solo con i sottotitoli accesi, e
  // icona e testo dicono che cosa fa il clic. Jitsi (stable-10741) aggiorna la
  // configurazione ma continua a disegnare il pulsante già montato: per
  // cambiarne l'icona lo si toglie e lo si rimette, e Jitsi lo ridisegna. Il
  // prezzo: chi lo usa da tastiera perde il fuoco sul pulsante dopo il clic.
  const show = t('show');
  const hide = t('hide');
  // La sala su cui il pulsante è già montato: una sala nuova (riconnessione) lo riceve da capo.
  const montatoSu = useRef<JitsiMeetExternalAPI | null>(null);
  useEffect(() => {
    if (!api) return;
    const imposta = (buttons: unknown[]) => {
      try {
        api.executeCommand('overwriteConfig', { customToolbarButtons: buttons });
      } catch {
        // Una versione di Jitsi senza il comando: resta il pulsante della configurazione iniziale.
      }
    };
    if (!active) {
      imposta([]);
      montatoSu.current = null;
      return;
    }
    const button = captionsToolbarButton(visible, { show, hide });
    if (montatoSu.current !== api) {
      imposta([button]);
      montatoSu.current = api;
      return;
    }
    imposta([]);
    const timer = window.setTimeout(() => imposta([button]), REMOUNT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [api, active, visible, show, hide]);

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

  return (
    <div className="live-captions" role="region" aria-label={t('region')}>
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
}
