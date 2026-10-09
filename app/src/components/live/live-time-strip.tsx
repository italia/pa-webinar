'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import type { ControlloRegistrazione } from '@/hooks/use-recording-control';
import { useTimerInterventi } from '@/hooks/use-presentation-timer';
import type { FaseRegistratore } from '@/lib/jitsi/bridge-readiness';
import { formatDurata, minutiInteri, orologioEvento, type FaseOrologio } from '@/lib/live/event-clock';

import { formatTimer } from './presentation-timer';

/**
 * La striscia del tempo, per chi conduce: da quanto si è in onda rispetto
 * all'orario previsto, il fuori orario e la chiusura, la registrazione e il
 * timer degli interventi quando è acceso. Niente comandi rischiosi: un clic
 * sulla registrazione o sul timer apre la scheda Regia, dove stanno.
 */
interface LiveTimeStripProps {
  startsAt: string;
  endsAt: string;
  /** Tetto del fuori orario in minuti dopo la fine; negativo = nessuno. */
  graceMinutes: number;
  recordingEnabled: boolean;
  isRecording: boolean;
  /** Avvio della registrazione secondo il server (la cronologia della sala). */
  recordingStartedAt: string | null;
  /** Scarto fra l'orologio del server e quello di questo browser (ms): la
   *  striscia ragiona sull'ora del server. */
  scartoOrologio?: number;
  /** Quando questo browser ha visto partire la registrazione (un cambio vero,
   *  non lo stato trovato entrando); null se non l'ha visto. */
  avvioOsservato: number | null;
  /** Chiamata istantanea: la fine prevista è solo nominale, nessun orario. */
  istantanea?: boolean;
  faseRegistratore: FaseRegistratore | null;
  registrazione: ControlloRegistrazione;
  eventSlug: string;
  onApriRegia: () => void;
}

// Icone della striscia: segnali, non decorazione. Disegnate qui (niente
// sprite: devono animarsi con il CSS, vedi globals.scss).
function IconaInOnda() {
  return (
    <svg className="live-time-strip__live-icon" width="18" height="18" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle className="live-time-strip__live-core" cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
      <path className="live-time-strip__live-wave live-time-strip__live-wave--1" d="M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7" />
      <path className="live-time-strip__live-wave live-time-strip__live-wave--2" d="M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8" />
    </svg>
  );
}

function IconaOrologio() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </svg>
  );
}

function IconaClessidra() {
  return (
    <svg className="live-time-strip__hourglass" width="14" height="14" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 2h12M6 22h12M7 2c0 5 5 6 5 10s-5 5-5 10M17 2c0 5-5 6-5 10s5 5 5 10" />
    </svg>
  );
}

function IconaInizio() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" />
    </svg>
  );
}

/** Il colore del timer degli interventi, come la fascia per il pubblico. */
function toniTimer(remaining: number, duration: number): 'ok' | 'warn' | 'danger' {
  if (duration <= 0) return 'ok';
  const r = remaining / duration;
  return r > 0.5 ? 'ok' : r > 0.25 ? 'warn' : 'danger';
}

const CLASSE_FASE: Record<FaseOrologio, string> = {
  'in-orario': '',
  'quasi-fine': ' live-time-strip--soon',
  'fuori-orario': ' live-time-strip--over',
  'in-chiusura': ' live-time-strip--closing',
};

export default function LiveTimeStrip({
  startsAt,
  endsAt,
  graceMinutes,
  recordingEnabled,
  isRecording,
  recordingStartedAt,
  scartoOrologio = 0,
  avvioOsservato,
  istantanea = false,
  faseRegistratore,
  registrazione,
  eventSlug,
  onApriRegia,
}: LiveTimeStripProps) {
  const timer = useTimerInterventi(eventSlug);
  const t = useTranslations('live.strip');
  const tl = useTranslations('live');
  const tt = useTranslations('timer');
  const format = useFormatter();
  const [now, setNow] = useState<number | null>(null);

  // Solo sul client: un orologio reso dal server non combacerebbe. L'ora è
  // quella del server (orologio locale più lo scarto).
  useEffect(() => {
    setNow(Date.now() + scartoOrologio);
    const id = setInterval(() => setNow(Date.now() + scartoOrologio), 1000);
    return () => clearInterval(id);
  }, [scartoOrologio]);

  // La registrazione vista partire da questo browser: serve quando il server
  // non sa ancora (o non sa) quando è iniziata.
  const vistaDalle = useRef<number | null>(null);
  useEffect(() => {
    vistaDalle.current = isRecording ? Date.now() : null;
  }, [isRecording]);
  // Le ore viste da questo browser, riportate sull'orologio del server.
  const sulServer = (ms: number | null) => (ms === null ? null : ms + scartoOrologio);

  const inizio = new Date(startsAt).getTime();
  const fine = new Date(endsAt).getTime();
  const valido = now !== null && !Number.isNaN(inizio) && !Number.isNaN(fine);
  const orologio = valido ? orologioEvento({ now: now as number, inizio, fine, graceMinutes }) : null;

  const ora = (ms: number) => format.dateTime(new Date(ms), { hour: '2-digit', minute: '2-digit' });
  // Prima dell'inizio (si entra per preparare) si dice quando comincia; una
  // chiamata istantanea non ha orario. Oltre la fine: il fuori orario e la
  // chiusura automatica, anche quando è questione di secondi.
  const primaDellInizio = valido && (now as number) < inizio;
  const statoTesto = !orologio || istantanea
    ? ''
    : primaDellInizio
      ? t('startsAt', { time: ora(inizio), minutes: minutiInteri(inizio - (now as number)) })
      : orologio.fase === 'in-orario' || orologio.fase === 'quasi-fine'
        ? t('endsAt', { time: ora(fine), minutes: minutiInteri(orologio.mancanoMs) })
        : orologio.minutiAllaChiusura === null
          ? t('overtimeOpen', { minutes: minutiInteri(orologio.mancanoMs) })
          : orologio.minutiAllaChiusura === 0
            ? t('closingNow', { minutes: minutiInteri(orologio.mancanoMs) })
            : t('overtimeClosing', {
                minutes: minutiInteri(orologio.mancanoMs),
                closing: orologio.minutiAllaChiusura,
              });

  // L'annuncio per i lettori di schermo cambia solo al cambio di fase: il
  // conto dei minuti, letto a ogni aggiornamento, li renderebbe inutilizzabili.
  const [annuncio, setAnnuncio] = useState('');
  const faseAnnunciata = useRef<FaseOrologio>('in-orario');
  useEffect(() => {
    // Prima dell'inizio la fase non dice niente (un evento breve risulterebbe
    // già «agli ultimi minuti»): si annuncia da quando comincia.
    if (!orologio || istantanea || primaDellInizio || orologio.fase === faseAnnunciata.current) return;
    faseAnnunciata.current = orologio.fase;
    setAnnuncio(orologio.fase === 'in-orario' ? '' : statoTesto);
  }, [orologio, statoTesto, istantanea, primaDellInizio]);

  if (!orologio) return null;

  // L'ora del server vale per tutti i moderatori. La si scarta se è prima di
  // un avvio che questo browser ha visto accadere: è di una registrazione
  // precedente, rimasta in cronologia senza l'arresto.
  const avviatoServer = recordingStartedAt ? new Date(recordingStartedAt).getTime() : NaN;
  const osservato = sulServer(avvioOsservato);
  const serverAttendibile =
    !Number.isNaN(avviatoServer) &&
    avviatoServer <= (now as number) &&
    (osservato === null || avviatoServer >= osservato - 15_000);
  const avvio = serverAttendibile ? avviatoServer : (osservato ?? sulServer(vistaDalle.current));
  const durataRec = avvio !== null ? formatDurata((now as number) - avvio) : null;

  return (
    <div
      className={`live-time-strip${istantanea || primaDellInizio ? '' : CLASSE_FASE[orologio.fase]}`}
      role="group"
      aria-label={t('label')}
    >
      <div className="live-time-strip__clock">
        {/* Chi è nella chiamata è in onda, anche prima dell'orario previsto:
            allora il tempo non scorre ancora e il testo dice quando inizia. */}
        <span className="live-time-strip__onair">
          <IconaInOnda />
          {t('onAir')}
          {!primaDellInizio && <strong className="font-monospace">{formatDurata(orologio.trascorsoMs)}</strong>}
        </span>
        {!istantanea && (
          <>
            <div
              className="live-time-strip__bar"
              role="progressbar"
              aria-label={t('progressLabel')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(orologio.avanzamento * 100)}
              aria-valuetext={statoTesto}
            >
              <div className="live-time-strip__fill" style={{ width: `${orologio.avanzamento * 100}%` }} />
            </div>
            <span className="live-time-strip__status">
              {primaDellInizio ? (
                <IconaInizio />
              ) : orologio.fase === 'in-orario' || orologio.fase === 'quasi-fine' ? (
                <IconaOrologio />
              ) : (
                <IconaClessidra />
              )}
              <span>{statoTesto}</span>
            </span>
          </>
        )}
      </div>

      <div className="live-time-strip__side">
        {/* Il timer degli interventi: lo stesso della fascia per il pubblico,
            con il colore che cambia e un anello che si svuota. */}
        {timer.active && (
          <button
            type="button"
            className={`live-time-strip__chip live-time-strip__chip--${toniTimer(timer.remaining, timer.duration)}${
              timer.paused ? ' live-time-strip__chip--paused' : ''
            }${timer.remaining > 0 && timer.remaining < 60 && !timer.paused ? ' live-time-strip__chip--last' : ''}`}
            onClick={onApriRegia}
            aria-label={t('timerChipLabel', { time: formatTimer(timer.remaining) })}
          >
            <span
              className="live-time-strip__ring"
              style={{
                ['--quota' as string]: `${timer.duration > 0 ? (timer.remaining / timer.duration) * 360 : 0}deg`,
              }}
              aria-hidden="true"
            />
            <span>{t('timerChip')}</span>
            <strong className="font-monospace">
              {timer.remaining === 0 ? tt('timeUp') : formatTimer(timer.remaining)}
            </strong>
            {timer.paused && <span className="live-time-strip__chip-note">{t('timerPaused')}</span>}
          </button>
        )}

        {recordingEnabled &&
          (isRecording ? (
            <button
              type="button"
              className="live-time-strip__rec live-time-strip__rec--on"
              onClick={onApriRegia}
              aria-label={durataRec ? t('recOnLabel', { time: durataRec }) : tl('recordingActive')}
            >
              <span className="live-time-strip__rec-dot" aria-hidden="true" />
              <span>{tl('recordingShort')}</span>
              {durataRec && <strong className="font-monospace">{durataRec}</strong>}
            </button>
          ) : registrazione.inPausa ? (
            <span className="live-time-strip__rec live-time-strip__rec--wait">{tl('moderator.recPreparing')}</span>
          ) : faseRegistratore === 'in-avvio' ? (
            <span className="live-time-strip__rec live-time-strip__rec--wait" title={tl('jibriScalingTooltip')}>
              {tl('jibriScaling')}
            </span>
          ) : faseRegistratore === 'non-partito' || faseRegistratore === 'non-configurato' ? (
            <button
              type="button"
              className="live-time-strip__rec live-time-strip__rec--warn"
              onClick={onApriRegia}
              title={faseRegistratore === 'non-partito' ? tl('recorderNotStartedDetail') : tl('jibriNotConfigured')}
            >
              {faseRegistratore === 'non-partito' ? tl('recorderNotStarted') : tl('jibriNotConfigured')}
            </button>
          ) : (
            <button
              type="button"
              className="live-time-strip__rec live-time-strip__rec--off"
              onClick={onApriRegia}
              aria-label={t('recOffLabel')}
            >
              <span className="live-time-strip__rec-dot" aria-hidden="true" />
              <span>{t('recOff')}</span>
            </button>
          ))}
      </div>

      {/* Gli avvisi del registratore (non partito, avvio fallito): qui, e non
          solo nella Regia, perché si vedano da qualunque scheda. */}
      {registrazione.avviso && (
        <div className="live-time-strip__alert" role="alert">
          {registrazione.avviso}
        </div>
      )}

      <span className="visually-hidden" role="status">
        {annuncio}
      </span>
    </div>
  );
}
