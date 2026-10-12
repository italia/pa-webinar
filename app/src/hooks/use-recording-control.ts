'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import type { FaseRegistratore } from '@/lib/jitsi/bridge-readiness';
import type { JitsiMeetExternalAPI } from '@/types/jitsi';

const MAX_TENTATIVI = 3;
const ATTESA_TENTATIVO_MS = 3000;
/** Dopo l'arresto il registratore chiude il file: per un po' non si riavvia. */
const PAUSA_DOPO_STOP_MS = 8000;

export interface ControlloRegistrazione {
  /** Si può avviare o fermare adesso: registrazione in corso (si deve poter
   *  sempre fermare), registratore pronto o stato sconosciuto. */
  azionabile: boolean;
  /** Il registratore non è utilizzabile (in avvio, non partito, assente). */
  bloccato: boolean;
  /** Pausa dopo l'arresto. */
  inPausa: boolean;
  avvia: () => void;
  ferma: () => void;
  /** Un avviso per chi conduce (registratore non partito, avvio fallito). */
  avviso: string;
}

/**
 * I comandi della registrazione per chi conduce: avvio con tentativi (il
 * registratore può non essere ancora nella stanza), arresto con una pausa
 * prima di poter riavviare, e gli avvisi del registratore. Un solo punto per
 * la striscia del tempo e la scheda Regia, montato una volta nella sala.
 */
export function useRecordingControl({
  api,
  attivo,
  isRecording,
  faseRegistratore,
  onAvvioRichiesto,
}: {
  api: JitsiMeetExternalAPI | null;
  /** L'avvio parte da questo browser: la sala lo riferisce alla cronologia
   *  anche se arriva nei primi secondi dall'ingresso. */
  onAvvioRichiesto?: () => void;
  /** L'evento prevede la registrazione e chi usa la sala conduce. */
  attivo: boolean;
  isRecording: boolean;
  /** Stato del registratore dalla sonda (null = non lo so). */
  faseRegistratore: FaseRegistratore | null;
}): ControlloRegistrazione {
  const tl = useTranslations('live');
  const [avviso, setAvviso] = useState('');
  const [inPausa, setInPausa] = useState(false);
  const timerAvviso = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerPausa = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerTentativo = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tentativi = useRef(0);

  useEffect(
    () => () => {
      for (const r of [timerAvviso, timerPausa, timerTentativo]) {
        if (r.current) clearTimeout(r.current);
      }
    },
    [],
  );

  // Un avviso alla volta: il timer del precedente non deve spegnere il nuovo.
  const mostraAvviso = useCallback((messaggio: string, durataMs = 4000) => {
    if (timerAvviso.current) clearTimeout(timerAvviso.current);
    setAvviso(messaggio);
    timerAvviso.current = setTimeout(() => setAvviso(''), durataMs);
  }, []);

  const bloccato =
    faseRegistratore === 'in-avvio' ||
    faseRegistratore === 'non-partito' ||
    faseRegistratore === 'non-configurato';

  // Il registratore non si è acceso entro il tempo massimo: un avviso
  // esplicito, una volta per attesa. Nessun avviso mentre si registra: la
  // sonda può non raggiungere un registratore che sta lavorando.
  const fasePrecedente = useRef<FaseRegistratore | null>(null);
  const testoNonPartito = tl('recorderNotStartedDetail');
  useEffect(() => {
    const precedente = fasePrecedente.current;
    fasePrecedente.current = faseRegistratore;
    if (!attivo || isRecording || faseRegistratore !== 'non-partito' || precedente === 'non-partito') {
      return;
    }
    mostraAvviso(testoNonPartito, 10_000);
  }, [faseRegistratore, attivo, isRecording, mostraAvviso, testoNonPartito]);

  // Una registrazione in corso smentisce l'avviso.
  useEffect(() => {
    if (isRecording) setAvviso((a) => (a === testoNonPartito ? '' : a));
  }, [isRecording, testoNonPartito]);

  const tentaAvvio = useCallback(() => {
    if (!api) return;
    try {
      api.executeCommand('startRecording', { mode: 'file' });
    } catch {
      // Il registratore non è ancora nella stanza: si riprova con attesa crescente.
      if (tentativi.current < MAX_TENTATIVI) {
        tentativi.current += 1;
        timerTentativo.current = setTimeout(tentaAvvio, ATTESA_TENTATIVO_MS * tentativi.current);
      } else {
        tentativi.current = 0;
        mostraAvviso(tl('recorderStartFailed'), 8000);
      }
    }
  }, [api, tl, mostraAvviso]);

  // Un errore del servizio di registrazione: si riprova, poi si avvisa.
  useEffect(() => {
    if (!api || !attivo) return;
    const onStato = (evt: { error?: string; on?: boolean }) => {
      if (evt.error && tentativi.current < MAX_TENTATIVI) {
        tentativi.current += 1;
        if (timerTentativo.current) clearTimeout(timerTentativo.current);
        timerTentativo.current = setTimeout(tentaAvvio, ATTESA_TENTATIVO_MS * tentativi.current);
      } else if (evt.error) {
        tentativi.current = 0;
        mostraAvviso(tl('recorderStartFailed'), 8000);
      } else if (evt.on !== undefined) {
        tentativi.current = 0;
      }
    };
    api.addListener('recordingStatusChanged', onStato);
    return () => api.removeListener('recordingStatusChanged', onStato);
  }, [api, attivo, tentaAvvio, tl, mostraAvviso]);

  const avvia = useCallback(() => {
    // Disabilitato in queste fasi; la guardia resta per un clic arrivato
    // durante il cambio di fase.
    if (!api || inPausa || isRecording || bloccato) return;
    tentativi.current = 0;
    onAvvioRichiesto?.();
    tentaAvvio();
  }, [api, inPausa, isRecording, bloccato, tentaAvvio, onAvvioRichiesto]);

  const ferma = useCallback(() => {
    if (!api || !isRecording) return;
    api.executeCommand('stopRecording', 'file');
    setInPausa(true);
    if (timerPausa.current) clearTimeout(timerPausa.current);
    timerPausa.current = setTimeout(() => setInPausa(false), PAUSA_DOPO_STOP_MS);
  }, [api, isRecording]);

  return {
    azionabile: !!api && !inPausa && (isRecording || !bloccato),
    bloccato,
    inPausa,
    avvia,
    ferma,
    avviso,
  };
}
